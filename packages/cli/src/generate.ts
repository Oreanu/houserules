import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { access, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { createInterface as createPrompt } from "node:readline/promises";
import { allLessons, detectAgents, readLessons, readStore, renderDocs, scan, writeAnalysis, type AgentId } from "@houserules/core";
import { mcpCommand } from "./init.js";

export interface GenerateOptions {
  agent?: string;
  only?: string;
  model?: string;
  render: boolean;
  fresh?: boolean;
  /** Asks a yes/no question; defaults to the terminal. Returns false when there's no terminal to ask in. */
  confirm?: (question: string) => Promise<boolean>;
}

type Only = "all" | "docs" | "lessons";

/**
 * One command from repo to verified docs and lessons: scan, then run the user's own Claude Code or Codex headless with
 * the houserules MCP server and skill. The agent can read the repo and call houserules tools, nothing else: it can't
 * edit, create or delete files or run shell commands. Every claim still goes through the same verification as when an
 * agent is driven by hand.
 */
export async function runGenerate(target: string, opts: GenerateOptions): Promise<number> {
  const root = path.resolve(target);
  const only = (opts.only ?? "all") as Only;
  if (!["all", "docs", "lessons"].includes(only)) throw new Error(`--only must be docs or lessons`);
  if (!(await access(root).then(() => true, () => false))) throw new Error(`No such directory: ${root}`);

  // Sort out the agent before any slow work: installed, and signed in.
  const agent = await readyAgent(opts.agent, opts.confirm ?? askTTY);
  if (!agent) return 1;

  console.log(`Scanning ${root}…`);
  const analysis = await scan(root);
  await writeAnalysis(root, analysis);
  console.log(`  ${analysis.files.length} files, ${analysis.frameworks.map((f) => f.name).join(", ") || "no framework detected"}`);
  if (!analysis.files.length) {
    console.error("Nothing to document: no source files found here.");
    return 1;
  }

  const before = await counts(root);
  const done = opts.fresh ? { sections: [], tracks: [] } : before;
  if (done.sections.length || done.tracks.length) console.log(`  Keeping what's already written (${[...done.sections, ...done.tracks.map((t) => `${t} lessons`)].join(", ")}). Use --fresh to redo it.`);
  const tmp = await mkdtemp(path.join(os.tmpdir(), "houserules-"));
  let result: Awaited<ReturnType<typeof runAgent>>;
  try {
    const prompt = await buildPrompt(only, done);
    const mcp = mcpCommand();
    const mcpArgs = [...mcp.args, root];
    const cmd = agent.id === "claude" ? await claudeCommand(agent.binary, tmp, { command: mcp.command, args: mcpArgs }, prompt, opts.model) : codexCommand(agent.binary, root, { command: mcp.command, args: mcpArgs }, prompt, opts.model);
    console.log(`\nWriting ${only === "all" ? "docs and lessons" : only} with ${agent.name}. This reads a lot of code and can take a while on a big repo. Ctrl+C stops it; what's accepted so far is kept.\n`);
    result = await runAgent(cmd, root, agent.id);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
  if (result.notLoggedIn) {
    console.error(`\n${agent.name} isn't signed in. Sign in, then run houserules generate again:\n    ${loginHint(agent)}`);
    return 1;
  }
  if (result.interrupted) console.error(`\nStopped. Run houserules generate again to carry on from here.`);
  else if (result.code !== 0) console.error(`\n${agent.name} stopped with exit code ${result.code}.${result.error ? ` ${result.error}` : ""}\nRun houserules generate again to carry on from here.`);

  const after = await counts(root);
  const delta = (n: number) => `${n >= 0 ? "+" : ""}${n}`;
  console.log(`\nDocs: ${after.items} verified item(s) (${delta(after.items - before.items)}), ${after.sections.length} section(s) filled.`);
  console.log(`Lessons: ${after.lessons} (${delta(after.lessons - before.lessons)}).`);
  if (opts.render && after.items > 0) {
    const r = await renderDocs(root, await readStore(root));
    console.log(`Rendered ${r.written.length} file(s): ${r.written.join(", ")}`);
  }
  if (after.items + after.lessons > 0) console.log(`\nBrowse them: houserules preview${target === "." ? "" : ` ${target}`}`);
  return after.items + after.lessons > before.items + before.lessons || (after.items + after.lessons > 0 && result.code === 0) ? 0 : 1;
}

async function counts(root: string) {
  const store = await readStore(root);
  const lessons = await readLessons(root);
  const sections = Object.entries(store.docs).flatMap(([doc, d]) => Object.entries(d!.sections).filter(([, s]) => s.items.length).map(([id, s]) => ({ id: `${doc}/${id}`, n: s.items.length })));
  return {
    items: sections.reduce((n, s) => n + s.n, 0),
    sections: sections.map((s) => s.id),
    lessons: allLessons(lessons).length,
    tracks: Object.entries(lessons.tracks).filter(([, t]) => t?.lessons.length).map(([id]) => id),
  };
}

interface FoundAgent {
  id: AgentId;
  name: string;
  binary: string;
}

export async function findAgents(): Promise<FoundAgent[]> {
  const found: FoundAgent[] = [];
  for (const a of await detectAgents()) {
    const binary = a.binary ?? (a.id === "claude" ? await desktopClaude() : null);
    if (binary) found.push({ id: a.id, name: a.name, binary });
  }
  return found;
}

/**
 * Picks an agent that's installed and signed in. Prefers the one asked for, then whichever is already signed in.
 * When none is signed in, offers to run its sign-in now (in a terminal), or says exactly what to run.
 */
async function readyAgent(wanted: string | undefined, confirm: (q: string) => Promise<boolean>): Promise<FoundAgent | null> {
  if (wanted && wanted !== "claude" && wanted !== "codex") throw new Error(`--agent must be claude or codex`);
  const found = (await findAgents()).filter((a) => !wanted || a.id === wanted);
  if (!found.length) {
    const which = wanted === "codex" ? "Codex" : wanted === "claude" ? "Claude Code" : "Claude Code or Codex";
    console.error(`houserules generate needs ${which} to write the docs, and none was found.\nInstall one and sign in, then run this again:`);
    if (wanted !== "codex") console.error("    Claude Code: npm install -g @anthropic-ai/claude-code   (https://claude.com/claude-code)");
    if (wanted !== "claude") console.error("    Codex:       npm install -g @openai/codex   (https://github.com/openai/codex)");
    console.error("Or set it up yourself with houserules init and ask your agent to \"run houserules\".");
    return null;
  }
  const statuses = await Promise.all(found.map(async (a) => ({ a, auth: await signedIn(a) })));
  const ready = statuses.find((s) => s.auth !== false);
  if (ready) {
    if (ready.auth === "unknown") console.log(`Using ${ready.a.name} (${ready.a.binary}); couldn't check its sign-in, trying anyway.`);
    else console.log(`Using ${ready.a.name} (${ready.a.binary}).`);
    return ready.a;
  }
  const first = found[0]!;
  console.error(`${found.map((a) => a.name).join(" and ")} ${found.length > 1 ? "are" : "is"} installed but not signed in.`);
  if (await confirm(`Sign in to ${first.name} now? [Y/n] `)) {
    const code = await new Promise<number>((resolve) => {
      const child = spawn(first.binary, first.id === "claude" ? ["auth", "login"] : ["login"], { stdio: "inherit", env: agentEnv() });
      child.on("error", () => resolve(1));
      child.on("close", (c) => resolve(c ?? 1));
    });
    if (code === 0 && (await signedIn(first)) !== false) return first;
    console.error(`Still not signed in.`);
  }
  console.error(`Sign in, then run houserules generate again:`);
  for (const a of found) console.error(`    ${loginHint(a)}`);
  return null;
}

function loginHint(a: FoundAgent): string {
  return `${shellQuote(a.binary)} ${a.id === "claude" ? "auth login" : "login"}`;
}

/** true / false from the agent's own status command; "unknown" when it has none (older CLIs). API keys count. */
export async function signedIn(a: FoundAgent): Promise<boolean | "unknown"> {
  if (a.id === "claude" && process.env.ANTHROPIC_API_KEY) return true;
  if (a.id === "codex" && process.env.OPENAI_API_KEY) return true;
  const args = a.id === "claude" ? ["auth", "status"] : ["login", "status"];
  return new Promise((resolve) => {
    let out = "";
    const child = spawn(a.binary, args, { env: agentEnv(), stdio: ["ignore", "pipe", "pipe"] });
    const timer = setTimeout(() => (child.kill(), resolve("unknown")), 15_000);
    child.stdout.on("data", (d: Buffer) => (out += d));
    child.stderr.on("data", (d: Buffer) => (out += d));
    child.on("error", () => (clearTimeout(timer), resolve("unknown")));
    child.on("close", (code) => {
      clearTimeout(timer);
      if (/"loggedIn"\s*:\s*true|logged in using|signed in/i.test(out) && !/not logged in/i.test(out)) resolve(true);
      else if (/"loggedIn"\s*:\s*false|not logged in|not signed in/i.test(out)) resolve(false);
      else if (/unknown (command|option)|unrecognized|usage:/i.test(out)) resolve("unknown");
      else resolve(code === 0 ? true : false);
    });
  });
}

async function askTTY(question: string): Promise<boolean> {
  if (!process.stdin.isTTY) return false;
  const rl = createPrompt({ input: process.stdin, output: process.stdout });
  try {
    return !/^n(o)?$/i.test((await rl.question(question)).trim());
  } finally {
    rl.close();
  }
}

/** The Claude desktop app ships its own Claude Code CLI; use the newest when `claude` isn't on PATH. */
export async function desktopClaude(home = os.homedir(), platform = process.platform): Promise<string | null> {
  if (platform !== "darwin") return null;
  const base = path.join(home, "Library", "Application Support", "Claude", "claude-code");
  const versions = await readdir(base).catch(() => [] as string[]);
  const byVersion = versions.filter((v) => /^\d+\.\d+\.\d+$/.test(v)).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
  for (const v of byVersion) {
    for (const build of await readdir(path.join(base, v)).catch(() => [] as string[])) {
      const bin = path.join(base, v, build, "claude.app", "Contents", "MacOS", "claude");
      if (await access(bin).then(() => true, () => false)) return bin;
    }
  }
  return null;
}

async function buildPrompt(only: Only, done: { sections: string[]; tracks: string[] }): Promise<string> {
  const require = createRequire(import.meta.url);
  const skill = await readFile(path.join(path.dirname(require.resolve("@houserules/skills/package.json")), "houserules", "SKILL.md"), "utf8");
  const scope =
    only === "docs"
      ? "Do workflow steps 1-6: fill every architecture and guidelines section, name the entry points and turn guidelines into checkable rules. Skip the lessons."
      : only === "lessons"
        ? "Write the lessons only (workflow step 7, after orienting with steps 1-2): all three tracks."
        : "Do workflow steps 1-7: fill every architecture and guidelines section, name the entry points, turn guidelines into checkable rules, then write lessons for all three tracks.";
  return [
    "You are running non-interactively from `houserules generate`. Nobody can answer questions, so make reasonable calls and keep going until the work is done.",
    `Work on the repository in the current directory, following the houserules skill below. ${scope}`,
    ...(done.sections.length || done.tracks.length ? [`Already written and verified, so skip these unless you find they're wrong: ${[...done.sections, ...done.tracks.map((t) => `${t} lessons`)].join(", ")}.`] : []),
    "Fix every rejection and resubmit until it's accepted. Don't call render_docs: houserules renders afterwards.",
    "You can read files and call houserules tools only. Never try to edit, create or delete files in the repository; everything that needs saving goes through the houserules tools.",
    "When you're done, reply with a short summary: what was accepted, and anything you couldn't verify.",
    "",
    "<skill>",
    skill.replace(/^---[\s\S]*?---\s*/, ""),
    "</skill>",
  ].join("\n");
}

interface Command {
  bin: string;
  args: string[];
}

const READ_TOOLS = ["Read", "Grep", "Glob", "LS"];
const WRITE_TOOLS = ["Edit", "MultiEdit", "Write", "NotebookEdit", "Bash", "WebFetch", "WebSearch", "Task", "Agent"];

export async function claudeCommand(bin: string, tmp: string, mcp: { command: string; args: string[] }, prompt: string, model?: string): Promise<Command> {
  const config = path.join(tmp, "mcp.json");
  await writeFile(config, JSON.stringify({ mcpServers: { houserules: { type: "stdio", command: mcp.command, args: mcp.args } } }));
  return {
    bin,
    args: [
      "-p",
      prompt,
      "--mcp-config",
      config,
      "--strict-mcp-config",
      "--allowedTools",
      "mcp__houserules",
      ...READ_TOOLS,
      "--disallowedTools",
      ...WRITE_TOOLS,
      "--output-format",
      "stream-json",
      "--verbose",
      ...(model ? ["--model", model] : []),
    ],
  };
}

export function codexCommand(bin: string, root: string, mcp: { command: string; args: string[] }, prompt: string, model?: string): Command {
  const toml = (s: string) => JSON.stringify(s);
  return {
    bin,
    args: [
      "exec",
      "--json",
      "--sandbox",
      "read-only",
      "--skip-git-repo-check",
      "-C",
      root,
      "-c",
      `mcp_servers.houserules.command=${toml(mcp.command)}`,
      "-c",
      `mcp_servers.houserules.args=[${mcp.args.map(toml).join(", ")}]`,
      ...(model ? ["-m", model] : []),
      prompt,
    ],
  };
}

// A nested run from inside another agent session would otherwise think it's a child of that session.
const SESSION_ENV = ["CLAUDECODE", "CLAUDE_CODE_ENTRYPOINT", "CLAUDE_CODE_SESSION_ID", "CLAUDE_CODE_CHILD_SESSION", "CLAUDE_CODE_HOST_SESSION_ID", "CLAUDE_CODE_MESSAGING_SOCKET", "CLAUDE_CODE_MESSAGING_TOKEN", "CLAUDE_CODE_SDK_HAS_HOST_AUTH_REFRESH"];

function agentEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const k of SESSION_ENV) delete env[k];
  return env;
}

