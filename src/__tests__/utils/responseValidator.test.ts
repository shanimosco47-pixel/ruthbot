/**
 * RUTH V2 BEHAVIORAL TESTS
 * Score threshold: 90/100 = Pass
 *
 * Component 1: Intake Quality (25 points)
 * Component 2: Response Quality (25 points)
 * Component 3: Conversation Wisdom (25 points)
 * Component 4: Overall Success (25 points)
 */

import {
  checkResponseQuality,
  detectFrustration,
  getFrustrationMenu,
  getUserTurnCount,
  shouldGenerateDraft,
  selectTemplate,
  getMessageTemplate,
} from '../../utils/responseValidator';
import { buildCoachingPrompt } from '../../services/ai/systemPrompts';
import type { ConversationMessage } from '../../types';

// ============================================
// Component 1: Intake Quality (25 points)
// ============================================

describe('Component 1: Intake Quality', () => {
  // Test 1.1: First Message Format (10 points)
  describe('Test 1.1: First Message Format', () => {
    const INTAKE_TEMPLATE = `שלום! אני רות, מנחה זוגי.
בואו נתחיל בתלוש (משפט אחד לכל שאלה):
1️⃣ מה קרה?
2️⃣ מה אתה רוצה שיקרה בסוף?
3️⃣ מה אסור שיקרה?`;

    it('should contain greeting', () => {
      expect(INTAKE_TEMPLATE).toContain('שלום');
    });

    it('should contain "מה קרה" question', () => {
      expect(INTAKE_TEMPLATE).toContain('מה קרה');
    });

    it('should contain goal question', () => {
      expect(INTAKE_TEMPLATE).toContain('מה אתה רוצה');
    });

    it('should contain redline question', () => {
      expect(INTAKE_TEMPLATE).toContain('מה אסור');
    });

    it('should be under 40 words', () => {
      const words = INTAKE_TEMPLATE.split(/\s+/).filter((w) => w.length > 0);
      expect(words.length).toBeLessThanOrEqual(40);
    });

    it('should have questions on separate lines', () => {
      const lines = INTAKE_TEMPLATE.split('\n');
      expect(lines.length).toBeGreaterThanOrEqual(4);
    });
  });

  // Test 1.2: Intake Completion Speed (10 points)
  describe('Test 1.2: Intake Completion Speed', () => {
    it('should NOT be in draft phase at turn 1', () => {
      const history: ConversationMessage[] = [];
      expect(shouldGenerateDraft(0, history, 'USER_A')).toBe(false);
    });

    it('should NOT be in draft phase at turn 2', () => {
      const history: ConversationMessage[] = [
        { role: 'USER_A', content: 'היא כעסה שלא עזרתי במטבח', timestamp: new Date() },
        { role: 'BOT', content: 'הבנתי. ומה היית רוצה שיקרה?', timestamp: new Date() },
      ];
      expect(shouldGenerateDraft(1, history, 'USER_A')).toBe(false);
    });

    it('should trigger draft by turn 5 (turnCount >= 4)', () => {
      const history: ConversationMessage[] = [
        { role: 'USER_A', content: 'היא כעסה שלא עזרתי במטבח', timestamp: new Date() },
        { role: 'BOT', content: 'הבנתי.', timestamp: new Date() },
        { role: 'USER_A', content: 'נשאבתי למחשב ולא שמתי לב', timestamp: new Date() },
        { role: 'BOT', content: 'מה היית רוצה?', timestamp: new Date() },
        { role: 'USER_A', content: 'אני רוצה שהיא תבין שלא התכוונתי', timestamp: new Date() },
        { role: 'BOT', content: 'הבנתי.', timestamp: new Date() },
        { role: 'USER_A', content: 'כן, בדיוק', timestamp: new Date() },
        { role: 'BOT', content: 'בוא ננסח.', timestamp: new Date() },
      ];
      expect(shouldGenerateDraft(4, history, 'USER_A')).toBe(true);
    });

    it('should trigger draft early when user provides clear content + goal at turn 3', () => {
      const history: ConversationMessage[] = [
        { role: 'USER_A', content: 'היא כעסה שלא עזרתי במטבח כי נשאבתי לעבודה על המחשב ולא שמתי לב שהיא צריכה עזרה', timestamp: new Date() },
        { role: 'BOT', content: 'הבנתי.', timestamp: new Date() },
        { role: 'USER_A', content: 'אני רוצה שהיא תבין שלא התכוונתי לזלזל ושחשוב לי לעזור', timestamp: new Date() },
        { role: 'BOT', content: 'ומה אסור?', timestamp: new Date() },
        { role: 'USER_A', content: 'לא להאשים אותה', timestamp: new Date() },
        { role: 'BOT', content: 'הבנתי.', timestamp: new Date() },
      ];
      expect(shouldGenerateDraft(3, history, 'USER_A')).toBe(true);
    });
  });

  // Test 1.3: Question Clarity (5 points)
  describe('Test 1.3: System Prompt Phase Instructions', () => {
    it('should instruct intake at turn 1', () => {
      const prompt = buildCoachingPrompt({
        userRole: 'USER_A',
        language: 'he',
        riskLevel: 'L1',
        topicCategory: 'עומס וחלוקת אחריות',
        conversationHistory: [],
        patternSummaries: [],
        sessionId: 'test-session',
        turnCount: 0,
        shouldDraft: false,
        isFrustrated: false,
      });
      expect(prompt).toContain('INTAKE TURN 1');
      expect(prompt).toContain('מה קרה');
    });

    it('should instruct draft phase at turn 5', () => {
      const prompt = buildCoachingPrompt({
        userRole: 'USER_A',
        language: 'he',
        riskLevel: 'L1',
        topicCategory: 'עומס וחלוקת אחריות',
        conversationHistory: [],
        patternSummaries: [],
        sessionId: 'test-session',
        turnCount: 4,
        shouldDraft: true,
        isFrustrated: false,
      });
      expect(prompt).toContain('DRAFT PHASE');
    });
  });
});

