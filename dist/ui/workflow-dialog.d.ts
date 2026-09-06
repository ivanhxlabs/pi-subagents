/**
 * workflow-dialog.ts — the `/agents → Workflows` two-pane inspector.
 *
 * ```
 *  review-changes
 *  Review changed files across dimensions              3/7 agents · 1m12s
 *
 *  ╭ Phases ──────────┬ Verify · 1 agent ──────────────────────────────╮
 *  │ ❯ ✔ Review   3/3 │ ❯ ◌ verify:auth.ts · attempt 2 · waiting 8s    │
 *  │   2 Verify   1/2 │                                                │
 *  │   3 Report       │                                                │
 *  ╰──────────────────┴────────────────────────────────────────────────╯
 *  ↑↓ select · ⏎ open · f filter · x stop · esc close · c convo
 * ```
 *
 * Opening an agent swaps the panes: that phase's agents move left and the
 * right becomes the agent's Prompt / Activity / Outcome detail.
 *
 * A phase with no agents yet shows its number and nothing else. The single-pane
 * layout this replaced spelled that out as "Not started yet"; the left pane is
 * too narrow to hold the words, and a numbered row with no count says it.
 *
 * **The glyphs are not the card's glyphs.** `workflow-card.ts` keys off the raw
 * entry `state`; this file keys off the *derived* `displayState(entry, active)`
 * and splits cases the card cannot see — skipped, blocked, queued and
 * interrupted all render as a plain ✘ or ⟳ inline but are distinct here. `◌`
 * (U+25CC) appears only in this file, and a running row animates a spinner where
 * the card draws a static `⟳`.
 *
 * **The phases pane is stranger still**: a phase that has not finished shows
 * *its number*, not a glyph. That is deliberate, recovered behaviour.
 *
 * **The layout is pure.** `layoutWorkflowDialog` returns coloured segments and
 * `handleWorkflowDialogKey` maps a keypress to the next state plus an optional
 * action; neither touches a theme, a terminal, or the workflow runtime. The
 * `WorkflowDialog` component is the thin shell that wires those to `ctx.ui`, and
 * the runtime side arrives as an injected `WorkflowDialogActions`.
 *
 * All state derivation lives in `src/workflow/progress.ts`; this file only
 * arranges what that module returns.
 */
import { type Component, type TUI } from "@earendil-works/pi-tui";
import type { WorkflowMeta } from "../workflow/meta.js";
import { type PhaseGroup, type WorkflowAgentEntry, type WorkflowDisplayState, type WorkflowEntry } from "../workflow/progress.js";
import { type Theme } from "./agent-widget.js";
import { type WorkflowCardLine, type WorkflowCardSegment, type WorkflowCardTask } from "./workflow-card.js";
/**
 * Most rows the frame will ever draw between its top and bottom edges.
 *
 * A cap, not a height: the box sizes itself to what it holds, and this is where
 * it stops growing so a 200-agent fan-out scrolls inside the pane instead of
 * pasting 200 rows into the conversation.
 */
export declare const DEFAULT_PANE_BODY_ROWS = 22;
/**
 * Fewest rows the frame will draw.
 *
 * Below this a pane stops reading as a pane, and the box would resize on
 * nearly every keypress — most phases hold a handful of agents, so a floor here
 * absorbs the ordinary movement and leaves the height alone.
 */
export declare const MIN_PANE_BODY_ROWS = 6;
/** Prompt lines shown before `expand` is offered. */
export declare const PROMPT_COLLAPSED_LINES = 4;
/** Spinner cadence. Unlike the card's 1s header tick, this row really animates. */
export declare const WORKFLOW_DIALOG_SPINNER_MS = 80;
export interface WorkflowDialogGlyphs {
    tick: string;
    cross: string;
    /** `◌` — queued or interrupted. The card has no row that draws this. */
    queued: string;
    /** `figures.pointer` — the selected row in either pane. */
    pointer: string;
    /** Marks whichever pane currently owns j/k. */
    focus: string;
    /** Running rows cycle these. */
    spinner: readonly string[];
    /** The pane frame: corners, edges and the tee where the two panes meet. */
    box: {
        topLeft: string;
        topRight: string;
        bottomLeft: string;
        bottomRight: string;
        horizontal: string;
        vertical: string;
        topTee: string;
        bottomTee: string;
    };
    /** Trailing marker on a title the pane was too narrow to hold. */
    ellipsis: string;
    /** How the footer names the arrow keys and Enter. */
    upDown: string;
    enter: string;
}
export declare const UNICODE_DIALOG_GLYPHS: WorkflowDialogGlyphs;
/** The ASCII tier, one column per glyph so the panes stay aligned either way. */
export declare const ASCII_DIALOG_GLYPHS: WorkflowDialogGlyphs;
/**
 * The recovered dialog mapping — keyed on the *display* state.
 *
 * Claude Code's `permission` colour has no pi equivalent; a blocked agent is
 * waiting on the user, so it maps to `warning` (selection maps to `accent`).
 */
