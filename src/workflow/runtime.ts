/**
 * runtime.ts — the host half of a workflow run.
 *
 * Owns the worker lifecycle, the RPC bridge, the concurrency semaphore, the
 * per-run caps, and the progress log. The script's only route to an agent is a
 * `call` message landing here, which is what makes the caps and the abort story
 * enforceable at all: a script cannot go around them because it has nothing to
 * go around them *with*.
 *
 * Spawning is injected rather than imported. `AgentManager` is a large, stateful
 * dependency and wiring it in directly would make every test here an integration
 * test; a {@link WorkflowHost} stub is a dozen lines. The adapter that binds this
 * to the real manager lives at the call site.
 */

import { randomUUID } from "node:crypto";
import { cpus } from "node:os";
import { Worker } from "node:worker_threads";
import { isExactQualifiedModelId } from "../model-resolver.js";
import {
  canAdvanceStrictRoute,
  emptyStrictExecutionEvidence,
  STRICT_AGENT_CONTRACT_VERSION,
  STRICT_EFFORT_LEVELS,
  type StrictAttemptReceipt,
  type StrictContractFailure,
  type StrictContractFailureCode,
  type StrictEffort,
  type StrictExecutionEvidence,
  type StrictFailure,
  type StrictRouteResult,
} from "../strict-agent.js";
import { sanitizeStrictDiagnostic } from "../strict-diagnostics.js";
import {
  type JournalKeyInput,
  journalKey,
  strictJournalKey,
  type WorkflowJournalEntry,
} from "./journal.js";
import { type CompiledSchema, compileJsonSchema } from "./json-schema.js";
import { extractMeta, type WorkflowMeta } from "./meta.js";
import type { WorkflowAgentEntry, WorkflowEntry } from "./progress.js";
import { WORKER_SOURCE } from "./worker-source.js";

/** Matches the `script` field's `maxLength` in the tool schema. */
export const MAX_SCRIPT_LENGTH = 524_288;

/** Agents one run may schedule, in total. */
export const WORKFLOW_AGENT_CAP = 1000;

/** Items one `parallel()` or `pipeline()` call may take. */
export const WORKFLOW_ITEM_CAP = 4096;

/** Nested `workflow()` invocations allowed per run. */
export const WORKFLOW_NESTED_CAP = 256;

/** How much of a prompt or result is kept for the UI. */
const PREVIEW_LENGTH = 200;

export class WorkflowRuntimeError extends Error {}

/**
 * Concurrent agents allowed, leaving two cores for the host and the TUI.
 *
 * `Math.max(1, …)` is not decoration: the raw `min(16, cpus - 2)` is 0 on a one-
 * or two-core machine, and a semaphore with zero permits never hands out a slot,
 * so the run would hang before its first agent rather than fail.
 */
export function workflowConcurrency(cpuCount: number = cpus().length): number {
  return Math.max(1, Math.min(16, cpuCount - 2));
}

/** One agent the script asked for. `agentId` is the handle for {@link WorkflowHost.abortAgent}. */
export interface WorkflowSpawnRequest {
  agentId: string;
  /** Position in the run, and the progress entry's stable identity. */
  index: number;
  prompt: string;
  label: string;
  agentType: string;
  model?: string;
  /**
   * Reasoning effort for this child, as one of pi's thinking levels.
   *
   * Typed as a plain string because this interface is the host boundary and
   * deliberately knows nothing about pi — `host.ts` is where it becomes a
   * `ThinkingLevel`. The worker has already rejected anything off the list.
   */
  effort?: string;
  isolation?: "worktree";
  /**
   * Called by the host once the child's EFFECTIVE configuration is known —
   * which is when its session exists, not when the spawn resolves.
   *
   * Without it a row could only ever show what the script asked for: a fuzzy
   * `model: "haiku"` stays `haiku` instead of the id it resolved to, an
   * `agent()` that named no model shows nothing at all, and a level pi clamped
   * is presented as the level that was requested (#168, #182).
   *
   * Plain strings, like `effort` above: this interface is the host boundary and
   * deliberately knows nothing about pi's `AgentInvocation`. Optional, so a host
   * that cannot report any of this simply does not, and the row keeps the
   * requested values it started with.
   */
  onResolved?(info: {
    /**
     * The host's own id for the child — the manager's `AgentRecord` id here.
     *
     * Reported as soon as the host has one, which is earlier than the rest of
     * this: the model is knowable only once a session exists, but the id is
     * what lets a reader open that child's conversation, and a child that
     * never got a model is exactly the one worth opening.
     */
    recordId?: string;
    modelName?: string;
    modelId?: string;
    thinking?: string;
    requestedThinking?: string;
    requestedModel?: string;
  }): void;
  /**
   * Compiled from the script's `agent({ schema })`.
   *
   * The host must give the child a `StructuredOutput` tool built from it and
   * return the validated payload as JSON text. Compiled rather than raw so the
   * runtime can re-check the answer without re-parsing the schema per call.
   */
  schema?: CompiledSchema;
  phaseIndex?: number;
  phaseTitle?: string;
  /**
   * The `gate` command this agent is being spawned under, when it has one.
   *
   * Passed down rather than run purely from here because an isolated child's
   * worktree is destroyed as part of its own settle: a host that can reach
   * inside that settle runs the gate there, against the tree the child wrote,
   * and reports the outcome back as {@link WorkflowSpawnResult.gate}. A host
   * that ignores this leaves the gate to {@link applyGate}, which then runs it
   * itself — so exactly one execution either way.
   */
  gate?: string;
}

export interface WorkflowStrictAgentRequest {
  contractVersion: typeof STRICT_AGENT_CONTRACT_VERSION;
  prompt: string;
  agentType: string;
  model: string;
  fallbackModels: string[];
  effort: StrictEffort;
  isolation?: "worktree";
  schema?: CompiledSchema;
  phaseIndex?: number;
  phaseTitle?: string;
}

export type WorkflowStrictValidationResult =
  | { ok: true; agentType: string; isolation?: "worktree" }
  | { ok: false; failure: StrictFailure<StrictContractFailureCode> };

export interface WorkflowStrictAttemptRequest {
  launchId: string;
  attemptId: string;
  agentId: string;
  candidateIndex: number;
  prompt: string;
  agentType: string;
  model: string;
  effort: StrictEffort;
  isolation?: "worktree";
  schema?: CompiledSchema;
  /** Record/session observations are reported while the attempt is live. */
  onResolved?(info: {
    recordId?: string;
    modelName?: string;
    modelId?: string;
    thinking?: string;
  }): void;
  /** Monotonic runtime evidence, reported at each execution boundary/event. */
  onEvidence?(evidence: StrictExecutionEvidence): void;
}

export interface WorkflowStrictAttemptResult {
  attempt: StrictAttemptReceipt;
  /** Child output. Present only when the attempt was selected. */
  text?: string;
  tokens?: number;
  outputTokens?: number;
  toolCalls?: number;
}

export interface WorkflowSpawnResult {
  ok: boolean;
  /** The agent's answer. Present when `ok`. */
  text?: string;
  /** Why it failed. Present when not `ok`. */
  error?: string;
  /** The user dismissed it rather than it failing; renders as skipped. */
  skipped?: boolean;
  tokens?: number;
  /**
   * Output tokens only, for the script's `budget.spent()`.
   *
   * Separate from {@link tokens}, which is the lifetime total. Claude Code's
   * budget counts output, and a fan-out's re-sent input would swamp it.
   */
  outputTokens?: number;
  /** Whether the child needed an extra prompt to produce its structured answer. */
  structuredRetried?: boolean;
  toolCalls?: number;
  /**
   * Where the child actually ran.
   *
   * Only meaningful for `isolation: "worktree"`, and the whole reason it exists:
   * a gate has to run against the tree the child edited, not the main one, or it
   * verifies the wrong working copy. Left unset, a gate runs wherever the host
   * runs commands by default.
   *
   * Usually unset for a worktree child even so: the copy is removed during the
   * child's own settle, so it no longer exists by the time this is read. That
   * is what {@link gate} is for.
   */
  cwd?: string;
  /**
   * The outcome of this agent's `gate`, when the host already ran it.
   *
   * Set only by a host that ran the command itself — inside the child's
   * worktree, while that directory still existed. Its presence is what tells
   * {@link applyGate} the command has already been executed; the pass/fail
   * decision and the error shaping still happen there, in one place.
   */
  gate?: WorkflowGateResult;
}

