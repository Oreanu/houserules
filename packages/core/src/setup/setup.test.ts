import assert from "node:assert/strict";
import { chmod, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { makeTree } from "../test-utils.js";
import { detectAgents } from "./agents.js";
import { applyInstall, planInstall } from "./install.js";

test("detectAgents finds binaries on PATH and config dirs in home", async () => {
  const home = await makeTree({ ".codex/config.toml": "" });
  const bin = await makeTree({ claude: "#!/bin/sh\n" });
  await chmod(path.join(bin, "claude"), 0o755);

  const agents = await detectAgents({ home, pathEnv: bin, platform: "linux" });
  const claude = agents.find((a) => a.id === "claude")!;
  const codex = agents.find((a) => a.id === "codex")!;
  assert.equal(claude.installed, true);
  assert.equal(claude.binary, path.join(bin, "claude"));
  assert.equal(codex.installed, true);
  assert.equal(codex.binary, null);
  assert.deepEqual(codex.evidence, ["~/.codex config directory"]);
});

test("detectAgents reports nothing on a bare machine", async () => {
  const home = await makeTree({});
  const agents = await detectAgents({ home, pathEnv: "", platform: "linux" });
  assert.deepEqual(agents.map((a) => a.installed), [false, false]);
});

test("project install: skills, .mcp.json merge, Codex config append, idempotent", async () => {
  const skill = await makeTree({ "SKILL.md": "---\nname: houserules\n---\n" });
  const home = await makeTree({ ".codex/config.toml": '# my settings\nmodel = "gpt-5"\n' });
  const repo = await makeTree({ ".mcp.json": JSON.stringify({ mcpServers: { other: { command: "x" } } }) });
  const mcp = { command: "/usr/bin/node", args: ["/opt/houserules/cli.js", "mcp"] };
  const opts = { repoRoot: repo, agents: ["claude", "codex"] as const, scope: "project" as const, skillSourceDir: skill, mcp, home };

  const plan = await planInstall({ ...opts, agents: [...opts.agents] });
  assert.ok(plan.every((a) => !a.upToDate));
  await applyInstall(plan);

  assert.match(await readFile(path.join(repo, ".claude/skills/houserules/SKILL.md"), "utf8"), /name: houserules/);
  assert.match(await readFile(path.join(repo, ".agents/skills/houserules/SKILL.md"), "utf8"), /name: houserules/);

  const mcpJson = JSON.parse(await readFile(path.join(repo, ".mcp.json"), "utf8"));
  assert.deepEqual(mcpJson.mcpServers.other, { command: "x" }, "existing servers are kept");
  assert.deepEqual(mcpJson.mcpServers.houserules, { type: "stdio", ...mcp });

  const toml = await readFile(path.join(home, ".codex/config.toml"), "utf8");
  assert.ok(toml.startsWith('# my settings\nmodel = "gpt-5"\n'), "user's comments and settings are preserved");
  assert.match(toml, /\[mcp_servers\.houserules\]\ncommand = "\/usr\/bin\/node"\nargs = \["\/opt\/houserules\/cli\.js", "mcp"\]/);

  assert.equal(await readFile(path.join(repo, ".houserules/.gitignore"), "utf8"), "analysis.json\ncache/\n");

  const again = await planInstall({ ...opts, agents: [...opts.agents] });
  assert.ok(again.every((a) => a.upToDate), "second run has nothing to do");
});

test("user scope: Claude MCP becomes a manual `claude mcp add` step", async () => {
  const skill = await makeTree({ "SKILL.md": "x" });
  const home = await makeTree({});
  const repo = await makeTree({});
  await mkdir(path.join(home, ".claude"));
  const plan = await planInstall({ repoRoot: repo, agents: ["claude"], scope: "user", skillSourceDir: skill, mcp: { command: "node", args: ["/a b/cli.js", "mcp"] }, home });

  const copy = plan.find((a) => a.kind === "copy-dir")!;
  assert.equal(copy.kind === "copy-dir" && copy.to, path.join(home, ".claude/skills/houserules"));
  const manual = plan.find((a) => a.kind === "manual");
  assert.equal(manual?.kind === "manual" && manual.command, "claude mcp add --scope user houserules -- node '/a b/cli.js' mcp");

  await applyInstall(plan);
  await assert.rejects(readFile(path.join(home, ".claude.json"), "utf8"), "never writes ~/.claude.json");
});
