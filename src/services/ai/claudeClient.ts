import OpenAI from 'openai';
import { env } from '../../config/env';
import { logger } from '../../utils/logger';
import { LLM_MAX_RETRIES, LLM_INITIAL_RETRY_DELAY_MS } from '../../config/constants';

const LLM_REQUEST_TIMEOUT_MS = 10_000; // 10 seconds per request

const client = new OpenAI({
  apiKey: env.OPENAI_API_KEY,
  timeout: LLM_REQUEST_TIMEOUT_MS,
});

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface ClaudeCallOptions {
  systemPrompt: string;
  userMessage: string;
  maxTokens?: number;
  sessionId?: string;
  model?: string;
  staticSystemPrefix?: string; // Kept for API compatibility — concatenated into system prompt
}

/**
 * Call OpenAI with exponential backoff retry.
 * Max 2 retries (1s, 2s). After that, throw.
 */
export async function callClaude(options: ClaudeCallOptions): Promise<string> {
  const { systemPrompt, userMessage, maxTokens = 2048, sessionId, model, staticSystemPrefix } = options;

  // Combine static prefix and dynamic system prompt
  const fullSystemPrompt = staticSystemPrefix
    ? staticSystemPrefix + (systemPrompt ? '\n\n' + systemPrompt : '')
    : systemPrompt;

  for (let attempt = 0; attempt <= LLM_MAX_RETRIES; attempt++) {
    try {
      const response = await client.chat.completions.create({
        model: model || env.OPENAI_MODEL,
        max_tokens: maxTokens,
        messages: [
          { role: 'system', content: fullSystemPrompt },
          { role: 'user', content: userMessage },
        ],
      });

      const content = response.choices[0]?.message?.content;
      if (!content) {
        throw new Error('No text content in OpenAI response');
      }

      return content;
    } catch (error) {
      const isLastAttempt = attempt === LLM_MAX_RETRIES;

      logger.error('OpenAI API call failed', {
        attempt: attempt + 1,
        maxRetries: LLM_MAX_RETRIES,
        sessionId,
        error: error instanceof Error ? error.message : String(error),
      });

      if (isLastAttempt) {
        throw error;
      }

      // Exponential backoff with jitter to prevent thundering herd
      const baseDelay = LLM_INITIAL_RETRY_DELAY_MS * Math.pow(2, attempt);
      const jitter = Math.random() * baseDelay * 0.5;
      const delayMs = Math.round(baseDelay + jitter);
      logger.info(`Retrying OpenAI call in ${delayMs}ms`, { attempt: attempt + 1, sessionId });
      await sleep(delayMs);
    }
  }

  // TypeScript needs this, but it should never reach here
  throw new Error('OpenAI API call failed after all retries');
}

/**
 * Call OpenAI expecting JSON output.
 * Parses the response and returns the parsed object.
 */
export async function callClaudeJSON<T>(options: ClaudeCallOptions): Promise<T> {
  const response = await callClaude(options);

  // Extract JSON from response (model may wrap in markdown code blocks)
  let jsonStr = response.trim();

  // Remove markdown code block if present
  const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonMatch) {
    jsonStr = jsonMatch[1].trim();
  }

  try {
    return JSON.parse(jsonStr) as T;
  } catch {
    logger.error('Failed to parse OpenAI JSON response', {
      response: response.substring(0, 500),
      sessionId: options.sessionId,
    });
    throw new Error(`Failed to parse OpenAI JSON response: ${response.substring(0, 200)}`);
  }
}
