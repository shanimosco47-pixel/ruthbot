
CoupleBot
Product Requirements & Technical Architecture
Direct Instruction Document for AI Coding Agent (Claude Code)



# 0. How to Use This Document
This document is a complete specification for an AI Coding Agent (e.g., Claude Code). It is structured in order of dependency: read top-to-bottom before writing any code. Every decision in this document has been deliberately made. Do not add features, platforms, or behaviors not listed here.


## 0.1 MVP Scope — What Is NOT Built Now
The following are explicitly OUT OF SCOPE for the MVP. Do not implement, scaffold, or stub these:
WhatsApp integration (Telegraf is structured for future pivot, but no WhatsApp code now)
Tiered pricing / multiple subscription plans (single paid plan only)
Email or SMS push notifications (Telegram only for all communication)
Admin dashboard for viewing sessions
Detailed analytics reporting UI
Web App in addition to Telegram


# 1. Product Overview
## 1.1 Vision & Positioning
CoupleBot is an AI-powered mediation assistant for couples in conflict. It is NOT a legal mediation service and NOT a replacement for clinical therapy. Its purpose is de-escalation, improved listening, and communication tooling during live conflict.

## 1.2 Platform


# 2. Onboarding & Session Creation (The Handshake)
## 2.1 Flow
The following is the definitive onboarding sequence. Implement exactly in this order:
User A starts a conversation with the bot on Telegram.
Bot displays mandatory legal disclaimer (see Section 2.2). Flow is BLOCKED until acknowledged.
User A taps [✅ אני מבין/ה ומסכים/ה]. Bot creates a Couple Session record in DB with status: PENDING_PARTNER.
Bot generates a unique invite link: t.me/CoupleBot?start=session_{uuid}. The UUID is a cryptographically random token (crypto.randomUUID() or equivalent). The link is valid for exactly 15 minutes.
Bot sends User A the link and instructs them to share it with their partner. Bot then enters ASYNC_COACHING state for User A (see Section 7).
If User B does not click the link within 15 minutes: link expires, bot notifies User A, and offers to generate a new link. User A can continue solo coaching in ASYNC_COACHING state.
If User B clicks the link: Bot displays same disclaimer to User B. Flow BLOCKED until User B acknowledges.
If User B declines disclaimer or does not respond for 15 minutes after clicking: session remains in PENDING_PARTNER state. User A is notified that their partner has not yet joined. No data from User B is stored.
Once both have accepted: session status changes to ACTIVE. Both users receive a welcome message. Session is now live.


## 2.2 Legal Disclaimer Content
The disclaimer must include all of the following points, in the user's detected language:
This bot is not a licensed therapist, psychologist, or legal mediator.
Content shared is used only to facilitate this session and for anonymized pattern analysis. It is never sold or shared with third parties.
Anonymized, de-identified conversation data may be used to improve the service.
In crisis situations, the bot will provide emergency resources and will stop the session.
User must be 18 or older.


# 3. AI Context Architecture (Critical)

## 3.1 What the AI Knows

## 3.2 What the AI Does NOT Share Without Approval
Raw messages from User A are never sent to User B verbatim (Rule 1 — absolute prohibition)
Private coaching content (what User A said during ASYNC_COACHING before User B joined) is not shared unless User A explicitly approves
Historical grievances or past conflicts, unless they are the direct root of the current conflict (Rule 4)


# 4. Mediation Architecture (Simulated Group)
## 4.1 Channel Separation
The system does NOT create a shared group chat. The bot operates as an intermediary across two completely separate private conversations. This is a core architectural constraint — never violate it.

## 4.2 Message Flow
Every message from User A follows this pipeline before any content reaches User B:


## 4.3 Voice Notes
Users may send voice notes for emotional release. Processing rules:
Bot downloads audio file from Telegram servers.
File is sent to Whisper-1 API for transcription.
Transcript is processed as text through the standard pipeline (Step 3 onward above).
CRITICAL: Audio file is deleted from local storage immediately after transcription. Do not persist audio.
The bot's output to both users is always text only. No audio is ever forwarded.


# 5. AI Behavior & Psychological Frameworks
The AI is orchestrated via a System Prompt that applies the following methodologies. The coding agent does not need to implement the therapy logic — it needs to correctly inject the System Prompt into every Claude API call with the full session context.

