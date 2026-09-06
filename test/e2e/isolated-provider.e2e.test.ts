/**
 * Real Pi model-runtime and OAuth regressions.
 *
 * These tests pin the private ModelRegistry.runtime compatibility seam, legacy
 * resume ownership, and strict attempts using fresh child sessions while
 * sharing the parent-owned credential runtime. No network or real credential is
 * used.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as ai from "@earendil-works/pi-ai";
import * as codingAgent from "@earendil-works/pi-coding-agent";
import { afterAll, describe, expect, it } from "vitest";
import { AgentManager } from "../../src/agent-manager.js";
import { registerAgents } from "../../src/agent-types.js";
import type { AgentConfig } from "../../src/types.js";
import { createWorkflowHost } from "../../src/workflow/host.js";

interface ModelRuntimeLike {
  registerProvider(id: string, config: Record<string, unknown>): void;
  getModel(provider: string, modelId: string): unknown;
}

type OAuthLike = { type: "oauth"; access: string; refresh: string; expires: number };
type MessageLike = { role?: unknown; content?: unknown };
type ModelLike = { api: string; provider: string; id: string };
type ContextLike = { messages: MessageLike[] };
type StreamOptionsLike = { apiKey?: string };
type TextBlock = { type: "text"; text: string };

const codingAgentNamespace = codingAgent as Record<string, unknown>;
const aiNamespace = ai as Record<string, unknown>;
const ModelRuntime = codingAgentNamespace.ModelRuntime as {
  create(opts?: Record<string, unknown>): Promise<ModelRuntimeLike>;
};
const ModelRegistry = codingAgentNamespace.ModelRegistry as new (
  runtime: ModelRuntimeLike,
) => codingAgent.ExtensionContext["modelRegistry"] & { runtime?: unknown };
const InMemoryCredentialStore = aiNamespace.InMemoryCredentialStore as new () => {
  read(providerId: string): Promise<unknown>;
  modify(providerId: string, fn: (current: unknown) => Promise<unknown>): Promise<unknown>;
};
const createAssistantMessageEventStream = aiNamespace.createAssistantMessageEventStream as () => {
  push(event: unknown): void;
  end(result?: unknown): void;
};

const tmpDirs: string[] = [];
afterAll(() => {
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function makePi(): codingAgent.ExtensionAPI {
  return {
    exec: async () => ({ code: 1, stdout: "", stderr: "", killed: false }),
  } as unknown as codingAgent.ExtensionAPI;
}

function isTextBlock(block: unknown): block is TextBlock {
  return typeof block === "object" && block !== null &&
    (block as { type?: unknown }).type === "text" &&
    typeof (block as { text?: unknown }).text === "string";
}

function messageText(messages: MessageLike[], role: "user" | "assistant"): string[] {
  return messages
    .filter(message => message.role === role)
    .map(message => {
      if (typeof message.content === "string") return message.content;
      return Array.isArray(message.content)
        ? message.content.filter(isTextBlock).map(block => block.text).join("\n")
        : "";
    });
}

function completedTextStream(model: ModelLike, text: string) {
  const stream = createAssistantMessageEventStream();
  const usage = {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
  const base = {
    role: "assistant",
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage,
    stopReason: "stop",
    timestamp: Date.now(),
  };
  const started = { ...base, content: [] };
  const textStarted = { ...base, content: [{ type: "text", text: "" }] };
  const message = { ...base, content: [{ type: "text", text }] };
  stream.push({ type: "start", partial: started });
  stream.push({ type: "text_start", contentIndex: 0, partial: textStarted });
  stream.push({ type: "text_delta", contentIndex: 0, delta: text, partial: message });
  stream.push({ type: "text_end", contentIndex: 0, content: text, partial: message });
  stream.push({ type: "done", reason: "stop", message });
  stream.end(message);
  return stream;
}

function oauthAgent(name: string): AgentConfig {
  return {
    name,
    description: `${name} OAuth session probe`,
    systemPrompt: "Return the requested marker.",
    promptMode: "replace",
    builtinToolNames: [],
    extensions: false,
    skills: false,
    isolated: true,
    inheritContext: false,
    runInBackground: false,
    persistSession: false,
  };
}

describe("real Pi model runtime compatibility", () => {
  it("exposes the canonical runtime through ModelRegistry", async () => {
    const dir = mkdtempSync(join(tmpdir(), "iso-prov-"));
    tmpDirs.push(dir);
    const runtime = await ModelRuntime.create({
      authPath: join(dir, "auth.json"),
      modelsPath: join(dir, "models.json"),
      allowModelNetwork: false,
    });
    const facade = new ModelRegistry(runtime);
    expect(facade.runtime).toBe(runtime);
  });

  it("keeps parent OAuth ownership and the same real child session across legacy resume", async () => {
    const provider = "legacy-oauth";
    const modelId = "context-probe";
    const transcriptMarker = "legacy-turn-one-marker";
    const credentials = new InMemoryCredentialStore();
    const refreshInputs: OAuthLike[] = [];
    const authInputs: OAuthLike[] = [];
    const calls: Array<{ apiKey?: string; userTexts: string[]; assistantTexts: string[] }> = [];

    await credentials.modify(provider, async () => ({
      type: "oauth",
      access: "expired-parent-access",
      refresh: "parent-refresh-marker",
      expires: 0,
    }));
    const runtime = await ModelRuntime.create({
      credentials,
      modelsPath: null,
      allowModelNetwork: false,
    });
    runtime.registerProvider(provider, {
      name: "Legacy OAuth",
      api: "legacy-oauth-test-api",
      baseUrl: "https://legacy-oauth.invalid",
      models: [{
        id: modelId,
        name: modelId,
        reasoning: false,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 10_000,
        maxTokens: 1_000,
      }],
      oauth: {
        name: "Legacy OAuth",
        async login() { throw new Error("login must not run"); },
        async refreshToken(current: OAuthLike) {
          refreshInputs.push(structuredClone(current));
          return {
            ...current,
            access: "rotated-parent-access",
            refresh: "rotated-parent-refresh",
            expires: Date.now() + 60 * 60_000,
          };
        },
        getApiKey(current: OAuthLike) {
          authInputs.push(structuredClone(current));
          return current.access;
        },
      },
      streamSimple(model: ModelLike, context: ContextLike, options?: StreamOptionsLike) {
        const userTexts = messageText(context.messages, "user");
        const assistantTexts = messageText(context.messages, "assistant");
        calls.push({ apiKey: options?.apiKey, userTexts, assistantTexts });
        const secondTurn = userTexts.some(text => text.includes("SECOND_PROMPT"));
        const sawHistory = assistantTexts.some(text => text.includes(transcriptMarker));
        return completedTextStream(
          model,
          secondTurn
            ? `turn-two-${sawHistory ? "resumed" : "lost"}:${transcriptMarker}`
            : `turn-one:${transcriptMarker}`,
        );
      },
    });

    const modelRegistry = new ModelRegistry(runtime);
    const model = runtime.getModel(provider, modelId) as ModelLike | undefined;
    expect(model).toBeDefined();
    const cwd = mkdtempSync(join(tmpdir(), "legacy-oauth-session-"));
    tmpDirs.push(cwd);
    const ctx = {
      cwd,
      getSystemPrompt: () => "PARENT",
      model,
      modelRegistry,
    } as Parameters<AgentManager["spawnAndWait"]>[1];
    const manager = new AgentManager();
    try {
      registerAgents(new Map([["legacy-oauth", oauthAgent("legacy-oauth")]]));
      const { id, record } = await manager.spawnAndWait(
        makePi(),
        ctx,
        "legacy-oauth",
        "FIRST_PROMPT",
        {
          description: "legacy oauth",
          model: model as never,
          isolated: true,
          inheritContext: false,
        },
      );
      expect(record.status).toBe("completed");
      const originalSession = record.session;
      const originalSessionId = originalSession?.sessionId;
      const firstMessageCount = originalSession?.messages.length ?? 0;

      const resumed = await manager.resume(id, "SECOND_PROMPT");
      expect(resumed?.session).toBe(originalSession);
      expect(resumed?.session?.sessionId).toBe(originalSessionId);
      expect(resumed?.session?.messages.length).toBeGreaterThan(firstMessageCount);
      expect(resumed?.result).toBe(`turn-two-resumed:${transcriptMarker}`);
      expect(refreshInputs).toHaveLength(1);
      expect(authInputs.length).toBeGreaterThanOrEqual(2);
      expect(authInputs.at(-1)).toMatchObject({ access: "rotated-parent-access" });
      expect(calls.map(call => call.apiKey)).toEqual([
        "rotated-parent-access",
        "rotated-parent-access",
      ]);
    } finally {
      await manager.dispose();
      registerAgents(new Map());
    }
  });

  it("forwards parent OAuth into distinct fresh strict child sessions", async () => {
    const provider = "strict-oauth";
    const modelId = "strict-context-probe";
    const credentials = new InMemoryCredentialStore();
    const refreshInputs: OAuthLike[] = [];
    const authInputs: OAuthLike[] = [];
    const requestKeys: Array<string | undefined> = [];

    await credentials.modify(provider, async () => ({
      type: "oauth",
      access: "expired-strict-access",
      refresh: "strict-refresh-marker",
      expires: 0,
    }));
    const runtime = await ModelRuntime.create({
      credentials,
      modelsPath: null,
      allowModelNetwork: false,
    });
    runtime.registerProvider(provider, {
      name: "Strict OAuth",
      api: "strict-oauth-test-api",
      baseUrl: "https://strict-oauth.invalid",
      models: [{
        id: modelId,
        name: modelId,
        reasoning: true,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 10_000,
        maxTokens: 1_000,
      }],
      oauth: {
        name: "Strict OAuth",
        async login() { throw new Error("login must not run"); },
        async refreshToken(current: OAuthLike) {
          refreshInputs.push(structuredClone(current));
          return {
            ...current,
            access: "rotated-strict-access",
            refresh: "rotated-strict-refresh",
            expires: Date.now() + 60 * 60_000,
          };
        },
        getApiKey(current: OAuthLike) {
          authInputs.push(structuredClone(current));
          return current.access;
        },
      },
      streamSimple(model: ModelLike, _context: ContextLike, options?: StreamOptionsLike) {
        requestKeys.push(options?.apiKey);
        return completedTextStream(model, "strict-auth-ok");
      },
    });

    const modelRegistry = new ModelRegistry(runtime);
    const model = runtime.getModel(provider, modelId) as ModelLike | undefined;
    expect(model).toBeDefined();
    const cwd = mkdtempSync(join(tmpdir(), "strict-oauth-session-"));
    tmpDirs.push(cwd);
    const manager = new AgentManager();
    const strictConfig = oauthAgent("strict-oauth");
    const ctx = {
      cwd,
      getSystemPrompt: () => "PARENT",
      model,
      modelRegistry,
      sessionManager: { getSessionFile: () => undefined },
      ui: { notify() {} },
    } as unknown as codingAgent.ExtensionContext;
    const host = createWorkflowHost({
      pi: makePi(),
      ctx,
      manager,
      strictAgentRegistry: new Map([["strict-oauth", strictConfig]]),
    });
    const recordIds: string[] = [];
    try {
      expect(host.validateStrictAgent?.({
        contractVersion: 1,
        prompt: "strict auth",
        agentType: "strict-oauth",
        model: `${provider}/${modelId}`,
        fallbackModels: [],
        effort: "high",
      })).toMatchObject({ ok: true });

      const launch = async (index: number) => host.spawnStrictAttempt?.({
        launchId: `strict-auth-${index}`,
        attemptId: `strict-auth-${index}:0`,
        agentId: `wf-strict-auth-${index}`,
        candidateIndex: 0,
        prompt: `STRICT_AUTH_${index}`,
        agentType: "strict-oauth",
        model: `${provider}/${modelId}`,
        effort: "high",
        onResolved(info) {
          if (info.recordId !== undefined) recordIds.push(info.recordId);
        },
      });
      const first = await launch(1);
      const second = await launch(2);

      expect(first?.attempt).toMatchObject({ outcome: "selected" });
      expect(second?.attempt).toMatchObject({ outcome: "selected" });
      expect(recordIds).toHaveLength(2);
      expect(recordIds[0]).not.toBe(recordIds[1]);
      expect(manager.getRecord(recordIds[0])?.session)
        .not.toBe(manager.getRecord(recordIds[1])?.session);
      expect(manager.getRecord(recordIds[0])?.session?.sessionId)
        .not.toBe(manager.getRecord(recordIds[1])?.session?.sessionId);
      expect(refreshInputs).toHaveLength(1);
      expect(authInputs.length).toBeGreaterThanOrEqual(2);
      expect(authInputs.at(-1)).toMatchObject({ access: "rotated-strict-access" });
      expect(requestKeys).toEqual(["rotated-strict-access", "rotated-strict-access"]);
      expect(await credentials.read(provider)).toMatchObject({
        access: "rotated-strict-access",
        refresh: "rotated-strict-refresh",
      });
    } finally {
      await manager.dispose();
    }
  });
});
