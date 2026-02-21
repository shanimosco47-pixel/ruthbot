import type { ConversationMessage } from '../types';

// ============================================
// RUTH V2 — Response Quality Validator
// ============================================

const MAX_WORDS = 55;
const MAX_QUESTIONS = 1;

/**
 * Enforce word limit + one-question rule on Ruth's response.
 * Returns cleaned response text.
 */
export function checkResponseQuality(response: string): string {
  let cleaned = response;

  // Enforce single question rule: keep only the first question mark sentence
  const questionCount = (cleaned.match(/\?/g) || []).length;
  if (questionCount > MAX_QUESTIONS) {
    cleaned = removeExtraQuestions(cleaned);
  }

  // Log warning if over word limit (system prompt should handle this, but double-check)
  const wordCount = cleaned.split(/\s+/).filter((w) => w.length > 0).length;
  if (wordCount > MAX_WORDS * 1.5) {
    // If drastically over limit, truncate to reasonable length
    cleaned = truncateToWordLimit(cleaned, MAX_WORDS + 20);
  }

  return cleaned;
}

/**
 * Remove all questions except the first one.
 * Splits by sentences and keeps only the first sentence that contains '?'.
 */
function removeExtraQuestions(text: string): string {
  // Split by newlines first, then process each line
  const lines = text.split('\n');
  let foundFirstQuestion = false;
  const resultLines: string[] = [];

  for (const line of lines) {
    if (line.includes('?')) {
      if (!foundFirstQuestion) {
        resultLines.push(line);
        foundFirstQuestion = true;
      }
      // Skip subsequent lines with questions
    } else {
      resultLines.push(line);
    }
  }

  return resultLines.join('\n').trim();
}

/**
 * Truncate text to approximately N words while preserving sentence boundaries.
 */
function truncateToWordLimit(text: string, maxWords: number): string {
  const words = text.split(/\s+/);
  if (words.length <= maxWords) return text;

  // Find the last sentence boundary before the word limit
  const truncated = words.slice(0, maxWords).join(' ');
  const lastPeriod = Math.max(truncated.lastIndexOf('.'), truncated.lastIndexOf('?'), truncated.lastIndexOf('!'));

  if (lastPeriod > truncated.length * 0.5) {
    return truncated.slice(0, lastPeriod + 1);
  }

  return truncated;
}

// ============================================
// Frustration Detection
// ============================================

const FRUSTRATION_TRIGGERS = [
  'נמאס',
  'זה לא עוזר',
  'אני פורש',
  'עזבי',
  'די',
  'מהשיחה איתך',
  'לא רלוונטי',
  'תפסיקי',
  'עזוב',
  'חבל על הזמן',
  'זה לא בשבילי',
  'אני לא מבין מה את רוצה',
  'אין טעם',
];

/**
 * Detect if user is frustrated based on trigger words/phrases.
 */
export function detectFrustration(userMessage: string): boolean {
  const normalized = userMessage.trim().toLowerCase();
  return FRUSTRATION_TRIGGERS.some((trigger) => normalized.includes(trigger));
}

/**
 * Return a 3-option frustration menu instead of more therapy questions.
 */
export function getFrustrationMenu(): string {
  return `אני רואה שזה מתיש. בוא ננסה אחרת.

בחר אחד:
1\u20E3 ניסוח התנצלות קצר
2\u20E3 ניסוח גבול (בלי התנצלות)
3\u20E3 כלל לעתיד

איזה מהם?`;
}

// ============================================
// Draft Generation Trigger
// ============================================

/**
 * Calculate user turn count from conversation history.
 * A "turn" = one user message (not bot responses).
 */
export function getUserTurnCount(history: ConversationMessage[], currentRole: string): number {
  return history.filter((m) => m.role === currentRole).length;
}

/**
 * Determine if Ruth should generate a message draft instead of continuing intake.
 * Triggers at turn 5+ or when user provides clear event + goal.
 */
export function shouldGenerateDraft(
  turnCount: number,
  conversationHistory: ConversationMessage[],
  currentRole: string
): boolean {
  // Always draft by turn 5
  if (turnCount >= 4) return true;

  // Check if user already provided enough info (event + goal in their messages)
  const userMessages = conversationHistory
    .filter((m) => m.role === currentRole)
    .map((m) => m.content)
    .join(' ');

  const hasSubstantialContent = userMessages.length > 100;
  const hasMentionedGoal = /רוצה|צריך|חשוב לי|מבקש|אני מקווה/i.test(userMessages);

  // Draft early if user gave clear content + goal
  if (turnCount >= 3 && hasSubstantialContent && hasMentionedGoal) {
    return true;
  }

  return false;
}

// ============================================
// Message Templates
// ============================================

export type MessageTemplate = 'apology' | 'boundary' | 'future_rule';

const MESSAGE_TEMPLATES: Record<MessageTemplate, string> = {
  apology: `מצטער שלא שמתי לב. זה לא היה מזלזול, נשאבתי למשהו.
חשוב לי שלא תרגישי לבד.`,

  boundary: `מצטער שלא עזרתי. לא התכוונתי לזלזול.
אם את צריכה עזרה, תגידי לי בזמן אמת.
אני רוצה שנהיה צוות.`,

  future_rule: `נראה שאנחנו נתקעים בנקודה הזו.
בוא נקבע כלל: אם את צריכה עזרה, תגידי לי ישר.
ואני מצידי אבדוק מה קורה סביבי.`,
};

/**
 * Get a message template by type.
 */
export function getMessageTemplate(type: MessageTemplate): string {
  return MESSAGE_TEMPLATES[type];
}

/**
 * Select template based on user goal / frustration.
 */
export function selectTemplate(isFrustrated: boolean, userGoal: string): MessageTemplate {
  if (isFrustrated) return 'apology';
  if (/התנצלות|סליחה|מצטער/i.test(userGoal)) return 'apology';
  if (/גבול|כלל|עתיד|להבא/i.test(userGoal)) return 'future_rule';
  return 'boundary'; // safe default
}
