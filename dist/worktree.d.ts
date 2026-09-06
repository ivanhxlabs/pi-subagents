/**
 * worktree.ts — Git worktree isolation for agents.
 *
 * Creates a temporary git worktree so the agent works on an isolated copy of the repo.
 * On completion, if no changes were made, the worktree is cleaned up.
 * If changes exist, a branch is created and returned in the result.
 *
 * Every git call goes through `pi.exec` (async) rather than `execFileSync`: a
 * worktree copy can take seconds, and a session that spawns several isolated
 * agents at once would otherwise serialize them all on the TUI's event loop.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
export interface WorktreeInfo {
    /** Absolute path to the worktree directory (the copied repo's root). */
    path: string;
    /** Branch name created for this worktree (if changes exist). */
    branch: string;
    /** Commit SHA that the worktree was created from. */
    baseSha: string;
    /**
     * Where the agent should work inside the worktree: the equivalent of the
     * cwd the worktree was created from. Equals `path` when that cwd was the
     * repo root; points at the copied subdirectory when it was deeper (e.g. a
     * monorepo package), so the requested scoping survives isolation.
     */
    workPath: string;
}
export declare function setWorktreeIsolationEnabled(enabled: boolean): void;
export declare function isWorktreeIsolationEnabled(): boolean;
export interface WorktreeCleanupResult {
    /** Whether changes were found or may remain after a cleanup failure. */
    hasChanges: boolean;
    /** Branch name if changes were committed. */
    branch?: string;
    /** Worktree path. On error, the agent's changes remain here for recovery. */
    path?: string;
    /** Cleanup failure. When present, the worktree is deliberately preserved. */
    error?: string;
}
/**
 * Create a temporary git worktree for an agent.
 * Returns the worktree path, or undefined if not in a git repo.
 */
export declare function createWorktree(pi: ExtensionAPI, cwd: string, agentId: string): Promise<WorktreeInfo | undefined>;
/**
 * Clean up a worktree after agent completion.
 * - If no changes: remove worktree entirely.
 * - If changes exist: create a branch, commit changes, return branch info.
 */
export declare function cleanupWorktree(pi: ExtensionAPI, cwd: string, worktree: WorktreeInfo, agentDescription: string): Promise<WorktreeCleanupResult>;
/**
 * Prune any orphaned worktrees (crash recovery).
 */
export declare function pruneWorktrees(pi: ExtensionAPI, cwd: string): Promise<void>;
