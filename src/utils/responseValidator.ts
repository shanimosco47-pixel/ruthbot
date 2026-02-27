import type { ConversationMessage } from '../types';

// ============================================
// RUTH V2 — Response Quality Validator
// ============================================

const MAX_WORDS = 55;
const MAX_QUESTIONS = 1;

// Forbidden phrases that misrepresent the two-separate-chats architecture.
// If Claude generates any of these, they are replaced with the correct explanation.
const FORBIDDEN_ARCHITECTURE_PHRASES = [
  'קבוצה משותפת',
  'תהיו יחד',
  'שניכם ביחד',
  'שיחה משותפת',
  'צ\'אט משותף',
  'שניכם בשיחה אחת',
  'שניהם יחד',
  'שניכם יחד',
  'שניהם בשיחה',
  'שניכם בשיחה',
  'ביחד בקבוצה',
  'יחד בקבוצה',
  'בצ\'אט אחד',
  'בשיחה אחת',
];

const ARCHITECTURE_CORRECTION = 'כל אחד מדבר איתי בצ\'אט פרטי נפרד. אף אחד לא רואה מה השני כותב. אני המתווכת — עוזרת לנסח ומעבירה רק מה שאושר.';

/**
 * Enforce word limit + one-question rule + forbidden phrases on Ruth's response.
 * Returns cleaned response text.
 */
export function checkResponseQuality(response: string): string {
  let cleaned = response;

  // Enforce forbidden architecture phrases — replace with correct explanation
  cleaned = replaceForbiddenPhrases(cleaned);

  // Enforce single question rule: keep only the first question mark sentence
  const questionCount = (cleaned.match(/\?/g) || []).length;
  if (questionCount > MAX_QUESTIONS) {
    cleaned = removeExtraQuestions(cleaned);
  }

  // Enforce word limit — truncate any response over MAX_WORDS
  const wordCount = cleaned.split(/\s+/).filter((w) => w.length > 0).length;
  if (wordCount > MAX_WORDS) {
    cleaned = truncateToWordLimit(cleaned, MAX_WORDS);
  }

  return cleaned;
}

/**
 * Replace forbidden architecture phrases with the correct explanation.
 * Only replaces the first occurrence and appends the correction.
 */
function replaceForbiddenPhrases(text: string): string {
  for (const phrase of FORBIDDEN_ARCHITECTURE_PHRASES) {
    if (text.includes(phrase)) {
      // Find the sentence containing the forbidden phrase and replace it
      const sentences = text.split(/(?<=[.!?\n])\s*/);
      const correctedSentences = sentences.map((sentence) => {
        if (FORBIDDEN_ARCHITECTURE_PHRASES.some((p) => sentence.includes(p))) {
          return ARCHITECTURE_CORRECTION;
        }
        return sentence;
      });
      // Deduplicate if multiple sentences were corrected
      const seen = new Set<string>();
      const deduped = correctedSentences.filter((s) => {
        if (seen.has(s)) return false;
        seen.add(s);
        return true;
      });
      return deduped.join(' ').trim();
    }
  }
  return text;
}

// Hebrew imperative/request patterns that function as implicit questions.
// After the first explicit question (?), these are stripped to enforce the single-question rule.
const IMPLICIT_QUESTION_PATTERNS = [
  /^ספר/,
  /^שתף/,
  /^תאר/,
  /^תן/,
  /^תני/,
  /^בוא\/י/,
  /^בואי/,
  /^נסה/,
  /^נסי/,
  /^חשב/,
  /^חשבי/,
  /^דמיין/,
  /^דמייני/,
  /^שאל/,
  /^שאלי/,
  /^חפש/,
  /^חפשי/,
];

/**
 * Remove all questions except the first one.
 * Handles both explicit questions (?) and implicit Hebrew imperatives
 * that function as questions (e.g., "ספרי לי עוד", "שתף אותי").
 */
function removeExtraQuestions(text: string): string {
  // Split into sentences by common Hebrew/punctuation boundaries
  // Keeps the delimiter attached to the preceding sentence
  const sentences = text.split(/(?<=\?|!|\.)\s*/);
  let foundFirstQuestion = false;
  const resultSentences: string[] = [];

  for (const sentence of sentences) {
    const trimmed = sentence.trim();
    if (!trimmed) continue;

    const hasExplicitQuestion = trimmed.includes('?');
    const hasImplicitQuestion = !hasExplicitQuestion && isImplicitQuestion(trimmed);

    if (hasExplicitQuestion || hasImplicitQuestion) {
      if (!foundFirstQuestion) {
        resultSentences.push(trimmed);
        foundFirstQuestion = true;
      }
      // Skip subsequent sentences with questions (explicit or implicit)
    } else {
      resultSentences.push(trimmed);
    }
  }

  return resultSentences.join(' ').trim();
}

/**
 * Detect Hebrew imperative statements that function as implicit questions.
 * Example: "ספרי לי עוד" = "Tell me more" = implicit question.
 */
function isImplicitQuestion(sentence: string): boolean {
  const words = sentence.split(/\s+/);
  if (words.length === 0) return false;
  const firstWord = words[0];
  return IMPLICIT_QUESTION_PATTERNS.some((pattern) => pattern.test(firstWord));
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

// Multi-word triggers: safe to use substring matching
const FRUSTRATION_PHRASE_TRIGGERS = [
  'נמאס',
  'זה לא עוזר',
  'אני פורש',
  'מהשיחה איתך',
  'לא רלוונטי',
  'חבל על הזמן',
  'זה לא בשבילי',
  'אני לא מבין מה את רוצה',
  'אין טעם',
];

// Short word triggers: require word boundary to avoid false positives
// (e.g., "בדיוק" should NOT match "די")
const FRUSTRATION_WORD_TRIGGERS = [
  'עזבי',
  'די',
  'תפסיקי',
  'עזוב',
];

/**
 * Detect if user is frustrated based on trigger words/phrases.
 * Uses word-boundary matching for short triggers to avoid false positives.
 */
export function detectFrustration(userMessage: string): boolean {
  const normalized = userMessage.trim();

  // Check phrase triggers (substring match is safe for multi-word phrases)
  if (FRUSTRATION_PHRASE_TRIGGERS.some((trigger) => normalized.includes(trigger))) {
    return true;
  }

  // Check word triggers with word-boundary logic
  // Split message into words and check for exact matches
  const words = normalized.split(/[\s,.\-!?;:]+/).filter((w) => w.length > 0);
  return FRUSTRATION_WORD_TRIGGERS.some((trigger) => words.includes(trigger));
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
  if (/גבול|נקבע כלל|כלל לעתיד|עתיד|להבא/i.test(userGoal)) return 'future_rule';
  return 'boundary'; // safe default
}
