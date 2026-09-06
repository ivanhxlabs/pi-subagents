import { AgentSession, type ExtensionContext } from "@earendil-works/pi-coding-agent";

const TRUE_PREFLIGHT = /preflightResult\s*\?\.\s*\(\s*(?:true|!\s*0)\s*\)/g;
const FALSE_PREFLIGHT = /preflightResult\s*\?\.\s*\(\s*(?:false|!\s*1)\s*\)/;
const AGENT_PROMPT_HANDOFF = /this\._runAgentPrompt\s*\(/;

interface CompatibleModelRuntime {
  getModel(provider: string, modelId: string): unknown;
  getAvailable(providerId?: string): Promise<readonly unknown[]>;
  hasConfiguredAuth(providerId: string): boolean;
}

function isCompatibleModelRuntime(value: unknown): value is CompatibleModelRuntime {
  if (typeof value !== "object" || value === null) return false;
  const runtime = value as Record<string, unknown>;
  return (
    typeof runtime.getModel === "function" &&
    typeof runtime.getAvailable === "function" &&
    typeof runtime.hasConfiguredAuth === "function"
  );
}

/**
 * The extension context exposes a synchronous ModelRegistry facade while child
 * sessions require its canonical ModelRuntime. Pi has retained this property
 * since 0.80.8, but it is intentionally kept behind this compatibility adapter.
 */
export function strictModelRuntime(
  registry: ExtensionContext["modelRegistry"],
): CompatibleModelRuntime | undefined {
  const runtime = (registry as unknown as { runtime?: unknown }).runtime;
  return isCompatibleModelRuntime(runtime) ? runtime : undefined;
}

/**
 * Verify the exact pre-execution seam strict launches depend on.
 *
 * Version checks are deliberately absent: newer Pi releases remain eligible.
 * Capability drift fails only the opt-in strict path closed.
 */
export function strictPiCompatibilityError(
  registry: ExtensionContext["modelRegistry"],
  promptMethod: object = AgentSession.prototype.prompt,
): string | undefined {
  if (strictModelRuntime(registry) === undefined) {
    return "Pi does not expose the canonical model runtime required for strict child sessions.";
  }

  const source = Function.prototype.toString.call(promptMethod);
  const trueMatches = [...source.matchAll(TRUE_PREFLIGHT)];
  const finalTrue = trueMatches.at(-1)?.index ?? -1;
  const falseMatch = source.match(FALSE_PREFLIGHT)?.index ?? -1;
  const handoff = source.match(AGENT_PROMPT_HANDOFF)?.index ?? -1;
  if (
    finalTrue < 0 ||
    falseMatch < 0 ||
    handoff < 0 ||
    finalTrue > handoff
  ) {
    return "Pi's prompt preflight contract is incompatible with strict pre-execution enforcement.";
  }
  return undefined;
}
