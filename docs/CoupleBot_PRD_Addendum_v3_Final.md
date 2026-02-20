CoupleBot
PRD Addendum v3 — Final
Sections 2.5 – 2.11 + Email Spec + Appendix



# 2.5  User B Invitation & Onboarding Flow

## Phase 1 — Crafting the Invitation (User A + Bot)
1A — Inviting the Partner: When & How
User A may choose to invite their partner at ANY point during their session — not only at the start. The bot does not force this decision upfront. During Onboarding, the bot presents a single soft choice:


Both options lead to the same Onboarding flow. The only difference: if User A chooses 'alone first', no link is generated yet.
At any later point, a persistent 'הזמן את בן/בת הזוג' button is available in the bot menu. Tapping it starts Phase 1B below.
If User A never invites their partner: session proceeds as solo ASYNC_COACHING. This is a valid and complete use case.

1B — Bot-Assisted Invitation Drafting
Bot asks: 'מה הדבר הכי חשוב שאתה רוצה שהם ידעו לפני שנכנסים?'
User A types free text. Bot applies EFT coaching lens: shifts framing from grievance to need and connection.
Bot suggests 1–2 draft versions. User A can accept, edit, or regenerate.
Final text stored as invitation_message on session record.

1C — TTL Selection & Link Generation
When User A is ready to send the link, the bot asks them to choose how long to keep it open:


Selected TTL stored as invite_ttl_hours on session record.
Token: crypto.randomBytes(32).toString('hex') — single-use, cryptographically random.
On TTL expiry: bot notifies User A via Telegram: 'הלינק פג תוקף. רוצה ליצור חדש?' On confirmation: old token invalidated, new token generated, User A chooses TTL again.
Maximum active tokens per session: 1. New token generation invalidates previous immediately.

1D — Shareable Package


1E — Edge Case: User B Has No Telegram
Before generating the link, bot asks:






## Phase 2 — User B Clicks the Link
2A — Soft Landing Message

2B — Topic Category
A general category is shown to reduce the 'trap' feeling. Never the Reframe text itself.



2C — Consent



## Phase 3 — First Content Exposure
3A — Reframe Delivery

3B — Reflection Gate (Mandatory Coaching Sub-Flow)





# 2.6  State Machine — New States for Invitation Flow

# 2.7  Edge Case: Partner Declined or Did Not Respond
## 2.7.1 — Triggers
User B opened link but did not tap consent within 15 minutes of opening.
User B sends /stop before consenting.
Explicit decline button: NOT in MVP. Do not implement.

## 2.7.2 — Bot Response to User A

## 2.7.3 — Reminder Flow
Bot generates soft reminder text for User A to send manually. Tone: warm, zero pressure.
New invite link generated with fresh TTL (User A selects again). Old token invalidated first.
Maximum 2 reminders per session. After 2: bot suggests closing and reopening later.



# 2.8  Topic Category — TypeScript Enum
export const TOPIC_CATEGORIES = [
  "עומס וחלוקת אחריות",
  "תקשורת ורגש",
  "זמן ואיכות קשר",
  "כסף והתנהלות כלכלית",
  "גבולות ומרחב אישי",
  "הורות ומשפחה",
  "משהו שחשוב לי לשתף",  // fallback
] as const;
export type TopicCategory = typeof TOPIC_CATEGORIES[number];

Risk Engine prompt must include the full list and instruct: 'Return EXACTLY one value from this list. Do not invent new values.'
Fallback conditions: confidence < 0.70 OR Risk Level ≥ L3.
Add topic_category: TopicCategory to Risk Engine JSON output schema (Section 8.2 of main PRD).

# 2.9  Invite Token — Single-Use & Deduplication
Token: crypto.randomBytes(32).toString('hex')
Single-use: token marked used when B loads landing page. Second click: 'הלינק כבר שומש. פנה לשולח/ת לקבלת לינק חדש.'
One active token per session. Old token invalidated before new one created.
Duplicate join: if Telegram ID already in session: 'אתה/את כבר חלק מהסשן הזה.'
Concurrent request: if A requests new link while one is active, bot warns and requires explicit confirmation.

# 2.10  Reflection Gate — Evaluation Schema
## 2.10.1 — JSON Output from Mirror Evaluation Call
{
  "mirror_quality": "GOOD" | "PARTIAL" | "MISSED",
  "captured_need": boolean,
  "captured_emotion": boolean,
  "missing_element": string | null,
  "suggested_reprompt": string | null
}

## 2.10.2 — Routing Logic



# 2.11  Session Summary Email

## 2.11.1 — Email Opt-In Flow
At session close, before sending the Telegram summary, the bot asks:

If YES: bot asks for email address. Store encrypted in PII layer (EMAIL field, AES-256 column encryption).
Email address may be stored for future sessions (ask: 'לשמור את הכתובת לסשנים הבאים?').
If NO: no email sent. Telegram summary sent as usual.

