/**
 * agent-types.ts — Unified agent type registry.
 *
 * Merges embedded default agents with user-defined agents from .pi/agents/*.md, .agents/agents/*.md, and global agents.
 * User agents override defaults with the same name. Disabled agents are kept but excluded from spawning.
 */
import type { AgentConfig } from "./types.js";
/**
 * All known built-in tool names, derived from pi's own tool factories rather
 * than hardcoded so the set tracks pi-mono if it adds/renames a built-in.
 * `createCodingTools` → read/bash/edit/write; `createReadOnlyTools` →
 * read/grep/find/ls; their de-duplicated union is the 7 built-ins
 * (read, bash, edit, write, grep, find, ls). The `cwd` only binds tool
 * operations we never invoke here — we read each tool's `.name` and discard it.
 */
export declare const BUILTIN_TOOL_NAMES: string[];
/** Check whether default agents are disabled. */
export declare function isDefaultsDisabled(): boolean;
/** Set whether default agents are disabled. */
export declare function setDefaultsDisabled(b: boolean): void;
/** `fallbackSubagent` value that disables the fallback entirely (strict dispatch). */
export declare const NO_FALLBACK = "none";
/** Get the configured fallback agent type. undefined = general-purpose. */
export declare function getFallbackSubagent(): string | undefined;
/** Set the configured fallback agent type. undefined = general-purpose. */
export declare function setFallbackSubagent(v: string | undefined): void;
/**
 * Build a registry map: DEFAULT_AGENTS first (unless disabled via settings),
 * then user agents overlaid on top (same name overrides the default).
 * Pure — callers that must not disturb the process-wide registry (nested
 * delegation resolving agents from its own config root) build their own map.
 */
export declare function buildAgentRegistry(userAgents: Map<string, AgentConfig>, options?: {
    disableDefaults?: boolean;
}): Map<string, AgentConfig>;
/**
 * Register agents into the unified registry.
 * Starts with DEFAULT_AGENTS, then overlays user agents (overrides defaults with same name).
 * Disabled agents (enabled === false) are kept in the registry but excluded from spawning.
 */
export declare function registerAgents(userAgents: Map<string, AgentConfig>): void;
/** Resolve an exact, case-sensitive enabled type without fallback. */
export declare function resolveExactEnabledTypeIn(registry: Map<string, AgentConfig>, requested: string): string | undefined;
/** Resolve a type name case-insensitively in a registry. Returns the canonical key or undefined. */
export declare function resolveTypeIn(registry: Map<string, AgentConfig>, name: string): string | undefined;
/** Get the agent config for a type (case-insensitive) from a registry. */
export declare function getAgentConfigIn(registry: Map<string, AgentConfig>, name: string): AgentConfig | undefined;
/** Check if a type is valid and enabled (case-insensitive) in a registry. */
export declare function isValidTypeIn(registry: Map<string, AgentConfig>, type: string): boolean;
/** Get all enabled type names in a registry (for spawning and tool descriptions). */
export declare function getAvailableTypesIn(registry: Map<string, AgentConfig>): string[];
/**
 * The canonical key for a caller-supplied name that identifies exactly one
 * ENABLED agent, or undefined. Strict by construction: no fallback, no guessing
 * between case-variants. Nested delegation resolves with this directly, since
 * "unknown types are rejected rather than falling back" is its own contract.
 */
export declare function resolveEnabledTypeIn(registry: Map<string, AgentConfig>, requested: unknown): string | undefined;
/** Outcome of resolving a caller-supplied `subagent_type` into a spawnable type. */
export type SpawnTypeResolution =
/** Spawn this type. `fellBackFrom` is set when it isn't what the caller asked for. */
{
    ok: true;
    type: string;
    fellBackFrom?: string;
}
/** Refuse the spawn and return this message to the caller. */
 | {
    ok: false;
    message: string;
};
/**
 * Resolve a caller-supplied agent type against a registry, applying the
 * `fallbackSubagent` policy. The single decision point for every caller-supplied
 * spawn — the Agent tool, the scheduler, cross-extension RPC, and the nested
 * tools — so a type that fails here never reaches `runAgent`, where `getConfig`
 * would silently substitute general-purpose.
 *
 * Unknown, disabled, and case-ambiguous names are all treated the same way:
 * the caller named something that doesn't identify exactly one enabled agent.
 *
 * Pure over `registry` — callers that need fresh agent files reload before
 * calling (the Agent tool already does, per spawn). Reloading here would mean
 * importing custom-agents.ts, which imports this module.
 */
export declare function resolveSpawnTypeIn(registry: Map<string, AgentConfig>, requested: unknown): SpawnTypeResolution;
/** Resolve a caller-supplied agent type against the process-wide registry. */
export declare function resolveSpawnType(requested: unknown): SpawnTypeResolution;
/** Resolve a type name case-insensitively. Returns the canonical key or undefined. */
export declare function resolveType(name: string): string | undefined;
/** Get the agent config for a type (case-insensitive). */
export declare function getAgentConfig(name: string): AgentConfig | undefined;
/** Get all enabled type names (for spawning and tool descriptions). */
export declare function getAvailableTypes(): string[];
/** Get all type names including disabled (for UI listing). */
export declare function getAllTypes(): string[];
/** Get names of default agents currently in the registry. */
export declare function getDefaultAgentNames(): string[];
/** Get names of user-defined agents (non-defaults) currently in the registry. */
export declare function getUserAgentNames(): string[];
/** Check if a type is valid and enabled (case-insensitive). */
export declare function isValidType(type: string): boolean;
/**
 * Get memory tool names (read/write/edit) not already in the provided set.
 */
export declare function getMemoryToolNames(existingToolNames: Set<string>): string[];
/**
 * Get read-only memory tool names not already in the provided set.
 */
export declare function getReadOnlyMemoryToolNames(existingToolNames: Set<string>): string[];
/** Get built-in tool names for a type (case-insensitive). */
export declare function getToolNamesForType(type: string): string[];
/** Get config for a type (case-insensitive, returns a SubagentTypeConfig-compatible object). Falls back to general-purpose. */
export declare function getConfig(type: string): {
    displayName: string;
    color?: string;
    description: string;
    builtinToolNames: string[];
    extensions: true | string[] | false;
    excludeExtensions?: string[];
    skills: true | string[] | false;
    promptMode: "replace" | "append";
};