function runAgent(cmd: Command, cwd: string, agent: AgentId): Promise<{ code: number; notLoggedIn: boolean; interrupted: boolean; error?: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd.bin, cmd.args, { cwd, env: agentEnv(), stdio: ["ignore", "pipe", "pipe"] });
    let interrupted = false;
    const onInt = () => {
      interrupted = true;
      child.kill("SIGINT");
    };
    process.once("SIGINT", onInt);
    let notLoggedIn = false;
    let error: string | undefined;
    let stderr = "";
    child.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
    createInterface({ input: child.stdout }).on("line", (line) => {
      let ev: unknown;
      try {
        ev = JSON.parse(line);
      } catch {
        return;
      }
      for (const out of describe(ev, agent)) {
        if (out.kind === "login") notLoggedIn = true;
        else if (out.kind === "error") error = out.text;
        else console.log(out.text);
      }
    });
    child.on("error", (e) => (process.off("SIGINT", onInt), reject(e)));
    child.on("close", (code) => {
      process.off("SIGINT", onInt);
      if (/not logged in|please run \/login|codex login/i.test(stderr)) notLoggedIn = true;
      resolve({ code: code ?? 1, notLoggedIn, interrupted, ...(error ?? stderr.trim() ? { error: error ?? stderr.trim().split("\n").slice(-3).join(" ") } : {}) });
    });
  });
}

