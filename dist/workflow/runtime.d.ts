/**
 * runtime.ts — the host half of a workflow run.
 *
 * Owns the worker lifecycle, the RPC bridge, the concurrency semaphore, the
 * per-run caps, and the progress log. The script's only route to an agent is a
 * `call` message landing here, which is what makes the caps and the abort story
 * enforceable at all: a script cannot go around them because it has nothing to
 * go around them *with*.
 *
 * Spawning is injected rather than imported. `AgentManager` is a large, stateful
 * dependency and wiring it in directly would make every test here an integration
 * test; a {@link WorkflowHost} stub is a dozen lines. The adapter that binds this
 * to the real manager lives at the call site.
 */
import { STRICT_AGENT_CONTRACT_VERSION, type StrictAttemptReceipt, type StrictContractFailureCode, type StrictEffort, type StrictExecutionEvidence, type StrictFailure } from "../strict-agent.js";
import { type WorkflowJournalEntry } from "./journal.js";
import { type CompiledSchema } from "./json-schema.js";
import { type WorkflowMeta } from "./meta.js";
import type { WorkflowEntry } from "./progress.js";
/** Matches the `script` field's `maxLength` in the tool schema. */
export declare const MAX_SCRIPT_LENGTH = 524288;
/** Agents one run may schedule, in total. */
export declare const WORKFLOW_AGENT_CAP = 1000;
/** Items one `parallel()` or `pipeline()` call may take. */
export declare const WORKFLOW_ITEM_CAP = 4096;
/** Nested `workflow()` invocations allowed per run. */
export declare const WORKFLOW_NESTED_CAP = 256;
export declare class WorkflowRuntimeError extends Error {
}
/**
 * Concurrent agents allowed, leaving two cores for the host and the TUI.
 *
 * `Math.max(1, …)` is not decoration: the raw `min(16, cpus - 2)` is 0 on a one-
 * or two-core machine, and a semaphore with zero permits never hands out a slot,
 * so the run would hang before its first agent rather than fail.
 */
