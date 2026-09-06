/**
 * task.ts — the background record one workflow run lives in.
 *
 * A `SubagentWorkflow` tool call returns a task id immediately and the run continues
 * without it, so the run's state cannot live in the tool call's closure: the
 * inline card, the completion notification and (later) the `/agents → Workflows` dialog
 * all read it after `execute` has returned. This is that record, shaped after
 * Claude Code's `local_workflow` task so the fields line up with what the
 * renderers already expect.
 *
 * The progress log is append-only and collapses by index (see `progress.ts`),
 * so every derived counter here is recomputed from the log rather than
 * incremented as entries arrive — a re-emitted agent entry replaces its
 * predecessor, and adding its tokens on top would double-count them.
 */
import type { WorkflowJournalEntry } from "./journal.js";
import type { WorkflowMeta } from "./meta.js";
import { type WorkflowEntry, type WorkflowRunStatus } from "./progress.js";
import type { WorkflowControl, WorkflowRunResult } from "./runtime.js";
/** `wf_` + hex, matching Claude Code's `^wf_[a-z0-9-]{6,}$` run ids. */
export declare function workflowRunId(): string;
export interface WorkflowTask {
    /** Discriminator, alongside Claude Code's `local_agent` / `local_bash`. */
    type: "local_workflow";
    id: string;
    status: WorkflowRunStatus;
    script: string;
    /** Where the script can be edited and re-run from. */
    scriptPath?: string;
    args?: unknown;
    meta?: WorkflowMeta;
    workflowName?: string;
    /** The `tool_use_id` of the call that started this, when one did. */
    toolCallId?: string;
    /**
     * Pause, skip and retry, once the run is up.
     *
     * Absent before the runtime hands it over and after the run settles — the
     * dialog treats "no control" as "those keys do nothing", which is the same
     * thing it does for a run that has finished.
     */
    control?: WorkflowControl;
    /** When the current pause started, so `totalPausedMs` can be closed out. */
    pausedAt?: number;
    /** Where this run records its own settled calls, for a later resume. */
    journalPath?: string;
    /** A previous run's journal, when this call asked to resume one. */
    replay?: readonly WorkflowJournalEntry[];
    /** The run id this one resumed, for the result line that says so. */
    resumedFrom?: string;
    /** How many agents came back from {@link replay} instead of being spawned. */
    replayedCount: number;
    /** The append-only event log, in emission order. */
    workflowProgress: WorkflowEntry[];
    /** Bumped once per applied batch, so a renderer can tell nothing changed. */
    progressVersion: number;
    agentCount: number;
    /**
     * Agents that have settled successfully, recomputed with the other counters.
     *
     * Cached rather than derived on read because the fleet list asks five times a
     * second: deriving it there would walk the whole append-only log on every
     * tick, which for a thousand-agent run is real work in the render loop.
     */
    doneCount: number;
    totalTokens: number;
    totalToolCalls: number;
    logs: string[];
    abortController: AbortController;
    startTime: number;
    endTime?: number;
    /** Excluded from the elapsed clock the header shows. */
    totalPausedMs: number;
    /** The script's return value, once the run produced one. */
    value?: unknown;
    error?: string;
}
export declare function createWorkflowTask(init: {
    id: string;
    script: string;
    scriptPath?: string;
    args?: unknown;
    meta?: WorkflowMeta;
    toolCallId?: string;
    startTime?: number;
    journalPath?: string;
    replay?: readonly WorkflowJournalEntry[];
    resumedFrom?: string;
}): WorkflowTask;
/**
 * Apply one batch of progress entries.
 *
 * Batched rather than per-entry because that is how the worker emits them, and
 * because every counter below is an O(log) recompute — doing it once per fan-out
 * frame instead of once per agent is the difference that keeps a 200-agent run
 * cheap to render.
 */
export declare function updateWorkflowProgressBatch(task: WorkflowTask, entries: readonly WorkflowEntry[]): void;
/**
 * Hold the run, and stop its clock.
 *
 * The elapsed figure every surface shows subtracts `totalPausedMs`, so a run
 * left paused overnight does not come back reading as a twelve-hour run.
 */
export declare function pauseWorkflowTask(task: WorkflowTask, now?: number): boolean;
/** Let it go again, banking however long it was held. */
export declare function resumeWorkflowTask(task: WorkflowTask, now?: number): boolean;
/** Settle a task from the run's own result. */
export declare function completeWorkflowTask(task: WorkflowTask, result: WorkflowRunResult): void;
/**
 * Settle a task that never produced a result — a script rejected before the
 * worker started (bad `meta`, oversized source, non-JSON `args`).
 */
export declare function failWorkflowTask(task: WorkflowTask, error: string): void;
/** The run's outcome as text, for the notification and the LLM-facing result. */
export declare function workflowResultText(task: WorkflowTask): string;
/**
 * Resolve a `resumeFromRunId` against the runs this session has seen.
 *
 * Same-session only, and deliberately so: the journal lives beside the
 * session's task files, and a run id from another session would silently find
 * nothing to replay — reporting that as "resumed" would be a lie the caller
 * could not see through. An unknown id is an error rather than a cold start,
 * because a caller that asked to resume is expecting not to pay.
 */
export declare function resolveResumeTarget(runId: string | undefined, tasks: ReadonlyMap<string, WorkflowTask>): undefined | {
    ok: true;
    runId: string;
    journalPath: string;
    scriptPath: string;
} | {
    ok: false;
    message: string;
};
/** `<task-notification>`, in the same shape a finished background agent sends. */
export declare function formatWorkflowNotification(task: WorkflowTask, now?: number): string;
