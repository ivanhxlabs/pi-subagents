/**
 * workflow-effective-config.test.ts — the host half of #168/#182 for workflows.
 *
 * Every other subagent surface names the model the child ACTUALLY ran on, read
 * back from its session onto `AgentRecord.invocation` once pi has resolved its
 * defaults and clamped the thinking level. Workflow rows used to be the
 * exception: they showed `payload.model`, the raw string the script wrote, so a
 * fuzzy `"haiku"` stayed `"haiku"` and an `agent()` that named no model showed
 * nothing at all for the whole run.
 *
 * The runtime side — that a reported value updates the row in place, mid-run —
 * is covered in `test/workflow-runtime.test.ts`. This file covers the seam that
 * feeds it: the host reading the record's snapshot and handing it over.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/agent-runner.js", () => ({
  runAgent: vi.fn(),
  resumeAgent: vi.fn(),
}));

vi.mock("../src/worktree.js", () => ({
  createWorktree: vi.fn(),
  cleanupWorktree: vi.fn(async () => ({ hasChanges: false })),
  pruneWorktrees: vi.fn(async () => {}),
  isWorktreeIsolationEnabled: vi.fn(() => false),
}));

import { AgentManager } from "../src/agent-manager.js";
import { runAgent } from "../src/agent-runner.js";
import { registerAgents } from "../src/agent-types.js";
import { createWorkflowHost } from "../src/workflow/host.js";
import type {
  WorkflowSpawnRequest,
  WorkflowStrictAgentRequest,
  WorkflowStrictAttemptRequest,
} from "../src/workflow/runtime.js";
import { ctx } from "./helpers/boot-extension.js";

const pi = {} as any;

const spawnRequest = (overrides: Partial<WorkflowSpawnRequest> = {}): WorkflowSpawnRequest => ({
  agentId: "wf-agent-0",
  index: 0,
  prompt: "do the thing",
  label: "impl",
  agentType: "general-purpose",
  ...overrides,
});

/**
 * Collect only the reports that say something about the child's EFFECTIVE
 * configuration.
 *
 * The host fires `onResolved` once more than these tests are about: the moment
 * the manager issues a record id it reports that id and nothing else, ahead of
 * any session, so a child that dies before one exists is still openable in the
 * inspector. Every test below is about the configuration half, so the id is
 * stripped and an id-only report is dropped; that it fires at all has its own
 * test at the bottom.
 */
function configCollector(into: Record<string, unknown>[]) {
  return (info: Record<string, unknown>) => {
    const { recordId: _recordId, ...rest } = info;
    if (Object.keys(rest).length > 0) into.push(rest);
  };
}

/**
 * Stand in for pi resolving the child's session.
 *
 * The real `runAgent` invokes the `onSessionCreated` the manager hands it, and
 * the manager's own handler is what writes `describeModel(session.model)` onto
 * the record before passing the session along — so firing this is what makes
 * `record.invocation` populated by the time the host reads it.
 */
function childSessionReports(session: { model?: unknown; thinkingLevel?: string }) {
  vi.mocked(runAgent).mockImplementation(async (_ctx: any, _type: any, _prompt: any, opts: any) => {
    opts.onSessionCreated?.({ dispose: vi.fn(), ...session } as any);
    return { responseText: "done", session: { dispose: vi.fn() } as any, aborted: false, steered: false };
  });
}

const STRICT_AGENT_TYPE = {
  name: "hx-reviewer-a",
  description: "Strict reviewer",
  builtinToolNames: ["read"],
  extensions: false,
  skills: false,
  systemPrompt: "Review.",
  promptMode: "replace",
} as const;

function strictRegistry(model?: { provider: string; id: string; name?: string }) {
  const models = model === undefined ? [] : [model];
  return {
    find: vi.fn((provider: string, id: string) =>
      models.find(entry => entry.provider === provider && entry.id === id)),
    getAll: vi.fn(() => models),
    getAvailable: vi.fn(() => models),
    runtime: {
      getModel: vi.fn(),
      getAvailable: vi.fn(async () => models),
      hasConfiguredAuth: vi.fn(() => true),
    },
  };
}

function strictValidationRequest(): WorkflowStrictAgentRequest {
  return {
    contractVersion: 1,
    prompt: "review",
    agentType: "hx-reviewer-a",
    model: "provider/exact",
    fallbackModels: [],
    effort: "high",
  };
}

