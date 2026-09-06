/**
 * fleet-list.ts — Claude Code-style "FleetView" list rendered below the editor.
 *
 * Shows `main` + each running/queued subagent as a navigable list. Pressing ↓ (or
 * ←) at an empty prompt activates the list; ↑/↓ move the selection (filled ● marker),
 * Enter opens the selected agent's live conversation overlay, Esc returns to the prompt.
 * A viewer stays open when its agent finishes; finished agents linger briefly in the list.
 *
 * Mechanics (see plan): the list is a `belowEditor` widget (render-only), and ALL key
 * handling goes through `onTerminalInput` — which fires before the focused editor and
 * can `consume` keys — gated on `getEditorText() === ""` so normal typing is untouched.
 */
import { type AgentManager } from "../agent-manager.js";
import type { ViewerMarkdownMode } from "../types.js";
import { type AgentActivity, type Theme } from "./agent-widget.js";
/** Minimal UI surface the FleetView needs from `ctx.ui` (structural subset). */
export type FleetUICtx = {
    setWidget(key: string, content: undefined | ((tui: any, theme: Theme) => {
        render(width: number): string[];
        invalidate(): void;
        dispose?(): void;
    }), options?: {
        placement?: "aboveEditor" | "belowEditor";
    }): void;
    onTerminalInput(handler: (data: string) => {
        consume?: boolean;
        data?: string;
    } | undefined): () => void;
    getEditorText(): string;
    notify(message: string, type?: "info" | "warning" | "error"): void;
    custom<T>(factory: (tui: any, theme: Theme, keybindings: any, done: (result: T) => void) => {
        render(width: number): string[];
        invalidate(): void;
        dispose?(): void;
    }, options?: {
        overlay?: boolean;
        overlayOptions?: unknown;
        onHandle?: (handle: unknown) => void;
    }): Promise<T>;
};
/**
 * A workflow run, as the fleet list needs to see it.
 *
 * Narrow on purpose: the list knows nothing about `WorkflowTask`, the runtime
 * or the dialog, so it stays as testable as it was when it only held agents.
 * The extension maps its tasks into this shape and injects an opener.
 */
