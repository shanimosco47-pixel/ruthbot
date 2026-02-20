/**
 * Jest setup file — runs before each test suite.
 * Sets environment variables needed by env.ts Zod validation.
 */
process.env.TELEGRAM_BOT_TOKEN = 'test-bot-token';
process.env.ANTHROPIC_API_KEY = 'test-anthropic-key';
process.env.OPENAI_API_KEY = 'test-openai-key';
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/couplebot_test';
process.env.STRIPE_SECRET_KEY = 'sk_test_fake';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_fake';
process.env.EMAIL_API_KEY = 're_test_fake';
process.env.ENCRYPTION_KEY = 'a'.repeat(64); // 64 hex chars = 32 bytes AES-256
process.env.NODE_ENV = 'test';
process.env.PORT = '3001';