## 5.1 Frameworks

## 5.2 System Prompt Structure (Required for each API call)
Every call to the Claude API must include a System Prompt with these sections, in this order:
ROLE: Define the bot as a compassionate, neutral mediation facilitator.
METHODOLOGY: Inject the three frameworks above.
CONTEXT — SESSION: Inject the current session ID, both users' conversation histories, and the emotional tone scores.
CONTEXT — HISTORY: Inject vector-retrieved pattern summaries from previous sessions (see Section 6).
GUARDRAILS: Inject Rule 1 (no raw forwarding), Rule 4 (anti-stalker), and current Risk Level.
LANGUAGE: Instruct AI to respond in the language of the user it is currently addressing.
OUTPUT FORMAT: Specify whether the AI is in coaching mode (free text) or reframe mode (structured output with suggested reframe clearly delimited).


# 6. Memory & Pattern Recognition
## 6.1 Vector Database
Use pgvector (PostgreSQL extension) as the default. Pinecone is an acceptable alternative if the team prefers managed infrastructure. The choice does not affect product behavior.

## 6.2 What Is Stored in the Vector DB

## 6.3 Retrieval Logic (Proactive Context)
On each new conflict message, embed the message and query the vector DB for semantically similar past session summaries for this couple.
Retrieve top 3 matches above a similarity threshold (tune during development, start at 0.78).
Inject retrieved summaries into the System Prompt under CONTEXT — HISTORY.
Apply Rule 4 (Anti-Stalker) before injecting: only patterns directly relevant to the current conflict theme are included.



# 7. State Machine & Session Lifecycle
## 7.1 Session States

## 7.2 Async Timeout Details
User B invite link TTL: 15 minutes. On expiry: User A notified, option to resend offered.
Idle reminder (ACTIVE → PAUSED): 15 minutes. One reminder sent. Configurable via environment variable IDLE_TIMEOUT_MINUTES.
Session auto-close (PAUSED → CLOSED): 12 hours. Configurable via SESSION_EXPIRY_HOURS.
Max retry reminders to idle user: 2 (configurable: MAX_IDLE_REMINDERS).

## 7.3 Session Summary (sent on CLOSED)
Each user receives a message containing two sections:
PERSONAL SUMMARY (private, different for each user): Emotional journey this session — what you expressed, what you felt. 1-2 communication tools you practiced. Your emotional score at start vs. end of session (1–5 scale). A prompt to start a new session.
SHARED SUMMARY (identical for both users): 1–2 communication commitments you both made (verbatim from session if applicable). A single 'Start New Session' button.


# 8. Risk Engine (Deterministic Safety System)
The Risk Engine classifies every incoming message before it enters the coaching pipeline. Classification is performed by the AI (Claude) with a structured output format — the code must parse the response and route accordingly. The AI must be prompted to return a structured JSON risk assessment, not free text.

## 8.1 Risk Level Definitions



## 8.2 Risk Engine API Call Format
The Risk Engine runs as a separate, fast Claude API call before the main coaching call. System Prompt instructs Claude to return ONLY valid JSON:
{ "risk_level": "L1"|"L2"|"L3"|"L3_attachment"|"L4", "justification": "...", "dominant_emotion": "...", "recommended_action": "..." }


# 9. Data Architecture
## 9.1 Layer Separation (Mandatory)
Two completely separate database schemas. PII and content must never be stored in the same table.


## 9.2 Data Deletion Policy (GDPR)
When a user requests deletion:
Their PII record is deleted immediately (Telegram ID, Stripe association).
Their anonymized_couple_id remains in the Telemetry layer — this data is de-identified and retained as a business asset (permitted under GDPR Art. 89 for statistical purposes).
The remaining partner is not notified of the deletion request unless the requesting user consents to this notification.
Implement a /delete_my_data Telegram command that triggers this flow.


# 10. Billing Logic
## 10.1 Trial
The first session per couple (Couple Session ID) is completely free — all features unlocked, no credit card required.
After the first session closes, subsequent sessions require an active paid subscription.
Trial is per Couple, not per user.

