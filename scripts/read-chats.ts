/**
 * read-chats.ts — Fetch and display recent Telegram conversations from Supabase DB.
 *
 * Usage:
 *   npm run read-chats                     # last 24 hours
 *   npm run read-chats -- --hours 48       # last 48 hours
 *   npm run read-chats -- --count 100      # last 100 messages
 *   npm run read-chats -- --session abc    # filter by session ID prefix
 *   npm run read-chats -- --write          # also write to logs/chat.log
 *
 * Requires: DATABASE_URL + ENCRYPTION_KEY in .env
 */

import dotenv from 'dotenv';
import crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { PrismaClient } from '@prisma/client';

dotenv.config({ override: true });

// ── Inline decrypt (avoids importing full app env validation) ──

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY;
if (!ENCRYPTION_KEY || ENCRYPTION_KEY.length !== 64) {
  console.error('❌ ENCRYPTION_KEY missing or invalid in .env (expected 64 hex chars)');
  process.exit(1);
}

function getKey(): Buffer {
  return Buffer.from(ENCRYPTION_KEY!, 'hex');
}

function decrypt(encryptedText: string): string {
  if (encryptedText.startsWith('gcm:')) {
    const parts = encryptedText.split(':');
    if (parts.length < 4) throw new Error('Invalid GCM format');
    const [, ivHex, authTagHex, ...encryptedParts] = parts;
    const encrypted = encryptedParts.join(':');
    if (!ivHex || !authTagHex) throw new Error('Invalid GCM format');
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    const decipher = crypto.createDecipheriv('aes-256-gcm', getKey(), iv, { authTagLength: 16 });
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  }

  if (encryptedText.split(':').length === 3) {
    const [ivHex, encrypted, authTagHex] = encryptedText.split(':');
    if (!ivHex || encrypted === undefined || !authTagHex) throw new Error('Invalid format');
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    const decipher = crypto.createDecipheriv('aes-256-gcm', getKey(), iv) as crypto.DecipherGCM;
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  }

  const [ivHex, encrypted] = encryptedText.split(':');
  if (!ivHex || !encrypted) throw new Error('Invalid format');
  const iv = Buffer.from(ivHex, 'hex');
  const decipher = crypto.createDecipheriv('aes-256-cbc', getKey(), iv);
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

function tryDecrypt(text: string | null): string {
  if (!text) return '[empty]';
  try {
    return decrypt(text);
  } catch {
    return '[DECRYPTION FAILED]';
  }
}

// ── CLI args ──

interface Args {
  hours: number;
  count?: number;
  sessionId?: string;
  write: boolean;
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const args: Args = { hours: 24, write: false };

  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case '--hours':
        args.hours = parseInt(argv[++i], 10);
        if (isNaN(args.hours)) { console.error('Invalid --hours value'); process.exit(1); }
        break;
      case '--count':
        args.count = parseInt(argv[++i], 10);
        if (isNaN(args.count)) { console.error('Invalid --count value'); process.exit(1); }
        break;
      case '--session':
        args.sessionId = argv[++i];
        break;
      case '--write':
        args.write = true;
        break;
      default:
        console.error(`Unknown flag: ${argv[i]}`);
        process.exit(1);
    }
  }
  return args;
}

// ── Formatting ──

function formatTimestamp(date: Date): string {
  return date.toLocaleString('he-IL', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  });
}

function roleEmoji(messageType: string, senderRole: string): string {
  switch (messageType) {
    case 'COACHING': return '🤖 Ruth';
    case 'REFRAME': return '📝 Reframe';
    case 'SYSTEM': return '⚙️ System';
    default: return `👤 ${senderRole === 'USER_A' ? 'User A' : 'User B'}`;
  }
}

// ── Main ──

async function main(): Promise<void> {
  const args = parseArgs();
  const prisma = new PrismaClient();

  try {
    // Build query filter
    const where: Record<string, unknown> = {};

    if (args.count) {
      // When using --count, we don't filter by time
    } else {
      where.createdAt = { gte: new Date(Date.now() - args.hours * 3600_000) };
    }

    if (args.sessionId) {
      where.sessionId = { startsWith: args.sessionId };
    }

    // Fetch messages
    const messages = await prisma.message.findMany({
      where,
      orderBy: { createdAt: args.count ? 'desc' : 'asc' },
      take: args.count || undefined,
      include: {
        session: {
          include: {
            userA: { select: { id: true, name: true } },
            userB: { select: { id: true, name: true } },
          },
        },
      },
    });

    // If --count, reverse to chronological order
    if (args.count) messages.reverse();

    if (messages.length === 0) {
      const msg = args.count
        ? 'No messages found.'
        : `No messages found in the last ${args.hours} hours.`;
      console.log(msg);
      return;
    }

    // Group by session
    const sessions = new Map<string, typeof messages>();
    for (const msg of messages) {
      const list = sessions.get(msg.sessionId) || [];
      list.push(msg);
      sessions.set(msg.sessionId, list);
    }

    // Format output
    const lines: string[] = [];

    for (const [sessionId, msgs] of sessions) {
      const session = msgs[0].session;
      const userAName = tryDecrypt(session.userA?.name ?? null);
      const userBName = session.userB ? tryDecrypt(session.userB.name ?? null) : '[not joined]';

      lines.push('');
      lines.push('═'.repeat(60));
      lines.push(`Session: ${sessionId.slice(0, 8)}... | Status: ${session.status}`);
      lines.push(`User A: ${userAName} | User B: ${userBName}`);
      lines.push('═'.repeat(60));
      lines.push('');

      for (const msg of msgs) {
        const ts = formatTimestamp(msg.createdAt);
        const role = roleEmoji(msg.messageType, msg.senderRole);
        const content = tryDecrypt(msg.rawContent);

        lines.push(`[${ts}] ${role}:`);
        lines.push(content);
        lines.push('');
      }
    }

    const output = lines.join('\n');
    console.log(output);

    console.log(`\n--- ${messages.length} messages across ${sessions.size} session(s) ---`);

    // Write to file if requested
    if (args.write) {
      const logDir = path.join(process.cwd(), 'logs');
      if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
      const logFile = path.join(logDir, 'chat.log');
      fs.writeFileSync(logFile, output, 'utf-8');
      console.log(`✅ Written to ${logFile}`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
