/**
 * saved.ts — resolve `SubagentWorkflow({ name })` to a script on disk.
 *
 * A saved workflow is a plain `.js` file whose contents are exactly what
 * `script` would have carried. Nothing is parsed here: `extractMeta` still runs
 * over the source at the call site, so a saved file and an inline one fail the
 * same way on a bad `meta` block.
 *
 * Roots mirror `loadCustomAgents` rather than inventing a fourth convention —
 * project `.pi` is the authority, the shared `.agents` workspace is an extra
 * read location, and the user's agent dir is the fallback:
 *
 *   1. <cwd>/.pi/workflows/<name>.js
 *   2. <cwd>/.agents/workflows/<name>.js
 *   3. getAgentDir()/workflows/<name>.js   (default ~/.pi/agent/workflows)
 *
 * Precedence is expressed as first-hit-wins here, not last-write-wins as in the
 * agent loader, because a name resolves to one file — there is no map to
 * overwrite.
 *
 * Symlinks are rejected through `safeReadFile`, and the name is whitelisted
 * before it is ever joined to a path: `name` arrives from a model, and
 * `../../etc/passwd` must not become a readable workflow.
 *
 * ## Not every `.js` in the folder is a workflow
 *
 * These are ordinary directories. `.agents/workflows/` is shared across tools
 * and the user's agent dir is theirs to fill; either may hold a build artifact,
 * a config, or a scratch script. A file is only treated as a workflow if it
 * carries the `export const meta =` declaration every workflow opens with.
 *
 * Nothing is ever executed to decide this — the check is a regex over the
 * source, and even the real parse only evaluates the `meta` object literal in
 * an empty vm. What the filter buys is honesty: a listing that offers `utils.js`
 * as a runnable workflow invites the model to try it, and naming it should say
 * "that is not a workflow" rather than produce a parser error about a block the
 * author never intended to write.
 */
/** The roots a `name` is looked up in, highest priority first. */
export declare function savedWorkflowRoots(cwd: string): string[];
export type SavedWorkflow = {
    ok: true;
    script: string;
    path: string;
} | {
    ok: false;
    message: string;
};
/**
 * Read the saved workflow called `name`.
 *
 * Failure carries the roots that were searched and, when there are any, the
 * names that do exist — a model that guessed the name can correct itself from
 * the error instead of spending a turn asking.
 */
export declare function readSavedWorkflow(name: string, cwd: string): SavedWorkflow;
/**
 * Resolve a reference — a saved name, or a path — to source.
 *
 * The one place that decides what a reference means, so the tool's `name` /
 * `scriptPath` parameters and a script's nested `workflow()` cannot drift apart
 * on precedence or on what counts as a workflow.
 */
export declare function resolveWorkflowSource(ref: {
    name?: string;
    scriptPath?: string;
}, cwd: string): SavedWorkflow;
/** Every saved workflow name, de-duplicated across roots and sorted. */
export declare function listSavedWorkflows(cwd: string): string[];
/**
 * Resolve which source a `SubagentWorkflow` call runs.
 *
 * `scriptPath` wins over `script`, which wins over `name` — Claude Code's
 * order — and at least one is required: a call with none is a mistake worth
 * naming rather than an empty run. Lives beside {@link resolveWorkflowSource}
 * because that is the function it defers to once precedence is settled, so the
 * two cannot disagree about what a reference means.
 */
export declare function resolveWorkflowScript(params: {
    script?: string;
    scriptPath?: string;
    name?: string;
}, cwd: string): {
    ok: true;
    script: string;
    scriptPath?: string;
} | {
    ok: false;
    message: string;
};
