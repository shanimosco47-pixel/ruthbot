/**
 * Extract Ruth's system prompt from systemPrompts.ts for CI benchmarking.
 *
 * Calls buildCombinedRiskCoachingPrompt with dummy params and outputs
 * the static part (the core prompt instructions) to stdout.
 *
 * Usage:
 *   npx ts-node --transpile-only scripts/extract-prompt-for-ci.ts > /tmp/ruth_prompt.txt
 */

import { buildCombinedRiskCoachingPrompt } from '../src/services/ai/systemPrompts';

const result = buildCombinedRiskCoachingPrompt({
  userRole: 'USER_A',
  language: 'he',
  conversationHistory: [],
  patternSummaries: [],
  sessionId: 'ci-benchmark-session',
  sessionStatus: 'ACTIVE',
  turnCount: 5,
  shouldDraft: false,
  isFrustrated: false,
  isMetaFeedback: false,
  userMemoryContext: null,
});

// Output the static part — the core prompt that defines Ruth's behavior.
// The dynamic part (turn count, session context) is not relevant for benchmarking.
process.stdout.write(result.staticPart);
