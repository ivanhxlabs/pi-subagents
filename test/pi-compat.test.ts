import { describe, expect, it } from "vitest";
import {
  strictModelRuntime,
  strictPiCompatibilityError,
} from "../src/pi-compat.js";

function registry(runtime: unknown) {
  return { runtime } as never;
}

const compatibleRuntime = {
  getModel() {},
  async getAvailable() { return []; },
  hasConfiguredAuth() { return true; },
};

describe("strict Pi compatibility adapter", () => {
  it("accepts the installed Pi prompt boundary", () => {
    expect(strictPiCompatibilityError(registry(compatibleRuntime))).toBeUndefined();
  });

  it("accepts the installed Pi bundle's minified boolean preflight callbacks", () => {
    async function prompt(this: { _runAgentPrompt(): Promise<void> }) {
      const preflightResult = (_success: boolean) => {};
      try {
        preflightResult?.(!1);
      } catch {
        preflightResult?.(!1);
      }
      preflightResult?.(!0);
      await this._runAgentPrompt();
    }

    expect(strictPiCompatibilityError(registry(compatibleRuntime), prompt)).toBeUndefined();
  });

  it("exposes only a structurally compatible canonical model runtime", () => {
    expect(strictModelRuntime(registry(compatibleRuntime))).toBe(compatibleRuntime);
    expect(strictModelRuntime(registry({ getModel() {} }))).toBeUndefined();
    expect(strictModelRuntime(registry(undefined))).toBeUndefined();
  });

  it("fails closed when the final preflight callback is absent", () => {
    async function prompt(this: { _runAgentPrompt(): Promise<void> }) {
      await this._runAgentPrompt();
    }
    expect(strictPiCompatibilityError(registry(compatibleRuntime), prompt))
      .toContain("prompt preflight contract is incompatible");
  });

  it("fails closed when execution can start before the final preflight callback", () => {
    async function prompt(this: { _runAgentPrompt(): Promise<void> }) {
      const preflightResult = (_success: boolean) => {};
      await this._runAgentPrompt();
      preflightResult?.(false);
      preflightResult?.(true);
    }
    expect(strictPiCompatibilityError(registry(compatibleRuntime), prompt))
      .toContain("prompt preflight contract is incompatible");
  });

  it("fails closed when the canonical model runtime is unavailable", () => {
    expect(strictPiCompatibilityError(registry(undefined))).toContain("canonical model runtime");
  });
});
