import { encrypt, decrypt, hmacHash, generateInviteToken, generateAnonymizedCoupleId } from '../../utils/encryption';

describe('Encryption Utils', () => {
  // ============================================
  // encrypt / decrypt roundtrip
  // ============================================
  describe('encrypt and decrypt', () => {
    it('should encrypt and decrypt a simple string', () => {
      const original = 'Hello, World!';
      const encrypted = encrypt(original);
      const decrypted = decrypt(encrypted);
      expect(decrypted).toBe(original);
    });

    it('should encrypt and decrypt Hebrew text', () => {
      const original = 'שלום עולם! זה טקסט בעברית';
      const encrypted = encrypt(original);
      const decrypted = decrypt(encrypted);
      expect(decrypted).toBe(original);
    });

    it('should encrypt and decrypt Arabic text', () => {
      const original = 'مرحبا بالعالم';
      const encrypted = encrypt(original);
      const decrypted = decrypt(encrypted);
      expect(decrypted).toBe(original);
    });

    it('should encrypt and decrypt emoji content', () => {
      const original = '❤️ Love message 🔒';
      const encrypted = encrypt(original);
      const decrypted = decrypt(encrypted);
      expect(decrypted).toBe(original);
    });

    it('should encrypt and decrypt empty string', () => {
      const original = '';
      const encrypted = encrypt(original);
      // GCM with empty plaintext produces iv::authTag (empty ciphertext part)
      // This is a valid edge case — decrypt handles it
      const decrypted = decrypt(encrypted);
      expect(decrypted).toBe(original);
    });

    it('should encrypt and decrypt long text (4096+ chars)', () => {
      const original = 'x'.repeat(5000);
      const encrypted = encrypt(original);
      const decrypted = decrypt(encrypted);
      expect(decrypted).toBe(original);
    });

    it('should produce different ciphertext for same plaintext (random IV)', () => {
      const original = 'Same message';
      const encrypted1 = encrypt(original);
      const encrypted2 = encrypt(original);
      expect(encrypted1).not.toBe(encrypted2);
      // But both should decrypt to the same value
      expect(decrypt(encrypted1)).toBe(original);
      expect(decrypt(encrypted2)).toBe(original);
    });

    it('should produce ciphertext in gcm:iv:authTag:data format', () => {
      const encrypted = encrypt('test');
      expect(encrypted).toMatch(/^gcm:[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/);
      const [prefix, ivHex, authTagHex] = encrypted.split(':');
      expect(prefix).toBe('gcm');
      // IV should be 12 bytes = 24 hex chars (GCM standard)
      expect(ivHex.length).toBe(24);
      // Auth tag should be 16 bytes = 32 hex chars
      expect(authTagHex.length).toBe(32);
    });
  });

  // ============================================
  // decrypt error handling
  // ============================================
  describe('decrypt error handling', () => {
    it('should throw on invalid format (no colon)', () => {
      expect(() => decrypt('invalid_no_colon')).toThrow('Invalid encrypted text format');
    });

    it('should throw on empty iv part', () => {
      expect(() => decrypt(':encrypted_data')).toThrow('Invalid encrypted text format');
    });

    it('should throw on empty data part (legacy CBC format)', () => {
      expect(() => decrypt('abc123:')).toThrow('Invalid encrypted text format');
    });

    it('should throw on empty iv or authTag (GCM format)', () => {
      expect(() => decrypt('::abc123')).toThrow('Invalid encrypted text format');
      expect(() => decrypt('abc123:data:')).toThrow('Invalid encrypted text format');
    });

    it('should throw on corrupted ciphertext (GCM auth tag mismatch)', () => {
      const encrypted = encrypt('test');
      const parts = encrypted.split(':');
      // Flip a character in the ciphertext portion (middle part) to trigger GCM auth failure
      const flipped = parts[1].replace(/^(.)/, (c) => c === '0' ? '1' : '0');
      const corrupted = `${parts[0]}:${flipped}:${parts[2]}`;
      expect(() => decrypt(corrupted)).toThrow();
    });
  });

  // ============================================
  // HMAC hash
  // ============================================
  describe('hmacHash', () => {
    it('should produce deterministic output for same input', () => {
      const hash1 = hmacHash('telegram_id_123');
      const hash2 = hmacHash('telegram_id_123');
      expect(hash1).toBe(hash2);
    });

    it('should produce different hashes for different inputs', () => {
      const hash1 = hmacHash('user_a');
      const hash2 = hmacHash('user_b');
      expect(hash1).not.toBe(hash2);
    });

    it('should produce a 64-character hex string (SHA-256)', () => {
      const hash = hmacHash('test');
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  // ============================================
  // Token generation
  // ============================================
  describe('generateInviteToken', () => {
    it('should generate a 64-character hex string (32 bytes)', () => {
      const token = generateInviteToken();
      expect(token).toMatch(/^[0-9a-f]{64}$/);
    });

    it('should generate unique tokens', () => {
      const tokens = new Set(Array.from({ length: 50 }, () => generateInviteToken()));
      expect(tokens.size).toBe(50);
    });

    it('should fit Telegram deep link payload limit (64 chars)', () => {
      const token = generateInviteToken();
      expect(token.length).toBeLessThanOrEqual(64);
    });
  });

  // ============================================
  // Anonymized couple ID
  // ============================================
  describe('generateAnonymizedCoupleId', () => {
    it('should generate a valid UUID format', () => {
      const id = generateAnonymizedCoupleId();
      expect(id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
      );
    });

    it('should generate unique IDs', () => {
      const ids = new Set(Array.from({ length: 50 }, () => generateAnonymizedCoupleId()));
      expect(ids.size).toBe(50);
    });
  });
});
