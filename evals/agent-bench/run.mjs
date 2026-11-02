#!/usr/bin/env node
// Agent benchmark: does Claude Code answer questions about a codebase better, faster and cheaper with the houserules
// MCP server than with file tools alone? Runs every question x condition headless, read-only, and grades it.
//
//   node evals/agent-bench/run.mjs --only q01,q02
//   node evals/agent-bench/run.mjs --fake                 # stub agent, no tokens spent
//
// Options: --questions <file> --only <ids> --conditions baseline,houserules --model <m> --concurrency <n>
//          --timeout <sec> --fake --agent-bin <path> --out <dir> --allow-generated-docs
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gradeRun } from "./grade.mjs";
import { writeReport } from "./report.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const houserulesRoot = path.resolve(here, "../..");
const cliEntry = path.join(houserulesRoot, "packages/cli/dist/index.js");

const CONDITIONS = ["baseline", "houserules"];
const READ_TOOLS = ["Read", "Grep", "Glob"];
const DISALLOWED = ["Edit", "MultiEdit", "Write", "NotebookEdit", "Bash", "WebFetch", "WebSearch", "Task", "Agent", "Skill"];
// Harness tools Claude Code exposes headless that have nothing to do with answering (seen in the pilot's init event).
const DISALLOWED_EXTRA = ["CronCreate", "CronDelete", "CronList", "DesignSync", "EnterWorktree", "ExitWorktree", "ListAgents", "Monitor", "PushNotification", "RemoteTrigger", "ReportFindings", "ScheduleWakeup", "SendMessage", "TaskStop", "Workflow"];
// houserules writes its docs into the repo (docs/houserules/*.md, .houserules/). Reading them with file tools would hand
// the baseline the very docs the MCP server serves, so both conditions are denied file access to them by default.
const GENERATED_DOCS = ["docs/houserules/**", ".houserules/**"];
const DOC_DENY = GENERATED_DOCS.flatMap((g) => ["Read", "Grep", "Glob"].map((t) => `${t}(${g})`));
const SESSION_ENV = ["CLAUDECODE", "CLAUDE_CODE_ENTRYPOINT", "CLAUDE_CODE_SESSION_ID", "CLAUDE_CODE_CHILD_SESSION", "CLAUDE_CODE_HOST_SESSION_ID", "CLAUDE_CODE_MESSAGING_SOCKET", "CLAUDE_CODE_MESSAGING_TOKEN", "CLAUDE_CODE_SDK_HAS_HOST_AUTH_REFRESH"];

const BASE_PROMPT = [
  "You are helping a developer who is new to this repository. Answer the question below about the codebase in the current directory.",
  "Answer concisely (a short paragraph or a few bullets). Name the concrete classes, methods, routes and config keys involved.",
  "Cite file paths with line numbers (path/to/File.php:123) for every claim.",
  "This is read-only: do not edit, create or delete any file.",
].join("\n");
const HOUSERULES_LINE = "A houserules MCP server is available with verified docs, entry points and call traces of this repo; use it first.";

function parseArgs(argv) {
  const o = { conditions: CONDITIONS, concurrency: 2, timeout: 360, fake: false, allowGeneratedDocs: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === "--only") o.only = next().split(",").map((s) => s.trim()).filter(Boolean);
    else if (a === "--conditions") o.conditions = next().split(",").map((s) => s.trim());
    else if (a === "--model") o.model = next();
    else if (a === "--concurrency") o.concurrency = Math.max(1, Number(next()));
    else if (a === "--timeout") o.timeout = Number(next());
    else if (a === "--questions") o.questions = path.resolve(next());
    else if (a === "--agent-bin") o.agentBin = next();
    else if (a === "--out") o.out = path.resolve(next());
    else if (a === "--fake") o.fake = true;
    else if (a === "--allow-generated-docs") o.allowGeneratedDocs = true;
    else if (a === "-h" || a === "--help") {
      console.log(readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").slice(1, 10).join("\n"));
      process.exit(0);
    } else throw new Error(`unknown option ${a}`);
  }
  for (const c of o.conditions) if (!CONDITIONS.includes(c)) throw new Error(`unknown condition ${c}`);
  return o;
}

