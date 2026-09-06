/**
 * agent-widget.ts — Persistent widget showing running/completed agents above the editor.
 *
 * Displays a tree of agents with animated spinners, live stats, and activity descriptions.
 * Uses the callback form of setWidget for themed rendering.
 */
import { type AgentManager } from "../agent-manager.js";
import type { AgentInvocation, SubagentType, WidgetMode } from "../types.js";
import { type SessionLike } from "../usage.js";
/** Braille spinner frames for animated running indicator. */
export declare const SPINNER: string[];
/** Statuses that indicate an error/non-success outcome (used for linger behavior and icon rendering). */
export declare const ERROR_STATUSES: Set<string>;
export type Theme = {
    fg(color: string, text: string): string;
    bold(text: string): string;
};
export type UICtx = {
    setStatus(key: string, text: string | undefined): void;
    setWidget(key: string, content: undefined | ((tui: any, theme: Theme) => {
        render(): string[];
        invalidate(): void;
    }), options?: {
        placement?: "aboveEditor" | "belowEditor";
    }): void;
};
/** Per-agent live activity state. */
export interface AgentActivity {
    activeTools: Map<string, string>;
    toolUses: number;
    responseText: string;
    session?: SessionLike;
    /** Current turn count. */
    turnCount: number;
    /** Effective max turns for this agent (undefined = unlimited). */
    maxTurns?: number;
}
/** Metadata attached to Agent tool results for custom rendering. */
export interface AgentDetails {
    displayName: string;
    description: string;
    subagentType: string;
    toolUses: number;
    tokens: string;
    durationMs: number;
    status: "queued" | "running" | "completed" | "steered" | "aborted" | "stopped" | "error" | "background";
    /** Human-readable description of what the agent is currently doing. */
    activity?: string;
    /** Current spinner frame index (for animated running indicator). */
    spinnerFrame?: number;
    /** Short label for the model the run used, e.g. "haiku 4.5". */
    modelName?: string;
    /** Notable config tags (e.g. ["thinking: high", "isolated"]). */
    tags?: string[];
    /** Current turn count. */
    turnCount?: number;
    /** Effective max turns (undefined = unlimited). */
    maxTurns?: number;
    /** Estimated cost in USD; 0 when the model has no pricing data. */
    cost?: number;
    agentId?: string;
    error?: string;
}
/** Apply foreground styling while restoring it after nested foreground/full ANSI resets. */
export declare function fgPreservingNestedStyles(theme: Theme, color: string, text: string): string;
/** Format a token count compactly: "33.8k token", "1.2M token". */
export declare function formatTokens(count: number): string;
/**
 * Format a cost as `~$0.0042`, or "" when there is nothing to show.
 *
 * The tilde is load-bearing: this is pi's own estimate from the model's listed
 * rates, not a billed figure, and the surfaces that print it sit next to token
 * counts that ARE exact.
 *
 * Nothing is printed for zero, which is also what a model with no pricing data
 * reports: `$0.00` beside a local model's tokens would claim its cost was
 * measured and found to be nothing, rather than never measured at all. For the
 * same reason a real cost too small for four decimals reads `<$0.0001` — it was
 * measured, and rounding it to `~$0.0000` would say the opposite.
 */
export declare function formatCost(cost: number): string;
/**
 * Token count with optional context-fill % and compaction-count annotations.
 * Thresholds for percent: <70% dim, 70–85% warning, ≥85% error.
 * Compaction count rendered as `⇊N` in dim.
 *
 *   "12.3k token"               — no annotations
 *   "12.3k token (45%)"         — percent only
 *   "12.3k token (⇊2)"          — compactions only (e.g. right after compact)
 *   "12.3k token (45% · ⇊2)"    — both
 */
export declare function formatSessionTokens(tokens: number, percent: number | null, theme: Theme, compactions?: number): string;
/** Format turn count with optional max limit: "↻5≤30" or "↻5". */
export declare function formatTurns(turnCount: number, maxTurns?: number | null): string;
/** Format milliseconds as human-readable duration. */
export declare function formatMs(ms: number): string;
/** Format duration from start/completed timestamps. */
export declare function formatDuration(startedAt: number, completedAt?: number): string;
/** Get display name for any agent type (built-in or custom). */
export declare function getDisplayName(type: SubagentType): string;
/** Short label for prompt mode: "twin" for append, nothing for replace (the default). */
export declare function getPromptModeLabel(type: SubagentType): string | undefined;
/**
 * Mode label is not included — callers add it where they want it.
 *
 * Both model forms come back so each surface can pick by width; the
 * "(asked X)" annotation is applied here rather than by callers, so a value the
 * spawn did not honor cannot be rendered as though it had been (#182).
 */
