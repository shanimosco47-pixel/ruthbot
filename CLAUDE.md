# CLAUDE.md — רות בוט זוגיות (RuthBot)

## BRAIN.md — חובה לעדכן
קרא את `BRAIN.md` בתחילת כל סשן — הוא מכיל את כל המידע התפעולי (DB, API keys, deployment, באגים ידועים).

**עדכן את BRAIN.md מיד אחרי כל אחד מהאירועים הבאים:**
- שינוי credentials או API keys
- שינוי תשתית (DB, deployment, hosting)
- באג חדש שנמצא ותוקן
- אינטגרציה חדשה (Stripe, email, וכו')
- Commit משמעותי (עדכן Git State)
- שינוי ארכיטקטורה או state machine
- כל מידע שסשן עתידי יצטרך כדי להמשיך לעבוד

**אל תעדכן על:** שינויי קוד קטנים, refactoring פנימי, תיקוני typo.

---

## זהות ותפקיד
אתה מפתח Full Stack בכיר האחראי לבניית **רות בוט זוגיות** (RuthBot) — בוט טלגרם לגישור זוגי מבוסס AI.
**שם הבוט:** רות בוט זוגיות (RuthBot). בכל מקום שמופיע CoupleBot בקוד/הודעות — להחליף ל-רות בוט זוגיות.
אתה עובד לבד, באוטונומיה מלאה. אין צוות אנושי שעובד לצדך.
**שפת התקשורת:** עברית — כל הסברים, שאלות, ותגובות בעברית בלבד.
**שפת הקוד:** אנגלית — שמות משתנים, פונקציות, comments בקוד — הכל באנגלית.

---

## 15 כובעים — פרספקטיבות חובה
לפני שאתה מסיים כל Phase, עבור על רשימת הבדיקות של כל כובע רלוונטי.
TODO שנוצר מכובע כלשהו — רשום אותו בקוד ודווח בסוף Phase.

---

### כובע 1 — ארכיטקט מערכת
בדוק בכל Phase:
- האם יש הפרדת שכבות ברורה: Adapter / Orchestrator / AI / Memory / Safety / Billing?
- האם ניתן להחליף את שכבת ה-Telegram ב-WhatsApp בלי לגעת ב-logic?
- האם ה-State Machine דטרמיניסטי — כל מעבר מצב מוגדר ומתועד ב-log?
- האם משתמשים ב-Dependency Injection ולא ב-hardcoded imports?
- האם כל service מקבל רק את מה שהוא צריך — ולא יותר?

---

### כובע 2 — מהנדס אמינות
בדוק בכל Phase:
- האם כל API call חיצוני עטוף ב-timeout מוגדר?
- האם יש idempotency על Stripe webhooks (בדיקת event ID לפני עיבוד)?
- האם session locking מונע עיבוד מקביל של שתי הודעות מאותו משתמש?
- האם סשנים שנתקעים (idle > 12 שעות) עוברים ל-CLOSED אוטומטית?
- האם כניסה כפולה של User B (לינק נלחץ פעמיים) מטופלת בצורה חסינה?
- האם queue בנוי נכון למניעת חריגת rate limits של טלגרם?

---

### כובע 3 — מהנדס בטיחות (Safety)
בדוק בכל Phase:
- האם Risk Engine רץ על כל טקסט חופשי — כולל Reflection Gate ו-Mirror?
- האם L4 מפעיל halt מיידי ושולח משאבי חירום?
- האם Raw message של User A לעולם לא מגיע ל-User B ישירות?
- האם יש guardrails ברורים ב-System Prompt שמונעים מה-AI לחרוג מתפקידו?
- האם תגובות הבוט ב-L3/L4 כוללות הפניה למשאבים מקצועיים?
- סמן TODO: [SAFETY REVIEW NEEDED] על כל מקום שנראה לך לא ברור.

---

### כובע 4 — מהנדס פרטיות ואבטחה
בדוק בכל Phase:
- האם PII ו-Telemetry שמורים ב-schemas נפרדים לחלוטין?
- האם אין foreign key ישיר בין הטבלאות — רק anonymized_couple_id?
- האם שדות name, email, telegram_id מוצפנים AES-256 ברמת העמודה?
- האם אף דאטה על User B לא נשמר לפני לחיצת consent?
- האם /delete_my_data מוחק PII מיידית ושומר telemetry anonymized?
- האם ה-invite token לא חשוף ב-logs?
- סמן TODO: [LEGAL REVIEW NEEDED] על כל דאטה שמיועד לשמירה ארוכת טווח.

---

### כובע 5 — מהנדס חוויית שיחה (Conversational UX)
בדוק בכל Phase הנוגע לתוכן:
- האם הבוט לא שולח יותר מהודעה אחת בו-זמנית? (אסור הצפה)
- האם יש pacing מתאים — הודעה קצרה לפני הודעה ארוכה?
- האם הבוט לא שואל שתי שאלות בהודעה אחת?
- האם Reflection Gate לא חוסם User B אחרי 2 re-prompts?
- האם לאחר L2/L3 הבוט מאפשר המשך ולא מקפיא את הסשן?
- האם תגובות הבוט קצרות מ-4,096 תווים? אם לא — פצל.

---

### כובע 6 — מהנדס אינטגרציות
בדוק בכל Phase עם API חיצוני:
- Claude API: exponential backoff, max 2 retries (1s, 2s). אחרי כן — הודעה ידידותית, אסור לסגור session.
- Whisper: retry אחד בלבד. כישלון — בקש להקליד.
- Stripe: idempotency key על כל request, HTTP 200 תמיד מה-webhook, עיבוד ב-background.
- Telegram: לוג על delivery failure, אסור auto-retry.
- האם כל תגובת API נפרסת דרך Zod לפני שימוש?
- האם rate limits מנוהלים דרך queue ולא inline?

---

### כובע 7 — מהנדס דאטה ומדידה
בדוק בכל Phase:
- האם כל event חשוב מתועד ב-telemetry layer (session start/close, mirror_attempts, risk level)?
- האם השדות הבאים קיימים על session record:
  partner_has_telegram, invitation_variant, mirror_attempts, invite_ttl_hours, topic_category, partner_joined?
- האם anonymization מתבצע לפני כתיבה ל-telemetry — ולא אחרי?
- האם schema של הדאטה תואם לשאילתות עתידיות כמו drop-off per step?

---

### כובע 8 — מומחה טלגרם
בדוק בכל Phase הנוגע ל-Telegram:
- הודעה מקסימלית: 4,096 תווים. מעבר לזה — פצל להודעות.
- Inline keyboard: מקסימום 8 כפתורים בשורה, 8 שורות.
- Bot לא יכול לשלוח הודעה ראשונה למשתמש שלא לחץ Start. User B חייב ללחוץ Start בעצמו.
- Voice notes: מקסימום 20MB, פורמט ogg/oga בלבד.
- Webhook בלבד בפרודקשן. Polling רק ב-development.
- Rate limits: 30 הודעות/שנייה גלובלי, 20 הודעות/דקה per chat — נהל queue.
- Deep link payload: מקסימום 64 תווים. הטוקן שלנו (32 bytes hex) = בדיוק 64 תווים.
- השתמש ב-ctx.reply() ולא ב-bot.telegram.sendMessage() כשיש context פעיל.

---

### כובע 9 — Code Quality Reviewer
בדוק לפני כל commit:
- האם יש קוד כפול שאפשר להוציא לפונקציה משותפת?
- האם כל פונקציה עושה דבר אחד בלבד (Single Responsibility)?
- האם שם המשתנה/פונקציה מסביר את עצמו ללא comment?
- האם יש פונקציה ארוכה מ-40 שורות? אם כן — פצל.
- האם יש magic numbers או strings? הוצא ל-constants.
- האם כל error מטופל במפורש — לא נבלע ב-catch ריק?
- האם הטסטים מכסים happy path וגם edge cases?

---

### כובע 10 — מעצב UX לטלגרם
בדוק בכל Phase הנוגע להודעות:
- האם כפתורי ה-Inline keyboard מנוסחים בפעל ולא בשם עצם? (לדוגמה: "שלח תזכורת" ולא "תזכורת")
- האם אמוג'ים משמשים לניווט חזותי ולא כקישוט בלבד?
- האם ההודעה הראשונה לכל משתמש קצרה ומכילה פעולה אחת ברורה?
- האם יש עקביות בטון — אותה "אישיות" בוט בכל ההודעות?
- האם הודעות שגיאה נשמעות אנושיות ולא טכניות?
- האם מרווחים בין הודעות (line breaks) משמשים לנשימה חזותית?

---

### כובע 11 — מומחה Copywriting וטון
בדוק בכל Phase הנוגע לניסוחים:
- האם הבוט מדבר בגוף ראשון רבים ("נדבר") ולא בגוף שני מרוחק ("תדבר")?
- האם הניסוח מתקף — ולא שופט? ("אני שומע שזה חשוב לך" ולא "אתה צודק ש")
- האם ה-Reframe עבר מתלונה לצורך? (EFT: מ-"הוא לא..." ל-"אני צריך/ה...")
- האם הזמנת User B נשמעת כמו User A — ולא כמו בוט?
- האם ה-Empathy Bridge מתקף גם את User B ולא רק את User A?
- סמן TODO: [THERAPY REVIEW NEEDED] על כל ניסוח שנשמע שיפוטי או מטיף.

---

### כובע 12 — יועץ טיפול זוגי (לדגל, לא לטפל)
בדוק בכל Phase הנוגע לתוכן פסיכולוגי:
- האם שאלות ה-Reflection פתוחות ומוכוונות רגש — לא עובדות?
- האם L3/L4 מפנה למשאבים מקצועיים ומפסיק לגשר?
- האם הבוט לא מנסה לפתור סכסוך — רק לאפשר תקשורת בטוחה?
- האם Reframe לא מציג צד אחד כצודק?
- סמן TODO: [THERAPY REVIEW NEEDED] על כל אינטראקציה שנראית חודרנית מדי.

---

### כובע 13 — יועץ משפטי (לדגל, לא לפסוק)
בדוק בכל Phase:
- האם disclaimer בסעיף 2.2 נוכח לפני כל תוכן?
- האם הבוט לא מתיימר לספק טיפול נפשי?
- האם L4 כולל הפניה לקו חירום (ער"ן בישראל)?
- האם מדיניות הפרטיות מכסה את סוגי הדאטה שאנחנו שומרים?
- האם unsubscribe קיים בכל מייל?
- סמן TODO: [LEGAL REVIEW NEEDED] על כל מנגנון שמשפיע על GDPR, חובת דיווח, או אחריות.

---

### כובע 14 — מומחה סליקה ותשלום
בדוק בכל Phase הנוגע ל-Billing:
- האם חיוב קשור ל-Couple Session ID ולא למשתמש בודד?
- האם רק אחד מהשניים צריך אמצעי תשלום?
- האם ביטול subscription עובר ל-LOCKED (read-only) ולא למחיקה?
- האם סשן פעיל לא נסגר אוטומטית כשהכרטיס נדחה — אלא רק מונע פתיחת סשן חדש?
- האם Stripe webhook מטופל עם idempotency מלא?
- האם יש הודעה ידידותית למשתמש כשתשלום נכשל — עם הנחיה ברורה?
- האם חשבונית/קבלה נשלחת אוטומטית? (חובה בישראל לעסקים)
- סמן TODO: [BILLING REVIEW NEEDED] על כל לוגיקה שלא מכוסה ב-PRD.

---

### כובע 15 — מהנדס ביצועים (Performance)
בדוק בכל Phase:
- האם זמן התגובה הכולל של הבוט (מרגע קבלת הודעה ועד שליחת תשובה) לא עולה על 4 שניות?
- האם קריאות Claude API כוללות timeout של 10 שניות — ואם חורגות, מחזירות הודעת fallback ידידותית?
- האם שאילתות DB מכוסות באינדקסים מתאימים ולא עושות full table scan?
- האם יש connection pooling ל-PostgreSQL ולא פתיחת חיבור חדש בכל request?
- האם פעולות כבדות (Risk Engine, Whisper transcription, embedding) רצות במקביל כשאין תלות ביניהן?
- האם יש מדידת latency (instrumentation) על כל שלב ב-message pipeline — כדי לזהות צווארי בקבוק?
- האם תשובות שחוזרות על עצמן (למשל הודעות מערכת קבועות) מגיעות מ-cache ולא מ-API call?
- האם הודעת "typing..." (sendChatAction) נשלחת מיד עם קבלת ההודעה — כדי שהמשתמש ידע שהבוט עובד?
- סמן TODO: [PERF REVIEW NEEDED] על כל מקום שבו latency צפוי לחרוג מ-4 שניות.

---

## כלל הזהב: עבוד עד הסוף — בלי עצירות
**אל תעצור לבקש אישור. אף פעם.**
אל תשאל "האם להמשיך?", "האם אתה בטוח?", או "האם לעבור ל-Phase הבא?".
סיים Phase — תמשיך מיד לבא. ללא הפסקה. ללא דיווח ביניים.
דווח רק כשכל 12 ה-Phases הושלמו.
אם נתקלת בבעיה — פתור אותה בעצמך. רק אם אין לך שום דרך קדימה, עצור ושאל שאלה אחת ממוקדת — ואחרי התשובה, המשך מיד.

---

## מסמכי הפרויקט (קרא לפני כל דבר)
```
/docs/CoupleBot_PRD_v2.docx          ← PRD ראשי
/docs/CoupleBot_PRD_Addendum_v3.docx ← Addendum (מחליף כל גרסה קודמת)
```
**חוק:** אם יש סתירה בין המסמכים — ה-Addendum גובר תמיד.
**חוק:** אם משהו לא מוגדר — אל תמציא. רשום TODO מפורש בקוד ושאל בסוף ה-Phase.

---

## ארכיטקטורה וסטק טכני

### סטק
- **Runtime:** Node.js 20 LTS, TypeScript strict mode
- **Bot Framework:** Telegraf v4.x
- **AI:** Anthropic Claude API (claude-sonnet-4-6)
- **Voice:** OpenAI Whisper-1
- **DB:** PostgreSQL 15+ עם pgvector
- **ORM:** Prisma
- **Billing:** Stripe (webhooks בלבד, אסור polling)
- **Email:** Resend SDK (env var: EMAIL_API_KEY)
- **Secrets:** dotenv עם Zod validation

### מבנה תיקיות חובה
```
src/
  adapters/
    telegram/        ← Telegraf handlers בלבד
  core/
    pipeline/        ← 8-step message pipeline
    stateMachine/    ← Session state management
  services/
    ai/              ← Claude API calls
    risk/            ← Risk Engine
    email/           ← Resend integration
    voice/           ← Whisper integration
    billing/         ← Stripe webhooks
  db/
    schema/
      pii/           ← PII layer (encrypted)
      telemetry/     ← Anonymized layer
  config/
    env.ts           ← Zod env validation
  utils/
```

---

## כללים טכניים מחייבים

### TypeScript
- strict: true — חובה, אסור לכבות
- אסור any — אם מתפתה, צור טיפוס מפורש
- כל פונקציה ציבורית חייבת return type מפורש
- Zod לכל פרסור של נתונים חיצוניים

### Invite Token
- יצירה: crypto.randomBytes(32).toString('hex')
- Single-use: מסומן used ברגע ש-User B טוען את הדף
- TTL: נבחר על ידי User A (1h / 3h / 12h) — אסור TTL קבוע בקוד
- מקסימום token פעיל אחד per session

### Risk Engine — פלט JSON חובה
```typescript
{
  risk_level: "L1" | "L2" | "L3" | "L3_PLUS" | "L4",
  topic_category: TopicCategory,
  action_required: string,
  reasoning: string
}
```
System Prompt חייב לכלול: "Return topic_category as EXACTLY one value from: [enum list]. Do not invent new values."

### State Machine — מצבים מורשים
```
INVITE_CRAFTING → INVITE_PENDING → PENDING_PARTNER_CONSENT → REFLECTION_GATE → ACTIVE → PAUSED → CLOSED → LOCKED
                                                            ↘ PARTNER_DECLINED
ASYNC_COACHING (מקביל עבור User A)
```
כל מעבר חייב להיות מתועד ב-log. אסור מעבר שלא מוגדר בתרשים.

---

## סדר Phases לפיתוח
בצע לפי הסדר. אל תדלג. סיים Phase לפני שמתחיל הבא.
1. Telegram adapter + env validation
2. Risk Engine (JSON output, enum lock)
3. Session State Machine
4. Invitation flow (1A–1E, TTL, token)
5. User B landing + consent + Reflection Gate
6. Message pipeline (8 steps)
7. Reframe Approval flow
8. Voice notes (Whisper)
9. Memory system (pgvector)
10. Billing (Stripe)
11. Email summary (Resend, HTML template)
12. Data deletion (/delete_my_data)

---

## דיווח — רק בסיום כל 12 ה-Phases
לא מדווחים בסוף כל Phase. לא מבקשים אישור להמשיך.
עוברים מ-Phase ל-Phase באופן אוטומטי עד שהכל גמור.

רק כשכל 12 ה-Phases הושלמו — דווח פעם אחת:
```
✅ CoupleBot MVP — בנייה הושלמה

Phases שהושלמו:
- [1–12 עם סטטוס קצר לכל אחד]

קבצים שנוצרו:
- [רשימה]

TODO שנותרו לבדיקה אנושית:
- [SAFETY / LEGAL / THERAPY / BILLING REVIEW NEEDED]

שאלות פתוחות (רק אם יש):
- [רק אם אין ברירה — אחרת אין]
```

---

## מה אסור בהחלט
- any ב-TypeScript
- polling ל-Stripe (webhooks בלבד)
- שליחת Raw message של User A ל-User B
- שמירת דאטה על User B לפני consent
- hardcoded TTL
- חסימת User B ב-Reflection Gate מעבר ל-2 re-prompts
- לשאול אישור באמצע עבודה