/** The Claude desktop app ships its own CLI; use `claude` from PATH if present, else the newest bundled one. */
function findClaude() {
  for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
    const p = path.join(dir, "claude");
    if (dir && existsSync(p)) return p;
  }
  const base = path.join(os.homedir(), "Library", "Application Support", "Claude", "claude-code");
  if (!existsSync(base)) return null;
  const found = [];
  for (const v of readdirSync(base)) {
    const vdir = path.join(base, v);
    let builds = [];
    try {
      builds = readdirSync(vdir);
    } catch {
      continue;
    }
    for (const b of builds) {
      const bin = path.join(vdir, b, "claude.app", "Contents", "MacOS", "claude");
      if (existsSync(bin)) found.push({ v, bin });
    }
  }
  const cmp = (a, b) => {
    const pa = a.v.split(".").map(Number);
    const pb = b.v.split(".").map(Number);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
    return 0;
  };
  return found.sort(cmp).at(-1)?.bin ?? null;
}

function agentEnv(extra) {
  const env = { ...process.env, ...extra };
  for (const k of SESSION_ENV) delete env[k];
  return env;
}

function buildArgs(question, condition, mcpConfigs, model, allowGeneratedDocs) {
  const prompt = `${BASE_PROMPT}${condition === "houserules" ? `\n${HOUSERULES_LINE}` : ""}\n\nQuestion: ${question.question}`;
  return [
    "-p",
    prompt,
    "--mcp-config",
    mcpConfigs[condition],
    "--strict-mcp-config",
    "--allowedTools",
    ...(condition === "houserules" ? ["mcp__houserules"] : []),
    ...READ_TOOLS,
    "--disallowedTools",
    ...DISALLOWED,
    ...DISALLOWED_EXTRA,
    ...(allowGeneratedDocs ? [] : DOC_DENY),
    "--output-format",
    "stream-json",
    "--verbose",
    "--no-session-persistence",
    ...(model ? ["--model", model] : []),
  ];
}

/** Runs one agent process; resolves with the raw stdout lines, stderr, exit code and whether it timed out. */
function runOnce(bin, binArgs, args, cwd, timeoutSec, env) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(bin, [...binArgs, ...args], { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 5000).unref();
    }, timeoutSec * 1000);
    child.on("error", (e) => {
      clearTimeout(timer);
      resolve({ stdout, stderr: stderr + String(e), code: -1, timedOut, wallMs: Date.now() - started });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, code, timedOut, wallMs: Date.now() - started });
    });
  });
}

function parseEvents(stdout) {
  const events = [];
  for (const line of stdout.split("\n")) {
    if (!line.trim()) continue;
    try {
      events.push(JSON.parse(line));
    } catch {
      /* non-JSON noise */
    }
  }
  return events;
}