function strictAttemptRequest(
  overrides: Partial<WorkflowStrictAttemptRequest> = {},
): WorkflowStrictAttemptRequest {
  return {
    launchId: "strict_launch",
    attemptId: "strict_launch:0",
    agentId: "wf-strict-0",
    candidateIndex: 0,
    prompt: "review",
    agentType: "hx-reviewer-a",
    model: "provider/exact",
    effort: "high",
    ...overrides,
  };
}

function createStrictHost(
  manager: AgentManager,
  modelRegistry: ReturnType<typeof strictRegistry>,
  agentConfig: Record<string, unknown> = STRICT_AGENT_TYPE,
) {
  return createWorkflowHost({
    pi,
    ctx: ctx({ modelRegistry }),
    manager,
    strictAgentRegistry: new Map([["hx-reviewer-a", agentConfig as any]]),
  });
}

describe("the workflow host reports a child's effective configuration", () => {
  let manager: AgentManager;

  beforeEach(() => {
    vi.mocked(runAgent).mockReset();
    registerAgents(new Map());
    manager = new AgentManager();
  });

  it("hands over the model the session actually resolved to, not the script's spelling", async () => {
    // `name` too: resolveModel fuzzy-matches across id, name and provider/id.
    const haiku = { provider: "anthropic", id: "claude-haiku-4-5", name: "Haiku 4.5" };
    childSessionReports({ model: haiku });
    // The registry has to resolve the script's fuzzy spelling, or the spawn is
    // refused before it ever reaches a session — which is the correct behaviour
    // for an unresolvable model, and not what this test is about.
    const host = createWorkflowHost({
      pi,
      ctx: ctx({ modelRegistry: { find: vi.fn(() => haiku), getAvailable: vi.fn(() => [haiku]) } }),
      manager,
    });
    const reported: unknown[] = [];

    // The script asked fuzzily; the row must not keep saying "haiku".
    await host.spawnAgent(spawnRequest({ model: "haiku", onResolved: configCollector(reported) }));

    expect(reported).toHaveLength(1);
    expect(reported[0]).toMatchObject({ modelId: "anthropic/claude-haiku-4-5" });
    expect((reported[0] as { modelName?: string }).modelName).toBeTruthy();
  });

  it("reports for an agent that named no model — the inherited case", async () => {
    childSessionReports({ model: { provider: "anthropic", id: "claude-sonnet-4-6" } });
    const host = createWorkflowHost({ pi, ctx: ctx({}), manager });
    const reported: { modelId?: string }[] = [];

    await host.spawnAgent(spawnRequest({ onResolved: configCollector(reported) }));

    // This is the one #168 was filed about: nothing was requested, so without
    // the read-back there is nothing at all to render.
    expect(reported[0]?.modelId).toBe("anthropic/claude-sonnet-4-6");
  });

  it("discloses a thinking level pi clamped below what was asked for (#182)", async () => {
    childSessionReports({ model: { provider: "anthropic", id: "claude-haiku-4-5" }, thinkingLevel: "low" });
    const host = createWorkflowHost({ pi, ctx: ctx({}), manager });
    const reported: { thinking?: string; requestedThinking?: string }[] = [];

    await host.spawnAgent(spawnRequest({ effort: "max", onResolved: configCollector(reported) }));

    // Both halves, or the row cannot say "low (asked max)" — and without the
    // seeded request there would be nothing for the manager to compare against.
    expect(reported[0]?.thinking).toBe("low");
    expect(reported[0]?.requestedThinking).toBe("max");
  });

  // Why the workflow path never discloses a model override at all: unlike the
  // Agent tool (`agentConfig?.model ?? params.model`), this path resolves
  // `request.model ?? config?.model`, so the script outranks the agent file and
  // therefore always got the model it asked for. Seeding a `requestedModel` here
  // would describe a precedence that does not exist.
  it("lets the script's model outrank the agent file's, so there is nothing to disclose", async () => {
    const haiku = { provider: "anthropic", id: "claude-haiku-4-5", name: "Haiku 4.5" };
    const opus = { provider: "anthropic", id: "claude-opus-4-6", name: "Opus 4.6" };
    registerAgents(new Map([["pinned", { name: "pinned", model: "anthropic/claude-opus-4-6" } as any]]));
    childSessionReports({ model: haiku });
    const host = createWorkflowHost({
      pi,
      ctx: ctx({
        modelRegistry: {
          // Resolves by what it was ASKED for — a stub that answers `haiku` to
          // everything would let the assertion below pass whichever model won.
          find: vi.fn((provider: string, id: string) =>
            [haiku, opus].find(m => m.provider === provider && m.id === id),
          ),
          getAvailable: vi.fn(() => [haiku, opus]),
        },
      }),
      manager,
    });
    const reported: { requestedModel?: string }[] = [];

    await host.spawnAgent(
      spawnRequest({ agentType: "pinned", model: "haiku", onResolved: configCollector(reported) }),
    );

    // The script's "haiku" won over the file's pinned opus...
    expect(vi.mocked(runAgent).mock.calls[0]?.[3]).toMatchObject({ model: haiku });
    // ...so nothing was overridden, and nothing is disclosed.
    expect(reported[0]?.requestedModel).toBeUndefined();
  });

  it("says nothing about a level that was honoured", async () => {
    childSessionReports({ model: { provider: "anthropic", id: "claude-haiku-4-5" }, thinkingLevel: "low" });
    const host = createWorkflowHost({ pi, ctx: ctx({}), manager });
    const reported: { requestedThinking?: string }[] = [];

    await host.spawnAgent(spawnRequest({ effort: "low", onResolved: configCollector(reported) }));

    expect(reported[0]?.requestedThinking).toBeUndefined();
  });

  it("does not fire when the session never reports a model", async () => {
    // A stubbed or older session must degrade to "nothing to say" rather than
    // firing an empty report, which would cost the row a pointless redraw.
    // Deliberately requests no model: passing an unresolvable one would refuse
    // the spawn outright and this would pass without reaching a session at all.
    childSessionReports({});
    const host = createWorkflowHost({ pi, ctx: ctx({}), manager });
    const reported: Record<string, unknown>[] = [];

    await host.spawnAgent(spawnRequest({ onResolved: configCollector(reported) }));

    expect(reported).toEqual([]);
  });

  it("reports the record id ahead of any session, so the row is openable either way", async () => {
    // The inspector's `c` key opens the manager's record for this child. The
    // id is knowable as soon as the manager issues it, and gating it on the
    // session — as the configuration half is — would leave exactly the
    // children worth reading, the ones that died in startup, unopenable.
    childSessionReports({});
    const host = createWorkflowHost({ pi, ctx: ctx({}), manager });
    const reported: { recordId?: string }[] = [];

    await host.spawnAgent(spawnRequest({ onResolved: info => reported.push(info) }));

    expect(reported).toHaveLength(1);
    // The id the manager issued, and not the run's own `wf-agent-0` handle,
    // which means nothing outside the runtime.
    const recordId = reported[0]?.recordId;
    expect(recordId).toBeTruthy();
    expect(recordId).not.toBe("wf-agent-0");
    expect(manager.getRecord(recordId!)).toBeDefined();
  });
});

