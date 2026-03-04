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

// Periodic cache eviction to prevent memory leak
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of summaryCache) {
    if (now - entry.timestamp > SUMMARY_CACHE_TTL_MS) {
      summaryCache.delete(key);
    }
  }
}, SUMMARY_CACHE_TTL_MS);

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
 *
 * GUARD: Uses atomic closeOrchestrated flag to prevent duplicate orchestration.
 * This prevents summary messages from appearing in the wrong context when:
 * - /stop fires orchestration async, then user immediately starts a new session
 * - Periodic auto-close task double-fires for recently closed sessions
 */
export async function orchestrateSessionClose(
  bot: Telegraf,
  sessionId: string
): Promise<void> {
  // Atomic claim: only one orchestration per session.
  // updateMany with WHERE closeOrchestrated=false acts as compare-and-swap.
  const claimed = await prisma.coupleSession.updateMany({
    where: { id: sessionId, status: 'CLOSED', closeOrchestrated: false },
    data: { closeOrchestrated: true },
  });

  if (claimed.count === 0) {
    logger.info('Session close orchestration skipped (already orchestrated or not CLOSED)', { sessionId });
    return;
  }

  try {
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
        // Skip messages that fail decryption — returning encrypted hex is a data leak
        logger.warn('Failed to decrypt message during close orchestration, skipping', {
          sessionId,
          messageType: m.messageType,
        });
        return null;
      }
      return {
        role: m.messageType === 'COACHING' ? ('BOT' as const) : m.senderRole,
        content,
        timestamp: m.createdAt,
      };
    })
    .filter((m): m is NonNullable<typeof m> => m !== null);

  // Determine topic category
  const topicCategory = (session.riskEvents[0]?.topicCategory || 'משהו שחשוב לי לשתף') as TopicCategory;

  // Generate summary for User A (and cache for email opt-in)
  const userALanguage = session.userA.language || 'he';
  const summaryA = await generateSummary(sessionId, 'USER_A', conversationHistory, topicCategory, userALanguage);
  cacheSummary(sessionId, 'USER_A', summaryA);

  // Check if User A already has a NEWER active session.
  // If so, skip the Telegram summary to avoid confusing messages mid-flow.
  const userAHasNewerSession = await hasNewerActiveSession(session.userAId, session.createdAt);
  const telegramIdA = decrypt(session.userA.telegramId);

  if (!userAHasNewerSession) {
    await sendTelegramSummary(bot, telegramIdA, summaryA, 'USER_A');

    // Ask User A about email
    await bot.telegram.sendMessage(telegramIdA,
      'הסשן הסתיים. רוצה לקבל את הסיכום גם למייל?\nהסיכום כולל את המסע הרגשי שלך, הכלים שתרגלתם, ומשאב קריאה מותאם.',
      Markup.inlineKeyboard([
        [Markup.button.callback('✅ כן, שלח לי למייל', 'email_opt:yes')],
        [Markup.button.callback('❌ לא תודה', 'email_opt:no')],
      ])
    );
  } else {
    logger.info('Skipped Telegram summary for User A — newer active session exists', {
      sessionId,
      userAId: session.userAId,
    });
  }

  // Generate and send summary for User B (if exists)
  if (session.userB) {
    const userBLanguage = session.userB.language || 'he';
    const summaryB = await generateSummary(sessionId, 'USER_B', conversationHistory, topicCategory, userBLanguage);
    cacheSummary(sessionId, 'USER_B', summaryB);

    const userBHasNewerSession = await hasNewerActiveSession(session.userBId!, session.createdAt);
    const telegramIdB = decrypt(session.userB.telegramId);

    if (!userBHasNewerSession) {
      await sendTelegramSummary(bot, telegramIdB, summaryB, 'USER_B');

      // Ask User B about email
      await bot.telegram.sendMessage(telegramIdB,
        'הסשן הסתיים. רוצה לקבל את הסיכום גם למייל?\nהסיכום כולל את המסע הרגשי שלך, הכלים שתרגלתם, ומשאב קריאה מותאם.',
        Markup.inlineKeyboard([
          [Markup.button.callback('✅ כן, שלח לי למייל', 'email_opt:yes')],
          [Markup.button.callback('❌ לא תודה', 'email_opt:no')],
        ])
      );
    } else {
      logger.info('Skipped Telegram summary for User B — newer active session exists', {
        sessionId,
        userBId: session.userBId,
      });
    }

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
  } catch (error) {
    // Top-level catch: if orchestration fails after claiming the flag,
    // log the error but don't rethrow — the session is already CLOSED.
    logger.error('Session close orchestration failed after claim', {
      sessionId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
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
  } catch (error) {
    logger.error('Failed to generate session summary via Claude', {
      sessionId,
      userRole,
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      personalSummary: 'הסשן הסתיים. תודה שהשתתפת.',
      sharedCommitments: 'לא זוהו מחויבויות ספציפיות בסשן זה.',
      encouragement: 'כל שיחה היא צעד קדימה. אתם בדרך הנכונה. ❤️',
      // Use null-like sentinel (0) instead of fabricated mid-range scores.
      // Downstream telemetry should treat 0 as "unknown/unavailable".
      emotionScoreStart: 0,
      emotionScoreEnd: 0,
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

/**
 * Check if a user has a newer active (non-CLOSED, non-LOCKED) session
 * created after the given session's createdAt.
 * Used to avoid sending old session summaries into a new session's chat.
 */
async function hasNewerActiveSession(userId: string, afterDate: Date): Promise<boolean> {
  const newerSession = await prisma.coupleSession.findFirst({
    where: {
      OR: [{ userAId: userId }, { userBId: userId }],
      status: { notIn: ['CLOSED', 'LOCKED'] },
      createdAt: { gt: afterDate },
    },
    select: { id: true },
  });
  return newerSession !== null;
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
