import { cp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AgentId } from "./agents.js";

export type Scope = "project" | "user";

export interface McpCommand {
  command: string;
  args: string[];
}

export type InstallAction =
  | { kind: "copy-dir"; agent: AgentId; from: string; to: string; upToDate: boolean }
  | { kind: "merge-json"; agent: AgentId; file: string; key: string; value: unknown; upToDate: boolean }
  | { kind: "append-text"; agent: AgentId | null; file: string; marker: string; text: string; upToDate: boolean }
  | { kind: "manual"; agent: AgentId; command: string; reason: string; upToDate: false };

export interface PlanOptions {
  repoRoot: string;
  agents: AgentId[];
  scope: Scope;
  skillSourceDir: string; // directory containing SKILL.md
  mcp: McpCommand;
  home?: string;
}

export const SERVER_NAME = "houserules";
export const SKILL_NAME = "houserules";

/** Works out what `init` would change, without touching anything. */
export async function planInstall(opts: PlanOptions): Promise<InstallAction[]> {
  const home = opts.home ?? os.homedir();
  const repo = path.resolve(opts.repoRoot);
  const actions: InstallAction[] = [];

  for (const agent of opts.agents) {
    // Skills: Claude Code reads .claude/skills, Codex reads .agents/skills (project) and ~/.agents/skills (user).
    const skillsRoot =
      agent === "claude"
        ? path.join(opts.scope === "project" ? repo : home, ".claude", "skills")
        : path.join(opts.scope === "project" ? repo : home, ".agents", "skills");
    const to = path.join(skillsRoot, SKILL_NAME);
    actions.push({ kind: "copy-dir", agent, from: opts.skillSourceDir, to, upToDate: await sameTree(opts.skillSourceDir, to) });

    if (agent === "claude") {
      if (opts.scope === "project") {
        const file = path.join(repo, ".mcp.json");
        const value = { type: "stdio", command: opts.mcp.command, args: opts.mcp.args };
        const current = (await readJson(file))?.mcpServers?.[SERVER_NAME];
        actions.push({ kind: "merge-json", agent, file, key: `mcpServers.${SERVER_NAME}`, value, upToDate: deepEqual(current, value) });
      } else {
        // ~/.claude.json is owned by Claude Code, so let its CLI write it.
        actions.push({
          kind: "manual",
          agent,
          command: ["claude", "mcp", "add", "--scope", "user", SERVER_NAME, "--", opts.mcp.command, ...opts.mcp.args].map(shellQuote).join(" "),
          reason: "Claude Code manages user-scoped MCP servers itself",
          upToDate: false,
        });
      }
    } else {
      // Codex reads MCP servers from ~/.codex/config.toml only.
      const file = path.join(home, ".codex", "config.toml");
      const marker = `[mcp_servers.${SERVER_NAME}]`;
      const text = `\n${marker}\ncommand = ${tomlString(opts.mcp.command)}\nargs = [${opts.mcp.args.map(tomlString).join(", ")}]\n`;
      const existing = (await readText(file)) ?? "";
      actions.push({ kind: "append-text", agent, file, marker, text, upToDate: existing.includes(marker) });
    }
  }

  // analysis.json and the cache are regenerated on every scan; generated docs and decisions.md are committed.
  const ignoreFile = path.join(repo, ".houserules", ".gitignore");
  const ignoreText = "analysis.json\ncache/\n";
  actions.push({ kind: "append-text", agent: null, file: ignoreFile, marker: "analysis.json", text: ignoreText, upToDate: ((await readText(ignoreFile)) ?? "").includes("analysis.json") });

  return actions;
}

export async function applyInstall(actions: InstallAction[]): Promise<void> {
  for (const a of actions) {
    if (a.upToDate || a.kind === "manual") continue;
    if (a.kind === "copy-dir") {
      await mkdir(path.dirname(a.to), { recursive: true });
      await cp(a.from, a.to, { recursive: true, force: true });
    } else if (a.kind === "merge-json") {
      const doc = (await readJson(a.file)) ?? {};
      const [top, name] = a.key.split(".") as [string, string];
      doc[top] = { ...(doc[top] ?? {}), [name]: a.value };
      await mkdir(path.dirname(a.file), { recursive: true });
      await writeFile(a.file, `${JSON.stringify(doc, null, 2)}\n`);
    } else if (a.kind === "append-text") {
      // Appending (rather than parse + rewrite) keeps the user's comments and formatting intact.
      const existing = (await readText(a.file)) ?? "";
      if (existing.includes(a.marker)) continue;
      await mkdir(path.dirname(a.file), { recursive: true });
      const sep = existing && !existing.endsWith("\n") ? "\n" : "";
      await writeFile(a.file, existing + sep + (existing ? a.text : a.text.replace(/^\n/, "")));
    }
  }
}

export function describeAction(a: InstallAction, home = os.homedir(), repoRoot?: string): string {
  const repo = repoRoot ? path.resolve(repoRoot) : null;
  const tilde = (p: string) =>
    repo && p.startsWith(repo + path.sep) ? `.${p.slice(repo.length)}` : p.startsWith(home + path.sep) ? `~${p.slice(home.length)}` : p;
  const status = a.upToDate ? " (already up to date)" : "";
  switch (a.kind) {
    case "copy-dir":
      return `Install skill → ${tilde(a.to)}${status}`;
    case "merge-json":
      return `Register MCP server in ${tilde(a.file)} (${a.key})${status}`;
    case "append-text":
      return a.agent ? `Register MCP server in ${tilde(a.file)} (${a.marker})${status}` : `Write ${tilde(a.file)}${status}`;
    case "manual":
      return `Run yourself (${a.reason}):\n    ${a.command}`;
  }
}

async function sameTree(a: string, b: string): Promise<boolean> {
  try {
    const [ea, eb] = await Promise.all([readdir(a, { withFileTypes: true }), readdir(b, { withFileTypes: true })]);
    if (ea.length !== eb.length) return false;
    for (const entry of ea) {
      const pa = path.join(a, entry.name);
      const pb = path.join(b, entry.name);
      if (entry.isDirectory()) {
        if (!(await sameTree(pa, pb))) return false;
      } else if ((await readText(pa)) !== (await readText(pb))) return false;
    }
    return true;
  } catch {
    return false;
  }
}

async function readText(file: string): Promise<string | null> {
  try {
    return await readFile(file, "utf8");
  } catch {
    return null;
  }
}

async function readJson(file: string): Promise<Record<string, any> | null> {
  const text = await readText(file);
  if (text === null) return null;
  return JSON.parse(text);
}

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function tomlString(s: string): string {
  return JSON.stringify(s); // TOML basic strings share JSON's escaping for the characters we emit
}

function shellQuote(s: string): string {
  return /^[\w@%+=:,./-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`;
}
