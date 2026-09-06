/**
 * Public, pi-independent contract for opt-in strict workflow launches.
 *
 * Policy such as model families, route-table versions, pair gates and lane
 * ordering belongs to the caller. This module describes only the runtime-owned
 * route execution and evidence returned by `strictAgent()`.
 */
export const STRICT_AGENT_CONTRACT_VERSION = 1;
export const STRICT_EFFORT_LEVELS = [
    "minimal",
    "low",
    "medium",
    "high",
    "xhigh",
    "max",
];
export const STRICT_ADVANCE_FAILURE_CODES = [
    "MODEL_UNAVAILABLE",
    "AUTH_UNAVAILABLE",
    "CANONICAL_MODEL_MISMATCH",
    "EFFECTIVE_EFFORT_MISMATCH",
];
export function emptyStrictExecutionEvidence() {
    return {
        executionStarted: false,
        assistantMessageStartedCount: 0,
        assistantOutputEventCount: 0,
        toolCallStartedCount: 0,
    };
}
export function canAdvanceStrictRoute(attempt) {
    return (attempt.outcome === "pre-execution-failure" &&
        attempt.failure !== undefined &&
        STRICT_ADVANCE_FAILURE_CODES.includes(attempt.failure.code) &&
        attempt.evidence.executionStarted === false &&
        attempt.evidence.assistantMessageStartedCount === 0 &&
        attempt.evidence.assistantOutputEventCount === 0 &&
        attempt.evidence.toolCallStartedCount === 0);
}