## 10.2 Payment & Couple Entity
Billing is tied to the Couple Session ID, not to individual users.
Only one user needs to add a payment method (Stripe). That user becomes the Billing Owner for the couple.
When the Trial ends and no payment is on file: session is locked immediately (status → LOCKED). Both users see a read-only message with a payment link.
If subscription is cancelled or payment fails: both accounts move to read-only (LOCKED state). Features disabled: sending messages, starting new sessions. Features enabled: reading session history.

## 10.3 Stripe Integration
Use Stripe Webhooks for all payment event handling (invoice.payment_succeeded, invoice.payment_failed, customer.subscription.deleted).
Never poll Stripe — webhook-driven only.
Store Stripe Customer ID in PII layer (encrypted). Never store card details.


# 11. Technical Stack


# 12. Environment Variables (Required)
Create a .env.example file with all of the following. Never commit actual values.



# 13. Error Handling & Resilience
## 13.1 Claude API Failure
On failure: immediate Retry (exponential backoff, max 2 retries, starting at 1s).
During retry: bot sends a holding message to the user: 'רגע, אני מעבד... 🕐' (or equivalent in user's language). Do not leave the user without feedback.
After 2 failed retries: bot sends an apologetic error message and instructs user to try again. The session is NOT closed or locked.
All Claude API errors must be logged with session_id, timestamp, error_code, and user_role.

## 13.2 Whisper API Failure
On failure: bot notifies user that audio transcription failed and asks them to type their message instead.
Do not retry audio transcription more than once (audio files are large; cost & latency are high).

## 13.3 Stripe Webhook Failure
Implement idempotency for all Stripe webhook handlers using the Stripe event ID.
On webhook processing failure: log the error and return HTTP 200 to Stripe (to prevent redelivery loops). Handle in a background reconciliation job.

## 13.4 Telegram Delivery Failure
If Telegram message delivery fails (user has blocked bot, etc.): log and do not retry automatically. Flag session for manual review if the other user is actively waiting.


# 14. Non-Negotiable Guardrails for Code Agent

## Rule 1: NO RAW MESSAGE FORWARDING
The bot is never a proxy. Zero exceptions.
No raw text message, audio file, or transcript from User A may be transmitted to User B under any circumstances.
Only AI-processed, AI-reframed content that has been explicitly approved by the sender may cross from one private channel to another.
Implement this as a hard gate in the message pipeline: a boolean flag requiresAIProcessing that must be true before any message is queued for the other user.

## Rule 2: DETERMINISTIC REFRAME APPROVAL FLOW
When the bot proposes a reframe, the Telegram Inline Keyboard must offer exactly these three options. No other actions are valid at this step:
[✅ שלח כפי שזה] → Approves forwarding the AI-reframed message to partner.
[✏️ אני רוצה לערוך] → Opens free-text edit mode. User edits the reframe. Edited version goes through a second Risk Classification (Step 7 in pipeline). If clean: approval flow repeats. If toxic: AI generates new reframe of the edited version. Max 3 edit iterations, then only [❌ Cancel] is offered.
[❌ בטל / אל תשלח] → Cancels the transfer entirely. Returns to private coaching mode. Session continues.
The system must wait for user input at this step. No timeouts that auto-send. No defaults.

## Rule 3: RISK ENGINE IS DETERMINISTIC
Risk classification happens BEFORE every coaching call, every time. It cannot be skipped.
The risk level returned by the engine determines the code path — not the AI's free-text response.
Level 4 triggers a hard stop that cannot be overridden by any subsequent message or user action.

## Rule 4: ANTI-STALKER PATTERN RETRIEVAL
Vector DB retrieval is scoped to patterns directly relevant to the current conflict (semantic similarity).
The System Prompt Guardrail (injected every call): 'Do not surface past conflicts or sensitive points unless they are the direct root of the current conflict. Historical references focus only on communication patterns, never on specific grievances or accusations.'
Never surface a user's private coaching content from ASYNC_COACHING state to their partner without explicit approval.

## Rule 5: SECURITY
Encryption at rest for all PII fields (AES-256, column-level).
All API keys in environment variables. No hardcoded secrets anywhere. CI/CD must include a secret-scanning step.
Stripe webhook signature verification on every incoming webhook (stripe.webhooks.constructEvent).
Telegram webhook verification (validate X-Telegram-Bot-Api-Secret-Token header if using webhooks; or use long-polling with token validation).
Audio files deleted from disk immediately after Whisper transcription. Never stored beyond the transcription call.
Session invite tokens: cryptographically random (crypto.randomUUID or crypto.randomBytes(32).toString('hex')), single-use, expire after 15 minutes.

## Rule 6: LANGUAGE
The bot detects the language of each user's first message and responds to them in that language throughout the session.
Each user's language preference is stored independently on their user record.
System prompts to Claude must explicitly instruct the AI: 'Respond in [User Language]. Do not switch languages unless the user switches first.'


# 15. Recommended Project Structure
couplebot/
├── src/
│   ├── adapters/
│   │   └── telegram/          # All Telegraf handlers — NO business logic here
│   ├── core/
│   │   ├── orchestrator.ts    # Main session orchestrator & state machine
│   │   ├── riskEngine.ts      # Risk classification (separate Claude call)
│   │   ├── reframer.ts        # Reframe generation & approval flow
│   │   └── memoryService.ts   # Vector DB retrieval & storage
│   ├── services/
│   │   ├── claude.ts          # Anthropic API wrapper with retry logic
│   │   ├── whisper.ts         # OpenAI Whisper wrapper
│   │   └── stripe.ts          # Stripe webhook handlers
│   ├── db/
│   │   ├── schema/
│   │   │   ├── pii.ts         # PII schema
│   │   │   └── telemetry.ts   # Telemetry & transcript schema
│   │   └── client.ts
│   ├── config/
│   │   └── env.ts             # Zod-validated env schema
│   └── utils/
├── .env.example
├── .gitignore                 # .env must be listed
└── README.md



# 16. Development Sequence (Suggested)
Build in this order to enable testing at each stage:
Phase 1: Telegram adapter + onboarding flow (disclaimer, invite link, session creation, 15-min TTL).
Phase 2: Risk Engine (standalone Claude call, JSON output parsing, routing logic).
Phase 3: Coaching pipeline (Claude call with full System Prompt, EFT/Gottman/Imago injection).
Phase 4: Reframe Approval Flow (Inline Keyboard, edit sub-flow, second risk check).
Phase 5: Message forwarding gate (Rule 1 enforcement, approved content delivery to partner).
Phase 6: State machine (ASYNC_COACHING, PAUSED, CLOSED, session summary generation).
Phase 7: Voice note handling (Whisper integration, file deletion).
Phase 8: Memory system (vector DB setup, embedding, retrieval, Anti-Stalker filter).
Phase 9: Billing (Stripe integration, Trial logic, LOCKED state).
Phase 10: Data deletion flow (/delete_my_data command).


| Version | 2.0 — Reviewed & Upgraded |
|---|---|
| Status | Ready for Development |
| Target Platform | Telegram (MVP) |


| 📌 GOLDEN RULE: If something is not specified here, ask before implementing. Do not infer or invent behavior. |
|---|


| Parameter | Value |
|---|---|
| MVP Platform | Telegram only |
| Messaging Library | Telegraf (Node.js) — modular for future WhatsApp pivot |
| AI Engine | Claude 3.5 Sonnet (Anthropic API) — high emotional intelligence, strong Hebrew/Arabic sub-text processing |
| Audio Transcription | Whisper-1 (OpenAI API) |
| Language Support | Auto-detect per user message. Bot UI responds in the detected language of each user. System prompts must support Hebrew, Arabic, English as primary languages. |


| ⚠️ IMPORTANT: There is NO identity verification of User B beyond Telegram account. This is a deliberate MVP decision. User B self-certifies they are the partner in the disclaimer flow. Do not add verification logic. |
|---|


| 🔴 CRITICAL DESIGN DECISION: The AI orchestrator operates as a single entity with full visibility into both users' conversations within a session. It knows everything both partners have said. What it CHOOSES to share or reference from one side to the other is governed by strict rules (see Section 9, Rule 1). |
|---|


| Context Type | AI Has Access To |
|---|---|
| Current session — User A | Full message history with User A in this session |
| Current session — User B | Full message history with User B in this session |
| Previous sessions | Vector-retrieved pattern summaries from ALL past sessions for BOTH users (semantic similarity to current conflict) |
| Cross-user patterns | Can recognize and reflect patterns that span both users' histories (e.g., recurring triggers for either person) |
| Shared content | Only content explicitly approved by sender via Reframe Approval Flow (Rule 2) |


| # | Step | Detail |
|---|---|---|
| 1 | Receive | Bot receives raw message from User A (text or voice note) |
| 2 | Transcribe (if audio) | Whisper API transcribes voice note. Text output only flows to next step. Audio file is deleted after transcription. |
| 3 | Risk Classification | AI classifies message against Risk Engine (Section 8). If Level 3+, pipeline diverges. If Level 4, hard stop. |
| 4 | Emotional Coaching | AI applies EFT/Gottman/Imago to help User A process emotion. Dialogue with User A only. |
| 5 | Reframe Generation | AI generates a reframed version of the message suitable for User B. User A sees it. |
| 6 | Reframe Approval | User A selects: [✅ Send] / [✏️ Edit] / [❌ Cancel]. See Rule 2 for edit sub-flow. |
| 7 | Second Risk Check on Edit | If User A edits the reframe, AI classifies the edited version. If toxic: AI generates a new reframe of the edit (does not block, does not send — iterates). Maximum 3 iterations, then offers Cancel. |
| 8 | Delivery | Only approved, AI-reframed content is delivered to User B. Never raw text. |


| Framework | Implementation in System Prompt |
|---|---|
| Gottman Method | Detect the Four Horsemen: Criticism, Contempt, Defensiveness, Stonewalling. When detected, redirect user toward 'I-statements' and needs-based language. |
| Imago Therapy | Apply Mirror-Validate-Empathize cycle before building toward the other side. 'What I hear you saying is... Does that capture it?' |
| EFT (Emotionally Focused Therapy) | Identify and surface the primary emotion (fear, loneliness, rejection) beneath the presenting secondary emotion (anger, sarcasm). Reflect primary emotion back to user before reframing. |


| Data Type | Detail |
|---|---|
| Session summaries | After each session closes, generate a semantic summary of the conflict theme, primary emotions detected, and communication patterns observed for each user. |
| Pattern embeddings | Embed the summary using the same model used for retrieval (e.g., text-embedding-3-small). Store with metadata: couple_id (anonymized), user_role (A or B), session_timestamp, dominant_emotion_tags. |
| What is NOT stored | Raw transcript text is NOT stored in the vector DB. Only the semantic summary. |


| 📌 PROACTIVE REFLECTION EXAMPLE: When a pattern is detected, the AI may say: 'אני שם לב שנושא העומס חוזר. בפעם הקודמת הבנו שהשורש הוא פחד מחוסר הכרה. האם אנחנו במקום הזה שוב?' — Always frame as a question, not a statement. |
|---|


| State | Description & Transitions |
|---|---|
| PENDING_PARTNER | Session created, User A onboarded. Waiting for User B. Invite link active for 15 minutes. User A in ASYNC_COACHING sub-state. |
| ASYNC_COACHING | User B has not joined or has not responded. Bot coaches User A privately. This is a sub-state, not a terminal state. Max duration: indefinite (until B joins or session expires). |
| ACTIVE | Both users onboarded. Full mediation flow running. Messages flowing through pipeline. |
| PAUSED | One user has been idle for more than 15 minutes. Bot notifies the active user. Bot sends one gentle reminder to the idle user after 15 minutes (configurable). After 12 hours total idle, transitions to CLOSED. |
| CLOSED | Session ended. Summary generated and sent. Data archived. No new messages accepted. Can be re-opened by either user starting a new session. |
| LOCKED | Session locked due to Level 4 risk event or non-payment. Read-only mode. All features disabled except viewing past session summary. |


| Level | Name | Trigger Examples | Bot Action |
|---|---|---|---|
| L1 | LOW — Normal | Frustration, venting, complaints | Standard reframe & coaching flow. Proceed normally. |
| L2 | MEDIUM — Patterns | 'You always...', 'You never...', accusations | Switch to Coaching Mode. Request I-statement reformulation from user before continuing. |
| L3 | HIGH — Toxic | Insults, contempt, personal attacks | Targeted Strike: Stop message pipeline. Private warning to the SENDER only. Bot continues coaching sender. Message is NOT forwarded. Strike is logged but does NOT auto-lock session — AI uses contextual judgment for subsequent messages. |
| L3+ | ATTACHMENT CRISIS | Threats of separation/breakup | Deep-Dive Empathy mode. Bot isolates the threatening user in private dialogue. Goal: surface pain and need behind the threat. Message is NOT forwarded to partner. No session lock. |
| L4 | CRITICAL | Violence, self-harm, threats of harm | HARD STOP. Session locked immediately. Both users receive safety message with emergency resources. Session status → LOCKED. Cannot be unlocked by users. |


| 📌 STRIKE SYSTEM NOTE: There is no fixed strike counter. The AI uses contextual judgment. A single extreme Level 3 event may warrant a strong intervention; repeated mild Level 3 events over a session may escalate the response. The Risk Engine prompt must guide the AI to consider frequency and severity. Log all Level 3+ events in the DB for session review. |
|---|


| Layer | PII Layer | Telemetry & Transcript Layer |
|---|---|---|
| Contains | Telegram User ID, Stripe Customer ID, billing status, invite tokens | Anonymized Couple ID, session transcript summaries, emotion scores (1–5), risk events log, vector embeddings |
| Encryption | Encryption at rest (AES-256). Column-level encryption for Telegram ID and Stripe ID. | Standard DB encryption at rest. No column-level encryption needed (no PII). |
| Link | PII layer stores only the anonymized_couple_id as a foreign key. No content. | Uses anonymized_couple_id only. Never stores Telegram IDs or billing info. |


| Component | Technology & Notes |
|---|---|
| Runtime | Node.js 20 LTS, TypeScript (strict mode) |
| Telegram Adapter | Telegraf v4.x — modular middleware structure. All Telegram logic in /adapters/telegram. No business logic in adapter layer. |
| AI Engine | Anthropic Claude API (claude-3-5-sonnet-20241022). Use the official @anthropic-ai/sdk. Model string must be configurable via env var CLAUDE_MODEL. |
| Audio Transcription | OpenAI Whisper-1 via official openai SDK. |
| Database | PostgreSQL 15+ with pgvector extension. ORM: Prisma or Drizzle (team preference). Two schemas: pii and telemetry. |
| Payments | Stripe Node SDK. Webhook handler with signature verification (STRIPE_WEBHOOK_SECRET env var). |
| Environment | All secrets via .env. Use dotenv. Required vars listed in Section 12. |
| Error Handling | All API calls (Claude, Whisper, Stripe) wrapped in try/catch with retry logic. See Section 13. |


| Variable | Description |
|---|---|
| TELEGRAM_BOT_TOKEN | Telegram Bot API token from @BotFather |
| ANTHROPIC_API_KEY | Anthropic Claude API key |
| CLAUDE_MODEL | Model string, default: claude-3-5-sonnet-20241022 |
| OPENAI_API_KEY | OpenAI API key for Whisper transcription |
| DATABASE_URL | PostgreSQL connection string |
| STRIPE_SECRET_KEY | Stripe secret key |
| STRIPE_WEBHOOK_SECRET | Stripe webhook signing secret |
| INVITE_LINK_TTL_MINUTES | Invite link TTL in minutes (default: 15) |
| IDLE_TIMEOUT_MINUTES | Minutes before session moves to PAUSED (default: 15) |
| SESSION_EXPIRY_HOURS | Hours before PAUSED session closes (default: 12) |
| MAX_IDLE_REMINDERS | Max reminders to idle user (default: 2) |
| VECTOR_SIMILARITY_THRESHOLD | Minimum similarity score for pattern retrieval (default: 0.78) |
| ENCRYPTION_KEY | AES-256 key for PII column encryption (32 bytes, hex encoded) |


| 🔴 ABSOLUTE RULES: The following rules cannot be overridden by any other instruction, business logic, or user request. They are implemented at the code level, not just in prompts. |
|---|


| 📌 NOTE: Use Zod (or equivalent) to validate all environment variables at startup. If a required env var is missing, the application must throw on startup — not fail silently at runtime. |
|---|


| ✅ DOCUMENT END: This is the complete specification. If anything is unclear or missing, STOP and ask before implementing. Do not guess. Do not add scope. |
|---|