/** Outcome of a `gate` command. `output` is what the user is shown when it fails. */
export interface WorkflowGateResult {
  ok: boolean;
  /** Combined stdout/stderr, or whatever the host wants surfaced as the failure. */
  output: string;
}

/** The one seam between a workflow and the rest of the extension. */
/** How a script names another workflow: a saved name, or a path to a file. */
export interface WorkflowScriptRef {
  name?: string;
  scriptPath?: string;
}

export type WorkflowScriptSource =
  | { ok: true; script: string; path?: string }
  | { ok: false; message: string };

export interface WorkflowHost {
  spawnAgent(request: WorkflowSpawnRequest): Promise<WorkflowSpawnResult>;
  /** Validate strict-only capabilities and exact role dispatch before a launch id exists. */
  validateStrictAgent?(request: WorkflowStrictAgentRequest): WorkflowStrictValidationResult;
  /** Execute one fresh strict candidate attempt. The runtime owns route advancement. */
  spawnStrictAttempt?(request: WorkflowStrictAttemptRequest): Promise<WorkflowStrictAttemptResult>;
  /** Called for every in-flight agent when the run aborts. */
  abortAgent(agentId: string): void;
  /**
   * Continue a child that already ran in this run, keeping its context.
   *
   * `agentId` is one previously handed out in a {@link WorkflowSpawnRequest};
   * the child keeps the agent type, model and tool contract it started with, so
   * only the follow-up prompt crosses.
   *
   * Optional: a host without it rejects `resume` rather than quietly starting a
   * fresh child that has none of the context the script is counting on.
   */
  resumeAgent?(
    agentId: string,
    prompt: string,
    /**
     * Same reporter {@link WorkflowSpawnRequest.onResolved} carries, for the
     * same reason: a resumed row is rebuilt from scratch, so without it the
     * continuation of a child would show the model the script *asked* for while
     * the row above it shows the one that ran.
     */
    onResolved?: WorkflowSpawnRequest["onResolved"],
  ): Promise<WorkflowSpawnResult>;
  /**
   * Run a `gate` command and report whether it passed.
   *
   * `cwd` is the child's worktree when it had one. Optional for the same reason
   * as {@link resumeAgent}, and more sharply: a gate that silently does not run
   * would mark unverified work as verified, so the runtime fails the call
   * instead of skipping it.
   */
  runGate?(command: string, options: { agentId: string; cwd?: string }): Promise<WorkflowGateResult>;
  /**
   * Resolve a nested `workflow()` reference to source.
   *
   * The runtime knows nothing about the filesystem or about pi, so it asks. It
   * still decides whether what comes back *is* a workflow — see
   * {@link validateScript} — because those rules belong with the runtime that
   * enforces them everywhere else.
   *
   * Optional for the same reason as {@link resumeAgent}: a host without it
   * rejects `workflow()` outright rather than silently running nothing.
   */
  loadWorkflow?(ref: WorkflowScriptRef): Promise<WorkflowScriptSource> | WorkflowScriptSource;
}

/**
 * What a run can be told to do while it is going, from the workflows dialog.
 *
 * Every method is best-effort and idempotent: the dialog renders off a progress
 * log that lags the runtime slightly, so it will sometimes ask for something
 * that has just stopped being possible. `false` means "there was nothing to do
 * that to" — a caller can say so, but it is never an error.
 */
export interface WorkflowControl {
  /**
   * Stop *starting* agents. Ones already running are left to finish, because
   * killing model work mid-turn throws away everything it has spent and there
   * is no way to hand it back its context.
   */
  pause(): void;
  resume(): void;
  isPaused(): boolean;
  /**
   * Give up on the agent at `index`: its `agent()` call returns `null`, exactly
   * as a terminal failure does, and the row renders skipped.
   *
   * Immediate for a running agent and for one held at a pause. An agent parked
   * behind the concurrency limit takes its skip when it reaches the front —
   * the alternative is a cancellable semaphore for a case that resolves itself
   * as soon as any sibling finishes.
   */
  skip(index: number): boolean;
  /**
   * Start the agent at `index` over: the child is stopped and the same call is
   * re-run, so the script's `agent()` promise is still the one waiting and it
   * gets the new answer.
   *
   * Only while it is running — that is the whole window. Once the call has
   * settled its value is already the script's, and re-running would produce a
   * result with nowhere to go.
   */
  retry(index: number): boolean;
}

export interface RunWorkflowOptions {
  /** Full script source, starting with `export const meta = { … }`. */
  script: string;
  args?: unknown;
  host: WorkflowHost;
  signal?: AbortSignal;
  /** Fired per batch, not per entry — see the worker's progress batching. */
  onProgress?(entries: readonly WorkflowEntry[]): void;
  concurrency?: number;
  agentCap?: number;
  itemCap?: number;
  /**
   * Hands the caller the run's control surface, once per run.
   *
   * A callback rather than a return value because `runWorkflow` resolves when
   * the run is *over*, which is the one moment there is nothing left to
   * control. Fired before the first agent starts.
   */
  onControl?(control: WorkflowControl): void;
  /**
   * How many nested `workflow()` invocations one run may make in total.
   *
   * Each costs a compile and a scope rather than a thread, so the ceiling is
   * generous — but unbounded is worse than capped, on the same reasoning as
   * {@link agentCap}.
   */
  nestedCap?: number;
  /**
   * Replay and record, for `resumeFromRunId`.
   *
   * The runtime does no file IO — `entries` come in already read and `append`
   * goes back out — so its tests stay free of a filesystem, the same reason
   * spawning is behind {@link WorkflowHost}.
   */
  journal?: {
    /** A previous run's settled calls, in position order. Empty replays nothing. */
    entries?: readonly WorkflowJournalEntry[];
    /** Called as each call of *this* run settles, so it can be resumed in turn. */
    append?(entry: WorkflowJournalEntry): void;
  };
}

export interface WorkflowRunResult {
  status: "completed" | "failed" | "killed";
  meta: WorkflowMeta;
  /** The script's return value, JSON-checked at the boundary. */
  value?: unknown;
  error?: string;
  /** The append-only log, in emission order. */
  progress: WorkflowEntry[];
  /** Agents scheduled, including those that failed. */
  agentCount: number;
  /** How many of those came back from the journal instead of being spawned. */
  replayedCount: number;
}

/* ------------------------------------------------------------------------- *
 * JSON boundary — host side
 * ------------------------------------------------------------------------- */

function boundaryError(what: string, path: string): WorkflowRuntimeError {
  return new WorkflowRuntimeError(
    `Cannot pass ${what} across the workflow VM boundary (at ${path}).`,
  );
}

function walk(value: unknown, path: string, seen: Set<object>): void {
  if (value === null) return;
  const kind = typeof value;
  if (kind === "string" || kind === "boolean") return;
  if (kind === "number") {
    if (!Number.isFinite(value)) throw boundaryError("a non-finite number", path);
    return;
  }
  if (kind === "undefined") {
    if (path === "args") return;
    throw boundaryError("undefined", path);
  }
  if (kind === "bigint") throw boundaryError("a BigInt", path);
  if (kind === "symbol") throw boundaryError("a symbol", path);
  if (kind === "function") throw boundaryError("a function", path);
  if (kind !== "object") throw boundaryError(`a ${kind}`, path);

  const object = value as object;
  if (seen.has(object)) throw boundaryError("a circular structure", path);
  seen.add(object);

  if (Object.getOwnPropertySymbols(object).length > 0) {
    throw boundaryError("an object with symbol keys", path);
  }

  if (Array.isArray(object)) {
    for (let i = 0; i < object.length; i++) {
      if (!Object.hasOwn(object, i)) throw boundaryError("a sparse array", `${path}[${i}]`);
      walk(object[i], `${path}[${i}]`, seen);
    }
    seen.delete(object);
    return;
  }

  const prototype = Object.getPrototypeOf(object);
  if (prototype !== null && prototype !== Object.prototype) {
    throw boundaryError("a non-plain object", path);
  }
  for (const [key, entry] of Object.entries(object)) {
    walk(entry, `${path}.${key}`, seen);
  }
  seen.delete(object);
}

