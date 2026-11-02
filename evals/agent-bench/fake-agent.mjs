#!/usr/bin/env node
// Stub for `claude -p ... --output-format stream-json`: emits a plausible transcript without calling any model.
// Used by `run.mjs --fake` to test the harness end to end. Answers are built from the question's gold answer,
// degraded for some questions so the report has wins, losses and a timeout-free failure to show.
import { readFileSync } from "node:fs";

const args = process.argv.slice(2);
const hasMcp = args.includes("--mcp-config") && args.join(" ").includes("mcp__houserules");
const id = process.env.BENCH_QID ?? "q00";
const n = Number(id.slice(1));
const questions = JSON.parse(readFileSync(new URL("./questions.json", import.meta.url), "utf8")).questions;
const q = questions.find((x) => x.id === id);

const emit = (e) => process.stdout.write(JSON.stringify(e) + "\n");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (process.env.FAKE_AGENT_CRASH === id) {
  process.stderr.write("simulated crash\n");
  process.exit(1);
}

emit({ type: "system", subtype: "init", model: "fake-model", tools: ["Read", "Grep", "Glob"], mcp_servers: hasMcp ? [{ name: "houserules", status: "connected" }] : [] });
const tools = hasMcp ? ["mcp__houserules__get_docs", "mcp__houserules__trace_entry_point", "Read"] : ["Grep", "Glob", "Read", "Read", "Grep", "Read"];
for (const [i, name] of tools.entries()) {
  emit({ type: "assistant", message: { content: [{ type: "tool_use", id: `t${i}`, name, input: {} }] } });
  emit({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: `t${i}`, content: "ok" }] } });
}
await sleep(50 + n * 5);

// Degrade: baseline misses facts on odd questions; houserules misses on every 7th question.
let answer = q ? `${q.answer}\n\nSources: ${q.files.map((f) => `${f}:1`).join(", ")}` : "no question";
const degrade = hasMcp ? n % 7 === 0 : n % 2 === 1;
if (degrade && q) answer = `I could not fully trace this. It probably involves ${q.files[0]}.`;

emit({ type: "assistant", message: { content: [{ type: "text", text: answer }] } });
const turns = tools.length + 1;
emit({
  type: "result",
  subtype: "success",
  is_error: false,
  result: answer,
  duration_ms: (hasMcp ? 20000 : 45000) + n * 1000,
  num_turns: turns,
  total_cost_usd: (hasMcp ? 0.05 : 0.11) + n * 0.002,
  usage: { input_tokens: 40 + n, output_tokens: 600 + n * 10, cache_read_input_tokens: (hasMcp ? 30000 : 90000) + n * 500, cache_creation_input_tokens: 8000 },
});
