// Topic Categories — closed enum as defined in PRD Addendum 2.8
export const TOPIC_CATEGORIES = [
  'עומס וחלוקת אחריות',
  'תקשורת ורגש',
  'זמן ואיכות קשר',
  'כסף והתנהלות כלכלית',
  'גבולות ומרחב אישי',
  'הורות ומשפחה',
  'משהו שחשוב לי לשתף', // fallback
] as const;

export type TopicCategory = (typeof TOPIC_CATEGORIES)[number];

export const FALLBACK_TOPIC_CATEGORY: TopicCategory = 'משהו שחשוב לי לשתף';

// Risk Levels
export const RISK_LEVELS = ['L1', 'L2', 'L3', 'L3_PLUS', 'L4'] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];

// Mirror Quality
export const MIRROR_QUALITIES = ['GOOD', 'PARTIAL', 'MISSED'] as const;
export type MirrorQuality = (typeof MIRROR_QUALITIES)[number];

// Session Status transitions (valid transitions map)
export const VALID_TRANSITIONS: Record<string, string[]> = {
  INVITE_CRAFTING: ['INVITE_PENDING', 'ASYNC_COACHING', 'CLOSED'],
  INVITE_PENDING: ['PENDING_PARTNER_CONSENT', 'INVITE_CRAFTING', 'ASYNC_COACHING', 'CLOSED'],
  PENDING_PARTNER_CONSENT: ['REFLECTION_GATE', 'PARTNER_DECLINED'],
  REFLECTION_GATE: ['ACTIVE'],
  ACTIVE: ['PAUSED', 'CLOSED', 'LOCKED'],
  ASYNC_COACHING: ['INVITE_CRAFTING', 'INVITE_PENDING', 'ACTIVE', 'CLOSED'],
  PAUSED: ['ACTIVE', 'CLOSED'],
  CLOSED: ['LOCKED'],
  LOCKED: [], // terminal
  PARTNER_DECLINED: ['INVITE_CRAFTING', 'INVITE_PENDING', 'ASYNC_COACHING', 'CLOSED'],
};

// Telegram constraints
export const TELEGRAM_MAX_MESSAGE_LENGTH = 4096;
export const TELEGRAM_MAX_INLINE_BUTTONS_PER_ROW = 8;
export const TELEGRAM_MAX_INLINE_ROWS = 8;
export const TELEGRAM_MAX_VOICE_SIZE_MB = 20;
export const TELEGRAM_DEEP_LINK_MAX_LENGTH = 64;

// Reframe flow
export const MAX_EDIT_ITERATIONS = 3;
export const MAX_REFLECTION_REPROMPTS = 2;

// Retry configuration
export const CLAUDE_MAX_RETRIES = 2;
export const CLAUDE_INITIAL_RETRY_DELAY_MS = 1000;
export const WHISPER_MAX_RETRIES = 1;

// TTL options in hours
export const TTL_OPTIONS = [1, 3, 12] as const;
export type TtlOption = (typeof TTL_OPTIONS)[number];

// Category resources for email
export const CATEGORY_RESOURCES: Record<TopicCategory, { title: string; url: string }> = {
  'עומס וחלוקת אחריות': {
    title: 'Fair Play: שיטת חלוקת העבודה ההוגנת',
    url: 'https://www.fairplaylife.com/',
  },
  'תקשורת ורגש': {
    title: 'ארבעת הפרשים של גוטמן — מדריך מעשי',
    url: 'https://www.gottman.com/blog/the-four-horsemen-recognizing-criticism-contempt-defensiveness-and-stonewalling/',
  },
  'זמן ואיכות קשר': {
    title: 'זמן איכות לעומת כמות — מה באמת חשוב?',
    url: 'https://www.gottman.com/blog/quality-vs-quantity/',
  },
  'כסף והתנהלות כלכלית': {
    title: 'שקיפות כלכלית בזוגיות — למה ואיך',
    url: 'https://www.gottman.com/blog/relationship-and-money/',
  },
  'גבולות ומרחב אישי': {
    title: 'דיפרנציאציה בזוגיות — דוד שנרך',
    url: 'https://www.psychologytoday.com/us/blog/intimacy-and-desire',
  },
  'הורות ומשפחה': {
    title: 'מחקר גוטמן — זוגיות אחרי ילדים',
    url: 'https://www.gottman.com/blog/relationship-after-baby/',
  },
  'משהו שחשוב לי לשתף': {
    title: 'מהו דיאלוג אימגו? מדריך קצר',
    url: 'https://imagorelationshipswork.com/',
  },
};

// Emergency resources
export const EMERGENCY_RESOURCES = {
  he: {
    crisis_line: "ער\"ן — קו סיוע רגשי: 1201",
    violence_line: 'קו חירום לאלימות במשפחה: 118',
    suicide_line: 'קו חיים למניעת התאבדות: *6785',
  },
  en: {
    crisis_line: 'Crisis Text Line: Text HOME to 741741',
    violence_line: 'National Domestic Violence Hotline: 1-800-799-7233',
    suicide_line: 'National Suicide Prevention Lifeline: 988',
  },
  ar: {
    crisis_line: "ער\"ן — خط مساعدة عاطفي: 1201",
    violence_line: 'خط طوارئ العنف الأسري: 118',
    suicide_line: 'خط الحياة لمنع الانتحار: *6785',
  },
};
