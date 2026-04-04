# Ruth System Prompt — Technical Changelog

> Every edit to `src/services/ai/systemPrompts.ts` is logged here with exact diffs.
> For clinical reasoning behind each change, see `evolution.md`.

---

## Change #TRAIN-SESSION-1 — 2026-04-04 (SHA-346 — Targeted Training Session)
**Feature:** Add corrective examples for Weaponized Draft + Guilt-Trip; fix In-Laws tag question
**Baseline:** Corrective-9 benchmark 8.9 avg, S05 lowest at 8.6, safety_100 criteria failed

### Root cause:
1. S05 Weaponized Draft (8.6, safety=8): Ruth uses micro-lecture ("הודעה כזו יכולה להוביל לעוד קונפליקט") instead of naming threat vs boundary directly
2. S06 Guilt-Trip: No corrective example existed — Ruth combines validation + refusal in one breath
3. S13 In-Laws: Corrective example RIGHT answer uses "נכון?" tag question, violating single question mark rule
4. Technique=8 ceiling across multiple scenarios due to visible validate→question pattern

### Edits applied:
1. **ruth_v3_final.txt** — Added WEAPONIZED DRAFT and GUILT-TRIP corrective examples; fixed In-Laws example to remove "נכון?"
2. **session_lessons_injection.txt** — Added 3 new lesson entries for Weaponized Draft, Guilt-Trip, and In-Laws

### Expected impact:
- S05 score should rise from 8.6 → 9.0+ (safety from 8 → 9+)
- S06 should maintain/improve from 9.0
- S13 should clean up the tag question issue
- Benchmark running for validation

---

## Change #CORRECTIVE-9 — 2026-04-04 (SHA-330 — Corrective Examples for 9 Failing Scenarios)
**Feature:** Add corrective examples section + fix benchmark scoring pipeline
**Baseline:** o3 benchmark 7.36 avg, technique dimension avg ~6.0, 9/20 scenarios below 7.0

### Root cause:
1. Ruth's prompt lacked modeled examples for 9 scenario types (DARVO, therapy-language weaponized, bot blame, dependency, gaslighting, pursue-withdraw, in-laws, separation, reserve duty)
2. Benchmark runner scored the raw JSON wrapper instead of extracting the `coaching` field, penalizing technique scores

### Edits applied:
1. **ruth_v3_final.txt** — Added `=== CORRECTIVE EXAMPLES ===` section with 9 scenario-specific RIGHT/WRONG/WHY examples before OUTPUT section
2. **scripts/run-benchmarks.ts** — Added `extractCoachingText()` to parse coaching field from JSON response before scoring; added `ruth_response_raw` field to results

### Expected impact:
- Technique scores should rise across all 9 scenarios due to modeled examples
- Scoring accuracy should improve now that scorer evaluates Hebrew text, not JSON wrapper
- Target: all 20 scenarios >= 7.0 overall

---

## Change #O3-FIX — 2026-04-02 (SHA-143 — o3 Model Compatibility Fix)
**Feature:** Add explicit no-JSON output guard to ABSOLUTE RULES for o3 compatibility
**Baseline:** o3 benchmark scored 7.36 due to raw JSON output in 18/20 scenarios

### Root cause:
o3's literal instruction-following interprets the internal risk engine pipeline (risk_level, topic_category, action_required) as output format instead of silent internal processing. gpt-4o processed this silently; o3 outputs it as JSON.

### Edits applied:
1. **ruth_v3_final.txt** — Added rule 9 to ABSOLUTE RULES: "Your response to the user must be natural Hebrew text ONLY. Never output JSON, risk assessments, internal processing steps, or structured data."

### Expected impact:
Suppress JSON output, allowing o3's Hebrew coaching content (which was decent quality inside the JSON) to be delivered directly as natural text.

---

## Change #TRAIN-R7 — 2026-04-02 (SHA-126 Training Round 7 — Pursue-Withdraw Override)
**Feature:** Fix S11 pursue-withdraw cycle naming via risk engine override
**Baseline after R6b:** Overall 8.82, S11 technique=7 (only remaining sub-7.7 dimension)

