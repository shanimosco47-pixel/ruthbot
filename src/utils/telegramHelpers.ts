import { TELEGRAM_MAX_MESSAGE_LENGTH } from '../config/constants';

// URL regex — matches http(s) URLs in plain text, avoiding trailing punctuation
const URL_REGEX = /https?:\/\/[^\s<>"')\]]+[^\s<>"')\].,;:!?]/g;

/**
 * Escape special HTML characters for Telegram HTML parse_mode.
 */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Convert plain-text URLs to clickable HTML <a> links for Telegram.
 * Text is HTML-escaped first, then URLs are wrapped in <a> tags.
 */
export function renderLinks(text: string): string {
  // Extract URLs before escaping so we get the raw URLs
  const urls: { start: number; end: number; url: string }[] = [];
  let match: RegExpExecArray | null;
  const regex = new RegExp(URL_REGEX.source, 'g');
  while ((match = regex.exec(text)) !== null) {
    urls.push({ start: match.index, end: match.index + match[0].length, url: match[0] });
  }

  if (urls.length === 0) {
    return escapeHtml(text);
  }

  // Build result by escaping non-URL parts and wrapping URLs in <a> tags
  let result = '';
  let lastIndex = 0;
  for (const { start, end, url } of urls) {
    result += escapeHtml(text.slice(lastIndex, start));
    result += `<a href="${escapeHtml(url)}">${escapeHtml(url)}</a>`;
    lastIndex = end;
  }
  result += escapeHtml(text.slice(lastIndex));

  return result;
}

/**
 * Check if text contains any plain-text URLs.
 */
export function containsLinks(text: string): boolean {
  return new RegExp(URL_REGEX.source).test(text);
}

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

  // Default to Hebrew — this is an Israeli bot. Only return 'en' for clearly English text (>10 chars).
  if (totalChars <= 10) return 'he';
  return 'en';
}
