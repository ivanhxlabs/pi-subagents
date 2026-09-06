/**
 * output-file.ts — Streaming JSONL output file for agent transcripts.
 *
 * Creates a per-agent output file that streams conversation turns as JSONL,
 * matching Claude Code's task output file format.
 */
import type { AgentSession } from "@earendil-works/pi-coding-agent";
export declare function getOutputTranscriptDefault(): boolean;
export declare function setOutputTranscriptDefault(b: boolean): void;
/**
 * Encode a cwd path as a filesystem-safe directory name. Handles:
 *   - POSIX:   "/home/user/project"        → "home-user-project"
 *   - Windows: "C:\Users\foo\project"      → "Users-foo-project"
 *   - UNC:     "\\\\server\\share\\project"  → "server-share-project"
 */
export declare function encodeCwd(cwd: string): string;
/**
 * The per-session scratch directory, created if missing.
 * Mirrors Claude Code's layout: /tmp/{prefix}-{uid}/{encoded-cwd}/{sessionId}/tasks
 *
 * Shared with the workflow tool, which persists each invocation's script here so
 * iterating on one is edit-file-then-rerun — the same convention, one directory.
 */
export declare function sessionTaskDir(cwd: string, sessionId: string): string;
/** Create the output file path, ensuring the directory exists. */
export declare function createOutputFilePath(cwd: string, agentId: string, sessionId: string): string;
/**
 * Ensure a transcript file exists without disturbing what is already in it.
 *
 * A resume reuses the agent's existing transcript (same deterministic path), so
 * it must never call `writeInitialEntry` — that truncates, discarding turns the
 * completion notification still points the user at, and any history the session
 * has since compacted away is gone for good. Appending nothing creates the file
 * when this is the agent's first transcript and is a no-op when it is not.
 */
export declare function ensureOutputFile(path: string): void;
/** Write the initial user prompt entry. */
export declare function writeInitialEntry(path: string, agentId: string, prompt: string, cwd: string): void;
/**
 * Subscribe to session events and flush new messages to the output file on each turn_end.
 * Returns a cleanup function that does a final flush and unsubscribes.
 */
export declare function streamToOutputFile(session: AgentSession, path: string, agentId: string, cwd: string, startIndex?: number): () => void;
