# BRAIN.md — Operational Memory for RuthBot

> מקס 150 שורות. רק מידע שסשן עתידי צריך. היסטוריית גרסאות — ב-git log.
> Last updated: 2026-03-18 (V3.4 memory system)

---

## Current Status: V3.4 — Memory System (deployed)
- **URL:** https://ruthbot.onrender.com
- **Health:** https://ruthbot.onrender.com/health → `v3.4`
- **Keep-alive:** UptimeRobot pings /health every 5 min
- **Tests:** 281 passing, 0 failing
- **Training score:** V2 44→90.3 | V3 benchmark: gpt-4o 7.92 (baseline), gpt-4.1 8.0 (current)

---

## Infrastructure & Credentials

### Telegram Bot
- **Bot:** @RuthCoupleBot (רות בוט זוגיות)
- **Mode:** Polling (dev) / Webhook (prod)
- **Token:** `.env` → `TELEGRAM_BOT_TOKEN`

### Database — Supabase
- **Provider:** Supabase PostgreSQL (free tier)
- **Region:** Ireland (EU West) — `aws-1-eu-west-1` (NOT aws-0!)
- **Pooler port:** 6543 (`DATABASE_URL`) | **Direct port:** 5432 (`DIRECT_URL` — migrations only)
- **Password:** `RuthBot2026db`
- **pgvector:** enabled
- **Prisma:** uses `directUrl` for migrations (pgBouncer compatibility)

### AI — OpenAI (all AI services)
- **LLM Model:** `gpt-4.1` (env: `OPENAI_MODEL`) — upgraded 2026-06-27, +0.08 avg score vs gpt-4o
- **Voice:** Whisper-1 (transcription)
- **Embeddings:** text-embedding-3-small (pgvector)
- **Key:** `.env` → `OPENAI_API_KEY`
- **Note:** Migrated from Anthropic Claude to OpenAI on 2026-03-27

### Encryption
- **Algorithm:** AES-256-GCM (column-level, format: `gcm:iv:authTag:ciphertext`)
- **Key:** `.env` → `ENCRYPTION_KEY` (32 bytes hex)
- **Encrypted fields:** telegramId, name, email, rawContent, reframedContent

### Stripe — NOT CONFIGURED
- Placeholder values in `.env`. Israel not available in Stripe.
- Payment gate bypassed gracefully (first session free).
- **Alternatives:** PayPlus/Tranzila (Israeli), Lemon Squeezy/Paddle (international)

### Email (Resend) — NOT CONFIGURED
- Placeholder in `.env` → `EMAIL_API_KEY`. Emails won't send.
- **TODO:** Sign up at resend.com, get key, verify domain

---

## How to Run

### Dev Mode
```bash
npm run build && node dist/index.js
```

### Important: dotenv Override
dotenv configured with `override: true` to prevent env var shadowing issues.

### Database Reset
```bash
node -e "const{PrismaClient}=require('@prisma/client');const p=new PrismaClient();(async()=>{await p.message.deleteMany({});await p.sessionEmbedding.deleteMany({});await p.riskEvent.deleteMany({});await p.coupleSession.deleteMany({});await p.sessionTelemetry.deleteMany({});await p.user.deleteMany({});await p.\$disconnect();console.log('done')})();"
```

### Prisma Commands
```bash
npx prisma db push     # Push schema to DB
npx prisma generate    # Regenerate client
npx prisma studio      # Visual DB browser
```

---

## Architecture — Key Principles
- **Two separate private chats** — each partner talks to bot privately. Bot is mediator.
- **Raw messages NEVER forwarded** — only AI-reframed, user-approved messages delivered to partner.
- **Pipeline:** Receive → Transcribe → Risk → Coaching → Reframe → Approval → 2nd Risk → Delivery
- **State Machine:** INVITE_CRAFTING → INVITE_PENDING → PENDING_PARTNER_CONSENT → REFLECTION_GATE → ACTIVE → PAUSED → CLOSED → LOCKED (+PARTNER_DECLINED, ASYNC_COACHING)

---

## Known Limitations
- Supabase hostname is `aws-1` not `aws-0`
- Multiple node processes → 409 Conflict (kill stale processes)

---

## Deployment — Render (Free Tier)
- **Service URL:** https://ruthbot.onrender.com
- **Service ID:** srv-d6cv7nvfte5s73d2btp0
- **Build:** `npm install && npx prisma generate && npm run build`
- **Start:** `npm start`
- **GitHub:** https://github.com/shanimosco47-pixel/ruthbot (public)
- **Branch:** master
- **ENV vars:** 19 vars configured in Render dashboard

---

## Memory System (V3.4)
- **UserMemory** table: per-user facts (encrypted AES-256), extracted at session close via OpenAI
- **InterventionOutcome** table: telemetry on reframe approve/edit/cancel (no PII)
- **SessionEmbedding** extended: recurring_themes, intervention_methods, sessionNumber
- **User** extended: totalSessionCount, lastSessionAt
- **Pipeline**: user memory prefetched in parallel, injected into coaching prompt
- **Welcome back**: returning users see session count on /start
- **GDPR**: deleteUserMemories runs in /delete_my_data transaction
- **Training export**: `src/services/memory/trainingExport.ts` — anonymized data for trainer bot
- **Schema change pending**: run `npx prisma db push` on Supabase to apply

## Pending Work
1. **DB push** — `npx prisma db push` to apply new UserMemory + InterventionOutcome tables ⚠️ run from local machine with .env
2. **Render env var** — update `OPENAI_MODEL=gpt-4.1` in Render dashboard (default already set in code)
3. **Prompt surgery** — 6 persistent failures across gpt-4o & gpt-4.1: #24 Male Vulnerability, #25 Ambiguous Gender, #29 Sarcastic Echo, #34 Privacy Breach, #38 Readiness Signal, #50 Regression
4. **Real-world testing** — test with actual Telegram conversations
5. **Stripe/payment** — need Israeli processor or international alternative
6. **Resend email** — sign up, get key, verify domain

---

## Trainer Bot
- **Location:** `C:\Users\shani\OneDrive\trainer_bot`
- **How:** Sends Telegram messages via Telethon (MTProto) to live bot
- **Scenarios:** solo_standard, frustration_detection, couple_full_flow, extended_deep_conversation, eft_dyadic
- **Key files:** `validator.py`, `scenarios/predefined.py`, `workflows/ruth_issues.json`
- **Requires:** deployed bot (tests live, not local)

---

## Git
- **Branch:** master
- **Remote:** https://github.com/shanimosco47-pixel/ruthbot.git
- **Visibility:** Public (required for Render free tier)
