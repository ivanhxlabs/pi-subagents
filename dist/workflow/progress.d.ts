/**
 * progress.ts — the workflow progress model, ported from Claude Code.
 *
 * Progress is an **append-only event log**, not a tree. Agent entries are keyed
 * by `index` and last-write-wins, so a running agent is updated by appending a
 * fresh entry with the same index rather than mutating anything. Every view —
 * the inline card, the workflows dialog, the fleet widget — derives its shape
 * by collapsing that log. Keeping the log authoritative is what lets a batched
 * update carry several agents' changes in one message from the worker.
 *
 * Two vocabularies, deliberately distinct:
 *   - entry `state` is only start | progress | done | error, with `skipped`,
 *     `blocked` and `cached` as separate booleans;
 *   - the display state adds queued, running, interrupted, skipped, blocked and
 *     failed, and is *derived* (see `displayState`).
 * Mixing them up is the easiest way to get the rendering wrong, which is why
 * the derivation lives here as one function rather than inline in each renderer.
 *
 * Everything in this file is pure and framework-free so the whole model is
 * unit-testable without a terminal.
 */
import { type StrictAttemptReceipt } from "../strict-agent.js";
import type { WorkflowMeta, WorkflowPhaseMeta } from "./meta.js";
/** Raw entry lifecycle, as written by the runtime. */
export type WorkflowEntryState = "start" | "progress" | "done" | "error";
/** Derived per-agent state, as rendered. */
export type WorkflowDisplayState = "queued" | "running" | "done" | "failed" | "skipped" | "blocked" | "interrupted";
/** Why an agent is on a later attempt, shown next to its row. */
export type AttemptReason = "throttled" | "user-retry" | "stalled";
export interface WorkflowPhaseEntry {
    type: "workflow_phase";
    index: number;
    title: string;
}
export interface WorkflowLogEntry {
    type: "workflow_log";
    message: string;
}
export interface WorkflowAgentEntry {
    type: "workflow_agent";
    /** Stable identity. Re-emitting this index replaces the previous entry. */
    index: number;
    label: string;
    /**
     * Absent when the agent ran before any `phase()` call. That is the signal —
     * not a default of 0 — that turns the whole run into one "Agents" group.
     */
    phaseIndex?: number;
    phaseTitle?: string;
    state: WorkflowEntryState;
    agentId?: string;
    /**
     * The manager's `AgentRecord` id, once the child has one.
     *
     * Distinct from {@link agentId}, which is the run's own `wf-agent-N` handle
     * and means nothing outside the runtime. This is what the inspector's `c`
     * key opens a conversation viewer on, so it is reported the moment the
     * manager issues it rather than with the effective model — a child that dies
     * before its session resolves still has a conversation worth reading.
     */
    recordId?: string;
    agentType?: string;
    /**
     * Short model label for tight rows, e.g. `haiku 4.5`.
     *
     * Seeded from what the script asked for and then REPLACED by what the child
     * actually ran on, once its session exists to report one — the same
     * effective-not-requested rule every other subagent surface follows (#168).
     * An `agent()` that named no model therefore starts blank and fills in.
     */
    model?: string;
    /** Canonical `provider/model-id`, for the dialog, which has room for it. */
    modelId?: string;
    /** The level actually in effect, once the child's session reports one. */
    thinking?: string;
    /**
     * What the call asked for, kept only when it did not get it — pi clamped the
     * level, or an agent file's frontmatter outranked the option (#182). Rendered
     * as `(asked max)` beside the effective value rather than silently replacing
     * it.
     */
    requestedThinking?: string;
    requestedModel?: string;
    fallbackModel?: string;
    isolation?: "worktree";
    error?: string;
    skipped?: boolean;
    blocked?: boolean;
    cached?: boolean;
    queuedAt?: number;
    startedAt?: number;
    lastProgressAt?: number;
    attempt?: number;
    lastAttemptReason?: AttemptReason;
    promptPreview?: string;
    resultPreview?: string;
    tokens?: number;
    toolCalls?: number;
    durationMs?: number;
    /** Marks a live row as runtime-controlled strict routing. */
    strictRoute?: true;
    /** Groups strict attempts that belong to one public route launch. */
    strictLaunchId?: string;
    /** Runtime-owned strict route evidence for this attempt, when settled. */
    strictAttempt?: StrictAttemptReceipt;
}
export type WorkflowEntry = WorkflowPhaseEntry | WorkflowLogEntry | WorkflowAgentEntry;
/** Overall run status, mirroring the task record. */
export type WorkflowRunStatus = "running" | "completed" | "failed" | "killed" | "paused";
export interface CollapsedProgress {
    agents: WorkflowAgentEntry[];
    logs: string[];
    phaseTitles: Map<number, string>;
}
export interface PhaseGroup {
    title: string;
    status: "not-started" | "running" | "done" | "failed";
    agents: WorkflowAgentEntry[];
    doneCount: number;
    totalCount: number;
    tokens: number;
    durationMs: number;
}
export interface WorkflowStats {
    done: number;
    failedCount: number;
    running: boolean;
    total: number;
    started: number;
    complete: boolean;
}
/**
 * Fold the event log into its latest state.
 *
 * Agent entries collapse by index (last write wins); logs accumulate in order;
 * phase titles are a lookup for grouping.
 */
