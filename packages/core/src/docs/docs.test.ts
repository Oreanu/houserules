import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { scan } from "../scan/index.js";
import { makeTree } from "../test-utils.js";
import { pathLikeTokens } from "./verify.js";
import { readStore, recheckStore, submitSection } from "./store.js";
import { renderDocs } from "./render.js";

const REPO = {
  "package.json": JSON.stringify({ scripts: { dev: "next dev" }, dependencies: { next: "15.0.0" } }),
  "src/lib/db.ts": "import { Pool } from 'pg';\n\nexport function query(sql: string) {\n  return sql;\n}\n",
  "src/app/api/users/route.ts": "import { query } from '@/lib/db';\n\nexport async function GET() {\n  return query('select 1');\n}\n",
  "src/app/api/orders/route.ts": "import { query } from '@/lib/db';\n\nexport async function GET() {\n  return query('select 2');\n}\n",
  "tsconfig.json": JSON.stringify({ compilerOptions: { baseUrl: ".", paths: { "@/*": ["src/*"] } } }),
  "src/lib/long.ts": "// 1\n// 2\n// 3\n// 4\n// 5\n// 6\n// 7\n// 8\nexport function far() {}\n",
};

async function setup() {
  const root = await makeTree(REPO);
  return { root, analysis: await scan(root) };
}

const good = {
  title: "Run SQL through `query` in src/lib/db.ts",
  body: "Route handlers call `query` from `src/lib/db.ts` instead of using `pg` directly.",
  evidence: [
    { path: "src/lib/db.ts", symbol: "query" },
    { path: "src/app/api/users/route.ts", line: 4, symbol: "query", note: "call site" },
    { path: "src/app/api/orders/route.ts", line: 4 },
  ],
  confidence: "observed" as const,
};

test("a well-evidenced item is accepted, verified, and gets its definition line filled in", async () => {
  const { root, analysis } = await setup();
  const res = await submitSection(root, analysis, "guidelines", "patterns", [good]);
  assert.deepEqual(res.rejected, []);
  assert.equal(res.accepted[0]!.confidence, "verified");
  const item = (await readStore(root)).docs.guidelines!.sections.patterns!.items[0]!;
  assert.equal(item.id, "run-sql-through-query-in-src-lib-db-ts");
  assert.deepEqual({ line: item.evidence[0]!.line, endLine: item.evidence[0]!.endLine }, { line: 3, endLine: 5 });
  assert.match(item.evidence[0]!.sha256!, /^[0-9a-f]{64}$/);
});