export declare function dialogRowGlyph(state: WorkflowDisplayState, glyphs: WorkflowDialogGlyphs, spinnerFrame?: number): WorkflowCardSegment;
/**
 * Claude Code's own strings. Kept together and named so a reader can see at a
 * glance which surface each belongs to, and so none drifts under an edit.
 */
export declare const WORKFLOW_DIALOG_COPY: {
    readonly waitingForSlot: "Waiting for an agent slot.";
    readonly availableOnceStarted: "Available once the agent starts.";
    readonly notAvailableYet: "Not available yet (agent still running).";
    readonly noTranscript: "Transcript not available.";
    readonly stoppedEarly: "The workflow stopped before this agent finished.";
    readonly skippedByUser: "Skipped by user.";
    readonly noToolCallsYet: "No tool calls yet.";
    readonly noToolCalls: "No tool calls.";
    readonly noAgents: "No agents";
};
/**
 * Which of the two drill-down levels is showing.
 *
 * `phases` is the overview — phases on the left, the selected phase's agents on
 * the right. `agent` is the subview reached by opening one: the same phase's
 * agents move to the left pane and the right pane becomes that agent's detail.
 * The panes never change count, only what they hold, which is what makes the
 * frame stay put as you drill in and back out.
 */
export type WorkflowDialogLevel = "phases" | "agent";
/** `all`, or exactly one display state. */
export type WorkflowDialogFilter = "all" | WorkflowDisplayState;
/** The order `f` cycles through. */
export declare const WORKFLOW_DIALOG_FILTERS: readonly WorkflowDialogFilter[];
export interface WorkflowDialogState {
    /** Raw selection; `clampedPhase` is what actually renders. */
    selectedPhase: number;
    selectedAgent: number;
    level: WorkflowDialogLevel;
    filter: WorkflowDialogFilter;
    promptExpanded: boolean;
}
export declare function initialWorkflowDialogState(initialPhaseIndex?: number): WorkflowDialogState;
/** Everything the dialog reads about a run, so it can be driven from a stub. */
export interface WorkflowDialogSource {
    progress: readonly WorkflowEntry[];
    task: WorkflowCardTask;
    meta?: WorkflowMeta;
    /** Agents the runtime has scheduled, which can exceed those that reported. */
    agentCount?: number;
}
export interface WorkflowDialogInput extends WorkflowDialogSource {
    state: WorkflowDialogState;
    /**
     * Which actions the caller actually wired. Absent keys default to available,
     * so layout tests and read-only callers keep the full footer; a caller that
     * wires only some actions passes the map so the hints stay truthful.
     */
    available?: Partial<Record<keyof WorkflowDialogActions, boolean>>;
    now?: number;
    /** The *terminal* width; the content width is derived from it. */
    width?: number;
    ascii?: boolean;
    spinnerFrame?: number;
    /**
     * Most rows the frame may use, overriding {@link DEFAULT_PANE_BODY_ROWS}.
     *
     * The frame still sizes to its content and still respects
     * {@link MIN_PANE_BODY_ROWS}; this only moves the ceiling.
     */
    bodyRows?: number;
}
/** The actions the dialog needs from the workflow runtime, injected. */
export interface WorkflowDialogActions {
    onKill?(): void;
    onPause?(): void;
    onResume?(): void;
    /** `index` is the entry's stable `index`, not its row position. */
    onSkipAgent?(index: number): void;
    onRetryAgent?(index: number): void;
    /**
     * Open the selected agent's conversation.
     *
     * `recordId` is the manager's id for the child, which the entry carries once
     * the host has reported one — the dialog knows nothing about sessions, so
     * what happens to an id whose record has since been swept is the caller's to
     * say. The only key here that shows something rather than changing the run.
     */
    onOpenAgent?(recordId: string): void;
}
export type WorkflowDialogAction = {
    kind: "cancel";
} | {
    kind: "kill";
} | {
    kind: "pause";
} | {
    kind: "resume";
} | {
    kind: "skip";
    index: number;
} | {
    kind: "retry";
    index: number;
} | {
    kind: "open";
    recordId: string;
};
export interface ResolvedWorkflowDialog {
    groups: PhaseGroup[];
    clampedPhase: number;
    clampedAgent: number;
    /** The selected phase's agents, after the state filter. */
    visibleAgents: WorkflowAgentEntry[];
    selectedEntry: WorkflowAgentEntry | undefined;
    /** False once the run stops — which is what turns live agents "interrupted". */
    workflowActive: boolean;
    paused: boolean;
}
/** Content width. The 6 columns are the dialog's border and padding. */
export declare function workflowDialogContentWidth(terminalWidth: number): number;
/**
 * Settle the selection against the data actually present.
 *
 * Selection is stored raw and clamped on read, so a phase finishing (and its
 * agents dropping out of a filtered view) never leaves the cursor pointing past
 * the end — the same trick `fleet-list.ts` plays, minus the mutation.
 */
