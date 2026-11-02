import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { mcpCommand, runInit } from "./init.js";

const CLI = fileURLToPath(new URL("./index.js", import.meta.url));

async function fixture(): Promise<{ repo: string; home: string }> {
  const base = await mkdtemp(path.join(os.tmpdir(), "houserules-cli-"));
  const repo = path.join(base, "repo");
  const home = path.join(base, "home");
  await mkdir(path.join(repo, "src"), { recursive: true });
  await mkdir(path.join(home, ".claude"), { recursive: true });
  await writeFile(path.join(repo, "package.json"), JSON.stringify({ dependencies: { stripe: "^17" } }));
  await writeFile(path.join(repo, "src/pay.ts"), `import Stripe from "stripe";\nexport const s = new Stripe(process.env.STRIPE_KEY!);\n`);
  return { repo, home };
}

const exists = (p: string) => access(p).then(() => true, () => false);
const quiet = <T>(fn: () => Promise<T>): Promise<T> => {
  const log = console.log;
  console.log = () => {};
  return fn().finally(() => (console.log = log));
};

test("init --dry-run changes nothing", async () => {
  const { repo, home } = await fixture();
  const code = await quiet(() => runInit(repo, { dryRun: true, yes: false, scan: false, home, pathEnv: "" }));
  assert.equal(code, 0);
  assert.equal(await exists(path.join(repo, ".claude")), false);
  assert.equal(await exists(path.join(repo, ".mcp.json")), false);
});

test("init installs for the detected agent only, then scans", async () => {
  const { repo, home } = await fixture();
  const code = await quiet(() => runInit(repo, { dryRun: false, yes: true, scan: true, home, pathEnv: "" }));
  assert.equal(code, 0);
  assert.ok(await exists(path.join(repo, ".claude/skills/houserules/SKILL.md")));
  assert.equal(await exists(path.join(repo, ".agents")), false, "Codex wasn't detected, so nothing for it");
  const server = JSON.parse(await readFile(path.join(repo, ".mcp.json"), "utf8")).mcpServers.houserules;
  assert.deepEqual(server.args, [CLI, "mcp"]);
  assert.ok(await exists(path.join(repo, ".houserules/analysis.json")));
});

test("init declines without a terminal or --yes", async () => {
  const { repo, home } = await fixture();
  const code = await quiet(() => runInit(repo, { dryRun: false, yes: false, scan: false, home, pathEnv: "", confirm: async () => false }));
  assert.equal(code, 1);
  assert.equal(await exists(path.join(repo, ".mcp.json")), false);
});

test("init fails clearly when no agent is found", async () => {
  const { repo } = await fixture();
  const home = await mkdtemp(path.join(os.tmpdir(), "houserules-empty-"));
  const err = console.error;
  console.error = () => {};
  try {
    assert.equal(await quiet(() => runInit(repo, { dryRun: false, yes: true, scan: false, home, pathEnv: "", platform: "linux" })), 1);
  } finally {
    console.error = err;
  }
});

test("mcpCommand pins a version under npx and uses this install otherwise", () => {
  assert.deepEqual(mcpCommand("/Users/x/.npm/_npx/abc/node_modules/houserules/dist/index.js").command, "npx");
  assert.deepEqual(mcpCommand("/opt/houserules/dist/index.js"), { command: process.execPath, args: ["/opt/houserules/dist/index.js", "mcp"] });
});

test("`houserules mcp` serves the tools over stdio", async () => {
  const { repo } = await fixture();
  const client = new Client({ name: "test", version: "0.0.0" });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [CLI, "mcp"], cwd: repo, stderr: "ignore" }));
  try {
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map((t) => t.name).sort(), [
      "check_rules",
      "describe_entry_points",
      "find_importers",
      "find_symbol",
      "get_analysis",
      "get_doc_spec",
      "get_lesson_plan",
      "get_symbols",
      "list_entry_points",
      "list_imports",
      "official_docs",
      "render_docs",
      "save_answer",
      "scan",
      "search_answers",
      "submit_lessons",
      "submit_rules",
      "submit_section",
      "trace_entry_point",
    ]);

    const summary = JSON.parse(((await client.callTool({ name: "scan", arguments: {} })).content as { text: string }[])[0]!.text);
    assert.deepEqual(summary.integrations.map((i: { name: string }) => i.name), ["Stripe"]);

    const importers = JSON.parse(((await client.callTool({ name: "find_importers", arguments: { target: "stripe" } })).content as { text: string }[])[0]!.text);
    assert.deepEqual(importers.importers, [{ file: "src/pay.ts", line: 1, specifier: "stripe" }]);

    const call = async (name: string, args: Record<string, unknown>) =>
      JSON.parse(((await client.callTool({ name, arguments: args })).content as { text: string }[])[0]!.text);
    assert.deepEqual((await call("get_symbols", { file: "src/pay.ts" })).symbols.map((s: { name: string }) => s.name), ["s"]);
    const submitted = await call("submit_section", {
      doc: "architecture",
      section: "integrations",
      items: [
        { title: "Stripe is created in src/pay.ts", body: "", evidence: [{ path: "src/pay.ts", line: 2, symbol: "Stripe" }], confidence: "observed" },
        { title: "Made up", body: "", evidence: [{ path: "src/payments.ts" }], confidence: "observed" },
      ],
    });
    assert.equal(submitted.accepted.length, 1);
    assert.match(submitted.rejected[0].problems[0], /no such file/);
    const rendered = await call("render_docs", {});
    assert.ok(rendered.written.includes("docs/houserules/ARCHITECTURE.md"));
    assert.match(await readFile(path.join(repo, "docs/houserules/ARCHITECTURE.md"), "utf8"), /Stripe is created in src\/pay\.ts/);
  } finally {
    await client.close();
  }
});