export declare function collapse(progress: readonly WorkflowEntry[]): CollapsedProgress;
/**
 * Derive what to render for one agent.
 *
 * `workflowActive` is false once the run has stopped: anything still mid-flight
 * at that point was cut off rather than finished, hence "interrupted".
 */
export declare function displayState(entry: WorkflowAgentEntry, workflowActive: boolean): WorkflowDisplayState;
/** True while an entry is still expected to change. */
export declare function isLive(entry: WorkflowAgentEntry): boolean;
/**
 * Build the phase groups a renderer walks.
 *
 * When nothing declared or emitted a phase, every agent collapses into a single
 * group titled "Agents" so the tree still has one level of structure.
 */
export declare function buildPhaseGroups(progress: readonly WorkflowEntry[], declared?: readonly WorkflowPhaseMeta[]): PhaseGroup[];
/**
 * Aggregate counts for the header line.
 *
 * `agentCount` is the number the runtime has *scheduled*, which can exceed the
 * number that has emitted an entry — a fan-out reports its size before its
 * agents start, so the total does not visibly climb as they trickle in.
 */
export declare function stats(progress: readonly WorkflowEntry[], agentCount?: number): WorkflowStats;
/** Elapsed run time, excluding any time spent paused. */
export declare function elapsedMs(task: {
    startTime: number;
    endTime?: number;
    totalPausedMs?: number;
}, now: number): number;
/** `1m12s` / `9s` / `340ms`, matching how the rest of the extension reads. */
export declare function formatDuration(ms: number): string;
export interface WorkflowHeader {
    name: string;
    subtext: string;
    stats: string;
}
/**
 * The one-line summary above the tree: `3/7 agents · 1m12s`, plus a terminal
 * suffix once the run stops. Deliberately carries no phase count.
 */
export declare function header(task: {
    status: WorkflowRunStatus;
    workflowName?: string;
    summary?: string;
    description?: string;
    startTime: number;
    endTime?: number;
    totalPausedMs?: number;
}, meta: WorkflowMeta | undefined, groups: readonly PhaseGroup[], agentCount: number, now: number): WorkflowHeader;
export declare const DEFAULT_AGENT_CAP = 25;
export declare const DEFAULT_TOKEN_CAP = 1500000;
/** Assumed spend per agent before any has reported, for the projection. */
export declare const ASSUMED_TOKENS_PER_AGENT = 70000;
export interface SizeWarning {
    axis: "agents" | "tokens" | "both";
    scheduledAgents: number;
    totalTokens: number;
    projectedTokens: number;
    agentCap: number;
    tokenCap: number;
}
/**
 * Warn when a run is about to get expensive.
 *
 * The projection matters more than the current total: a 200-agent fan-out is
 * worth flagging at agent 3, not after it has already spent the budget.
 */
export declare function sizeWarning(input: {
    scheduledAgents: number;
    startedAgents: number;
    totalTokens: number;
    agentCap?: number;
    tokenCap?: number;
}): SizeWarning | undefined;
/**
 * Render a phase title as an activity: `Scan` → `Scanning`.
 *
 * Only applied in the footer, where the line reads as "what is happening now".
 * Anything that is not a plain short word is left untouched.
 */
export declare function gerund(word: string): string;
/**
 * The footer's "what is this run doing" label.
 *
 * One active phase shows its position; two concurrent phases are joined, since
 * a barrier-free pipeline routinely has work in more than one at a time.
 */
export declare function footerPhaseLabel(input: {
    titles: readonly string[];
    positionStart: number;
    totalPhases: number;
}): string;