export declare function workflowConcurrency(cpuCount?: number): number;
/** One agent the script asked for. `agentId` is the handle for {@link WorkflowHost.abortAgent}. */
export interface WorkflowSpawnRequest {
    agentId: string;
    /** Position in the run, and the progress entry's stable identity. */
    index: number;
    prompt: string;
    label: string;
    agentType: string;
    model?: string;
    /**
     * Reasoning effort for this child, as one of pi's thinking levels.
     *
     * Typed as a plain string because this interface is the host boundary and
     * deliberately knows nothing about pi — `host.ts` is where it becomes a
     * `ThinkingLevel`. The worker has already rejected anything off the list.
     */
    effort?: string;
    isolation?: "worktree";
    /**
     * Called by the host once the child's EFFECTIVE configuration is known —
     * which is when its session exists, not when the spawn resolves.
     *
     * Without it a row could only ever show what the script asked for: a fuzzy
     * `model: "haiku"` stays `haiku` instead of the id it resolved to, an
     * `agent()` that named no model shows nothing at all, and a level pi clamped
     * is presented as the level that was requested (#168, #182).
     *
     * Plain strings, like `effort` above: this interface is the host boundary and
     * deliberately knows nothing about pi's `AgentInvocation`. Optional, so a host
     * that cannot report any of this simply does not, and the row keeps the
     * requested values it started with.
     */
    onResolved?(info: {
        /**
         * The host's own id for the child — the manager's `AgentRecord` id here.
         *
         * Reported as soon as the host has one, which is earlier than the rest of
         * this: the model is knowable only once a session exists, but the id is
         * what lets a reader open that child's conversation, and a child that
         * never got a model is exactly the one worth opening.
         */
        recordId?: string;
        modelName?: string;
        modelId?: string;
        thinking?: string;
        requestedThinking?: string;
        requestedModel?: string;
    }): void;
    /**
     * Compiled from the script's `agent({ schema })`.
     *
     * The host must give the child a `StructuredOutput` tool built from it and
     * return the validated payload as JSON text. Compiled rather than raw so the
     * runtime can re-check the answer without re-parsing the schema per call.
     */
    schema?: CompiledSchema;
    phaseIndex?: number;
    phaseTitle?: string;
    /**
     * The `gate` command this agent is being spawned under, when it has one.
     *
     * Passed down rather than run purely from here because an isolated child's
     * worktree is destroyed as part of its own settle: a host that can reach
     * inside that settle runs the gate there, against the tree the child wrote,
     * and reports the outcome back as {@link WorkflowSpawnResult.gate}. A host
     * that ignores this leaves the gate to {@link applyGate}, which then runs it
     * itself — so exactly one execution either way.
     */
    gate?: string;
}
export interface WorkflowStrictAgentRequest {
    contractVersion: typeof STRICT_AGENT_CONTRACT_VERSION;
    prompt: string;
    agentType: string;
    model: string;
    fallbackModels: string[];
    effort: StrictEffort;
    isolation?: "worktree";
    schema?: CompiledSchema;
    phaseIndex?: number;
    phaseTitle?: string;
}
export type WorkflowStrictValidationResult = {
    ok: true;
    agentType: string;
    isolation?: "worktree";
} | {
    ok: false;
    failure: StrictFailure<StrictContractFailureCode>;
};
export interface WorkflowStrictAttemptRequest {
    launchId: string;
    attemptId: string;
    agentId: string;
    candidateIndex: number;
    prompt: string;
    agentType: string;
    model: string;
    effort: StrictEffort;
    isolation?: "worktree";
    schema?: CompiledSchema;
    /** Record/session observations are reported while the attempt is live. */
    onResolved?(info: {
        recordId?: string;
        modelName?: string;
        modelId?: string;
        thinking?: string;
    }): void;
    /** Monotonic runtime evidence, reported at each execution boundary/event. */
    onEvidence?(evidence: StrictExecutionEvidence): void;
}
export interface WorkflowStrictAttemptResult {
    attempt: StrictAttemptReceipt;
    /** Child output. Present only when the attempt was selected. */
    text?: string;
    tokens?: number;
    outputTokens?: number;
    toolCalls?: number;
}
export interface WorkflowSpawnResult {
    ok: boolean;
    /** The agent's answer. Present when `ok`. */
    text?: string;
    /** Why it failed. Present when not `ok`. */
    error?: string;
    /** The user dismissed it rather than it failing; renders as skipped. */
    skipped?: boolean;
    tokens?: number;
    /**
     * Output tokens only, for the script's `budget.spent()`.
     *
     * Separate from {@link tokens}, which is the lifetime total. Claude Code's
     * budget counts output, and a fan-out's re-sent input would swamp it.
     */
    outputTokens?: number;
    /** Whether the child needed an extra prompt to produce its structured answer. */
    structuredRetried?: boolean;
    toolCalls?: number;
    /**
     * Where the child actually ran.
     *
     * Only meaningful for `isolation: "worktree"`, and the whole reason it exists:
     * a gate has to run against the tree the child edited, not the main one, or it
     * verifies the wrong working copy. Left unset, a gate runs wherever the host
     * runs commands by default.
     *
     * Usually unset for a worktree child even so: the copy is removed during the
     * child's own settle, so it no longer exists by the time this is read. That
     * is what {@link gate} is for.
     */
    cwd?: string;
    /**
     * The outcome of this agent's `gate`, when the host already ran it.
     *
     * Set only by a host that ran the command itself — inside the child's
     * worktree, while that directory still existed. Its presence is what tells
     * {@link applyGate} the command has already been executed; the pass/fail
     * decision and the error shaping still happen there, in one place.
     */
    gate?: WorkflowGateResult;
}
/** Outcome of a `gate` command. `output` is what the user is shown when it fails. */
export interface WorkflowGateResult {
    ok: boolean;
    /** Combined stdout/stderr, or whatever the host wants surfaced as the failure. */
    output: string;
}
/** The one seam between a workflow and the rest of the extension. */
/** How a script names another workflow: a saved name, or a path to a file. */
export interface WorkflowScriptRef {
    name?: string;
    scriptPath?: string;
}
export type WorkflowScriptSource = {
    ok: true;
    script: string;
    path?: string;
} | {
    ok: false;
    message: string;
};
export interface WorkflowHost {
    spawnAgent(request: WorkflowSpawnRequest): Promise<WorkflowSpawnResult>;
    /** Validate strict-only capabilities and exact role dispatch before a launch id exists. */
    validateStrictAgent?(request: WorkflowStrictAgentRequest): WorkflowStrictValidationResult;
    /** Execute one fresh strict candidate attempt. The runtime owns route advancement. */
    spawnStrictAttempt?(request: WorkflowStrictAttemptRequest): Promise<WorkflowStrictAttemptResult>;
    /** Called for every in-flight agent when the run aborts. */
    abortAgent(agentId: string): void;
    /**
     * Continue a child that already ran in this run, keeping its context.
     *
     * `agentId` is one previously handed out in a {@link WorkflowSpawnRequest};
     * the child keeps the agent type, model and tool contract it started with, so
     * only the follow-up prompt crosses.
     *
     * Optional: a host without it rejects `resume` rather than quietly starting a
     * fresh child that has none of the context the script is counting on.
     */
    resumeAgent?(agentId: string, prompt: string,
    /**
     * Same reporter {@link WorkflowSpawnRequest.onResolved} carries, for the
     * same reason: a resumed row is rebuilt from scratch, so without it the
     * continuation of a child would show the model the script *asked* for while
     * the row above it shows the one that ran.
     */
    onResolved?: WorkflowSpawnRequest["onResolved"]): Promise<WorkflowSpawnResult>;
    /**
     * Run a `gate` command and report whether it passed.
     *
     * `cwd` is the child's worktree when it had one. Optional for the same reason
     * as {@link resumeAgent}, and more sharply: a gate that silently does not run
     * would mark unverified work as verified, so the runtime fails the call
     * instead of skipping it.
     */
    runGate?(command: string, options: {
        agentId: string;
        cwd?: string;
    }): Promise<WorkflowGateResult>;
    /**
     * Resolve a nested `workflow()` reference to source.
     *
     * The runtime knows nothing about the filesystem or about pi, so it asks. It
     * still decides whether what comes back *is* a workflow — see
     * {@link validateScript} — because those rules belong with the runtime that
     * enforces them everywhere else.
     *
     * Optional for the same reason as {@link resumeAgent}: a host without it
     * rejects `workflow()` outright rather than silently running nothing.
     */
    loadWorkflow?(ref: WorkflowScriptRef): Promise<WorkflowScriptSource> | WorkflowScriptSource;
}
/**
 * What a run can be told to do while it is going, from the workflows dialog.
 *
 * Every method is best-effort and idempotent: the dialog renders off a progress
 * log that lags the runtime slightly, so it will sometimes ask for something
 * that has just stopped being possible. `false` means "there was nothing to do
 * that to" — a caller can say so, but it is never an error.
 */
