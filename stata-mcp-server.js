/**
 * Stata MCP Server
 *
 * Exposes a simple MCP tool that executes Stata do-file scripts.
 *
 * Environment variables:
 *   STATA_BIN         Path/binary for Stata CLI (default: stata-mp)
 *   STATA_TIMEOUT_SEC Default timeout in seconds (default: 180)
 */

import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const DEFAULT_STATA_BIN = process.env.STATA_BIN || "stata-mp";
const DEFAULT_TIMEOUT_SEC = Number(process.env.STATA_TIMEOUT_SEC || 180);

function runCommand(cmd, args, timeoutMs) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 2_000).unref();
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });

    child.on("close", (code, signal) => {
      clearTimeout(timer);
      resolve({
        code: code ?? null,
        signal: signal ?? null,
        stdout,
        stderr,
        timedOut,
      });
    });
  });
}

async function runStataDoScript(doScript, timeoutSec) {
  const tempRoot = await mkdtemp(join(tmpdir(), "stata-mcp-"));
  const doPath = join(tempRoot, "script.do");
  const logPath = join(tempRoot, "script.log");
  const quotedLogPath = logPath.replace(/\\/g, "/");
  const timeoutMs = Math.max(1, timeoutSec) * 1000;

  const wrappedScript = [
    "capture log close _all",
    `log using "${quotedLogPath}", text replace`,
    "set more off",
    doScript,
    "capture log close _all",
    "exit",
    "",
  ].join("\n");

  try {
    await writeFile(doPath, wrappedScript, "utf8");
    const result = await runCommand(
      DEFAULT_STATA_BIN,
      ["-b", "do", doPath],
      timeoutMs,
    );

    let logText = "";
    try {
      logText = await readFile(logPath, "utf8");
    } catch {
      logText = "";
    }

    return {
      stata_bin: DEFAULT_STATA_BIN,
      command: [DEFAULT_STATA_BIN, "-b", "do", doPath],
      timeout_sec: timeoutSec,
      exit_code: result.code,
      signal: result.signal,
      timed_out: result.timedOut,
      stdout: result.stdout,
      stderr: result.stderr,
      log: logText,
    };
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

const server = new McpServer({
  name: "superdash-stata-agent",
  version: "1.0.0",
});

server.tool(
  "stata_run_do",
  "Run a Stata do-script and return execution output/log for econometrics workflows.",
  {
    do_script: z
      .string()
      .min(1)
      .describe("Stata do-file content to execute"),
    timeout_sec: z
      .number()
      .int()
      .min(1)
      .max(1800)
      .default(DEFAULT_TIMEOUT_SEC)
      .describe("Timeout in seconds (default from STATA_TIMEOUT_SEC or 180)"),
  },
  async ({ do_script, timeout_sec }) => {
    const out = await runStataDoScript(do_script, timeout_sec);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(out),
        },
      ],
    };
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);