export interface FleetWorkflow {
    id: string;
    /** The `meta.name` of the run, or its id when the script named nothing. */
    name: string;
    status: "running" | "completed" | "failed" | "killed" | "paused";
    doneCount: number;
    totalCount: number;
    startedAt: number;
    /** Set once the run settles, which is what freezes its clock. */
    completedAt?: number;
    tokens: number;
}
/** `11s` — integer seconds, no decimal/suffix (matches Claude Code, unlike formatMs). */
export declare function formatFleetElapsed(ms: number): string;
/** `↓ 13.1k tokens` — down-arrow prefix, compact magnitude, plural "tokens". */
export declare function formatFleetTokens(count: number): string;
export declare class FleetList {
    private manager;
    private agentActivity;
    /**
     * Read live at render time. Whether each row shows an estimated cost after
     * its token count. Defaults to off — the extension supplies the user's
     * `showCost` setting.
     */
    private showCost;
    /**
     * The user's `viewerMarkdown` setting, for a conversation overlay opened
     * from here. Read live rather than captured, because the viewer's `m` key
     * changes it while the overlay is up. Omitted → the viewer's own default.
     */
    private viewerMarkdown?;
    /**
     * Persist a mode chosen with `m` in that overlay, so the key means the same
     * thing here as it does from `/agents` — one setting, not one per entry
     * point. Omitted → `m` still cycles, viewer-locally.
     */
    private onViewerMarkdown?;
    private ui;
    private tui;
    private inputUnsub;
    private widgetRegistered;
    private timer;
    private enabled;
    /** Whether arrow keys currently navigate the list (vs. flow to the editor). */
    private active;
    /** 0 = `main`, 1..N = subagents. */
    private selectedIndex;
    /** Set while a conversation overlay is open; calling it closes the overlay. */
    private viewerClose;
    private viewingAgentId;
    /** Injected by the extension; absent until workflows are wired (or at all). */
    private workflowSource;
    private openWorkflow;
    /**
     * Set while the workflow inspector is up.
     *
     * It does the two jobs `viewerClose` does for an agent's overlay — keep the
     * list out of the dialog's keys, and remember which row to come back to —
     * minus the close handle, because that overlay belongs to the extension.
     */
    private viewingWorkflowId;
    constructor(manager: AgentManager, agentActivity: Map<string, AgentActivity>,
    /**
     * Read live at render time. Whether each row shows an estimated cost after
     * its token count. Defaults to off — the extension supplies the user's
     * `showCost` setting.
     */
    showCost?: () => boolean,
    /**
     * The user's `viewerMarkdown` setting, for a conversation overlay opened
     * from here. Read live rather than captured, because the viewer's `m` key
     * changes it while the overlay is up. Omitted → the viewer's own default.
     */
    viewerMarkdown?: (() => ViewerMarkdownMode) | undefined,
    /**
     * Persist a mode chosen with `m` in that overlay, so the key means the same
     * thing here as it does from `/agents` — one setting, not one per entry
     * point. Omitted → `m` still cycles, viewer-locally.
     */
    onViewerMarkdown?: ((mode: ViewerMarkdownMode) => void) | undefined);
    setEnabled(enabled: boolean): void;
    /** Capture the UI context and (re)register the global input handler. */
    setUICtx(ui: FleetUICtx): void;
    /** Ensure the re-render timer is running (called when an agent spawns). */
    ensureTimer(): void;
    /**
     * Called when an agent finishes. The viewer (if open on it) stays open so the
     * final output remains readable, and the row lingers in the list — just refresh.
     */
    onAgentFinished(_id: string): void;
    dispose(): void;
    /** Re-register/refresh the below-editor widget; clears it when nothing remains. */
    update(): void;
    /**
     * Agents shown in the list, ordered earliest-launched first so the ones you
     * started sooner sit at the top. Every row is openable (has a session), so Enter
     * never dead-ends. Included: running/queued, plus the agent currently being
     * viewed, plus recently-finished ones (they linger briefly before dropping out).
     * Pending agents with no session yet are hidden until they start.
     * (`listAgents()` is newest-first, so we re-sort.)
     */
    private agentRecords;
    /**
     * Wire workflow runs into the list.
     *
     * Injected rather than constructed here because the fleet list predates
     * workflows and must keep working without them — a session with the feature
     * switched off never calls this, and the roster is agents-only exactly as
     * before.
     */
    setWorkflowSource(source: () => readonly FleetWorkflow[], open: (id: string) => Promise<void> | void): void;
    /** Live runs, plus recently settled ones — the same linger the agents get. */
    private workflows;
    /**
     * Runs sit above the agents rather than interleaved by start time: a run owns
     * most of the agents under it, so listing the container first is what makes
     * the list read as a hierarchy rather than a shuffle.
     */
    private roster;
    private clampSelection;
    /** Returns `{consume:true}` to swallow a key, or undefined to let it through. */
    handleKey(data: string): {
        consume?: boolean;
        data?: string;
    } | undefined;
    /**
     * True when pi's prompt editor owns the keyboard. pi's editor is an `Editor`
     * subclass (CustomEditor) while every dialog/selector is not, and the loader
     * aliases pi-tui to pi's own copy, so `instanceof` is a reliable identity
     * check. `focusedComponent` is TUI-private (no public accessor), hence the
     * best-effort peek: unknowable focus (no tui seen yet, nothing focused)
     * counts as the editor so activation keeps working.
     */
    private editorHasFocus;
    private deactivate;
    private openSelected;
    /** Reset overlay state and return to the list (on close, auto-close, or error). */
    private clearViewer;
    private renderBar;
    private bullet;
    /**
     * A run's row. Shaped like an agent's — bullet, kind, name, stats flush right
     * — so the two read as one list, with the agent count where an agent has its
     * description and the same elapsed/token tail.
     */
    private renderWorkflowRow;
    private renderAgentRow;
}