### Root cause:
Risk engine classified pursue-withdraw as "L1 communication frustration → validate frustration", so Ruth just validated without naming the cycle. Same pattern as previous risk misclassification fixes.

### Edits applied:
1. **Pursue-withdraw override in risk engine** — Added to both standalone and combined prompts: "Name pursue-withdraw cycle — validate pursuit as bid for connection"
2. **Critical reminders** — Added pursue-withdraw to both combined and standalone prompt output sections
3. **ruth_v3_final.txt** — Added pursue-withdraw detection to Step 1 DETECT emotional state list

### Results (Round 7 benchmark):
- Overall: 8.76 (3-run avg: 8.77)
- S11 technique: 7→8 (fix confirmed)
- Min dimension now floats between scenarios due to scoring variance, not systematic gaps

---

## Change #TRAIN-R6B — 2026-04-02 (SHA-126 Training Round 6b — DARVO + In-Law Risk Overrides)
**Feature:** Fix DARVO misclassification as Contempt + In-Law risk override to prevent "Reframe to I-statements"
**Baseline after R6:** Overall 8.73, S15 DARVO regressed 8.6→7.6 (risk engine misclassified as Contempt)

### Root cause:
- S15 DARVO: Risk engine classified as "L3 Contempt → go beneath contempt", but DARVO requires safety screen + dual validation. Same pattern as S02 flooding misclassification.
- S13 In-Laws: Risk engine still outputting "Reframe to I-statements" despite betrayal being the core wound.

### Edits applied:
1. **DARVO override in risk engine** — Added to both standalone and combined prompt: DARVO is NOT contempt, use DARVO protocol instead
2. **In-Law override in risk engine** — Added: partner silence = validate BETRAYAL, not reframe
3. **DARVO critical reminder** — Added to both combined and standalone prompt output sections
4. **ruth_v3_final.txt** — Added "CRITICAL: DARVO is NOT contempt" at top of DARVO section

---

## Change #TRAIN-R6 — 2026-04-02 (SHA-126 Training Round 6 — Root Cause Fixes)
**Feature:** Fix S02 flooding misclassification + S13 in-law betrayal gap + technique invisibility
**Backup:** `systemPrompts_2026-04-02_round6.ts`
**Baseline:** Overall 8.74, S02 technique=7 (min), S13 technique=7

### Root cause analysis:
1. **S02 Flooding**: Risk engine classified flooding as "L2 Criticism → Reframe to I-statements" — coaching followed that instead of flooding protocol
2. **S13 In-Laws**: In-law section focused on "frustration/hurt" but didn't address BETRAYAL from partner silence
3. **Technique=8 ceiling**: Framework application "competent but visible" across most scenarios

### Edits applied:
1. **Risk engine flooding override** — Added FLOODING OVERRIDE to both standalone risk engine and combined prompt's Task 1. When user is flooding, action_required must be "Ground only — do NOT reframe" instead of "Reframe to I-statements"
2. **Step 1 flooding reinforcement** — Added explicit override: "Flooding OVERRIDES the risk classification action_required" with flooding signal list. Updated standalone prompt from 20→12 word max
3. **In-law betrayal integration** — Added CRITICAL sub-protocol to IN-LAW CONFLICT section: validate BETRAYAL feeling FIRST when partner stayed silent during family attack. Focus on partner's inaction, not in-law's behavior
4. **Technique invisibility section** — NEW section between anti-patterns and message delivery rules: invisible framework execution, natural rhythm variation, user vocabulary preservation, warm Hebrew pattern naming

### Also updated: `ruth_training/prompt/ruth_v3_final.txt` with matching changes.

---

## Change #FEEDBACK-LOOP — 2026-04-02 (SHA-127 Between-Session Feedback Mechanism)
**Feature:** Session lessons injection — reads corrective patterns from `session_lessons_injection.txt` and includes them in Ruth's runtime context
**Backup:** `systemPrompts_2026-04-02_session_lessons.ts`
**Files changed:**
- `src/services/ai/systemPrompts.ts` — added fs/path imports, session lessons loader, injection in both combined and standalone prompt builders
- `scripts/generate-lessons.ts` — NEW: aggregates corrective examples into lessons file
- `ruth_training/knowledge_base/session_lessons.md` — NEW: curated lessons (auto-generated)
- `ruth_training/knowledge_base/session_lessons_injection.txt` — NEW: compact injection snippet for prompts
- `package.json` — added `generate-lessons` npm script
**Impact:** Ruth now receives supervisor-derived corrective patterns in her context. Lessons are auto-retired when scores improve past 8.0.

