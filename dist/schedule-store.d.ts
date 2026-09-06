/**
 * schedule-store.ts — File-backed store for scheduled subagents.
 *
 * Session-scoped: each pi session owns its own schedules at
 * `<cwd>/.pi/subagent-schedules/<sessionId>.json`. `/new` starts a fresh
 * empty store; `/resume` reloads.
 *
 * Concurrency model lifted from pi-chonky-tasks/src/task-store.ts: every
 * mutation acquires a PID-based exclusion lock, re-reads the latest state
 * from disk, applies the change, atomic-writes via temp+rename, releases.
 */
import type { ScheduledSubagent } from "./types.js";
/** Resolve the storage path for a session-scoped store. */
export declare function resolveStorePath(cwd: string, sessionId: string): string;
export declare class ScheduleStore {
    private filePath;
    private lockPath;
    private jobs;
    constructor(filePath: string);
    /** Create the backing directory lazily — only when we're about to persist. */
    private ensureDir;
    /** Load from disk into the in-memory cache. Silent on parse errors. */
    private load;
    /** Atomic write via temp file + rename (POSIX-atomic). */
    private save;
    /** Acquire lock → reload → mutate → save → release. */
    private withLock;
    /** Read-only — returns a snapshot of the in-memory cache. */
    list(): ScheduledSubagent[];
    /** Read-only check — uses the cache. */
    hasName(name: string, exceptId?: string): boolean;
    get(id: string): ScheduledSubagent | undefined;
    add(job: ScheduledSubagent): void;
    update(id: string, patch: Partial<ScheduledSubagent>): ScheduledSubagent | undefined;
    remove(id: string): boolean;
    /** Delete the backing file (used when no jobs remain, optional cleanup). */
    deleteFileIfEmpty(): void;
}
