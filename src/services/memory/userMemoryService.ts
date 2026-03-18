import { prisma } from '../../db/client';
import { callClaudeJSON } from '../ai/claudeClient';
import { encrypt, decrypt } from '../../utils/encryption';
import { logger } from '../../utils/logger';
import type { ConversationMessage } from '../../types';
import type { TopicCategory } from '../../config/constants';

interface ExtractedFact {
  category: string;
  key: string;
  value: string;
  confidence: number;
}

interface FactExtractionResult {
  facts: ExtractedFact[];
}

const VALID_CATEGORIES = [
  'attachment_style',
  'family_context',
  'recurring_topic',
  'communication_pattern',
  'preference',
] as const;

/**
 * Extract user facts from a conversation using Claude.
 * Called at session close — NOT during live messages (zero latency impact).
 */
export async function extractUserFacts(params: {
  sessionId: string;
  userId: string;
  userRole: 'USER_A' | 'USER_B';
  conversationHistory: ConversationMessage[];
  topicCategory: TopicCategory;
}): Promise<void> {
  const { sessionId, userId, userRole, conversationHistory, topicCategory } = params;

  try {
    // Filter to only this user's messages + bot responses to them
    const relevantMessages = conversationHistory
      .filter((m) => m.role === userRole || m.role === 'BOT')
      .slice(-30) // Last 30 messages max
      .map((m) => `[${m.role}] ${m.content}`)
      .join('\n');

    if (relevantMessages.length < 50) {
      logger.info('Too few messages for fact extraction', { sessionId, userId });
      return;
    }

    const result = await callClaudeJSON<FactExtractionResult>({
      systemPrompt: `You extract structured facts about a user from a couples mediation conversation.

CATEGORIES (use EXACTLY one per fact):
- attachment_style: anxious, avoidant, secure, disorganized patterns
- family_context: children, ages, living situation, family structure
- recurring_topic: topics that keep coming up across sessions
- communication_pattern: how they express emotions, conflict style
- preference: language preferences, session preferences

RULES:
- Extract only facts clearly stated or strongly implied by the user
- Do NOT infer attachment styles unless the pattern is very clear (confidence >= 0.7)
- Keep values concise (under 20 words)
- Confidence: 0.6-1.0 (0.6=implied, 0.8=stated once, 0.95=stated multiple times)
- Output in English for consistency
- Maximum 8 facts per extraction

OUTPUT FORMAT:
Return ONLY valid JSON:
{
  "facts": [
    { "category": "family_context", "key": "children", "value": "2 kids, ages 3 and 7", "confidence": 0.95 }
  ]
}

If no facts can be extracted, return: { "facts": [] }`,
      userMessage: `Topic: ${topicCategory}\nUser role: ${userRole}\n\nConversation:\n${relevantMessages}`,
      maxTokens: 512,
      sessionId,
    });

    if (!result.facts || !Array.isArray(result.facts) || result.facts.length === 0) {
      logger.info('No facts extracted from session', { sessionId, userId });
      return;
    }

    // Validate and upsert facts
    let upsertCount = 0;
    for (const fact of result.facts) {
      if (!VALID_CATEGORIES.includes(fact.category as typeof VALID_CATEGORIES[number])) {
        continue;
      }
      if (!fact.key || !fact.value || typeof fact.confidence !== 'number') {
        continue;
      }

      const confidence = Math.max(0.6, Math.min(1.0, fact.confidence));

      await prisma.userMemory.upsert({
        where: {
          userId_category_factKey: {
            userId,
            category: fact.category,
            factKey: fact.key,
          },
        },
        update: {
          factValue: encrypt(fact.value),
          confidence,
          sourceSessionId: sessionId,
        },
        create: {
          userId,
          category: fact.category,
          factKey: fact.key,
          factValue: encrypt(fact.value),
          confidence,
          sourceSessionId: sessionId,
        },
      });
      upsertCount++;
    }

    logger.info('User facts extracted and stored', {
      sessionId,
      userId,
      userRole,
      factCount: upsertCount,
    });
  } catch (error) {
    // Non-critical — don't crash session close
    logger.error('Failed to extract user facts', {
      sessionId,
      userId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Get all decrypted memory facts for a user.
 */
export async function getUserMemoryProfile(userId: string): Promise<Array<{
  category: string;
  factKey: string;
  factValue: string;
  confidence: number;
  updatedAt: Date;
}>> {
  const memories = await prisma.userMemory.findMany({
    where: { userId },
    orderBy: { updatedAt: 'desc' },
  });

  return memories.map((m) => ({
    category: m.category,
    factKey: m.factKey,
    factValue: decrypt(m.factValue),
    confidence: m.confidence,
    updatedAt: m.updatedAt,
  }));
}

/**
 * Format user memory into a concise string for prompt injection (~150 words).
 * Returns null if no memories exist (first session).
 */
export async function formatMemoryForPrompt(userId: string): Promise<string | null> {
  const memories = await prisma.userMemory.findMany({
    where: { userId },
    orderBy: [{ confidence: 'desc' }, { updatedAt: 'desc' }],
    take: 12, // Cap to keep prompt short
  });

  if (memories.length === 0) return null;

  // Get session count for context
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { totalSessionCount: true, lastSessionAt: true },
  });

  const grouped: Record<string, string[]> = {};
  for (const m of memories) {
    const label = categoryLabel(m.category);
    if (!grouped[label]) grouped[label] = [];
    try {
      grouped[label].push(decrypt(m.factValue));
    } catch {
      // Skip decryption failures
    }
  }

  const lines: string[] = [];

  if (user?.totalSessionCount && user.totalSessionCount > 0) {
    const sessionWord = user.totalSessionCount === 1 ? 'past session' : 'past sessions';
    lines.push(`User Profile (from ${user.totalSessionCount} ${sessionWord}):`);
  }

  for (const [label, values] of Object.entries(grouped)) {
    lines.push(`- ${label}: ${values.join('; ')}`);
  }

  if (user?.lastSessionAt) {
    const daysSince = Math.floor((Date.now() - user.lastSessionAt.getTime()) / (1000 * 60 * 60 * 24));
    if (daysSince > 0) {
      lines.push(`- Last session: ${daysSince} days ago`);
    }
  }

  return lines.join('\n');
}

/**
 * Delete all user memories (GDPR /delete_my_data).
 */
export async function deleteUserMemories(userId: string): Promise<number> {
  const result = await prisma.userMemory.deleteMany({
    where: { userId },
  });
  logger.info('User memories deleted (GDPR)', { userId, count: result.count });
  return result.count;
}

function categoryLabel(category: string): string {
  switch (category) {
    case 'attachment_style': return 'Pattern';
    case 'family_context': return 'Family';
    case 'recurring_topic': return 'Recurring';
    case 'communication_pattern': return 'Communication';
    case 'preference': return 'Preference';
    default: return 'Other';
  }
}
