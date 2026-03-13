import * as fs from 'fs';
import * as path from 'path';

/**
 * Human-readable chat logger.
 *
 * Writes every user message and bot response to logs/chat.log
 * in a simple, readable format for debugging and analysis.
 *
 * Format:
 *   [2026-03-13 14:30:05] 👤 User A (telegram:123456):
 *   ראיתי טלוויזיה
 *
 *   [2026-03-13 14:30:07] 🤖 Ruth:
 *   מה קרה אחרי שצפית בטלוויזיה?
 *
 *   [2026-03-13 14:30:07] 📝 Reframe:
 *   ראיתי טלוויזיה ולא שמתי לב...
 */

const LOG_DIR = path.join(process.cwd(), 'logs');
const LOG_FILE = path.join(LOG_DIR, 'chat.log');

function ensureLogDir(): void {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
}

function timestamp(): string {
  return new Date().toLocaleString('he-IL', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

function appendToLog(text: string): void {
  try {
    ensureLogDir();
    fs.appendFileSync(LOG_FILE, text + '\n', 'utf-8');
  } catch {
    // Non-critical — never crash the bot over logging
  }
}

export function logUserMessage(params: {
  telegramId: string;
  userName?: string;
  role: string;
  sessionId: string;
  text: string;
}): void {
  const { telegramId, userName, role, sessionId, text } = params;
  const roleLabel = role === 'USER_A' ? 'User A' : 'User B';
  const nameTag = userName ? ` (${userName})` : '';
  appendToLog(
    `[${timestamp()}] 👤 ${roleLabel}${nameTag} [tg:${telegramId}] [session:${sessionId.slice(0, 8)}]:\n${text}\n`
  );
}

export function logBotCoaching(params: {
  sessionId: string;
  text: string;
}): void {
  appendToLog(
    `[${timestamp()}] 🤖 Ruth [session:${params.sessionId.slice(0, 8)}]:\n${params.text}\n`
  );
}

export function logReframe(params: {
  sessionId: string;
  text: string;
}): void {
  appendToLog(
    `[${timestamp()}] 📝 Reframe [session:${params.sessionId.slice(0, 8)}]:\n${params.text}\n`
  );
}

export function logSystemEvent(params: {
  sessionId: string;
  event: string;
}): void {
  appendToLog(
    `[${timestamp()}] ⚙️ System [session:${params.sessionId.slice(0, 8)}]: ${params.event}\n`
  );
}

export function logSessionSeparator(sessionId: string, status: string): void {
  appendToLog(
    `\n${'═'.repeat(60)}\n` +
    `Session: ${sessionId} | Status: ${status}\n` +
    `${'═'.repeat(60)}\n`
  );
}