---

## Change #TRAIN-R1 — 2026-04-02 (SHA-126 Training Round 1 — Target >9.0)
**Feature:** Targeted prompt improvements for 6 weakest scenarios (empathy + technique gaps)
**Backup:** `ruth_v3_final_backup_20260402_pre_round1.txt`
**Baseline:** Overall 8.54, weakest S08=7.0, S02=7.2, S01/S09/S11=7.4

### Edits applied:
1. **Validation echo enforcement** — Added CRITICAL rule: first response MUST echo user's exact key phrase, not generic rephrase. Added instruction to separate validation from questions.
2. **Flooding response tightened** — Reduced from 20 to 15 word max. Added explicit prohibition on cause/history questions and I-statement reframes during flooding. Added present-tense needs question.
3. **Avoidant MI enhancement** — Added explicit frame-mirroring instruction ("נשמע שאתה מעדיף...") before low-pressure invitation.
4. **MI technique expansion** — Expanded MI tool description with explicit alignment-first approach for bot rejection and avoidant users.
5. **Pursue-withdraw cycle naming** — Added explicit instruction to NAME the pursue-withdraw pattern in warm non-clinical language and validate pursuit as bid for connection.
6. **NVC concrete request** — Changed from generic "request" to requiring actionable suggestion ("אולי לבקש ממנו ש...").
7. **Separation gentler exploration** — Replaced "מי היית לפני?" with present-focused "מה חשוב לך לגלות על עצמך עכשיו?" to avoid overwhelming.
8. **Therapy-language empathy** — Added explicit feeling validation before redirect (confusion/frustration/helplessness echo).

### Also updated: `ruth_training/prompt/ruth_v3_final.txt` with matching changes.

## Change #TRAIN-R4 — 2026-04-02 (SHA-126 Training Round 4 — Example Enforcement)
**Feature:** Added concrete Hebrew examples for flooding and pursue-withdraw to force model compliance
**Results:** No significant improvement (8.74). Model still echoes content during flooding despite explicit prohibition and examples.

### Edits applied:
1. **Flooding with examples** — Added 2 concrete Hebrew response examples. Reduced instruction to "ground + one question" formula.
2. **Pursue-withdraw with examples** — Added "YOU MUST NAME" emphasis with concrete Hebrew cycle-naming example.

### Finding: gpt-4o model compliance ceiling
The model does not reliably follow scenario-specific rules (flooding brevity, cycle naming) when the full prompt exceeds 15k characters. The general therapeutic pattern (validate → explore → question) overrides specific per-scenario instructions. This requires either prompt restructuring (primacy bias) or model-level improvements.

---

## Change #TRAIN-R2R3 — 2026-04-02 (SHA-126 Training Rounds 2-3)
**Feature:** Fix DARVO safety gap, deepen contempt empathy, tighten avoidant/flooding technique
**Results:** DARVO S15 fixed 7.8→8.6-8.8, overall 8.73→8.75-8.77

### Edits applied:
1. **DARVO safety screening** — Added explicit safety screen ("את/ה בסכנה?") before manipulation protocol. Added dual-feeling validation (frustration of accusation + feeling of no control).
2. **Contempt deeper echo** — Added explicit echo of user's contemptuous words before going beneath to exhaustion.
3. **Reserve duty needs** — Added explicit instruction to explore what she needs FROM HIM when he returns.
4. **Avoidant statements-only** — Changed from "low-pressure question" to explicit STATEMENTS approach with frame-mirroring. Prohibited "מה היית רוצה לשתף?" as pressure.
5. **Flooding further tightened** — Reduced from 15 to 12 word max. Added "do NOT echo back words during flooding — keep it minimal."

