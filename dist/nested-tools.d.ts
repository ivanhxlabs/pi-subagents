import type { Model } from "@earendil-works/pi-ai";
import { type AgentSession, type ExtensionAPI, type ExtensionContext, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { AgentInvocation, AgentRecord, IsolationMode, ThinkingLevel } from "./types.js";
export declare function getMaxSubagentDepth(): number;
export declare function setMaxSubagentDepth(n: number): void;
interface NestedSpawnOptions {
    description: string;
    model?: Model<any>;
    maxTurns?: number;
    isolated?: boolean;
    inheritContext?: boolean;
    thinkingLevel?: ThinkingLevel;
    isBackground?: boolean;
    isolation?: IsolationMode;
    invocation?: AgentInvocation;
    signal?: AbortSignal;
    onAssistantUsage?: (usage: {
        input: number;
        output: number;
        cacheWrite: number;
    }) => void;
    onSessionCreated?: (session: AgentSession) => void;
    depth: number;
    parentAgentId: string;
    maxSubagentDepth: number;
    configCwd?: string;
    rootSessionId?: string;
}
export interface NestedAgentManager {
    spawn(pi: ExtensionAPI, ctx: ExtensionContext, type: string, prompt: string, options: NestedSpawnOptions): string;
    /** Resolves once the spawned agent is running; rejects on a startup failure. */
    awaitStartup(id: string): Promise<void>;
    spawnAndWait(pi: ExtensionAPI, ctx: ExtensionContext, type: string, prompt: string, options: Omit<NestedSpawnOptions, "isBackground">,
    /** Fires synchronously after spawn, before the session exists — where the transcript is attached. */
    onSpawned?: (id: string) => void): Promise<{
        id: string;
        record: AgentRecord;
    }>;
    getRecord(id: string): AgentRecord | undefined;
    resume(id: string, prompt: string, signal?: AbortSignal): Promise<AgentRecord | undefined>;
}
export interface NestedToolContext {
    manager: NestedAgentManager;
    pi: ExtensionAPI;
    parentAgentId: string;
    depth: number;
    maxSubagentDepth: number;
    /** "all" = any enabled agent; string[] = only those types. Never empty. */
    allowedSubagents: "all" | string[];
    /** Root used for agent/config discovery; may differ from the agent's working directory. */
    configCwd: string;
}
/** Build child-safe orchestration tools scoped to one parent agent instance. */
export declare function createNestedSubagentTools(context: NestedToolContext): ToolDefinition[];
export {};
