/**
 * agent-manager.ts — Tracks agents, background execution, resume support.
 *
 * There are two independent concurrency pools, never one:
 *
 * - Background (`maxConcurrent`, default 10) bounds detached agents.
 * - Foreground (`maxConcurrentForeground`, default 0 = unlimited) bounds
 *   agents a caller is blocking on inline — `spawnAndWait`.
 *
 * Independent by design: a foreground agent blocks the parent anyway, so
 * charging it to the background pool would let a saturated pool starve the main
 * session of work it could have done itself. Excess agents in either pool are
 * queued and auto-started as slots free up. Nested children take no slot in
 * either — see `occupiesPoolSlot` / `occupiesForegroundSlot`.
 */
import type { Model } from "@earendil-works/pi-ai";
import type { AgentSession, ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { type StrictRunObserver, type ToolActivity } from "./agent-runner.js";
import type { AgentConfig, AgentInvocation, AgentRecord, AgentTombstone, IsolationMode, MentionResolution, SubagentType, ThinkingLevel } from "./types.js";
import { type LifetimeUsage } from "./usage.js";
import type { CompiledSchema } from "./workflow/json-schema.js";
export type OnAgentComplete = (record: AgentRecord) => void;
export type OnAgentStart = (record: AgentRecord) => void;
export type OnAgentCompact = (record: AgentRecord, info: CompactionInfo) => void;
/**
 * Fired once per assistant `message_end`, for EVERY agent this manager owns —
 * top-level and nested alike, spawns and resumes. The one place where each
 * message is seen exactly once: `AgentRecord.lifetimeUsage` is deliberately
 * double-booked into ancestors (see `nested-tools.ts`) so a hidden child's spend
 * shows up on the record a human can see, which makes those records useless as
 * a basis for anything that must not count a message twice — parent-session
 * accounting above all.
 */
export type OnAgentUsage = (record: AgentRecord, usage: LifetimeUsage) => void;
export type CompactionInfo = {
    reason: "manual" | "threshold" | "overflow";
    tokensBefore: number;
};
/**
 * Whether a record is one of the session's own agents, rather than something
 * another agent or a workflow owns.
 *
 * The single definition behind every user-facing surface — the fleet list, the
 * widget, the `/agents` menus, `@handle` resolution, and the completion events
 * and session entries. An owned child reports through its owner, so surfacing
 * it separately would double-count the same work in the places a person reads.
 */
export declare function isTopLevelAgent(record: Pick<AgentRecord, "parentAgentId" | "workflowId">): boolean;
interface SpawnOptions {
    description: string;
    /**
     * Optional memorable name for this instance, becoming a second handle
     * (`@auth-audit`) alongside the type-derived one. Slugged, not validated —
     * anything unusable degrades via `handleBase` rather than failing the spawn.
     */
    name?: string;
    /**
     * Reopen this pi session file instead of starting a fresh conversation, so a
     * mention of an evicted agent continues where it left off. The agent's
     * definition is still resolved from its type, so the continuation runs under
     * the type's CURRENT config.
     */
    resumeSessionFile?: string;
    /**
     * Take an evicted agent's names back verbatim instead of allocating fresh
     * ones, so a resumed conversation keeps the handle the user just typed —
     * `handleBase(type)` cannot reproduce a numbered `explore-2`. Safe without an
     * `assignHandle` pass because tombstoned names are excluded from allocation
     * (`takenHandles`), so nothing live can be holding them.
     *
     * Internal capability, like `resumeSessionFile`: a forged handle would
     * duplicate a live agent's name and make `resolveMention` ambiguous, so
     * `spawnTopLevel` strips it from anything a caller sends.
     */
    reclaim?: {
        handle: string;
        alias?: string;
    };
    model?: Model<any>;
    /** Immutable role definition selected by a strict session-owned registry. */
    agentConfigOverride?: AgentConfig;
    maxTurns?: number;
    isolated?: boolean;
    inheritContext?: boolean;
    thinkingLevel?: ThinkingLevel;
    isBackground?: boolean;
    /**
     * Skip whichever pool's queue check applies to this spawn — start immediately
     * even if the configured concurrency limit would otherwise queue it. The slot
     * is still COUNTED once the run starts, so a bypassing spawn transiently
     * exceeds the limit rather than being invisible to it.
     *
     * Used by the scheduler, so a fired job can't be deferred past its trigger
     * window, and by the `/agents` agent-file generator, which has no way to
     * cancel a wait (see its call site).
     */
    bypassQueue?: boolean;
    /**
     * A caller is awaiting this record inline (`spawnAndWait`) — what
     * `maxConcurrentForeground` bounds. Set only by `spawnAndWait`; stripped from
     * caller-supplied options by `spawnTopLevel`, since a forged `blocking` would
     * defer a detached start behind a queue its caller cannot see or release.
     */
    blocking?: boolean;
    /**
     * The workflow run this child belongs to, when a workflow spawned it.
     *
     * Ownership, not decoration. A workflow's children are the workflow's — they
     * report through its card, its notification and its dialog, so they are
     * filtered out of every top-level surface exactly as nested children are, and
     * they take no `maxConcurrent` slot: the run has its own concurrency cap, and
     * counting them twice would let one workflow starve the whole session.
     */
    workflowId?: string;
    /**
     * Make the child report through a `StructuredOutput` tool built from this
     * compiled schema. Set only by the workflow host, for `agent({ schema })`.
     */
    structuredOutput?: CompiledSchema;
    /** Final-preflight enforcement and evidence observer for strict workflow attempts. */
    strictAttempt?: StrictRunObserver;
    /** Isolation mode — "worktree" creates a temp git worktree for the agent. */
    isolation?: IsolationMode;
    /**
     * Working directory for the agent (absolute path). Default: parent session
     * cwd. The agent's tools operate here, but .pi config (extensions, skills,
     * settings, memory) still loads from the parent session's project — the
     * target directory's `.pi` extensions never execute. With isolation:
     * "worktree", the worktree is created FROM this directory and the result
     * branch lands in that repo.
     */
    cwd?: string;
    /**
     * Last chance to look at an isolated agent's worktree, awaited immediately
     * before it is committed to a branch and removed.
     *
     * Exists because that removal happens inside the settle path, before
     * `spawnAndWait` resolves: by the time a caller has the finished record, the
     * directory the child actually wrote in is gone. Anything that must inspect
     * or verify that tree — a workflow `gate` is the motivating case — has to run
     * here or it silently inspects the main tree instead.
     *
     * Fires only on the normal settle path, and only when a worktree was created.
     * Not on the error path and not on the stop-during-copy guard: those are
     * already failing, and delaying cleanup there would leak a copy for no gain.
     * A rejection is swallowed — the hook can never keep the worktree alive.
     */
    onBeforeWorktreeCleanup?: (worktreePath: string) => Promise<void>;
    /** Resolved invocation snapshot captured for UI display. */
    invocation?: AgentInvocation;
    /** Parent abort signal — when aborted, the subagent is also stopped. */
    signal?: AbortSignal;
    /**
     * Called synchronously once the record is in the map and its promise is set,
     * before `onSessionCreated` fires — where callers attach the output file.
     *
     * Carried on the options rather than parked on the manager for the duration
     * of a spawn: with a foreground queue, `startAgent` can run at drain time,
     * long after any such field would have been restored, and the callback would
     * silently never fire (or fire into an unrelated caller's closure).
     */
    onSpawned?: (id: string) => void;
    /**
     * Called synchronously when the spawn is queued instead of started, with how
     * many entries in its own pool are ahead of it. The foreground UI uses it to
     * say so while it waits; nothing else needs it.
     */
    onQueued?: (id: string, ahead: number) => void;
    /** Called on tool start/end with activity info (for streaming progress to UI). */
    onToolActivity?: (activity: ToolActivity) => void;
    /** Called on streaming text deltas from the assistant response. */
    onTextDelta?: (delta: string, fullText: string) => void;
    /** Called when the agent session is created (for accessing session stats). */
    onSessionCreated?: (session: AgentSession) => void;
    /** Called at the end of each agentic turn with the cumulative count. */
    onTurnEnd?: (turnCount: number) => void;
    /** Called once per assistant message_end with that message's usage delta. */
    onAssistantUsage?: (usage: {
        input: number;
        output: number;
        cacheWrite: number;
    }) => void;
    /** Called when the session successfully compacts. */
    onCompaction?: (info: CompactionInfo) => void;
    /** Nesting depth: top-level subagent = 1. */
    depth?: number;
    /** Parent agent ID for ownership-scoped nested controls. */
    parentAgentId?: string;
    /** Effective inherited nesting cap for this branch. */
    maxSubagentDepth?: number;
    /** Config-discovery root inherited by nested launches when it differs from the working directory. */
    configCwd?: string;
    /** Root session id, inherited by nested launches so transcripts stay grouped. */
    rootSessionId?: string;
}
interface ResumeOptions {
    /**
     * Run the resumed turn detached in the background: return immediately with
     * the record still "running" (or "queued" at the concurrency limit) and
     * notify on completion via onComplete, exactly like a background spawn.
     * Default (false/undefined) runs the resume inline and returns the settled
     * record — the historical behavior.
     */
    isBackground?: boolean;
    /** Called on tool start/end with activity info (for streaming progress to UI). */
    onToolActivity?: (activity: ToolActivity) => void;
    /** Called once per assistant message_end with that message's usage delta. */
    onAssistantUsage?: (usage: {
        input: number;
        output: number;
        cacheWrite: number;
    }) => void;
    /** Called when the session successfully compacts. */
    onCompaction?: (info: CompactionInfo) => void;
    /**
     * Background resume only: called synchronously when the run actually starts —
     * immediately, or later from drainQueue. Callers wire per-run side effects
     * (output-file streaming) here rather than at the call site, so a resume that
     * is stopped while still queued never leaves a subscription behind: `abort()`
     * drops a queued record without reaching `settle()`, which is what would have
     * torn that subscription down.
     */
    onStarted?: () => void;
}
export declare class AgentManager {
    private agents;
    private cleanupInterval;
    private onComplete?;
    private onStart?;
    private onCompact?;
    private onUsage?;
    private maxConcurrent;
    private maxConcurrentForeground;
    /** Base repos worktrees were created from — so dispose() can prune them all,
     *  not just the parent repo (caller-supplied cwd can target other repos). */
    private worktreeRepos;
    /**
     * Startup phases, keyed by agent id. `spawn()` still returns synchronously,
     * but an agent using worktree isolation is not running yet when it does —
     * copying the repo is an awaited git call. This is what `awaitStartup` hands
     * callers that must fail their tool call on a startup failure, and what
     * `waitForAll` waits on while a record is "running" with no `promise` yet.
     * Entries are dropped once the run is underway, and kept (rejected) after a
     * startup failure so a late `awaitStartup` still sees it.
     */
    private startups;
    /**
     * Evicted agents that can still be reached by name, keyed by handle. Outlives
     * the 10-minute record cleanup — that timer exists to bound memory, not to
     * expire a conversation the user might still want — and is cleared alongside
     * completed records on session start/switch.
     */
    private tombstones;
    /**
     * Agents waiting to start, tagged with the pool they wait on. One queue for
     * both pools: `drainQueue` picks the earliest entry whose own pool has room,
     * so neither can head-of-line-block the other, and every removal path
     * (`abort`, `abortAll`, `dispose`) stays a single filter.
     *
     * `release` wakes a caller blocked in `spawnAndWait`, and is fired once the
     * entry's `start` has SETTLED rather than at drain time: startup is async
     * now, so releasing earlier would wake the caller before `record.promise`
     * exists and it would read a still-starting agent as one that never ran.
     * Removing an entry from this array MUST release it — a queued record has no
     * promise to await, and pi has no tool-execution timeout to bail the caller
     * out.
     */
    private queue;
    /** Number of currently running background agents. */
    private runningBackground;
    /** Number of currently running foreground (blocking) agents. */
    private runningForeground;
    constructor(onComplete?: OnAgentComplete, maxConcurrent?: number, onStart?: OnAgentStart, onCompact?: OnAgentCompact, onUsage?: OnAgentUsage);
    /** Update the max concurrent background agents limit. */
    setMaxConcurrent(n: number): void;
    getMaxConcurrent(): number;
    /** Update the max concurrent foreground (blocking) agents limit. 0 = unlimited. */
    setMaxConcurrentForeground(n: number): void;
    getMaxConcurrentForeground(): number;
    /**
     * Which pool a spawn is charged to, or undefined for one that is charged to
     * neither (nested children, detached non-background spawns).
     *
     * Nothing here queues when the limit is unset — `poolHasRoom` reports an
     * unlimited pool as always having room, so that alone is what keeps the
     * default path identical. The `> 0` guard is belt and braces on top: it also
     * keeps the counter from churning and the settle path from calling a drain
     * that would find nothing to do. Both are unobservable, which is why no test
     * pins them; the observable half — that the default start stays synchronous —
     * is pinned in `test/foreground-concurrency.test.ts`.
     */
    private poolFor;
    private poolHasRoom;
    /**
     * Spawn an agent and return its ID immediately (for background use).
     * If the concurrency limit is reached, the agent is queued.
     *
     * The id comes back synchronously, but with `isolation: "worktree"` the agent
     * is not running yet when it does — the repo copy is an awaited git call.
     * Callers that must fail a tool call on a startup failure await
     * `awaitStartup(id)`; everyone else sees it on the record (status "error").
     */
    spawn(pi: ExtensionAPI, ctx: ExtensionContext, type: SubagentType, prompt: string, options: SpawnOptions): string;
    /**
     * Wire a parent abort signal for a record that is about to be QUEUED.
     * `startAgent` does this for running agents, and a queued record never gets
     * there, so without this Esc could not release a queue position.
     *
     * Returns false when the signal is ALREADY aborted, in which case the record
     * is stopped here and must not be enqueued: `addEventListener` never fires on
     * an aborted signal, so a `spawnAndWait` on it would wait forever — pi has no
     * tool-execution timeout to bail it out.
     *
     * The listener is left in place when the agent starts. `startAgent` adds its
     * own, so both fire on a later abort, but `abort()` on an already-stopped
     * record is a no-op — so detaching would only be tidiness, and tidiness the
     * `abortAll`/`dispose` paths could not offer anyway.
     */
    private armQueuedAbort;
    /**
     * Kick off an agent's startup and register it under `startups`. The returned
     * promise never rejects — the failure is delivered through `awaitStartup`,
     * and to the record.
     *
     * @param queuedPool - The pool this start was QUEUED on, or undefined for an
     *   immediate start. A queue drain can be minutes after `spawn()` returned,
     *   and nobody is awaiting `awaitStartup` by then, so a failure has to live
     *   on the record as status "error" — what drainQueue did when the throw was
     *   still synchronous. An immediate start instead drops the record, exactly
     *   as the throw out of `spawn()` did: no orphan in `listAgents()`, and the
     *   handle goes back.
     */
    private launch;
    /**
     * Resolves once the agent is actually running, and rejects with the startup
     * failure (strict worktree isolation) that `spawn()` used to throw before the
     * repo copy became async. Resolves immediately for an agent that is already
     * running, still queued, or unknown — so callers can await it unconditionally.
     *
     * Call it in the same tick as the `spawn()` it belongs to: a failed startup
     * takes its record (and this entry) with it, exactly as the throw did.
     */
    awaitStartup(id: string): Promise<void>;
    /** Actually start an agent (called immediately or from queue drain). */
    private startAgent;
    /**
     * The shared tail of both settle paths: release whatever pool slot the run
     * held, notify, and let the queue drain into the freed slot.
     *
     * The decrement lives HERE and nowhere else. `abort()` on a running record
     * only fires its controller and leaves the run to settle normally, so
     * decrementing there too would double-free — permanently lifting the limit.
     *
     * Foreground agents fire `onComplete` for lifecycle symmetry, with
     * `resultConsumed` set so the callback skips notifications the inline result
     * already delivered.
     *
     * @param guardCallback swallow a throwing `onComplete` (the success path does;
     *   the error path historically did not, and keeps not doing so).
     * @param pool the pool this run was CHARGED TO at start time — passed in, not
     *   recomputed, so a mid-run change to `maxConcurrentForeground` can't make
     *   the release disagree with the acquire.
     */
    private settleRun;
    /**
     * Stop the nested children a settled parent owns. Nested records are hidden
     * from the UI and only their owner can consume them, so a child outliving its
     * parent would burn tokens unseen with no way to reach it. Grandchildren are
     * covered transitively — each abort lands in that child's own settle path.
     */
    private abortOwnedChildren;
    /**
     * Start queued agents up to each pool's concurrency limit.
     *
     * `findIndex` on the entry's OWN pool rather than `shift`: with one queue
     * serving two independent limits, a saturated foreground pool at the head
     * would otherwise stall every background agent behind it. Taking the earliest
     * eligible entry keeps FIFO within each pool, which is what callers see.
     */
    private drainQueue;
    /**
     * Remove queued entries and wake anyone blocked on them. The single point
     * that enforces "leaving the queue releases the waiter" — a missed release is
     * an unbounded hang, not a failed call.
     */
    private dequeue;
    /**
     * Spawn an agent and wait for completion (foreground use).
     * Charged to the foreground pool (`maxConcurrentForeground`), which is
     * unlimited by default; never to the background one.
     * Returns { id, record } so callers can access the agent ID.
     *
     * @param onSpawned - Called synchronously once the run is kicked off, before
     *   onSessionCreated fires. Use this to set record.outputFile so
     *   streamToOutputFile can pick it up.
     */
    spawnAndWait(pi: ExtensionAPI, ctx: ExtensionContext, type: SubagentType, prompt: string, options: Omit<SpawnOptions, "isBackground">, onSpawned?: (id: string) => void): Promise<{
        id: string;
        record: AgentRecord;
    }>;
    /**
     * Resume an existing agent session with a new prompt.
     */
    resume(id: string, prompt: string, signal?: AbortSignal, options?: ResumeOptions): Promise<AgentRecord | undefined>;
    /**
     * Start a background resume run: detached, settling and notifying like
     * startAgent's background path. Invoked immediately, or from drainQueue when
     * a concurrency slot frees. The session already exists (resume reuses it), so
     * there is no onSessionCreated to hang per-run wiring off — callers use
     * `options.onStarted`, which fires on both the immediate and the drained path.
     */
    private startResume;
    /**
     * Send a steering message to an agent from the UI (mirrors the steer_subagent
     * tool). A live session delivers it now — it interrupts the agent after its
     * current tool execution and appears as a user message. If the session isn't
     * ready yet, the message is queued on `pendingSteers` and flushed when the
     * session is created. Returns false if the agent can't accept steering
     * (unknown id, or no longer running/queued).
     */
    steer(id: string, message: string): boolean;
    getRecord(id: string): AgentRecord | undefined;
    /** Handles already in use, so a fresh spawn can pick an unclaimed one. */
    private takenHandles;
    /**
     * Resolve an `@name` from the prompt. Matches a top-level agent's handle
     * case-insensitively, preferring one that can still be steered and otherwise
     * the most recently started (which is the one a resume should continue), then
     * falls back to an exact agent id so `@<agentId>` works too.
     */
    resolveMention(name: string): MentionResolution | undefined;
    /**
     * Forget an evicted agent, by handle. For the case where its session file has
     * gone: the entry can then only ever fail, while still holding the name
     * against the type that would otherwise start a fresh agent under it.
     *
     * A *successful* resume does not drop its tombstone — the live record it
     * creates already wins in `resolveMention`, and overwrites the entry in place
     * when it is itself evicted.
     */
    dropTombstone(handle: string): void;
    /** Evicted agents whose conversation can still be reopened, newest first. */
    listTombstones(): AgentTombstone[];
    listAgents(): AgentRecord[];
    abort(id: string): boolean;
    /** Dispose a record's session and remove it from the map. */
    private removeRecord;
    /**
     * Preserve enough of a departing record for `@handle` to reopen its
     * conversation later. Nothing to keep unless it has both a handle to be
     * addressed by and a session file to reopen — an in-memory session leaves no
     * transcript, so the mention would have nothing to continue from.
     */
    private tombstone;
    private cleanup;
    /**
     * Remove all completed/stopped/errored records immediately.
     * Called on session start/switch so tasks from a prior session don't persist.
     * Pass skipUnconsumed=true to preserve records the LLM hasn't read yet
     * (resultConsumed=false) — they will be evicted by the 10-minute cleanup timer instead.
     */
    clearCompleted(skipUnconsumed?: boolean): void;
    /** Whether any agents are still running or queued. */
    hasRunning(): boolean;
    /** Abort all running and queued agents immediately. */
    abortAll(): number;
    /** Wait for all running and queued agents to complete (including queued ones). */
    waitForAll(): Promise<void>;
    /**
     * @param pi - Needed to run `git worktree prune`, which is async now and so
     *   cannot be reached through a stored spawn argument at shutdown. Omitting
     *   it (tests, teardown of a manager that never spawned) skips the prune.
     */
    dispose(pi?: ExtensionAPI): Promise<void>;
}
export {};
