import { Telegraf } from 'telegraf';
import { Markup } from 'telegraf';
import { prisma } from '../../db/client';
import { callClaudeJSON } from '../../services/ai/claudeClient';
import { buildSessionSummaryPrompt } from '../../services/ai/systemPrompts';
import { generateSessionEmbedding, updateSessionTelemetry } from '../../services/memory/memoryService';
import { decrypt } from '../../utils/encryption';
import { logger } from '../../utils/logger';
import { splitMessage } from '../../utils/telegramHelpers';
import type { ConversationMessage } from '../../types';
import type { TopicCategory } from '../../config/constants';

interface SummaryResult {
  personalSummary: string;
  sharedCommitments: string;
  encouragement: string;
  emotionScoreStart: number;
  emotionScoreEnd: number;
}

// In-memory summary cache — avoids regenerating summaries for email opt-in.
// Summaries are generated at session close; if user opts into email within 30 min,
// the cached version is reused instead of making another Claude API call.
const summaryCache = new Map<string, { data: SummaryResult; timestamp: number }>();
const SUMMARY_CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

export function getCachedSummary(sessionId: string, userRole: 'USER_A' | 'USER_B'): SummaryResult | null {
  const key = `${sessionId}:${userRole}`;
  const cached = summaryCache.get(key);
  if (cached && Date.now() - cached.timestamp < SUMMARY_CACHE_TTL_MS) {
    return cached.data;
  }
  summaryCache.delete(key);
  return null;
}

function cacheSummary(sessionId: string, userRole: 'USER_A' | 'USER_B', data: SummaryResult): void {
  summaryCache.set(`${sessionId}:${userRole}`, { data, timestamp: Date.now() });
}

/**
 * Orchestrate session close:
 * 1. Generate summaries for both users
 * 2. Send Telegram summaries
 * 3. Ask about email opt-in
 * 4. Generate and store session embeddings
 * 5. Update telemetry
 */
export async function orchestrateSessionClose(
  bot: Telegraf,
  sessionId: string
): Promise<void> {
  const session = await prisma.coupleSession.findUnique({
    where: { id: sessionId },
    include: {
      userA: true,
      userB: true,
      messages: { orderBy: { createdAt: 'asc' } },
      riskEvents: true,
    },
  });

  if (!session) {
    logger.error('Session not found for close orchestration', { sessionId });
    return;
  }

  // Get conversation history (decrypt raw content)
  const conversationHistory: ConversationMessage[] = session.messages
    .filter((m) => m.rawContent)
    .map((m) => {
      let content: string;
      try {
        content = decrypt(m.rawContent!);
      } catch {
        // Fallback for messages stored before encryption was added
        content = m.rawContent!;
      }
      return {
        role: m.messageType === 'COACHING' ? ('BOT' as const) : m.senderRole,
        content,
        timestamp: m.createdAt,
      };
    });

  // Determine topic category
  const topicCategory = (session.riskEvents[0]?.topicCategory || 'משהו שחשוב לי לשתף') as TopicCategory;

  // Generate summary for User A (and cache for email opt-in)
  const userALanguage = session.userA.language || 'he';
  const summaryA = await generateSummary(sessionId, 'USER_A', conversationHistory, topicCategory, userALanguage);
  cacheSummary(sessionId, 'USER_A', summaryA);

  // Send summary to User A
  const telegramIdA = decrypt(session.userA.telegramId);
  await sendTelegramSummary(bot, telegramIdA, summaryA, 'USER_A');

  // Ask User A about email
  await bot.telegram.sendMessage(telegramIdA,
    'הסשן הסתיים. רוצה לקבל את הסיכום גם למייל?\nהסיכום כולל את המסע הרגשי שלך, הכלים שתרגלתם, ומשאב קריאה מותאם.',
    Markup.inlineKeyboard([
      [Markup.button.callback('✅ כן, שלח לי למייל', 'email_opt:yes')],
      [Markup.button.callback('❌ לא תודה', 'email_opt:no')],
    ])
  );

  // Generate and send summary for User B (if exists)
  if (session.userB) {
    const userBLanguage = session.userB.language || 'he';
    const summaryB = await generateSummary(sessionId, 'USER_B', conversationHistory, topicCategory, userBLanguage);
    cacheSummary(sessionId, 'USER_B', summaryB);

    const telegramIdB = decrypt(session.userB.telegramId);
    await sendTelegramSummary(bot, telegramIdB, summaryB, 'USER_B');

    // Ask User B about email
    await bot.telegram.sendMessage(telegramIdB,
      'הסשן הסתיים. רוצה לקבל את הסיכום גם למייל?\nהסיכום כולל את המסע הרגשי שלך, הכלים שתרגלתם, ומשאב קריאה מותאם.',
      Markup.inlineKeyboard([
        [Markup.button.callback('✅ כן, שלח לי למייל', 'email_opt:yes')],
        [Markup.button.callback('❌ לא תודה', 'email_opt:no')],
      ])
    );

    // Generate embedding for User B
    await generateSessionEmbedding({
      sessionId,
      anonymizedCoupleId: session.anonymizedCoupleId,
      userRole: 'B',
      topicCategory,
    });
  }

  // Generate embedding for User A
  await generateSessionEmbedding({
    sessionId,
    anonymizedCoupleId: session.anonymizedCoupleId,
    userRole: 'A',
    topicCategory,
  });

  // Update telemetry
  await updateSessionTelemetry({
    anonymizedCoupleId: session.anonymizedCoupleId,
    status: 'CLOSED',
    topicCategory,
    mirrorAttempts: session.mirrorAttempts,
    partnerJoined: session.partnerJoined,
    emotionScoreStart: summaryA.emotionScoreStart,
    emotionScoreEnd: summaryA.emotionScoreEnd,
    messageCount: session.messages.length,
    riskEventsCount: session.riskEvents.length,
    maxRiskLevel: getMaxRiskLevel(session.riskEvents.map((e) => e.riskLevel)),
  });

  logger.info('Session close orchestration completed', { sessionId });
}

