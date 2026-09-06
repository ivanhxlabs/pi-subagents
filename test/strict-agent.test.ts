import { describe, expect, it } from "vitest";
import {
  canAdvanceStrictRoute,
  emptyStrictExecutionEvidence,
  type StrictAttemptReceipt,
} from "../src/strict-agent.js";

function attempt(overrides: Partial<StrictAttemptReceipt> = {}): StrictAttemptReceipt {
  return {
    attemptId: "strict-launch:0",
    candidateIndex: 0,
    requestedModel: "provider/model",
    outcome: "pre-execution-failure",
    failure: { code: "MODEL_UNAVAILABLE", message: "unavailable" },
    evidence: emptyStrictExecutionEvidence(),
    ...overrides,
  };
}

describe("canAdvanceStrictRoute", () => {
  it.each([
    "MODEL_UNAVAILABLE",
    "AUTH_UNAVAILABLE",
    "CANONICAL_MODEL_MISMATCH",
    "EFFECTIVE_EFFORT_MISMATCH",
  ] as const)("advances after proven zero-execution %s", code => {
    expect(canAdvanceStrictRoute(attempt({ failure: { code, message: code } }))).toBe(true);
  });

  it.each([
    "PREFLIGHT_FAILED",
    "CANCELLED",
    "PROVIDER_FAILED",
    "SCHEMA_REJECTED",
    "TOOL_FAILED",
    "CHILD_FAILED",
    "RUNTIME_FAILED",
  ] as const)("does not advance after %s", code => {
    expect(canAdvanceStrictRoute(attempt({ failure: { code, message: code } }))).toBe(false);
  });

  it("does not advance once execution or any assistant/tool activity is observed", () => {
    const evidenceCases = [
      { executionStarted: true },
      { assistantMessageStartedCount: 1 },
      { assistantOutputEventCount: 1 },
      { toolCallStartedCount: 1 },
    ];
    for (const evidence of evidenceCases) {
      expect(canAdvanceStrictRoute(attempt({
        evidence: { ...emptyStrictExecutionEvidence(), ...evidence },
      }))).toBe(false);
    }
  });

  it("requires a pre-execution-failure outcome and typed failure", () => {
    expect(canAdvanceStrictRoute(attempt({ outcome: "post-execution-failure" }))).toBe(false);
    expect(canAdvanceStrictRoute(attempt({ failure: undefined }))).toBe(false);
  });
});
