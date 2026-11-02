import { readFile, stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import path from "node:path";
import { architectureMap, buildCallGraph, checkRules, readAnswers, recheckAnswers, buildEntryMap, readEntryOverrides, readLessons, recheckLessons, OfficialDocs, stackDocs, buildSymbolIndex, dataModel, DOC_SPECS, listRoutes, traceRoute, docStatus, normalize, readStore, recheckStore, scan, summarize, timeline, writeAnalysis, type StaleReport } from "@houserules/core";
import { agentsPage, answersPage, diagramsPage, dirPage, docPage, learnPage, lessonPage, messagePage, overview, page, pathPage, PATHS, sourcePage, startPage, stateSig, tracePage, type State } from "./views.js";
import { allLessons, checkExercise } from "@houserules/core";

// A local, read-only viewer for what houserules generated: docs with live verification status,
// evidence that opens the exact source lines in a side panel, and the scan dashboard.

const MAX_SOURCE_BYTES = 2_000_000;
const SNIPPET_CONTEXT = 80; // lines either side of the cited range sent to the side panel

export async function runPreview(target: string, opts: { port: number; host: string }): Promise<number> {
  const { url } = await startPreview(target, opts);
  console.log(`houserules preview for ${path.basename(path.resolve(target))} → ${url}`);
  console.log("Read-only. Refresh the page after changing code or re-running houserules. Ctrl+C to stop.");
  return -1; // keep running
}

export async function startPreview(target: string, opts: { port: number; host: string }): Promise<{ url: string; close: () => Promise<void> }> {
  const root = path.resolve(target);
  let state: State | null = null;
  let loading: Promise<State> | null = null;
  const official = new OfficialDocs(root);

  // Re-scan and re-verify at most every few seconds, so editing code and refreshing shows the effect.
  async function getState(force = false): Promise<State> {
    if (state && !force && Date.now() - state.loadedAt < 3000) return state;
    loading ??= (async () => {
      const analysis = await scan(root);
      await writeAnalysis(root, analysis);
      const store = await readStore(root);
      // Lessons are re-checked like doc items (code and exercise answers), plus their quotes against the cached official pages.
      // Saved answers too: anything houserules shows is re-checked the same way.
      const [docReport, lessonReport, answerReport] = await Promise.all([recheckStore(root, analysis), recheckLessons(root, analysis, official), recheckAnswers(root, analysis)]);
      const report = { broken: [...docReport.broken, ...lessonReport.broken, ...answerReport.broken], changed: [...docReport.changed, ...lessonReport.changed, ...answerReport.changed], total: docReport.total + lessonReport.total + answerReport.total };
      // Diagrams are recomputed from the code on every check, so they can't go stale.
      const map = architectureMap(analysis);
      const [model, history, symbols, routes] = await Promise.all([dataModel(root, analysis), timeline(root, map), buildSymbolIndex(root, analysis), listRoutes(root, analysis)]);
      const graph = await buildCallGraph(root, analysis, symbols);
      const traces = new Map(routes.map((r) => [r.id, traceRoute(graph, symbols, r)]));
      const key = (r: StaleReport) => `${r.doc}/${r.section}/${r.id}`;
      return {
        root,
        analysis,
        store,
        broken: new Map(report.broken.map((r) => [key(r), r])),
        changed: new Map(report.changed.map((r) => [key(r), r])),
        total: report.total,
        diagrams: { map, model, history, routes, traces, entry: buildEntryMap(routes, traces, analysis, await readEntryOverrides(root)) },
        lessons: await readLessons(root),
        answers: await readAnswers(root),
        rules: await checkRules(root, analysis),
        loadedAt: Date.now(),
      };
    })().finally(() => (loading = null));
    state = await loading;
    return state;
  }

  const handler = async (req: IncomingMessage, res: ServerResponse) => {
    try {
      await route(req, res, getState, () => state, official);
    } catch (err) {
      send(res, 500, page(state, { title: "Error", active: "", crumbs: ["Error"], content: messagePage("Something went wrong", `<code>${String(err instanceof Error ? err.message : err).replace(/</g, "&lt;")}</code>`) }));
    }
  };
  await getState(true);

  // "localhost" may resolve to 127.0.0.1 or ::1 depending on the client, so listen on both loopbacks.
  const hosts = opts.host === "localhost" ? ["127.0.0.1", "::1"] : [opts.host];
  const servers: Server[] = [];
  for (const [i, host] of hosts.entries()) {
    const server = createServer(handler);
    try {
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(opts.port, host, resolve);
      });
      servers.push(server);
    } catch (err) {
      if (i === 0) throw err; // the IPv6 loopback is optional
    }
  }
  return {
    url: `http://${opts.host === "0.0.0.0" || opts.host === "localhost" ? "localhost" : opts.host}:${opts.port}`,
    close: () => Promise.all(servers.map((srv) => new Promise<void>((resolve) => srv.close(() => resolve())))).then(() => undefined),
  };
}

