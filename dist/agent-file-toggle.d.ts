/**
 * agent-file-toggle.ts — Pure helpers for the `/agents` file-editing operations:
 * locating an agent's .md file, toggling its `enabled:` frontmatter flag, and
 * serializing an AgentConfig back to frontmatter for eject.
 *
 * These live outside src/index.ts so they can be tested directly: the `/agents`
 * command handler is an ~890-line closure reached only through `registerCommand`,
 * which every test mocks.
 *
 * The read side of this data (src/custom-agents.ts) parses frontmatter with a
 * real YAML parser, so it honors `enabled: false` at any position in the block.
 * This module must agree with it, and splits the work accordingly:
 *
 * - Deciding whether a file is disabled is a *read*, so it calls that same parser
 *   (`isDisabledContent`) instead of mirroring it. A mirror has to be right about
 *   YAML's boolean spellings and about pi's fence scan, and a regex was wrong
 *   about both.
 * - *Editing* cannot go through the parser, because re-serializing a parsed
 *   document would reformat a file the README tells users to hand-author —
 *   discarding their comments, key order, and quoting. So the edits are line-wise
 *   and preserve everything they don't touch.
 *
 * That leaves removal best-effort: it recognizes a lowercase bare `false`, and
 * reports `changed: false` for the spellings it cannot rewrite, so the caller
 * refuses honestly rather than announcing a change it did not make.
 */
import type { AgentConfig } from "./types.js";
export type AgentFileLocation = "project" | "workspace" | "personal";
export declare const projectAgentsDir: (cwd?: string) => string;
export declare const workspaceAgentsDir: (cwd?: string) => string;
export declare const personalAgentsDir: () => string;
/**
 * Find the file path of a custom agent by name, in discovery-precedence order
 * (project, workspace, then global). Mirrors the load-side precedence in
 * src/custom-agents.ts — if the two drift, `/agents` edits a file the loader
 * isn't reading.
 */
export declare function findAgentFile(name: string, cwd?: string): {
    path: string;
    location: AgentFileLocation;
} | undefined;
/**
 * Find the file behind a *loaded* agent, preferring the path the loader
 * actually read (`AgentConfig.sourcePath`) over the `<type>.md` guess.
 *
 * An agent's type comes from its frontmatter `name:` now, so the two can
 * disagree: `reviewer.md` declaring `name: code-reviewer` is loaded as
 * `code-reviewer`, and probing for `code-reviewer.md` finds nothing. That is
 * not a harmless miss — `/agents → Disable` would then take the no-file branch
 * and write a NEW `code-reviewer.md` stub, which loses to `reviewer.md` on
 * load, leaving the agent enabled while reporting success.
 *
 * The probe stays as the fallback: a built-in that was never ejected has no
 * `sourcePath`, and a path can go stale between a load and this call.
 */
export declare function locateAgentFile(name: string, sourcePath: string | undefined, cwd?: string): {
    path: string;
    location: AgentFileLocation;
} | undefined;
export type DisableOutcome = "disabled" | "already-disabled" | "no-frontmatter";
/**
 * Does the loader consider this file disabled?
 *
 * Detection is a READ operation, so it asks the same parser the loader uses
 * rather than mirroring it with a regex — that mirror has to be right about
 * YAML's boolean spellings (`False`, `FALSE`, a trailing `# comment`, a quoted
 * key) *and* about pi's fence scan, which closes the block on any line starting
 * `---` and so ends it early on `----`. A throw means the file is already
 * unparseable, which is what the loader sees too: it skips the agent, so there
 * is no "disabled" state to report.
 */
export declare function isDisabledContent(content: string): boolean;
/**
 * Add `enabled: false` to a file's frontmatter.
 *
 * `outcome` distinguishes a real edit from a no-op so the caller can report
 * honestly instead of unconditionally claiming success.
 */
export declare function disableInContent(content: string): {
    content: string;
    outcome: DisableOutcome;
};
/**
 * Remove `enabled: false` from a file's frontmatter, wherever it appears in the
 * block — the loader honors the key at any position, so the two must agree or a
 * hand-authored agent can be disabled and never re-enabled.
 *
 * `changed` is false when the key wasn't found, so the caller can avoid
 * reporting "Enabled <name>" for a write that did nothing.
 */
export declare function enableInContent(content: string): {
    content: string;
    changed: boolean;
};
/** Is this the empty stub `/agents` writes when disabling a built-in default? */
export declare function isEmptyStub(content: string): boolean;
/** The answers `/agents → Create agent → Manual` collects, before serialization. */
export interface NewAgentInput {
    description: string;
    /** Already-resolved `tools:` value ("none", "all", or a CSV of tool names). */
    tools: string;
    /** `provider/modelId`, or undefined to inherit the parent's model. */
    model?: string;
    /** A pi thinking level, or undefined to inherit. */
    thinking?: string;
    systemPrompt: string;
}
/**
 * Build the .md file the create wizard writes.
 *
 * `description` and `model` come straight from a free-text prompt, so they are
 * quoted rather than interpolated — `serializeAgentFile` above quotes the
 * description for the same reason. An unquoted YAML scalar mishandles ordinary
 * input in two ways, and both are silent: a colon ("Scout: find things") makes
 * the file unparseable, and since #212 an unparseable agent file is *skipped*,
 * so the wizard reports success for an agent that does not exist; a `#`
 * ("audit #security") opens a comment and truncates the value. `model` can
 * carry a colon too — pi accepts a `provider/model:thinking` suffix.
 *
 * `tools` and `thinking` are not quoted: both are chosen from fixed menus, and
 * `tools` is a CSV that must stay a bare scalar for the loader's parser.
 */
export declare function buildNewAgentFile(input: NewAgentInput): string;
/** Serialize an AgentConfig to a full .md file (frontmatter + system prompt) for eject. */
export declare function serializeAgentFile(cfg: AgentConfig): string;
