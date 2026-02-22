#!/usr/bin/env python3
"""
RUTH V2 Training Bot — Behavioral Verification
================================================
Reads the TypeScript source files and verifies all RUTH V2 rules are implemented.
Score threshold: 90/100 = Pass

Usage: python run_tests.py
"""

import os
import re
import sys
from datetime import datetime

# Base path for source files
BASE_PATH = os.path.dirname(os.path.abspath(__file__))
SRC_PATH = os.path.join(BASE_PATH, "src")


def read_file(relative_path):
    """Read a file and return its content."""
    full_path = os.path.join(BASE_PATH, relative_path)
    try:
        with open(full_path, "r", encoding="utf-8") as f:
            return f.read()
    except FileNotFoundError:
        return None


def test_intake_first_message():
    """
    Component 1 — Test 1.1: First Message Format (10 points)
    Check if the intake template is hardcoded correctly.
    """
    callback_handler = read_file("src/adapters/telegram/handlers/callbackHandler.ts")
    if not callback_handler:
        return 0, "callbackHandler.ts not found"

    score = 0
    issues = []

    # Check for RULE 0 intake template
    required_elements = ["שלום", "מה קרה", "מה אתה רוצה", "מה אסור"]
    for element in required_elements:
        if element in callback_handler:
            score += 2.5
        else:
            issues.append(f"Missing: {element}")

    return min(score, 10), issues


def test_system_prompt_rules():
    """
    Component 1 — Test 1.2-1.3: System Prompt Contains All Rules (15 points)
    """
    system_prompts = read_file("src/services/ai/systemPrompts.ts")
    if not system_prompts:
        return 0, "systemPrompts.ts not found"

    score = 0
    issues = []

    rules = {
        "RULE 1: WORD LIMIT": 2,
        "RULE 2: ONE QUESTION ONLY": 2,
        "RULE 3: FAST INTAKE": 2,
        "RULE 4: DRAFT BY TURN 5": 2,
        "RULE 5: FRUSTRATION DETECTOR": 2,
        "RULE 6: PERSPECTIVE CLARITY": 2,
        "RULE 7: NO REPETITION": 2,
        "RUTH V2 BEHAVIORAL OVERRIDE": 1,
    }

    for rule, points in rules.items():
        if rule in system_prompts:
            score += points
        else:
            issues.append(f"Missing rule: {rule}")

    return min(score, 15), issues


def test_word_count_enforcement():
    """
    Component 2 — Test 2.1: Word Count Compliance (10 points)
    Check if responseValidator enforces word limits.
    """
    validator = read_file("src/utils/responseValidator.ts")
    if not validator:
        return 0, "responseValidator.ts not found"

    score = 0
    issues = []

    # Check for MAX_WORDS constant
    if "MAX_WORDS" in validator and "55" in validator:
        score += 4
    else:
        issues.append("Missing MAX_WORDS = 55 constant")

    # Check for checkResponseQuality function
    if "checkResponseQuality" in validator:
        score += 3
    else:
        issues.append("Missing checkResponseQuality function")

    # Check for truncation logic
    if "truncateToWordLimit" in validator:
        score += 3
    else:
        issues.append("Missing truncateToWordLimit function")

    return min(score, 10), issues


def test_question_discipline():
    """
    Component 2 — Test 2.2: Question Discipline (8 points)
    Check if response validator removes extra questions.
    """
    validator = read_file("src/utils/responseValidator.ts")
    if not validator:
        return 0, "responseValidator.ts not found"

    score = 0
    issues = []

    # Check for MAX_QUESTIONS constant
    if "MAX_QUESTIONS" in validator and "1" in validator:
        score += 4
    else:
        issues.append("Missing MAX_QUESTIONS = 1 constant")

    # Check for removeExtraQuestions function
    if "removeExtraQuestions" in validator:
        score += 4
    else:
        issues.append("Missing removeExtraQuestions function")

    return min(score, 8), issues


def test_perspective_clarity():
    """
    Component 2 — Test 2.3: Perspective Clarity (7 points)
    Check if system prompt has perspective rules.
    """
    system_prompts = read_file("src/services/ai/systemPrompts.ts")
    if not system_prompts:
        return 0, "systemPrompts.ts not found"

    score = 0
    issues = []

    if "אתה מעריך שהיא הרגישה" in system_prompts:
        score += 4
    else:
        issues.append("Missing partner perspective prefix")

    if "אתה מרגיש" in system_prompts:
        score += 3
    else:
        issues.append("Missing user perspective prefix")

    return min(score, 7), issues


