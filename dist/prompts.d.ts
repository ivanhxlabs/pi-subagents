/**
 * prompts.ts — System prompt builder for agents.
 */
import type { AgentConfig, EnvInfo } from "./types.js";
/** Extra sections to inject into the system prompt (memory, skills, etc.). */
export interface PromptExtras {
    /** Persistent memory content to inject (first 200 lines of MEMORY.md + instructions). */
    memoryBlock?: string;
    /** Preloaded skill contents to inject. */
    skillBlocks?: {
        name: string;
        content: string;
    }[];
    /**
     * Parent directory the worktree copy was created from. Set only for
     * `isolation: "worktree"` spawns — triggers the block that tells the agent
     * to stay in the copy.
     */
    worktreeBase?: string;
    /**
     * Set only for a workflow's own children, and only when they have no
     * `StructuredOutput` tool to answer through.
     *
     * A workflow child's final text is not read by a human — it is the value
     * `agent()` resolves to, and the script interpolates it straight into the
     * next stage's prompt. Without this, children answer the way every other
     * subagent does (a report addressed to a reader), and the padding becomes
     * input tokens for the stage downstream. Claude Code's `Workflow` tool
     * documents this contract to the script-writing model; this is the end of it
     * that makes the documentation true.
     *
     * Deliberately NOT applied to every subagent. In pi an ordinary agent's
     * output IS read by a human — through FleetView, the conversation viewer and
     * `get_subagent_result` — so terse raw data would be the wrong answer there.
     */
    workflowChild?: boolean;
}
/**
 * Build the system prompt for an agent from its config.
 *
 * - "replace" mode: env header + config.systemPrompt (full control, no parent identity)
 * - "append" mode: parent system prompt + sub-agent context + env header + config.systemPrompt
 * - "append" with empty systemPrompt: pure parent clone
 *
 * Both modes include an `<active_agent name="${config.name}"/>` tag so downstream
 * extensions (e.g. permission/policy systems) can resolve per-agent policy
 * inside the child session by parsing the system prompt. In replace mode the tag
 * is prepended; in append mode it follows the shared inherited content so the
 * parent prompt forms an identical, cacheable byte prefix with the parent
 * session (the LLM's KV cache can then reuse those tokens across every spawn).
 *
 * @param parentSystemPrompt  The parent agent's effective system prompt (for append mode).
 * @param extras  Optional extra sections to inject (memory, preloaded skills).
 */
export declare function buildAgentPrompt(config: AgentConfig, cwd: string, env: EnvInfo, parentSystemPrompt?: string, extras?: PromptExtras): string;
