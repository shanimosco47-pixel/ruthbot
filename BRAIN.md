# BRAIN.md — Operational Memory for RuthBot

> This file is the persistent "brain" for development sessions. Read this FIRST if context was lost.
> Last updated: 2026-02-28 (V2.5 session close fix)
> **RULE: Update this file on every significant change (deployment, config, bug fix, new integration)**

---

## Current Status: RUTH V2.4 — DEPLOYED ✅

The bot is **live in production** on Render free tier (webhook mode).
All 12 development phases complete + V2 behavioral tuning + V2.2 speed + V2.3 trainer fixes + V2.4 training quality fixes + **V2.5 session close fix + architecture fix**.
- **URL:** https://ruthbot.onrender.com
- **Health:** https://ruthbot.onrender.com/health
- **Keep-alive:** UptimeRobot pings /health every 5 min (monitor re-created 2026-02-21)
- **Last deploy:** 2026-02-28 — Commit `de076fe` — RUTH V2.4 training fixes (V2.5 pending deploy)
- **Training score:** 44 → 90.3 across 13 training runs

### RUTH V2.5 Session Close & Architecture Fix (2026-02-28)
- **Session summary appearing mid-flow BUG:** Fixed `orchestrateSessionClose()` firing for old sessions while user is in new session
  - Root cause 1: `/stop` fires orchestration async → user starts new session → old summary arrives mid-flow
  - Root cause 2: Periodic task queried ALL sessions closed in last 6 min (not just the ones it closed) → double-fire
  - Root cause 3: No guard against duplicate orchestration
- **Fix 1 — Atomic guard:** Added `closeOrchestrated` boolean to `CoupleSession` Prisma schema
  - `orchestrateSessionClose()` now uses atomic `updateMany` with `closeOrchestrated: false` as compare-and-swap
  - Prevents any duplicate orchestration regardless of trigger source
- **Fix 2 — Periodic task:** `closeExpiredSessions()` now returns `string[]` (session IDs) instead of `number`
  - Periodic task uses returned IDs directly — no more stale "recently closed" query
- **Fix 3 — Newer session guard:** Before sending Telegram summary, checks `hasNewerActiveSession()`
  - If user already has a newer active session, skips Telegram notification (embeddings/telemetry still run)
- **Chat architecture fix** (commit `d898342`):
  - Rewrote SESSION MODE and GUARDRAILS in system prompt to explicitly explain separate private chats
  - Added 14 forbidden architecture phrases to `responseValidator.ts` with auto-correction
  - Added architecture explanation to invite message in `callbackHandler.ts`
- **Files modified:** `prisma/schema.prisma`, `sessionCloseOrchestrator.ts`, `sessionStateMachine.ts`, `index.ts`
- **Tests:** 231 passing, 0 failing

### RUTH V2.4 Training Quality Fixes (2026-02-28)
- **Draft double-question fix:** Removed extra `"מה דעתך?"` appended to draft responses in `messageHandler.ts`
  - Root cause: draft phase appended question on top of Claude's already-included question → RULE 2 violation
  - Fixed in TWO locations: `handleActiveSessionMessage` and `handleCoachingMessage`
- **Implicit question detection:** Added Hebrew imperative patterns to `responseValidator.ts`
  - Patterns: ספרי לי, שתפי אותי, תני דוגמה, דמייני, etc.
  - `isImplicitQuestion()` + `IMPLICIT_QUESTION_PATTERNS` array
  - `removeExtraQuestions()` now strips implicit questions after first explicit `?`
- **Prompt strengthening:** RULE 2 upgraded to "EXACTLY 1 question mark (?)" in 3 locations in `systemPrompts.ts`
- **User B consent button:** Standardized to `✅ אני מבין/ה ומסכים/ה` (was `📜 קראתי והבנתי — אני מוכן/ה להתחיל`)
  - This was root cause of couple_full_flow cascade failure