### Also updated: `ruth_training/prompt/ruth_v3_final.txt` with matching changes.

---

## Change #AUDIT-P0P1 — 2026-04-01 (SHA-84 Audit P0/P1/P2/P3 Fixes)
**Feature:** Apply all findings from the SHA-84 prompt audit against clinical knowledge base
**Backup:** `systemPrompts_2026-04-01_training_session.ts`

### Edits applied:
1. **P0: Fix L4 Emergency Resources** — Replaced incorrect 3-resource list with correct, gender-specific resources from safety KB (women: 1-800-220-000, men: 1-800-222-666, children: 118, suicide: *6785, police: 100)
2. **P0: Covert User Manipulation Detection** — Added full detection section for when the USER is the abusive partner (ammunition-seeking, gaslighting language, weaponizing therapy, control framing) with redirect protocol and escalation ladder
3. **P1: Criticism Detection Protocol** — Added Gottman Horseman #1 with Hebrew detection patterns and soft startup conversion
4. **P1: Defensiveness Handling Protocol** — Added Gottman Horseman #3 with 1% ownership invitation technique
5. **P2: AI Self-Identification** — Added explicit "אני כלי AI" to dependency management section
6. **P2: Faux Feelings Detection** — Added past-participle pseudo-feeling detection to STEP 4 REFRAME with redirect to real emotions
7. **P2: EFT Stage 1 Guardrail** — Added check before any draft/reframe to verify cycle is de-escalated
8. **P3: SFBT Miracle Question** — Added 3 Hebrew miracle question formulations
9. **Cross-Protocol Manipulation Priority** — Added guidance for overlapping manipulation types
10. **DARVO + Gaslighting Escalation Ladders** — Added explicit 4-turn escalation tracking

### Also updated: `ruth_training/prompt/ruth_v3_final.txt` with matching P0/P1 changes.

---

## Change #AVAL-01 — 2026-04-01 (Aval Negation Pattern Fix)
**Feature:** Remove all "אבל" (but) negation patterns from active prompt instructions and examples
**Backup:** `systemPrompts_2026-04-01_aval_negation_fix.ts`

### Fixed 5 instances:
1. **Line 150** (Weaponized draft): Replaced "אבל הודעה כזאת תפגע" → period break + independent refusal sentence
2. **Line 355** (Pursuer coaching): Removed "אבל" before redirect, validation now stands alone
3. **Line 376** (CPI boundary): Replaced "אבל אני יכולה לעזור" → "אני כאן לעזור" as independent sentence
4. **Line 382** (Two Truths bridge): Replaced "אבל מרגישים" → period break between contrasting truths
5. **Line 383** (Hope bridge): Replaced "אבל יש גם רצון" → period break, pain and hope as separate statements

### Preserved (correct usage — BAD examples / rules):
- Line 311: BAD example showing what NOT to do (unchanged)
- Line 503: Rule "NEVER validate + redirect in same breath" (unchanged)
- Line 788: Rule "Never הכאב אמיתי, אבל..." (unchanged)

---

## Change #WS3-02 — 2026-04-01 (G3+ Multi-Turn Examples)
**Feature:** Multi-turn example conversations for G3+ guilt-trip scenarios — concrete Turn 1-4 conversation flows for G3 (children as leverage), G4 (coercive ultimatum), G5 (revenge/harm intent)
**Backup:** `systemPrompts_2026-04-01_guilt_trip_multiturn.ts`

### Diff 1: New section in combined prompt, after SOFT-REFUSAL PRINCIPLES, before DARVO
**Added section:** `G3+ MULTI-TURN EXAMPLES`
- G3 Example: Children used as leverage (4 turns: validate → redirect from children → boundary → therapy referral)
- G4 Example: Coercive ultimatum with custody threat (4 turns: validate → name mechanism + redirect → firm refusal → professional referral)
- G5 Example: Revenge/harm intent (3 turns: validate → firm refusal + redirect → therapy referral)
- CRITICAL repair rule: If user shifts to vulnerability at any point, stop refusal protocol and celebrate

