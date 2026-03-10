import crypto from 'crypto';
import { env } from '../config/env';

// AES-256-GCM: Authenticated encryption (AEAD) — provides integrity + confidentiality
const ALGORITHM_GCM = 'aes-256-gcm';
const GCM_IV_LENGTH = 12; // NIST recommended IV length for GCM
const AUTH_TAG_LENGTH = 16; // 128-bit authentication tag

// Legacy CBC support for decrypting old data (pre-migration)
const ALGORITHM_CBC = 'aes-256-cbc';

function getKey(): Buffer {
  return Buffer.from(env.ENCRYPTION_KEY, 'hex');
}

export function encrypt(text: string): string {
  const iv = crypto.randomBytes(GCM_IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM_GCM, getKey(), iv, { authTagLength: AUTH_TAG_LENGTH });
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');
  // Format: gcm:iv:authTag:ciphertext (prefix distinguishes from legacy CBC format)
  return `gcm:${iv.toString('hex')}:${authTag}:${encrypted}`;
}

export function decrypt(encryptedText: string): string {
  if (encryptedText.startsWith('gcm:')) {
    // GCM format: gcm:iv:authTag:ciphertext
    const parts = encryptedText.split(':');
    if (parts.length < 4) {
      throw new Error('Invalid GCM encrypted text format');
    }
    const [, ivHex, authTagHex, ...encryptedParts] = parts;
    const encrypted = encryptedParts.join(':'); // rejoin in case ciphertext contained ':'
    if (!ivHex || !authTagHex) {
      throw new Error('Invalid GCM encrypted text format');
    }
    // Note: encrypted can be empty string for empty plaintext — that's valid for GCM
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    const decipher = crypto.createDecipheriv(ALGORITHM_GCM, getKey(), iv, { authTagLength: AUTH_TAG_LENGTH });
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  }

  // Legacy CBC format: iv:ciphertext (backward compatibility for existing DB data)
  const [ivHex, encrypted] = encryptedText.split(':');
  if (!ivHex || !encrypted) {
    throw new Error('Invalid encrypted text format');
  }
  const iv = Buffer.from(ivHex, 'hex');
  const decipher = crypto.createDecipheriv(ALGORITHM_CBC, getKey(), iv);
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

/**
 * Derive a separate HMAC key from the AES key to avoid key reuse.
 * Using the same key for both AES-CBC and HMAC weakens both operations.
 */
function getHmacKey(): Buffer {
  return crypto.createHash('sha256').update(Buffer.concat([getKey(), Buffer.from('hmac-key-derivation')])).digest();
}

/**
 * Generate a deterministic HMAC-SHA256 hash for lookup.
 * Used to find encrypted records without decrypting every row.
 */
export function hmacHash(text: string): string {
  return crypto.createHmac('sha256', getHmacKey()).update(text).digest('hex');
}

export function generateInviteToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

export function generateAnonymizedCoupleId(): string {
  return crypto.randomUUID();
}