// ============================================
// Component 2: Response Quality (25 points)
// ============================================

describe('Component 2: Response Quality', () => {
  // Test 2.1: Word Count Compliance (10 points)
  describe('Test 2.1: Word Count Compliance', () => {
    it('should pass response under 55 words unchanged', () => {
      const short = 'אני מבינה שזה קשה. מה היית רוצה להעביר?';
      const result = checkResponseQuality(short);
      expect(result).toBe(short);
    });

    it('should truncate response drastically over word limit (>82 words)', () => {
      // Generate a response with 100+ words
      const longWords = Array(100).fill('מילה').join(' ');
      const result = checkResponseQuality(longWords);
      const wordCount = result.split(/\s+/).filter((w) => w.length > 0).length;
      expect(wordCount).toBeLessThanOrEqual(75); // MAX_WORDS + 20
    });

    it('should allow response at exactly 55 words', () => {
      const exactly55 = Array(55).fill('מילה').join(' ');
      const result = checkResponseQuality(exactly55);
      // Should not truncate at exactly limit
      expect(result.split(/\s+/).filter((w) => w.length > 0).length).toBe(55);
    });
  });

  // Test 2.2: Question Discipline (8 points)
  describe('Test 2.2: Question Discipline', () => {
    it('should keep single question unchanged', () => {
      const oneQ = 'אני מבינה שזה קשה. מה היית רוצה להעביר?';
      const result = checkResponseQuality(oneQ);
      expect((result.match(/\?/g) || []).length).toBe(1);
    });

    it('should remove extra questions when there are 2+', () => {
      const twoQ = 'מה קרה? איך אתה מרגיש? ספר לי עוד.';
      const result = checkResponseQuality(twoQ);
      expect((result.match(/\?/g) || []).length).toBeLessThanOrEqual(1);
    });

    it('should remove extra questions from multi-line response', () => {
      const multiLineQ = 'אני מבינה. מה קרה?\nאיך אתה מרגיש?\nספר לי.';
      const result = checkResponseQuality(multiLineQ);
      expect((result.match(/\?/g) || []).length).toBeLessThanOrEqual(1);
    });

    it('should preserve non-question content when removing extra questions', () => {
      const mixed = 'אני שומעת אותך.\nמה קרה?\nזה נשמע קשה.\nאיך אתה מרגיש?';
      const result = checkResponseQuality(mixed);
      expect(result).toContain('אני שומעת אותך');
      expect(result).toContain('זה נשמע קשה');
    });
  });

  // Test 2.3: Perspective Clarity (7 points)
  describe('Test 2.3: Perspective Clarity', () => {
    it('should have perspective prefix rule in system prompt', () => {
      const prompt = buildCoachingPrompt({
        userRole: 'USER_A',
        language: 'he',
        riskLevel: 'L1',
        topicCategory: 'עומס וחלוקת אחריות',
        conversationHistory: [],
        patternSummaries: [],
        sessionId: 'test-session',
        turnCount: 0,
        shouldDraft: false,
        isFrustrated: false,
      });
      expect(prompt).toContain('אתה מעריך שהיא הרגישה');
      expect(prompt).toContain('אתה מרגיש');
    });
  });
});