async function route(req: IncomingMessage, res: ServerResponse, getState: (force?: boolean) => Promise<State>, current: () => State | null, official: OfficialDocs): Promise<void> {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (req.method === "POST" && url.pathname === "/api/recheck") return recheck(res, getState, current());
  if (req.method !== "GET") return send(res, 405, "Method not allowed", "text/plain");
  const s = await getState(url.searchParams.has("refresh"));
  const repo = s.analysis.root;

  if (url.pathname === "/") return send(res, 200, page(s, { title: `houserules · ${repo}`, active: "start", crumbs: [repo, "Start here"], content: startPage(s) }));
  if (url.pathname === "/diagrams") return send(res, 200, page(s, { title: `Diagrams · ${repo}`, active: "diagrams", crumbs: [repo, "Diagrams"], content: diagramsPage(s) }));
  // Official docs are looked up on demand by the page, so a slow or missing network never blocks it.
  if (url.pathname === "/api/docs") {
    const apis = url.searchParams.getAll("api").slice(0, 60);
    const pages = await Promise.all(apis.map((a) => official.lookupApi(a).catch(() => null)));
    const stack = (await stackDocs(official, s.analysis).catch(() => [])).map((d) => ({ name: d.source.name, installed: d.installed, latest: d.latest }));
    return send(res, 200, JSON.stringify({ pages: Object.fromEntries(apis.map((a, i) => [a, pages[i]])), stack }), "application/json");
  }
  // Change tasks: read the learner's working copy and run the task's checks. Never writes.
  if (url.pathname === "/api/exercise") {
    const lesson = allLessons(s.lessons).find((l) => l.id === url.searchParams.get("lesson"));
    const result = lesson ? await checkExercise(s.root, lesson, Number(url.searchParams.get("i"))) : null;
    return send(res, result ? 200 : 404, JSON.stringify(result ?? { error: "no such change task" }), "application/json");
  }
  if (url.pathname === "/learn") return send(res, 200, page(s, { title: `Learn · ${repo}`, active: "learn", crumbs: [repo, "Learn"], content: learnPage(s) }));
  if (url.pathname.startsWith("/learn/")) {
    const lesson = allLessons(s.lessons).find((l) => l.id === decodeURIComponent(url.pathname.slice(7)));
    if (!lesson) return send(res, 404, page(s, { title: "Not found", active: "learn", crumbs: [repo, "Learn"], content: messagePage("Lesson not found", `It may have been rewritten. <a href="/learn">See all lessons</a>.`) }));
    return send(res, 200, page(s, { title: `${lesson.title.replace(/`/g, "")} · ${repo}`, active: "learn", crumbs: [repo, "Learn", lesson.title.replace(/`/g, "")], content: lessonPage(s, lesson) }));
  }
  if (url.pathname === "/trace") {
    const r = s.diagrams.routes.find((x) => x.id === url.searchParams.get("id"));
    if (!r) return send(res, 404, page(s, { title: "Not found", active: "diagrams", crumbs: [repo, "Diagrams"], content: messagePage("Entry point not found", `It may have been renamed. <a href="/diagrams#entry">See all entry points</a>.`) }));
    return send(res, 200, page(s, { title: `${r.path} · ${repo}`, active: "diagrams", crumbs: [repo, "Diagrams", r.path], content: tracePage(s, r) }));
  }
  if (url.pathname === "/health") return send(res, 200, page(s, { title: `Repo health · ${repo}`, active: "home", crumbs: [repo, "Repo health"], content: overview(s) }));
  if (url.pathname.startsWith("/path/")) {
    const id = url.pathname.slice(6);
    const content = pathPage(s, id);
    const p = PATHS.find((x) => x.id === id);
    if (!content || !p) return send(res, 404, page(s, { title: "Not found", active: "", crumbs: [repo, "Not found"], content: messagePage("Not found", "There's no such path.") }));
    return send(res, 200, page(s, { title: `${p.title} · ${repo}`, active: "start", crumbs: [repo, "Start here", p.title], content }));
  }
  if (url.pathname.startsWith("/doc/")) {
    const spec = DOC_SPECS.find((d) => d.id === url.pathname.slice(5));
    if (!spec) return send(res, 404, page(s, { title: "Not found", active: "", crumbs: [repo, "Not found"], content: messagePage("Not found", "There's no such document.") }));
    return send(res, 200, page(s, { title: `${spec.title} · ${repo}`, active: spec.id, crumbs: [repo, spec.title], content: docPage(s, spec.id) }));
  }
  if (url.pathname === "/answers") return send(res, 200, page(s, { title: `Answers · ${repo}`, active: "answers", crumbs: [repo, "Answers"], content: answersPage(s) }));
  if (url.pathname === "/agents") return send(res, 200, page(s, { title: `AGENTS.md · ${repo}`, active: "agents", crumbs: [repo, "AGENTS.md"], content: agentsPage(s) }));
  if (url.pathname === "/source") return sourceRoute(res, s, url);
  if (url.pathname === "/api/source") return sourceApi(res, s, url);
  if (url.pathname === "/api/state") {
    return send(res, 200, JSON.stringify({ summary: summarize(s.analysis), status: docStatus(s.store), broken: [...s.broken.values()], changed: [...s.changed.values()] }), "application/json");
  }
  return send(res, 404, page(s, { title: "Not found", active: "", crumbs: [repo, "Not found"], content: messagePage("This page isn't here", "It may have moved when the docs were regenerated.") }));
}

