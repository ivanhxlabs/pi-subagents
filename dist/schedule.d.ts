/**
 * schedule.ts — `SubagentScheduler`: timer-driven dispatcher of scheduled subagents.
 *
 * Mirrors the engine shape of pi-cron-schedule/src/scheduler.ts:
 *   - two-Map split (jobs = croner Cron, intervals = setInterval/setTimeout)
 *   - addJob/removeJob/updateJob/scheduleJob/unscheduleJob/executeJob
 *   - static parsers for cron / "+10m" / "5m" / ISO formats
 *
 * Differences vs pi-cron-schedule:
 *   - Persistence is via ScheduleStore (PID-locked, session-scoped, atomic).
 *   - `executeJob` calls `manager.spawn(..., { bypassQueue: true })` instead
 *     of dispatching a user message — schedule fires bypass maxConcurrent so
 *     a 5-minute interval can't be deferred behind 4 long-running agents.
 *   - Result delivery is implicit: spawn → background completion → existing
 *     `subagent-notification` followUp path. No new delivery code.
 */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { AgentManager } from "./agent-manager.js";
import type { ScheduleStore } from "./schedule-store.js";
import type { IsolationMode, ScheduledSubagent, SubagentType, ThinkingLevel } from "./types.js";
/** Event emitted on `pi.events` for cross-extension consumers. */
export type ScheduleChangeEvent = {
    type: "added";
    job: ScheduledSubagent;
} | {
    type: "removed";
    jobId: string;
} | {
    type: "updated";
    job: ScheduledSubagent;
} | {
    type: "fired";
    jobId: string;
    agentId: string;
    name: string;
} | {
    type: "error";
    jobId: string;
    error: string;
};
/** Params accepted at job creation — ID, timestamps, and state are derived. */
export interface NewJobInput {
    name: string;
    description: string;
    schedule: string;
    subagent_type: SubagentType;
    prompt: string;
    model?: string;
    thinking?: ThinkingLevel;
    max_turns?: number;
    isolated?: boolean;
    isolation?: IsolationMode;
}
export declare class SubagentScheduler {
    private jobs;
    private intervals;
    private store;
    private pi;
    private ctx;
    private manager;
    /** Start the scheduler: bind to a session's store and arm enabled jobs. */
    start(pi: ExtensionAPI, ctx: ExtensionContext, manager: AgentManager, store: ScheduleStore): void;
    /** Stop all timers; drop refs. Safe to call repeatedly. */
    stop(): void;
    /** True if start() has bound a store and the scheduler is active. */
    isActive(): boolean;
    list(): ScheduledSubagent[];
    /**
     * Build a `ScheduledSubagent` from user input. Validates the schedule
     * format and tags `scheduleType`. Throws on invalid input.
     */
    buildJob(input: NewJobInput): ScheduledSubagent;
    /** Add a job, persist, and arm if enabled. Returns the stored job. */
    addJob(input: NewJobInput): ScheduledSubagent;
    removeJob(id: string): boolean;
    /** Toggle / mutate a job. Re-arms based on the new `enabled` state. */
    updateJob(id: string, patch: Partial<ScheduledSubagent>): ScheduledSubagent | undefined;
    /** Next-run time as ISO, or undefined if not currently armed. */
    getNextRun(jobId: string): string | undefined;
    private scheduleJob;
    private unscheduleJob;
    /**
     * Fire a job: persist running state, spawn (bypassing the concurrency
     * queue), persist completion. Fire-and-forget: the timer tick returns
     * immediately so other jobs keep firing.
     */
    private executeJob;
    private emit;
    private requireStore;
    /**
     * Sniff a schedule string and tag its type. Throws on invalid input.
     * Order matters: relative ("+10m") and interval ("5m") both match digit+unit;
     * relative requires the leading "+" to disambiguate.
     */
    static detectSchedule(s: string): {
        type: "cron" | "once" | "interval";
        intervalMs?: number;
        normalized: string;
    };
    /** 6-field cron — 'second minute hour dom month dow'. */
    static validateCronExpression(expr: string): {
        valid: boolean;
        error?: string;
    };
    /** "+10s"/"+5m"/"+1h"/"+2d" → ISO timestamp. */
    static parseRelativeTime(s: string): string | null;
    /** "10s"/"5m"/"1h"/"2d" → milliseconds. */
    static parseInterval(s: string): number | null;
}
