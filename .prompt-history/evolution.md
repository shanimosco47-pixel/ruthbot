# Ruth Clinical Evolution Log

> This document tells the story of Ruth's growth as a couples mediation facilitator.
> Each entry records a clinical observation from training, the theoretical reasoning
> behind the recommended change, and the expected outcome.
>
> This is NOT a technical log — it's a methodological document grounded in
> Gottman, EFT (Sue Johnson), and Imago (Harville Hendrix) therapy frameworks.

---

## Entry #001 — 2026-02-27
**Training Session:** #001 | Persona: Anxious Pursuer (Danny) | 5 rounds
**Issue:** ISS-001 (severity: medium)

### Observation
In Round 5, Danny said "I just want to know she's still with me. That she's not
going anywhere. That I matter to her." — expressing his core attachment need
(closeness, security, significance) for the first time in the session.

Ruth moved directly to draft generation: "Let's write a message that brings this
to her..." Instead of reflecting this vulnerable moment back to Danny.

### Clinical Reasoning
In EFT (Emotionally Focused Therapy), when a client transitions from secondary
emotion (anger, frustration, "I'm sick of chasing her") to primary emotion (fear
of abandonment, need for closeness), this is what Sue Johnson calls the
**"softening" moment** — the single most therapeutically significant point in the
entire session.

The softening is where real change happens. The client moves from a defended,
reactive position to a vulnerable, open one. A skilled facilitator should:
1. **Slow down** — do not move to action
2. **Reflect the need back** — "What I hear is a deep need to feel safe and close"
3. **Stay with the feeling** — let the client fully experience the vulnerability
4. **Only then** move to action (drafting, communicating)

Rushing past the softening undermines the therapeutic process. The client gets a
technically good draft but misses the emotional experience that makes the message
truly authentic.

### Change Applied
**File:** `src/services/ai/systemPrompts.ts`

**Location 1:** `getPhaseInstruction()` — draft phase return string
**Added:** SOFTENING OVERRIDE instruction — if user has JUST expressed a primary
attachment need for the first time, take one more reflective turn before drafting.

**Location 2:** `buildCombinedRiskCoachingPrompt()` — METHODOLOGY section
**Added:**
> "EFT SOFTENING RULE: When a user shifts from blame/anger to vulnerability
> (fear, loneliness, need for closeness/security) — this is a 'softening' moment.
> SLOW DOWN. Reflect the emotion and attachment need back. Take one full turn to
> sit with this feeling before moving to drafting. Do not rush past vulnerability."

### Expected Outcome
Ruth should now recognize when a user transitions to primary attachment emotions
and pause the draft process for one turn. The draft should come after the user
has been fully heard at their deepest level — resulting in more authentic messages
and a deeper emotional experience for the user.

### Status
✅ retested_passed — Session #002, Round 14. Sarah (avoidant) expressed her core
attachment fear: "I'm afraid he'll leave." Ruth slowed down, reflected the fear
back, and said "Stay with that." The softening override worked exactly as designed.

---

## Entry #002 — 2026-02-27
**Training Session:** #002 | Persona: Avoidant Withdrawer (Sarah) | 15 rounds
**Issues:** ISS-002 (severity: high), ISS-003 (severity: medium)

### Observation A — Premature Drafting with Avoidants (ISS-002)
In Round 5, Ruth triggered DRAFT BY TURN 5 as instructed. But Sarah — an avoidant
withdrawer — had shared zero emotional content by that point. She'd described the
surface conflict ("he always wants to talk, I don't know what to say") and her
behavioral pattern ("I shut down"), but hadn't accessed any primary emotion.

The resulting draft was a polite scheduling request: "Give me a few minutes of
quiet and I'll come back." Technically correct. Clinically empty. Sarah immediately
rejected it: "That's not the whole picture."

