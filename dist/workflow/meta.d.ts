/**
 * meta.ts — extract and validate a workflow script's `meta` block.
 *
 * Workflow scripts open with `export const meta = { ... }`, but the script body
 * runs through `node:vm`, which has no module loader — `export` is a syntax
 * error there. The block also has to be readable *before* execution, because the
 * declared phases seed the progress groups the UI renders from the first frame.
 *
 * Claude Code solves this by parsing with acorn and requiring `meta` to be a
 * pure literal (no variables, calls, spreads, or template interpolation). We
 * take the same contract without the dependency: scan to the matching brace,
 * then evaluate *only* that fragment in an empty vm context. A pure literal has
 * nothing to call, so evaluating it cannot reach anything — and anything that
 * isn't a pure literal either throws (unbound identifier) or is rejected below.
 *
 * The scanner is string-, comment-, and regex-aware. That matters: a workflow's
 * `detail` text routinely contains braces, and `phases: [{ title: "a}b" }]` must
 * not terminate the scan early.
 */
/** A phase declared up front, so the UI can show it before any agent runs. */
export interface WorkflowPhaseMeta {
    title: string;
    detail?: string;
    /** Set when a phase pins a model; display-only, the runtime does not read it. */
    model?: string;
}
export interface WorkflowMeta {
    name: string;
    description: string;
    /** Shown in the saved-workflow listing. Not used by the runtime. */
    whenToUse?: string;
    phases?: WorkflowPhaseMeta[];
}
export interface MetaExtraction {
    meta: WorkflowMeta;
    /**
     * The script with the leading `export ` stripped, so `const meta = {...}`
     * compiles inside the vm. Byte offsets after the keyword are untouched, which
     * keeps stack-trace line numbers aligned with what the author wrote.
     */
    body: string;
}
export declare class WorkflowMetaError extends Error {
}
/**
 * Whether `source` even claims to be a workflow script.
 *
 * The cheap half of {@link extractMeta}, exported so a directory of `.js` files
 * can be told apart from a directory of workflows without evaluating anything.
 * A saved-workflow folder is a normal folder — it may hold a build artifact, a
 * config, someone's scratch script — and those should neither be offered as
 * workflows nor produce a parser error when named.
 */
export declare function hasMetaDeclaration(source: string): boolean;
/**
 * Pull `meta` off the front of a workflow script and hand back the runnable body.
 *
 * Throws {@link WorkflowMetaError} with author-facing guidance for every
 * rejection — these messages are shown verbatim to whoever wrote the script.
 */
export declare function extractMeta(source: string): MetaExtraction;
/** The label a `SubagentWorkflow` call renders under, from whichever field it carries. */
export declare function workflowCallName(args: {
    script?: string;
    scriptPath?: string;
    name?: string;
}): string;