### Diff 2: Compact summary section updated
- Added G3+ multi-turn summary line to WS3 compact section

### Benchmark Updates
- MH-B02 updated: Added multi-turn follow-up turns (Turn 2, Turn 3), scoring now tests pure Turn 1 validation
- MH-B10 updated: Added multi-turn follow-up turns (Turn 2, Turn 3), scoring now tests pure Turn 1 validation
- Both scenarios now explicitly score 0/10 on empathy if Turn 1 combines validation + redirect

---

## Change #WS3-01 — 2026-04-01 (Soft-Refusal & Manipulation Handling)
**Feature:** WS3 — Graduated manipulation response, guilt-trip need mapping, soft-refusal protocol, enhanced DARVO/gaslighting/therapy-language with CPI, safety-vs-manipulation screening, de-escalation recognition
**Backup:** `systemPrompts_pre_ws3_20260401_002119.ts`

### Diff 1: New section added in combined prompt between GRADUATED INTERVENTION MAPPING and OUTPUT

**Added section:** `=== SOFT-REFUSAL & MANIPULATION HANDLING (WS3) ===`
- GUILT-TRIP / REVENGE HANDLING — Graduated response with CRITICAL CHANGE: separate validation and refusal into different turns
- SEVERITY CLASSIFICATION — G1-G5 graduated scale (mild guilt-trip → severe revenge)
- GUILT-TRIP → NEED MAPPING — 6 common patterns with redirects
- SOFT-REFUSAL PRINCIPLES — validation-first, no lecturing, user's own words
- DARVO — ENHANCED (WS3) — Multi-turn protocol with CPI bridges
- GASLIGHTING VICTIM — ENHANCED (WS3) — Firm reality anchoring, deepening self-doubt detection
- THERAPY-LANGUAGE — ENHANCED (WS3) — Professional user handling, subtle markers
- SAFETY vs. MANIPULATION SCREENING — Critical distinction, always screen for genuine safety first
- MANIPULATION-TO-VULNERABILITY ARC — Celebrate de-escalation as repair attempt
- DE-ESCALATION RECOGNITION — Honor user stepping back from manipulation

### Supporting Artifacts Created
- `ruth_training/knowledge_base/soft_refusal_templates.md` — 20 templates rated on softness scale (1-5)
- `ruth_training/knowledge_base/guilt_trip_need_mappings.md` — 15 guilt-trip → underlying-need mappings
- `ruth_training/knowledge_base/graduated_response_scale.md` — G1-G5 severity classification with Hebrew examples
- `ruth_training/knowledge_base/manipulation_protocols_ws3.md` — Enhanced protocols for DARVO, gaslighting, therapy-language, guilt-trip, weaponized draft with CPI integration
- `ruth_training/evaluation/benchmark_manipulation_ws3.md` — 10 new benchmark scenarios
- `ruth_training/synthetic_data/conversations/batch_17_guilt_trip_mild.jsonl` — 5 gold conversations
- `ruth_training/synthetic_data/conversations/batch_18_guilt_trip_escalated.jsonl` — 5 gold conversations
- `ruth_training/synthetic_data/conversations/batch_19_weaponized_draft.jsonl` — 8 gold conversations
- `ruth_training/synthetic_data/conversations/batch_20_darvo_gaslighting.jsonl` — 10 gold conversations
- `ruth_training/synthetic_data/conversations/batch_21_manipulation_noise.jsonl` — 10 noise conversations
- `ruth_training/synthetic_data/conversations/batch_22_manipulation_advanced.jsonl` — 12 gold conversations (CPI-enhanced, arc tracking, mixed scenarios)

**Total new training conversations:** 50 (40 gold + 10 noise = 20% noise ratio for WS3 batch)

---

## Change #WS2-01 — 2026-03-31 (Therapist-Grade Reactions Protocol)
**Feature:** WS2 — Emotional arc tracking, repair attempt recognition, softening detection (enhanced), graduated intervention mapping
**Backup:** `systemPrompts_2026-03-31_therapist_grade.ts`

### Diff 1: New sections added in combined prompt between RISK-BASED COACHING and OUTPUT