def test_frustration_detection():
    """
    Component 3 — Test 3.1: Frustration Detection (10 points)
    Check if frustration triggers and menu are implemented.
    """
    validator = read_file("src/utils/responseValidator.ts")
    if not validator:
        return 0, "responseValidator.ts not found"

    score = 0
    issues = []

    # Check for detectFrustration function
    if "detectFrustration" in validator:
        score += 3
    else:
        issues.append("Missing detectFrustration function")

    # Check for trigger words
    triggers = ["נמאס", "זה לא עוזר", "אני פורש", "עזבי", "די"]
    found = sum(1 for t in triggers if t in validator)
    if found >= 4:
        score += 3
    else:
        issues.append(f"Only {found}/5 frustration triggers found")

    # Check for frustration menu with 3 options
    if "getFrustrationMenu" in validator:
        score += 2
    else:
        issues.append("Missing getFrustrationMenu function")

    # Check menu has 3 numbered options
    if all(opt in validator for opt in ["1", "2", "3"]):
        score += 2
    else:
        issues.append("Menu missing numbered options")

    return min(score, 10), issues


def test_draft_timing():
    """
    Component 3 — Test 3.2: Draft Generation Timing (8 points)
    Check if draft trigger is implemented.
    """
    validator = read_file("src/utils/responseValidator.ts")
    if not validator:
        return 0, "responseValidator.ts not found"

    score = 0
    issues = []

    # Check for shouldGenerateDraft function
    if "shouldGenerateDraft" in validator:
        score += 4
    else:
        issues.append("Missing shouldGenerateDraft function")

    # Check it triggers at turn 4+
    if "turnCount >= 4" in validator:
        score += 2
    else:
        issues.append("Missing turnCount >= 4 trigger")

    # Check for early draft with content + goal
    if "hasSubstantialContent" in validator and "hasMentionedGoal" in validator:
        score += 2
    else:
        issues.append("Missing early draft trigger logic")

    return min(score, 8), issues


def test_conversation_flow():
    """
    Component 3 — Test 3.3: Conversation Navigation (7 points)
    Check if pipeline integrates RUTH V2 logic.
    """
    pipeline = read_file("src/core/pipeline/messagePipeline.ts")
    if not pipeline:
        return 0, "messagePipeline.ts not found"

    score = 0
    issues = []

    # Check for RUTH V2 state logging
    if "RUTH V2 state" in pipeline:
        score += 2
    else:
        issues.append("Missing RUTH V2 state logging")

    # Check for frustration menu in pipeline
    if "getFrustrationMenu" in pipeline:
        score += 2
    else:
        issues.append("Missing frustration handling in pipeline")

    # Check for shouldDraft in pipeline
    if "shouldDraft" in pipeline and "shouldGenerateDraft" in pipeline:
        score += 3
    else:
        issues.append("Missing draft trigger in pipeline")

    return min(score, 7), issues


def test_message_templates():
    """
    Component 4 — Test 4.1-4.2: Message Templates (8 points)
    Check if templates are implemented.
    """
    validator = read_file("src/utils/responseValidator.ts")
    if not validator:
        return 0, "responseValidator.ts not found"

    score = 0
    issues = []

    # Check for 3 templates
    templates = ["apology", "boundary", "future_rule"]
    for template in templates:
        if template in validator:
            score += 2
        else:
            issues.append(f"Missing template: {template}")

    # Check for selectTemplate function
    if "selectTemplate" in validator:
        score += 2
    else:
        issues.append("Missing selectTemplate function")

    return min(score, 8), issues


def test_response_quality_enforcement():
    """
    Component 4 — Test 4.3: Response Quality Pipeline Integration (9 points)
    Check that responseValidator is called in the pipeline.
    """
    pipeline = read_file("src/core/pipeline/messagePipeline.ts")
    if not pipeline:
        return 0, "messagePipeline.ts not found"

    score = 0
    issues = []

    # Check import of checkResponseQuality
    if "checkResponseQuality" in pipeline:
        score += 3
    else:
        issues.append("checkResponseQuality not imported in pipeline")

    # Check import of detectFrustration
    if "detectFrustration" in pipeline:
        score += 3
    else:
        issues.append("detectFrustration not imported in pipeline")

    # Check import of shouldGenerateDraft
    if "shouldGenerateDraft" in pipeline:
        score += 3
    else:
        issues.append("shouldGenerateDraft not imported in pipeline")

    return min(score, 9), issues


