import Anthropic from '@anthropic-ai/sdk';
import { env } from '../../config/env';
import { logger } from '../../utils/logger';
import { CLAUDE_MAX_RETRIES, CLAUDE_INITIAL_RETRY_DELAY_MS } from '../../config/constants';

const CLAUDE_REQUEST_TIMEOUT_MS = 30_000; // 30 seconds per request

const client = new Anthropic({
  apiKey: env.ANTHROPIC_API_KEY,
  timeout: CLAUDE_REQUEST_TIMEOUT_MS,
});

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface ClaudeCallOptions {
  systemPrompt: string;
  userMessage: string;
  maxTokens?: number;
  sessionId?: string;
}

/**
 * Call Claude with exponential backoff retry.
 * Max 2 retries (1s, 2s). After that, throw.
 */
export async function callClaude(options: ClaudeCallOptions): Promise<string> {
  const { systemPrompt, userMessage, maxTokens = 2048, sessionId } = options;

  for (let attempt = 0; attempt <= CLAUDE_MAX_RETRIES; attempt++) {
    try {
      const response = await client.messages.create({
        model: env.CLAUDE_MODEL,
        max_tokens: maxTokens,
        system: systemPrompt,
        messages: [{ role: 'user', content: userMessage }],
      });

      const textBlock = response.content.find((block) => block.type === 'text');
      if (!textBlock || textBlock.type !== 'text') {
        throw new Error('No text content in Claude response');
      }

      return textBlock.text;
    } catch (error) {
      const isLastAttempt = attempt === CLAUDE_MAX_RETRIES;

      logger.error('Claude API call failed', {
        attempt: attempt + 1,
        maxRetries: CLAUDE_MAX_RETRIES,
        sessionId,
        error: error instanceof Error ? error.message : String(error),
      });

      if (isLastAttempt) {
        throw error;
      }

      // Exponential backoff with jitter to prevent thundering herd
      const baseDelay = CLAUDE_INITIAL_RETRY_DELAY_MS * Math.pow(2, attempt);
      const jitter = Math.random() * baseDelay * 0.5;
      const delayMs = Math.round(baseDelay + jitter);
      logger.info(`Retrying Claude call in ${delayMs}ms`, { attempt: attempt + 1, sessionId });
      await sleep(delayMs);
    }
  }

  // TypeScript needs this, but it should never reach here
  throw new Error('Claude API call failed after all retries');
}

/**
 * Call Claude expecting JSON output (for Risk Engine, Mirror Evaluation, etc.)
 * Parses the response and returns the parsed object.
 */
export async function callClaudeJSON<T>(options: ClaudeCallOptions): Promise<T> {
  const response = await callClaude(options);

  // Extract JSON from response (Claude may wrap in markdown code blocks)
  let jsonStr = response.trim();

  // Remove markdown code block if present
  const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonMatch) {
    jsonStr = jsonMatch[1].trim();
  }

  try {
    return JSON.parse(jsonStr) as T;
  } catch {
    logger.error('Failed to parse Claude JSON response', {
      response: response.substring(0, 500),
      sessionId: options.sessionId,
    });
    throw new Error(`Failed to parse Claude JSON response: ${response.substring(0, 200)}`);
  }
}