/**
 * Reject anything that cannot survive the round trip to the worker and into a
 * resume journal. Structured clone would happily carry a `Map` or a cycle that
 * the journal then cannot represent, so the check is stricter than the transport.
 */
export function assertBoundarySafe(value: unknown, path: string): void {
  walk(value, path, new Set());
}

/* ------------------------------------------------------------------------- *
 * Semaphore
 * ------------------------------------------------------------------------- */

class Semaphore {
  private active = 0;
  private readonly waiters: (() => void)[] = [];

  constructor(private readonly limit: number) {}

  acquire(): Promise<void> {
    if (this.active < this.limit) {
      this.active++;
      return Promise.resolve();
    }
    return new Promise<void>(resolve => {
      this.waiters.push(resolve);
    });
  }

  release(): void {
    const next = this.waiters.shift();
    // Hand the permit straight over rather than decrementing and re-acquiring;
    // otherwise a burst of releases can let more than `limit` through.
    if (next) next();
    else this.active--;
  }

  /** Wake everyone so aborted callers can observe the abort and bail. */
  drain(): void {
    while (this.waiters.length > 0) {
      const next = this.waiters.shift();
      next?.();
    }
  }
}

/* ------------------------------------------------------------------------- *
 * Messages
 * ------------------------------------------------------------------------- */

interface StrictAgentCallPayload {
  contractVersion: typeof STRICT_AGENT_CONTRACT_VERSION;
  prompt: string;
  agentType: string;
  model: string;
  fallbackModels: string[];
  effort: StrictEffort;
  isolation?: "worktree";
  phaseIndex?: number;
  phaseTitle?: string;
  schema?: unknown;
}

interface AgentCallPayload {
  prompt: string;
  label?: string;
  model?: string;
  agentType?: string;
  isolation?: "worktree";
  phaseIndex?: number;
  phaseTitle?: string;
  /** Shell command that has to pass before the agent counts as done. */
  gate?: string;
  /** Label of an earlier child in this run to continue instead of starting one. */
  resume?: string;
  /** Reasoning effort, already validated against pi's thinking levels worker-side. */
  effort?: string;
  /** Raw JSON Schema from `agent({ schema })`, compiled before anything spawns. */
  schema?: unknown;
}

type WorkerMessage =
  | { type: "call"; callId: number; method: string; payload: AgentCallPayload | StrictAgentCallPayload | WorkflowScriptRef }
  | { type: "progress"; entries: WorkflowEntry[] }
  | { type: "complete"; resultJson?: string }
  | { type: "error"; message: string; stack?: string };

/** Everything below 0x20 except tab, newline and carriage return, plus DEL. */
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

const preview = (text: string) =>
  text.length <= PREVIEW_LENGTH ? text : `${text.slice(0, PREVIEW_LENGTH - 1)}…`;

/** First line of the prompt, trimmed — the fallback display name for an agent. */
function derivedLabel(prompt: string): string {
  const line = prompt.split("\n", 1)[0].trim();
  return line.length <= 60 ? line || "agent" : `${line.slice(0, 59)}…`;
}

function strictContractFailure(
  code: StrictContractFailureCode,
  message: string,
): StrictContractFailure {
  return { contractError: { code, message: sanitizeStrictDiagnostic(message) } };
}

function strictLaunchId(): string {
  return `strict_${randomUUID().replaceAll("-", "").slice(0, 16)}`;
}

/**
 * A child `resume` can revive, remembered under its label.
 *
 * The spawn options travel with it because `resume` deliberately takes none: the
 * revived child keeps the agent type, model and isolation it was started with,
 * and the progress entry has to show the same thing the first entry showed.
 */
interface CompletedChild {
  agentId: string;
  label: string;
  agentType: string;
  model?: string;
  isolation?: "worktree";
}

/**
 * Turn a failing gate into a failing agent.
 *
 * Deliberately no new state, no new entry type: a gated agent whose command
 * fails is *a failed agent*, so the card, the dialog and `agent()`'s `null`
 * return all handle it with the code they already have. The command output
 * becomes the error, because that is the thing worth reading.
 *
 * The single place that decides whether a gate passed. The command may have
 * been run by the host instead (inside a worktree that no longer exists by
 * now), but only ever by one of the two: a host that ran it says so with
 * `result.gate`, and this then shapes that outcome rather than running it
 * again.
 */
/**
 * Hold a schema'd result to its schema, host-side.
 *
 * The child's own tool already validated whatever it passed, so this normally
 * agrees. It exists for the cases where nothing did: a host that ignores
 * `schema` entirely, a replayed journal entry from before the schema changed,
 * or a payload that reached us some other way. The script asked for a shape;
 * exactly one place should be able to promise it.
 */
function applySchema(result: WorkflowSpawnResult, compiled: CompiledSchema): WorkflowSpawnResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(result.text ?? "");
  } catch {
    return {
      ...result,
      ok: false,
      error: "The agent did not return structured output: its answer was not JSON.",
    };
  }
  const verdict = compiled.check(parsed);
  if (verdict === true) return result;
  return {
    ...result,
    ok: false,
    error: `The agent's answer did not match the requested schema: ${verdict}`,
  };
}

async function applyGate(
  result: WorkflowSpawnResult,
  command: string,
  agentId: string,
  runGate: NonNullable<WorkflowHost["runGate"]>,
): Promise<WorkflowSpawnResult> {
  const outcome =
    result.gate ??
    (await runGate(command, {
      agentId,
      // Where the child worked, when it had a worktree of its own. Gating the
      // main tree instead would verify code the child never touched.
      ...(result.cwd !== undefined ? { cwd: result.cwd } : {}),
    }));
  const { gate: _ran, ...kept } = result;
  if (outcome.ok) return kept;
  const { text: _discarded, ...rest } = kept;
  const output = outcome.output.trim();
  return { ...rest, ok: false, error: output === "" ? `Gate command failed: ${command}` : output };
}

/**
 * Nico's wording, kept verbatim — this is the one borrowed check whose message a
 * user is likely to search for.
 */
function unawaitedLaunchMessage(labels: readonly string[]): string {
  const list = labels.map(label => `'${label}'`).join(", ");
  return `workflow script completed with unawaited agent launch(es): ${list}. Await or return each launch.`;
}

/**
 * Run one workflow script to completion.
 *
 * Rejects before starting for a script that cannot run at all (bad `meta`, over
 * the size limit, control characters, non-JSON `args`). Everything after the
 * worker is live resolves instead, carrying the failure in `status` — by then
 * there is a progress log worth handing back.
 */
/**
 * Everything a script must satisfy before it is compiled.
 *
 * Extracted so a nested `workflow()` is held to exactly the same standard as a
 * top-level run: same size limit, same character rules, same `meta` contract.
 * The host resolves a reference to source; deciding whether that source is a
 * workflow stays here, where the rules live.
 */
export function validateScript(script: string): { meta: WorkflowMeta; body: string } {
  if (script.length > MAX_SCRIPT_LENGTH) {
    throw new WorkflowRuntimeError(
      `Workflow script is ${script.length} characters, over the limit of ${MAX_SCRIPT_LENGTH}.`,
    );
  }
  if (CONTROL_CHARACTERS.test(script)) {
    throw new WorkflowRuntimeError(
      "Workflow script contains control characters. Only tab, carriage return and newline are allowed.",
    );
  }
  return extractMeta(script);
}

