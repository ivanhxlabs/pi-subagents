/**
 * agent-runner.ts — Core execution engine: creates sessions, runs agents, collects results.
 */
import type { Model } from "@earendil-works/pi-ai";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { type AgentSession, DefaultResourceLoader, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { type NestedAgentManager } from "./nested-tools.js";
import { type StrictAttemptFailureCode, type StrictEffort, type StrictExecutionEvidence, type StrictObservedEffort } from "./strict-agent.js";
import type { AgentConfig, SubagentType, ThinkingLevel } from "./types.js";
import type { LifetimeUsage } from "./usage.js";
import type { CompiledSchema } from "./workflow/json-schema.js";
/**
 * Tool names registered by THIS extension. Single source of truth so the
 * registration sites (index.ts) and the subagent exclusion list below can't
 * drift apart. These are our own tools, not pi built-ins, so they can't be
 * derived from pi — but they only need defining once.
 */
export declare const SUBAGENT_TOOL_NAMES: {
    readonly AGENT: "Agent";
    readonly WORKFLOW: "SubagentWorkflow";
    readonly GET_RESULT: "get_subagent_result";
    readonly STEER: "steer_subagent";
};
/**
 * Canonical name of an extension for `extensions: [...]` allowlist matching.
 * Lowercased — extension names match case-insensitively so `extensions: [Mcp]`
 * resolves the same as `[mcp]`. Tool names within `ext:foo/bar` are not affected.
 * Directory extensions (`foo/index.ts`) resolve to the parent directory name;
 * single-file extensions to the basename minus `.ts`/`.js`.
 */
export declare function extensionCanonicalName(extPath: string): string;
/**
 * All names an extension answers to for allowlist matching (lowercased): its
 * path-derived {@link extensionCanonicalName} plus, when a pi package manifest
 * declares this entry, that package's unscoped short name (`@scope/foo` → `foo`).
 * #143: an extension installed via `pi.extensions: ["./src/index.ts"]` would
 * otherwise only ever match as `src` (the source directory), never by its
 * package name. The path-derived name is preserved, so it keeps matching too.
 */
export declare function extensionCanonicalNames(extPath: string): string[];
/**
 * Classify `extensions: string[]` frontmatter entries for the loader-level filter.
 *
 * An entry is a PATH iff it contains a path separator or starts with `~`; otherwise
 * it is a NAME. `"*"` sets the wildcard flag (keep all default-discovered extensions).
 *
 * Path entries are resolved (`~` expanded, made absolute against `cwd`) into `paths`
 * — and their canonical name is also added to `names`. The loader override matches
 * everything by canonical name, so path-loaded extensions are matched via their name
 * rather than their post-staging `Extension.path`.
 */
export declare function parseExtensionsSpec(entries: string[], cwd: string): {
    names: Set<string>;
    paths: string[];
    wildcard: boolean;
};
/**
 * Parse raw `ext:` selector strings (from the `tools:` CSV) into the set of
 * extension names to keep loaded and a per-extension tool-narrowing map.
 *
 * `ext:foo` → `extNames` has `foo`, no narrowing entry (all of foo's tools).
 * `ext:foo/bar` → `extNames` has `foo`, `narrowing.foo` has `bar` (only `bar`).
 * A name lands in `narrowing` only when a `/tool` form is seen, so a bare
 * `ext:foo` alongside `ext:foo/bar` leaves narrowing in effect (narrowing wins).
 * The split is on the first `/`; extension canonical names never contain `/`.
 */
export declare function parseExtSelectors(entries: string[]): {
    extNames: Set<string>;
    narrowing: Map<string, Set<string>>;
};
/**
 * Keep a subagent's tool scope correct as extensions register tools over time.
 *
 * Extensions may call `registerTool` long after load — pi-mcp from `session_start`,
 * context-mode from `before_agent_start` — so scope has to be re-derived rather than
 * snapshotted. `registerTool` writes into the very `extension.tools` maps this reads,
 * so `inScope()` sees late arrivals on the next call.
 *
 * Two enforcement points, because neither covers the whole picture:
 *
 *   - `turn_end` re-narrows the ACTIVE set. pi emits `turn_end` immediately before
 *     `prepareNextTurn` re-snapshots `agent.state.tools`, and session listeners run
 *     synchronously, so the narrow lands in time for turns 2..N.
 *   - `beforeToolCall` blocks out-of-scope calls. Turn 1 cannot be narrowed at all:
 *     `before_agent_start` fires INSIDE `prompt()` and may widen the tool set, but
 *     `createContextSnapshot()` freezes that turn's tools immediately after — there
 *     is no hook in between. A call-time check is the only correct guard there.
 *
 * Both are installed on the session and deliberately NOT unsubscribed: they must
 * outlive the `runAgent` call so resumed/steered turns stay scoped. pi's `dispose()`
 * clears `_eventListeners`, so they die with the session rather than leaking.
 *
 * Only meaningful when extensions are loaded — under `noExtensions`/`isolated` the
 * static `allowedToolNames` allowlist already gates the registry itself.
 */
export declare function installExtensionToolScope(session: AgentSession, ctx: {
    loader: DefaultResourceLoader;
    toolNames: string[];
    disallowedSet: Set<string> | undefined;
    extNames: Set<string>;
    narrowing: Map<string, Set<string>>;
    /**
     * Injected `customTools` to keep active regardless of the built-in list.
     *
     * Two kinds arrive here and they are blocked for different reasons: opt-in
     * nested-delegation tools share EXCLUDED_TOOL_NAMES' names, and
     * StructuredOutput is simply not a built-in, so neither survives a `keep`
     * seeded from `toolNames`.
     */
    readmitToolNames: Set<string>;
}): void;
/** Normalize max turns. undefined or 0 = unlimited, otherwise minimum 1. */
export declare function normalizeMaxTurns(n: number | undefined): number | undefined;
/** Get the default max turns value. undefined = unlimited. */
export declare function getDefaultMaxTurns(): number | undefined;
/** Set the default max turns value. undefined or 0 = unlimited, otherwise minimum 1. */
export declare function setDefaultMaxTurns(n: number | undefined): void;
/**
 * The turn limit a run of `type` will actually enforce: an explicit value if the
 * caller supplied one, else the agent's own `max_turns`, else the project
 * default. `undefined` = unlimited.
 *
 * Exported because the widget's turn counter (`↻3≤20`) has to predict this
 * before the run starts, and a second copy of the expression would drift from
 * the one below that enforces it.
 */
export declare function resolveEffectiveMaxTurns(type: string, explicit?: number): number | undefined;
/** Whether subagent sessions are persisted by default. */
export declare function getRememberAgents(): boolean;
/** Set whether subagent sessions are persisted by default. */
export declare function setRememberAgents(b: boolean): void;
/** Get the grace turns value. */
export declare function getGraceTurns(): number;
/** Set the grace turns value (minimum 1). */
export declare function setGraceTurns(n: number): void;
/**
 * Try to find the right model for an agent type.
 * Priority: explicit option > config.model > parent model.
 */
export declare function resolveDefaultModel(parentModel: Model<any> | undefined, registry: {
    find(provider: string, modelId: string): Model<any> | undefined;
    getAvailable?(): Model<any>[];
}, configModel?: string): Model<any> | undefined;
/** Info about a tool event in the subagent. */
export interface ToolActivity {
    type: "start" | "end";
    toolName: string;
}
export interface StrictRunObserver {
    expectedModel: string;
    expectedEffort: StrictEffort;
    onObserved(info: {
        model: string;
        effort: StrictObservedEffort;
    }): void;
    onEvidence(evidence: StrictExecutionEvidence): void;
    onFailure(code: StrictAttemptFailureCode, message: string): void;
}
export interface RunOptions {
    /** ExtensionAPI instance — used for pi.exec() instead of execSync. */
    pi: ExtensionAPI;
    /** Manager-assigned id; suffixes session name to disambiguate parallel spawns (e.g. `Explore#a1b2c3d4`). */
    agentId?: string;
    model?: Model<any>;
    /** Immutable role definition selected by a strict session-owned registry. */
    agentConfigOverride?: AgentConfig;
    maxTurns?: number;
    signal?: AbortSignal;
    isolated?: boolean;
    inheritContext?: boolean;
    thinkingLevel?: ThinkingLevel;
    /**
     * Reopen this pi session file rather than starting an empty conversation.
     * `createAgentSession` seeds itself from whatever its SessionManager holds,
     * so pointing it at an existing file rehydrates that agent's history and the
     * prompt continues it. Everything else — tools, model, system prompt, turn
     * caps — is still resolved from the agent type, so the continuation runs
     * under the type's *current* definition, not the one the original run used.
     */
    resumeSessionFile?: string;
    /**
     * True when another agent spawned this one. Only top-level agents get a
     * handle, so only they can be reopened by name — which is the whole reason
     * `rememberAgents` persists a session at all. A nested run's transcript would
     * be unreachable by anything, so it stays in memory unless its own
     * frontmatter asks otherwise.
     */
    nested?: boolean;
    /**
     * True when a workflow run spawned this agent. Its final text is the value
     * `agent()` resolves to rather than a report a person reads, and the prompt
     * says so — but only when `structuredOutput` is unset, since that child
     * already has a `StructuredOutput` tool to answer through and two competing
     * "this is how you return your answer" instructions is worse than one.
     */
    workflow?: boolean;
    /** Override working directory (e.g. for worktree isolation). */
    cwd?: string;
    /**
     * Directory the worktree copy was created from. Set only when `cwd` points
     * into a worktree — the prompt then tells the agent to stay in the copy
     * instead of following the inherited parent prompt back to the main tree.
     */
    worktreeBase?: string;
    /**
     * Where .pi config is discovered (project extensions, skills, pi settings,
     * agent memory). Default: same as the working directory. The manager sets
     * this to the parent session's cwd when `SpawnOptions.cwd` points the
     * working directory elsewhere — the agent works *there* but carries the
     * parent project's config (the target's `.pi` extensions never execute).
     *
     * WARNING for future callers: if you pass `cwd` pointing at a directory the
     * user didn't open, you almost certainly must pass `configCwd` too —
     * omitting it makes the target's `.pi` extensions execute in this process.
     * (Worktree isolation is the one intentional exception: its copy IS the
     * parent's repo, so config resolving inside it is correct.)
     */
    configCwd?: string;
    /** Called on tool start/end with activity info. */
    onToolActivity?: (activity: ToolActivity) => void;
    /** Called on streaming text deltas from the assistant response. */
    onTextDelta?: (delta: string, fullText: string) => void;
    onSessionCreated?: (session: AgentSession) => void;
    /** Called at the end of each agentic turn with the cumulative count. */
    onTurnEnd?: (turnCount: number) => void;
    /**
     * Called once per assistant message_end with that message's usage delta.
     * Lets callers maintain a lifetime accumulator that survives compaction
     * (which replaces session.state.messages and resets stats-derived sums).
     *
     * `cost` is pi's own `usage.cost.total` for that message — priced from the
     * model's rates, so it is 0 (not missing) for a model pi has no pricing for.
     * We never price anything ourselves; every dollar figure this extension shows
     * or reports traces back to this field.
     */
    onAssistantUsage?: (usage: LifetimeUsage) => void;
    /**
     * Called when the session successfully compacts. `tokensBefore` is upstream's
     * pre-compaction context size estimate. Aborted compactions don't fire.
     */
    onCompaction?: (info: {
        reason: "manual" | "threshold" | "overflow";
        tokensBefore: number;
    }) => void;
    /**
     * Make this child report through a `StructuredOutput` tool built from this
     * schema, and put the validated payload on {@link RunResult.structuredJson}.
     *
     * Already compiled by the caller, so a schema this runtime cannot validate
     * fails at the call that wrote it rather than inside the child.
     */
    structuredOutput?: CompiledSchema;
    /** Final-preflight enforcement and execution evidence for strict workflow attempts. */
    strictAttempt?: StrictRunObserver;
    /** Runtime bridge for opt-in child-safe nested delegation. */
    nestedRuntime?: {
        manager: NestedAgentManager;
        parentAgentId: string;
        depth: number;
        maxSubagentDepth?: number;
    };
}
export interface RunResult {
    responseText: string;
    session: AgentSession;
    /** True if the agent was hard-aborted (max_turns + grace exceeded). */
    aborted: boolean;
    /** True if the agent was steered to wrap up (hit soft turn limit) but finished in time. */
    steered: boolean;
    /**
     * A failure message for the run's FINAL assistant turn, when that turn failed:
     * a provider error (stopReason "error"), or a "length" stop that produced no
     * text (a silent max-token death). pi resolves an exhausted-retries failure
     * normally instead of rejecting, so without this the manager would report such
     * a run as completed — with an empty result, or worse, an earlier turn's text
     * presented as the answer (#144). Undefined for a clean stop, or a "length"
     * stop that produced text (a legitimate truncated answer).
     */
    failure?: string;
    /**
     * The validated `StructuredOutput` payload as canonical JSON, when the caller
     * asked for a schema and the child produced one.
     *
     * Deliberately not folded into {@link responseText}: `record.result` picks up
     * a worktree branch note on the way out, which would leave the caller with
     * unparseable JSON, and merging the two would make "produced structured
     * output" indistinguishable from "happened to answer in JSON".
     */
    structuredJson?: string;
    /** Whether the extra structured-output prompt had to be sent. */
    structuredRetried?: boolean;
}
export declare function runAgent(ctx: ExtensionContext, type: SubagentType, prompt: string, options: RunOptions): Promise<RunResult>;
/**
 * Send a new prompt to an existing session (resume).
 */
export declare function resumeAgent(session: AgentSession, prompt: string, options?: {
    onToolActivity?: (activity: ToolActivity) => void;
    onAssistantUsage?: (usage: LifetimeUsage) => void;
    onCompaction?: (info: {
        reason: "manual" | "threshold" | "overflow";
        tokensBefore: number;
    }) => void;
    signal?: AbortSignal;
}): Promise<{
    text: string;
    failure?: string;
}>;
/**
 * Send a steering message to a running subagent.
 * The message will interrupt the agent after its current tool execution.
 */
export declare function steerAgent(session: AgentSession, message: string): Promise<void>;
/**
 * Get the subagent's conversation messages as formatted text.
 */
export declare function getAgentConversation(session: AgentSession): string;
