import { splitMessage, detectLanguage } from '../../utils/telegramHelpers';

describe('Telegram Helpers', () => {
  // ============================================
  // splitMessage
  // ============================================
  describe('splitMessage', () => {
    it('should return single-element array for short messages', () => {
      const result = splitMessage('Hello, world!');
      expect(result).toEqual(['Hello, world!']);
    });

    it('should return single-element array for exactly maxLength', () => {
      const msg = 'x'.repeat(4096);
      const result = splitMessage(msg);
      expect(result).toEqual([msg]);
    });

    it('should split at paragraph boundary when possible', () => {
      const paragraph1 = 'a'.repeat(2000);
      const paragraph2 = 'b'.repeat(2000);
      const paragraph3 = 'c'.repeat(2000);
      const msg = `${paragraph1}\n\n${paragraph2}\n\n${paragraph3}`;

      const result = splitMessage(msg);
      expect(result.length).toBeGreaterThan(1);
      // Each chunk must be <= 4096
      for (const chunk of result) {
        expect(chunk.length).toBeLessThanOrEqual(4096);
      }
      // Verify all content is preserved
      const joined = result.join(' ');
      expect(joined).toContain(paragraph1);
      expect(joined).toContain(paragraph2);
      expect(joined).toContain(paragraph3);
    });

    it('should split at newline when no paragraph break available', () => {
      const line1 = 'a'.repeat(3000);
      const line2 = 'b'.repeat(3000);
      const msg = `${line1}\n${line2}`;

      const result = splitMessage(msg);
      expect(result.length).toBe(2);
      expect(result[0]).toBe(line1);
      expect(result[1]).toBe(line2);
    });

    it('should split at space when no newline available', () => {
      const words = Array.from({ length: 1000 }, () => 'word').join(' ');
      const result = splitMessage(words, 100);
      for (const chunk of result) {
        expect(chunk.length).toBeLessThanOrEqual(100);
      }
    });

    it('should hard split when no whitespace found', () => {
      const longWord = 'x'.repeat(8192);
      const result = splitMessage(longWord);
      expect(result.length).toBe(2);
      expect(result[0].length).toBe(4096);
      expect(result[1].length).toBe(4096);
    });

    it('should handle custom maxLength', () => {
      const msg = 'Hello World, this is a test message';
      const result = splitMessage(msg, 15);
      for (const chunk of result) {
        expect(chunk.length).toBeLessThanOrEqual(15);
      }
    });

    it('should handle empty string', () => {
      const result = splitMessage('');
      expect(result).toEqual(['']);
    });

    it('should trim chunks', () => {
      const msg = 'a'.repeat(3000) + '\n\n' + 'b'.repeat(3000);
      const result = splitMessage(msg);
      for (const chunk of result) {
        expect(chunk).toBe(chunk.trim());
      }
    });
  });

  // ============================================
  // detectLanguage
  // ============================================
  describe('detectLanguage', () => {
    it('should detect Hebrew text', () => {
      expect(detectLanguage('שלום עולם, זו הודעה בעברית')).toBe('he');
    });

    it('should detect Arabic text', () => {
      expect(detectLanguage('مرحبا بالعالم، هذه رسالة بالعربية')).toBe('ar');
    });

    it('should detect English text', () => {
      expect(detectLanguage('Hello world, this is English')).toBe('en');
    });

    it('should default to Hebrew for empty string', () => {
      expect(detectLanguage('')).toBe('he');
    });

    it('should default to Hebrew for whitespace-only string', () => {
      expect(detectLanguage('   \n\t  ')).toBe('he');
    });

    it('should detect Hebrew even with some English words mixed in', () => {
      expect(detectLanguage('שלום world זו הודעה test')).toBe('he');
    });

    it('should detect English for purely numeric/symbolic input', () => {
      // No Hebrew/Arabic chars → falls through to 'en'
      expect(detectLanguage('12345!@#$%')).toBe('en');
    });
  });
});
