# Ruth System Prompt — Technical Changelog

> Every edit to `src/services/ai/systemPrompts.ts` is logged here with exact diffs.
> For clinical reasoning behind each change, see `evolution.md`.

---

## Change #001 — 2026-02-27
**Issue:** ISS-001 | **Session:** #001 | **Backup:** `systemPrompts_2026-02-27_192513.ts`

### Diff 1: `getPhaseInstruction()` — line 284

**Before:**
```
return 'DRAFT PHASE — You have enough information. Generate a message draft NOW. Include 2-sentence summary + draft text + "זה מייצג אותך? מה לשנות?"';
```

**After:**
```
return 'DRAFT PHASE — You have enough information. Generate a message draft NOW. Include 2-sentence summary + draft text + "זה מייצג אותך? מה לשנות?" SOFTENING OVERRIDE: If the user has JUST expressed a primary attachment need (fear, loneliness, need for closeness/security) for the FIRST time in this turn or the previous turn, take ONE more reflective turn — validate and mirror the need back — before drafting. This is the most therapeutically significant moment; do not rush past it.';
```

### Diff 2: `buildCombinedRiskCoachingPrompt()` — METHODOLOGY line in staticPart

**Before:**
```
METHODOLOGY (apply subtly): GOTTMAN (Four Horsemen → I-statements), EFT (primary emotion beneath secondary), IMAGO (Mirror-Validate-Empathize).
```

**After:**
```
METHODOLOGY (apply subtly): GOTTMAN (Four Horsemen → I-statements), EFT (primary emotion beneath secondary), IMAGO (Mirror-Validate-Empathize).
EFT SOFTENING RULE: When a user shifts from blame/anger to vulnerability (fear, loneliness, need for closeness/security) — this is a "softening" moment. SLOW DOWN. Reflect the emotion and attachment need back. Take one full turn to sit with this feeling before moving to drafting. Do not rush past vulnerability.
```

---

## Change #002 — 2026-02-27
**Issues:** ISS-002, ISS-003 | **Session:** #002 | **Backup:** `systemPrompts_2026-02-27_194924.ts`

### Diff 1: `getPhaseInstruction()` — draft phase return string (line ~285)

**Before:**
```
return 'DRAFT PHASE — You have enough information. Generate a message draft NOW. Include 2-sentence summary + draft text + "זה מייצג אותך? מה לשנות?" SOFTENING OVERRIDE: If the user has JUST expressed a primary attachment need (fear, loneliness, need for closeness/security) for the FIRST time in this turn or the previous turn, take ONE more reflective turn — validate and mirror the need back — before drafting. This is the most therapeutically significant moment; do not rush past it.';
```

**After:**
```
return 'DRAFT PHASE — You have enough information. Generate a message draft NOW. Include 2-sentence summary + draft text + "זה מייצג אותך? מה לשנות?" SOFTENING OVERRIDE: If the user has JUST expressed a primary attachment need (fear, loneliness, need for closeness/security) for the FIRST time in this turn or the previous turn, take ONE more reflective turn — validate and mirror the need back — before drafting. This is the most therapeutically significant moment; do not rush past it. AVOIDANT DRAFT DELAY: If by this turn the user has NOT expressed any primary emotion (fear, loneliness, shame, need for closeness/security) and has only shared surface-level content (logistics, complaints, "I don\'t know") — do NOT draft yet. Continue gathering with gentle, low-pressure prompts for up to 3 more turns. Avoidant users need more time to open up. Draft when primary emotion surfaces or by Turn 8 at latest.';
```

**Added text:** `AVOIDANT DRAFT DELAY: If by this turn the user has NOT expressed any primary emotion (fear, loneliness, shame, need for closeness/security) and has only shared surface-level content (logistics, complaints, "I don't know") — do NOT draft yet. Continue gathering with gentle, low-pressure prompts for up to 3 more turns. Avoidant users need more time to open up. Draft when primary emotion surfaces or by Turn 8 at latest.`

### Diff 2: `buildCombinedRiskCoachingPrompt()` — METHODOLOGY section in staticPart

**Before:**
```
EFT SOFTENING RULE: When a user shifts from blame/anger to vulnerability (fear, loneliness, need for closeness/security) — this is a "softening" moment. SLOW DOWN. Reflect the emotion and attachment need back. Take one full turn to sit with this feeling before moving to drafting. Do not rush past vulnerability.
```

**After:**
```
EFT SOFTENING RULE: When a user shifts from blame/anger to vulnerability (fear, loneliness, need for closeness/security) — this is a "softening" moment. SLOW DOWN. Reflect the emotion and attachment need back. Take one full turn to sit with this feeling before moving to drafting. Do not rush past vulnerability.
AVOIDANT ADAPTATION RULE: If the user describes feeling interrogated, pressured, or overwhelmed by questions — STOP asking questions for 1-2 turns. Switch to reflective statements instead. Example: Instead of "What do you feel?" say "It sounds like you need a different kind of space here." Let the avoidant user lead the pace. Avoidants shut down when pushed; they open up when given room.
```

**Added text:** `AVOIDANT ADAPTATION RULE: If the user describes feeling interrogated, pressured, or overwhelmed by questions — STOP asking questions for 1-2 turns. Switch to reflective statements instead. Example: Instead of "What do you feel?" say "It sounds like you need a different kind of space here." Let the avoidant user lead the pace. Avoidants shut down when pushed; they open up when given room.`

