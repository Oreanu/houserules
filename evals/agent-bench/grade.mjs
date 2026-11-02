// Deterministic grading for one agent run: no LLM judge. Pure functions so run.mjs and report.mjs can share them.
import path from "node:path";

export const CORRECT_THRESHOLD = 0.6;
const MCP_PREFIX = "mcp__houserules__";
const FILE_TOOLS = new Set(["Read", "Grep", "Glob", "LS"]);
const WRITE_TOOLS = new Set(["Edit", "MultiEdit", "Write", "NotebookEdit", "Bash", "WebFetch", "WebSearch", "Task", "Agent"]);

/** A fact is a case-insensitive regex; if it doesn't compile it is matched as a plain substring. */
export function factMatches(fact, text) {
  try {
    return new RegExp(fact, "i").test(text);
  } catch {
    return text.toLowerCase().includes(fact.toLowerCase());
  }
}

/** A gold file counts as cited if the answer contains its repo-relative path or its basename. */
export function fileCited(file, text) {
  return text.includes(file) || text.includes(path.basename(file));
}

/** Parses a Claude Code stream-json transcript (array of event objects) into the numbers we grade. */
export function parseTranscript(events) {
  const toolCalls = [];
  let result = null;
  let init = null;
  let lastAssistantText = "";
  for (const e of events) {
    if (e.type === "system" && e.subtype === "init") init = e;
    if (e.type === "assistant" && Array.isArray(e.message?.content)) {
      const texts = [];
      for (const c of e.message.content) {
        if (c.type === "tool_use") toolCalls.push({ name: c.name, input: c.input });
        if (c.type === "text" && c.text) texts.push(c.text);
      }
      if (texts.length) lastAssistantText = texts.join("\n");
    }
    if (e.type === "result") result = e;
  }
  const mcpServer = init?.mcp_servers?.find((s) => s.name === "houserules") ?? null;
  const usage = result?.usage ?? {};
  const input = usage.input_tokens ?? 0;
  const output = usage.output_tokens ?? 0;
  const cacheRead = usage.cache_read_input_tokens ?? 0;
  const cacheCreate = usage.cache_creation_input_tokens ?? 0;
  return {
    answer: typeof result?.result === "string" ? result.result : lastAssistantText,
    hasResult: !!result,
    isError: !!result?.is_error || (result?.subtype && result.subtype !== "success"),
    resultSubtype: result?.subtype ?? null,
    costUsd: result?.total_cost_usd ?? 0,
    durationMs: result?.duration_ms ?? null,
    numTurns: result?.num_turns ?? null,
    tokens: { input, output, cacheRead, cacheCreate, total: input + output + cacheRead },
    toolCalls: {
      total: toolCalls.length,
      houserules: toolCalls.filter((t) => t.name.startsWith(MCP_PREFIX)).length,
      file: toolCalls.filter((t) => FILE_TOOLS.has(t.name)).length,
      other: toolCalls.filter((t) => !t.name.startsWith(MCP_PREFIX) && !FILE_TOOLS.has(t.name)).length,
      writeAttempts: toolCalls.filter((t) => WRITE_TOOLS.has(t.name)).map((t) => t.name),
      byName: toolCalls.reduce((m, t) => ((m[t.name] = (m[t.name] ?? 0) + 1), m), {}),
    },
    mcpStatus: mcpServer?.status ?? null,
    model: init?.model ?? null,
  };
}

/** Grades an answer against a question's facts and gold files. */
export function gradeAnswer(question, answer) {
  const text = answer ?? "";
  const facts = question.facts.map((f) => ({ fact: f, hit: factMatches(f, text) }));
  const files = question.files.map((f) => ({ file: f, hit: fileCited(f, text) }));
  const factRecall = facts.length ? facts.filter((f) => f.hit).length / facts.length : 0;
  const citationScore = files.length ? files.filter((f) => f.hit).length / files.length : 0;
  return { factRecall, citationScore, correct: factRecall >= CORRECT_THRESHOLD, facts, files };
}

/** Full grade for one run: parse + grade. A failed run (timeout, crash, no result) is never correct. */
export function gradeRun(question, events, meta = {}) {
  const parsed = parseTranscript(events);
  const failed = !!meta.timedOut || !parsed.hasResult || parsed.isError;
  const g = gradeAnswer(question, failed && !parsed.answer ? "" : parsed.answer);
  return {
    ...parsed,
    ...g,
    correct: failed ? false : g.correct,
    failed,
    failure: meta.timedOut ? "timeout" : !parsed.hasResult ? "no result event" : parsed.isError ? `error: ${parsed.resultSubtype}` : null,
    wallMs: meta.wallMs ?? null,
  };
}

// Self-check: every gold answer must pass its own facts (run `node grade.mjs`).
if (import.meta.url === `file://${process.argv[1]}`) {
  const { readFileSync } = await import("node:fs");
  const file = process.argv[2] ?? new URL("./questions.json", import.meta.url).pathname;
  const { questions } = JSON.parse(readFileSync(file, "utf8"));
  let bad = 0;
  for (const q of questions) {
    const g = gradeAnswer(q, q.answer + "\n" + q.files.join("\n"));
    const miss = g.facts.filter((f) => !f.hit).map((f) => f.fact);
    if (g.factRecall < 1 || g.citationScore < 1) {
      bad++;
      console.log(`${q.id}: recall ${g.factRecall.toFixed(2)} missing ${JSON.stringify(miss)}`);
    }
  }
  console.log(bad ? `${bad} gold answers fail their own facts` : `all ${questions.length} gold answers pass their facts`);
  process.exit(bad ? 1 : 0);
}
