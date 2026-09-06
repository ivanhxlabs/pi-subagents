/**
 * abortable.ts — race a promise against an AbortSignal without cancelling the
 * underlying work.
 *
 * Used by the `get_subagent_result` wait paths (top-level and nested): pressing
 * Esc cancels only the caller's wait; the background child keeps running and its
 * result stays unconsumed. The listener is removed on every settle path so the
 * signal accumulates no handlers, and a late settlement of the wrapped promise
 * after an abort is absorbed as a no-op (no unhandled rejection).
 */
/** Await a promise until it settles or the caller cancels, without aborting the underlying work. */
export declare function abortable<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T>;
