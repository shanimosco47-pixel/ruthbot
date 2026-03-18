# 15 כובעים — צ'קליסט לפני commit/שינוי משמעותי

> קרא את הקובץ הזה כשמבקשים ממך לעבור על הכובעים, או לפני שינוי משמעותי בקוד.

## כובע 1 — ארכיטקט מערכת
- הפרדת שכבות: Adapter / Orchestrator / AI / Memory / Safety / Billing?
- ניתן להחליף Telegram ב-WhatsApp בלי לגעת ב-logic?
- State Machine דטרמיניסטי — כל מעבר מתועד ב-log?
- Dependency Injection, לא hardcoded imports?

## כובע 2 — מהנדס אמינות
- כל API call עטוף ב-timeout?
- idempotency על Stripe webhooks?
- session locking מונע עיבוד מקביל?
- סשנים idle > 12h → CLOSED אוטומטית?
- כניסה כפולה של User B מטופלת?

## כובע 3 — מהנדס בטיחות (Safety)
- Risk Engine רץ על כל טקסט חופשי?
- L4 → halt מיידי + משאבי חירום?
- Raw message של User A לעולם לא מגיע ל-User B?
- guardrails ב-System Prompt?
- L3/L4 כולל הפניה למשאבים מקצועיים?
- סמן [SAFETY REVIEW NEEDED] על מקומות לא ברורים

## כובע 4 — פרטיות ואבטחה
- PII ו-Telemetry ב-schemas נפרדים?
- אין FK ישיר — רק anonymized_couple_id?
- name, email, telegram_id מוצפנים AES-256?
- אין דאטה על User B לפני consent?
- /delete_my_data מוחק PII, שומר telemetry anonymized?
- סמן [LEGAL REVIEW NEEDED] על שמירה ארוכת טווח

## כובע 5 — חוויית שיחה (UX)
- לא יותר מהודעה אחת בו-זמנית?
- לא שתי שאלות בהודעה אחת?
- Reflection Gate לא חוסם מעבר ל-2 re-prompts?
- תגובות < 4,096 תווים?

## כובע 6 — אינטגרציות
- Claude: exponential backoff, max 2 retries. כישלון → הודעה ידידותית (לא סגירת session)
- Whisper: retry אחד. כישלון → בקש להקליד
- Stripe: idempotency key, HTTP 200 מ-webhook, עיבוד ב-background
- Telegram: לוג delivery failure, אסור auto-retry
- Zod validation על כל תגובת API?

## כובע 7 — דאטה ומדידה
- events מתועדים ב-telemetry (session start/close, mirror_attempts, risk level)?
- anonymization לפני כתיבה ל-telemetry?

## כובע 8 — מומחה טלגרם
- הודעה מקס 4,096 תווים, מעבר → פצל
- Inline keyboard: מקס 8 כפתורים × 8 שורות
- User B חייב ללחוץ Start בעצמו
- Voice: מקס 20MB, ogg/oga בלבד
- Webhook בפרודקשן, Polling ב-dev
- Rate limits: 30/s גלובלי, 20/min per chat
- Deep link payload: מקס 64 תווים
- ctx.reply() ולא bot.telegram.sendMessage()

## כובע 9 — Code Quality
- אין קוד כפול? אין פונקציה > 40 שורות?
- שמות מסבירים את עצמם? אין magic numbers?
- כל error מטופל — לא נבלע ב-catch ריק?
- טסטים מכסים happy path + edge cases?

## כובע 10 — UX טלגרם
- כפתורים מנוסחים בפעל (לא שם עצם)?
- הודעה ראשונה קצרה + פעולה אחת ברורה?
- עקביות בטון? הודעות שגיאה אנושיות?

## כובע 11 — Copywriting וטון
- גוף ראשון רבים ("נדבר") לא גוף שני ("תדבר")?
- ניסוח מתקף, לא שופט?
- Reframe עובר מתלונה לצורך (EFT)?
- הזמנת User B נשמעת כמו User A?
- סמן [THERAPY REVIEW NEEDED] על ניסוח שיפוטי

## כובע 12 — יועץ טיפול זוגי
- שאלות Reflection פתוחות ומוכוונות רגש?
- L3/L4 מפנה למקצוענים ומפסיק לגשר?
- Reframe לא מציג צד כצודק?

## כובע 13 — יועץ משפטי
- disclaimer נוכח? הבוט לא מתיימר לטפל?
- L4 כולל קו חירום (ער"ן)?
- סמן [LEGAL REVIEW NEEDED] על GDPR/חובת דיווח

## כובע 14 — סליקה ותשלום
- חיוב קשור ל-Couple Session ID?
- ביטול → LOCKED (read-only), לא מחיקה?
- כרטיס נדחה → מונע סשן חדש, לא סוגר פעיל?
- סמן [BILLING REVIEW NEEDED] על לוגיקה לא מכוסה ב-PRD

## כובע 15 — ביצועים
- זמן תגובה כולל < 4 שניות?
- Claude timeout 10s + fallback ידידותי?
- DB queries עם אינדקסים, connection pooling?
- typing... נשלח מיד?
- סמן [PERF REVIEW NEEDED] על latency > 4s