type Out = { kind: "line" | "login" | "error"; text: string };

/** Turns one streamed agent event into progress lines: tool calls in a word or two, rejections, and the final summary. */
export function describe(ev: unknown, agent: AgentId): Out[] {
  const e = ev as Record<string, any>;
  const out: Out[] = [];
  if (agent === "claude") {
    if (e.type === "assistant") {
      for (const c of e.message?.content ?? []) if (c.type === "tool_use") out.push({ kind: "line", text: `  ${toolLine(c.name, c.input ?? {})}` });
    } else if (e.type === "user") {
      for (const c of e.message?.content ?? []) if (c.type === "tool_result") out.push(...resultLines(c.content));
    } else if (e.type === "result") {
      const text = String(e.result ?? "");
      if (e.is_error && /not logged in|\/login/i.test(text)) out.push({ kind: "login", text });
      else if (e.is_error) out.push({ kind: "error", text });
      else if (text) out.push({ kind: "line", text: `\n${text}` });
    }
  } else {
    const item = e.item ?? {};
    if (e.type === "item.started" && item.type === "mcp_tool_call") out.push({ kind: "line", text: `  ${toolLine(`mcp__houserules__${item.tool}`, item.arguments ?? {})}` });
    else if (e.type === "item.started" && item.type === "command_execution") out.push({ kind: "line", text: `  reading: ${String(item.command).slice(0, 80)}` });
    else if (e.type === "item.completed" && item.type === "mcp_tool_call") out.push(...resultLines(item.result?.content ?? item.result));
    else if (e.type === "item.completed" && item.type === "agent_message" && item.text) out.push({ kind: "line", text: `\n${item.text}` });
    else if (e.type === "error" || e.type === "turn.failed") {
      const msg = String(e.message ?? e.error?.message ?? "");
      out.push({ kind: /login|unauthori[sz]ed|401/i.test(msg) ? "login" : "error", text: msg });
    }
  }
  return out;
}

