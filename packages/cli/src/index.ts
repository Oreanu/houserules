#!/usr/bin/env node
import { realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { VERSION } from "@houserules/core";
import { runRender, runVerify } from "./docs.js";
import { runCi, runCiSetup } from "./ci.js";
import { runGenerate } from "./generate.js";
import { runInit } from "./init.js";
import { runScan } from "./scan.js";

const HELP = `houserules ${VERSION}
Learn a repo's house rules, then teach them to humans and coding agents.

Usage:
  houserules init [path]     Detect Claude Code / Codex, install the skill and MCP server, then scan
  houserules generate [path] Write the docs and lessons with your Claude Code or Codex, verified against the code
  houserules scan [path]     Scan a repository into .houserules/analysis.json
  houserules render [path]   Write docs/houserules/*.md and the AGENTS.md / CLAUDE.md block from .houserules/docs.json
  houserules verify [path]   Re-check generated docs against the current code (exit 1 if anything is broken)
  houserules ci [path]       For a pull request: are the docs still true, and does the change follow the house rules?
  houserules ci-setup [path] Add a GitHub workflow that runs houserules ci on every pull request and comments once
  houserules preview [path]  Open a local web page with the docs, their evidence and the scan results
  houserules mcp             Start the MCP server on stdio (used by your agent, not by you)

init options:
  --agent <claude|codex|all>  Which agents to set up (default: the ones detected)
  --scope <project|user>      Install into this repo (default) or your home directory
  --dry-run                   Show what would change and stop
  -y, --yes                   Don't ask for confirmation
  --no-scan                   Skip the scan after installing

generate options:
  --agent <claude|codex>      Which agent writes them (default: the first one found)
  --only <docs|lessons>       Write just one of them (default: both)
  --model <name>              Model to ask the agent for
  --fresh                     Redo sections and lessons that are already written (default: keep them)
  --no-render                 Don't write docs/houserules/*.md and the AGENTS.md / CLAUDE.md block afterwards

ci options:
  --base <ref>                Compare against this ref, e.g. origin/main (default: uncommitted changes)
  --format <text|markdown|github>  github prints annotations GitHub shows on the diff (default: text)
  --report <file>             Also write the markdown report (for a PR comment)
  --all                       Check the house rules on every file, not just changed ones

scan options:
  --out <file>                Where to write analysis.json (default: <path>/.houserules/analysis.json)
  --json                      Print the summary as JSON instead of text (scan, verify)

preview options:
  --port <n>                  Port to listen on (default 4321)
  --host <addr>               Address to bind (default localhost: 127.0.0.1 and ::1)

  -h, --help                  Show this help
  -v, --version               Show the version
`;

export async function main(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      agent: { type: "string" },
      scope: { type: "string" },
      "dry-run": { type: "boolean" },
      yes: { type: "boolean", short: "y" },
      "no-scan": { type: "boolean" },
      "no-render": { type: "boolean" },
      only: { type: "string" },
      fresh: { type: "boolean" },
      base: { type: "string" },
      format: { type: "string" },
      report: { type: "string" },
      all: { type: "boolean" },
      model: { type: "string" },
      out: { type: "string" },
      json: { type: "boolean" },
      port: { type: "string" },
      host: { type: "string" },
      help: { type: "boolean", short: "h" },
      version: { type: "boolean", short: "v" },
    },
  });

  if (values.version) {
    console.log(VERSION);
    return 0;
  }
  const [command, target = "."] = positionals;
  if (values.help || !command) {
    console.log(HELP);
    return command || values.help ? 0 : 1;
  }

  switch (command) {
    case "scan":
      return runScan(target, { out: values.out, json: values.json ?? false });
    case "init":
      return runInit(target, {
        agent: values.agent,
        scope: values.scope,
        dryRun: values["dry-run"] ?? false,
        yes: values.yes ?? false,
        scan: !values["no-scan"],
      });
    case "generate":
      return runGenerate(target, { agent: values.agent, only: values.only, model: values.model, render: !values["no-render"], fresh: values.fresh ?? false });
    case "ci": {
      const format = (values.format ?? "text") as "text" | "markdown" | "github";
      if (!["text", "markdown", "github"].includes(format)) throw new Error("--format must be text, markdown or github");
      return runCi(target, { ...(values.base ? { base: values.base } : {}), format, ...(values.report ? { report: values.report } : {}), all: values.all ?? false });
    }
    case "ci-setup":
      return runCiSetup(target, { yes: values.yes ?? false, dryRun: values["dry-run"] ?? false });
    case "render":
      return runRender(target);
    case "verify":
      return runVerify(target, { json: values.json ?? false });
    case "preview": {
      const { runPreview } = await import("./preview/index.js");
      const port = Number(values.port ?? 4321);
      if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`--port must be a number between 1 and 65535`);
      return runPreview(target, { port, host: values.host ?? "localhost" });
    }
    case "mcp": {
      const { startStdioServer } = await import("@houserules/mcp");
      await startStdioServer(positionals[1] ? path.resolve(positionals[1]) : undefined);
      return -1; // keep the process alive; the transport owns its lifetime
    }
    default:
      console.error(`Unknown command: ${command}\n`);
      console.error(HELP);
      return 1;
  }
}

function isEntrypoint(): boolean {
  try {
    return realpathSync(process.argv[1] ?? "") === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isEntrypoint()) {
  main(process.argv.slice(2)).then(
    (code) => {
      if (code >= 0) process.exitCode = code;
    },
    (err: unknown) => {
      console.error(err instanceof Error ? err.message : err);
      process.exitCode = 1;
    },
  );
}