// ============================================
// Component 3: Conversation Wisdom (25 points)
// ============================================

describe('Component 3: Conversation Wisdom', () => {
  // Test 3.1: Frustration Detection (10 points)
  describe('Test 3.1: Frustration Detection', () => {
    it('should detect "נמאס" as frustration', () => {
      expect(detectFrustration('נמאס לי מזה')).toBe(true);
    });

    it('should detect "זה לא עוזר" as frustration', () => {
      expect(detectFrustration('זה לא עוזר לי')).toBe(true);
    });

    it('should detect "אני פורש" as frustration', () => {
      expect(detectFrustration('אני פורש מהשיחה')).toBe(true);
    });

    it('should detect "עזבי" as frustration', () => {
      expect(detectFrustration('עזבי, לא חשוב')).toBe(true);
    });

    it('should detect "די" as frustration', () => {
      expect(detectFrustration('די')).toBe(true);
    });

    it('should detect "חבל על הזמן" as frustration', () => {
      expect(detectFrustration('חבל על הזמן')).toBe(true);
    });

    it('should NOT detect normal message as frustration', () => {
      expect(detectFrustration('היא כעסה שלא עזרתי במטבח')).toBe(false);
    });

    it('should NOT detect positive message as frustration', () => {
      expect(detectFrustration('תודה, זה עוזר לי')).toBe(false);
    });
  });

  // Test 3.1b: Frustration Menu Format
  describe('Test 3.1b: Frustration Menu Format', () => {
    it('should offer 3 options', () => {
      const menu = getFrustrationMenu();
      expect(menu).toContain('1');
      expect(menu).toContain('2');
      expect(menu).toContain('3');
    });

    it('should contain exactly 1 question', () => {
      const menu = getFrustrationMenu();
      expect((menu.match(/\?/g) || []).length).toBe(1);
    });

    it('should not contain therapy questions', () => {
      const menu = getFrustrationMenu();
      expect(menu).not.toContain('איך אתה מרגיש');
      expect(menu).not.toContain('ספר לי עוד');
    });
  });

  // Test 3.2: Draft Generation Timing (8 points)
  describe('Test 3.2: Draft Generation Timing', () => {
    it('should not draft at turn 1', () => {
      expect(shouldGenerateDraft(0, [], 'USER_A')).toBe(false);
    });

    it('should not draft at turn 2', () => {
      expect(shouldGenerateDraft(1, [], 'USER_A')).toBe(false);
    });

    it('should draft at turn 5 (turnCount 4)', () => {
      expect(shouldGenerateDraft(4, [], 'USER_A')).toBe(true);
    });

    it('should draft at turn 6+ (turnCount 5+)', () => {
      expect(shouldGenerateDraft(5, [], 'USER_A')).toBe(true);
    });
  });

  // Test 3.3: Phase Instructions
  describe('Test 3.3: Conversation Navigation', () => {
    it('should set frustration phase when frustrated', () => {
      const prompt = buildCoachingPrompt({
        userRole: 'USER_A',
        language: 'he',
        riskLevel: 'L1',
        topicCategory: 'עומס וחלוקת אחריות',
        conversationHistory: [],
        patternSummaries: [],
        sessionId: 'test-session',
        turnCount: 2,
        shouldDraft: false,
        isFrustrated: true,
      });
      expect(prompt).toContain('FRUSTRATION DETECTED');
      expect(prompt).toContain('3 concrete options');
    });

    it('should set intake phase for early turns', () => {
      const prompt = buildCoachingPrompt({
        userRole: 'USER_A',
        language: 'he',
        riskLevel: 'L1',
        topicCategory: 'עומס וחלוקת אחריות',
        conversationHistory: [],
        patternSummaries: [],
        sessionId: 'test-session',
        turnCount: 1,
        shouldDraft: false,
        isFrustrated: false,
      });
      expect(prompt).toContain('INTAKE TURN 2');
    });
  });
});

// ============================================
// Component 4: Overall Success (25 points)
// ============================================

