# CLAUDE.md — רות בוט זוגיות (RuthBot)

> **מגבלת קובץ: 150 שורות מקסימום.** אל תוסיף תוכן — עדכן או החלף שורות קיימות. מידע שניתן לגזור מהקוד או מ-git — לא שייך לכאן.

## Environment Setup
```bash
export CLAUDE_DANGEROUSLY_SKIP_PERMISSIONS=true
```

## לוג שיחות — קרא אוטומטית
**בתחילת כל סשן**, קרא את `logs/chat.log` (אם קיים) לראות שיחות אחרונות מטלגרם.
**אחרי כל שיחת טלגרם שהמשתמש מזכיר** — קרא את `logs/chat.log` אוטומטית.

## BRAIN.md — חובה לעדכן
קרא את `BRAIN.md` בתחילת כל סשן — מידע תפעולי (DB, API keys, deployment).
**עדכן מיד אחרי:** שינוי credentials, תשתית, באג חדש, אינטגרציה חדשה, שינוי ארכיטקטורה.
**אל תעדכן על:** שינויי קוד קטנים, refactoring, typo.

---

## זהות ותפקיד
מפתח Full Stack בכיר — **רות בוט זוגיות** (RuthBot) — בוט טלגרם לגישור זוגי מבוסס AI.
- בכל מקום שמופיע CoupleBot — להחליף ל-רות בוט זוגיות
- עובד לבד, באוטונומיה מלאה
- **שפת תקשורת:** עברית | **שפת קוד:** אנגלית

## כלל הזהב: עבוד עד הסוף — בלי עצירות
אל תעצור לבקש אישור. סיים משימה — המשך מיד לבאה. אם נתקלת בבעיה — פתור בעצמך. רק אם אין דרך קדימה — שאל שאלה אחת ממוקדת.

---

## 15 כובעים — פרספקטיבות חובה
לפני שינוי משמעותי, קרא את `docs/HATS_CHECKLIST.md` ועבור על הכובעים הרלוונטיים.
TODO שנוצר מכובע — רשום בקוד ודווח.

---

## Trainer Bot — System Prompt Evolution
הפרומפט (`src/services/ai/systemPrompts.ts`) משתפר ע"י trainer project ב-`C:\Users\shani\OneDrive\trainer_bot`.

**כללים לעריכת systemPrompts.ts:**
- **ADDITIVE ONLY** — לעולם לא למחוק הוראות קיימות
- **Backup first** — שמור עותק ל-`.prompt-history/` לפני עריכה
- **Log changes** — עדכן `.prompt-history/changelog.md` + `evolution.md`
- **לא לשנות מבנה** — המבנה השכבתי משקף שיפורים קליניים מאומתים

---

## מסמכי הפרויקט
```
/docs/CoupleBot_PRD_v2.md              ← PRD ראשי
/docs/CoupleBot_PRD_Addendum_v3_Final.md ← Addendum (גובר על PRD בסתירות)
```
אם משהו לא מוגדר — אל תמציא. רשום TODO ושאל.

---

## סטק טכני
Node.js 20 LTS, TypeScript strict, Telegraf v4, Claude API (claude-sonnet-4-6), Whisper-1, PostgreSQL 15+ (pgvector), Prisma, Stripe (webhooks), Resend, dotenv+Zod

## כללים טכניים מחייבים
- **TypeScript:** strict: true, אסור any, return type מפורש, Zod לנתונים חיצוניים
- **Invite Token:** crypto.randomBytes(32).toString('hex'), single-use, TTL נבחר ע"י User A (1h/3h/12h), מקס 1 פעיל per session
- **Risk Engine output:** `{ risk_level: L1-L4, topic_category: TopicCategory, action_required, reasoning }`
- **State Machine:** `INVITE_CRAFTING → INVITE_PENDING → PENDING_PARTNER_CONSENT → REFLECTION_GATE → ACTIVE → PAUSED → CLOSED → LOCKED` (+ PARTNER_DECLINED, ASYNC_COACHING)
- כל מעבר מצב מתועד ב-log. אסור מעבר לא מוגדר.

---

## מה אסור בהחלט
- `any` ב-TypeScript
- polling ל-Stripe (webhooks בלבד)
- שליחת Raw message של User A ל-User B
- שמירת דאטה על User B לפני consent
- hardcoded TTL
- חסימת User B ב-Reflection Gate מעבר ל-2 re-prompts
- לשאול אישור באמצע עבודה

---

## ניהול קבצי תיעוד — כללי היגיינה
**CLAUDE.md** (קובץ זה): מקס 150 שורות. רק הוראות עבודה קבועות. אין changelog, אין היסטוריה.
**BRAIN.md**: מקס 150 שורות. רק: סטטוס נוכחי, credentials, תשתית, pending work. אין היסטוריית גרסאות — זה בגיט.
**כלל:** לפני הוספת שורה, שאל — האם סשן עתידי צריך את זה? אם לא — לא מוסיפים.
**כלל:** אם קובץ חורג מהמגבלה — קצץ את החלק הכי ישן/פחות רלוונטי לפני שמוסיפים.
