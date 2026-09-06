import { describe, expect, it, vi } from "vitest";
import {
  emptyStrictExecutionEvidence,
  type StrictAttemptReceipt,
} from "../src/strict-agent.js";
import type { WorkflowJournalEntry } from "../src/workflow/journal.js";
import {
  buildPhaseGroups,
  stats,
  type WorkflowAgentEntry,
} from "../src/workflow/progress.js";
import {
  runWorkflow,
  type WorkflowControl,
  type WorkflowHost,
  type WorkflowStrictAttemptRequest,
  type WorkflowStrictAttemptResult,
} from "../src/workflow/runtime.js";

const HEAD = 'export const meta = { name: "strict-probe", description: "strict runtime probe" };\n';

const OPTIONS_VALUE = {
  contractVersion: 1,
  agentType: "hx-reviewer-a",
  model: "provider/primary",
  fallbackModels: ["provider/fallback"],
  effort: "high",
};
const OPTIONS = JSON.stringify(OPTIONS_VALUE);

function receipt(
  request: WorkflowStrictAttemptRequest,
  overrides: Partial<StrictAttemptReceipt> = {},
): StrictAttemptReceipt {
  return {
    attemptId: request.attemptId,
    candidateIndex: request.candidateIndex,
    requestedModel: request.model,
    observedModel: request.model,
    observedEffort: request.effort,
    outcome: "selected",
    evidence: {
      ...emptyStrictExecutionEvidence(),
      executionStarted: true,
      assistantMessageStartedCount: 1,
      assistantOutputEventCount: 1,
    },
    ...overrides,
  };
}

function strictHost(
  reply?: (request: WorkflowStrictAttemptRequest) => WorkflowStrictAttemptResult | Promise<WorkflowStrictAttemptResult>,
) {
  const attempts: WorkflowStrictAttemptRequest[] = [];
  const host: WorkflowHost = {
    async spawnAgent(request) {
      return { ok: true, text: `ordinary:${request.prompt}` };
    },
    abortAgent() {},
    validateStrictAgent(request) {
      return request.agentType === "hx-reviewer-a"
        ? {
            ok: true,
            agentType: request.agentType,
            ...(request.isolation !== undefined ? { isolation: request.isolation } : {}),
          }
        : {
            ok: false,
            failure: { code: "UNKNOWN_AGENT_TYPE", message: `Unknown strict agent type: ${request.agentType}` },
          };
    },
    async spawnStrictAttempt(request) {
      attempts.push(request);
      return reply
        ? await reply(request)
        : { attempt: receipt(request), text: `strict:${request.model}` };
    },
  };
  return { host, attempts };
}

function run(body: string, host: WorkflowHost, journal?: {
  entries?: readonly WorkflowJournalEntry[];
  append?(entry: WorkflowJournalEntry): void;
}) {
  return runWorkflow({ script: HEAD + body, host, journal });
}

function finalStrictRows(progress: readonly { type: string }[]): WorkflowAgentEntry[] {
  return progress.filter((entry): entry is WorkflowAgentEntry =>
    entry.type === "workflow_agent" &&
    "strictAttempt" in entry &&
    (entry as WorkflowAgentEntry).strictAttempt !== undefined,
  );
}