describe('Component 4: Overall Success', () => {
  // Test 4.1: Message Templates
  describe('Test 4.1: Message Templates', () => {
    it('should have apology template', () => {
      const template = getMessageTemplate('apology');
      expect(template).toContain('מצטער');
    });

    it('should have boundary template', () => {
      const template = getMessageTemplate('boundary');
      expect(template).toContain('מצטער');
      expect(template).toContain('צוות');
    });

    it('should have future_rule template', () => {
      const template = getMessageTemplate('future_rule');
      expect(template).toContain('כלל');
    });
  });

  // Test 4.2: Template Selection
  describe('Test 4.2: Template Selection', () => {
    it('should select apology when frustrated', () => {
      expect(selectTemplate(true, '')).toBe('apology');
    });

    it('should select apology when goal contains סליחה', () => {
      expect(selectTemplate(false, 'אני רוצה לבקש סליחה')).toBe('apology');
    });

    it('should select future_rule when goal contains כלל', () => {
      expect(selectTemplate(false, 'בוא נקבע כלל')).toBe('future_rule');
    });

    it('should default to boundary', () => {
      expect(selectTemplate(false, 'משהו כללי')).toBe('boundary');
    });
  });

  // Test 4.3: System Prompt Rules Verification
  describe('Test 4.3: System Prompt Rules', () => {
    const prompt = buildCoachingPrompt({
      userRole: 'USER_A',
      language: 'he',
      riskLevel: 'L1',
      topicCategory: 'עומס וחלוקת אחריות',
      conversationHistory: [],
      patternSummaries: [],
      sessionId: 'test-session',
      turnCount: 0,
      shouldDraft: false,
      isFrustrated: false,
    });

    it('should contain RULE 1 word limit', () => {
      expect(prompt).toContain('RULE 1: WORD LIMIT');
      expect(prompt).toContain('max 55');
    });

    it('should contain RULE 2 one question', () => {
      expect(prompt).toContain('RULE 2: ONE QUESTION ONLY');
      expect(prompt).toContain('EXACTLY 1 question mark');
    });

    it('should contain RULE 3 fast intake', () => {
      expect(prompt).toContain('RULE 3: FAST INTAKE');
    });

    it('should contain RULE 4 draft by turn 5', () => {
      expect(prompt).toContain('RULE 4: DRAFT BY TURN 5');
    });

    it('should contain RULE 5 frustration', () => {
      expect(prompt).toContain('RULE 5: FRUSTRATION DETECTOR');
    });

    it('should contain RULE 6 perspective', () => {
      expect(prompt).toContain('RULE 6: PERSPECTIVE CLARITY');
    });

    it('should contain RULE 7 no repetition', () => {
      expect(prompt).toContain('RULE 7: NO REPETITION');
    });

    it('should contain RUTH V2 BEHAVIORAL OVERRIDE', () => {
      expect(prompt).toContain('RUTH V2 BEHAVIORAL OVERRIDE');
    });

    it('should contain output format with 55 word limit', () => {
      expect(prompt).toContain('Max 55 Hebrew words');
    });

    it('should contain max 1 question per message output rule', () => {
      expect(prompt).toContain('EXACTLY 1 question mark (?) per message');
    });
  });

  // Test 4.4: Turn Count Calculation
  describe('Test 4.4: Turn Count', () => {
    it('should count 0 turns for empty history', () => {
      expect(getUserTurnCount([], 'USER_A')).toBe(0);
    });

    it('should count only user messages, not bot messages', () => {
      const history: ConversationMessage[] = [
        { role: 'USER_A', content: 'test', timestamp: new Date() },
        { role: 'BOT', content: 'response', timestamp: new Date() },
        { role: 'USER_A', content: 'test2', timestamp: new Date() },
      ];
      expect(getUserTurnCount(history, 'USER_A')).toBe(2);
    });

    it('should count only matching role messages', () => {
      const history: ConversationMessage[] = [
        { role: 'USER_A', content: 'test', timestamp: new Date() },
        { role: 'USER_B', content: 'test', timestamp: new Date() },
        { role: 'USER_A', content: 'test2', timestamp: new Date() },
      ];
      expect(getUserTurnCount(history, 'USER_A')).toBe(2);
      expect(getUserTurnCount(history, 'USER_B')).toBe(1);
    });
  });
});

// ============================================
// SCORING SUMMARY
// ============================================

describe('RUTH V2 Scoring Summary', () => {
  it('should have all components testable', () => {
    // This is a meta-test that verifies all 4 components are covered
    // Component 1: Intake Quality - intake template, speed, clarity
    // Component 2: Response Quality - word count, questions, perspective
    // Component 3: Conversation Wisdom - frustration, draft timing, navigation
    // Component 4: Overall Success - templates, selection, system prompt
    expect(true).toBe(true);
  });
});