test("made-up paths, lines, symbols and body paths are rejected with reasons", async () => {
  const { root, analysis } = await setup();
  const res = await submitSection(root, analysis, "architecture", "building-blocks", [
    { ...good, title: "missing file", evidence: [{ path: "src/lib/database.ts" }] },
    { ...good, title: "line out of range", evidence: [{ path: "src/lib/db.ts", line: 99 }] },
    { ...good, title: "symbol not there", evidence: [{ path: "src/lib/db.ts", symbol: "runQuery" }] },
    { ...good, title: "symbol far from line", evidence: [{ path: "src/lib/long.ts", line: 1, symbol: "far" }], body: "" },
    { ...good, title: "bad body path", body: "See `src/lib/cache.ts`.", evidence: [{ path: "src/lib/db.ts" }] },
    { ...good, title: "bad bare file", body: "See `cache_utils.ts`.", evidence: [{ path: "src/lib/db.ts" }] },
    { ...good, title: "natural prose is fine", body: "Each `route.ts` renders `users/list`; shared code sits in `lib/`.", evidence: [{ path: "src/lib/db.ts" }] },
    { ...good, title: "import paths are fine", body: "Import from `src/lib/db` and `src/app/api/users/route`.", evidence: [{ path: "src/lib/db.ts" }] },
    { ...good, title: "missing import path", body: "Import from `src/lib/cache`.", evidence: [{ path: "src/lib/db.ts" }] },
    { ...good, title: "escapes repo", evidence: [{ path: "../secrets.txt" }] },
    { title: "no evidence", body: "", evidence: [], confidence: "observed" },
    { title: "ask a maintainer", body: "Why is there no caching?", evidence: [], confidence: "needs-human" },
  ]);
  const problems = Object.fromEntries(res.rejected.map((r) => [r.title, r.problems.join(" | ")]));
  assert.match(problems["missing file"]!, /no such file/);
  assert.match(problems["line out of range"]!, /line 99 is outside the file \(1–5\)/);
  assert.match(problems["symbol not there"]!, /"runQuery" does not appear/);
  assert.match(problems["symbol far from line"]!, /isn't near line 1; it appears on line 9/);
  assert.match(problems["bad body path"]!, /src\/lib\/cache\.ts`, which doesn't exist/);
  assert.match(problems["bad bare file"]!, /no file with that name anywhere/);
  assert.match(problems["escapes repo"]!, /stay inside the repo/);
  assert.match(problems["no evidence"]!, /need at least one evidence/);
  assert.match(problems["missing import path"]!, /importable module/);
  assert.deepEqual(res.accepted.map((a) => [a.title, a.confidence]), [
    ["natural prose is fine", "verified"],
    ["import paths are fine", "verified"],
    ["ask a maintainer", "needs-human"],
  ]);
});

test("directories are valid evidence for layout items", async () => {
  const { root, analysis } = await setup();
  const res = await submitSection(root, analysis, "architecture", "layout", [
    { title: "src/app holds routes", body: "", evidence: [{ path: "src/app/" }], confidence: "observed" },
    { title: "src/lib holds shared code", body: "", evidence: [{ path: "src/lib", line: 2 }], confidence: "observed" },
  ]);
  assert.equal(res.accepted.length, 1);
  assert.match(res.rejected[0]!.problems[0]!, /is a directory/);
});

test("unknown sections are refused, and section caps apply", async () => {
  const { root, analysis } = await setup();
  await assert.rejects(submitSection(root, analysis, "architecture", "nope", []), /Unknown section/);
  const many = Array.from({ length: 5 }, (_, i) => ({ ...good, title: `Overview ${i}` }));
  const res = await submitSection(root, analysis, "architecture", "overview", many);
  assert.equal(res.accepted.length, 3);
  assert.ok(res.notes.some((n) => n.includes("first 3")));
});

test("render writes docs and a managed AGENTS.md block without touching the user's text", async () => {
  const { root, analysis } = await setup();
  await writeFile(path.join(root, "AGENTS.md"), "# Our agent notes\n\nAlways run lint.\n");
  await submitSection(root, analysis, "architecture", "running", [
    { title: "Start the dev server", body: "`npm run dev`", evidence: [{ path: "package.json", line: 1 }], confidence: "observed" },
  ]);
  await submitSection(root, analysis, "guidelines", "patterns", [good]);
  const res = await renderDocs(root, await readStore(root), new Date("2026-11-01T00:00:00Z"));
  assert.deepEqual(res.written, ["docs/houserules/ARCHITECTURE.md", "docs/houserules/GUIDELINES.md", "docs/houserules/README.md", "AGENTS.md", "CLAUDE.md"]);

  const guide = await readFile(path.join(root, "docs/houserules/GUIDELINES.md"), "utf8");
  assert.match(guide, /### Run SQL through `query` in src\/lib\/db\.ts\n/);
  assert.match(guide, /\[src\/lib\/db\.ts:3 \(query\)\]\(\.\.\/\.\.\/src\/lib\/db\.ts#L3-L5\)/);

  const agents = await readFile(path.join(root, "AGENTS.md"), "utf8");
  assert.ok(agents.startsWith("# Our agent notes\n\nAlways run lint.\n\n<!-- houserules:begin"));
  assert.match(agents, /- \*\*Start the dev server\*\*: `npm run dev`/);
  assert.match(agents, /- Run SQL through `query` in src\/lib\/db\.ts \(e\.g\. `src\/lib\/db\.ts:3`\)/);

  assert.match(await readFile(path.join(root, "docs/houserules/GUIDELINES.md"), "utf8"), /proves the evidence is real, not that the claim is right/);

  // Re-rendering replaces the block in place instead of appending a second one.
  await renderDocs(root, await readStore(root));
  const again = await readFile(path.join(root, "AGENTS.md"), "utf8");
  assert.equal(again.split("houserules:begin").length, 2);
  assert.match(await readFile(path.join(root, "CLAUDE.md"), "utf8"), /@AGENTS\.md/);

  // A later render with nothing new leaves the files alone, even on another day.
  const before = await readFile(path.join(root, "docs/houserules/GUIDELINES.md"), "utf8");
  await renderDocs(root, await readStore(root), new Date("2026-12-25T00:00:00Z"));
  assert.equal(await readFile(path.join(root, "docs/houserules/GUIDELINES.md"), "utf8"), before);

  // A team that takes the import out of its own CLAUDE.md keeps it out.
  await writeFile(path.join(root, "CLAUDE.md"), "# Our Claude notes\n");
  await renderDocs(root, await readStore(root));
  assert.equal(await readFile(path.join(root, "CLAUDE.md"), "utf8"), "# Our Claude notes\n");
});

test("recheck reports broken evidence and changed files after the code moves", async () => {
  const { root, analysis } = await setup();
  await submitSection(root, analysis, "guidelines", "patterns", [good]);
  assert.deepEqual(await recheckStore(root, analysis), { broken: [], changed: [], total: 1 });

  await writeFile(path.join(root, "src/app/api/orders/route.ts"), "export async function GET() {\n  return 1;\n}\n");
  await writeFile(path.join(root, "src/lib/db.ts"), "// moved\nimport { Pool } from 'pg';\n\nexport function query(sql: string) {\n  return sql;\n}\n");
  const report = await recheckStore(root, await scan(root));
  assert.equal(report.broken.length, 1);
  assert.match(report.broken[0]!.problems.join(), /line 4 is outside the file|isn't near line/);
});

test("pathLikeTokens picks repo paths and skips commands, URLs, packages and globs", () => {
  const body = "Use `src/lib/db.ts` and `manage.py`, not `npm run dev`, `https://x.dev/a`, `@acme/db`, `src/**/*.ts`, `query()` or `/etc/hosts`.";
  assert.deepEqual(pathLikeTokens(body), ["src/lib/db.ts", "manage.py"]);
});

test("AGENTS.md labels tradeoffs the same way the guidelines do", async () => {
  const { root, analysis } = await setup();
  await submitSection(root, analysis, "guidelines", "tradeoffs", [
    { title: "No retries on db calls", body: "", evidence: [{ path: "src/lib/db.ts", line: 3 }], confidence: "inferred" },
    { title: "Is the missing cache deliberate?", body: "", evidence: [], confidence: "needs-human" },
  ]);
  await renderDocs(root, await readStore(root));
  const agents = await readFile(path.join(root, "AGENTS.md"), "utf8");
  assert.match(agents, /- No retries on db calls \*\(inferred\)\*/);
  assert.match(agents, /- Is the missing cache deliberate\? \*\(ask a maintainer\)\*/);
  assert.doesNotMatch(agents, /unconfirmed/);
});

test("'code changed' fires only when the cited lines change, not on edits elsewhere in the file", async () => {
  const { root, analysis } = await setup();
  await submitSection(root, analysis, "guidelines", "patterns", [good]);
  const item = (await readStore(root)).docs.guidelines!.sections.patterns!.items[0]!;
  assert.match(item.evidence[1]!.snippetHash!, /^[0-9a-f]{16}$/);

  // Edit a line that isn't cited: nothing to report.
  await writeFile(path.join(root, "src/app/api/users/route.ts"), "import { query } from '@/lib/db';\n\nexport async function GET() {\n  return query('select 1');\n}\n// trailing note\n");
  assert.deepEqual((await recheckStore(root, await scan(root))).changed, []);
  // Insert a line above the citation: the cited line just moved down one, which isn't a change.
  await writeFile(path.join(root, "src/app/api/users/route.ts"), "import { query } from '@/lib/db';\n// new comment\n\nexport async function GET() {\n  return query('select 1');\n}\n// trailing note\n");
  assert.deepEqual((await recheckStore(root, await scan(root))).changed, []);

  // Edit the cited line itself (still mentions `query`, so the evidence holds): reported as changed.
  await writeFile(path.join(root, "src/app/api/users/route.ts"), "import { query } from '@/lib/db';\n\nexport async function GET() {\n  return query('select 1 limit 10');\n}\n// trailing note\n");
  const report = await recheckStore(root, await scan(root));
  assert.deepEqual(report.broken, []);
  assert.deepEqual(report.changed[0]?.problems, ["line 4 of src/app/api/users/route.ts changed since this was written"]);
});
