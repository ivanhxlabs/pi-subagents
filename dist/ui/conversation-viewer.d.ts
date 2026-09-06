/**
 * conversation-viewer.ts — Live conversation overlay for viewing agent sessions.
 *
 * Displays a scrollable, live-updating view of an agent's conversation.
 * Subscribes to session events for real-time streaming updates.
 */
import { type AgentSession } from "@earendil-works/pi-coding-agent";
import { type Component, type TUI } from "@earendil-works/pi-tui";
import type { AgentRecord, ViewerMarkdownMode } from "../types.js";
import type { Theme } from "./agent-widget.js";
import { type AgentActivity } from "./agent-widget.js";
import { type ViewerKeybindings } from "./viewer-keys.js";
/** Height ceiling shared by the overlay's `maxHeight` and the viewer's internal viewport cap. */
export declare const VIEWPORT_HEIGHT_PCT = 70;
/**
 * Cap on a single tool result or bash output before the viewer elides the rest.
 *
 * The cap is not cosmetic — it bounds render cost. `buildContentLines()` runs on
 * every render *and* on every scroll key (`handleInput` calls it to compute
 * `maxScroll`), so an uncapped 200 KB result costs ~6 ms per keystroke to parse
 * as Markdown, against ~0.5 ms once capped and effectively nothing on a cache
 * hit (best of 5, width 76). 16 KB is roughly a screenful at every terminal size
 * and still ~30x the 500 characters this replaces, which was small enough to cut
 * most real results mid-sentence.
 */
export declare const RESULT_MAX_CHARS = 16000;
export declare class ConversationViewer implements Component {
    private tui;
    private session;
    private record;
    private activity;
    private theme;
    private done;
    /** Abort the agent shown here. Omitted → no stop affordance (e.g. read-only history). */
    private onStop?;
    /** Send a steering message to the agent. Omitted → no compose affordance. */
    private onSteer?;
    /**
     * Whether the header shows an estimated cost after the token count. Read
     * once, at construction: the overlay is opened from a menu, so the setting
     * cannot change while it is on screen.
     */
    private showCost;
    /**
     * The current `viewerMarkdown` setting. Read live rather than captured,
     * unlike `showCost`: `m` changes it while the overlay is on screen.
     * Omitted → `assistant`.
     */
    private viewerMarkdown?;
    /**
     * Persist a mode chosen with `m`, so the key and `/agents → Settings` mean
     * the same thing. Omitted → `m` still cycles, viewer-locally.
     */
    private onMarkdownMode?;
    private scrollOffset;
    private autoScroll;
    private unsubscribe;
    private lastInnerW;
    private closed;
    /** Two-press confirm guard for the stop key, so a stray key can't kill the agent. */
    private stopArmed;
    private keys;
    /** Steering composer — present while the user is typing a message to the agent. */
    private composer;
    /** Resolved once: pi's Markdown theme is fixed for the life of the process. */
    private readonly markdownTheme;
    /** Set by the `m` key. Wins over the setting so `m` works without a persist hook. */
    private markdownModeOverride;
    /**
     * One `Markdown` per message, so its own text/width cache does the work. A
     * fresh instance per render would re-parse the whole transcript on every
     * keystroke — the component caches, but only across calls to the same object.
     * Weak so a compacted-away message doesn't pin its render.
     */
    private readonly markdownCache;
    /**
     * One rendered block per message, so a warm `buildContentLines()` only
     * re-renders messages that changed. Message objects are stable and their
     * text only grows while streaming, so the `{ width, mode, key }` guard
     * catches the three ways a cached block can go stale.
     */
    private readonly contentCache;
    constructor(tui: TUI, session: AgentSession, record: AgentRecord, activity: AgentActivity | undefined, theme: Theme, done: (result: undefined) => void,
    /** Abort the agent shown here. Omitted → no stop affordance (e.g. read-only history). */
    onStop?: (() => void) | undefined,
    /** User keybindings from `ctx.ui.custom()`. Omitted → hardcoded defaults. */
    keybindings?: ViewerKeybindings,
    /** Send a steering message to the agent. Omitted → no compose affordance. */
    onSteer?: ((message: string) => void) | undefined,
    /**
     * Whether the header shows an estimated cost after the token count. Read
     * once, at construction: the overlay is opened from a menu, so the setting
     * cannot change while it is on screen.
     */
    showCost?: boolean,
    /**
     * The current `viewerMarkdown` setting. Read live rather than captured,
     * unlike `showCost`: `m` changes it while the overlay is on screen.
     * Omitted → `assistant`.
     */
    viewerMarkdown?: (() => ViewerMarkdownMode) | undefined,
    /**
     * Persist a mode chosen with `m`, so the key and `/agents → Settings` mean
     * the same thing. Omitted → `m` still cycles, viewer-locally.
     */
    onMarkdownMode?: ((mode: ViewerMarkdownMode) => void) | undefined);
    handleInput(data: string): void;
    render(width: number): string[];
    /** Stoppable only when a stop handler exists and the agent is still active. */
    private isStoppable;
    /** The mode in force: an `m` press, else the setting, else the default. */
    private markdownMode;
    /** Wrap `text` literally — the pre-Markdown path, and the fallback from it. */
    private rawLines;
    /** Render `text` as Markdown, reusing this message's component instance. */
    private markdownLines;
    /** Steerable only when a steer handler exists and the agent is still active. */
    private canSteer;
    /** Open the inline steering composer and route subsequent input to it. */
    private openComposer;
    invalidate(): void;
    dispose(): void;
    private viewportHeight;
    private chromeLines;
    private invocationLine;
    private buildContentLines;
    /**
     * One message's rendered block (header + body, lines pre-truncated to
     * `width`), or an empty array for a message the transcript skips. Cached per
     * message against `{ width, mode, key }`; a miss rebuilds just that block.
     */
    private messageLines;
}
