import { TELEGRAM_MAX_MESSAGE_LENGTH } from '../config/constants';

/**
 * Split a long message into chunks that fit Telegram's 4096 char limit.
 * Splits at paragraph boundaries when possible.
 */
export function splitMessage(text: string, maxLength: number = TELEGRAM_MAX_MESSAGE_LENGTH): string[] {
  if (text.length <= maxLength) {
    return [text];
  }

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining);
      break;
    }

    // Try to split at paragraph boundary
    let splitIndex = remaining.lastIndexOf('\n\n', maxLength);

    // Fall back to line boundary
    if (splitIndex === -1 || splitIndex < maxLength * 0.5) {
      splitIndex = remaining.lastIndexOf('\n', maxLength);
    }

    // Fall back to space
    if (splitIndex === -1 || splitIndex < maxLength * 0.5) {
      splitIndex = remaining.lastIndexOf(' ', maxLength);
    }

    // Hard split if nothing found
    if (splitIndex === -1 || splitIndex < maxLength * 0.3) {
      splitIndex = maxLength;
    }

    chunks.push(remaining.substring(0, splitIndex).trim());
    remaining = remaining.substring(splitIndex).trim();
  }

  return chunks;
}

/**
 * Detect language from text (basic heuristic for Hebrew/Arabic/English).
 */
export function detectLanguage(text: string): string {
  const hebrewRegex = /[\u0590-\u05FF]/;
  const arabicRegex = /[\u0600-\u06FF]/;

  const hebrewCount = (text.match(new RegExp(hebrewRegex.source, 'g')) || []).length;
  const arabicCount = (text.match(new RegExp(arabicRegex.source, 'g')) || []).length;
  const totalChars = text.replace(/\s/g, '').length;

  if (totalChars === 0) return 'he'; // default

  if (hebrewCount / totalChars > 0.3) return 'he';
  if (arabicCount / totalChars > 0.3) return 'ar';
  return 'en';
}
