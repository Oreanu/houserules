import { access, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { changedFiles, checkRules, readAnswers, readStore, recheckAnswers, recheckStore, scan, VERSION, writeAnalysis, type RuleResult, type StaleReport } from "@houserules/core";

export interface CiOptions {
  base?: string; // compare against this ref (a PR's base); default: uncommitted changes
  format: "text" | "markdown" | "github";
  report?: string; // also write the markdown report here (for a PR comment)
  all?: boolean; // check rules on every file, not just changed ones
}

interface CiResult {
  changed: string[] | null;
  broken: StaleReport[];
  drifted: StaleReport[];
  touched: { title: string; where: string; files: string[] }[]; // docs citing files this change edits
  rules: RuleResult[];
  total: number;
}

/**
 * One command for a pull request: are the docs, AGENTS.md and saved answers still true after this change, and
 * does the change follow the house rules? Exits 1 only for broken docs or new rule errors, so it can gate a PR.
 */
export async function runCi(target: string, opts: CiOptions): Promise<number> {
  const root = path.resolve(target);
  const analysis = await scan(root);
  await writeAnalysis(root, analysis);
  const changed = opts.all ? null : await changedFiles(root, opts.base);
  const [docs, answers, rules] = await Promise.all([recheckStore(root, analysis), recheckAnswers(root, analysis), checkRules(root, analysis, changed ? { files: changed } : {})]);
  const touched = changed?.length ? await citing(root, new Set(changed)) : [];
  const res: CiResult = { changed, broken: [...docs.broken, ...answers.broken], drifted: [...docs.changed, ...answers.changed], touched, rules, total: docs.total + answers.total };
  const md = markdown(res, opts.base);
  if (opts.report) await writeFile(path.resolve(opts.report), md);
  if (opts.format === "github") {
    for (const a of annotations(res)) console.log(a);
    if (process.env.GITHUB_STEP_SUMMARY) await writeFile(process.env.GITHUB_STEP_SUMMARY, md, { flag: "a" });
  } else if (opts.format === "markdown") console.log(md);
  else console.log(text(res));
  const newErrors = res.rules.reduce((n, r) => n + (r.rule.severity === "error" ? r.violations.filter((v) => v.isNew).length : 0), 0);
  return res.broken.length || newErrors ? 1 : 0;
}

/** Doc items and saved answers whose evidence points at files this change edits: worth a re-read in review. */
async function citing(root: string, files: Set<string>): Promise<CiResult["touched"]> {
  const out: CiResult["touched"] = [];
  const store = await readStore(root);
  for (const [doc, state] of Object.entries(store.docs)) {
    for (const [section, { items }] of Object.entries(state?.sections ?? {})) {
      for (const it of items) {
        const hit = [...new Set(it.evidence.map((e) => e.path).filter((p) => files.has(p)))];
        if (hit.length) out.push({ title: it.title, where: `${doc} › ${section}`, files: hit });
      }
    }
  }
  for (const a of (await readAnswers(root)).answers) {
    const hit = [...new Set(a.evidence.map((e) => e.path).filter((p) => files.has(p)))];
    if (hit.length) out.push({ title: a.question, where: "saved answer", files: hit });
  }
  return out;
}

const plain = (s: string) => s.replace(/`/g, "");

function markdown(r: CiResult, base?: string): string {
  const newV = r.rules.flatMap((x) => x.violations.filter((v) => v.isNew).map((v) => ({ rule: x.rule, v })));
  const lines = ["<!-- houserules -->", "### houserules"];
  const scope = r.changed ? `${r.changed.length} changed file${r.changed.length === 1 ? "" : "s"}${base ? ` against \`${base}\`` : ""}` : "every file";
  const ok = !r.broken.length && !r.drifted.length && !newV.length;
  lines.push(ok ? `All clear: ${r.total} docs and answers still match the code, and ${scope} follow the house rules.` : `Checked ${r.total} docs and answers, and the house rules on ${scope}.`);
  if (newV.length) {
    lines.push("", `**House rules this change breaks (${newV.length})**`, "");
    for (const { rule, v } of newV.slice(0, 30)) lines.push(`- ${rule.severity === "error" ? "❌" : "⚠️"} \`${v.path}:${v.line}\` ${plain(rule.title)}${rule.fix ? ` — ${plain(rule.fix)}` : ""}`);
  }
  if (r.broken.length) {
    lines.push("", `**Docs that are now wrong (${r.broken.length})**: the code they cite is gone.`, "");
    for (const b of r.broken.slice(0, 20)) lines.push(`- ${plain(b.title)} (${b.doc} › ${b.section}): ${b.problems.join("; ")}`);
  }
  if (r.drifted.length) {
    lines.push("", `**Docs whose code changed (${r.drifted.length})**: still pass, but re-read them.`, "");
    for (const c of r.drifted.slice(0, 20)) lines.push(`- ${plain(c.title)} (${c.doc} › ${c.section})`);
  }
  if (r.touched.length) {
    lines.push("", `<details><summary>${r.touched.length} doc item${r.touched.length === 1 ? "" : "s"} cite files this change edits</summary>`, "");
    for (const t of r.touched.slice(0, 40)) lines.push(`- ${plain(t.title)} (${t.where}): ${t.files.map((f) => `\`${f}\``).join(", ")}`);
    lines.push("", "</details>");
  }
  if (r.broken.length || r.drifted.length) lines.push("", `Refresh them with \`${HR} generate\`, or edit \`.houserules/docs.json\` and re-run \`${HR} render\`.`);
  return lines.join("\n") + "\n";
}