describe("strictAgent() workflow runtime", () => {
  it("returns a versioned runtime-owned route receipt", async () => {
    const { host, attempts } = strictHost();
    const result = await run(`return await strictAgent("review", ${OPTIONS});`, host);

    expect(result.status).toBe("completed");
    expect(attempts.map(attempt => attempt.model)).toEqual(["provider/primary"]);
    expect(result.value).toMatchObject({
      contractVersion: 1,
      agentType: "hx-reviewer-a",
      requestedEffort: "high",
      outcome: "succeeded",
      selected: {
        candidateIndex: 0,
        requestedModel: "provider/primary",
        observedModel: "provider/primary",
        requestedEffort: "high",
        observedEffort: "high",
      },
      result: "strict:provider/primary",
    });
    expect((result.value as { launchId: string }).launchId).toMatch(/^strict_[a-f0-9]{16}$/);
  });

  it("advances serially only after an allowed failure with explicit zero-work evidence", async () => {
    const { host, attempts } = strictHost(request => {
      if (request.candidateIndex === 0) {
        return {
          attempt: receipt(request, {
            observedModel: undefined,
            observedEffort: undefined,
            outcome: "pre-execution-failure",
            failure: { code: "MODEL_UNAVAILABLE", message: "not installed" },
            evidence: emptyStrictExecutionEvidence(),
          }),
        };
      }
      return { attempt: receipt(request), text: "fallback-result" };
    });

    const result = await run(`return await strictAgent("review", ${OPTIONS});`, host);

    expect(attempts.map(attempt => attempt.model)).toEqual([
      "provider/primary",
      "provider/fallback",
    ]);
    expect(result.value).toMatchObject({
      outcome: "succeeded",
      attempts: [
        { outcome: "pre-execution-failure", failure: { code: "MODEL_UNAVAILABLE" } },
        { outcome: "selected" },
      ],
      selected: { candidateIndex: 1, requestedModel: "provider/fallback" },
      result: "fallback-result",
    });
    expect(buildPhaseGroups(result.progress)[0]).toMatchObject({
      status: "done",
      doneCount: 2,
      totalCount: 2,
    });
    expect(stats(result.progress, result.agentCount)).toMatchObject({
      done: 2,
      failedCount: 0,
      complete: true,
    });
  });

  it("uses unique fresh attempt identities and forwards isolation to every candidate", async () => {
    const { host, attempts } = strictHost(request => request.candidateIndex === 0
      ? {
          attempt: receipt(request, {
            observedModel: undefined,
            observedEffort: undefined,
            outcome: "pre-execution-failure",
            failure: { code: "MODEL_UNAVAILABLE", message: "missing" },
            evidence: emptyStrictExecutionEvidence(),
          }),
        }
      : { attempt: receipt(request), text: "fallback" });
    const options = JSON.stringify({ ...OPTIONS_VALUE, isolation: "worktree" });

    await run(`return await strictAgent("review", ${options});`, host);

    expect(attempts).toHaveLength(2);
    expect(new Set(attempts.map(attempt => attempt.attemptId)).size).toBe(2);
    expect(new Set(attempts.map(attempt => attempt.agentId)).size).toBe(2);
    expect(attempts.every(attempt => attempt.isolation === "worktree")).toBe(true);
  });

  it("does not advance after the execution boundary", async () => {
    const { host, attempts } = strictHost(request => ({
      attempt: receipt(request, {
        outcome: "post-execution-failure",
        failure: { code: "PROVIDER_FAILED", message: "remote refusal" },
      }),
    }));

    const result = await run(`return await strictAgent("review", ${OPTIONS});`, host);

    expect(attempts).toHaveLength(1);
    expect(result.value).toMatchObject({
      outcome: "failed",
      failure: { code: "PROVIDER_FAILED" },
    });
  });

  it("does not trust an advance code when any output or tool start is non-zero", async () => {
    const { host, attempts } = strictHost(request => ({
      attempt: receipt(request, {
        outcome: "pre-execution-failure",
        failure: { code: "AUTH_UNAVAILABLE", message: "bad evidence" },
        evidence: {
          ...emptyStrictExecutionEvidence(),
          assistantOutputEventCount: 1,
        },
      }),
    }));

    const result = await run(`return await strictAgent("review", ${OPTIONS});`, host);
    expect(attempts).toHaveLength(1);
    expect(result.value).toMatchObject({ outcome: "failed", failure: { code: "AUTH_UNAVAILABLE" } });
  });

  it("returns ROUTE_EXHAUSTED after every admissible candidate fails", async () => {
    const { host, attempts } = strictHost(request => ({
      attempt: receipt(request, {
        observedModel: undefined,
        observedEffort: undefined,
        outcome: "pre-execution-failure",
        failure: { code: "MODEL_UNAVAILABLE", message: "missing" },
        evidence: emptyStrictExecutionEvidence(),
      }),
    }));

    const result = await run(`return await strictAgent("review", ${OPTIONS});`, host);
    expect(attempts).toHaveLength(2);
    expect(result.value).toMatchObject({
      outcome: "failed",
      failure: { code: "ROUTE_EXHAUSTED" },
      attempts: [{ candidateIndex: 0 }, { candidateIndex: 1 }],
    });
  });

  it("composes with structured output and returns an object in the script realm", async () => {
    const { host } = strictHost(request => ({
      attempt: receipt(request),
      text: JSON.stringify({ verdict: true }),
    }));
    const schema = JSON.stringify({
      type: "object",
      properties: { verdict: { type: "boolean" } },
      required: ["verdict"],
      additionalProperties: false,
    });
    const result = await run(
      `const route = await strictAgent("review", { ...${OPTIONS}, schema: ${schema} });\n` +
      "return { route, object: route.result instanceof Object };",
      host,
    );

    expect(result.value).toMatchObject({
      object: true,
      route: { outcome: "succeeded", result: { verdict: true } },
    });
  });

  it("sanitizes runtime-generated mismatch diagnostics before every receipt", async () => {
    const journal: WorkflowJournalEntry[] = [];
    const { host } = strictHost(request => ({
      attempt: receipt(request, {
        observedModel: '\u001b[31mprovider/substitute token="secret value"',
      }),
      text: "discarded",
    }));
    const result = await run(`return await strictAgent("review", ${OPTIONS});`, host, {
      append(entry) { journal.push(entry); },
    });
    const route = result.value as { failure: { message: string } };

    expect(route.failure.message).not.toContain("\u001b");
    expect(route.failure.message).not.toContain("secret value");
    expect(journal[0].strict?.attempt.failure?.message).toBe(route.failure.message);
  });

  it("turns a host-side schema mismatch into terminal SCHEMA_REJECTED", async () => {
    const { host, attempts } = strictHost(request => ({
      attempt: receipt(request),
      text: JSON.stringify({ verdict: "not-boolean" }),
    }));
    const result = await run(
      `return await strictAgent("review", { ...${OPTIONS}, schema: { type: "object", properties: { verdict: { type: "boolean" } }, required: ["verdict"] } });`,
      host,
    );

    expect(attempts).toHaveLength(1);
    expect(result.value).toMatchObject({
      outcome: "failed",
      failure: { code: "SCHEMA_REJECTED" },
      attempts: [{ outcome: "post-execution-failure", failure: { code: "SCHEMA_REJECTED" } }],
    });
  });

  it("reserves fallback capacity before concurrent calls can exceed the agent cap", async () => {
    const { host, attempts } = strictHost(request =>
      request.prompt === "first"
        ? new Promise<WorkflowStrictAttemptResult>(() => {})
        : { attempt: receipt(request), text: "second" },
    );
    const result = await runWorkflow({
      script: HEAD + `return await parallel([
        () => strictAgent("first", ${OPTIONS}),
        () => strictAgent("second", ${OPTIONS})
      ]);`,
      host,
      agentCap: 3,
    });

    expect(result.status).toBe("failed");
    expect(result.error).toContain("exceeding its cap of 3 agents");
    expect(attempts.length).toBeLessThanOrEqual(1);
  });

  it("assigns strict call indices before a concurrent ordinary agent", async () => {
    const { host } = strictHost();
    const result = await run(
      `return await parallel([
        () => strictAgent("strict", ${OPTIONS}),
        () => agent("ordinary")
      ]);`,
      host,
    );
    const final = result.progress.filter((entry): entry is WorkflowAgentEntry =>
      entry.type === "workflow_agent" && (entry.state === "done" || entry.state === "error"),
    );

    expect(result.status).toBe("completed");
    expect(final.map(entry => entry.index).sort((a, b) => a - b)).toEqual([0, 2]);
    expect(result.agentCount).toBe(2);
  });

  it("does not start a fallback while the workflow is paused", async () => {
    let control: WorkflowControl | undefined;
    let primaryStarted = () => {};
    let releasePrimary = () => {};
    const started = new Promise<void>(resolve => { primaryStarted = resolve; });
    const release = new Promise<void>(resolve => { releasePrimary = resolve; });
    const { host, attempts } = strictHost(async request => {
      if (request.candidateIndex === 0) {
        primaryStarted();
        await release;
        return {
          attempt: receipt(request, {
            observedModel: undefined,
            observedEffort: undefined,
            outcome: "pre-execution-failure",
            failure: { code: "MODEL_UNAVAILABLE", message: "missing" },
            evidence: emptyStrictExecutionEvidence(),
          }),
        };
      }
      return { attempt: receipt(request), text: "fallback" };
    });
    const running = runWorkflow({
      script: HEAD + `return await strictAgent("review", ${OPTIONS});`,
      host,
      onControl(value) { control = value; },
    });

    await started;
    control?.pause();
    releasePrimary();
    await new Promise(resolve => setTimeout(resolve, 25));
    expect(attempts).toHaveLength(1);
    control?.resume();
    const result = await running;

    expect(result.status).toBe("completed");
    expect(attempts).toHaveLength(2);
  });

  it("runs sibling routes concurrently while preserving result order", async () => {
    let releaseFirst = () => {};
    let firstStarted = () => {};
    const firstGate = new Promise<void>(resolve => { releaseFirst = resolve; });
    const started = new Promise<void>(resolve => { firstStarted = resolve; });
    const { host } = strictHost(async request => {
      if (request.prompt === "first") {
        firstStarted();
        await firstGate;
      } else {
        await started;
        releaseFirst();
      }
      return { attempt: receipt(request), text: request.prompt };
    });
    const result = await run(
      `return await parallel([
        () => strictAgent("first", ${OPTIONS}),
        () => strictAgent("second", ${OPTIONS})
      ]);`,
      host,
    );

    expect((result.value as Array<{ result: string }>).map(route => route.result))
      .toEqual(["first", "second"]);
  });

  it("keeps ordinary agent() behavior unchanged beside strictAgent()", async () => {
    const { host } = strictHost();
    const result = await run(
      `return [await agent("ordinary"), await strictAgent("strict", ${OPTIONS})];`,
      host,
    );
    expect((result.value as unknown[])[0]).toBe("ordinary:ordinary");
    expect((result.value as Array<unknown>)[1]).toMatchObject({ outcome: "succeeded" });
  });

  it("records one machine-readable progress and journal entry per attempt", async () => {
    const journal: WorkflowJournalEntry[] = [];
    const { host } = strictHost(request => request.candidateIndex === 0
      ? {
          attempt: receipt(request, {
            observedModel: undefined,
            observedEffort: undefined,
            outcome: "pre-execution-failure",
            failure: { code: "AUTH_UNAVAILABLE", message: "no auth" },
            evidence: emptyStrictExecutionEvidence(),
          }),
        }
      : { attempt: receipt(request), text: "done" });

    const result = await run(`return await strictAgent("review", ${OPTIONS});`, host, {
      append(entry) { journal.push(entry); },
    });

    const progressRows = finalStrictRows(result.progress);
    expect(progressRows).toHaveLength(2);
    expect(progressRows.every(entry => entry.resultPreview === undefined)).toBe(true);
    expect(journal).toHaveLength(2);
    expect(journal.every(entry => entry.kind === "strict-attempt" && entry.text === undefined)).toBe(true);
    expect(journal.map(entry => entry.strict?.attempt.outcome)).toEqual([
      "pre-execution-failure",
      "selected",
    ]);
  });

  it("rejects journal replay at the first completed strict call", async () => {
    const firstJournal: WorkflowJournalEntry[] = [];
    const first = strictHost();
    await run(`return await strictAgent("review", ${OPTIONS});`, first.host, {
      append(entry) { firstJournal.push(entry); },
    });

    const second = strictHost();
    const result = await run(
      `try { await strictAgent("review", ${OPTIONS}); return null; }
       catch (error) { return { name: error.name, code: error.code, message: error.message }; }`,
      second.host,
      { entries: firstJournal },
    );

    expect(second.attempts).toHaveLength(0);
    expect(result.value).toMatchObject({
      name: "StrictAgentContractError",
      code: "STRICT_REPLAY_UNSUPPORTED",
    });
  });

  it.each([
    [false, "pre-execution-failure"],
    [true, "post-execution-failure"],
  ] as const)("journals cancellation with executionStarted=%s", async (executionStarted, outcome) => {
    const controller = new AbortController();
    const journal: WorkflowJournalEntry[] = [];
    const abortAgent = vi.fn();
    let started = () => {};
    const admitted = new Promise<void>(resolve => { started = resolve; });
    const host: WorkflowHost = {
      async spawnAgent() { return { ok: true, text: "ordinary" }; },
      abortAgent,
      validateStrictAgent(request) { return { ok: true, agentType: request.agentType }; },
      async spawnStrictAttempt(request) {
        request.onEvidence?.({
          ...emptyStrictExecutionEvidence(),
          executionStarted,
        });
        started();
        return await new Promise<WorkflowStrictAttemptResult>(() => {});
      },
    };
    const running = runWorkflow({
      script: HEAD + `return await strictAgent("review", ${OPTIONS});`,
      host,
      signal: controller.signal,
      journal: { append(entry) { journal.push(entry); } },
    });

    await admitted;
    controller.abort();
    const result = await running;

    expect(result.status).toBe("killed");
    expect(abortAgent).toHaveBeenCalledTimes(1);
    expect(journal).toHaveLength(1);
    expect(journal[0]).toMatchObject({
      kind: "strict-attempt",
      ok: false,
      strict: {
        attempt: {
          outcome,
          failure: { code: "CANCELLED" },
          evidence: { executionStarted },
        },
      },
    });
    expect(finalStrictRows(result.progress)).toHaveLength(1);
  });

  it.each([
    [{ ...OPTIONS_VALUE, contractVersion: 2 }, "UNSUPPORTED_CONTRACT_VERSION"],
    [{ ...OPTIONS_VALUE, model: "fuzzy" }, "INVALID_MODEL_ID"],
    [{ ...OPTIONS_VALUE, fallbackModels: ["provider/primary"] }, "INVALID_MODEL_ID"],
    [{ ...OPTIONS_VALUE, effort: "ultra" }, "UNSUPPORTED_EFFORT"],
    [{ ...OPTIONS_VALUE, isolation: "off" }, "INVALID_ISOLATION"],
    [{ ...OPTIONS_VALUE, schema: [] }, "INVALID_SCHEMA"],
  ])("rejects invalid invocation with typed code %s", async (options, code) => {
    const { host, attempts } = strictHost();
    const result = await run(
      `try {
         await strictAgent("review", ${JSON.stringify(options)});
         return null;
       } catch (error) {
         return { name: error.name, code: error.code };
       }`,
      host,
    );
    expect(attempts).toHaveLength(0);
    expect(result.value).toEqual({ name: "StrictAgentContractError", code });
  });

  it("surfaces incompatible Pi capability as a typed pre-launch error", async () => {
    const spawnStrictAttempt = vi.fn();
    const host: WorkflowHost = {
      async spawnAgent() { return { ok: true, text: "ordinary" }; },
      abortAgent() {},
      validateStrictAgent() {
        return {
          ok: false,
          failure: {
            code: "INCOMPATIBLE_PI_RUNTIME",
            message: '\u001b[31mmissing final preflight token="secret value"',
          },
        };
      },
      spawnStrictAttempt,
    };
    const result = await run(
      `try { await strictAgent("review", ${OPTIONS}); return null; }
       catch (error) { return { code: error.code, message: error.message }; }`,
      host,
    );
    expect(spawnStrictAttempt).not.toHaveBeenCalled();
    expect(result.value).toEqual({
      code: "INCOMPATIBLE_PI_RUNTIME",
      message: "missing final preflight token=[redacted]",
    });
  });

  it("raises typed contract failures before any route attempt", async () => {
    const { host, attempts } = strictHost();
    const result = await run(
      `try {
         await strictAgent("review", { ...${OPTIONS}, model: "fuzzy", unknown: true });
         return null;
       } catch (error) {
         return { name: error.name, code: error.code };
       }`,
      host,
    );

    expect(attempts).toHaveLength(0);
    expect(result.value).toEqual({ name: "StrictAgentContractError", code: "INVALID_ARGUMENT" });
  });

  it("fails unknown roles without using the ordinary fallback agent", async () => {
    const { host, attempts } = strictHost();
    const result = await run(
      `try {
         await strictAgent("review", { ...${OPTIONS}, agentType: "missing" });
         return null;
       } catch (error) {
         return { code: error.code };
       }`,
      host,
    );
    expect(attempts).toHaveLength(0);
    expect(result.value).toEqual({ code: "UNKNOWN_AGENT_TYPE" });
  });
});