- **Prompt caching:** Added Anthropic `cache_control: { type: 'ephemeral' }` to `claudeClient.ts`
  - System prompt split into static/dynamic parts via `SplitSystemPrompt` interface
  - ~90% input token savings on repeated calls
- **Summary caching:** In-memory 30-min TTL cache in `sessionCloseOrchestrator.ts` for email opt-in
- **Memory service optimization:** Combined 2 Claude calls into 1 `callClaudeJSON` in `memoryService.ts`
- **Tests:** 231 passing, 0 failing

### RUTH V2.3 Trainer Bot Fixes (2026-02-25)
- First round of trainer bot compatibility fixes
- Commits: `8bcf5c9`, `bfe75c9`, `7a1fbba`

### RUTH V2.2 Speed Optimization (2026-02-23)
- **Combined risk+coaching:** Single Claude API call replaces 2 sequential calls
  - Before: risk (~3s) + coaching (~7s) = ~10-15s
  - After: combined (~7s) = ~5-8s total
- **New function:** `classifyRiskAndCoach()` in `riskEngine.ts`
- **New prompt:** `buildCombinedRiskCoachingPrompt()` in `systemPrompts.ts`
- **Pipeline rewrite:** `messagePipeline.ts` now uses combined call for non-frustrated users
- **Frustration fast path:** Frustrated users get quick risk-only call + menu (~3s)
- **Bug fix:** Frustration detection false positive — "בדיוק" no longer triggers "די"
  - Short word triggers now use word-boundary matching
- **Stripe graceful degradation:** Placeholder API keys bypass payment (returns free)
- **Resend graceful degradation:** Placeholder API keys skip email sends with warning log
- **Removed:** `handleHighRisk()` function (redundant — combined call handles L3/L3_PLUS)
- **New tests:** Integration tests + Raz scenario (≤8 turns verification)
  - `src/__tests__/integration/conversationFlow.test.ts`

### RUTH V2 Behavioral Changes (2026-02-21)
- **System Prompt:** Replaced with RUTH V2 BEHAVIORAL OVERRIDE
- **Word limit:** Max 55 Hebrew words per message (enforced in prompt + code)
- **Question limit:** Max 1 question per message (code strips extras)
- **Fast intake:** 4 turns max, then auto-draft
- **Draft trigger:** At turn 5+ generates message draft + approval request
- **Frustration detection:** Hebrew trigger words → 3-option menu (no therapy)
- **Message templates:** Apology / Boundary / Future Rule
- **New file:** `src/utils/responseValidator.ts`
- **Modified:** `src/services/ai/systemPrompts.ts`, `src/core/pipeline/messagePipeline.ts`

---

## Infrastructure & Credentials

### Telegram Bot
- **Bot username:** @RuthCoupleBot
- **Bot name:** רות בוט זוגיות
- **Mode:** Polling (dev) / Webhook (prod)
- **Token location:** `.env` → `TELEGRAM_BOT_TOKEN`

### Database — Supabase (Free Tier)
- **Provider:** Supabase PostgreSQL
- **Project ID:** `xtfkawnlbrgvqbisbltr`
- **Region:** Ireland (EU West) — `aws-1-eu-west-1`
- **Pooler (pgBouncer) port:** 6543 (used for `DATABASE_URL`)
- **Direct port:** 5432 (used for `DIRECT_URL` — Prisma migrations only)
- **Hostname pattern:** `aws-1-eu-west-1.pooler.supabase.com` (NOT `aws-0`!)
- **DB password:** `RuthBot2026db`
- **pgvector:** Enabled via `CREATE EXTENSION vector`
- **Connection strings:** See `.env` → `DATABASE_URL` and `DIRECT_URL`
- **Prisma schema:** Uses `directUrl` for migrations (required for pgBouncer compatibility)