// GitHub turns these into notes on the PR diff, on the exact line.
function annotations(r: CiResult): string[] {
  const esc = (s: string) => s.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
  const out: string[] = [];
  for (const x of r.rules) for (const v of x.violations.filter((y) => y.isNew)) out.push(`::${x.rule.severity === "error" ? "error" : "warning"} file=${v.path},line=${v.line},title=${esc(`House rule: ${plain(x.rule.title)}`)}::${esc(`${x.rule.why ? `${plain(x.rule.why)} ` : ""}${x.rule.fix ? `Fix: ${plain(x.rule.fix)}` : ""}`.trim() || plain(x.rule.title))}`);
  for (const b of r.broken) out.push(`::error title=${esc(`Doc out of date: ${plain(b.title)}`)}::${esc(b.problems.join("; "))}`);
  for (const c of r.drifted) out.push(`::warning title=${esc(`Doc may be stale: ${plain(c.title)}`)}::${esc(c.problems.join("; "))}`);
  return out;
}

function text(r: CiResult): string {
  const newV = r.rules.flatMap((x) => x.violations.filter((v) => v.isNew).map((v) => ({ rule: x.rule, v })));
  const out = [`Docs and answers: ${r.total} checked, ${r.broken.length} broken, ${r.drifted.length} with changed code.`, `House rules: ${r.rules.length} rule(s) on ${r.changed ? `${r.changed.length} changed file(s)` : "all files"}, ${newV.length} new violation(s).`];
  for (const { rule, v } of newV) out.push(`  ${rule.severity === "error" ? "✗" : "!"} ${v.path}:${v.line}  ${plain(rule.title)}${rule.fix ? `\n      fix: ${plain(rule.fix)}` : ""}`);
  for (const b of r.broken) out.push(`  ✗ doc out of date: ${plain(b.title)} — ${b.problems.join("; ")}`);
  for (const c of r.drifted) out.push(`  ~ doc's code changed: ${plain(c.title)}`);
  if (r.touched.length) out.push(`  ${r.touched.length} doc item(s) cite files this change edits; worth a re-read.`);
  return out.join("\n");
}

const WORKFLOW = `# Written by houserules ci-setup. Checks every pull request: are the docs, AGENTS.md and saved
# answers still true, and does the change follow the house rules? Comments once and keeps that comment updated.
name: houserules
on: pull_request
permissions:
  contents: read
  pull-requests: write
jobs:
  houserules:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - name: Check docs and house rules
        run: npx -y houserules@${VERSION} ci --base origin/\${{ github.base_ref }} --format github --report houserules-report.md
      - name: Comment on the pull request
        if: always() && hashFiles('houserules-report.md') != ''
        uses: actions/github-script@v7
        with:
          script: |
            const body = require("fs").readFileSync("houserules-report.md", "utf8");
            const { owner, repo } = context.repo;
            const issue_number = context.issue.number;
            const { data } = await github.rest.issues.listComments({ owner, repo, issue_number, per_page: 100 });
            const mine = data.find((c) => c.body && c.body.includes("<!-- houserules -->"));
            if (mine) await github.rest.issues.updateComment({ owner, repo, comment_id: mine.id, body });
            else await github.rest.issues.createComment({ owner, repo, issue_number, body });
`;

const HR = (process.argv[1] ?? "").split(/[\\/]/).includes("_npx") ? "npx houserules" : "houserules";

/** Writes .github/workflows/houserules.yml, after asking (or with --yes). */
export async function runCiSetup(target: string, opts: { yes: boolean; dryRun: boolean }): Promise<number> {
  const root = path.resolve(target);
  const file = path.join(root, ".github", "workflows", "houserules.yml");
  const exists = await access(file).then(() => true, () => false);
  console.log(`${exists ? "Would replace" : "Would write"} ${path.relative(process.cwd(), file) || file}:\n\n${WORKFLOW}`);
  // The workflow installs houserules from npm; say so now rather than let the first pull request fail.
  const published = await fetch(`https://registry.npmjs.org/houserules/${VERSION}`, { signal: AbortSignal.timeout(5000) }).then((r) => r.ok, () => undefined);
  if (published === false) console.log(`Note: houserules ${VERSION} isn't on npm yet, and this workflow installs it from there. The job will fail until it's published.\n`);
  if (opts.dryRun) return 0;
  if (!opts.yes) {
    if (!process.stdin.isTTY) {
      console.error("Not running in a terminal, so I can't ask. Re-run with --yes to write it, or --dry-run to preview.");
      return 1;
    }
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const ok = /^y(es)?$/i.test((await rl.question(`${exists ? "Replace" : "Write"} it? [y/N] `)).trim());
    rl.close();
    if (!ok) return 1;
  }
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, WORKFLOW);
  console.log(`\nWrote ${file}. Commit it, and every pull request gets a houserules check and one comment it keeps up to date.`);
  return 0;
}