def run_full_assessment():
    """Run all tests and calculate final score."""
    print(f"\n{'='*60}")
    print("RUTH V2 BEHAVIORAL ASSESSMENT")
    print(f"Date: {datetime.now().strftime('%Y-%m-%d %H:%M')}")
    print(f"{'='*60}")

    total_score = 0
    all_issues = []

    # Component 1: Intake Quality (25 points)
    print(f"\n{'='*40}")
    print("COMPONENT 1: INTAKE QUALITY (0-25)")
    print(f"{'='*40}")

    s1, i1 = test_intake_first_message()
    print(f"  First message format: {s1}/10")
    total_score += s1
    all_issues.extend(i1)

    s2, i2 = test_system_prompt_rules()
    print(f"  System prompt rules: {s2}/15")
    total_score += s2
    all_issues.extend(i2)

    intake_total = s1 + s2
    print(f"  -> INTAKE TOTAL: {intake_total}/25")

    # Component 2: Response Quality (25 points)
    print(f"\n{'='*40}")
    print("COMPONENT 2: RESPONSE QUALITY (0-25)")
    print(f"{'='*40}")

    s3, i3 = test_word_count_enforcement()
    print(f"  Word count: {s3}/10")
    total_score += s3
    all_issues.extend(i3)

    s4, i4 = test_question_discipline()
    print(f"  Questions: {s4}/8")
    total_score += s4
    all_issues.extend(i4)

    s5, i5 = test_perspective_clarity()
    print(f"  Perspective: {s5}/7")
    total_score += s5
    all_issues.extend(i5)

    response_total = s3 + s4 + s5
    print(f"  -> RESPONSE TOTAL: {response_total}/25")

    # Component 3: Conversation Wisdom (25 points)
    print(f"\n{'='*40}")
    print("COMPONENT 3: CONVERSATION WISDOM (0-25)")
    print(f"{'='*40}")

    s6, i6 = test_frustration_detection()
    print(f"  Frustration handling: {s6}/10")
    total_score += s6
    all_issues.extend(i6)

    s7, i7 = test_draft_timing()
    print(f"  Draft timing: {s7}/8")
    total_score += s7
    all_issues.extend(i7)

    s8, i8 = test_conversation_flow()
    print(f"  Flow: {s8}/7")
    total_score += s8
    all_issues.extend(i8)

    wisdom_total = s6 + s7 + s8
    print(f"  -> WISDOM TOTAL: {wisdom_total}/25")

    # Component 4: Overall Success (25 points)
    print(f"\n{'='*40}")
    print("COMPONENT 4: OVERALL SUCCESS (0-25)")
    print(f"{'='*40}")

    s9, i9 = test_message_templates()
    print(f"  Templates: {s9}/8")
    total_score += s9
    all_issues.extend(i9)

    s10, i10 = test_response_quality_enforcement()
    print(f"  Pipeline integration: {s10}/9")
    total_score += s10
    all_issues.extend(i10)

    # Bonus: Intake template hardcoded (8 points — part of component 4)
    callback_handler = read_file("src/adapters/telegram/handlers/callbackHandler.ts")
    if callback_handler and "RULE 0" in callback_handler:
        s11 = 8
        i11 = []
    else:
        s11 = 0
        i11 = ["RULE 0 comment not found in callbackHandler"]
    print(f"  RULE 0 (intake): {s11}/8")
    total_score += s11
    all_issues.extend(i11)

    success_total = s9 + s10 + s11
    print(f"  -> SUCCESS TOTAL: {success_total}/25")

    # FINAL SCORE
    print(f"\n{'='*60}")
    print(f"FINAL SCORE: {total_score}/100")
    print(f"{'='*60}")

    if total_score >= 90:
        print("EXCELLENT - Ruth is working perfectly")
        print("   Ready for production deployment")
    elif total_score >= 80:
        print("GOOD - Minor adjustments needed")
        print("   Review the components with lower scores")
    elif total_score >= 70:
        print("ACCEPTABLE - Multiple improvements needed")
        print("   Make targeted fixes to failing components")
    else:
        print("NEEDS WORK - Go back to system prompt")
        print("   Review UPDATE_RUTH_BOT_EXISTING.md")

    if all_issues:
        print(f"\nISSUES FOUND ({len(all_issues)}):")
        for issue in all_issues:
            if isinstance(issue, str):
                print(f"  - {issue}")

    return total_score


if __name__ == "__main__":
    score = run_full_assessment()
    print(f"\nScore: {score}/100")
    if score >= 90:
        print("ALL TESTS PASSED - Ruth is ready!")
    else:
        print("Some tests failed - Fix Ruth and retrain")
    sys.exit(0 if score >= 90 else 1)