export declare function buildInvocationTags(invocation: AgentInvocation | undefined): {
    modelName?: string;
    modelId?: string;
    tags: string[];
};
/** Build a human-readable activity string from currently-running tools or response text. */
export declare function describeActivity(activeTools: Map<string, string>, responseText?: string): string;
export declare class AgentWidget {
    private manager;
    private agentActivity;
    /**
     * Read live at render time. Selects which agents the widget shows — see
     * `WidgetMode`. Defaults to `"all"` when a caller supplies no policy; the
     * extension supplies one defaulting to `"background"`.
     */
    private mode;
    /**
     * Read live at render time, like `mode`. Whether running agents show an
     * estimated cost beside their token count. Defaults to off — the extension
     * supplies the user's `showCost` setting.
     */
    private showCost;
    /**
     * Read live at render time, like `mode`. Whether running agents name the
     * model driving them and the thinking level it is running at. Defaults to
     * off — the extension supplies the user's `showModel` setting — because the
     * row is already dense and the same pair is on the tool result and in the
     * conversation viewer unconditionally.
     */
    private showModel;
    private uiCtx;
    private widgetFrame;
    private widgetInterval;
    /** Tracks how many turns each finished agent has survived. Key: agent ID, Value: turns since finished. */
    private finishedTurnAge;
    /** How many extra turns errors/aborted agents linger (completed agents clear after 1 turn). */
    private static readonly ERROR_LINGER_TURNS;
    /** Whether the widget callback is currently registered with the TUI. */
    private widgetRegistered;
    /** Cached TUI reference from widget factory callback, used for requestRender(). */
    private tui;
    /** Last status bar text, used to avoid redundant setStatus calls. */
    private lastStatusText;
    constructor(manager: AgentManager, agentActivity: Map<string, AgentActivity>,
    /**
     * Read live at render time. Selects which agents the widget shows — see
     * `WidgetMode`. Defaults to `"all"` when a caller supplies no policy; the
     * extension supplies one defaulting to `"background"`.
     */
    mode?: () => WidgetMode,
    /**
     * Read live at render time, like `mode`. Whether running agents show an
     * estimated cost beside their token count. Defaults to off — the extension
     * supplies the user's `showCost` setting.
     */
    showCost?: () => boolean,
    /**
     * Read live at render time, like `mode`. Whether running agents name the
     * model driving them and the thinking level it is running at. Defaults to
     * off — the extension supplies the user's `showModel` setting — because the
     * row is already dense and the same pair is on the tool result and in the
     * conversation viewer unconditionally.
     */
    showModel?: () => boolean);
    /**
     * Agents eligible for the widget, per the current `WidgetMode`:
     *   - `off`: none (the widget's existing empty-state path hides it entirely).
     *   - `background`: drop only agents *known* to be foreground
     *     (`isBackground === false`); keep everything else — background, queued,
     *     scheduled, or RPC-spawned (`undefined`). Keying off the `isBackground`
     *     record flag rather than the UI-only `invocation` snapshot (which only the
     *     Agent-tool path sets), and excluding rather than allow-listing, means
     *     only proven-foreground runs drop out — nothing else silently vanishes.
     *   - `all`: every agent.
     */
    private widgetAgents;
    /** Set the UI context (grabbed from first tool execution). */
    setUICtx(ctx: UICtx): void;
    /**
     * Called on each new turn (tool_execution_start).
     * Ages finished agents and clears those that have lingered long enough.
     */
    onTurnStart(): void;
    /** Ensure the widget update timer is running. */
    ensureTimer(): void;
    /** Check if a finished agent should still be shown in the widget. */
    private shouldShowFinished;
    /** Record an agent as finished (call when agent completes). */
    markFinished(agentId: string): void;
    /**
     * Drop an agent's finished-age (call when a settled agent starts running
     * again, i.e. a background resume). markFinished only seeds an age it has not
     * seen before, so a resumed agent would otherwise keep the age from its
     * previous run — already past the linger limit, hiding the new run's
     * completion line entirely.
     */
    markRunning(agentId: string): void;
    /** Render a finished agent line. */
    private renderFinishedLine;
    /**
     * Render the widget content. Called from the registered widget's render() callback,
     * reading live state each time instead of capturing it in a closure.
     */
    private renderWidget;
    /** Force an immediate widget update. */
    update(): void;
    dispose(): void;
}
