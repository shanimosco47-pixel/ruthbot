import crypto from 'crypto';
import { env } from '../config/env';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // GCM standard: 12 bytes (96 bits)
// Legacy CBC support for reading old data during migration
const LEGACY_ALGORITHM = 'aes-256-cbc';

function getKey(): Buffer {
  return Buffer.from(env.ENCRYPTION_KEY, 'hex');
}

export function encrypt(text: string): string {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv) as crypto.CipherGCM;
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');
  // Format: iv:encrypted:authTag (3 parts = GCM)
  return `${iv.toString('hex')}:${encrypted}:${authTag}`;
}

export function decrypt(encryptedText: string): string {
  const parts = encryptedText.split(':');

  if (parts.length === 3) {
    // GCM format: iv:encrypted:authTag
    const [ivHex, encrypted, authTagHex] = parts;
    if (!ivHex || encrypted === undefined || !authTagHex) {
      throw new Error('Invalid encrypted text format');
    }
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    const decipher = crypto.createDecipheriv(ALGORITHM, getKey(), iv) as crypto.DecipherGCM;
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } else if (parts.length === 2) {
    // Legacy CBC format: iv:encrypted (2 parts)
    const [ivHex, encrypted] = parts;
    if (!ivHex || !encrypted) {
      throw new Error('Invalid encrypted text format');
    }
    const iv = Buffer.from(ivHex, 'hex');
    const decipher = crypto.createDecipheriv(LEGACY_ALGORITHM, getKey(), iv);
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } else {
    throw new Error('Invalid encrypted text format');
  }
}

/**
 * Derive a separate HMAC key from the AES key to avoid key reuse.
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
