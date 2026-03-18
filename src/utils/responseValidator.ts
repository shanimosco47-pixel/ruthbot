import type { ConversationMessage } from '../types';

// ============================================
// RUTH V3 — Response Quality Validator
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
export function checkResponseQuality(response: string, riskLevel?: string): string {
  let cleaned = response;

  // Enforce forbidden architecture phrases — replace with correct explanation
  cleaned = replaceForbiddenPhrases(cleaned);

  // L4 safety responses skip word limit and question rules (safety > formatting)
  if (riskLevel === 'L4') {
    return cleaned;
  }

  // Enforce single question rule: keep only the first question (explicit ? or implicit imperative)
  const explicitQuestionCount = (cleaned.match(/\?/g) || []).length;
  const implicitQuestionCount = countImplicitQuestions(cleaned);
  const totalQuestionCount = explicitQuestionCount + implicitQuestionCount;
  if (totalQuestionCount > MAX_QUESTIONS) {
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
  /^הסבר/,
  /^הסביר/,
  /^תגיד/,
  /^תגידי/,
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
 * Count implicit questions (Hebrew imperatives) in text.
 * Splits by sentence boundaries and checks each non-explicit-question sentence.
 */
function countImplicitQuestions(text: string): number {
  const sentences = text.split(/(?<=\?|!|\.)\s*/);
  let count = 0;
  for (const sentence of sentences) {
    const trimmed = sentence.trim();
    if (!trimmed) continue;
    if (trimmed.includes('?')) continue; // explicit question, counted separately
    if (isImplicitQuestion(trimmed)) count++;
  }
  return count;
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
// Meta-Feedback Detection (RC3)
// ============================================

// Phrases that indicate the user is talking ABOUT the bot, not about their relationship.
// These should be routed differently — acknowledged, not treated as therapy content.
const META_FEEDBACK_PHRASES = [
  'את לא עוזרת',
  'אתה לא עוזר',
  'הבוט לא עוזר',
  'לא מבין אותי',
  'לא מבינה אותי',
  'את לא מבינה',
  'אתה לא מבין',
  'תפסיקי לשאול',
  'תפסיק לשאול',
  'שאלות טיפשיות',
  'חוזרת על עצמך',
  'חוזר על עצמך',
  'כבר אמרתי',
  'כבר הסברתי',
  'זה לא מה ששאלתי',
  'לא עונה לי',
  'לא עונה על השאלה',
  'זה לא רלוונטי למה שאמרתי',
  'את בוט',
  'אתה בוט',
  'דברי כמו בן אדם',
  'תדבר כמו בן אדם',
  'מרגיש כמו רובוט',
  'שיחה עם קיר',
  // System/meta questions — user asking about how the bot works, not about relationship
  'מה קורה פה',
  'מה זה הדבר הזה',
  'איך זה עובד',
  'איך את עובדת',
  'איך אתה עובד',
  'לא אמור',
  'לא אמורה',
  'לא אמורים',
  'מה הסשן הזה',
  'מה זה סשן',
  'מה זה סשיין',
  'למה שלחת',
  'למה שלחתי',
  'מה זאת אומרת',
  'לא הצטרף',
  'לא הצטרפה',
  'להצטרף לסשן',
  'להצטרף לסשיין',
  'מי אמור',
  'מי אמורה',
];

const META_FEEDBACK_WORD_TRIGGERS = [
  'רובוט',
  'בוט',
];

/**
 * RC3: Detect if user is giving feedback about the bot itself
 * (not about their relationship). These messages need different handling.
 */
export function detectMetaFeedback(userMessage: string): boolean {
  const normalized = userMessage.trim();

  if (META_FEEDBACK_PHRASES.some((phrase) => normalized.includes(phrase))) {
    return true;
  }

  const words = normalized.split(/[\s,.\-!?;:]+/).filter((w) => w.length > 0);
  return META_FEEDBACK_WORD_TRIGGERS.some((trigger) =>
    words.includes(trigger) && (normalized.includes('לא') || normalized.includes('אל'))
  );
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
  'לא מעניין אותי',
  'בזבוז זמן',
  'אני לא צריך את זה',
  'אני לא צריכה את זה',
  'לא בא לי',
];

// Short word triggers: require word boundary to avoid false positives
// (e.g., "בדיוק" should NOT match "די")
const FRUSTRATION_WORD_TRIGGERS = [
  'עזבי',
  'די',
  'תפסיקי',
  'תפסיק',
  'עזוב',
  'חלאס',
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

// RC4: Emotion/content indicators that suggest user has shared enough to draft
const EMOTION_INDICATORS = /מרגיש|מפחד|כואב|עצוב|בודד|נפגע|כעוס|מאוכזב|פוחד|חוששת|לב שלי|קשה לי|שבור|עייף|נשבר|מתביישת|אשמה|חסר לי/;
const EVENT_INDICATORS = /אמר לי|עשה|עשתה|קרה|היה|אמרה|הייתי|אתמול|היום|בבוקר|בלילה|כשהוא|כשהיא|כש/;

/**
 * Determine if Ruth should generate a message draft instead of continuing intake.
 *
 * RC4 FIX: Content-aware — requires BOTH an event AND emotional content
 * before drafting. Pure turn count alone triggers only at turn 8 (hard cap).
 * This prevents premature drafting when user only shared surface-level info.
 */
export function shouldGenerateDraft(
  turnCount: number,
  conversationHistory: ConversationMessage[],
  currentRole: string
): boolean {
  const userMessages = conversationHistory
    .filter((m) => m.role === currentRole)
    .map((m) => m.content)
    .join(' ');

  const hasSubstantialContent = userMessages.length > 100;
  const hasMentionedGoal = /רוצה|צריך|חשוב לי|מבקש|אני מקווה/i.test(userMessages);
  const hasEmotionalContent = EMOTION_INDICATORS.test(userMessages);
  const hasEventContent = EVENT_INDICATORS.test(userMessages);

  // Hard cap: always draft by turn 8 (avoidant delay from systemPrompts)
  if (turnCount >= 7) return true;

  // Content-ready: user shared event + emotion + goal — draft at turn 5+
  if (turnCount >= 5 && hasSubstantialContent && hasEmotionalContent && (hasMentionedGoal || hasEventContent)) {
    return true;
  }

  // Soft trigger: turn 6+ with event OR emotion (not just turn count)
  if (turnCount >= 6 && hasSubstantialContent && (hasEmotionalContent || hasEventContent)) {
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
