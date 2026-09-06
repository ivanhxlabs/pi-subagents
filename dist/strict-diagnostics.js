const ANSI_ESCAPE = /\u001B(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007]*(?:\u0007|\u001B\\))/g;
const UNSAFE_UNICODE = /[\p{Cc}\p{Cf}\p{Cs}]/gu;
const SECRET_HEADER = /\b([a-z0-9-]*(?:authorization|api-key|apikey|key|token|cookie|credential|password|secret|signature))\s*:\s*[^\r\n]+/gi;
const AUTH_SCHEME = /\b(bearer|basic)\s+(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi;
const SECRET_NAME = "(?:(?:[a-z0-9]+[_-])*(?:api[_-]?key|apikey|access[_-]?token|refresh[_-]?token|id[_-]?token|auth|credential|password|secret|signature|token|key))";
const SECRET_ASSIGNMENT = new RegExp(`(["']?${SECRET_NAME}["']?\\s*[:=]\\s*)(?:"[^"]*"|'[^']*'|[^\\s,;&]+)`, "giu");
const SECRET_QUERY = new RegExp(`([?&]${SECRET_NAME}=)[^&#\\s]*`, "giu");
const URL_USERINFO = /(https?:\/\/[^\s/:@]+:)(?:"[^"]*"|'[^']*'|[^\s/@]+)@/gi;
const MAX_DIAGNOSTIC_CODE_POINTS = 512;
/** Redact credentials, strip terminal controls and bound public failure text. */
export function sanitizeStrictDiagnostic(value) {
    const raw = value instanceof Error ? value.message : String(value);
    const sanitized = raw
        .replace(ANSI_ESCAPE, "")
        .replace(/\r\n?/g, "\n")
        .replace(SECRET_HEADER, "$1: [redacted]")
        .replace(AUTH_SCHEME, "$1 [redacted]")
        .replace(SECRET_ASSIGNMENT, "$1[redacted]")
        .replace(SECRET_QUERY, "$1[redacted]")
        .replace(URL_USERINFO, "$1[redacted]@")
        .replace(UNSAFE_UNICODE, character => character === "\n" || character === "\t" ? character : "")
        .trim();
    const points = [...sanitized];
    if (points.length <= MAX_DIAGNOSTIC_CODE_POINTS)
        return sanitized || "Unknown strict runtime failure.";
    return `${points.slice(0, MAX_DIAGNOSTIC_CODE_POINTS).join("")}… [truncated]`;
}