test("preview serves the dashboard, docs with evidence links, and source with highlighted lines", async () => {
  const { repo } = await fixture();
  const { startPreview } = await import("./preview/index.js");
  const { submitSection, scan } = await import("@houserules/core");
  await submitSection(repo, await scan(repo), "architecture", "integrations", [
    { title: "Stripe client lives in src/pay.ts", body: "Created once in `src/pay.ts`.", evidence: [{ path: "src/pay.ts", line: 2, symbol: "Stripe" }], confidence: "observed" },
  ]);
  const port = 40000 + Math.floor(Math.random() * 20000);
  const preview = await startPreview(repo, { port, host: "127.0.0.1" });
  after(() => preview.close());
  const get = async (p: string) => {
    const r = await fetch(`http://127.0.0.1:${port}${p}`);
    return { status: r.status, text: await r.text() };
  };
  const home = await get("/health");
  assert.equal(home.status, 200);
  assert.match(home.text, /Everything still matches the code/);

  // Start here: task paths built from the doc sections that have items.
  const start = await get("/");
  assert.match(start.text, /<h1 class="hero-title">repo<\/h1>/);
  assert.match(start.text, /href="\/path\/services"/);
  assert.doesNotMatch(start.text, /href="\/path\/build"/, "paths with no items are hidden");
  const pathPage = await get("/path/services");
  assert.match(pathPage.text, /Work with third-party services/);
  assert.match(pathPage.text, /data-key="architecture\/integrations\/stripe-client-lives-in-src-pay-ts"/);
  assert.match(pathPage.text, /data-copy="In this repo, explain &quot;Stripe client lives in src\/pay\.ts&quot;/);
  assert.match(pathPage.text, /<details class="snippet" open>/, "integrations show their code inline");
  assert.equal((await get("/path/nope")).status, 404);

  // Diagrams are drawn from the code: an architecture map with modules and the Stripe service.
  const diagrams = await get("/diagrams");
  assert.equal(diagrams.status, 200);
  assert.match(diagrams.text, /<svg class="arch"/);
  assert.match(diagrams.text, /class="svc-node"[\s\S]*Stripe/);
  assert.match(home.text, /Stripe/);

  const doc = await get("/doc/architecture");
  assert.match(doc.text, />Checked in</, "verified items say so next to their sources");
  assert.match(doc.text, /class="src" href="\/source\?path=src%2Fpay\.ts&line=2" data-path="src\/pay\.ts" data-line="2"/);
  assert.match(doc.text, /<a href="\/source\?path=src%2Fpay\.ts"><code>src\/pay\.ts<\/code><\/a>/);

  const src = await get("/source?path=src/pay.ts&line=2");
  assert.match(src.text, /<tr id="L2" class="hit">/);
  const snippet = JSON.parse((await get("/api/source?path=src/pay.ts&line=2")).text);
  assert.deepEqual({ start: snippet.start, line: snippet.line, total: snippet.total }, { start: 1, line: 2, total: 2 });
  assert.match((await get("/doc/architecture")).text, /id="search-index">\[\{"g":"Docs","t":"Stripe client lives in src\/pay\.ts"/);
  assert.match(home.text, /id="recheck"[^>]*title="Check against code[^>]*><span class="lbl">Check<\/span>/);
  assert.match(home.text, /<meta name="houserules-state" content="1\|\|">/);

  // "Check against code" re-checks in the background and reports what changed.
  const post = async () => JSON.parse(await (await fetch(`http://127.0.0.1:${port}/api/recheck`, { method: "POST" })).text());
  const clean = await post();
  assert.deepEqual({ total: clean.total, broken: clean.broken, newlyBroken: clean.newlyBroken, sig: clean.sig }, { total: 1, broken: 0, newlyBroken: [], sig: "1||" });
  await writeFile(path.join(repo, "src/pay.ts"), "export const s = 1;\n");
  const afterChange = await post();
  assert.equal(afterChange.broken, 1);
  assert.deepEqual(afterChange.newlyBroken, ["Stripe client lives in src/pay.ts"]);
  assert.notEqual(afterChange.sig, clean.sig, "the page re-renders when results change");
  assert.equal((await post()).newlyBroken.length, 0, "already-broken items aren't reported as new again");
  assert.equal((await get("/source?path=../../etc/passwd")).status, 400);
  assert.equal((await get("/doc/nope")).status, 404);
});

test("the preview's client script is valid JavaScript", async () => {
  const { CLIENT_JS } = await import("./preview/assets.js");
  assert.doesNotThrow(() => new Function(CLIENT_JS), "a stray backslash in the template string breaks every page's script");
});

// A stand-in `claude`: records its arguments, connects to the MCP server it was given, calls a real tool and streams
// the events Claude Code would. Proves the wiring without a signed-in agent.
async function fakeClaude(dir: string, mode: "ok" | "logged-out"): Promise<string> {
  const marker = path.join(dir, "signed-in");
  if (mode === "ok") await writeFile(marker, "");
  else await rm(marker, { force: true });
  const sdk = path.dirname(fileURLToPath(import.meta.resolve("@modelcontextprotocol/sdk/client/index.js")));
  const bin = path.join(dir, "claude");
  await writeFile(
    bin,
    `#!${process.execPath}
const { writeFileSync, readFileSync, existsSync } = require("node:fs");
const signed = existsSync(${JSON.stringify(path.join(dir, "signed-in"))});
if (process.argv[2] === "auth" && process.argv[3] === "status") { console.log(JSON.stringify({ loggedIn: signed })); process.exit(signed ? 0 : 1); }
if (process.argv[2] === "auth" && process.argv[3] === "login") { writeFileSync(${JSON.stringify(path.join(dir, "signed-in"))}, ""); process.exit(0); }
(async () => {
const args = process.argv.slice(2);
writeFileSync(${JSON.stringify(path.join(dir, "args.json"))}, JSON.stringify({ args, cwd: process.cwd() }));
const out = (e) => console.log(JSON.stringify(e));
if (!signed) { out({ type: "result", is_error: true, result: "Not logged in · Please run /login" }); process.exit(1); }
const { Client } = await import(${JSON.stringify(path.join(sdk, "index.js"))});
const { StdioClientTransport } = await import(${JSON.stringify(path.join(sdk, "stdio.js"))});
const cfg = JSON.parse(readFileSync(args[args.indexOf("--mcp-config") + 1], "utf8")).mcpServers.houserules;
const client = new Client({ name: "fake", version: "0" });
await client.connect(new StdioClientTransport({ command: cfg.command, args: cfg.args, cwd: "/" }));
out({ type: "assistant", message: { content: [{ type: "tool_use", name: "mcp__houserules__scan", input: {} }] } });
const r = await client.callTool({ name: "scan", arguments: {} });
await client.close();
out({ type: "user", message: { content: [{ type: "tool_result", content: [{ type: "text", text: JSON.stringify({ accepted: [1, 2], rejected: [] }) }] }] } });
out({ type: "result", is_error: false, result: "scanned: " + r.content[0].text.slice(0, 2000) });
})();
`,
    { mode: 0o755 },
  );
  return bin;
}

test("generate runs the agent read-only with the houserules MCP server for this repo, and explains a missing sign-in", async () => {
  const { repo } = await fixture();
  const bin = await mkdtemp(path.join(os.tmpdir(), "houserules-bin-"));
  const { runGenerate } = await import("./generate.js");
  const path0 = process.env.PATH;
  const home0 = process.env.HOME;
  const lines: string[] = [];
  const log = console.log;
  const err = console.error;
  console.log = console.error = (...a: unknown[]) => lines.push(a.join(" "));
  try {
    process.env.PATH = bin;
    await fakeClaude(bin, "ok");
    const code = await runGenerate(repo, { agent: "claude", render: false });
    const { args, cwd } = JSON.parse(await readFile(path.join(bin, "args.json"), "utf8"));
    assert.equal(await import("node:fs").then((f) => f.realpathSync(cwd)), await import("node:fs").then((f) => f.realpathSync(repo)));
    assert.ok(args.includes("--strict-mcp-config"));
    for (const t of ["Edit", "Write", "Bash"]) assert.ok(args.slice(args.indexOf("--disallowedTools")).includes(t), `${t} is blocked`);
    assert.match(args[args.indexOf("-p") + 1], /submit_lessons/, "the skill is in the prompt");
    const out = lines.join("\n");
    assert.match(out, /  scan\n    ✓ 2 accepted/);
    assert.match(out, /Stripe/, "the MCP server scanned this repo, not its working directory");
    assert.equal(code, 1, "nothing was stored, so it isn't a success");

    // Signed out: generate checks before scanning, offers to sign in, and says what to run when declined.
    lines.length = 0;
    await rm(path.join(bin, "args.json"));
    await fakeClaude(bin, "logged-out");
    assert.equal(await runGenerate(repo, { agent: "claude", render: false, confirm: async () => false }), 1);
    assert.match(lines.join("\n"), /installed but not signed in[\s\S]*claude auth login/);
    assert.ok(!(await exists(path.join(bin, "args.json"))), "the agent never ran");
    assert.ok(!lines.join("\n").includes("Scanning"), "nothing slow before the sign-in check");

    // Accepting the offer runs the agent's own sign-in, then carries on.
    lines.length = 0;
    assert.equal(await runGenerate(repo, { agent: "claude", render: false, confirm: async () => true }), 1);
    assert.ok(await exists(path.join(bin, "args.json")), "the agent ran after signing in");

    // Nothing installed: say how to install either agent.
    lines.length = 0;
    process.env.PATH = await mkdtemp(path.join(os.tmpdir(), "houserules-empty-"));
    process.env.HOME = process.env.PATH; // no desktop app bundle either
    assert.equal(await runGenerate(repo, { render: false }), 1);
    assert.match(lines.join("\n"), /none was found[\s\S]*claude-code[\s\S]*codex/);
  } finally {
    process.env.PATH = path0;
    process.env.HOME = home0;
    console.log = log;
    console.error = err;
  }
});

test("ci: a pull request that breaks a house rule fails with the line, and the report lists docs citing the changed files", async () => {
  const { execFileSync } = await import("node:child_process");
  const { scan, submitRules, saveAnswer } = await import("@houserules/core");
  const { runCi } = await import("./ci.js");
  const repo = await mkdtemp(path.join(os.tmpdir(), "houserules-ci-"));
  await mkdir(path.join(repo, "src/models"), { recursive: true });
  await writeFile(path.join(repo, "package.json"), "{}");
  await writeFile(path.join(repo, "src/models/order.ts"), `export class Order {\n  status = "pending";\n  changeStatus(s: string) {\n    this.status = s;\n  }\n}\n`);
  await writeFile(path.join(repo, "src/skip.ts"), `import { Order } from "./models/order";\nexport function skip(o: Order) {\n  o.changeStatus("skipped");\n}\n`);
  const git = (...args: string[]) => execFileSync("git", args, { cwd: repo, stdio: "pipe" });
  git("init", "-q", "-b", "main");
  git("-c", "user.email=t@example.com", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "start");
  const a = await scan(repo);
  const rules = await submitRules(repo, a, [{ title: "Change status through changeStatus, never by assigning it", files: ["src/**/*.ts"], except: ["src/models/**"], forbid: "\\.status\\s*=[^=]", fix: "Call `changeStatus`." }]);
  assert.equal(rules.accepted.length, 1);
  assert.equal((await saveAnswer(repo, a, { question: "How is an order skipped?", answer: "`skip` calls `changeStatus`.", evidence: [{ path: "src/skip.ts", line: 3 }] })).accepted, true);
  git("add", "-A");
  git("-c", "user.email=t@example.com", "-c", "user.name=t", "commit", "-q", "-m", "base");

  const lines: string[] = [];
  const log = console.log;
  console.log = (...x: unknown[]) => lines.push(x.join(" "));
  try {
    assert.equal(await runCi(repo, { base: "HEAD", format: "text" }), 0, "nothing changed: passes");
    await writeFile(path.join(repo, "src/skip.ts"), `import { Order } from "./models/order";\nexport function skip(o: Order) {\n  o.status = "skipped";\n}\n`);
    git("-c", "user.email=t@example.com", "-c", "user.name=t", "commit", "-qam", "pr");
    lines.length = 0;
    const report = path.join(repo, "report.md");
    assert.equal(await runCi(repo, { base: "HEAD~1", format: "github", report }), 1, "a new error-level violation fails the check");
    assert.ok(lines.some((l) => l.startsWith("::error file=src/skip.ts,line=3,title=House rule: Change status through changeStatus")), lines.join("\n"));
    const md = await readFile(report, "utf8");
    assert.match(md, /<!-- houserules -->/);
    assert.match(md, /`src\/skip\.ts:3` Change status through changeStatus/);
    assert.match(md, /How is an order skipped\? \(saved answer\): `src\/skip\.ts`/, "answers citing changed files are listed for review");
  } finally {
    console.log = log;
  }
});