async function generateSummary(
  sessionId: string,
  userRole: 'USER_A' | 'USER_B',
  history: ConversationMessage[],
  topicCategory: TopicCategory,
  language: string
): Promise<SummaryResult> {
  try {
    const result = await callClaudeJSON<SummaryResult>({
      systemPrompt: buildSessionSummaryPrompt({
        userRole,
        conversationHistory: history,
        language,
        topicCategory,
      }),
      userMessage: 'Generate the session summary.',
      sessionId,
    });

    return result;
  } catch {
    return {
      personalSummary: 'הסשן הסתיים. תודה שהשתתפת.',
      sharedCommitments: 'לא זוהו מחויבויות ספציפיות בסשן זה.',
      encouragement: 'כל שיחה היא צעד קדימה. אתם בדרך הנכונה. ❤️',
      emotionScoreStart: 3,
      emotionScoreEnd: 3,
    };
  }
}

async function sendTelegramSummary(
  bot: Telegraf,
  telegramId: string,
  summary: SummaryResult,
  role: string
): Promise<void> {
  const personalSection = `🪞 *המסע האישי שלך:*\n${summary.personalSummary}`;
  const sharedSection = `🤝 *מחויבויות משותפות:*\n${summary.sharedCommitments}`;
  const encouragementSection = `\n${summary.encouragement}`;
  const ctaSection = '\n💬 *רוצים להמשיך?* הקלד/י /start לסשן נוסף.';

  const fullSummary = `${personalSection}\n\n${sharedSection}\n${encouragementSection}\n${ctaSection}`;

  for (const chunk of splitMessage(fullSummary)) {
    try {
      await bot.telegram.sendMessage(telegramId, chunk, { parse_mode: 'Markdown' });
    } catch (error) {
      // Fallback: send without markdown
      try {
        await bot.telegram.sendMessage(telegramId, chunk.replace(/\*/g, ''));
      } catch (innerError) {
        logger.error('Failed to send summary to user', {
          telegramId,
          role,
          error: innerError instanceof Error ? innerError.message : String(innerError),
        });
      }
    }
  }
}

function getMaxRiskLevel(levels: string[]): string {
  const order = ['L1', 'L2', 'L3', 'L3_PLUS', 'L4'];
  let maxIndex = 0;
  for (const level of levels) {
    const index = order.indexOf(level);
    if (index > maxIndex) maxIndex = index;
  }
  return order[maxIndex];
}