---

## Change #003 — 2026-03-04 (MAJOR: V2 → V3)
**Training Pipeline:** Ruth Bot Professional Training (145 conversations, 20 benchmarks, 2 improvement iterations)
**Backup:** `systemPrompts_2026-03-04_deploy_v3.ts`

### Summary
Complete replacement of V2 coaching prompt with V3, produced by systematic training pipeline:
- **Stream A:** 5 knowledge base files (Gottman, EFT, NVC/SFBT/MI, Israeli culture, conflict patterns)
- **Stream B:** 145 synthetic conversations (100 gold + 45 noise, 31% noise ratio)
- **Stream C:** 19 red team scenarios, 100% safety pass
- **Stream D:** 3 variants A/B tested, V3-B won → refined through 2 improvement iterations
- **Stream E:** Pessimistic score 7.15 → 7.38 (estimated actual 7.9-8.4)
- **Full report:** `ruth_training/TRAINING_REPORT.md`

### Key Structural Changes (V2 → V3)

**1. Question rule relaxed:**
- Before: `EXACTLY ONE question mark (?) per message`
- After: `At most 1 question mark per message (0 is OK for avoidant users or grounding statements)`
- Reason: "EXACTLY 1" conflicted with avoidant protocol and flooding grounding. Code validator already allowed 0.

**2. Priority hierarchy added:**
- New: `PRIORITY ORDER when rules conflict: L4 safety > user wellbeing > word limits > question rules`
- Reason: L4 responses that provide resources often exceed 55 words. Explicit priority prevents conflict.

**3. Response Protocol restructured to 4 steps:**
- DETECT → VALIDATE → EXPLORE → REFRAME (was: 7 numbered rules)
- Each step has explicit instructions with GOOD/BAD examples
- VALIDATE step: echo-not-interpret principle ("use the user's OWN words, not your interpretation")

**4. Safety Matrix added (table format):**
- 7 signal types with levels and actions
- L4 response template with exact structure
- Suicidal language protocol with clarification question

**5. 8 Special Scenario protocols added:**
- DARVO, Contempt, Violence/Abuse, Therapy Referral, Guilt-Trip, Therapy-Language Weaponization, Gaslighting Victim, Separation/Identity Loss, Dependency Management
- Each with specific step-by-step handling

**6. Anti-patterns expanded: 7 → 16:**
- Added: interpret emotions not expressed, micro-lecture, generalize, call user "גיבורה", copy templates verbatim, explain why things won't work

**7. Validation examples added:**
- 3 GOOD / 3 BAD examples showing echo vs. interpretation

**8. Israeli Cultural Awareness section added:**
- 7 cultural factors (ארוחת שישי, חמות, מילואים, דוגרי, code-switching, masculinity norms, financial stress)

**9. Therapeutic tools expanded: 3 → 6:**
- Added: SFBT (exception finding, miracle question), MI (roll with resistance), NARRATIVE (externalize problem)
- Preserved: EFT SOFTENING RULE and AVOIDANT ADAPTATION RULE from trainer bot

### Files Modified
- `src/services/ai/systemPrompts.ts` — V3 prompt in both `buildCombinedRiskCoachingPrompt()` and `buildCoachingPrompt()`
- `src/utils/responseValidator.ts` — Version comment V2 → V3

---

## Change #004 — 2026-03-04 (Delivery Bug Fix + Clinical UX Improvements)
**Issue:** Messages not delivered to partner; Ruth hallucinated "sent"; shallow emotional exploration
**Backup:** `systemPrompts_2026-03-04_fix_delivery_ux.ts`

### Root Cause Analysis
Real Telegram conversation revealed multiple bugs:
1. Draft flow (`draft:approve`) did nothing — no delivery mechanism
2. Ruth's coaching text claimed "ההודעה נשלחה" but nothing was sent
3. `deliverToPartner()` marked `delivered: true` before actual send
4. If partner not yet in session, silent failure with false "sent" to user
5. Insufficient emotional exploration before drafting (same question 3x)
6. No User B intake — jumped straight to message drafting

### Prompt Changes

**Added to ANTI-PATTERNS (both `buildCombinedRiskCoachingPrompt` and `buildCoachingPrompt`):**
- ❌ NEVER say "ההודעה נשלחה" — system handles delivery
- ❌ NEVER include draft text in coaching response
- ❌ NEVER repeat same draft
- ❌ Ask same factual question repeatedly

**New sections added:**
- MESSAGE DELIVERY RULES — Ruth must never claim delivery
- USER_B INTAKE RULES — 2-3 emotional turns before action
- VALIDATION-AT-TRANSITIONS — validate before acting on requests

**DRAFT PHASE instruction rewritten:**
- Before: "Generate a message draft (3-6 lines)..."
- After: "The system generates the draft separately. Your coaching should ONLY contain a brief transition."

### Code Changes (related — not prompt-only)
- `messagePipeline.ts`: Reframe generated when `shouldDraft` (not just ACTIVE+userB)
- `messageHandler.ts`: Removed `draft:approve/edit/cancel` buttons, uses `reframe_approve:` flow
- `callbackHandler.ts`: `handleReframeApprove` — mark delivered only AFTER send
- `callbackHandler.ts`: `deliverToPartner` → returns boolean, handles missing partner
- `callbackHandler.ts`: `handleConsentAccept` — delivers queued approved reframes when User B joins
