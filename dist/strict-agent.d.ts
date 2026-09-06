/**
 * Public, pi-independent contract for opt-in strict workflow launches.
 *
 * Policy such as model families, route-table versions, pair gates and lane
 * ordering belongs to the caller. This module describes only the runtime-owned
 * route execution and evidence returned by `strictAgent()`.
 */
export declare const STRICT_AGENT_CONTRACT_VERSION: 1;
export declare const STRICT_EFFORT_LEVELS: readonly ["minimal", "low", "medium", "high", "xhigh", "max"];
export type StrictEffort = (typeof STRICT_EFFORT_LEVELS)[number];
export type StrictObservedEffort = StrictEffort | "off";
export declare const STRICT_ADVANCE_FAILURE_CODES: readonly ["MODEL_UNAVAILABLE", "AUTH_UNAVAILABLE", "CANONICAL_MODEL_MISMATCH", "EFFECTIVE_EFFORT_MISMATCH"];
export type StrictAdvanceFailureCode = (typeof STRICT_ADVANCE_FAILURE_CODES)[number];
export type StrictContractFailureCode = "UNSUPPORTED_CONTRACT_VERSION" | "INVALID_ARGUMENT" | "UNKNOWN_AGENT_TYPE" | "INVALID_MODEL_ID" | "UNSUPPORTED_EFFORT" | "INVALID_SCHEMA" | "INVALID_ISOLATION" | "STRICT_REPLAY_UNSUPPORTED" | "INCOMPATIBLE_PI_RUNTIME";
export type StrictPreExecutionFailureCode = StrictAdvanceFailureCode | "PREFLIGHT_FAILED" | "CANCELLED";
export type StrictPostExecutionFailureCode = "PROVIDER_FAILED" | "SCHEMA_REJECTED" | "TOOL_FAILED" | "CHILD_FAILED" | "RUNTIME_FAILED" | "CANCELLED";
export type StrictAttemptFailureCode = StrictPreExecutionFailureCode | StrictPostExecutionFailureCode;
export interface StrictFailure<Code extends string = string> {
    code: Code;
    /** Sanitized, bounded diagnostic text. */
    message: string;
}
export interface StrictExecutionEvidence {
    executionStarted: boolean;
    assistantMessageStartedCount: number;
    assistantOutputEventCount: number;
    toolCallStartedCount: number;
}
export type StrictAttemptOutcome = "selected" | "pre-execution-failure" | "post-execution-failure";
export interface StrictAttemptReceipt {
    attemptId: string;
    candidateIndex: number;
    requestedModel: string;
    observedModel?: string;
    observedEffort?: StrictObservedEffort;
    outcome: StrictAttemptOutcome;
    failure?: StrictFailure<StrictAttemptFailureCode>;
    evidence: StrictExecutionEvidence;
}
export interface StrictSelectedRoute {
    candidateIndex: number;
    requestedModel: string;
    observedModel: string;
    requestedEffort: StrictEffort;
    observedEffort: StrictEffort;
}
interface StrictRouteResultBase {
    contractVersion: typeof STRICT_AGENT_CONTRACT_VERSION;
    launchId: string;
    agentType: string;
    requestedEffort: StrictEffort;
    attempts: StrictAttemptReceipt[];
}
export interface StrictRouteSuccess<Result = unknown> extends StrictRouteResultBase {
    outcome: "succeeded";
    selected: StrictSelectedRoute;
    result: Result;
}
export interface StrictRouteFailure extends StrictRouteResultBase {
    outcome: "failed";
    failure: StrictFailure<"ROUTE_EXHAUSTED" | StrictAttemptFailureCode>;
}
export type StrictRouteResult<Result = unknown> = StrictRouteSuccess<Result> | StrictRouteFailure;
export interface StrictContractFailure {
    contractError: StrictFailure<StrictContractFailureCode>;
}
export declare function emptyStrictExecutionEvidence(): StrictExecutionEvidence;
export declare function canAdvanceStrictRoute(attempt: StrictAttemptReceipt): boolean;
export {};