### AI — Anthropic Claude
- **Model:** `claude-sonnet-4-20250514`
- **IMPORTANT:** Haiku models are NOT available on this API key (404 error). Only Sonnet works.
- **Key location:** `.env` → `ANTHROPIC_API_KEY`
- **Retry policy:** Exponential backoff, max 2 retries (1s, 2s)

### AI — OpenAI (Whisper only)
- **Used for:** Voice transcription (Whisper-1) + text-embedding-3-small (pgvector)
- **Key location:** `.env` → `OPENAI_API_KEY`

### Stripe — NOT CONFIGURED
- **Status:** Placeholder values in `.env`
- **Reason:** Israel is not available as a country in Stripe signup
- **Impact:** Payment gate is bypassed (first session is free, subsequent sessions will fail payment check gracefully)
- **TODO:** Set up Stripe via US entity or use alternative payment processor

### Email (Resend) — NOT CONFIGURED
- **Status:** Placeholder value in `.env` → `EMAIL_API_KEY`
- **Impact:** Session summary emails won't send
- **TODO:** Sign up at resend.com, get API key, verify domain

### Encryption
- **Algorithm:** AES-256-GCM (column-level encryption for PII)
- **Key location:** `.env` → `ENCRYPTION_KEY` (32 bytes hex)
- **Encrypted fields:** telegramId, name, email, rawContent, reframedContent

---

## How to Run

### Dev Mode (Polling)
```bash
cd C:\Users\shani\OneDrive\couplebot
npm run build && node dist/index.js
```

### Important: dotenv Override
The system has an empty `ANTHROPIC_API_KEY` environment variable that blocks dotenv loading.
**Fix is already in code:** `dotenv.config({ override: true })` in `src/config/env.ts`

### Kill Stale Processes
```bash
taskkill //F //IM node.exe
```
Multiple node processes cause a 409 Conflict error from Telegram (only one polling connection allowed).

### Database Reset (Full Wipe)
```bash
node -e "
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
(async()=>{
  await p.message.deleteMany({});
  await p.sessionEmbedding.deleteMany({});
  await p.riskEvent.deleteMany({});
  await p.coupleSession.deleteMany({});
  await p.sessionTelemetry.deleteMany({});
  await p.user.deleteMany({});
  await p.\$disconnect();
  console.log('DB wiped');
})();
"
```

### Prisma Commands
```bash
npx prisma db push          # Push schema to DB (no migration files)
npx prisma generate          # Regenerate client after schema changes
npx prisma studio            # Visual DB browser (localhost:5555)
```

---

## Architecture Summary

### Tech Stack
- Runtime: Node.js 20 LTS, TypeScript strict
- Bot: Telegraf v4.x
- AI: Anthropic Claude (Sonnet) + OpenAI Whisper
- DB: PostgreSQL 15+ (Supabase) with pgvector
- ORM: Prisma
- Billing: Stripe (not yet configured)
- Email: Resend (not yet configured)

### Directory Structure
```
src/
  adapters/telegram/handlers/    ← Telegraf handlers (messageHandler, callbackHandler, startHandler, etc.)
  core/pipeline/                 ← 8-step message pipeline
  core/stateMachine/             ← Session state management
  services/ai/                   ← Claude API client + system prompts
  services/risk/                 ← Risk Engine (L1-L4 classification)
  services/memory/               ← pgvector embeddings & pattern retrieval
  services/voice/                ← Whisper integration
  services/billing/              ← Stripe webhooks
  services/email/                ← Resend integration
  db/                            ← Prisma client
  config/                        ← env validation, constants
  utils/                         ← encryption, logger, helpers
```

### Key Architecture Principle: TWO SEPARATE PRIVATE CHATS
- Each partner talks to the bot in their own private Telegram chat
- The bot is the MEDIATOR — never a group chat
- Raw messages from User A are NEVER forwarded to User B
- Only AI-reframed, user-approved messages are delivered to the partner
- System prompt explicitly forbids phrases like "שיחה משותפת" or "שניכם יחד"