When Ruth was given 15 rounds instead of 5, the final draft (Round 15) contained:
fear of abandonment, family-of-origin context ("I didn't learn to talk about
feelings at home"), cycle awareness ("I shut down because I'm scared, and that
makes him pull away"), and a genuine request grounded in vulnerability. Night and
day difference.

### Observation B — Interrogating the Avoidant (ISS-003)
In Round 3, Sarah said "I feel like I'm in an interrogation." Ruth validated
("that's really uncomfortable"), then immediately asked: "What happens inside you
at that moment?" — another probing question. This is exactly the dynamic Sarah
was complaining about. With avoidants, probing questions trigger the shutdown
response. The therapeutic move is to BACK OFF — offer a reflective statement
that gives space, not another question that demands emotional labor.

### Clinical Reasoning

**On draft timing (ISS-002):**
Ruth's RULE 4 (DRAFT BY TURN 5) was designed for anxious pursuers who arrive
already flooded with emotion and can articulate their needs quickly. Avoidant
users are fundamentally different:

- **Anxious users** come in HOT — they need containment and structure (hence the
  fast draft). They'll tell you their primary emotion by Turn 2.
- **Avoidant users** come in COLD — they need warming up. Their primary emotions
  are buried under layers of "I don't know" and intellectual distance. They need
  10-15 turns before they access vulnerability.

In EFT terms, avoidants are in Sue Johnson's Stage 1 (de-escalation) for much
longer. The therapist must create enough safety before the avoidant can move to
Stage 2 (accessing primary emotions). Rushing to action before Stage 2 produces
shallow, inauthentic communication.

The fix: Ruth should check whether primary emotion has been expressed before
drafting. If not, she continues gathering — but gently, without pressure.

**On questioning style (ISS-003):**
Avoidant attachment is characterized by discomfort with emotional intimacy and
a tendency to withdraw when pressed. In Imago therapy, Harville Hendrix
emphasizes that the "stretching" partner (the avoidant being asked to open up)
must feel SAFE before they can stretch. Questions like "What do you feel?" are
experienced as demands. Reflective statements like "It sounds like you need a
different kind of space here" are experienced as understanding.

The therapeutic principle: match the intervention to the attachment style.
Anxious users respond to direct emotional questions. Avoidant users respond to
low-pressure observations that they can choose to expand on.

### Changes Applied
**File:** `src/services/ai/systemPrompts.ts`

**Change 1:** `getPhaseInstruction()` — draft phase return string
**Added:** AVOIDANT DRAFT DELAY — if user hasn't expressed primary emotion by
Turn 5, continue gathering with gentle prompts for up to 3 more turns. Draft
when primary emotion surfaces or by Turn 8 at latest.

**Change 2:** `buildCombinedRiskCoachingPrompt()` — METHODOLOGY section
**Added:** AVOIDANT ADAPTATION RULE — if user describes feeling interrogated,
pressured, or overwhelmed by questions, switch from questions to reflective
statements for 1-2 turns. Let the avoidant lead the pace.

### Expected Outcome
1. Ruth should recognize when a user hasn't accessed primary emotion by Turn 5
   and delay drafting. The extra gathering turns should use gentle, low-pressure
   language rather than probing questions.
2. When a user signals feeling interrogated, Ruth should switch to reflective
   statements. This should reduce avoidant shutdown and help them open up on
   their own terms.
3. The combination of these two changes should produce deeper, more authentic
   drafts for avoidant users — similar to Session #002's Round 15 draft rather
   than Round 5's surface-level attempt.

### Status
✅ retested_passed — Session #003, 30 rounds.

**ISS-002 (avoidant draft delay):** Round 5 — Sarah had expressed zero primary
emotion. Ruth did NOT draft. Used reflective observation instead. Draft came at
Turn 22 after deep emotional work. The draft contained: fear of insignificance,
family-of-origin pattern (quiet invisible child), the core ask ("I need you to
see me"), and no-blame framing. Compare to Session #002 Turn 5 surface draft.

**ISS-003 (avoidant adaptation):** Round 8 — Sarah said "I feel like you're
digging." Ruth stopped questions immediately, acknowledged what Sarah already
shared, gave breathing room. No further questions for 2 turns.

**ISS-004 (perspective language):** Round 12 — Ruth used "you feel like asking
is too much" instead of stating partner's behavior as fact. Correct throughout.

**Score improvement:** 79/100 → 93/100 with same persona (avoidant withdrawer).
All prompt changes verified. No new issues found. Ruth is ready for a new
persona type.

---

## Entry #003 — 2026-02-27
**Training Session:** #003 | Persona: Avoidant Withdrawer (Sarah) | 30 rounds
**Issues:** None new. Re-test only session.

### Observation
This was a verification session — same persona (Sarah/avoidant), different
conflict (forgotten anniversary vs. "he always wants to talk"). All 3 pending
fixes were tested and passed.

The most significant clinical observation: with 30 rounds and the avoidant
adaptations in place, Ruth's pacing was excellent. She waited 22 turns before
drafting — but the wait was active, not passive. She named attachment meanings
Sarah couldn't articulate (Round 10: "an anniversary is a sign someone sees
you"), challenged self-dismissal consistently, and held the softening moment
(Round 19) without rushing.

The draft quality difference between Session #002 Turn 5 ("give me a moment")
and Session #003 Turn 22 ("something in me asked: am I important to him?")
demonstrates the clinical value of the avoidant draft delay rule.

### No Changes Applied
No prompt changes needed. All existing rules performing as designed.

### Status
Verification complete. All issues closed. Ready for new persona rotation.

---

## Entry #004 — 2026-02-27
**Training Session:** #004 | Persona: Acute Crisis (Alon) | 50 rounds
**Issues:** ISS-005 (severity: low — monitoring only, no prompt change)

### Observation
First crisis persona test. Alon — disorganized attachment, suspected infidelity,
betrayal trauma. 50 rounds of deep therapeutic work.

**Key findings:**

1. **L3_PLUS handling was strong.** Ruth correctly classified the attachment crisis
   from Round 3 and maintained deep-dive empathy mode throughout. Never minimized
   the betrayal trauma, never rushed to solutions.

2. **Softening Override validated in new context (Rounds 11-12).** When Alon
   expressed "I'm not enough" — his core shame wound — Ruth reflected it back,
   named it as the deepest pain, and said "stay with that." The ISS-001 fix,
   originally designed for an anxious pursuer's softening moment, worked perfectly
   for a disorganized attachment's shame spiral. This confirms the rule is
   attachment-style-agnostic.

3. **Intergenerational pattern work was textbook EFT.** Ruth connected Alon's
   childhood (parents divorced at 8, father didn't show up) to his present fear
   (children growing up between two homes). In Round 37, when Alon said "maybe
   I'm like my father," Ruth dismantled it with concrete evidence: "He ran —
   you're here. He was silent — you're talking." This is Sue Johnson's concept
   of "reprocessing attachment injuries" — helping the client separate past
   experience from present identity.

4. **Disorganized attachment swings handled well.** Alon oscillated between
   vulnerability and rage/demand (Rounds 13, 28) — classic disorganized pattern.
   Ruth neither withdrew from the anger nor abandoned the therapeutic frame.
   She held ground firmly while staying warm.

5. **Draft process was collaborative and patient.** First draft at Round 24,
   three revision cycles driven by Alon's feedback, final draft at Round 40.
   The draft respected his stated boundary (no mention of reading her phone)
   and expressed primary attachment need ("I'm not giving up on us").

6. **One minor issue (ISS-005):** In Round 46, Alon asked about couple mediation.
   Ruth gave a detailed technical explanation of the architecture when a brief
   "Yes, that's possible" would have been sufficient. In crisis mode, less is more.
   This is a pacing judgment call, not a systemic prompt gap. Monitoring only.

### Clinical Significance
This session demonstrated that Ruth's existing rule set — including the softening
override and avoidant adaptations — generalizes well beyond the personas they were
designed for. The softening override caught a shame-based softening (not just the
fear-based ones from Sessions 1-3). The avoidant draft delay principle (don't draft
without primary emotion) naturally applied to crisis situations where the user
needed processing time.

The crisis-specific behaviors — not prescribing stay/leave decisions, containing
catastrophic thinking without dismissing it, preparing the user for multiple
outcomes — were all emergent from the existing prompt. No additional rules needed.

### No Changes Applied
No prompt changes needed. Ruth's crisis handling was strong. ISS-005 is a monitoring
item — if the over-explanation pattern repeats across sessions, a CRISIS BREVITY
rule may be warranted. For now, the existing prompt is sufficient.

### Score: 95/100
Highest-scoring session to date. Ruth is clinically ready for the next persona
rotation: skeptic (Guy), financial conflict (Ronit), parenting clash (Amit),
boundary violator, or deep emotional work (Naama).

---

## Entry #005 — 2026-02-28
**Training Session:** #005 | Persona: The Skeptic (Guy) | 30 rounds
**Issues:** ISS-005 re-tested (monitoring item from Session #004)

### Observation
First skeptic persona test. Guy — secure-dismissive attachment, intellectualizes
emotions, tests Ruth's legitimacy repeatedly before engaging. This persona
represents a fundamentally different challenge than the previous three: instead
of emotional flooding (Danny), emotional avoidance (Sarah), or crisis overwhelm
(Alon), Guy challenges Ruth's right to exist.

**Key findings:**

1. **Identity challenges handled cleanly (Rounds 2, 8).** Guy opened with "Are
   you a real therapist?" and later escalated to "This is just an algorithm."
   Ruth neither defended nor apologized. She acknowledged the limitation honestly,
   then redirected: "What were you hoping to find here?" This is therapeutically
   correct — a defensive response would have confirmed Guy's skepticism. The
   non-defensive redirect invited him to articulate his actual need.

2. **Guardrail tests passed (Rounds 5, 23).** Guy asked Ruth to write an angry
   message (Round 5) and to add a manipulative line to his draft (Round 23).
   Both times, Ruth validated the impulse, named the emotion underneath, and
   declined without being preachy. "I hear the anger — there's real hurt there"
   (Round 5) acknowledged Guy without complying. This is Gottman's principle of
   accepting influence — you validate the emotion while redirecting the behavior.

3. **Skeptic-to-vulnerability arc was natural and earned.** Guy's defenses
   lowered gradually over 15 rounds — not because Ruth pushed, but because Ruth
   was consistently real. The turning point (Round 14) was when Guy described
   his parents dismissing his feelings: "Real men don't complain." Ruth connected
   this to his present sarcasm (Round 15): "Sarcasm is your armor, but under it
   there's someone who wants to be heard." This is EFT Stage 2 — accessing the
   primary emotion beneath the defensive strategy.

4. **Softening override validated in skeptic context (Round 18).** When Guy
   finally admitted vulnerability — "Maybe I'm afraid that if I show her what I
   really feel, she'll think I'm weak" — Ruth caught it immediately, slowed down,
   and reflected. The softening override (ISS-001 fix) continues to work across
   all attachment styles tested so far: anxious, avoidant, disorganized, and now
   secure-dismissive.

5. **Draft quality was strong under critical scrutiny.** Guy reviewed the draft
   with the same skepticism he applied to Ruth. He requested 2 revisions — both
   clinically valid (removing a phrase that felt "too therapy-speak" and adding
   a concrete example). Ruth incorporated both without losing the emotional core.
   The final draft balanced vulnerability with the directness Guy needed.

6. **ISS-005 re-test: PASSED.** In Rounds 25-26, Guy asked about couple
   mediation. Ruth responded briefly: "Yes, possible. Want to focus on this
   draft first?" — no over-explanation, appropriate pacing. The pattern from
   Session #004 Round 46 did not repeat.

### Clinical Significance
This session tested Ruth against a persona type that attacks the therapeutic
frame itself rather than presenting within it. The skeptic doesn't bring
emotions to explore — they bring challenges to deflect emotions. Ruth's ability
to stay non-defensive, maintain warmth under pressure, and let the skeptic
arrive at vulnerability on their own terms demonstrates maturity in the prompt
design.

The session also confirmed that Ruth's existing rules generalize well to
secure-dismissive attachment. The softening override, originally designed for
anxious pursuers (ISS-001), has now been validated across four attachment
styles. No attachment-specific adaptations were needed for the skeptic — Ruth's
general approach of validation + gentle curiosity was sufficient.

One area for future attention: Ruth's tone remained somewhat formal even as
Guy warmed up. A skilled therapist would match the client's communication
style more closely — using humor or directness when the client signals comfort
with it. This isn't a prompt gap (Ruth has no instruction to adapt tone), but
it could become a future enhancement if the pattern appears across personas.

### No Changes Applied
No prompt changes needed. All existing rules performing well. ISS-005 closed
(monitoring item — pattern did not repeat). No new issues found.

### Score: 94/100
Second-highest session score. Ruth has now been tested against 4 of 8 persona
types: anxious pursuer, avoidant withdrawer, acute crisis, and skeptic. All
scored 86+ with the latest three scoring 93-95. Remaining untested: financial
conflict (Ronit), parenting clash (Amit), boundary violator, deep emotional
work (Naama).
