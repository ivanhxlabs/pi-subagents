/**
 * pi-agents — A pi extension providing Claude Code-style autonomous sub-agents.
 *
 * Tools:
 *   Agent             — LLM-callable: spawn a sub-agent
 *   get_subagent_result  — LLM-callable: check background agent status/result
 *   steer_subagent       — LLM-callable: send a steering message to a running agent
 *
 * Commands:
 *   /agents                 — Interactive agent management menu
 */
import { type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Container } from "@earendil-works/pi-tui";
import { type AgentConfig } from "./types.js";
import { type Theme } from "./ui/agent-widget.js";
import { FOREIGN_WORKFLOW_TOOL_NAMES } from "./workflow/collisions.js";
import { WORKFLOW_ENTRY_TYPE, type WorkflowEntryData, workflowEntryData } from "./workflow/entry.js";
export declare function renderRunningAgentStatus(frame: string, statsText: string, activity: string, theme: Pick<Theme, "fg">): Container;
/**
 * Format an agent's tool scope for the Agent tool description.
 *
 * This suffix describes BUILT-IN scope only — extension tools are resolved when
 * the agent runs (extensions can register asynchronously), so they cannot be
 * enumerated while the description is being built. That is why an agent with
 * `tools: "*, ext:mcp/search"` renders "*" and always has.
 *
 * Two distinctions matter, both of them capability claims the orchestrator acts on:
 *
 * - absent vs empty. `builtinToolNames: undefined` means the agent never narrowed
 *   its tools (the shipped defaults); `[]` is what `tools: none` and an `ext:`-only
 *   `tools:` parse to, and the runtime really does hand those agents no built-ins.
 *   Rendering both "*" tells the orchestrator a tool-less agent can run `bash`.
 * - empty-with-extensions vs empty-without. Zero built-ins does NOT imply zero
 *   tools: `tools: none` alongside `extensions:` still surfaces every extension
 *   tool (see test/fixtures/.pi/agents/tools-none.md, which expects three). Calling
 *   that "none" understates the agent instead of overstating it — better, but still
 *   wrong, and it would route work away from the only agent able to do it. "none"
 *   is therefore reserved for agents that genuinely can call nothing: `isolated`
 *   agents and those with `extensions: false`.
 */
export declare function formatToolsSuffix(cfg: AgentConfig | undefined): string;
/** CLI flag that runs a workflow script at session start. */
export declare const WORKFLOW_FILE_FLAG = "subagents-workflow-file";
/**
 * Re-exported from where they now live, because this is where they were
 * defined and a consumer (or a test) that matched a session entry on
 * {@link WORKFLOW_ENTRY_TYPE} imports it from here.
 */
export { FOREIGN_WORKFLOW_TOOL_NAMES, WORKFLOW_ENTRY_TYPE, type WorkflowEntryData, workflowEntryData };
export default function (pi: ExtensionAPI): void;