export interface WorkflowControl {
    /**
     * Stop *starting* agents. Ones already running are left to finish, because
     * killing model work mid-turn throws away everything it has spent and there
     * is no way to hand it back its context.
     */
    pause(): void;
    resume(): void;
    isPaused(): boolean;
    /**
     * Give up on the agent at `index`: its `agent()` call returns `null`, exactly
     * as a terminal failure does, and the row renders skipped.
     *
     * Immediate for a running agent and for one held at a pause. An agent parked
     * behind the concurrency limit takes its skip when it reaches the front —
     * the alternative is a cancellable semaphore for a case that resolves itself
     * as soon as any sibling finishes.
     */
    skip(index: number): boolean;
    /**
     * Start the agent at `index` over: the child is stopped and the same call is
     * re-run, so the script's `agent()` promise is still the one waiting and it
     * gets the new answer.
     *
     * Only while it is running — that is the whole window. Once the call has
     * settled its value is already the script's, and re-running would produce a
     * result with nowhere to go.
     */
    retry(index: number): boolean;
}
export interface RunWorkflowOptions {
    /** Full script source, starting with `export const meta = { … }`. */
    script: string;
    args?: unknown;
    host: WorkflowHost;
    signal?: AbortSignal;
    /** Fired per batch, not per entry — see the worker's progress batching. */
    onProgress?(entries: readonly WorkflowEntry[]): void;
    concurrency?: number;
    agentCap?: number;
    itemCap?: number;
    /**
     * Hands the caller the run's control surface, once per run.
     *
     * A callback rather than a return value because `runWorkflow` resolves when
     * the run is *over*, which is the one moment there is nothing left to
     * control. Fired before the first agent starts.
     */
    onControl?(control: WorkflowControl): void;
    /**
     * How many nested `workflow()` invocations one run may make in total.
     *
     * Each costs a compile and a scope rather than a thread, so the ceiling is
     * generous — but unbounded is worse than capped, on the same reasoning as
     * {@link agentCap}.
     */
    nestedCap?: number;
    /**
     * Replay and record, for `resumeFromRunId`.
     *
     * The runtime does no file IO — `entries` come in already read and `append`
     * goes back out — so its tests stay free of a filesystem, the same reason
     * spawning is behind {@link WorkflowHost}.
     */
    journal?: {
        /** A previous run's settled calls, in position order. Empty replays nothing. */
        entries?: readonly WorkflowJournalEntry[];
        /** Called as each call of *this* run settles, so it can be resumed in turn. */
        append?(entry: WorkflowJournalEntry): void;
    };
}
export interface WorkflowRunResult {
    status: "completed" | "failed" | "killed";
    meta: WorkflowMeta;
    /** The script's return value, JSON-checked at the boundary. */
    value?: unknown;
    error?: string;
    /** The append-only log, in emission order. */
    progress: WorkflowEntry[];
    /** Agents scheduled, including those that failed. */
    agentCount: number;
    /** How many of those came back from the journal instead of being spawned. */
    replayedCount: number;
}
/**
 * Reject anything that cannot survive the round trip to the worker and into a
 * resume journal. Structured clone would happily carry a `Map` or a cycle that
 * the journal then cannot represent, so the check is stricter than the transport.
 */
export declare function assertBoundarySafe(value: unknown, path: string): void;
/**
 * Run one workflow script to completion.
 *
 * Rejects before starting for a script that cannot run at all (bad `meta`, over
 * the size limit, control characters, non-JSON `args`). Everything after the
 * worker is live resolves instead, carrying the failure in `status` — by then
 * there is a progress log worth handing back.
 */
/**
 * Everything a script must satisfy before it is compiled.
 *
 * Extracted so a nested `workflow()` is held to exactly the same standard as a
 * top-level run: same size limit, same character rules, same `meta` contract.
 * The host resolves a reference to source; deciding whether that source is a
 * workflow stays here, where the rules live.
 */
export declare function validateScript(script: string): {
    meta: WorkflowMeta;
    body: string;
};
export declare function runWorkflow(options: RunWorkflowOptions): Promise<WorkflowRunResult>;