### Message Pipeline (8 Steps)
1. Receive → 2. Transcribe (voice) → 3. Risk Classification → 4. Coaching → 5. Reframe → 6. Approval → 7. Second Risk Check (on edit) → 8. Delivery

### Session State Machine
```
INVITE_CRAFTING → INVITE_PENDING → PENDING_PARTNER_CONSENT → REFLECTION_GATE → ACTIVE → PAUSED → CLOSED → LOCKED
                                                              ↘ PARTNER_DECLINED
ASYNC_COACHING (parallel solo mode for User A)
```

---

## Known Issues & Fixes Applied

### 1. Response Time — FIXED (V2.2)
- **Root cause:** Was 2 sequential Claude Sonnet API calls (risk ~3s + coaching ~7s)
- **Fix:** Combined into single `classifyRiskAndCoach()` call (~5-8s total)
- **Fix:** Risk classification + DB queries run in parallel via Promise.all
- **Fix:** Message storage is fire-and-forget (non-blocking)
- **Fix (V2.4):** Prompt caching reduces input tokens ~90% on repeated calls

### 2. Bot Describing Architecture Wrong — FIXED (V2.5)
- **Problem:** Bot said "שיחה משותפת" / "שניכם יחד בשיחה אחת" / "אתם תהיו יחד בקבוצה משותפת"
- **Root cause:** Old Guardrail #7 told Claude "The technical separation of chats is invisible to users" → Claude actively hid/denied the architecture
- **Fix (3 layers):**
  - Layer 1: Rewrote SESSION MODE + CHAT ARCHITECTURE section in system prompts with explicit forbidden phrases
  - Layer 2: Added `replaceForbiddenPhrases()` in `responseValidator.ts` with 14 forbidden phrases + auto-correction
  - Layer 3: Added architecture explanation to invite message in `callbackHandler.ts`

### 2b. Session Summary Appearing Mid-Flow — FIXED (V2.5)
- **Problem:** After clicking "להזמין עכשיו", session summary from old session appeared in chat
- **Root cause:** `/stop` fires `orchestrateSessionClose()` async → user starts new session → old summary arrives
- **Root cause 2:** Periodic task queried ALL recently closed sessions (not just ones it closed)
- **Fix:** Atomic `closeOrchestrated` flag, `closeExpiredSessions()` returns IDs, `hasNewerActiveSession()` guard

### 3. Bot Insisting on Inviting Partner in Solo Mode (FIXED)
- **Problem:** In ASYNC_COACHING mode, bot kept suggesting to invite partner
- **Fix:** Added `sessionStatus` parameter to coaching prompt, explicit solo mode instructions + Guardrail #6

### 4. Supabase Connection Issues (FIXED)
- **Hostname:** `aws-1-eu-west-1` not `aws-0-eu-west-1`
- **IPv6:** Direct connection fails on IPv6-only DNS. Use pooler (port 6543) for runtime.
- **Password:** Reset to `RuthBot2026db` (no special chars) to avoid URL encoding issues
- **pgBouncer:** Requires `directUrl` in Prisma schema for migrations

### 5. Haiku Model Not Available (KNOWN)
- `claude-3-5-haiku-20241022` and `claude-3-haiku-20240307` both return 404
- API key only has access to Sonnet models
- All calls use `claude-sonnet-4-20250514`

### 6. Embedding Column (FIXED)
- `session_embeddings.embedding` vector column had to be added via `prisma.$executeRawUnsafe`
- `ALTER TABLE` via `prisma db execute` didn't persist

---

## Deployment — Render Free Tier (LIVE ✅)

### Infrastructure
- **Platform:** Render.com (free tier)
- **Service URL:** https://ruthbot.onrender.com
- **Service ID:** srv-d6cv7nvfte5s73d2btp0
- **Region:** Frankfurt (EU Central) — close to Supabase (EU West)
- **Mode:** Webhook (production) — auto-registers with Telegram on startup
- **Keep-alive:** UptimeRobot pings `/health` every 5 min to prevent sleeping
- **Database:** Stays on Supabase (no change)

