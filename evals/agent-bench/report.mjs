#!/usr/bin/env node
// Builds report.md and a self-contained report.html from results/<ts>/results.json.
//   node evals/agent-bench/report.mjs evals/agent-bench/results/<ts>
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const median = (xs) => {
  const s = xs.filter((x) => typeof x === "number" && !Number.isNaN(x)).sort((a, b) => a - b);
  if (!s.length) return 0;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const pct = (x) => `${Math.round(x * 100)}%`;
const secs = (ms) => (ms == null ? "–" : `${Math.round(ms / 1000)}s`);
const ktok = (n) => (n == null ? "–" : n >= 1000 ? `${(n / 1000).toFixed(n >= 100000 ? 0 : 1)}k` : String(n));
const usd = (x) => `$${x.toFixed(2)}`;
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const runMs = (r) => r.durationMs ?? r.wallMs;

export function summarize(results, conditions) {
  return conditions.map((condition) => {
    const rs = results.filter((r) => r.condition === condition);
    const correct = rs.filter((r) => r.correct).length;
    return {
      condition,
      n: rs.length,
      correct,
      failed: rs.filter((r) => r.failed).length,
      accuracy: rs.length ? correct / rs.length : 0,
      avgRecall: avg(rs.map((r) => r.factRecall)),
      avgCitation: avg(rs.map((r) => r.citationScore)),
      // Medians are over completed runs; failed runs (timeouts, crashes) are counted separately.
      medianMs: median(rs.filter((r) => !r.failed).map(runMs)),
      medianTokens: median(rs.filter((r) => !r.failed).map((r) => r.tokens?.total)),
      totalCost: rs.reduce((a, r) => a + (r.costUsd ?? 0), 0),
      medianTurns: median(rs.map((r) => r.numTurns)),
      avgToolCalls: avg(rs.map((r) => r.toolCalls?.total ?? 0)),
      avgMcpCalls: avg(rs.map((r) => r.toolCalls?.houserules ?? 0)),
      avgFileCalls: avg(rs.map((r) => r.toolCalls?.file ?? 0)),
      runsWithoutMcp: rs.filter((r) => (r.toolCalls?.houserules ?? 0) === 0).length,
      writeAttempts: rs.reduce((a, r) => a + (r.toolCalls?.writeAttempts?.length ?? 0), 0),
    };
  });
}

/** Per question, pairs baseline and houserules and lists where houserules did worse. */
function pairs(results) {
  const ids = [...new Set(results.map((r) => r.id))];
  return ids.map((id) => {
    const b = results.find((r) => r.id === id && r.condition === "baseline");
    const h = results.find((r) => r.id === id && r.condition === "houserules");
    return { id, question: (b ?? h).question, trace: (b ?? h).trace, b, h };
  });
}

function losses(ps) {
  const out = [];
  for (const { id, question, b, h } of ps) {
    if (!b || !h) continue;
    const why = [];
    if (h.failed) why.push(`run failed (${h.failure})`);
    if (b.correct && !h.correct) why.push(`wrong answer (recall ${h.factRecall.toFixed(2)} vs ${b.factRecall.toFixed(2)})${h.failed ? `, ${h.failure}` : ""}`);
    else if (h.factRecall < b.factRecall) why.push(`lower fact recall (${h.factRecall.toFixed(2)} vs ${b.factRecall.toFixed(2)})`);
    if (h.citationScore < b.citationScore) why.push(`fewer gold files cited (${h.citationScore.toFixed(2)} vs ${b.citationScore.toFixed(2)})`);
    if (runMs(h) > runMs(b) * 1.1) why.push(`slower (${secs(runMs(h))} vs ${secs(runMs(b))})`);
    if ((h.tokens?.total ?? 0) > (b.tokens?.total ?? 0) * 1.1) why.push(`more tokens (${ktok(h.tokens.total)} vs ${ktok(b.tokens.total)})`);
    if ((h.costUsd ?? 0) > (b.costUsd ?? 0) * 1.1) why.push(`costlier (${usd(h.costUsd)} vs ${usd(b.costUsd)})`);
    if (!h.failed && (h.toolCalls?.houserules ?? 0) === 0) why.push("never called a houserules tool");
    if (why.length) out.push({ id, question, missed: h.facts.filter((f) => !f.hit).map((f) => f.fact), why });
  }
  return out;
}

const mark = (r) => (!r ? "–" : r.failed ? "fail" : r.correct ? "yes" : "no");

function markdown(meta, summary, ps, ls) {
  const L = [];
  L.push(`# Agent bench: ${meta.suite}`, "");
  L.push(`Does Claude Code answer questions about this codebase better, faster and cheaper with the houserules MCP server than with file tools alone?`, "");
  L.push(`- Run: ${meta.startedAt}${meta.fake ? " (**FAKE agent: numbers are synthetic**)" : ""}`);
  L.push(`- Repo: \`${meta.repo}\``);
  L.push(`- Model: ${meta.model ?? "CLI default"}; timeout ${meta.timeoutSec}s; concurrency ${meta.concurrency}`);
  L.push(`- Grading: deterministic. Correct = fact recall >= 0.6. Tokens = input + output + cache read. Medians over completed runs.`, "");
  L.push(`## Headline`, "");
  L.push(`| | ${summary.map((s) => s.condition).join(" | ")} |`);
  L.push(`|---|${summary.map(() => "---").join("|")}|`);
  const row = (label, f) => L.push(`| ${label} | ${summary.map(f).join(" | ")} |`);
  row("Accuracy", (s) => `${pct(s.accuracy)} (${s.correct}/${s.n})`);
  row("Avg fact recall", (s) => s.avgRecall.toFixed(2));
  row("Avg citation score", (s) => s.avgCitation.toFixed(2));
  row("Median time", (s) => secs(s.medianMs));
  row("Median tokens", (s) => ktok(Math.round(s.medianTokens)));
  row("Total cost", (s) => usd(s.totalCost));
  row("Median turns", (s) => String(s.medianTurns));
  row("Avg tool calls (houserules / file)", (s) => `${s.avgToolCalls.toFixed(1)} (${s.avgMcpCalls.toFixed(1)} / ${s.avgFileCalls.toFixed(1)})`);
  row("Failed runs", (s) => String(s.failed));
  row("Write attempts (should be 0)", (s) => String(s.writeAttempts));
  L.push("");
  L.push(`## Per question`, "");
  L.push(`| id | question | correct (base / hr) | recall | time | tokens | cost |`);
  L.push(`|---|---|---|---|---|---|---|`);
  for (const { id, question, trace, b, h } of ps) {
    const two = (f) => `${b ? f(b) : "–"} / ${h ? f(h) : "–"}`;
    L.push(`| ${id}${trace ? "*" : ""} | ${question.replace(/\|/g, "\\|")} | ${two(mark)} | ${two((r) => r.factRecall.toFixed(2))} | ${two((r) => secs(runMs(r)))} | ${two((r) => ktok(r.tokens?.total))} | ${two((r) => usd(r.costUsd ?? 0))} |`);
  }
  L.push("", "`*` = needs tracing across files.", "");
  L.push(`## Where houserules lost`, "");
  if (!ls.length) L.push("Nowhere on these questions.");
  for (const l of ls) L.push(`- **${l.id}** ${l.why.join("; ")}${l.missed.length ? `. Missed: ${l.missed.map((m) => `\`${m}\``).join(", ")}` : ""}`);
  L.push("");
  return L.join("\n");
}

function html(meta, summary, ps, ls) {
  const b = summary.find((s) => s.condition === "baseline");
  const h = summary.find((s) => s.condition === "houserules");
  const delta = (hv, bv, lowerBetter, fmt) => {
    if (!b || !h || !bv) return "";
    const d = (hv - bv) / bv;
    const good = lowerBetter ? d < 0 : d > 0;
    return `<span class="delta ${Math.abs(d) < 0.005 ? "" : good ? "good" : "bad"}">${d > 0 ? "+" : ""}${fmt ? fmt(hv - bv) : `${Math.round(d * 100)}%`}</span>`;
  };
  const cards = [
    ["Accuracy", (s) => pct(s.accuracy), (s) => `${s.correct}/${s.n} correct`, h && b ? delta(h.accuracy, b.accuracy || 1e-9, false, (x) => `${x > 0 ? "" : ""}${Math.round(x * 100)} pts`) : ""],
    ["Avg fact recall", (s) => s.avgRecall.toFixed(2), () => "fraction of facts found", h && b ? delta(h.avgRecall, b.avgRecall, false) : ""],
    ["Avg citation score", (s) => s.avgCitation.toFixed(2), () => "gold files cited", h && b ? delta(h.avgCitation, b.avgCitation, false) : ""],
    ["Median time", (s) => secs(s.medianMs), (s) => `median ${s.medianTurns} turns`, h && b ? delta(h.medianMs, b.medianMs, true) : ""],
    ["Median tokens", (s) => ktok(Math.round(s.medianTokens)), () => "input + output + cache read", h && b ? delta(h.medianTokens, b.medianTokens, true) : ""],
    ["Total cost", (s) => usd(s.totalCost), (s) => `${s.n} runs`, h && b ? delta(h.totalCost, b.totalCost, true) : ""],
  ];
  const card = ([label, v, sub, d]) => `<div class="card"><div class="label">${label}</div>${summary.map((s) => `<div class="cond"><span class="cname ${s.condition}">${s.condition}</span><span class="val">${v(s)}</span><span class="sub">${sub(s)}</span></div>`).join("")}${d ? `<div class="dline">houserules vs baseline ${d}</div>` : ""}</div>`;
  const cell = (r) => (!r ? "<td>–</td>" : `<td class="${r.failed ? "fail" : r.correct ? "ok" : "no"}">${mark(r)}<small>${r.factRecall.toFixed(2)}</small></td>`);
  const num = (r, f) => `<td class="num">${r ? f(r) : "–"}</td>`;
  const rows = ps
    .map(({ id, question, trace, b: rb, h: rh }) => `<tr><td class="id">${id}${trace ? '<span title="needs tracing across files">*</span>' : ""}</td><td class="q">${esc(question)}</td>${cell(rb)}${cell(rh)}${num(rb, (r) => secs(runMs(r)))}${num(rh, (r) => secs(runMs(r)))}${num(rb, (r) => ktok(r.tokens?.total))}${num(rh, (r) => ktok(r.tokens?.total))}${num(rh, (r) => String(r.toolCalls?.houserules ?? 0))}</tr>`)
    .join("\n");
  const lossItems = ls.length ? ls.map((l) => `<li><b>${l.id}</b> ${esc(l.question)}<div class="why">${l.why.map(esc).join(" · ")}${l.missed.length ? `<br>missed: ${l.missed.map((m) => `<code>${esc(m)}</code>`).join(" ")}` : ""}</div></li>`).join("\n") : "<li>Nowhere on these questions.</li>";
  const extra = summary.map((s) => `<tr><td>${s.condition}</td><td class="num">${s.avgToolCalls.toFixed(1)}</td><td class="num">${s.avgMcpCalls.toFixed(1)}</td><td class="num">${s.avgFileCalls.toFixed(1)}</td><td class="num">${s.failed}</td><td class="num">${s.writeAttempts}</td></tr>`).join("");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Agent bench report</title>
<style>
:root{--accent:#0f766e;--bg:#fafaf9;--panel:#fff;--text:#1c1917;--muted:#78716c;--line:#e7e5e4;--good:#15803d;--bad:#b91c1c;--warn:#a16207}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
main{max-width:1100px;margin:0 auto;padding:32px 16px 64px}
h1{font-size:26px;margin:0 0 4px}h2{font-size:18px;margin:36px 0 12px;color:var(--accent)}
.lede{color:var(--muted);margin:0 0 16px}.meta{font-size:13px;color:var(--muted)}.meta code{font-size:12px}
.fake{background:#fef3c7;color:var(--warn);padding:8px 12px;border-radius:6px;margin:12px 0;font-weight:600}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px}
.card{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:14px 16px;border-top:3px solid var(--accent)}
.label{font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:var(--muted);margin-bottom:6px}
.cond{display:flex;align-items:baseline;gap:8px;margin:2px 0}.cname{font-size:12px;width:78px;color:var(--muted)}.cname.houserules{color:var(--accent);font-weight:600}
.val{font-size:20px;font-weight:650;font-variant-numeric:tabular-nums}.sub{font-size:12px;color:var(--muted)}
.dline{font-size:12px;color:var(--muted);margin-top:6px;border-top:1px dashed var(--line);padding-top:6px}
.delta{font-weight:600}.delta.good{color:var(--good)}.delta.bad{color:var(--bad)}
.tablewrap{overflow-x:auto;background:var(--panel);border:1px solid var(--line);border-radius:10px}
table{border-collapse:collapse;width:100%;font-size:14px}th,td{padding:8px 10px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}
th{font-size:12px;color:var(--muted);font-weight:600;background:#f5f5f4;white-space:nowrap}tr:last-child td{border-bottom:0}
td.num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}td.id{font-weight:600;white-space:nowrap}td.q{min-width:260px}
td.ok,td.no,td.fail{font-weight:600;white-space:nowrap}td.ok{color:var(--good)}td.no{color:var(--bad)}td.fail{color:var(--warn)}
td small{display:block;font-weight:400;color:var(--muted);font-size:12px}
ul.losses{padding-left:18px}ul.losses li{margin:8px 0}.why{font-size:13px;color:var(--muted)}code{background:#f5f5f4;padding:1px 4px;border-radius:4px;font-size:12px}
footer{margin-top:32px;font-size:12px;color:var(--muted)}
</style></head><body><main>
<h1>Agent bench: ${esc(meta.suite)}</h1>
<p class="lede">Does Claude Code answer questions about this codebase better, faster and cheaper with the houserules MCP server than with file tools alone?</p>
${meta.fake ? '<div class="fake">FAKE agent run: these numbers are synthetic and only test the harness.</div>' : ""}
<div class="meta">${esc(meta.startedAt)} · repo <code>${esc(meta.repo)}</code> · model ${esc(meta.model ?? "CLI default")} · timeout ${meta.timeoutSec}s · correct = fact recall ≥ 0.6 · tokens = input + output + cache read</div>
<h2>Headline</h2>
<div class="cards">${cards.map(card).join("")}</div>
<h2>Per question</h2>
<div class="tablewrap"><table><thead><tr><th>id</th><th>question</th><th>baseline</th><th>houserules</th><th>time base</th><th>time hr</th><th>tokens base</th><th>tokens hr</th><th>hr MCP calls</th></tr></thead><tbody>
${rows}
</tbody></table></div>
<p class="meta">Cells show correct / not, with fact recall underneath. * = needs tracing across files.</p>
<h2>Where houserules lost</h2>
<ul class="losses">${lossItems}</ul>
<h2>Tool use</h2>
<div class="tablewrap"><table><thead><tr><th>condition</th><th>avg tool calls</th><th>avg houserules calls</th><th>avg file calls</th><th>failed runs</th><th>write attempts</th></tr></thead><tbody>${extra}</tbody></table></div>
<footer>Deterministic grading (regex facts + cited files). An LLM judge would catch paraphrases and wrong-but-keyword-rich answers; not used here.</footer>
</main></body></html>
`;
}

export function writeReport(outDir) {
  const meta = JSON.parse(readFileSync(path.join(outDir, "meta.json"), "utf8"));
  const results = JSON.parse(readFileSync(path.join(outDir, "results.json"), "utf8"));
  const conditions = meta.conditions ?? [...new Set(results.map((r) => r.condition))];
  const summary = summarize(results, conditions);
  const ps = pairs(results);
  const ls = losses(ps);
  const md = path.join(outDir, "report.md");
  const htmlPath = path.join(outDir, "report.html");
  writeFileSync(md, markdown(meta, summary, ps, ls));
  writeFileSync(htmlPath, html(meta, summary, ps, ls));
  writeFileSync(path.join(outDir, "summary.json"), JSON.stringify(summary, null, 2));
  return { md, html: htmlPath, summary };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dir = process.argv[2];
  if (!dir) {
    console.error("usage: node report.mjs <results dir>");
    process.exit(1);
  }
  const { md, html: h } = writeReport(path.resolve(dir));
  console.log(`${md}\n${h}`);
}