type Loaded = { kind: "dir"; files: string[] } | { kind: "file"; lines: string[] } | { error: string; status: number };

async function load(s: State, raw: string | null): Promise<{ rel: string } & Loaded> {
  const rel = normalize(raw ?? "");
  if (rel === null || rel === "") return { rel: "", error: "That path isn't inside the repo.", status: 400 };
  const abs = path.join(s.root, rel);
  let st;
  try {
    st = await stat(abs);
  } catch {
    return { rel, error: `${rel} doesn't exist.`, status: 404 };
  }
  if (st.isDirectory()) return { rel, kind: "dir", files: s.analysis.files.filter((f) => f.path.startsWith(`${rel}/`)).map((f) => f.path).slice(0, 300) };
  if (st.size > MAX_SOURCE_BYTES) return { rel, error: `${rel} is too large to show.`, status: 413 };
  const lines = (await readFile(abs, "utf8")).split(/\r?\n/);
  if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
  return { rel, kind: "file", lines };
}

async function sourceRoute(res: ServerResponse, s: State, url: URL): Promise<void> {
  const repo = s.analysis.root;
  const f = await load(s, url.searchParams.get("path"));
  const shell = (title: string, content: string, code = 200) => send(res, code, page(s, { title, active: "", crumbs: [repo, "Source", f.rel || "?"], content }));
  if ("error" in f) return shell(f.error, messagePage("Can't show this file", f.error), f.status);
  if (f.kind === "dir") return shell(f.rel, dirPage(f.rel, f.files));
  const from = Number(url.searchParams.get("line")) || 0;
  const to = Number(url.searchParams.get("end")) || from;
  return shell(f.rel, sourcePage(f.rel, f.lines, from, to, s.analysis.imports.filter((e) => e.resolved === f.rel).length));
}

/** Re-scans and re-checks every item now, and reports what changed since the last check. */
async function recheck(res: ServerResponse, getState: (force?: boolean) => Promise<State>, before: State | null): Promise<void> {
  const started = Date.now();
  const s = await getState(true);
  const newlyBroken = [...s.broken.entries()].filter(([k]) => !before?.broken.has(k)).map(([, r]) => r.title.replace(/`/g, ""));
  const fixed = [...(before?.broken.keys() ?? [])].filter((k) => !s.broken.has(k)).length;
  return send(
    res,
    200,
    JSON.stringify({
      total: s.total,
      broken: s.broken.size,
      changed: s.changed.size,
      newlyBroken,
      fixed,
      checkedAt: new Date(s.loadedAt).toISOString(),
      ms: Date.now() - started,
      sig: stateSig(s),
    }),
    "application/json",
  );
}

/** A window of lines around the cited range, for the side panel. */
async function sourceApi(res: ServerResponse, s: State, url: URL): Promise<void> {
  const f = await load(s, url.searchParams.get("path"));
  if ("error" in f) return send(res, f.status, JSON.stringify({ error: f.error }), "application/json");
  if (f.kind === "dir") return send(res, 200, JSON.stringify({ kind: "dir", files: f.files }), "application/json");
  const line = Number(url.searchParams.get("line")) || 0;
  const end = Number(url.searchParams.get("end")) || line;
  const start = line ? Math.max(1, line - SNIPPET_CONTEXT) : 1;
  const stop = line ? Math.min(f.lines.length, end + SNIPPET_CONTEXT) : Math.min(f.lines.length, 600);
  return send(res, 200, JSON.stringify({ kind: "file", path: f.rel, line, end, start, total: f.lines.length, lines: f.lines.slice(start - 1, stop) }), "application/json");
}

function send(res: ServerResponse, code: number, body: string, type = "text/html; charset=utf-8"): void {
  res.writeHead(code, { "content-type": type, "cache-control": "no-store" });
  res.end(body);
}
