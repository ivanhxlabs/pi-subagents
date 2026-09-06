/**
 * structured-output.ts — the synthetic tool behind `agent(prompt, { schema })`.
 *
 * A workflow script that passes a `schema` wants an *object* back, not prose it
 * has to parse. Claude Code does this by giving the child a `StructuredOutput`
 * tool whose input schema is the caller's schema, so the provider fills the
 * fields, and returning the validated payload as the agent's result.
 *
 * We do the same, with one gap named up front: Claude Code *forces* the call,
 * and we cannot. `toolChoice` exists in pi-ai's provider layer but is not
 * plumbed through `AgentSession`, so an extension has no way to require a
 * particular tool. What we have instead is three softer pressures —
 *
 *   1. `constrainedSampling`, so providers that support it hold the payload to
 *      the schema at sampling time;
 *   2. the tool's description, snippet and guideline, which say the answer must
 *      come through this call;
 *   3. validation here, answering a bad payload with `isError` so the model
 *      sees what was wrong and calls again inside the same run.
 *
 * — and, when all three fail, one more prompt from `runAgent`. See
 * {@link structuredRetryPrompt}.
 *
 * The name matches Claude Code's exactly, so a ported prompt that mentions
 * `StructuredOutput` is still telling the truth.
 */
import { type ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { CompiledSchema } from "./workflow/json-schema.js";
/**
 * Deliberately NOT added to `SUBAGENT_TOOL_NAMES`: that list becomes
 * `EXCLUDED_TOOL_NAMES`, which is exactly the denial this tool has to avoid.
 * Nor to `BUILTIN_TOOL_NAMES` — it is ours to inject, never a name a user may
 * ask for in an agent's `tools:` frontmatter.
 */
export declare const STRUCTURED_OUTPUT_TOOL_NAME = "StructuredOutput";
/** What the child produced, filled in as the tool is called. */
export interface StructuredCapture {
    /** The last payload that validated, canonicalised. Absent until one does. */
    json?: string;
    /** Why the most recent attempt was rejected, for the retry prompt. */
    lastError?: string;
    /** Whether the tool was called at all — "never tried" reads differently. */
    called: boolean;
}
export declare function createStructuredCapture(): StructuredCapture;
/**
 * Build the tool for one child.
 *
 * `capture` is the box the caller reads afterwards. It is passed in rather than
 * returned so `runAgent` owns its lifetime and can consult it on every exit
 * path, including the ones where the tool was never reached.
 */
export declare function createStructuredOutputTool(compiled: CompiledSchema, capture: StructuredCapture): ToolDefinition;
/**
 * The one extra prompt sent when a run ended with nothing captured.
 *
 * Distinguishes "never called it" from "called it wrongly" — the two need
 * different corrections, and telling a model it got the shape wrong when it
 * never answered at all sends it looking for a mistake it did not make.
 */
export declare function structuredRetryPrompt(capture: StructuredCapture): string;