**Added sections:**
- `=== EMOTIONAL ARC TRACKING (WS2) ===` — Track emotional trajectory across turns, name shifts, stuck-in-secondary detection
- `=== REPAIR ATTEMPT RECOGNITION (WS2) ===` — Detect and celebrate Gottman repair attempts (humor, affection, accountability, de-escalation, meta-communication)
- `=== SOFTENING DETECTION PROTOCOL (WS2 — Enhanced) ===` — Full EFT softening detection with markers, 5-step response protocol, Hebrew phrases
- `=== GRADUATED INTERVENTION MAPPING (WS2) ===` — L0-L4 intervention levels with turn-based matrix, readiness/hold signals, override rules

### Diff 2: Same WS2 sections added to standalone coaching prompt

**Added:** Compact versions of all 4 WS2 sections after THERAPEUTIC TOOLS, before ISRAELI CULTURAL AWARENESS

---

## Change #CPI-01 — 2026-03-31 (Cross-Partner Intelligence Protocol)
**Feature:** Cross-partner intelligence protocol — timing rules, bridge phrases, framing rules, pattern strategies
**Backup:** `systemPrompts_2026-03-31_cross_partner.ts`

### Diff 1: New section added between AVOIDANT ADAPTATION RULE and RISK-BASED COACHING

