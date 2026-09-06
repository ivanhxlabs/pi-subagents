import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const piCli = process.argv[2];
if (!piCli) {
  console.error("Usage: node scripts/verify-installed-strict-preflight.mjs <pi-cli>");
  process.exit(2);
}

const workDir = mkdtempSync(join(tmpdir(), "pi-subagents-preflight-"));
const workflowPath = join(workDir, "strict-preflight.workflow.js");
writeFileSync(workflowPath, `export const meta = {
  name: 'installed-strict-preflight',
  description: 'Verify the installed Pi host reaches strict preflight before execution',
}

return await strictAgent('This prompt must not execute without authentication.', {
  contractVersion: 1,
  agentType: 'general-purpose',
  model: 'openai-codex/gpt-5.6-sol',
  fallbackModels: [],
  effort: 'high',
})
`);

const extensionArgs = process.env.PI_SMOKE_EXTENSION
  ? ["--no-extensions", "--extension", process.env.PI_SMOKE_EXTENSION]
  : [];
const child = spawn(piCli, [
  "--mode", "rpc",
  "--no-session",
  ...extensionArgs,
  `--subagents-workflow-file=${workflowPath}`,
], {
  cwd: process.cwd(),
  env: process.env,
  stdio: ["pipe", "pipe", "pipe"],
});

let stdoutBuffer = "";
let stderr = "";
let settled = false;

function finish(exitCode, evidence) {
  if (settled) return;
  settled = true;
  clearTimeout(timeout);
  if (evidence !== undefined) process.stdout.write(`${JSON.stringify(evidence)}\n`);
  if (exitCode !== 0 && stderr) process.stderr.write(stderr);
  child.stdin.end();
  child.kill("SIGTERM");
  process.exitCode = exitCode;
}

function inspect(entry) {
  const data = entry.data;
  const attempt = data?.progress
    ?.filter(item => item.type === "workflow_agent" && item.strictAttempt)
    .at(-1)?.strictAttempt;
  const acceptedFailure = attempt?.failure?.code === "MODEL_UNAVAILABLE"
    || attempt?.failure?.code === "AUTH_UNAVAILABLE";
  const zeroExecution = attempt?.evidence?.executionStarted === false
    && attempt?.evidence?.assistantMessageStartedCount === 0
    && attempt?.evidence?.assistantOutputEventCount === 0
    && attempt?.evidence?.toolCallStartedCount === 0;
  const accepted = data?.status === "completed"
    && data?.agentCount === 1
    && attempt?.outcome === "pre-execution-failure"
    && acceptedFailure
    && zeroExecution;

  finish(accepted ? 0 : 1, {
    accepted,
    workflowStatus: data?.status,
    agentCount: data?.agentCount,
    attempt,
  });
}

function onLine(line) {
  if (!line) return;
  let event;
  try {
    event = JSON.parse(line);
  } catch (error) {
    stderr += `Invalid RPC record: ${line}\n${error}\n`;
    finish(1);
    return;
  }
  if (event.type === "entry_appended" && event.entry?.customType === "subagents:workflow") {
    inspect(event.entry);
  }
}

child.stdout.on("data", chunk => {
  stdoutBuffer += chunk.toString("utf8");
  while (true) {
    const newline = stdoutBuffer.indexOf("\n");
    if (newline < 0) break;
    let line = stdoutBuffer.slice(0, newline);
    stdoutBuffer = stdoutBuffer.slice(newline + 1);
    if (line.endsWith("\r")) line = line.slice(0, -1);
    onLine(line);
  }
});
child.stderr.on("data", chunk => {
  stderr += chunk.toString("utf8");
});
child.on("error", error => {
  stderr += `${error.stack ?? error}\n`;
  finish(1);
});
child.on("exit", code => {
  if (!settled) {
    stderr += `Pi RPC process exited before strict-preflight evidence was recorded: ${code}\n`;
    finish(1);
  }
});

const timeout = setTimeout(() => {
  stderr += "Timed out waiting for strict-preflight evidence.\n";
  finish(1);
}, 30_000);