export async function runWorkflow(options: RunWorkflowOptions): Promise<WorkflowRunResult> {
  const { script, host } = options;

  assertBoundarySafe(options.args, "args");

  const { meta, body } = validateScript(script);
  const agentCap = options.agentCap ?? WORKFLOW_AGENT_CAP;
  const itemCap = options.itemCap ?? WORKFLOW_ITEM_CAP;
  const semaphore = new Semaphore(options.concurrency ?? workflowConcurrency());

  const progress: WorkflowEntry[] = [];
  const inflight = new Set<string>();
  /** Label → the child that ran under it, last one wins. The `resume` handle. */
  const completedByLabel = new Map<string, CompletedChild>();
  /**
   * Launches the host has accepted and not yet answered, in call order.
   *
   * This is the whole unawaited-launch mechanism: a script that drops an
   * `agent()` promise still gets its call answered eventually, but it returns
   * first — so anything left here when `complete` arrives is a result nobody is
   * waiting for. Tracking it host-side avoids proxying `Promise` inside the
   * realm, which §2.4 rules out, and reading stack traces, which is brittle.
   */
  const openLaunches = new Map<number, string>();
  let agentCount = 0;
  let nextAgentIndex = 0;
  let reservedAgentSlots = 0;
  let aborted = false;
  let settled = false;

  /* --- resume state ---------------------------------------------------- */

  const journalEntries = options.journal?.entries ?? [];
  const recordJournal = options.journal?.append;
  /**
   * Whether the replayable prefix is still intact.
   *
   * Once a position misses — different key, a journaled failure, or nothing
   * recorded there — every later call runs live, however well it matches.
   * See the header of journal.ts for why this is a prefix and not a lookup.
   */
  // A journal from a run that used `agent({ resume })` is declined whole: see
  // journal.ts on why a replayed agent leaves nothing for a later resume to
  // continue. Declining up front beats stranding the first `resume` call
  // partway through a run that has already spent its cheap half.
  const journalResumes = journalEntries.some(entry => entry.resumed);
  let prefixIntact = journalEntries.length > 0 && !journalResumes;
  let replayedCount = 0;

  /* --- live control ---------------------------------------------------- */

  /**
   * Agents that still have an unanswered `agent()` call, by index.
   *
   * The window in which skip and retry mean anything: before the entry appears
   * there is nothing to act on, and after it is gone the script already has its
   * value. `started` is what separates the two — a retry needs a child to stop.
   */
  interface LiveAgent {
    agentId: string;
    started: boolean;
    intent?: "skip" | "retry";
    /** Wakes it out of a pause hold, so a skip does not wait for a resume. */
    wake?: () => void;
  }
  const liveAgents = new Map<number, LiveAgent>();

  interface LiveStrictAttempt {
    agentId: string;
    index: number;
    key: string;
    launchId: string;
    agentType: string;
    requestedEffort: StrictEffort;
    attemptId: string;
    candidateIndex: number;
    requestedModel: string;
    evidence: StrictExecutionEvidence;
    observedModel?: string;
    observedEffort?: StrictAttemptReceipt["observedEffort"];
    base: WorkflowAgentEntry;
    startedAt: number;
    journaled: boolean;
  }
  const liveStrictAttempts = new Map<string, LiveStrictAttempt>();

  /**
   * Output tokens this run has spent, mirrored to the script as
   * `budget.spent()`.
   *
   * The host owns the number and every response carries it, rather than the
   * worker accumulating its own: two counters would drift, and there is nothing
   * to gain from the second one. Nor is there observable staleness — tokens
   * only accrue through agents, and the script only learns anything through
   * agent responses.
   */
  let spentOutputTokens = 0;

  let paused = false;
  /** Read through a call for the same reason `intent()` is — see below. */
  const isPaused = () => paused;
  const pauseWaiters = new Set<() => void>();
  /** Release everyone held at a pause — on resume, and on the way out. */
  function releasePause(): void {
    for (const wake of [...pauseWaiters]) wake();
    pauseWaiters.clear();
  }
  /** Park here while the run is paused, so no new agent is started. */
  function pauseGate(live: LiveAgent): Promise<void> {
    if (!paused || aborted || settled) return Promise.resolve();
    return new Promise<void>(resolve => {
      const wake = () => {
        pauseWaiters.delete(wake);
        live.wake = undefined;
        resolve();
      };
      live.wake = wake;
      pauseWaiters.add(wake);
    });
  }

  options.onControl?.({
    pause: () => { paused = true; },
    resume: () => { paused = false; releasePause(); },
    isPaused: () => paused,
    skip: index => {
      const live = liveAgents.get(index);
      if (live === undefined || live.intent !== undefined) return false;
      live.intent = "skip";
      // A running child is stopped, which comes back as a skipped result; a
      // held one is woken so it can bail at the gate it is parked on.
      if (live.started) host.abortAgent(live.agentId);
      else live.wake?.();
      return true;
    },
    retry: index => {
      const live = liveAgents.get(index);
      if (live === undefined || !live.started || live.intent !== undefined) return false;
      live.intent = "retry";
      host.abortAgent(live.agentId);
      return true;
    },
  });

  /** The journal entry to reuse at `index`, or undefined to run it live. */
  function replayAt(index: number, key: string): WorkflowJournalEntry | undefined {
    if (!prefixIntact) return undefined;
    const entry = journalEntries[index];
    if (entry === undefined || entry.index !== index || entry.key !== key || !entry.ok) {
      prefixIntact = false;
      return undefined;
    }
    return entry;
  }

  const worker = new Worker(WORKER_SOURCE, {
    eval: true,
    workerData: {
      body,
      metaJson: JSON.stringify(meta),
      argsJson: options.args === undefined ? undefined : JSON.stringify(options.args),
      itemCap,
      nestedCap: options.nestedCap ?? WORKFLOW_NESTED_CAP,
    },
  });

  return await new Promise<WorkflowRunResult>(resolve => {
    const emit = (entries: WorkflowEntry[]) => {
      if (entries.length === 0) return;
      progress.push(...entries);
      options.onProgress?.(entries);
    };

    const respond = (callId: number, ok: boolean, value?: unknown, error?: string, fatal?: boolean) => {
      // Cleared before the settled check: a launch answered by a run that is
      // already finishing is not an unawaited launch either.
      openLaunches.delete(callId);
      if (settled) return;
      // `spent` rides on every response, so the worker's `budget.spent()` is a
      // mirror of this number rather than a second tally of its own.
      worker.postMessage({ type: "response", callId, ok, value, error, fatal, spent: spentOutputTokens });
    };

    const finish = (result: Omit<WorkflowRunResult, "meta" | "progress" | "agentCount" | "replayedCount">) => {
      if (settled) return;
      settled = true;
      options.signal?.removeEventListener("abort", onAbort);
      // Symmetric with `semaphore.drain()` below: everything parked is woken so
      // it observes the settle and unwinds. Nothing depends on it — the run's
      // promise resolves either way — it just does not leave live-agent
      // bookkeeping behind for a run that is over.
      releasePause();
      for (const agentId of inflight) host.abortAgent(agentId);
      inflight.clear();
      semaphore.drain();
      // Resolve only once the thread is actually down, so a caller that awaits
      // runWorkflow() is guaranteed not to be leaking one.
      const settle = () => resolve({ ...result, meta, progress, agentCount, replayedCount });
      void worker.terminate().then(settle, settle);
    };

    function onAbort() {
      aborted = true;
      // Strict cancellation evidence must survive even though the worker is
      // terminated immediately. Snapshot every active attempt before finish().
      for (const live of liveStrictAttempts.values()) {
        if (live.journaled) continue;
        const attempt: StrictAttemptReceipt = {
          attemptId: live.attemptId,
          candidateIndex: live.candidateIndex,
          requestedModel: live.requestedModel,
          outcome: live.evidence.executionStarted
            ? "post-execution-failure"
            : "pre-execution-failure",
          failure: { code: "CANCELLED", message: "Workflow aborted." },
          evidence: { ...live.evidence },
          ...(live.observedModel !== undefined ? { observedModel: live.observedModel } : {}),
          ...(live.observedEffort !== undefined ? { observedEffort: live.observedEffort } : {}),
        };
        live.journaled = true;
        recordJournal?.({
          index: live.index,
          key: live.key,
          ok: false,
          kind: "strict-attempt",
          strict: {
            contractVersion: STRICT_AGENT_CONTRACT_VERSION,
            launchId: live.launchId,
            agentType: live.agentType,
            requestedEffort: live.requestedEffort,
            attempt,
          },
        });
        const finishedAt = Date.now();
        emit([{
          ...live.base,
          state: "error",
          lastProgressAt: finishedAt,
          durationMs: finishedAt - live.startedAt,
          error: "Workflow aborted.",
          strictAttempt: attempt,
          toolCalls: attempt.evidence.toolCallStartedCount,
        }]);
      }
      // terminate() is why this runs in a worker at all: it stops a script that
      // is spinning or wedged mid-await, which an in-process vm cannot do.
      finish({ status: "killed", error: "Workflow aborted." });
    }

    if (options.signal) {
      if (options.signal.aborted) {
        onAbort();
        return;
      }
      options.signal.addEventListener("abort", onAbort, { once: true });
    }

    async function handleAgent(callId: number, payload: AgentCallPayload): Promise<void> {
      // Bound now: the optional methods are checked once, up front, so a
      // capability the host lacks fails before an agent is spawned rather than
      // after — a gate that never ran must not be mistaken for a gate that
      // passed.
      const runGate = host.runGate?.bind(host);
      const resumeAgent = host.resumeAgent?.bind(host);
      if (payload.gate !== undefined && runGate === undefined) {
        respond(callId, false, undefined, "This workflow host cannot run gate commands.", true);
        return;
      }
      if (payload.resume !== undefined && resumeAgent === undefined) {
        respond(callId, false, undefined, "This workflow host cannot resume agents.", true);
        return;
      }

      let resumed: CompletedChild | undefined;
      if (payload.resume !== undefined) {
        resumed = completedByLabel.get(payload.resume);
        if (resumed === undefined) {
          const known = [...completedByLabel.keys()];
          // Fatal: a typo'd label is a script bug, and folding it into a null
          // would show up as an agent that mysteriously returned nothing.
          //
          // Unless agents were replayed, in which case it is not a script bug
          // at all — the label's child came back from the journal and has no
          // conversation here to continue. Saying "no agent has completed"
          // would send the reader hunting for a typo that is not there.
          respond(
            callId,
            false,
            undefined,
            replayedCount > 0 ?
              `agent() opts.resume: "${payload.resume}" was replayed from the resume journal, not run, so there is ` +
                "no conversation in this run to continue. Re-run without resumeFromRunId."
            : `agent() opts.resume: no agent has completed under the label "${payload.resume}" in this run. ${
                known.length === 0
                  ? "No agent has completed yet."
                  : `Known labels: ${known.map(label => `"${label}"`).join(", ")}.`
              }`,
            true,
          );
          return;
        }
      }

      // Compiled before anything is scheduled. A schema the runtime cannot use
      // is a script bug, so it is fatal like a typo'd resume label — folding it
      // into a null would surface as an agent that mysteriously returned
      // nothing, and it costs no model call to say so here.
      let compiledSchema: CompiledSchema | undefined;
      if (payload.schema !== undefined) {
        const compilation = compileJsonSchema(payload.schema);
        if (!compilation.ok) {
          respond(callId, false, undefined, compilation.message, true);
          return;
        }
        compiledSchema = compilation.compiled;
      }

      if (agentCount + reservedAgentSlots >= agentCap) {
        // Fatal, so parallel()/pipeline() rethrow instead of folding it into a
        // null. A cap that silently drops work is worse than no cap.
        respond(callId, false, undefined, `Workflow exceeded its cap of ${agentCap} agents.`, true);
        return;
      }
      const index = nextAgentIndex++;
      agentCount++;
      // A resumed call is the same child again: it keeps the agent id, so an
      // abort still reaches it, and it keeps its spawn contract, so the row
      // reads the same as the row it continues.
      const agentId = resumed?.agentId ?? `wf-agent-${index}`;
      const label = payload.label ?? resumed?.label ?? derivedLabel(payload.prompt);
      const agentType = resumed?.agentType ?? payload.agentType ?? "general-purpose";
      const model = resumed !== undefined ? resumed.model : payload.model;
      const isolation = resumed !== undefined ? resumed.isolation : payload.isolation;
      openLaunches.set(callId, label);

      const base: WorkflowAgentEntry = {
        type: "workflow_agent",
        index,
        label,
        state: "start",
        agentId,
        agentType,
        promptPreview: preview(payload.prompt),
        ...(model !== undefined ? { model } : {}),
        ...(isolation !== undefined ? { isolation } : {}),
        ...(payload.phaseIndex !== undefined ? { phaseIndex: payload.phaseIndex } : {}),
        ...(payload.phaseTitle !== undefined ? { phaseTitle: payload.phaseTitle } : {}),
      };

      const queuedAt = Date.now();
      emit([{ ...base, queuedAt }]);

      // Replay before the semaphore, not after: a cached answer is not model
      // running, so it must not hold a concurrency slot that a live agent
      // could use. The row still appears in the tree — the run reads as the
      // same shape it had the first time, just faster.
      // The payload's `schema` is the raw object; the key wants it serialized,
      // so the spread is narrowed rather than passed through.
      const keyInput: JournalKeyInput = {
        ...payload,
        schema: payload.schema !== undefined ? JSON.stringify(payload.schema) : undefined,
      };
      let replayed = replayAt(index, journalKey(keyInput));
      // A replayed answer still has to satisfy the schema. The key covers a
      // schema that *changed*, but not a journal that was hand-edited, and not
      // the empty text a torn entry leaves behind — either would hand the
      // script a null from an entry the journal claims succeeded.
      if (replayed !== undefined && compiledSchema !== undefined) {
        const recheck = applySchema({ ok: true, text: replayed.text ?? "" }, compiledSchema);
        if (!recheck.ok) {
          prefixIntact = false;
          replayed = undefined;
        }
      }
      if (replayed !== undefined) {
        replayedCount++;
        const replayedText = replayed.text ?? "";
        const at = Date.now();
        emit([
          {
            ...base,
            queuedAt,
            startedAt: at,
            lastProgressAt: at,
            durationMs: 0,
            state: "done",
            // The row reads as done, because it is — `cached` is what tells the
            // dialog to annotate it "from resume journal" rather than letting a
            // 0ms agent look like one that did the work impossibly fast.
            cached: true,
            resultPreview: preview(replayedText),
          },
        ]);
        openLaunches.delete(callId);
        // Re-recorded so this run's journal is complete on its own terms: a
        // resume of a resume must not have to walk back through a chain of
        // earlier files to find the prefix.
        recordJournal?.({ index, key: replayed.key, ok: true, text: replayedText });
        respond(callId, true, replayedText);
        return;
      }

      const key = journalKey(keyInput);
      const resumeMark = payload.resume !== undefined ? ({ resumed: true } as const) : {};

      /** A skip the user asked for, before the child ever started. */
      const settleSkipped = (extra: Partial<WorkflowAgentEntry>) => {
        recordJournal?.({ index, key, ok: false, ...resumeMark });
        emit([{ ...base, queuedAt, ...extra, state: "error", skipped: true, error: "Skipped by user." }]);
        // `null`, exactly as a terminal failure gives — a skipped agent is one
        // the script's `.filter(Boolean)` was already written to survive.
        respond(callId, true, null);
      };

      // Registered for exactly as long as the call is unanswered, which is the
      // window in which skip and retry mean anything.
      const live: LiveAgent = { agentId, started: false };
      liveAgents.set(index, live);
      // Read through a call, not off the field: `intent` is set from outside
      // this function while it is suspended at an await, so control-flow
      // narrowing across the awaits would be reasoning about a value that has
      // since changed.
      const intent = (): LiveAgent["intent"] => live.intent;
      let attempt = 1;
      try {
        for (;;) {
          // Held before the slot, not after: a paused run must not sit on
          // concurrency it is not using while its running agents drain.
          await pauseGate(live);
          if (intent() === "skip") return settleSkipped({});

          // A resumed agent waits its turn like any other: it is the same amount of
          // model running at once.
          await semaphore.acquire();
          if (aborted || settled) {
            semaphore.release();
            respond(callId, false, undefined, "Workflow aborted.", true);
            return;
          }
          // Paused while parked behind the limit: this agent was waiting for a
          // permit when the pause landed, so it never passed the gate above.
          // Hand the permit back and go wait at the gate like everything else,
          // or a pause would leak exactly as many agents as were queued.
          if (isPaused() && !aborted && !settled) {
            semaphore.release();
            continue;
          }
          // Skipped while parked behind the limit: the permit arrived, and the
          // only thing left to do with it is give it back.
          if (intent() === "skip") {
            semaphore.release();
            return settleSkipped({});
          }

          // Carried on every emit from here on, so a retried row keeps saying
          // why it is on its second attempt instead of losing it to the next
          // progress update.
          const attemptMark =
            attempt > 1 ? { attempt, lastAttemptReason: "user-retry" as const } : {};

          const startedAt = Date.now();
          emit([{ ...base, queuedAt, startedAt, ...attemptMark }]);

          // Mutates `base` rather than emitting a standalone patch: every later
          // emit spreads it, so the settle path carries the effective values
          // without knowing they were ever corrected. Re-emitting under the
          // same `index` is what the append-only, last-write-wins progress log
          // is for — the row updates in place while the agent is still running.
          const onResolved = (info: {
            recordId?: string;
            modelName?: string;
            modelId?: string;
            thinking?: string;
            requestedThinking?: string;
            requestedModel?: string;
          }) => {
            if (info.recordId !== undefined) base.recordId = info.recordId;
            if (info.modelName !== undefined) base.model = info.modelName;
            if (info.modelId !== undefined) base.modelId = info.modelId;
            if (info.thinking !== undefined) base.thinking = info.thinking;
            if (info.requestedThinking !== undefined) base.requestedThinking = info.requestedThinking;
            if (info.requestedModel !== undefined) base.requestedModel = info.requestedModel;
            // `base.state` is still "start", so emitting after the row reached a
            // terminal state would revert it to running under last-write-wins.
            // Not reachable from this repo's host, which reports during startup
            // — but this is the host boundary, and every other promise it makes
            // is checked rather than trusted.
            if (!inflight.has(agentId)) return;
            emit([{ ...base, queuedAt, startedAt, ...attemptMark, lastProgressAt: Date.now() }]);
          };
          live.started = true;
          inflight.add(agentId);

          let result: WorkflowSpawnResult;
          try {
            result =
              resumed !== undefined && resumeAgent !== undefined
                ? await resumeAgent(resumed.agentId, payload.prompt, onResolved)
                : await host.spawnAgent({
                    agentId,
                    index,
                    prompt: payload.prompt,
                    label,
                    agentType,
                    ...(model !== undefined ? { model } : {}),
                    ...(payload.effort !== undefined ? { effort: payload.effort } : {}),
                    ...(compiledSchema !== undefined ? { schema: compiledSchema } : {}),
                    ...(isolation !== undefined ? { isolation } : {}),
                    ...(payload.phaseIndex !== undefined ? { phaseIndex: payload.phaseIndex } : {}),
                    ...(payload.phaseTitle !== undefined ? { phaseTitle: payload.phaseTitle } : {}),
                    // Offered, not delegated: a host that can run it inside the
                    // child's worktree does, and hands back `result.gate`.
                    ...(payload.gate !== undefined ? { gate: payload.gate } : {}),
                    onResolved,
                  });
            if (result.ok) {
              // Recorded before the gate runs: the child itself finished, so it is
              // resumable even when its gate rejects the work — "here is what the
              // gate said, fix it" is the loop this exists for.
              completedByLabel.set(label, {
                agentId,
                label,
                agentType,
                ...(model !== undefined ? { model } : {}),
                ...(isolation !== undefined ? { isolation } : {}),
              });
              // Re-checked here, not just in the child's tool: this is the one
              // place that decides the script's value matches the schema it
              // asked for, so a host that ignored `schema` fails loudly instead
              // of handing the script prose. Before the gate, because a gate
              // verifies work and there is no work to verify if the shape is
              // wrong — and the reader should see the schema error, not a gate
              // error standing in front of it.
              if (compiledSchema !== undefined && result.ok) {
                result = applySchema(result, compiledSchema);
              }
              if (result.ok && payload.gate !== undefined && runGate !== undefined) {
                result = await applyGate(result, payload.gate, agentId, runGate);
              }
            }
          } catch (error) {
            result = { ok: false, error: error instanceof Error ? error.message : String(error) };
          } finally {
            inflight.delete(agentId);
            live.started = false;
            semaphore.release();
          }

          if (settled) return;

          // The stop that produced this result was ours, so run the same call
          // again rather than reporting it. The script is still awaiting this
          // `agent()`, which is the only reason a retry can mean anything.
          if (intent() === "retry" && !aborted) {
            live.intent = undefined;
            attempt++;
            emit([{ ...base, queuedAt, attempt, lastAttemptReason: "user-retry" }]);
            continue;
          }

          // Counted before the response is sent, so the very call that spent
          // them already sees them in `budget.spent()`. Failed and skipped
          // agents count too — they burned the tokens either way.
          spentOutputTokens += result.outputTokens ?? 0;

          const finishedAt = Date.now();
          const common = {
            ...base,
            queuedAt,
            startedAt,
            ...attemptMark,
            lastProgressAt: finishedAt,
            durationMs: finishedAt - startedAt,
            ...(result.tokens !== undefined ? { tokens: result.tokens } : {}),
            ...(result.toolCalls !== undefined ? { toolCalls: result.toolCalls } : {}),
          };

          if (result.ok) {
            const text = result.text ?? "";
            emit([{ ...common, state: "done", resultPreview: preview(text) }]);
            recordJournal?.({ index, key, ok: true, text, ...resumeMark });
            respond(callId, true, text);
            return;
          }
          // Recorded as a failure rather than left out: a gap would be read as an
          // unchanged prefix on the next resume, silently skipping the retry this
          // whole mechanism exists to make cheap.
          recordJournal?.({ index, key, ok: false, ...resumeMark });
          // A dead agent is a null in the script, not a thrown error: Claude Code
          // scripts .filter(Boolean) rather than try/catch around every call.
          emit([
            {
              ...common,
              state: "error",
              // A user skip reaches here as a stopped child, which the host
              // already reports as skipped — the flag is taken from the result
              // rather than from the intent so an abort mid-skip still reads
              // as whatever actually happened to the child.
              error: result.error ?? "Agent failed.",
              ...(result.skipped ? { skipped: true } : {}),
            },
          ]);
          respond(callId, true, null);
          return;
        }
      } finally {
        liveAgents.delete(index);
      }
    }

    async function handleStrictAgent(callId: number, payload: StrictAgentCallPayload): Promise<void> {
      const validateStrictAgent = host.validateStrictAgent?.bind(host);
      const spawnStrictAttempt = host.spawnStrictAttempt?.bind(host);
      if (validateStrictAgent === undefined || spawnStrictAttempt === undefined) {
        respond(callId, true, strictContractFailure(
          "INCOMPATIBLE_PI_RUNTIME",
          "This workflow host does not provide the strict route-launch contract.",
        ));
        return;
      }

      let compiledSchema: CompiledSchema | undefined;
      if (payload.schema !== undefined) {
        const compilation = compileJsonSchema(payload.schema);
        if (!compilation.ok) {
          respond(callId, true, strictContractFailure("INVALID_SCHEMA", compilation.message));
          return;
        }
        compiledSchema = compilation.compiled;
      }

      const candidates = [payload.model, ...payload.fallbackModels];

      // Strict evidence can be journaled but never substituted for a fresh
      // launch. A resumed run stops at the first strict call it reached before.
      if (prefixIntact) {
        const prior = journalEntries.find(entry => entry.index === nextAgentIndex);
        if (prior?.kind === "strict-attempt") {
          respond(callId, true, strictContractFailure(
            "STRICT_REPLAY_UNSUPPORTED",
            "A completed strictAgent() call cannot be replayed from a workflow journal. Re-run without resumeFromRunId.",
          ));
          return;
        }
        prefixIntact = false;
      }

      let validation: WorkflowStrictValidationResult;
      try {
        validation = validateStrictAgent({
          contractVersion: payload.contractVersion,
          prompt: payload.prompt,
          agentType: payload.agentType,
          model: payload.model,
          fallbackModels: payload.fallbackModels,
          effort: payload.effort,
          ...(payload.isolation !== undefined ? { isolation: payload.isolation } : {}),
          ...(compiledSchema !== undefined ? { schema: compiledSchema } : {}),
          ...(payload.phaseIndex !== undefined ? { phaseIndex: payload.phaseIndex } : {}),
          ...(payload.phaseTitle !== undefined ? { phaseTitle: payload.phaseTitle } : {}),
        });
      } catch (error) {
        respond(callId, true, strictContractFailure(
          "INCOMPATIBLE_PI_RUNTIME",
          error instanceof Error ? error.message : String(error),
        ));
        return;
      }
      if (!validation.ok) {
        respond(
          callId,
          true,
          strictContractFailure(validation.failure.code, validation.failure.message),
        );
        return;
      }

      // Reserve both capacity and stable indices synchronously, before the
      // first await. Concurrent calls cannot consume the route's fallback
      // budget or reorder its journal positions while it waits for a permit.
      if (agentCount + reservedAgentSlots + candidates.length > agentCap) {
        respond(
          callId,
          false,
          undefined,
          `Workflow strict route could require ${candidates.length} attempts, exceeding its cap of ${agentCap} agents.`,
          true,
        );
        return;
      }
      const strictIndexStart = nextAgentIndex;
      nextAgentIndex += candidates.length;
      reservedAgentSlots += candidates.length;
      let remainingReservation = candidates.length;

      const launchId = strictLaunchId();
      const attempts: StrictAttemptReceipt[] = [];
      const label = derivedLabel(payload.prompt);
      const routeKey = strictJournalKey({
        contractVersion: STRICT_AGENT_CONTRACT_VERSION,
        prompt: payload.prompt,
        agentType: validation.agentType,
        model: payload.model,
        fallbackModels: payload.fallbackModels,
        effort: payload.effort,
        ...(validation.isolation !== undefined ? { isolation: validation.isolation } : {}),
        ...(payload.schema !== undefined ? { schema: JSON.stringify(payload.schema) } : {}),
      });
      openLaunches.set(callId, label);

      const strictPauseState: LiveAgent = { agentId: "", started: false };
      let acquired = false;
      try {
        for (;;) {
          await pauseGate(strictPauseState);
          if (aborted || settled) {
            respond(callId, false, undefined, "Workflow aborted.", true);
            return;
          }
          await semaphore.acquire();
          acquired = true;
          // A pause may land while this route waits behind the semaphore. Give
          // the permit back and join the pause gate before starting a child.
          if (!isPaused()) break;
          semaphore.release();
          acquired = false;
        }

        for (let candidateIndex = 0; candidateIndex < candidates.length; candidateIndex++) {
          if (candidateIndex > 0) {
            await pauseGate(strictPauseState);
            if (aborted || settled) return;
          }
          const requestedModel = candidates[candidateIndex];
          const index = strictIndexStart + candidateIndex;
          remainingReservation--;
          reservedAgentSlots--;
          agentCount++;
          const attemptId = `${launchId}:${candidateIndex}`;
          const agentId = `wf-strict-${launchId}-${candidateIndex}`;
          const queuedAt = Date.now();
          const startedAt = Date.now();
          let evidence = emptyStrictExecutionEvidence();
          const base: WorkflowAgentEntry = {
            type: "workflow_agent",
            index,
            label: candidates.length === 1 ? label : `${label} [${candidateIndex + 1}/${candidates.length}]`,
            state: "start",
            agentId,
            agentType: validation.agentType,
            model: requestedModel,
            requestedThinking: payload.effort,
            strictRoute: true,
            strictLaunchId: launchId,
            promptPreview: preview(payload.prompt),
            queuedAt,
            startedAt,
            ...(validation.isolation !== undefined ? { isolation: validation.isolation } : {}),
            ...(payload.phaseIndex !== undefined ? { phaseIndex: payload.phaseIndex } : {}),
            ...(payload.phaseTitle !== undefined ? { phaseTitle: payload.phaseTitle } : {}),
          };
          emit([base]);
          inflight.add(agentId);
          const liveStrict: LiveStrictAttempt = {
            agentId,
            index,
            key: routeKey,
            launchId,
            agentType: validation.agentType,
            requestedEffort: payload.effort,
            attemptId,
            candidateIndex,
            requestedModel,
            evidence,
            base,
            startedAt,
            journaled: false,
          };
          liveStrictAttempts.set(agentId, liveStrict);

          const onResolved = (info: {
            recordId?: string;
            modelName?: string;
            modelId?: string;
            thinking?: string;
          }) => {
            if (info.recordId !== undefined) base.recordId = info.recordId;
            if (info.modelName !== undefined) base.model = info.modelName;
            if (info.modelId !== undefined) {
              base.modelId = info.modelId;
              liveStrict.observedModel = info.modelId;
            }
            if (info.thinking !== undefined) {
              base.thinking = info.thinking;
              liveStrict.observedEffort = info.thinking as StrictAttemptReceipt["observedEffort"];
            }
            if (!inflight.has(agentId)) return;
            emit([{ ...base, lastProgressAt: Date.now() }]);
          };
          const onEvidence = (next: StrictExecutionEvidence) => {
            evidence = { ...next };
            liveStrict.evidence = evidence;
          };

          let hostResult: WorkflowStrictAttemptResult;
          try {
            hostResult = await spawnStrictAttempt({
              launchId,
              attemptId,
              agentId,
              candidateIndex,
              prompt: payload.prompt,
              agentType: validation.agentType,
              model: requestedModel,
              effort: payload.effort,
              ...(validation.isolation !== undefined ? { isolation: validation.isolation } : {}),
              ...(compiledSchema !== undefined ? { schema: compiledSchema } : {}),
              onResolved,
              onEvidence,
            });
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            hostResult = {
              attempt: {
                attemptId,
                candidateIndex,
                requestedModel,
                outcome: evidence.executionStarted ? "post-execution-failure" : "pre-execution-failure",
                failure: {
                  code: evidence.executionStarted ? "RUNTIME_FAILED" : "PREFLIGHT_FAILED",
                  message,
                },
                evidence,
              },
            };
          } finally {
            inflight.delete(agentId);
            liveStrictAttempts.delete(agentId);
          }

          // onAbort snapshots and journals a live strict attempt before the
          // worker is terminated. Its eventual host settlement must not write
          // a second, contradictory receipt.
          if (liveStrict.journaled || settled) return;

          const hostAttempt = hostResult.attempt;
          let attempt: StrictAttemptReceipt = {
            attemptId,
            candidateIndex,
            requestedModel,
            outcome: hostAttempt.outcome,
            evidence: hostAttempt.evidence,
            ...(hostAttempt.observedModel !== undefined &&
              isExactQualifiedModelId(hostAttempt.observedModel)
              ? { observedModel: hostAttempt.observedModel }
              : {}),
            ...(hostAttempt.observedEffort === "off" ||
              (hostAttempt.observedEffort !== undefined &&
                STRICT_EFFORT_LEVELS.includes(hostAttempt.observedEffort))
              ? { observedEffort: hostAttempt.observedEffort }
              : {}),
            ...(hostAttempt.failure !== undefined
              ? {
                  failure: {
                    code: hostAttempt.failure.code,
                    message: sanitizeStrictDiagnostic(hostAttempt.failure.message),
                  },
                }
              : {}),
          };

          // Runtime-side defence in depth: a host cannot select a substituted
          // model or a clamped effort even if its final-preflight check drifted.
          if (attempt.outcome === "selected" && attempt.observedModel !== requestedModel) {
            attempt = {
              ...attempt,
              outcome: attempt.evidence.executionStarted
                ? "post-execution-failure"
                : "pre-execution-failure",
              failure: {
                code: "CANONICAL_MODEL_MISMATCH",
                message: sanitizeStrictDiagnostic(
                  `Strict attempt selected "${attempt.observedModel ?? "(unknown)"}" instead of "${requestedModel}".`,
                ),
              },
            };
          }
          if (attempt.outcome === "selected" && attempt.observedEffort !== payload.effort) {
            attempt = {
              ...attempt,
              outcome: attempt.evidence.executionStarted
                ? "post-execution-failure"
                : "pre-execution-failure",
              failure: {
                code: "EFFECTIVE_EFFORT_MISMATCH",
                message: sanitizeStrictDiagnostic(
                  `Strict attempt used effort "${attempt.observedEffort ?? "(unknown)"}" instead of "${payload.effort}".`,
                ),
              },
            };
          }
          if (attempt.outcome === "selected" && !attempt.evidence.executionStarted) {
            attempt = {
              ...attempt,
              outcome: "pre-execution-failure",
              failure: {
                code: "PREFLIGHT_FAILED",
                message: "Strict attempt reported success without crossing the execution boundary.",
              },
            };
          }

          if (attempt.outcome === "selected" && compiledSchema !== undefined) {
            const checked = applySchema({ ok: true, text: hostResult.text ?? "" }, compiledSchema);
            if (!checked.ok) {
              attempt = {
                ...attempt,
                outcome: "post-execution-failure",
                failure: {
                  code: "SCHEMA_REJECTED",
                  message: checked.error ?? "Structured output was rejected.",
                },
              };
            }
          }

          attempts.push(attempt);
          spentOutputTokens += hostResult.outputTokens ?? 0;
          const finishedAt = Date.now();
          emit([{
            ...base,
            state: attempt.outcome === "selected" ? "done" : "error",
            lastProgressAt: finishedAt,
            durationMs: finishedAt - startedAt,
            strictAttempt: attempt,
            ...(hostResult.tokens !== undefined ? { tokens: hostResult.tokens } : {}),
            toolCalls: attempt.evidence.toolCallStartedCount,
            ...(attempt.outcome === "selected"
              ? {}
              : { error: attempt.failure?.message ?? "Strict attempt failed." }),
          }]);
          recordJournal?.({
            index,
            key: routeKey,
            ok: attempt.outcome === "selected",
            kind: "strict-attempt",
            strict: {
              contractVersion: STRICT_AGENT_CONTRACT_VERSION,
              launchId,
              agentType: validation.agentType,
              requestedEffort: payload.effort,
              attempt,
            },
          });

          if (attempt.outcome === "selected") {
            const observedModel = attempt.observedModel;
            const observedEffort = attempt.observedEffort;
            if (observedModel === undefined || observedEffort === undefined) {
              throw new WorkflowRuntimeError("A selected strict attempt omitted runtime observations.");
            }
            const resultValue = compiledSchema === undefined
              ? hostResult.text ?? ""
              : JSON.parse(hostResult.text ?? "null");
            const route: StrictRouteResult = {
              contractVersion: STRICT_AGENT_CONTRACT_VERSION,
              launchId,
              agentType: validation.agentType,
              requestedEffort: payload.effort,
              outcome: "succeeded",
              attempts,
              selected: {
                candidateIndex,
                requestedModel,
                observedModel,
                requestedEffort: payload.effort,
                // The mismatch branch above already made any other effective
                // value terminal, so a selected route necessarily equals this.
                observedEffort: payload.effort,
              },
              result: resultValue,
            };
            assertBoundarySafe(route, "strictAgent() result");
            respond(callId, true, route);
            return;
          }

          const failure = attempt.failure ?? {
            code: "RUNTIME_FAILED" as const,
            message: "Strict attempt failed without a typed reason.",
          };
          if (canAdvanceStrictRoute(attempt) && candidateIndex < candidates.length - 1) continue;

          const routeFailure = canAdvanceStrictRoute(attempt)
            ? {
                code: "ROUTE_EXHAUSTED" as const,
                message: `Strict route exhausted ${attempts.length} candidate${attempts.length === 1 ? "" : "s"}.`,
              }
            : failure;
          const route: StrictRouteResult = {
            contractVersion: STRICT_AGENT_CONTRACT_VERSION,
            launchId,
            agentType: validation.agentType,
            requestedEffort: payload.effort,
            outcome: "failed",
            attempts,
            failure: routeFailure,
          };
          assertBoundarySafe(route, "strictAgent() result");
          respond(callId, true, route);
          return;
        }
      } catch (error) {
        respond(
          callId,
          false,
          undefined,
          error instanceof Error ? error.message : String(error),
          true,
        );
      } finally {
        reservedAgentSlots -= remainingReservation;
        if (acquired) semaphore.release();
      }
    }

    /**
     * Resolve one `workflow(ref)` and hand the child's source back compiled.
     *
     * Resolution failures are non-fatal — Claude Code documents `workflow()` as
     * throwing on an unknown name so a script can catch it and carry on. A host
     * with no `loadWorkflow` at all is fatal, matching how a missing `runGate`
     * or `resumeAgent` is treated: a capability the script asked for and this
     * host cannot provide is a wiring error, not a runtime condition.
     */
    async function handleLoadWorkflow(callId: number, ref: WorkflowScriptRef): Promise<void> {
      const loadWorkflow = host.loadWorkflow?.bind(host);
      if (loadWorkflow === undefined) {
        respond(callId, false, undefined, "This workflow host cannot run nested workflows.", true);
        return;
      }
      let source: WorkflowScriptSource;
      try {
        source = await loadWorkflow(ref);
      } catch (error) {
        respond(callId, false, undefined, error instanceof Error ? error.message : String(error));
        return;
      }
      if (!source.ok) {
        respond(callId, false, undefined, source.message);
        return;
      }
      try {
        const child = validateScript(source.script);
        respond(callId, true, {
          name: child.meta.name,
          metaJson: JSON.stringify(child.meta),
          body: child.body,
        });
      } catch (error) {
        respond(callId, false, undefined, error instanceof Error ? error.message : String(error));
      }
    }

    worker.on("message", (message: WorkerMessage) => {
      if (settled) return;
      switch (message.type) {
        case "progress":
          emit(message.entries);
          break;
        case "call":
          if (message.method === "workflow") {
            void handleLoadWorkflow(message.callId, message.payload as WorkflowScriptRef);
            break;
          }
          if (message.method === "strictAgent") {
            void handleStrictAgent(message.callId, message.payload as StrictAgentCallPayload);
            break;
          }
          if (message.method !== "agent") {
            respond(message.callId, false, undefined, `Unknown workflow host method "${message.method}".`, true);
            break;
          }
          void handleAgent(message.callId, message.payload as AgentCallPayload);
          break;
        case "complete": {
          // The script is done, so every launch it made should have been
          // answered by now — a response is sent before the worker can post
          // this, so anything still open was never awaited. finish() aborts
          // those children on the way out.
          const unawaited = [...openLaunches.values()];
          if (unawaited.length > 0) {
            finish({ status: "failed", error: unawaitedLaunchMessage(unawaited) });
            break;
          }
          finish({
            status: "completed",
            ...(message.resultJson === undefined ? {} : { value: JSON.parse(message.resultJson) }),
          });
          break;
        }
        case "error":
          finish({ status: "failed", error: message.message });
          break;
      }
    });

    worker.on("error", error => {
      finish({ status: "failed", error: error instanceof Error ? error.message : String(error) });
    });

    worker.on("exit", () => {
      // Only reachable when the worker dies without reporting — a terminate()
      // we did not initiate, or a hard crash.
      finish({ status: "failed", error: "Workflow worker exited before completing." });
    });
  });
}
