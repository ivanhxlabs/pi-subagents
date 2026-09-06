/**
 * Reads `enabledModels` from pi's settings (global `<agentDir>/settings.json`
 * + project-local `<cwd>/.pi/settings.json`, project wins) and resolves
 * entries to concrete `provider/modelId` keys for scope validation.
 *
 * **Project overrides global**, mirroring pi's own `SettingsManager`
 * deep-merge behavior and matching the precedence we use for our own
 * `subagents.json` settings (see `src/settings.ts:loadSettings`). If
 * project file has `enabledModels` set, it wholly replaces global's
 * (array fields are replaced, not concatenated).
 *
 * **Limited subset of upstream's resolveModelScope.** We support exact
 * `provider/modelId` matching only. Upstream (pi-coding-agent's
 * `core/model-resolver.ts`) additionally supports glob patterns
 * (`*sonnet*`, `anthropic/*`), bare model IDs without provider, and
 * thinking-level suffixes (`provider/*:high`). Those forms are silently
 * ignored here.
 *
 * In practice, pi's `/scoped-models` picker writes exact `provider/modelId`
 * entries, so the limitation is invisible for users who configure scope
 * through pi's UI. Hand-edited settings using globs or bare IDs will
 * produce an empty allowed set (scope check becomes a no-op).
 *
 * Example:
 *   enabledModels = ["anthropic/claude-sonnet-4-6", "anthropic/claude-opus-4-6"]
 *   → resolves to { "anthropic/claude-sonnet-4-6", "anthropic/claude-opus-4-6" }
 */
/** Minimal registry shape — only the methods resolveEnabledModels actually calls. */
export interface ModelRegistryRef {
    getAll(): unknown[];
    getAvailable?(): unknown[];
}
/**
 * Read enabledModels from pi's settings — project-local overrides global.
 * Mirrors pi's SettingsManager deep-merge for the `enabledModels` field
 * (and matches our own loadSettings precedence in src/settings.ts).
 * Returns undefined when neither file has the field.
 */
export declare function readEnabledModels(cwd: string): string[] | undefined;
export declare function resolveEnabledModels(patterns: string[] | undefined, registry: ModelRegistryRef, cwd?: string): Set<string> | undefined;
/**
 * True when `model` is in the allowed set. Centralizes the key format
 * (`provider/id` lowercase) so callers don't have to reproduce it —
 * both set-building (resolveExact) and lookup go through `modelKey`.
 */
export declare function isModelInScope(model: {
    provider: string;
    id: string;
}, allowed: Set<string>): boolean;
