# BRAIN.md — Operational Memory for RuthBot

> This file is the persistent "brain" for development sessions. Read this FIRST if context was lost.
> Last updated: 2026-02-23
> **RULE: Update this file on every significant change (deployment, config, bug fix, new integration)**

---

## Current Status: RUTH V2.2 + INVITE-DELIVERY BUG FIX — READY TO DEPLOY

The bot is **live in production** on Render free tier (webhook mode).
All 12 development phases complete + **RUTH V2 behavioral tuning** + **V2.2 speed optimization** applied.
- **URL:** https://ruthbot.onrender.com
- **Health:** https://ruthbot.onrender.com/health
- **Keep-alive:** UptimeRobot pings /health every 5 min (monitor re-created 2026-02-21)
- **Last deploy:** Commit `64b199b` — RUTH V2 behavioral update

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
- **Tests:** 231 passing, 0 failing

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

### 1. Response Time (~10-15 seconds)
- **Root cause:** 2 sequential Claude Sonnet API calls (risk ~3s + coaching ~7s)
- **Partial fix applied:** Risk classification + DB queries run in parallel via Promise.all
- **Partial fix applied:** Message storage is fire-and-forget (non-blocking)
- **TODO:** Combine risk + coaching into single Claude call (would halve response time)
- **TODO:** Add Telegram "typing" indicator while processing

### 2. Bot Describing Architecture Wrong (FIXED)
- **Problem:** Bot said "שיחה משותפת" / "שניכם יחד בשיחה אחת"
- **Root cause:** System prompt said "Both partners may be in this session"
- **Fix:** Rewrote SESSION MODE + added Guardrail #7 with explicit forbidden phrases in Hebrew
- **Fix:** Updated startHandler User B landing, callbackHandler onboarding text

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
   - Old: "✉️ העתק ושלח" was ambiguous — users assumed bot sent automatically
   - Fix: Explicit ⚠️ warning + "הבוט לא שולח אוטומטית" + 📤 Telegram share button
   - File: `src/adapters/telegram/handlers/callbackHandler.ts` → `handleTtlChoice()`
1. ~~**Speed optimization**~~ — ✅ DONE (combined risk+coaching call)
2. **Stripe setup** — Need non-Israel entity or alternative processor (code gracefully bypasses)
   - **Alternatives:** Lemon Squeezy (international), PayPlus/Tranzila (Israeli processors), Paddle
3. **Resend email setup** — Sign up, get key, verify domain (code gracefully skips when not configured)
4. ~~**Testing**~~ — ✅ DONE (231 tests passing, integration tests + Raz scenario added)
5. ~~**RUTH V2 fine-tuning**~~ — ✅ DONE (Raz scenario verified ≤5 turns to draft)
6. **Deploy V2.2** — Push to GitHub + redeploy on Render
7. **Real-world testing** — Test with actual Telegram conversations

---

## Git State
- **Branch:** master
- **Last commit:** pending — "RUTH V2.2: speed optimization + integration tests"
- **All 12 phases committed and merged + RUTH V2 behavioral tuning**
- **GitHub remote:** https://github.com/shanimosco47-pixel/ruthbot.git
- **Repo visibility:** Public (required for Render free tier without GitHub OAuth)

---

## PRD Documents
- `/docs/CoupleBot_PRD_v2.md` — Main PRD
- `/docs/CoupleBot_PRD_Addendum_v3_Final.md` — Addendum (overrides PRD on conflicts)
