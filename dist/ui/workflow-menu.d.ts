/**
 * workflow-menu.ts — `/agents → Workflows`, and the run inspector behind it.
 *
 * The same shape `schedule-menu.ts` has for `/agents → Scheduled jobs`: the
 * submenu and the overlay it opens live here, and everything they need arrives
 * as {@link WorkflowMenuDeps} rather than through a closure. The inspector is
 * reached from two places — this menu and a `workflow` row in the fleet list —
 * and both go through `showWorkflowDialog`, so the two entry points cannot
 * drift apart on what the keys do.
 *
 * Lives in the agents menu rather than as a top-level `/workflows` command: it
 * is one more view of the same fleet, and a second command name would only add
 * a collision surface (pi renames duplicate commands to `/workflows:1` and
 * `/workflows:2`, which breaks the bare name for both).
 */
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { AgentRecord } from "../types.js";
import { type WorkflowTask } from "../workflow/task.js";
/** Everything the menu and the inspector need from the extension around them. */
export interface WorkflowMenuDeps {
    /**
     * Live runs by id, read on every use rather than snapshotted: a run that
     * settled and was swept between render and keypress must be a no-op, not a
     * crash.
     */
    tasks: ReadonlyMap<string, WorkflowTask>;
    /** The record behind an agent id, or undefined once it has been swept. */
    getRecord(id: string): AgentRecord | undefined;
    /** The conversation overlay `c` opens on an agent row. */
    viewAgentConversation(ctx: ExtensionCommandContext, record: AgentRecord): Promise<void>;
    /**
     * The session context, for the fleet-list entry point — that one is a
     * keypress in a list that holds no `ctx` of its own. Undefined between
     * sessions, which is a no-op rather than an error.
     */
    getCtx(): ExtensionCommandContext | undefined;
}
/**
 * Open the inspector for a workflow run.
 *
 * All six controls are wired: `onKill` aborts the run's controller, while
 * pause/resume and per-agent skip/retry go through `task.control`, the handle
 * `runWorkflow` hands back. `onOpenAgent` is the odd one out — it opens the
 * child's conversation rather than changing the run. The dialog derives its key
 * hints from the actions it is handed, so the footer advertises exactly what
 * works — see `WorkflowDialogActions`.
 */
export declare function showWorkflowDialog(ctx: ExtensionCommandContext, task: WorkflowTask, deps: WorkflowMenuDeps): Promise<void>;
/**
 * Open a run from the fleet list.
 *
 * The list hands back an id rather than a task, so a run that settled and was
 * swept between render and keypress is a no-op instead of a crash. `esc` in the
 * dialog closes it and control returns to the list — which is why the promise
 * is handed back: the list puts the cursor back on the run rather than dropping
 * the reader at `main`.
 */
export declare function openWorkflowFromFleet(id: string, deps: WorkflowMenuDeps): Promise<void> | void;
/** `/agents → Workflows` — list this session's runs, open one. */
export declare function showWorkflowsMenu(ctx: ExtensionCommandContext, deps: WorkflowMenuDeps): Promise<void>;
