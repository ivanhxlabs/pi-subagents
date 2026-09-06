/**
 * workflow-card.ts — the inline transcript card for a running workflow.
 *
 * ```
 * ▸ Workflow  review-changes                       3/7 agents · 1m12s
 *   Review changed files across dimensions, verify each finding
 *   ╭─ Review
 *   │ ├─ ✔ review:bugs      · Explore · haiku · 18.4k · 12 tool calls · 42s
 *   │ ├─ ⟳ review:perf      · Explore · 8 tool calls · 21s
 *   │ └─ ⟳ review:security
 *   ╰─ Verify
 *     └─ ⟳ verify:auth.ts   · Plan · 3 tool calls · 9s
 *   ⎿  scanned 41 changed files
 * ```
 *
 * Two things about this file are easy to get wrong.
 *
 * **The glyphs are not the dialog's glyphs.** The inline row keys off the *raw*
 * entry `state` (start | progress | done | error), not the derived display
 * state, so a skipped or blocked agent renders as a plain ✘ here while the
 * workflows dialog distinguishes them. `displayState` is deliberately not
 * consulted below.
 *
 * **The layout is pure.** `layoutWorkflowCard` returns coloured segments and
 * never touches a theme or a terminal, so the same layout drives the `Workflow`
 * tool's `renderResult` and a standalone session entry (a workflow launched from
 * a CLI flag has no tool call to attach to). Theme application is the thin
 * `styleWorkflowCardLines` wrapper on top.
 *
 * All state derivation lives in `src/workflow/progress.ts`; this file only
 * arranges what that module returns.
 */
import { Text } from "@earendil-works/pi-tui";
import type { WorkflowEntryData } from "../workflow/entry.js";
import type { WorkflowMeta } from "../workflow/meta.js";
import { type WorkflowAgentEntry, type WorkflowEntry, type WorkflowRunStatus } from "../workflow/progress.js";
import type { Theme } from "./agent-widget.js";
/**
 * Header re-render cadence. Claude Code ticks the workflow clock once a second,
 * not at the 80ms spinner cadence — the running glyph is static, so there is
 * nothing to animate faster than the elapsed time changes.
 */
export declare const WORKFLOW_TICK_MS = 1000;
export interface WorkflowGlyphs {
    /** Tool-title pointer, matching the Agent tool's `▸`. */
    pointer: string;
    tick: string;
    cross: string;
    /** Running/queued. A static glyph, hence no spinner inline. */
    running: string;
    /** First and subsequent phase groups. */
    groupTop: string;
    /** A group that is neither the first nor the last. */
    groupMid: string;
    /** The last phase group. */
    groupBottom: string;
    /** Continuation rail under a non-final group. */
    vertical: string;
    branch: string;
    lastBranch: string;
    /** Log-line prefix, matching the Agent tool's result lines. */
    log: string;
    warning: string;
}
export declare const UNICODE_GLYPHS: WorkflowGlyphs;
/**
 * The `figures` ASCII tier, for terminals that cannot draw the box set. Every
 * glyph keeps its unicode counterpart's column width so the tree stays aligned
 * either way.
 */
export declare const ASCII_GLYPHS: WorkflowGlyphs;
/**
 * pi theme keys. Claude Code's palette maps as success→success, error→error,
 * subtle→dim, permission→warning for a blocked row and accent for selection;
 * an undefined colour means "leave it at the terminal default", which is what
 * the recovered inline mapping asks for on a running row.
 *
 * `accent` is unused by the card and exists for the workflows dialog, which
 * shares these segment types.
 */
export type WorkflowCardColor = "success" | "error" | "warning" | "dim" | "muted" | "toolTitle" | "accent";
export interface WorkflowCardSegment {
    text: string;
    color?: WorkflowCardColor;
    bold?: boolean;
}
export type WorkflowCardLine = WorkflowCardSegment[];
/** The subset of the task record the card reads. */
export interface WorkflowCardTask {
    status: WorkflowRunStatus;
    workflowName?: string;
    summary?: string;
    description?: string;
    startTime: number;
    endTime?: number;
    totalPausedMs?: number;
}
export interface WorkflowCardInput {
    progress: readonly WorkflowEntry[];
    task: WorkflowCardTask;
    meta?: WorkflowMeta;
    /** Agents the runtime has scheduled, which can exceed those that have reported. */
    agentCount?: number;
    /** Total tokens for the size warning; summed from the entries when omitted. */
    totalTokens?: number;
    agentCap?: number;
    tokenCap?: number;
    now?: number;
    width?: number;
    /** Swap in the ASCII glyph tier for terminals without unicode. */
    ascii?: boolean;
    /**
     * Lead with `▸ SubagentWorkflow`.
     *
     * True where the card stands alone — the session entry a flag-launched run
     * writes, which has no tool call above it to say what it is. False as a tool
     * result, where the call line directly above already does.
     */
    showToolTitle?: boolean;
}
/** `18.4k` / `1.2M` — bare magnitude, since the row already reads as a stat. */
export declare function formatCompactTokens(count: number): string;
/**
 * One label for the model pair. A fallback that never differed from the primary
 * would just be noise, so it only shows when the run actually has two models in
 * play.
 */
export declare function formatModel(entry: WorkflowAgentEntry, opts?: {
    canonical?: boolean;
}): string | undefined;
/**
 * The thinking level, and what was asked for when it was not honoured.
 *
 * Separate from {@link formatModel} because a row can have one without the
 * other: an `agent()` that named no model still runs at some level, and a level
 * pi clamped is worth saying so about even when the model is unremarkable.
 */
export declare function formatThinking(entry: WorkflowAgentEntry): string | undefined;
/**
 * What a row replayed from a resume journal says instead of a duration.
 *
 * Shared with the dialog so both views name the same thing the same way — the
 * card shows it inline while the run happens, the dialog on the agent's row.
 */
export declare const REPLAYED_ANNOTATION = "from resume journal";
/**
 * The `·`-separated tail of an agent row, in the recovered order: agentType,
 * model, tokens, toolCalls, durationMs. Absent values drop out entirely rather
 * than rendering a placeholder.
 */
export declare function agentStatSegments(entry: WorkflowAgentEntry): string[];
/** Trim a line to `width`, cutting inside whichever segment crosses the edge. */
export declare function clampLine(line: WorkflowCardLine, width: number): WorkflowCardLine;
/**
 * Build the card.
 *
 * Everything derived — the phase tree, the header counts, the logs, the size
 * warning — comes from `progress.ts`; what happens here is purely arrangement.
 */
export declare function layoutWorkflowCard(input: WorkflowCardInput): WorkflowCardLine[];
/** The card as plain text — what the layout tests assert against. */
export declare function plainWorkflowCardLines(lines: readonly WorkflowCardLine[]): string[];
/** Apply the theme. Nothing here changes the layout, only its colours. */
export declare function styleWorkflowCardLines(lines: readonly WorkflowCardLine[], theme: Theme): string[];
/** The card as a component, for a tool result or a session entry renderer. */
export declare function renderWorkflowCard(input: WorkflowCardInput, theme: Theme): Text;
/**
 * The card for a session entry, from the JSON a flag-launched run persisted.
 *
 * The same layout the tool result uses, not a second one — the only difference
 * is `showToolTitle`, because a session entry stands alone and nothing above it
 * says what it is. Returns undefined for an entry with no data, which is what
 * pi's renderer contract wants for "nothing to draw".
 */
export declare function renderWorkflowEntryCard(data: WorkflowEntryData | undefined, theme: Theme): Text | undefined;