## 2.11.2 — Email Content Structure
Each user receives a SEPARATE email. Content has two sections:


## 2.11.3 — Reading Resource per Category


## 2.11.4 — Email Format & Design
Format: HTML email, responsive (mobile-first).
Design: CoupleBot brand colors (deep blue #1F4E79, white, soft warm gray). Clean, minimal, therapeutic tone. NOT corporate.
Sender name: 'CoupleBot'. Reply-to: no-reply address (do not expose operational email).
Subject line: 'סיכום הסשן שלך — [תאריך]'
Email provider: SendGrid or Resend (team preference). API key in env var EMAIL_API_KEY.
HTML template: single file, inline CSS only (for email client compatibility). No external stylesheets.
RTL layout: dir='rtl' on the body element. All text right-aligned by default.

## 2.11.5 — Email HTML Structure
<!-- Required sections in order -->
1. Header: CoupleBot logo text + session date
2. Hero: Short warm headline (e.g., 'עשיתם משהו אמיץ היום')
3. Personal Summary block (unique per user)
4. Shared Commitments block
5. Recognition / encouragement paragraph
6. CTA Button: 'פתח/י סשן נוסף' → t.me/CoupleBot
7. Reading Resource: title + 1 sentence description + link
8. Footer: 'CoupleBot — מרחב בטוח לשיחות שחשובות'
           Unsubscribe link (required for CAN-SPAM/GDPR)



# Appendix — Partner Onboarding Guardrails (Code Review Checklist)
Use this as a pre-merge checklist for all code touching the invitation and onboarding flow.



| Field | Value |
|---|---|
| Version | 3.0 — Final, supersedes all previous Addendum versions |
| Status | Ready for Claude Code |
| Incorporates feedback from | Gemini review, Grok review, product decisions |
| Depends on | CoupleBot_PRD_v2.docx (main PRD) |


| 📌 HOW TO USE: Provide BOTH this file and CoupleBot_PRD_v2.docx to Claude Code. This Addendum adds Sections 2.5–2.11 and a new Section 17 (Email Spec) to the main PRD. Where there is a conflict, this Addendum takes precedence. |
|---|


| 🎯 DESIGN PRINCIPLE: User B must arrive feeling invited, not ambushed. Every step lowers defensiveness and creates psychological safety before any conflict content is revealed. |
|---|


| Bot prompt during Onboarding: "רוצה לעבד לבד קודם, או שנצרף את בן/בת הזוג לסשן?"  [🤝 לצרף עכשיו]   [🧘 לעבד לבד קודם]  אפשר תמיד לצרף מאוחר יותר — בכל שלב בסשן. |
|---|


| Bot asks User A: "כמה זמן תרצה שהלינק יהיה פתוח?"  [⚡ שעה אחת]   [🕐 3 שעות]   [🌙 12 שעות]  טיפ: אם הם בעבודה או בפגישה כרגע, בחר/י 3 שעות לפחות. |
|---|


| Bot sends to User A (copy-paste ready): ✉️ העתק ושלח ל[שם] בוואטסאפ או בטלגרם:  "[טקסט ההזמנה האישי שנוסח יחד]"  🔗 הלינק לסשן: t.me/CoupleBot?start=session_[token]  💡 שלח את ההודעה והלינק ביחד, בהודעה אחת. |
|---|


| ⚠️ CRITICAL: Bot never sends on User A's behalf. Manual sending creates personal ownership and commitment. This is intentional and must not be changed. |
|---|


| Bot asks User A: "האם לבן/בת הזוג שלך יש טלגרם מותקן בטלפון?"  [✅ כן]   [❓ לא בטוח]   [❌ לא] |
|---|


| Answer | Bot Behavior |
|---|---|
| ✅ YES | Proceed with standard package (1D). |
| ❓ / ❌ | Use modified invitation text below. Frame download as privacy benefit. |


| Modified invitation text: "היי, פתחתי לנו סשן ב-CoupleBot. חשוב לי שנדבר בצורה רגועה שמכבדת את שנינו. הבוט יושב בטלגרם כדי שהשיחה שלנו תהיה הכי פרטית ומאובטחת — לא בוואטסאפ, לא בהודעות רגילות. אם אין לך את האפליקציה, זה ייקח דקה להוריד. אשמח שתיכנס/י."  🔗 [הלינק לסשן] |
|---|


| 📌 ANALYTICS: Store partner_has_telegram: boolean | null and invitation_variant: 'standard' | 'no_telegram' on session record for drop-off analysis. No impact on core flow. |
|---|


| Bot's first message to User B: היי [שם] 👋  "בן/בת הזוג שלך פתח/ה את הסשן הזה כי הקשר שלכם חשוב לו/ה. הוא/היא רוצה לשתף אותך במשהו — ובחר/ה לעשות את זה בצורה שמכבדת את שניכם.  אני CoupleBot. אני לא לוקח צדדים. אני כאן כדי לעזור לשניכם להקשיב ולהישמע — בלי שהשיחה תסתחרר.  📌 נושא הסשן: [קטגוריה כללית — ראה 2B]" |
|---|


| Category (shown to B) | Classification Logic |
|---|---|
| עומס וחלוקת אחריות | AI classifies the approved Reframe during the Risk Engine call. |
| זמן ואיכות קשר | Add topic_category: TopicCategory to Risk Engine JSON output (Section 8.2). |
| תקשורת ורגש | AI must select ONLY from this closed enum. Enforce in System Prompt. |
| כסף והתנהלות כלכלית | If confidence < 0.70 OR Risk Level ≥ L3: use fallback regardless. |
| גבולות ומרחב אישי |  |
| הורות ומשפחה |  |
| משהו שחשוב לי לשתף (fallback) | Default when confidence < 0.70 or topic is sensitive. |


| ⚠️ ENUM LOCK: The Risk Engine System Prompt must include: 'Return topic_category as EXACTLY one value from this list: [enum values]. Do not invent new categories. If unsure, return the fallback value.' Without this explicit instruction, LLMs will hallucinate categories. |
|---|


| Inline keyboard: "[📜 קראתי והבנתי — אני מוכן/ה להתחיל]"  No other options. If no tap within 15 minutes of opening: PARTNER_DECLINED. |
|---|


| ⚠️ GDPR: No data about User B is stored before this button is tapped. partner_has_telegram and invitation_variant are stored on User A's session record, not on User B. |
|---|


| Bot framing line: "בן/בת הזוג שלך ביקש/ה להעביר לך את הדברים הבאים. ביקשתי ממנו/ממנה לנסח אותם בצורה שתאפשר לכם לדבר בצורה רגועה:  — [Reframed text] — |
|---|


| 🧠 RATIONALE: The first instinct after receiving a partner's grievance is defensiveness. Pausing for reflection (Imago Mirror step) before responding is the core mediation value. Skipping this eliminates the product's primary differentiator. |
|---|


| 🔴 RISK ENGINE: The Risk Engine (Section 8) MUST run on ALL free-text input during the Reflection Gate — including the reflection response and the mirror response. User B may express toxicity even in 'private' coaching mode. This is not optional. |
|---|


| # | Step | Detail |
|---|---|---|
| 1 | Reflection Prompt | Bot: 'לפני שנגיב — מה הדבר הראשון שאתה מרגיש כשאתה קורא את זה?' Free text. Risk Engine runs on response. |
| 2 | Mirror Prompt | Bot: 'האם תוכל לשקף במילים שלך מה הבנת שחשוב לבן/בת הזוג שלך?' Risk Engine runs on response. |
| 3 | AI Validation | AI classifies mirror response (see Section 2.10). If GOOD: proceed. If PARTIAL/MISSED: one gentle re-prompt. Max 2 re-prompts total across steps 1+2. Then proceed regardless. |
| 4 | Empathy Bridge | Bot: 'תודה ששיקפת. עכשיו הבוט יעזור לך לנסח את התגובה שלך — גם אתה זכאי/ת להישמע.' |
| 5 | B Enters Pipeline | User B is now a sender. Full pipeline (Section 4.2 of main PRD) applies to their response. |


| 📌 ANALYTICS: Store mirror_attempts: integer on session record (incremented on each re-prompt). Used for UX improvement analysis. |
|---|


| State | Description & Transitions |
|---|---|
| INVITE_CRAFTING | User A composing invitation with bot. No link generated. → INVITE_PENDING on approval. |
| INVITE_PENDING | Link active. TTL chosen by User A (1h/3h/12h). Bot in ASYNC_COACHING with A. On TTL expiry: notify A, offer regeneration. → PENDING_PARTNER_CONSENT when B clicks. |
| PENDING_PARTNER_CONSENT | B has clicked, in soft landing + disclaimer flow. A notified: 'בן/בת הזוג פתח/ה את הלינק.' TTL paused. → REFLECTION_GATE on consent. → PARTNER_DECLINED if no consent within 15 min of opening. |
| REFLECTION_GATE | B consented, received Reframe. Bot conducting Reflection→Mirror→Empathy sub-flow with B. A in ASYNC_COACHING. No content crosses channels. → ACTIVE on completion. |
| PARTNER_DECLINED | B did not consent. See Section 2.7. Session NOT auto-closed. A may continue solo or resend. |


| Bot message to User A: "בן/בת הזוג שלך פתח/ה את הלינק אבל עדיין לא הצטרף/ה. זה קורה — לפעמים הרגע לא מתאים.  אתה יכול/ה:   ▸ לשלוח תזכורת עדינה (אני אנסח אחת)   ▸ להמשיך בעיבוד הרגשי הפרטי שלך   ▸ לסגור את הסשן ולפתוח אחד חדש כשהזמן נכון"  [✉️ שלח תזכורת]   [💬 המשך לבד]   [🔒 סגור סשן] |
|---|


| ⚠️ PRIVACY: No behavioral data about User B (opened link, did not consent) stored in Telemetry layer. Only partner_joined: boolean stored on session record. |
|---|


| mirror_quality | Action | Hard Limit |
|---|---|---|
| GOOD | Proceed to Empathy Bridge. | — |
| PARTIAL | 1 gentle re-prompt. If still PARTIAL: treat as GOOD, proceed. | Max 1 re-prompt |
| MISSED | 1 re-prompt. If still MISSED: treat as PARTIAL, proceed. | Max 2 re-prompts total across all steps |


| ⚠️ CRITICAL: Reflection Gate must NEVER permanently block User B. 2 re-prompts maximum across all steps combined. After that: proceed regardless of quality score. |
|---|


| 📌 SCOPE: Email is sent ONLY at session close (CLOSED state). It is optional — User is asked at end of session. No other bot events trigger email. |
|---|


| Bot asks (both users separately): "הסשן הסתיים. רוצה לקבל את הסיכום גם למייל? הסיכום כולל את המסע הרגשי שלך, הכלים שתרגלתם, ומשאב קריאה מותאם.  [✅ כן, שלח לי למייל]   [❌ לא תודה] |
|---|


| Section | Content |
|---|---|
| PERSONAL (unique per user) | Emotional journey: what you felt at start vs. end (score 1–5). What you expressed. 1–2 communication tools you practiced this session. |
| SHARED (identical for both) | 1–2 commitments made during session (verbatim where applicable). Encouragement & recognition of the effort made. |
| CALL TO ACTION | Prominent button: 'פתח/י סשן נוסף' — links back to the bot. Soft framing: 'כל שיחה היא צעד. אתם כבר עשיתם אחד.' |
| READING RESOURCE | 1 short article or concept (300–500 words or external link) relevant to the session's topic_category. Curated per category — see 2.11.3. |


| Topic Category | Resource Type |
|---|---|
| עומס וחלוקת אחריות | Article on Fair Play method or mental load research |
| תקשורת ורגש | Gottman's 'Four Horsemen' explainer |
| זמן ואיכות קשר | Research on quality time vs. quantity in relationships |
| כסף והתנהלות כלכלית | Article on financial transparency in couples |
| גבולות ומרחב אישי | Concept: differentiation in relationships (Schnarch) |
| הורות ומשפחה | Gottman's research on couples post-children |
| משהו שחשוב לי לשתף (fallback) | General Imago dialogue overview |


| 📌 IMPLEMENTATION: Resources may be hardcoded links per category in MVP. No dynamic content fetching required. Store as a config object: CATEGORY_RESOURCES: Record<TopicCategory, { title: string, url: string }> |
|---|


| ⚠️ UNSUBSCRIBE: Every marketing/summary email must include an unsubscribe link. Implement unsubscribe endpoint that sets email_opted_out: true on user record. Future emails skipped for opted-out users. |
|---|


| ✓ | Rule | Failure Mode |
|---|---|---|
| □ | No conflict content before User B consent | Ambush feeling. Session abandoned. |
| □ | Topic category only in landing — never Reframe text | User B arrives defensive. |
| □ | Reflection Gate mandatory. Risk Engine runs on ALL free text in gate. | Toxic content passes undetected. Defensive reaction to Reframe. |
| □ | Invitation sent manually by User A only | Loss of authenticity and commitment. |
| □ | Token single-use. Old token invalidated before new one created. | Replay attacks. Unauthorized access. |
| □ | TTL chosen by User A (1h / 3h / 12h). Not hardcoded. | Expired links. Lost sessions. |
| □ | Max 2 re-prompts in Reflection Gate. Never block. | User B feels interrogated. Exits. |
| □ | PARTNER_DECLINED: supportive flow for A, not auto-closure. | User A feels abandoned. |
| □ | No data stored for User B before consent. | GDPR violation. |
| □ | Email opt-in only. Unsubscribe link in every email. | GDPR / CAN-SPAM violation. |
| □ | topic_category from closed enum only. Enforced in System Prompt. | LLM hallucinates categories. B sees confusing topic. |
| □ | mirror_attempts and invitation_variant stored on session record. | Missing analytics for UX improvement. |


| ✅ ADDENDUM v3 FINAL: This document supersedes all previous Addendum versions. Provide together with CoupleBot_PRD_v2.docx. Update Section 8.2 of main PRD: add topic_category to Risk Engine JSON. Add Section 17 (Email) to main PRD with env var EMAIL_API_KEY. |
|---|
