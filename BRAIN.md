# BRAIN.md — Operational Memory for RuthBot

> This file is the persistent "brain" for development sessions. Read this FIRST if context was lost.
> Last updated: 2026-02-21

---

## Current Status: MVP RUNNING IN DEV MODE

The bot is **built and functional** in development mode (Telegram polling).
All 12 development phases are complete. Not yet deployed to production.

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

## Pending Work (Priority Order)

1. **Speed optimization** — Combine risk + coaching into single Claude call
2. **Stripe setup** — Need non-Israel entity or alternative processor
3. **Resend email setup** — Sign up, get key, verify domain
4. **Production deployment** — Webhook mode, HTTPS, process manager
5. **Testing** — Unit tests pass, need integration testing with real conversations

---

## Git State
- **Branch:** main
- **Last commit:** `e724699` — "fix: resolve 10 production gaps"
- **All 12 phases committed and merged**

---

## PRD Documents
- `/docs/CoupleBot_PRD_v2.md` — Main PRD
- `/docs/CoupleBot_PRD_Addendum_v3_Final.md` — Addendum (overrides PRD on conflicts)
