import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const manifest = JSON.parse(readFileSync(
  fileURLToPath(new URL("../package.json", import.meta.url)),
  "utf8",
)) as {
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
  peerDependencies: Record<string, string>;
  pi: { extensions: string[] };
  scripts: Record<string, string>;
  type: string;
};

describe("Git release manifest", () => {
  it("loads a committed build produced by pinned local tooling", () => {
    expect(manifest.pi.extensions).toEqual(["./dist/index.js"]);
    expect(manifest.type).toBe("module");
    expect(manifest.scripts).not.toHaveProperty("prepare");
    expect(manifest.scripts.build).toContain("scripts/normalize-dist.mjs");
    expect(manifest.devDependencies.typescript).toMatch(/^\d+\.\d+\.\d+$/);
    expect(manifest.devDependencies["@types/node"]).toMatch(/^\d+\.\d+\.\d+$/);
    expect(existsSync(fileURLToPath(new URL("../dist/index.js", import.meta.url)))).toBe(true);
  });

  it("declares the strict Pi compatibility floor without an upper bound", () => {
    expect(manifest.peerDependencies).toMatchObject({
      "@earendil-works/pi-ai": ">=0.85.0",
      "@earendil-works/pi-coding-agent": ">=0.85.0",
      "@earendil-works/pi-tui": ">=0.85.0",
    });
  });
});
