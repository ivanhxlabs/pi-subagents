import { describe, expect, it } from "vitest";
import { sanitizeStrictDiagnostic } from "../src/strict-diagnostics.js";

describe("sanitizeStrictDiagnostic", () => {
  it("strips terminal controls and redacts credentials", () => {
    const result = sanitizeStrictDiagnostic(
      "\u001b[31mfailed\u001b[0m Authorization: Bearer secret-token\n" +
      "https://example.test/?api_key=secret&safe=yes\u0000\u0085",
    );
    expect(result).not.toContain("\u001b");
    expect(result).not.toContain("secret-token");
    expect(result).not.toContain("api_key=secret");
    expect(result).toContain("Authorization: [redacted]");
    expect(result).toContain("api_key=[redacted]");
    expect(result).not.toContain("\u0085");
  });

  it("redacts common headers, assignments, signed URLs, and URL userinfo", () => {
    const result = sanitizeStrictDiagnostic([
      "x-api-key: header-secret",
      "Cookie: session=cookie-secret",
      "apiKey=assignment-secret",
      "openai_api_key=provider-secret",
      '"refreshToken": "quoted secret with spaces"',
      "token='generic token with spaces'",
      "https://user:password@example.test/path?X-Amz-Signature=signed-secret",
      "safe\rspoof\u202eright-to-left",
    ].join("\n"));
    for (const secret of [
      "header-secret",
      "cookie-secret",
      "assignment-secret",
      "provider-secret",
      "quoted secret with spaces",
      "generic token with spaces",
      "password",
      "signed-secret",
      "\r",
      "\u202e",
    ]) {
      expect(result).not.toContain(secret);
    }
  });

  it("bounds diagnostics by Unicode code point", () => {
    const result = sanitizeStrictDiagnostic("🙂".repeat(600));
    expect([...result.replace("… [truncated]", "")]).toHaveLength(512);
    expect(result).toMatch(/… \[truncated\]$/);
  });

  it("provides a stable message for empty input", () => {
    expect(sanitizeStrictDiagnostic("\u0000")).toBe("Unknown strict runtime failure.");
  });
});