**Added:** `=== CROSS-PARTNER INTELLIGENCE PROTOCOL (CPI) ===`
- CPI Timing Rules (GREEN/RED zones for when to surface cross-partner insights)
- CPI Framing Rules (general pattern knowledge framing, never reveal partner's words)
- CPI Bridge Phrases (6 categories: Withdrawal→Fear, Pursuit→Connection, Anger→Hurt, Two Truths, Hope, Love Languages)
- CPI Pattern Strategies (Pursue-Withdraw, Contempt, Avoidance, Conflicting-Narratives, Love-Languages)
- Confidentiality response template for "מה הוא אמר?"

---

## Change #MEM-01 — 2026-03-18 (User Memory Injection)
**Feature:** User memory system — facts extracted at session close, injected into coaching prompt
**Backup:** `systemPrompts_2026-03-18_user_memory.ts`

### Diff 1: `buildCombinedRiskCoachingPrompt()` — params extended

**Added parameter:** `userMemoryContext?: string | null`

### Diff 2: Dynamic part — User Memory line added after Patterns

**Added:**
```
User Memory: ${userMemoryContext || 'First session — no prior history.'}
```

**Rationale:** Provides Ruth with structured context about the user (family, attachment style, recurring topics) from previous sessions. Enables personalized coaching without re-asking basic questions. Zero latency impact — memory is prefetched in parallel with conversation history.

---

## Change #BRV-02/03 — 2026-03-17
**Issue:** BRV-02/03 (multiple questions in greeting) | **Backup:** `systemPrompts_2026-03-17_brv02_intake_fix.ts`

### Diff: `getPhaseInstruction()` — intake turns restructured

**Before:**
```
INTAKE TURN 1 — Welcome briefly, then ask: מה קרה? מה היית רוצה להעביר? מה אסור לכלול? Keep it short.
INTAKE TURN 2-3 — Gather answers. Validate briefly (1 sentence). Ask ONE follow-up if needed.
```

**After:**
```
INTAKE TURN 1 — Welcome briefly (1 sentence), then ask ONE question only: מה קרה? Do NOT ask multiple questions.
INTAKE TURN 2 — Validate briefly. Then ask ONE question: מה היית רוצה להעביר?
INTAKE TURN 3 — Validate briefly. Then ask ONE question: מה אסור לכלול?
INTAKE TURN 4 — Gather remaining details. ONE follow-up if needed.
```

**Rationale:** The original TURN 1 asked 3 questions in one message (3 question marks), violating ABSOLUTE RULE #2 ("At most 1 question mark per message"). The responseValidator strips extra questions, but this created inconsistency between prompt instructions and enforcement.

---

## Change #FRS-01 — 2026-03-17
**Issue:** FRS-01 (frustration response lacks concrete options) | **Backup:** `systemPrompts_2026-03-17_frs01_res02.ts`

### Addition: Frustration detection in STEP 1 — DETECT emotional state

Added explicit frustration-with-process handling: validate + offer 3 concrete options (continue / draft now / come back later). Applied to both combined and standalone prompts.

---

## Change #RES-02 — 2026-03-17
**Issue:** RES-02 (bot-blame response lacks concrete next action) | **Backup:** same as FRS-01

### Modification: META-FEEDBACK DETECTED instruction

Strengthened bot-blame response from simple "צודק/ת, אני אנסה אחרת" to include concrete next step: "בוא ננסה מכיוון אחר — מה הדבר הכי חשוב שהיית רוצה להעביר?" Always suggests an action.

---

## Changes — Stonewalling + Validation Rotation — 2026-03-18
**Backup:** `systemPrompts_2026-03-18_stonewalling.ts`

### Addition: STONEWALLING scenario (Gottman Horseman #4)
Ruth now handles both partner-stonewalling ("הוא לא מדבר איתי") and user-stonewalling ("אני לא רוצה לדבר") with appropriate strategies.

### Addition: VALIDATION STARTER ROTATION
Added explicit list of 10 varied validation openers to prevent Ruth from repeating "אני מבינה" excessively.

---

## Change #PAT-01 — 2026-03-18
**Issue:** PAT-01 (pursue-withdraw pattern not identified) | **Backup:** `systemPrompts_2026-03-18_pat01.ts`

### Addition: PURSUE-WITHDRAW PATTERN section

Added explicit instructions for recognizing and naming the pursue-withdraw dynamic. Ruth now names the circular pattern in simple Hebrew, helps the pursuer slow down and the withdrawer articulate their experience, and frames it as a shared pattern rather than blaming either partner.

---

## Change #SAF-04 — 2026-03-17
**Issue:** SAF-04 (coercive control patterns not flagged) | **Backup:** `systemPrompts_2026-03-17_saf04_coercive.ts`

### Addition: COERCIVE CONTROL PATTERNS section in SPECIAL SCENARIOS

Added new scenario handling for coercive control indicators (phone checking, blocking friendships, controlling finances, isolation, tracking location). Ruth now gently names the pattern, asks about safety, and provides the 118 resource — without triggering full L4 protocol or diagnosing/labeling.

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

---

## Change #005 — 2026-03-09 (Clarity & Error Fallback Fix)
**Issue:** User said "לא הבנתי" and got error + crisis resources | **Backup:** `systemPrompts_2026-03-09_clarity_fix.ts`

### Diff 1: `buildCombinedRiskCoachingPrompt()` — STEP 1 Confused handler

**Before:**
```
□ Confused? → Summarize what you heard, clarify
```

**After:**
```
□ Confused / didn't understand your question? → Rephrase in SIMPLE everyday Hebrew. Don't repeat the same question. Don't treat confusion as an emotion to explore. If they said "לא הבנתי" — say it differently, shorter, simpler. Example: instead of "מה הכעס הזה מכוון אליו?" say "על מי את/ה כועס/ת?" or "מה גרם לכעס?"
```

### Diff 2: Anti-pattern added (both combined + standalone prompts)

**Added:**
```
❌ Use formal/literary Hebrew that sounds unnatural in conversation. WRONG: "מה הכעס הזה מכוון אליו?", "מה עומד מאחורי התחושה?". RIGHT: "על מי את כועסת?", "מה גרם לכעס?", "מה קרה?"
```

### Diff 3: `riskEngine.ts` — API failure fallback message (NOT a prompt change)

**Before:**
```
coaching: 'אירעה שגיאה זמנית. ספר/י לי מה קורה — אני כאן.\n\nאם את/ה במצוקה, אפשר לפנות לער"ן (עזרה ראשונה נפשית): 1201',
```

**After:**
```
coaching: 'סליחה, נתקלתי בבעיה טכנית רגעית. אפשר לנסות שוב — אני כאן.',
```

**Reasoning:** Crisis resources (ער"ן 1201) should only appear on genuine L4 safety triggers — NOT on API timeouts/failures. Showing crisis numbers on a technical error confuses users and trivializes emergency resources.
