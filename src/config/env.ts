import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

const envSchema = z.object({
  // Telegram
  TELEGRAM_BOT_TOKEN: z.string().min(1, 'TELEGRAM_BOT_TOKEN is required'),
  TELEGRAM_WEBHOOK_SECRET: z.string().optional(),

  // Anthropic Claude
  ANTHROPIC_API_KEY: z.string().min(1, 'ANTHROPIC_API_KEY is required'),
  CLAUDE_MODEL: z.string().default('claude-sonnet-4-20250514'),

  // OpenAI (Whisper)
  OPENAI_API_KEY: z.string().min(1, 'OPENAI_API_KEY is required'),

  // Database
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

  // Stripe
  STRIPE_SECRET_KEY: z.string().min(1, 'STRIPE_SECRET_KEY is required'),
  STRIPE_WEBHOOK_SECRET: z.string().min(1, 'STRIPE_WEBHOOK_SECRET is required'),

  // Email (Resend)
  EMAIL_API_KEY: z.string().min(1, 'EMAIL_API_KEY is required'),

  // Session Configuration
  IDLE_TIMEOUT_MINUTES: z.coerce.number().int().positive().default(15),
  SESSION_EXPIRY_HOURS: z.coerce.number().int().positive().default(12),
  MAX_IDLE_REMINDERS: z.coerce.number().int().positive().default(2),

  // Vector Similarity
  VECTOR_SIMILARITY_THRESHOLD: z.coerce.number().min(0).max(1).default(0.78),

  // Encryption
  ENCRYPTION_KEY: z.string().length(64, 'ENCRYPTION_KEY must be 64 hex characters (32 bytes)'),

  // App
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  WEBHOOK_URL: z.string().url().optional(),
});

export type Env = z.infer<typeof envSchema>;

function validateEnv(): Env {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    const errors = result.error.format();
    const errorMessages = Object.entries(errors)
      .filter(([key]) => key !== '_errors')
      .map(([key, value]) => {
        const errorValue = value as { _errors?: string[] };
        return `  ${key}: ${errorValue._errors?.join(', ') ?? 'Invalid'}`;
      })
      .join('\n');

    throw new Error(
      `\n❌ Environment validation failed:\n${errorMessages}\n\nCheck your .env file against .env.example\n`
    );
  }

  return result.data;
}

export const env = validateEnv();