async function pool(items, n, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i], i);
      }
    }),
  );
  return out;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const qfile = opts.questions ?? path.join(here, "questions.json");
  const suite = JSON.parse(readFileSync(qfile, "utf8"));
  const repo = suite.repo;
  let questions = suite.questions;
  if (opts.only) {
    const missing = opts.only.filter((id) => !questions.some((q) => q.id === id));
    if (missing.length) throw new Error(`unknown question ids: ${missing.join(", ")}`);
    questions = questions.filter((q) => opts.only.includes(q.id));
  }
  if (!existsSync(repo)) throw new Error(`target repo not found: ${repo}`);

  let bin;
  let binArgs = [];
  if (opts.fake) {
    bin = process.execPath;
    binArgs = [path.join(here, "fake-agent.mjs")];
  } else {
    bin = opts.agentBin ?? findClaude();
    if (!bin) throw new Error("Claude Code CLI not found (no `claude` on PATH and no desktop-bundled CLI). Pass --agent-bin.");
    if (opts.conditions.includes("houserules") && !existsSync(cliEntry)) throw new Error(`houserules CLI not built: ${cliEntry} (run npm run build)`);
  }

  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19) + (opts.fake ? "-fake" : "");
  const outDir = opts.out ?? path.join(here, "results", ts);
  const rawDir = path.join(outDir, "raw");
  mkdirSync(rawDir, { recursive: true });

  const mcpConfigs = {
    baseline: path.join(outDir, "mcp-baseline.json"),
    houserules: path.join(outDir, "mcp-houserules.json"),
  };
  writeFileSync(mcpConfigs.baseline, JSON.stringify({ mcpServers: {} }, null, 2));
  writeFileSync(mcpConfigs.houserules, JSON.stringify({ mcpServers: { houserules: { type: "stdio", command: process.execPath, args: [cliEntry, "mcp", repo] } } }, null, 2));

  const jobs = questions.flatMap((q) => opts.conditions.map((c) => ({ q, c })));
  const meta = {
    startedAt: new Date().toISOString(),
    repo,
    suite: suite.name ?? path.basename(repo),
    questionsFile: qfile,
    conditions: opts.conditions,
    model: opts.model ?? null,
    concurrency: opts.concurrency,
    timeoutSec: opts.timeout,
    fake: opts.fake,
    generatedDocsDenied: !opts.allowGeneratedDocs,
    agentBin: bin,
    prompt: { base: BASE_PROMPT, houserulesLine: HOUSERULES_LINE },
  };
  writeFileSync(path.join(outDir, "meta.json"), JSON.stringify(meta, null, 2));
  console.log(`${jobs.length} runs (${questions.length} questions x ${opts.conditions.join(", ")}), concurrency ${opts.concurrency}${opts.fake ? ", FAKE agent" : ""}`);
  console.log(`results -> ${path.relative(process.cwd(), outDir) || outDir}`);

  let done = 0;
  const results = await pool(jobs, opts.concurrency, async ({ q, c }) => {
    const args = buildArgs(q, c, mcpConfigs, opts.model, opts.allowGeneratedDocs);
    const env = agentEnv({ BENCH_QID: q.id });
    let attempt = 0;
    let run;
    let events;
    let graded;
    // Retry once when the run produced no result (crash, or dist mid-rebuild making the MCP server fail) — not on timeout.
    for (;;) {
      attempt++;
      run = await runOnce(bin, binArgs, args, repo, opts.timeout, env);
      events = parseEvents(run.stdout);
      graded = gradeRun(q, events, { timedOut: run.timedOut, wallMs: run.wallMs });
      const mcpBroken = c === "houserules" && graded.mcpStatus && graded.mcpStatus !== "connected";
      if (attempt >= 2 || run.timedOut || (graded.hasResult && !mcpBroken)) break;
      console.log(`  ${q.id}/${c}: ${mcpBroken ? `MCP status ${graded.mcpStatus}` : `no result (exit ${run.code})`}, retrying once`);
      await new Promise((r) => setTimeout(r, 5000));
    }
    const base = `${q.id}.${c}`;
    writeFileSync(path.join(rawDir, `${base}.jsonl`), run.stdout);
    if (run.stderr.trim()) writeFileSync(path.join(rawDir, `${base}.stderr.txt`), run.stderr);
    const rec = { id: q.id, condition: c, question: q.question, kind: q.kind, difficulty: q.difficulty, trace: !!q.trace, attempts: attempt, exitCode: run.code, ...graded };
    writeFileSync(path.join(rawDir, `${base}.result.json`), JSON.stringify(rec, null, 2));
    done++;
    const secs = ((graded.durationMs ?? run.wallMs) / 1000).toFixed(0);
    console.log(
      `[${done}/${jobs.length}] ${q.id} ${c.padEnd(10)} ${graded.failed ? `FAILED (${graded.failure})` : graded.correct ? "correct" : "wrong  "} recall ${graded.factRecall.toFixed(2)} cite ${graded.citationScore.toFixed(2)} ${secs}s ${graded.tokens.total} tok $${graded.costUsd.toFixed(3)} tools ${graded.toolCalls.total} (mcp ${graded.toolCalls.houserules})${graded.toolCalls.writeAttempts.length ? ` WRITE ATTEMPTS: ${graded.toolCalls.writeAttempts.join(",")}` : ""}`,
    );
    return rec;
  });

  meta.finishedAt = new Date().toISOString();
  writeFileSync(path.join(outDir, "meta.json"), JSON.stringify(meta, null, 2));
  writeFileSync(path.join(outDir, "results.json"), JSON.stringify(results, null, 2));
  const { md, html, summary } = writeReport(outDir);
  console.log("");
  for (const s of summary) {
    console.log(`${s.condition.padEnd(10)} accuracy ${(s.accuracy * 100).toFixed(0)}% (${s.correct}/${s.n})  recall ${s.avgRecall.toFixed(2)}  cite ${s.avgCitation.toFixed(2)}  median ${(s.medianMs / 1000).toFixed(0)}s  median ${Math.round(s.medianTokens)} tok  total $${s.totalCost.toFixed(2)}`);
  }
  console.log(`\nreport: ${md}\n        ${html}`);
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
