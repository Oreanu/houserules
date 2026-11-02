import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  changedFiles,
  checkRules,
  readAnswers,
  recheckAnswers,
  saveAnswer,
  searchAnswers,
  submitRules,
  areaOf,
  audienceOf,
  readEntryOverrides,
  routeTitle,
  submitEntryOverrides,
  buildCallGraph,
  buildSymbolIndex,
  lessonPlan,
  listRoutes,
  OfficialDocs,
  submitLessons,
  traceRoute,
  TRACKS,
  DOC_SPECS,
  DOCS_DIR,
  docStatus,
  ITEM_LIMITS,
  readAnalysis,
  readStore,
  renderDocs,
  scan,
  submitSection,
  summarize,
  VERSION,
  writeAnalysis,
  type Analysis,
  type SymbolIndex,
} from "@houserules/core";
import { z } from "zod";

// Sections an agent can pull one at a time instead of loading the whole analysis.json.
const SECTIONS = ["summary", "languages", "frameworks", "dependencies", "entryPoints", "integrations", "envVars", "tests", "ci", "files"] as const;

export function createServer(defaultRoot = process.cwd()): McpServer {
  const server = new McpServer({ name: "houserules", version: VERSION });
  const cache = new Map<string, Analysis>();

  async function load(root: string | undefined, rescan = false): Promise<Analysis> {
    const dir = path.resolve(defaultRoot, root ?? ".");
    if (!rescan) {
      const hit = cache.get(dir) ?? (await readAnalysis(dir));
      if (hit) {
        cache.set(dir, hit);
        return hit;
      }
    }
    const fresh = await scan(dir);
    await writeAnalysis(dir, fresh);
    cache.set(dir, fresh);
    return fresh;
  }

  const rootArg = z.string().optional().describe("Repository root, relative to the server's working directory. Defaults to it.");

  server.registerTool(
    "scan",
    {
      title: "Scan repository",
      description:
        "Scan the repository (files, languages, frameworks, dependencies, imports, integrations, env vars, tests, CI) and write .houserules/analysis.json. Returns a compact summary. Run this first, and again after large changes.",
      inputSchema: { root: rootArg },
    },
    async ({ root }) => json(summarize(await load(root, true))),
  );

  server.registerTool(
    "get_analysis",
    {
      title: "Get analysis section",
      description:
        "Return one section of the latest analysis (scans first if none exists). Use 'summary' for an overview. Long lists are paginated with offset/limit.",
      inputSchema: {
        section: z.enum(SECTIONS),
        root: rootArg,
        offset: z.number().int().min(0).default(0),
        limit: z.number().int().min(1).max(500).default(100),
      },
    },
    async ({ section, root, offset, limit }) => {
      const a = await load(root);
      if (section === "summary") return json(summarize(a));
      const value = section === "tests" ? a.tests : a[section];
      if (Array.isArray(value)) return json({ total: value.length, offset, items: value.slice(offset, offset + limit) });
      return json(value);
    },
  );

  server.registerTool(
    "find_importers",
    {
      title: "Find importers",
      description:
        "Find everywhere a file, directory, in-repo package or third-party package is imported. Returns totals, a breakdown by directory, and one page of importers. Use it to find existing usage and conventions before writing new code.",
      inputSchema: {
        target: z.string().describe("Repo-relative file or directory (src/lib/db.ts, packages/prisma), or a package/module name (stripe, @acme/db, django.db)"),
        root: rootArg,
        offset: z.number().int().min(0).default(0),
        limit: z.number().int().min(1).max(200).default(30),
      },
    },
    async ({ target, root, offset, limit }) => {
      const a = await load(root);
      const under = (s: string | null, seps: string[]) => s !== null && (s === target || seps.some((sep) => s.startsWith(target + sep)));
      const hits = a.imports.filter((e) => under(e.resolved, ["/"]) || under(e.external, ["/", "."]) || under(e.specifier, ["/"]));
      const byDir = new Map<string, number>();
      for (const e of hits) {
        const dir = e.from.split("/").slice(0, 2).join("/");
        byDir.set(dir, (byDir.get(dir) ?? 0) + 1);
      }
      return json({
        target,
        total: hits.length,
        files: new Set(hits.map((e) => e.from)).size,
        byDirectory: Object.fromEntries([...byDir].sort((x, y) => y[1] - x[1]).slice(0, 10)),
        offset,
        importers: hits.slice(offset, offset + limit).map((e) => ({ file: e.from, line: e.line, specifier: e.specifier })),
      });
    },
  );

  server.registerTool(
    "list_imports",
    {
      title: "List a file's imports",
      description: "List what one file imports, split into internal files and third-party packages.",
      inputSchema: { file: z.string().describe("Repo-relative file path"), root: rootArg },
    },
    async ({ file, root }) => {
      const a = await load(root);
      const edges = a.imports.filter((e) => e.from === file);
      return json({
        file,
        internal: edges.filter((e) => e.resolved).map((e) => ({ file: e.resolved, line: e.line })),
        external: edges.filter((e) => !e.resolved).map((e) => ({ package: e.external ?? e.specifier, line: e.line })),
      });
    },
  );

  const symbolIndexes = new Map<string, { sha: string; index: SymbolIndex }>();
  async function symbols(root: string | undefined): Promise<SymbolIndex> {
    const dir = path.resolve(defaultRoot, root ?? ".");
    const a = await load(root);
    const key = a.generatedAt;
    const hit = symbolIndexes.get(dir);
    if (hit && hit.sha === key) return hit.index;
    const index = await buildSymbolIndex(dir, a);
    symbolIndexes.set(dir, { sha: key, index });
    return index;
  }

  server.registerTool(
    "get_symbols",
    {
      title: "List a file's symbols",
      description: "Functions, classes, methods, types and top-level constants defined in a file, with line ranges and whether they're exported. Use the lines when citing evidence.",
      inputSchema: { file: z.string().describe("Repo-relative file path"), root: rootArg },
    },
    async ({ file, root }) => {
      const index = await symbols(root);
      const defs = index.byFile.get(file);
      if (!defs) return json({ file, error: "Not a scanned source file (or not a language with symbol support)." });
      return json({ file, symbols: defs });
    },
  );

  server.registerTool(
    "find_symbol",
    {
      title: "Find where a symbol is defined",
      description: "Find definitions of a function, class, method or type by name across the repo. Use it to check something exists before claiming it, and to find what to reuse.",
      inputSchema: { name: z.string(), root: rootArg },
    },
    async ({ name, root }) => {
      const hits = (await symbols(root)).find(name);
      return json({ name, count: hits.length, definitions: hits.slice(0, 50).map((h) => ({ file: h.file, ...h.symbol })) });
    },
  );

  server.registerTool(
    "get_doc_spec",
    {
      title: "Get the docs to write",
      description:
        "The documents houserules generates, their sections, what belongs in each, item limits, and the current fill status. Read this before submitting sections.",
      inputSchema: { root: rootArg },
    },
    async ({ root }) => {
      const store = await readStore(path.resolve(defaultRoot, root ?? "."));
      const status = docStatus(store);
      return json({
        itemShape: {
          title: `string, ≤${ITEM_LIMITS.title} chars; for patterns, the rule as an instruction`,
          body: `markdown, ≤${ITEM_LIMITS.body} chars; any \`path/like/this.ts\` you mention must exist`,
          evidence: `1–${ITEM_LIMITS.evidence} of { path, line?, endLine?, symbol?, note? }; symbol must appear in the file (near line if given)`,
          confidence: "observed (you read it in the code) | inferred (you concluded it) | needs-human (only a maintainer can say; evidence optional)",
        },
        docs: DOC_SPECS.map((d) => ({
          id: d.id,
          title: d.title,
          purpose: d.purpose,
          sections: d.sections.map((s) => ({ ...s, filled: status.find((x) => x.doc === d.id)?.sections.find((x) => x.id === s.id)?.items ?? 0 })),
        })),
      });
    },
  );

  const evidenceSchema = z.object({
    path: z.string().describe("Repo-relative file or directory"),
    line: z.number().int().min(1).optional(),
    endLine: z.number().int().min(1).optional(),
    symbol: z.string().optional().describe("Function/class/method name that appears at that location; Class.method is fine"),
    note: z.string().max(120).optional().describe("Short label, e.g. 'call site' or 'step 2'"),
  });
  const itemSchema = z.object({
    title: z.string(),
    body: z.string().default(""),
    evidence: z.array(evidenceSchema).default([]),
    confidence: z.enum(["observed", "inferred", "needs-human"]),
  });

  server.registerTool(
    "submit_section",
    {
      title: "Submit a doc section",
      description:
        "Submit all items for one section. Every item is checked against the code (paths, lines, symbols, paths mentioned in the body). Passing items are stored; rejected ones come back with reasons: fix and resubmit the whole section. A submit replaces the section.",
      inputSchema: { doc: z.string(), section: z.string(), items: z.array(itemSchema), root: rootArg },
    },
    async ({ doc, section, items, root }) => {
      const dir = path.resolve(defaultRoot, root ?? ".");
      return json(await submitSection(dir, await load(root), doc, section, items));
    },
  );

  server.registerTool(
    "list_entry_points",
    {
      title: "List entry points",
      description:
        "Every way into the app: pages, API endpoints, server actions, webhooks, jobs and middleware, with the file, handler and middleware for each, plus the area it belongs to, who calls it (audience), its current plain-English title, and `steps`: how many functions houserules could trace from it. steps 0 means houserules couldn't follow the handler; find the real one and give it to describe_entry_points.",
      inputSchema: { root: rootArg },
    },
    async ({ root }) => {
      const dir = path.resolve(defaultRoot, root ?? ".");
      const analysis = await load(root);
      const routes = await listRoutes(dir, analysis);
      const o = await readEntryOverrides(dir);
      const symbols = await buildSymbolIndex(dir, analysis);
      const graph = await buildCallGraph(dir, analysis, symbols);
      // Steps below the handler itself: what a reader would actually see.
      const depth = (r: (typeof routes)[number]) => Math.max(0, traceRoute(graph, symbols, r).steps.length - 1);
      return json(routes.map((r) => ({ ...r, area: areaOf(r), audience: audienceOf(r), title: o.titles?.[r.id] ?? routeTitle(r), steps: depth(r) })));
    },
  );

  server.registerTool(
    "describe_entry_points",
    {
      title: "Describe entry points",
      description:
        "Names for the Entry points page: a friendly title and one-line blurb per area (area ids from list_entry_points), their order along the customer journey (1 = where a new user starts), and better titles for entry points whose generated title reads badly. Also `handlers`: for an entry point list_entry_points shows with steps 0, the function that really handles it, found by reading the route (`file` relative to the repo root, `symbol` as a function name or Class.method). houserules checks it exists and traces from it. Names, order and handlers only; what each one does always comes from the code. Merges with earlier calls.",
      inputSchema: {
        areas: z.array(z.object({ id: z.string(), title: z.string().optional(), blurb: z.string().optional(), order: z.number().int().optional() })).optional(),
        titles: z.array(z.object({ id: z.string(), title: z.string() })).optional(),
        handlers: z.array(z.object({ id: z.string(), file: z.string(), symbol: z.string() })).optional(),
        root: rootArg,
      },
    },
    async ({ areas, titles, handlers, root }) => {
      const dir = path.resolve(defaultRoot, root ?? ".");
      const analysis = await load(root);
      return json(await submitEntryOverrides(dir, await listRoutes(dir, analysis), { ...(areas ? { areas } : {}), ...(titles ? { titles } : {}), ...(handlers ? { handlers } : {}) }, await buildSymbolIndex(dir, analysis)));
    },
  );

  server.registerTool(
    "trace_entry_point",
    {
      title: "Trace an entry point",
      description:
        "What runs when an entry point is hit: the functions it calls, in order, resolved through imports (depth-first, up to 6 levels). Framework APIs and outside services appear as external steps. Steps linked only by name have via=\"name\".",
      inputSchema: { path: z.string().describe("The entry point's path as list_entry_points gives it, e.g. /product/:handle or addItem"), root: rootArg },
    },
    async ({ path: p, root }) => {
      const dir = path.resolve(defaultRoot, root ?? ".");
      const analysis = await load(root);
      const routes = await listRoutes(dir, analysis);
      const route = routes.find((r) => r.path === p) ?? routes.find((r) => r.handler === p);
      if (!route) return json({ error: `No entry point "${p}". Known: ${routes.map((r) => r.path).join(", ")}` });
      const symbols = await buildSymbolIndex(dir, analysis);
      return json(traceRoute(await buildCallGraph(dir, analysis, symbols), symbols, route));
    },
  );

  const docsCache = new Map<string, OfficialDocs>();
  const officialFor = (dir: string) => {
    let d = docsCache.get(dir);
    if (!d) docsCache.set(dir, (d = new OfficialDocs(dir)));
    return d;
  };

  server.registerTool(
    "official_docs",
    {
      title: "Read the official docs",
      description:
        "The latest official documentation for the repo's stack (Next.js, React, Django), fetched and cached by houserules. Give `api` as trace steps name it (\"next/cache · revalidateTag\", \"react · useOptimistic\", \"django.shortcuts · render\") to find its page, or `url` to read a page. `find` keeps only paragraphs mentioning a term. Quote lessons from this text, copied exactly: submit_lessons checks every quote against the page.",
      inputSchema: {
        api: z.string().optional(),
        url: z.string().optional(),
        find: z.string().optional(),
        root: rootArg,
      },
    },
    async ({ api, url, find, root }) => {
      const docs = officialFor(path.resolve(defaultRoot, root ?? "."));
      const page = api ? await docs.lookupApi(api) : null;
      const target = page?.url ?? url;
      if (!target) return json({ error: api ? `No official page found for "${api}".` : "Give api or url." });
      let text = (await docs.pageText(target)) ?? "";
      if (!text) return json({ error: `Couldn't fetch ${target}.`, ...(page ? { page } : {}) });
      if (find) {
        const term = find.toLowerCase();
        text = text.split(/\n\s*\n/).filter((p) => p.toLowerCase().includes(term)).join("\n\n");
      }
      const MAX = 9000;
      return json({ url: target, ...(page ? { title: page.title, version: page.version, renamedFrom: page.renamedFrom } : {}), truncated: text.length > MAX, text: text.slice(0, MAX) });
    },
  );

  server.registerTool(
    "get_lesson_plan",
    {
      title: "Get the lesson plan",
      description:
        "What to teach, worked out from the code: installed vs latest versions of the stack, the entry points, and the framework APIs they touch (most used first) with each one's latest official docs page. Use it to choose and order lessons.",
      inputSchema: { root: rootArg },
    },
    async ({ root }) => {
      const dir = path.resolve(defaultRoot, root ?? ".");
      return json(await lessonPlan(dir, await load(root), officialFor(dir)));
    },
  );

  const lessonSchema = z.object({
    title: z.string(),
    concept: z.string().describe("The idea in one plain sentence, no jargon a newcomer wouldn't know"),
    why: z.string().describe("Why it matters in this repo"),
    body: z.string().describe("The explanation, Markdown. Short: link out instead of repeating the docs"),
    docs: z.array(z.object({ url: z.string(), quote: z.string().describe("One sentence copied exactly from the page") })).min(1),
    code: z.array(evidenceSchema).min(1),
    drift: z.string().optional().describe("Where this repo differs from the latest docs (renamed/unstable APIs, older patterns)"),
    exercises: z
      .array(
        z.discriminatedUnion("kind", [
          z.object({
            kind: z.literal("predict"),
            question: z.string().describe("A 'what happens if…' question about real behaviour, answered before the explanation"),
            options: z.array(z.string()).min(2).max(4),
            answer: z.number().int().describe("Index of the right option"),
            explain: z.string().describe("Why, in two or three sentences"),
            evidence: z.array(evidenceSchema).min(1).describe("The code that proves the answer"),
          }),
          z.object({
            kind: z.literal("change"),
            task: z.string().describe("A small real change, as a ticket would say it"),
            files: z.array(z.string()).min(1).describe("Files the learner should edit"),
            checks: z
              .array(z.object({ file: z.string(), pattern: z.string().describe("JS regex source, multiline"), must: z.enum(["match", "not-match"]), describe: z.string() }))
              .min(1)
              .describe("At least one must fail on today's code"),
            hint: z.string().optional(),
            solution: z.string().optional().describe("Markdown, shown on request"),
          }),
        ]),
      )
      .min(1)
      .max(3),
    terms: z.array(z.object({ term: z.string(), definition: z.string(), url: z.string().optional() })).optional(),
    entryPoint: z.string().optional(),
  });

  server.registerTool(
    "submit_lessons",
    {
      title: "Submit a track of lessons",
      description: `Submit every lesson for one track (${TRACKS.map((t) => `${t.id}: ${t.blurb}`).join(" ")}). Docs quotes are checked against the fetched official page; code and exercise answers are checked like doc evidence. Rejected lessons come back with reasons: fix and resubmit the whole track.`,
      inputSchema: { track: z.enum(TRACKS.map((t) => t.id) as [string, ...string[]]), lessons: z.array(lessonSchema), root: rootArg },
    },
    async ({ track, lessons, root }) => {
      const dir = path.resolve(defaultRoot, root ?? ".");
      return json(await submitLessons(dir, await load(root), track, lessons, officialFor(dir)));
    },
  );

  server.registerTool(
    "render_docs",
    {
      title: "Render the docs",
      description: `Write ${DOCS_DIR}/ (ARCHITECTURE.md, GUIDELINES.md, README.md) plus the houserules block in AGENTS.md and CLAUDE.md, from the stored, evidence-checked sections. Text outside the houserules block in AGENTS.md/CLAUDE.md is preserved.`,
      inputSchema: { root: rootArg },
    },
    async ({ root }) => {
      const dir = path.resolve(defaultRoot, root ?? ".");
      return json(await renderDocs(dir, await readStore(dir)));
    },
  );

  // ---------- team memory: saved answers ----------

  server.registerTool(
    "search_answers",
    {
      title: "Search saved answers",
      description:
        "Answers your team (or earlier agent sessions) already worked out and saved, each re-checked against the code on every run. Search here before exploring the code for a 'how does X work' question; an answer with status 'ok' still matches the code.",
      inputSchema: { query: z.string().describe("The question, in plain words"), root: rootArg },
    },
    async ({ query, root }) => {
      const dir = path.resolve(defaultRoot, root ?? ".");
      const store = await readAnswers(dir);
      const hits = searchAnswers(store, query);
      const report = hits.length ? await recheckAnswers(dir, await load(root)) : { broken: [], changed: [] };
      const status = (id: string) => (report.broken.some((r) => r.id === id) ? "broken: its evidence no longer exists" : report.changed.some((r) => r.id === id) ? "changed: the cited code was edited since; re-read before trusting" : "ok");
      return json({ total: store.answers.length, answers: hits.map((a) => ({ id: a.id, question: a.question, answer: a.body, evidence: a.evidence.map(({ path: p, line, endLine, symbol }) => ({ path: p, line, endLine, symbol })), savedAt: a.updatedAt ?? a.savedAt, status: status(a.id) })) });
    },
  );

  server.registerTool(
    "save_answer",
    {
      title: "Save an answer for the team",
      description:
        "Keep an explanation you gave so the whole team and future agent sessions can reuse it. Use it when the user asks you to save it, or offer it after you've explained how something works with file:line evidence. Every citation is checked (files, lines, symbols must exist) and re-checked on every run. The same question again replaces the old answer. Keep the answer short and specific; put the proof in evidence.",
      inputSchema: {
        question: z.string().describe("The question as a teammate would ask it"),
        answer: z.string().describe("The explanation, in markdown, under 2000 characters"),
        evidence: z.array(evidenceSchema).min(1).describe("The code the answer rests on"),
        confidence: z.enum(["observed", "inferred"]).optional().describe("observed: read directly in the code; inferred: a conclusion drawn from it"),
        askedIn: z.string().optional().describe("Where this came from, e.g. claude or codex"),
        root: rootArg,
      },
    },
    async ({ question, answer, evidence, confidence, askedIn, root }) => {
      const dir = path.resolve(defaultRoot, root ?? ".");
      return json(await saveAnswer(dir, await load(root), { question, answer, evidence, ...(confidence ? { confidence } : {}), ...(askedIn ? { askedIn } : {}) }));
    },
  );

  // ---------- house rules as checks ----------

  const ruleSchema = z.object({
    title: z.string().describe("The rule as a sentence a reviewer would say"),
    why: z.string().optional().describe("What goes wrong otherwise, in one line"),
    guideline: z.string().optional().describe("The doc item it enforces, e.g. guidelines/patterns/<item id>"),
    files: z.array(z.string()).min(1).describe("Globs it applies to, e.g. Modules/**/app/**/*.php"),
    except: z.array(z.string()).optional().describe("Globs it doesn't apply to, e.g. app/Models/**, **/tests/**"),
    forbid: z.string().optional().describe("Regex no line may match"),
    require: z.string().optional().describe("Regex every matching file must contain"),
    fix: z.string().optional().describe("How to do it the house way instead"),
    severity: z.enum(["error", "warning"]).optional(),
  });

  server.registerTool(
    "submit_rules",
    {
      title: "Turn guidelines into checks",
      description:
        "Make house rules checkable: for each guideline that a pattern can catch, say which files it covers and what must not (forbid) or must (require) appear. A rule is only accepted if it describes today's code: places that already break it are recorded as a baseline, so checks flag only new violations. Merges with earlier rules by title. Skip guidelines a regex can't express honestly.",
      inputSchema: { rules: z.array(ruleSchema).min(1), root: rootArg },
    },
    async ({ rules, root }) => {
      const dir = path.resolve(defaultRoot, root ?? ".");
      return json(await submitRules(dir, await load(root, true), rules));
    },
  );

  server.registerTool(
    "check_rules",
    {
      title: "Check house rules",
      description:
        "Run the house rules over files: by default the files you changed (uncommitted changes in git), or a list you pass. Run it before you finish a change; fix new violations or explain why the rule doesn't apply.",
      inputSchema: { files: z.array(z.string()).optional().describe("Repo-relative files; default: uncommitted changes"), root: rootArg },
    },
    async ({ files, root }) => {
      const dir = path.resolve(defaultRoot, root ?? ".");
      const scope = files ?? (await changedFiles(dir)) ?? undefined;
      const results = await checkRules(dir, await load(root, true), scope ? { files: scope } : {});
      return json({
        checked: scope ? `${scope.length} changed file(s)` : "all files",
        rules: results.length,
        new: results.flatMap((r) => r.violations.filter((v) => v.isNew).map((v) => ({ rule: r.rule.title, severity: r.rule.severity, fix: r.rule.fix, at: `${v.path}:${v.line}`, line: v.text }))),
        known: results.reduce((n, r) => n + r.violations.filter((v) => !v.isNew).length, 0),
      });
    },
  );

  return server;
}

export async function startStdioServer(root?: string): Promise<void> {
  const server = createServer(root);
  await server.connect(new StdioServerTransport());
}

// Compact JSON: agents read it fine, and it costs far fewer tokens than pretty-printed output.
function json(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value) }] };
}
