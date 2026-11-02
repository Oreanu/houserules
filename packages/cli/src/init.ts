import { createRequire } from "node:module";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import {
  applyInstall,
  describeAction,
  detectAgents,
  planInstall,
  VERSION,
  type AgentId,
  type McpCommand,
  type Scope,
} from "@houserules/core";
import { runScan } from "./scan.js";

export interface InitOptions {
  agent?: string;
  scope?: string;
  dryRun: boolean;
  yes: boolean;
  scan: boolean;
  home?: string; // tests point this at a temp dir
  pathEnv?: string;
  platform?: NodeJS.Platform;
  confirm?: (question: string) => Promise<boolean>;
}

export async function runInit(target: string, opts: InitOptions): Promise<number> {
  const repoRoot = path.resolve(target);
  const scope = (opts.scope ?? "project") as Scope;
  if (scope !== "project" && scope !== "user") throw new Error(`--scope must be "project" or "user", got "${opts.scope}"`);

  const statuses = await detectAgents({ home: opts.home, pathEnv: opts.pathEnv, platform: opts.platform });
  console.log("Detected agents:");
  for (const s of statuses) {
    console.log(`  ${s.installed ? "✓" : "✗"} ${s.name}${s.evidence.length ? `  (${s.evidence.join("; ")})` : "  (not found)"}`);
  }

  let agents: AgentId[];
  if (opts.agent === "all") agents = ["claude", "codex"];
  else if (opts.agent === "claude" || opts.agent === "codex") agents = [opts.agent];
  else if (opts.agent) throw new Error(`--agent must be claude, codex or all, got "${opts.agent}"`);
  else agents = statuses.filter((s) => s.installed).map((s) => s.id);

  if (agents.length === 0) {
    console.error("\nNo Claude Code or Codex setup found. Install one, or pass --agent claude|codex|all to set up anyway.");
    return 1;
  }

  const actions = await planInstall({
    repoRoot,
    agents,
    scope,
    skillSourceDir: skillSourceDir(),
    mcp: mcpCommand(),
    home: opts.home,
  });

  console.log(`\nPlan (${scope} scope):`);
  for (const a of actions) console.log(`  • ${describeAction(a, opts.home, repoRoot)}`);

  const pending = actions.filter((a) => !a.upToDate && a.kind !== "manual");
  if (opts.dryRun) {
    console.log("\nDry run: nothing was changed.");
    return 0;
  }
  if (pending.length && !opts.yes) {
    const confirm = opts.confirm ?? askTTY;
    if (!(await confirm("\nApply these changes? [y/N] "))) {
      console.log("Cancelled: nothing was changed.");
      return 1;
    }
  }

  await applyInstall(actions);
  if (pending.length) console.log(`\nDone: ${pending.length} change(s) applied.`);
  else console.log("\nEverything was already set up.");

  if (opts.scan) {
    console.log("");
    await runScan(repoRoot, { json: false });
  }

  console.log(`\nNext: restart ${agents.map((a) => (a === "claude" ? "Claude Code" : "Codex")).join(" / ")} in this repo and ask it to "run houserules".`);
  return 0;
}

function skillSourceDir(): string {
  const require = createRequire(import.meta.url);
  return path.join(path.dirname(require.resolve("@houserules/skills/package.json")), "houserules");
}

/** How the agent should launch our MCP server: a stable npx spec when run via npx, else this exact install. */
export function mcpCommand(entry = fileURLToPath(new URL("./index.js", import.meta.url))): McpCommand {
  if (entry.split(path.sep).includes("_npx")) return { command: "npx", args: ["-y", `houserules@${VERSION}`, "mcp"] };
  return { command: process.execPath, args: [entry, "mcp"] };
}

async function askTTY(question: string): Promise<boolean> {
  if (!process.stdin.isTTY) {
    console.error("\nNot running in a terminal, so I can't ask for confirmation. Re-run with --yes to apply, or --dry-run to preview.");
    return false;
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return /^y(es)?$/i.test((await rl.question(question)).trim());
  } finally {
    rl.close();
  }
}
