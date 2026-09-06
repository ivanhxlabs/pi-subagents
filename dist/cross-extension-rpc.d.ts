/**
 * Cross-extension RPC handlers for the subagents extension.
 *
 * Exposes ping, spawn, stop, and consume RPCs over the pi.events event bus,
 * using per-request scoped reply channels.
 *
 * Reply envelope follows pi-mono convention:
 *   success → { success: true, data?: T }
 *   error   → { success: false, error: string }
 *
 * @see docs/rpc.md — the caller-facing integration reference: spawn options
 * (including the fields spawnTopLevel strips), every error string, the
 * completion-notification race, and what protocol version 2 does not promise.
 */
import type { AgentRecord } from "./types.js";
/** Minimal event bus interface needed by the RPC handlers. */
export interface EventBus {
    on(event: string, handler: (data: unknown) => void): () => void;
    emit(event: string, data: unknown): void;
}
/** RPC reply envelope — matches pi-mono's RpcResponse shape. */
export type RpcReply<T = void> = {
    success: true;
    data?: T;
} | {
    success: false;
    error: string;
};
/** RPC protocol version — bumped when the envelope or method contracts change. */
export declare const PROTOCOL_VERSION = 2;
/** Minimal AgentManager interface needed by the spawn/stop/consume RPCs. */
export interface SpawnCapable {
    spawn(pi: unknown, ctx: unknown, type: string, prompt: string, options: any): string;
    /** Resolves once the spawned agent is running; rejects on a startup failure. */
    awaitStartup(id: string): Promise<void>;
    abort(id: string): boolean;
    /**
     * The record behind an id, for the stop handler's ownership check. Narrowed
     * to the two fields `isTopLevelAgent` reads, so the RPC layer keeps its
     * deliberately shallow view of the manager.
     */
    getRecord(id: string): Pick<AgentRecord, "parentAgentId" | "workflowId"> | undefined;
    /**
     * Mark a settled agent's result as read by the caller, suppressing the
     * completion notification — what `get_subagent_result` does when it returns
     * one. False when there is no such agent, or it has not settled yet.
     */
    consumeResult(id: string): boolean;
}
export interface RpcDeps {
    events: EventBus;
    pi: unknown;
    getCtx: () => unknown | undefined;
    manager: SpawnCapable;
}
export interface RpcHandle {
    unsubPing: () => void;
    unsubSpawn: () => void;
    unsubStop: () => void;
    unsubConsume: () => void;
}
/**
 * Register ping, spawn, stop, and consume RPC handlers on the event bus.
 * Returns unsub functions for cleanup.
 */
export declare function registerRpcHandlers(deps: RpcDeps): RpcHandle;
