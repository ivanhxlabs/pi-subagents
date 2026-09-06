/**
 * collisions.ts — deciding what to do when another extension already offers a
 * workflow tool.
 *
 * Workflows are on by default, so this extension can be the *second*
 * orchestrator in a session rather than the only one. Two workflow tools in one
 * spec is worse than either alone: the model has to guess which to call, and
 * pays for both descriptions to find out. The other extension was installed
 * deliberately; a default of ours should not compete with it.
 *
 * ## What counts as a conflict
 *
 * An exact name match against {@link FOREIGN_WORKFLOW_TOOL_NAMES}, from a tool
 * that is not ours. Exact and not a substring on purpose: `Workflow` is a
 * common word in tool names that have nothing to do with orchestration
 * (`github_workflow_run`, `list_workflows`), and silently disabling the feature
 * against one of those would be a bug nobody could see.
 *
 * Two shapes, both decided here:
 *
 * 1. **A foreign tool took our name.** Registration is first-wins across
 *    extensions (`getAllRegisteredTools` skips a name it already has), and the
 *    winner also overwrites a built-in of the same name. Nothing throws, and
 *    there is no tool-conflict diagnostic the way there is for shortcuts. Ours
 *    never reached the registry, so there is nothing to withdraw — but the rest
 *    of the feature (the menu, the CLI flag) is still live and would drive a
 *    tool the model cannot call. It comes down with it.
 * 2. **A foreign tool sits beside ours** under a different name, typically
 *    Claude Code's bare `Workflow`. Both are registered and both are offered.
 *    That one the caller can actually withdraw — `withdraw` says so.
 *
 * Only one direction of case 1 is detectable. If ours registered first, the
 * other extension's tool is the one dropped, and pi exposes no way to see a
 * tool that lost — the registry keeps winners only.
 *
 * Split from the acting half deliberately: everything here is a pure function
 * of the tool list, so the policy can be tested without a host that can be made
 * to register a competing extension. The caller owns `getAllTools`, the notify
 * and the `setActiveTools` — see `resolveWorkflowCollisions` in index.ts.
 */
/**
 * Tool names that mean "another extension already orchestrates subagents".
 *
 * Our own name, because pi resolves a duplicate registration silently, and
 * Claude Code's bare `Workflow`, because a port of that tool is what a second
 * workflow extension most likely calls itself. Lowercase `workflow` is the same
 * tool by pi convention: it is what `@quintinshaw/pi-dynamic-workflows`
 * registers, and the match here is exact, so the case has to be listed by hand.
 */
export declare const FOREIGN_WORKFLOW_TOOL_NAMES: ReadonlySet<string>;
/** The fields of a registered tool this decision reads. */
export interface RegisteredToolInfo {
    name: string;
    description?: string;
    sourceInfo?: {
        source?: string;
    };
}
export type WorkflowCollision =
/** Nobody else is offering one. Carry on. */
{
    kind: "none";
}
/**
 * A foreign tool took our name, but the user pinned `workflowsEnabled: true`.
 * Nothing changes — pi has already dropped our registration — but it is worth
 * reporting, because pi resolved it silently.
 */
 | {
    kind: "report";
    message: string;
}
/**
 * Stand down for this session. `withdraw` is false in case 1, where ours
 * never reached the registry and there is nothing to take out of the active
 * set.
 */
 | {
    kind: "standDown";
    message: string;
    withdraw: boolean;
};
/**
 * Decide, from the registered tools alone.
 *
 * `ownDescription` identifies our own registration: this extension does not
 * know its install path, and the description is the one field that is certainly
 * ours. `pinned` is an explicit `workflowsEnabled` — a default yields to
 * evidence, a choice does not.
 */
export declare function decideWorkflowCollision(input: {
    tools: readonly RegisteredToolInfo[];
    ownDescription: string;
    pinned: boolean;
}): WorkflowCollision;