function toolLine(name: string, input: Record<string, any>): string {
  if (name.startsWith("mcp__houserules__")) {
    const tool = name.slice("mcp__houserules__".length);
    if (tool === "submit_section") return `submitting ${input.doc}/${input.section} (${input.items?.length ?? 0} item(s))`;
    if (tool === "submit_lessons") return `submitting ${input.lessons?.length ?? 0} ${input.track ?? ""} lesson(s)`.replace(/\s+/g, " ");
    if (tool === "trace_entry_point") return `tracing ${input.id ?? input.path ?? ""}`.trim();
    if (tool === "official_docs") return `checking the official docs: ${input.api ?? input.url ?? input.find ?? ""}`;
    return tool.replace(/_/g, " ");
  }
  if (name === "Read") return `reading ${input.file_path ?? ""}`;
  if (name === "Grep") return `searching for ${input.pattern ?? ""}`;
  if (name === "Glob") return `listing ${input.pattern ?? ""}`;
  return name;
}

// submit_section / submit_lessons answer with what was accepted and why anything was rejected.
function resultLines(content: unknown): Out[] {
  const text = Array.isArray(content) ? content.map((c: any) => c?.text ?? "").join("") : typeof content === "string" ? content : "";
  let r: any;
  try {
    r = JSON.parse(text);
  } catch {
    return [];
  }
  if (!r || typeof r !== "object" || !("accepted" in r || "rejected" in r)) return [];
  const accepted = Array.isArray(r.accepted) ? r.accepted.length : Number(r.accepted ?? 0);
  const rejected = Array.isArray(r.rejected) ? r.rejected.length : Number(r.rejected ?? 0);
  return [{ kind: "line", text: `    ✓ ${accepted} accepted${rejected ? `, ✗ ${rejected} rejected (fixing)` : ""}` }];
}

function shellQuote(s: string): string {
  return /^[\w@%+=:,./-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`;
}
