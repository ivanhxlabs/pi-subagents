/**
 * host.ts — binds a workflow run to the real `AgentManager`.
 *
 * `runtime.ts` deliberately knows nothing about this extension: its only seam is
 * the injected {@link WorkflowHost}, which is what keeps the runtime's tests
 * free of sessions, models and git. This file is the other half of that seam —
 * everything the script can reach through `agent()`, `resume` and `gate` ends up
 * here, and nowhere else.
 *
 * Four mappings carry most of the weight:
 *
 *   - **ids.** The runtime hands out its own `wf-agent-N` handles before
 *     anything spawns, because it needs a stable progress-entry identity. The
 *     manager issues a different id when the child actually starts. `records`
 *     is the translation, and it is kept for the whole run rather than cleared
 *     on completion: `resume` reaches back to a child that has already
 *     finished.
 *   - **agent type and model.** Resolved through `resolveSpawnType` and
 *     `getAgentConfig` — the same dispatch the `Agent` tool uses — so a
 *     workflow and a tool call disagree about nothing.
 *   - **failure.** A strict worktree-isolation failure throws out of
 *     `spawnAndWait`; the script must see that as an agent that failed
 *     (`{ok: false}` → `null`), not as an unhandled rejection that takes the
 *     run down.
 *   - **when a `gate` runs.** For an isolated child it cannot wait until the
 *     spawn resolves: the manager commits the worktree to a branch and deletes
 *     the copy inside the child's own settle, so by then the only tree left to
 *     run `npm test` in is the main one — which would report on code the child
 *     never wrote. So the gate runs from `onBeforeWorktreeCleanup`, inside that
 *     settle, and the verdict travels back on the spawn result. `runGate` still
 *     exists for a child that had no worktree; the runtime uses whichever of
 *     the two happened, never both.
 */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { AgentManager } from "../agent-manager.js";
import type { AgentConfig } from "../types.js";
import type { WorkflowHost } from "./runtime.js";
/**
 * Wall-clock bound on a `gate` command. Generous — a gate is routinely a test
 * suite — but not unbounded: `pi.exec` reports a timeout as `killed`, and a
 * gate that hangs forever would wedge the agent slot it is holding.
 */
export declare const DEFAULT_GATE_TIMEOUT_MS: number;
export interface WorkflowHostOptions {
    pi: ExtensionAPI;
    ctx: ExtensionContext;
    manager: AgentManager;
    /** The run's abort signal, so killing the workflow kills its children. */
    signal?: AbortSignal;
    /** Groups child transcripts under the parent session. */
    rootSessionId?: string;
    /**
     * The run id every child is stamped with.
     *
     * What makes them the workflow's rather than the session's: stamped children
     * are filtered out of the fleet list, the widget, the `/agents` menus and
     * `@handle` resolution, and they take no `maxConcurrent` slot. The run
     * reports for them, and it has its own concurrency cap.
     */
    workflowId?: string;
    gateTimeoutMs?: number;
    /** Session-owned registry override, primarily for embedded hosts and tests. */
    strictAgentRegistry?: Map<string, AgentConfig>;
}
export declare function createWorkflowHost(deps: WorkflowHostOptions): WorkflowHost;
