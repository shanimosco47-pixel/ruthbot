# BRAIN.md — Operational Memory for RuthBot

> מקס 150 שורות. רק מידע שסשן עתידי צריך. היסטוריית גרסאות — ב-git log.
> Last updated: 2026-03-18 (V3.3 deployed)

---

## Current Status: V3.3 — LIVE ON RENDER
- **URL:** https://ruthbot.onrender.com
- **Health:** https://ruthbot.onrender.com/health → `v3.3`
- **Keep-alive:** UptimeRobot pings /health every 5 min
- **Tests:** 262 passing, 0 failing
- **Training score:** V2 44→90.3 | V3 benchmark 7.38 pessimistic (est. 7.9-8.4)

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

### AI — Anthropic Claude
- **Model:** `claude-sonnet-4-20250514`
- **IMPORTANT:** Haiku models NOT available (404). Only Sonnet works.
- **Key:** `.env` → `ANTHROPIC_API_KEY`

### AI — OpenAI
- **Used for:** Whisper-1 (voice) + text-embedding-3-small (pgvector)
- **Key:** `.env` → `OPENAI_API_KEY`

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
Empty `ANTHROPIC_API_KEY` env var blocks dotenv. Fix already in code: `dotenv.config({ override: true })`

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
- Haiku models return 404 — use Sonnet only
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

## Pending Work
1. **Real-world testing** — test with actual Telegram conversations
2. **Stripe/payment** — need Israeli processor or international alternative
3. **Resend email** — sign up, get key, verify domain
4. **Continue training** — run trainer_bot on V3.3

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