export declare function resolveWorkflowDialog(input: WorkflowDialogInput): ResolvedWorkflowDialog;
/**
 * The `·`-separated annotations between an agent's label and its stats.
 *
 * These say *why* a row looks the way it does — a retry and its cause, a cache
 * hit replayed from the resume journal, how long a queued agent has been
 * waiting. The stat tail (agentType, model, tokens, tool calls, duration) is the
 * card's and is appended after.
 */
export declare function subStatusAnnotations(entry: WorkflowAgentEntry, state: WorkflowDisplayState, now: number): string[];
/**
 * Inner width of the left pane.
 *
 * Fixed rather than proportional at usable terminal sizes: the left pane holds
 * short labels (a phase title, an agent label) and the right pane holds
 * everything that actually needs room, so giving the left a share of a wide
 * terminal would only pad it. It gives way on a narrow one.
 */
export declare function leftPaneWidth(width: number): number;
/**
 * Which of the per-agent actions the selected row can currently take.
 *
 * The window for both is the one in which the agent's `agent()` call is still
 * unanswered. Skip covers that whole window; retry needs a child to stop and
 * start again, so it begins only once one exists. Once the call has settled its
 * value is already the script's, and there is nothing either key could change.
 */
export declare function agentActions(entry: WorkflowAgentEntry | undefined, workflowActive: boolean): {
    skip: boolean;
    retry: boolean;
};
/**
 * Build the dialog.
 *
 * Two panes side by side inside one frame, and two levels of depth: phases with
 * the selected phase's agents beside them, then — on opening one — those agents
 * with the selected agent's detail beside them. The frame is a fixed height so
 * the dialog does not jump as the selection moves through runs of very
 * different sizes.
 */
export declare function layoutWorkflowDialog(input: WorkflowDialogInput): WorkflowCardLine[];
/**
 * Map a keypress to the next state and, where the key is an action, what the
 * caller should do about it. Pure: `undefined` means "not ours".
 *
 * Movement clamps at both ends rather than wrapping — a long agent list should
 * not jump back to the top under a held `j`.
 */
export declare function handleWorkflowDialogKey(data: string, state: WorkflowDialogState, view: ResolvedWorkflowDialog): {
    state: WorkflowDialogState;
    action?: WorkflowDialogAction;
} | undefined;
/** The dialog as plain text — what the layout tests assert against. */
export declare function plainWorkflowDialogLines(lines: readonly WorkflowCardLine[]): string[];
/**
 * The `/agents → Workflows` overlay.
 *
 * Deliberately thin: it owns the spinner timer and the theme, and delegates
 * everything else to the two pure functions above. `source` is re-read every
 * render so a live run updates in place without any subscription plumbing.
 */
export declare class WorkflowDialog implements Component {
    private tui;
    private source;
    private theme;
    private done;
    private actions;
    private state;
    private spinnerFrame;
    private timer;
    private closed;
    constructor(tui: TUI, source: () => WorkflowDialogSource, theme: Theme, done: (result: undefined) => void, actions?: WorkflowDialogActions, initialPhaseIndex?: number);
    handleInput(data: string): void;
    render(width: number): string[];
    invalidate(): void;
    dispose(): void;
    private dispatch;
}