### GitHub
- **Repo:** https://github.com/shanimosco47-pixel/ruthbot (public — needed for Render free tier)
- **Branch:** master
- **Auto-deploy:** No (public repo, manual deploy)

### Render Settings
- **Build Command:** `npm install && npx prisma generate && npm run build`
- **Start Command:** `npm start`
- **Node version:** 20
- **Instance type:** Free (512MB RAM, 0.1 CPU)

### Deployed Environment Variables
Same as `.env` with:
- `NODE_ENV` = `production`
- `WEBHOOK_URL` = `https://ruthbot.onrender.com`

### Deploy Checklist
- [x] Push to GitHub
- [x] Create Render Web Service
- [x] Set environment variables (19 vars)
- [x] Deploy & verify (webhook mode active)
- [x] Set up UptimeRobot keep-alive

---

## Pending Work (Priority Order)

1. ~~**Invite delivery bug fix**~~ — ✅ DONE (2026-02-24)
2. ~~**Speed optimization**~~ — ✅ DONE (V2.2 combined risk+coaching)
3. ~~**RUTH V2 fine-tuning**~~ — ✅ DONE (V2.3/V2.4 training score: 90.3)
4. ~~**Deploy V2.4**~~ — ✅ DONE (2026-02-28, commit `de076fe`)
5. ~~**Architecture fix + session close bug**~~ — ✅ DONE (V2.5, commits `d898342` + pending)
6. **Deploy V2.5** — Push + deploy on Render
7. **Continue training** — Run trainer_bot to validate V2.5 fixes (especially couple_full_flow)
8. **Stripe setup** — Need non-Israel entity or alternative processor (code gracefully bypasses)
   - **Alternatives:** Lemon Squeezy (international), PayPlus/Tranzila (Israeli processors), Paddle
9. **Resend email setup** — Sign up, get key, verify domain (code gracefully skips when not configured)
10. **Real-world testing** — Test with actual Telegram conversations

---

## Trainer Bot Integration

- **Location:** `C:\Users\shani\OneDrive\trainer_bot`
- **How it works:** Sends real Telegram messages to the live bot via Telethon (MTProto)
- **Validates:** RUTH V2 rules (word count, questions, buttons, forbidden phrases)
- **5 predefined scenarios:** solo_standard, frustration_detection, couple_full_flow, extended_deep_conversation, eft_dyadic
- **8 personas:** anxious pursuer, avoidant withdrawer, acute crisis, skeptic, financial conflict, parenting clash, boundary violator, deep emotional
- **Deploy required:** YES — trainer tests the LIVE deployed bot, not local code
- **Button alignment verified:** All button texts in trainer scenarios match Ruth's code (verified 2026-02-28)
- **Key files with hardcoded expectations:**
  - `validator.py` — rules, word limits, button substrings
  - `scenarios/predefined.py` — exact button labels per step
  - `workflows/ruth_issues.json` — issue tracker
- **Training log:** `ruth_training_log.md` (in couplebot repo)

## Git State
- **Branch:** master
- **Last commit:** (pending) — RUTH V2.5: session close fix + architecture fix
- **Previous commits:** `a04e55b` (BRAIN.md update), `d898342` (architecture fix), `de076fe` (V2.4)
- **All 12 phases committed and merged + V2 → V2.5 iterations**
- **GitHub remote:** https://github.com/shanimosco47-pixel/ruthbot.git
- **Repo visibility:** Public (required for Render free tier without GitHub OAuth)

---

## PRD Documents
- `/docs/CoupleBot_PRD_v2.md` — Main PRD
- `/docs/CoupleBot_PRD_Addendum_v3_Final.md` — Addendum (overrides PRD on conflicts)