describe("the workflow host strict attempt boundary", () => {
  let manager: AgentManager;
  const model = { provider: "provider", id: "exact", name: "Exact" };

  beforeEach(() => {
    vi.mocked(runAgent).mockReset();
    registerAgents(new Map([["hx-reviewer-a", STRICT_AGENT_TYPE as any]]));
    manager = new AgentManager();
  });

  it("keeps strict role resolution scoped to each session cwd", () => {
    const a = mkdtempSync(join(tmpdir(), "strict-registry-a-"));
    const b = mkdtempSync(join(tmpdir(), "strict-registry-b-"));
    const agentFile = (name: string) => [
      "---",
      `name: ${name}`,
      `description: ${name}`,
      "tools: read",
      "extensions: false",
      "skills: false",
      "---",
      "Review.",
    ].join("\n");
    try {
      mkdirSync(join(a, ".pi", "agents"), { recursive: true });
      mkdirSync(join(b, ".pi", "agents"), { recursive: true });
      writeFileSync(join(a, ".pi", "agents", "strict-a.md"), agentFile("strict-a"));
      writeFileSync(join(b, ".pi", "agents", "strict-b.md"), agentFile("strict-b"));
      const modelRegistry = strictRegistry(model);
      const hostA = createWorkflowHost({ pi, ctx: ctx({ cwd: a, modelRegistry }), manager });
      const hostB = createWorkflowHost({ pi, ctx: ctx({ cwd: b, modelRegistry }), manager });

      expect(hostA.validateStrictAgent?.({
        ...strictValidationRequest(),
        agentType: "strict-a",
      })).toMatchObject({ ok: true, agentType: "strict-a" });
      expect(hostB.validateStrictAgent?.({
        ...strictValidationRequest(),
        agentType: "strict-a",
      })).toMatchObject({ ok: false, failure: { code: "UNKNOWN_AGENT_TYPE" } });
      expect(hostB.validateStrictAgent?.({
        ...strictValidationRequest(),
        agentType: "strict-b",
      })).toMatchObject({ ok: true, agentType: "strict-b" });
    } finally {
      rmSync(a, { recursive: true, force: true });
      rmSync(b, { recursive: true, force: true });
    }
  });

  it("validates exact session-owned roles without fallback", () => {
    const host = createStrictHost(manager, strictRegistry(model));

    expect(host.validateStrictAgent?.(strictValidationRequest())).toEqual({
      ok: true,
      agentType: "hx-reviewer-a",
    });
    expect(host.validateStrictAgent?.({
      ...strictValidationRequest(),
      agentType: "HX-REVIEWER-A",
    })).toMatchObject({ ok: false, failure: { code: "UNKNOWN_AGENT_TYPE" } });
  });

  it("snapshots caller-provided registries and role objects before validation", async () => {
    const mutable = {
      ...STRICT_AGENT_TYPE,
      isolated: true,
      builtinToolNames: ["read"],
    };
    const registry = new Map([["hx-reviewer-a", mutable as any]]);
    const host = createWorkflowHost({
      pi,
      ctx: ctx({ modelRegistry: strictRegistry(model) }),
      manager,
      strictAgentRegistry: registry,
    });
    registry.clear();
    mutable.isolated = false;
    mutable.builtinToolNames.push("write");

    expect(host.validateStrictAgent?.(strictValidationRequest()))
      .toMatchObject({ ok: true, agentType: "hx-reviewer-a" });
    vi.mocked(runAgent).mockImplementation(async (_ctx: any, _type: any, _prompt: any, opts: any) => {
      const session = { model, thinkingLevel: "high", dispose: vi.fn() } as any;
      opts.onSessionCreated?.(session);
      opts.strictAttempt.onObserved({ model: "provider/exact", effort: "high" });
      opts.strictAttempt.onEvidence({
        executionStarted: true,
        assistantMessageStartedCount: 1,
        assistantOutputEventCount: 1,
        toolCallStartedCount: 0,
      });
      return { responseText: "done", session, aborted: false, steered: false };
    });

    await host.spawnStrictAttempt?.(strictAttemptRequest());

    expect(vi.mocked(runAgent).mock.calls[0]?.[3].agentConfigOverride).toMatchObject({
      isolated: true,
      builtinToolNames: ["read"],
    });
  });

  it("returns a selected attempt with runtime observations and start counters", async () => {
    const registry = strictRegistry(model);
    vi.mocked(runAgent).mockImplementation(async (_ctx: any, _type: any, _prompt: any, opts: any) => {
      const session = { model, thinkingLevel: "high", dispose: vi.fn() } as any;
      opts.onSessionCreated?.(session);
      opts.strictAttempt.onObserved({ model: "provider/exact", effort: "high" });
      opts.strictAttempt.onEvidence({
        executionStarted: true,
        assistantMessageStartedCount: 1,
        assistantOutputEventCount: 2,
        toolCallStartedCount: 1,
      });
      return { responseText: "done", session, aborted: false, steered: false };
    });
    const host = createStrictHost(manager, registry);

    const result = await host.spawnStrictAttempt?.(strictAttemptRequest());

    expect(result).toMatchObject({
      text: "done",
      toolCalls: 1,
      attempt: {
        outcome: "selected",
        observedModel: "provider/exact",
        observedEffort: "high",
        evidence: {
          executionStarted: true,
          assistantMessageStartedCount: 1,
          assistantOutputEventCount: 2,
          toolCallStartedCount: 1,
        },
      },
    });
    expect(vi.mocked(runAgent).mock.calls[0]?.[3]).toMatchObject({
      model,
      agentConfigOverride: STRICT_AGENT_TYPE,
      thinkingLevel: "high",
      strictAttempt: expect.any(Object),
    });
  });

  it("executes the validated role's isolation and context restrictions", async () => {
    const restricted = {
      ...STRICT_AGENT_TYPE,
      isolated: true,
      inheritContext: true,
    };
    vi.mocked(runAgent).mockImplementation(async (_ctx: any, _type: any, _prompt: any, opts: any) => {
      const session = { model, thinkingLevel: "high", dispose: vi.fn() } as any;
      opts.onSessionCreated?.(session);
      opts.strictAttempt.onObserved({ model: "provider/exact", effort: "high" });
      opts.strictAttempt.onEvidence({
        executionStarted: true,
        assistantMessageStartedCount: 1,
        assistantOutputEventCount: 1,
        toolCallStartedCount: 0,
      });
      return { responseText: "done", session, aborted: false, steered: false };
    });
    const host = createStrictHost(manager, strictRegistry(model), restricted);

    await host.spawnStrictAttempt?.(strictAttemptRequest());

    expect(vi.mocked(runAgent).mock.calls[0]?.[3]).toMatchObject({
      agentConfigOverride: restricted,
      isolated: true,
      inheritContext: true,
    });
  });

  it("rejects caller worktree isolation when the validated role refuses it", () => {
    const host = createStrictHost(manager, strictRegistry(model), {
      ...STRICT_AGENT_TYPE,
      isolation: "off",
    });

    expect(host.validateStrictAgent?.({
      ...strictValidationRequest(),
      isolation: "worktree",
    })).toMatchObject({ ok: false, failure: { code: "INVALID_ISOLATION" } });
  });

  it("reports unavailable exact models before creating a child", async () => {
    const host = createStrictHost(manager, strictRegistry());

    const result = await host.spawnStrictAttempt?.(strictAttemptRequest());

    expect(result).toMatchObject({
      attempt: {
        outcome: "pre-execution-failure",
        failure: { code: "MODEL_UNAVAILABLE" },
        evidence: {
          executionStarted: false,
          assistantMessageStartedCount: 0,
          assistantOutputEventCount: 0,
          toolCallStartedCount: 0,
        },
      },
    });
    expect(runAgent).not.toHaveBeenCalled();
  });

  it("preserves a typed final-preflight mismatch with zero-execution proof", async () => {
    vi.mocked(runAgent).mockImplementation(async (_ctx: any, _type: any, _prompt: any, opts: any) => {
      const session = { model, thinkingLevel: "high", dispose: vi.fn() } as any;
      opts.onSessionCreated?.(session);
      opts.strictAttempt.onObserved({ model: "provider/substitute", effort: "high" });
      opts.strictAttempt.onFailure("CANONICAL_MODEL_MISMATCH", "substituted");
      throw new Error("substituted");
    });
    const host = createStrictHost(manager, strictRegistry(model));

    const result = await host.spawnStrictAttempt?.(strictAttemptRequest());

    expect(result).toMatchObject({
      attempt: {
        outcome: "pre-execution-failure",
        observedModel: "provider/substitute",
        failure: { code: "CANONICAL_MODEL_MISMATCH" },
        evidence: { executionStarted: false },
      },
    });
  });

  it("classifies provider failure after handoff as terminal", async () => {
    vi.mocked(runAgent).mockImplementation(async (_ctx: any, _type: any, _prompt: any, opts: any) => {
      const session = { model, thinkingLevel: "high", dispose: vi.fn() } as any;
      opts.onSessionCreated?.(session);
      opts.strictAttempt.onObserved({ model: "provider/exact", effort: "high" });
      opts.strictAttempt.onEvidence({
        executionStarted: true,
        assistantMessageStartedCount: 1,
        assistantOutputEventCount: 1,
        toolCallStartedCount: 0,
      });
      opts.strictAttempt.onFailure("PROVIDER_FAILED", "remote refusal");
      return {
        responseText: "partial",
        session,
        aborted: false,
        steered: false,
        failure: "remote refusal",
      };
    });
    const host = createStrictHost(manager, strictRegistry(model));

    const result = await host.spawnStrictAttempt?.(strictAttemptRequest());

    expect(result).toMatchObject({
      attempt: {
        outcome: "post-execution-failure",
        failure: { code: "PROVIDER_FAILED" },
        evidence: { executionStarted: true },
      },
    });
  });
});
