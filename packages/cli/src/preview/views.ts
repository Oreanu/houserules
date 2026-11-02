import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import {
  DOC_SPECS,
  docStatus,
  normalize,
  pathLikeTokens,
  renderAgents,
  summarize,
  VERSION,
  type Analysis,
  type DocStore,
  type Evidence,
  type Item,
  type Lesson,
  type LessonStore,
  type Route,
  type StaleReport,
} from "@houserules/core";
import { Marked } from "marked";
import { CLIENT_JS, CSS, THEME_BOOT } from "./assets.js";
import { dataModelHtml, explorerData, explorerHtml, flowStepperHtml, timelineHtml, type Diagrams } from "./diagrams.js";
import { entryMapHtml, tracePageHtml } from "./flows.js";
import { allLessons, DOC_SOURCES, flowSteps, TRACKS, type AnswerStore, type RuleResult } from "@houserules/core";

export interface State {
  root: string;
  analysis: Analysis;
  store: DocStore;
  broken: Map<string, StaleReport>;
  changed: Map<string, StaleReport>;
  total: number;
  diagrams: Diagrams;
  lessons: LessonStore;
  answers: AnswerStore;
  rules: RuleResult[];
  loadedAt: number;
}

const md = new Marked({ gfm: true, breaks: false });
md.use({ renderer: { html: ({ text }) => esc(text) } }); // agent-written text never injects raw HTML

// How to tell people to run houserules: the way it was started (npx), or the installed command.
const HR = (process.argv[1] ?? "").split(/[\\/]/).includes("_npx") ? "npx houserules" : "houserules";

// ---------- brand (same shapes as assets/brand/) ----------

const FAVICON = `data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><style>path{fill:#000}@media (prefers-color-scheme:dark){path{fill:#fff}}</style><path fill-rule="evenodd" d="M3 2 13 7v7h-3v-4H6v4H3V2Z"/></svg>`,
)}`;

// ---------- icons (lucide-style strokes, inline so the preview works offline) ----------

const ICON_PATHS: Record<string, string> = {
  home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/>',
  layers: '<path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="m3 13 9 5 9-5"/>',
  learn: '<path d="M2 9.5 12 4.5l10 5-10 5-10-5Z"/><path d="M6 11.5v4.8c0 1.4 2.7 2.7 6 2.7s6-1.3 6-2.7v-4.8"/><path d="M22 9.5v5"/>',
  book: '<path d="M4 4.5A1.5 1.5 0 0 1 5.5 3H20v16H5.5A1.5 1.5 0 0 0 4 20.5v-16Z"/><path d="M4 20.5A1.5 1.5 0 0 0 5.5 22H20"/>',
  bot: '<rect x="4" y="7" width="16" height="12" rx="3"/><path d="M12 3v4M9 12h.01M15 12h.01M9 16h6"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  theme: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  refresh: '<path d="M20 11a8 8 0 0 0-14.7-4.4L3 9"/><path d="M3 4v5h5"/><path d="M4 13a8 8 0 0 0 14.7 4.4L21 15"/><path d="M21 20v-5h-5"/>',
  check: '<path d="m5 12 4.5 4.5L19 7"/>',
  alert: '<path d="M12 3 2 20h20L12 3Z"/><path d="M12 10v4M12 17h.01"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .8-1 1.5V14M12 17h.01"/>',
  spark: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6"/>',
  file: '<path d="M14 3H6v18h12V7l-4-4Z"/><path d="M14 3v4h4"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  external: '<path d="M14 4h6v6M20 4l-9 9"/><path d="M18 14v6H4V6h6"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  compass: '<circle cx="12" cy="12" r="9"/><path d="m15.5 8.5-2 5-5 2 2-5 5-2Z"/>',
  pulse: '<path d="M3 12h4l3-8 4 16 3-8h4"/>',
  play: '<path d="M7 5v14l11-7L7 5Z"/>',
  map: '<path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2Z"/><path d="M9 4v14M15 6v14"/>',
  route: '<circle cx="6" cy="19" r="2"/><circle cx="18" cy="5" r="2"/><path d="M8 19h7a3 3 0 0 0 0-6H9a3 3 0 0 1 0-6h7"/>',
  hammer: '<path d="m14 7 3-3 3 3-3 3"/><path d="M17 7 6 18a2 2 0 0 1-3-3L14 4"/>',
  plug: '<path d="M9 3v5M15 3v5M6 8h12v3a6 6 0 0 1-12 0V8Z"/><path d="M12 17v4"/>',
  shield: '<path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6l-8-3Z"/>',
  chat: '<path d="M4 5h16v11H9l-5 4V5Z"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  circle: '<circle cx="12" cy="12" r="8"/>',
  checkCircle: '<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>',
  chevron: '<path d="m9 6 6 6-6 6"/>',
  diagram: '<rect x="3" y="4" width="7" height="5" rx="1.5"/><rect x="14" y="4" width="7" height="5" rx="1.5"/><rect x="8.5" y="15" width="7" height="5" rx="1.5"/><path d="M6.5 9v2.5h11V9M12 11.5V15"/>',
  db: '<ellipse cx="12" cy="6" rx="7" ry="3"/><path d="M5 6v12c0 1.7 3.1 3 7 3s7-1.3 7-3V6"/><path d="M5 12c0 1.7 3.1 3 7 3s7-1.3 7-3"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
};

function icon(name: string): string {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON_PATHS[name] ?? ""}</svg>`;
}

// ---------- shell ----------

export interface PageOptions {
  title: string;
  active: string; // "home" | doc id | "agents" | ""
  crumbs: string[];
  content: string;
}

const NAV_MARK = `<svg viewBox="0 0 32 32" aria-hidden="true"><path fill="currentColor" fill-rule="evenodd" clip-rule="evenodd" d="M6 4L26 14V28H20V20H12V28H6V4Z"/></svg>`;

interface NavKid {
  label: string;
  href: string;
  count?: number;
}

/** One navigator row; with children it gets a disclosure chevron and a collapsible list. */
function navRow(key: string, href: string, ic: string, label: string, cur: boolean, opts: { count?: number; dot?: string; kids?: NavKid[]; open?: boolean } = {}): string {
  const kids = opts.kids ?? [];
  const tog = kids.length
    ? `<button class="nv-tog" type="button" aria-expanded="${opts.open ? "true" : "false"}" aria-label="Show ${esc(label)} sections">${icon("chevron")}</button>`
    : `<span class="nv-tog" aria-hidden="true"></span>`;
  const row = `<div class="nv-row${cur ? " cur" : ""}">${tog}<a class="nv-link" href="${href}"${cur ? ' aria-current="page"' : ""}>${icon(ic)}<span class="nv-label">${esc(label)}</span>${
    opts.dot ? `<span class="nv-dot dot ${opts.dot}"></span>` : ""
  }${opts.count != null ? `<span class="count">${opts.count}</span>` : ""}</a></div>`;
  const list = kids.length
    ? `<div class="nv-kids">${kids.map((k) => `<a class="nv-kid" href="${k.href}"><span class="nv-label">${esc(k.label)}</span>${k.count != null ? `<span class="count">${k.count}</span>` : ""}</a>`).join("")}</div>`
    : "";
  return `<div class="nv${opts.open ? " open" : ""}" data-nav="${key}">${row}${list}</div>`;
}

/** The sections of the diagrams page, in page order (shared by the page and the navigator). */
function diagramSections(s: State): [string, string][] {
  const agentDiagrams = s.store.docs.architecture?.sections.diagrams?.items ?? [];
  return [
    ["entry", "How work gets in"],
    ...(s.diagrams.model.entities.length ? ([["model", "Data model"]] as [string, string][]) : []),
    ["map", "Structure"],
    ["flows", "Documented flows"],
    ...(agentDiagrams.length ? ([["journeys", "Journeys & lifecycles"]] as [string, string][]) : []),
    ["history", "History"],
  ];
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
}

export function page(s: State | null, opts: PageOptions): string {
  const repo = s?.analysis.root ?? "repo";
  const fw = s?.analysis.frameworks.map((f) => `${f.name}${f.version ? ` ${f.version}` : ""}`).join(" · ") || "No framework detected";
  const modules = s?.diagrams.map.nodes.length ?? 0;
  const repoMeta = s ? `${fw} · ${modules ? plural(modules, "module") : s.analysis.languages.slice(0, 2).map((l) => l.language).join(", ") || "no source"}` : fw;
  const status = s ? docStatus(s.store) : [];
  const a = opts.active;

  const docRows = DOC_SPECS.map((d) => {
    const st = status.find((x) => x.doc === d.id);
    const count = st?.sections.reduce((n, x) => n + x.items, 0) ?? 0;
    const kids = d.sections
      .map((sec) => ({ label: sec.title, href: `/doc/${d.id}#${sec.id}`, count: st?.sections.find((x) => x.id === sec.id)?.items ?? 0 }))
      .filter((k) => k.count > 0);
    return navRow(d.id, `/doc/${d.id}`, d.id === "architecture" ? "layers" : "book", d.title, a === d.id, { count, kids, open: a === d.id });
  }).join("");

  const lessons = s ? allLessons(s.lessons) : [];
  const learnKids = s
    ? TRACKS.map((t) => ({ label: t.title, href: `/learn#${t.id}`, count: s.lessons.tracks[t.id]?.lessons.length ?? 0 })).filter((k) => k.count > 0)
    : [];
  const healthDot = !s || s.total === 0 ? "empty" : s.broken.size ? "bad" : s.changed.size ? "warn" : "ok";
  const diagKids = s ? diagramSections(s).map(([id, t]) => ({ label: t, href: `/diagrams#${id}` })) : [];
  const hasClaude = s ? existsSync(path.join(s.root, "CLAUDE.md")) : false;

  const okCount = s ? s.total - s.broken.size : 0;
  const statusLine = !s
    ? ""
    : s.total === 0
      ? `<span class="dot empty"></span><span>No docs generated yet</span>`
      : s.broken.size
        ? `<span class="dot bad"></span><span>${plural(s.broken.size, "item")} out of date</span>`
        : `<span class="dot ${s.changed.size ? "warn" : "ok"}"></span><span>Evidence matches code · ${okCount}/${s.total}</span>`;

  const sep = `<span class="sep">›</span>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(opts.title)}</title><meta name="houserules-state" content="${s ? esc(stateSig(s)) : ""}"><meta name="houserules-repo" content="${esc(repo)}"><link rel="icon" type="image/svg+xml" href="${FAVICON}"><script>${THEME_BOOT}</script><style>${CSS}</style></head><body>
<div class="shell">
  <aside class="sidebar" aria-label="Navigator">
    <div class="brand"><a class="brand-link" href="/"><span class="logo">${NAV_MARK}</span><span class="brand-name">houserules</span></a><button class="icon-btn" id="theme" type="button" title="Theme: system" aria-label="Switch theme">${icon("theme")}</button></div>
    <div class="repo"><div class="repo-name" title="${esc(repo)}">${esc(repo)}</div><div class="repo-meta">${esc(repoMeta)}</div></div>
    <nav class="nav" id="navtree" aria-label="Pages">
      <div class="nv-sec">
        ${navRow("start", "/", "compass", "Start here", a === "start")}
        ${navRow("learn", "/learn", "play", "Learn", a === "learn", { count: lessons.length || undefined, kids: learnKids, open: a === "learn" })}
        ${navRow("health", "/health", "pulse", "Repo health", a === "home", { dot: s ? healthDot : undefined })}
      </div>
      <div class="nv-sec"><div class="nav-group">Documentation</div>
        ${docRows}
        ${navRow("diagrams", "/diagrams", "diagram", "Diagrams", a === "diagrams", { kids: diagKids, open: a === "diagrams" })}
        ${navRow("answers", "/answers", "chat", "Answers", a === "answers", { count: s?.answers.answers.length || undefined })}
      </div>
      <div class="nv-sec"><div class="nav-group">For agents</div>
        ${navRow("agents", "/agents", "bot", "AGENTS.md", a === "agents")}
        ${hasClaude ? navRow("claude", "/agents#claude", "bot", "CLAUDE.md", false) : ""}
      </div>
      <p class="nv-none" hidden>No pages match.</p>
    </nav>
    <div class="side-foot">
      <label class="field nv-filter">${icon("search")}<input id="navfilter" type="search" placeholder="Filter" autocomplete="off" aria-label="Filter pages"></label>
      ${s ? `<div class="health">${statusLine}<button class="linkbtn" id="recheck" type="button" title="Check against code: re-scans the code and re-checks every claim's evidence (files, lines, names). It doesn't rewrite the docs: to regenerate them, run houserules in your agent."><span class="lbl">Check</span></button></div>` : ""}
    </div>
  </aside>
  <div class="main">
    <header class="topbar">
      <button class="icon-btn menu-btn" id="menu" type="button" aria-label="Open navigation">${icon("menu")}</button>
      <div class="crumbs">${opts.crumbs.map((c, i) => (i === opts.crumbs.length - 1 ? `<strong>${esc(c)}</strong>` : `<span>${esc(c)}</span>${sep}`)).join("")}</div>
      <button class="searchbtn field" id="searchbtn" type="button" aria-label="Search the docs">${icon("search")}<span class="lbl">Search</span><kbd>⌘K</kbd></button>
    </header>
    ${opts.content}
    <footer class="foot">houserules ${VERSION} · local preview, read-only · nothing leaves your machine</footer>
  </div>
</div>
<div class="toast" id="toast" role="status" aria-live="polite"></div>
<div class="overlay" id="overlay"></div>
<aside class="drawer" id="drawer" aria-label="Source">
  <div class="drawer-head">
    <div class="drawer-title"><div class="path" id="drawer-path"></div><div class="sub" id="drawer-sub"></div></div>
    <button class="btn" id="drawer-copy">Copy path</button>
    <a class="btn" id="drawer-full" href="#" title="Open the whole file">${icon("external")}Full file</a>
    <button class="btn ghost" id="drawer-close" aria-label="Close">${icon("x")}</button>
  </div>
  <div class="drawer-body" id="drawer-body"></div>
</aside>
<div class="palette" id="palette" role="dialog" aria-label="Search"><div class="palette-box">
  <div class="palette-field">${icon("search")}<input id="palette-input" placeholder="Search docs, ways in and lessons…" autocomplete="off"><kbd>esc</kbd></div>
  <div class="results" id="results"></div>
  <div class="palette-foot"><span>↑↓ to move</span><span>↵ to open</span></div>
</div></div>
<script type="application/json" id="search-index">${s ? jsonForScript(searchIndex(s)) : "[]"}</script>
<script>${CLIENT_JS}</script>
</body></html>`;
}

/** Changes whenever the check results change, so the page knows when it needs to re-render. */
export function stateSig(s: State): string {
  return [s.total, [...s.broken.keys()].sort().join(","), [...s.changed.keys()].sort().join(",")].join("|");
}

/** Everything ⌘K can find: doc items, every way into the app (by what it does, URL or class), and lessons. */
function searchIndex(st: State): { g: string; t: string; b: string; s: string; u: string }[] {
  const out: { g: string; t: string; b: string; s: string; u: string }[] = [];
  for (const spec of DOC_SPECS) {
    for (const sec of spec.sections) {
      for (const it of st.store.docs[spec.id]?.sections[sec.id]?.items ?? []) {
        out.push({ g: "Docs", t: it.title.replace(/`/g, ""), b: it.body.replace(/[`*_#>]/g, "").slice(0, 400), s: `${spec.title} › ${sec.title}`, u: `/doc/${spec.id}#${it.id}` });
      }
    }
  }
  const e = st.diagrams.entry;
  for (const r of st.diagrams.routes) {
    const story = e.stories.get(r.id);
    if (!story) continue;
    const who = e.audiences.find((a) => a.id === story.audience)?.label ?? "";
    out.push({ g: "Ways in", t: story.title, b: `${r.path} ${r.name ?? ""} ${r.handler}`, s: `${r.methods ? `${r.methods.join(" ")} ` : ""}${r.path} · ${who}`, u: `/trace?${new URLSearchParams({ id: r.id })}` });
  }
  for (const a of st.answers.answers) out.push({ g: "Answers", t: a.question, b: a.body.replace(/[`*_#>]/g, "").slice(0, 400), s: "Saved answer", u: `/answers#${a.id}` });
  for (const l of allLessons(st.lessons)) out.push({ g: "Lessons", t: l.title.replace(/`/g, ""), b: l.concept.replace(/`/g, ""), s: TRACKS.find((t) => t.id === l.track)?.title ?? l.track, u: `/learn/${l.id}` });
  return out;
}

// ---------- overview ----------

const LANG_COLORS: Record<string, string> = { typescript: "#3178c6", javascript: "#e2b714", python: "#3572a5", java: "#b07219", kotlin: "#a97bff", other: "#9b9ba6" };

export function overview(s: State): string {
  const sum = summarize(s.analysis);
  const status = docStatus(s.store);
  const items = status.reduce((n, d) => n + d.sections.reduce((m, x) => m + x.items, 0), 0);
  const ok = s.total - s.broken.size;
  const sectionsFilled = status.reduce((n, d) => n + d.sections.filter((x) => x.items > 0).length, 0);
  const sectionsTotal = status.reduce((n, d) => n + d.sections.length, 0);
  const issues = [...s.broken.values()].map((b) => issueRow(b, "bad")).concat([...s.changed.values()].map((c) => issueRow(c, "warn")));
  const headline = !items ? "No docs written yet" : issues.length ? `${issues.length} thing${issues.length === 1 ? " needs" : "s need"} a look` : "Everything still matches the code";
  const header = `<div class="eyebrow">Repo health</div><h1>${headline}</h1>
    <p class="lede">Everything houserules wrote is checked against the code on every run. Here's what still matches, what moved, and what's missing.</p>`;
  const figure = (label: string, value: string, sub: string, tone = "") => `<div class="fig"><div class="fig-k">${esc(label)}</div><div class="fig-v ${tone}">${esc(value)}</div><div class="fig-s">${esc(sub)}</div></div>`;
  const figures = `<div class="figs">
    ${figure("Evidence", items ? `${ok} of ${s.total}` : "—", items ? "sources still match the code" : "generate docs first", items && ok === s.total ? "ok" : items ? "bad" : "")}
    ${figure("Changed", String(s.changed.size), "items whose code changed", s.changed.size ? "warn" : "")}
    ${figure("Coverage", `${sectionsFilled} of ${sectionsTotal}`, "doc sections filled")}
    ${figure("Integrations", String(sum.integrations.length), "outside services found")}
  </div>`;
  const section = (title: string, intro: string, body: string) => `<section class="hsec"><h2>${title}</h2>${intro ? `<p class="section-intro">${intro}</p>` : ""}${body}</section>`;

  if (!items) return `<main class="page"><article class="reading wide">${header}${figures}${emptyState()}${scanSections(s, sum, section)}</article></main>`;

  const coverage = status
    .map((d) => {
      const spec = DOC_SPECS.find((x) => x.id === d.doc)!;
      const rows = d.sections
        .map((sec) => `<li><i class="dot ${sec.items > 0 ? "ok" : sec.minItems ? "warn" : ""}"></i><a href="/doc/${d.doc}#${sec.id}">${esc(sec.title)}</a><span>${sec.items ? plural(sec.items, "item") : "not written yet"}</span></li>`)
        .join("");
      return `<div class="hgroup"><h3>${esc(spec.title)}</h3><ul class="hlist">${rows}</ul></div>`;
    })
    .join("");

  return `<main class="page"><article class="reading wide">${header}${figures}
    ${section("Needs a look", issues.length ? "The code behind these changed since they were written. Re-read them, or run <code>houserules generate</code> to refresh them." : "", issues.length ? `<ul class="issues">${issues.join("")}</ul>` : `<p class="all-good"><i class="dot ok"></i>All ${s.total} items were re-checked just now and still match.</p>`)}
    ${section("Docs coverage", "", coverage)}
    ${s.rules.length ? section("House rules", "Checked on every pull request and by agents before they finish a change.", rulesHtml(s)) : section("House rules", "", `<p class="start-p">No checked rules yet. Run <code>${HR} generate</code> to turn the guidelines into checks, then <code>${HR} ci-setup</code> to run them on every pull request.</p>`)}
    ${scanSections(s, sum, section)}
  </article></main>`;
}

function issueRow(r: StaleReport, kind: "bad" | "warn"): string {
  const href = r.doc === "learn" ? `/learn/${r.id}` : r.doc === "answers" ? `/answers#${r.id}` : `/doc/${r.doc}#${r.id}`;
  const where = r.doc === "learn" ? "Lesson" : r.doc === "answers" ? "Saved answer" : `${DOC_SPECS.find((d) => d.id === r.doc)?.title ?? r.doc} › ${DOC_SPECS.find((d) => d.id === r.doc)?.sections.find((x) => x.id === r.section)?.title ?? r.section}`;
  return `<li class="issue"><i class="dot ${kind}"></i><div><a href="${href}">${md.parseInline(r.title) as string}</a><div class="issue-why">${esc(where)} · ${kind === "bad" ? "broken: " : ""}${r.problems.map(esc).join("; ")}</div></div><a class="review" href="${href}">Review ›</a></li>`;
}

function scanSections(s: State, sum: ReturnType<typeof summarize>, section: (t: string, i: string, b: string) => string): string {
  const shown = s.analysis.integrations.filter((i) => i.category !== "observability" && i.category !== "http-client");
  const how = (i: (typeof shown)[number]) => (i.detectedBy.includes("client") ? (i.detectedBy.includes("import") || i.detectedBy.includes("package") ? "SDK + own client" : "Own client") : i.detectedBy.includes("import") || i.detectedBy.includes("package") ? "SDK" : i.detectedBy.includes("config") ? "Configured" : "Plain HTTP");
  const integrations = shown.length
    ? `<div class="scroll-x"><table class="t"><thead><tr><th>Service</th><th>How it's used</th><th>Used in</th><th>Env vars</th></tr></thead><tbody>${shown
        .map((i) => {
          const where = [...i.files, ...i.configFiles];
          return `<tr><td><strong>${esc(i.name)}</strong></td><td>${how(i)}</td><td class="files">${where.slice(0, 2).map(srcAnchor).join("") + (where.length > 2 ? `<span class="faint">+${where.length - 2} more</span>` : "") || "—"}</td><td class="env">${esc(i.envVars.slice(0, 2).join(", ")) || "—"}${i.envVars.length > 2 ? ` +${i.envVars.length - 2}` : ""}</td></tr>`;
        })
        .join("")}</tbody></table></div>`
    : `<p class="muted">No outside services detected.</p>`;
  const total = sum.languages.reduce((n, l) => n + l.lines, 0) || 1;
  const langs = `<div class="langbar">${sum.languages.map((l) => `<i style="width:${(l.lines / total) * 100}%;background:${LANG_COLORS[l.language] ?? LANG_COLORS.other}" title="${esc(l.language)}"></i>`).join("")}</div>
    <div class="legend">${sum.languages.map((l) => `<span><b style="background:${LANG_COLORS[l.language] ?? LANG_COLORS.other}"></b>${esc(l.language)} ${Math.round((l.lines / total) * 100)}%</span>`).join("")}</div>`;
  const blocks = sum.imports.mostImported.length
    ? `<ul class="hlist">${sum.imports.mostImported.slice(0, 8).map((m) => `<li><a href="/source?${new URLSearchParams({ path: m.path })}" title="${esc(m.path)}"><code>${esc(shortPath(m.path))}</code></a><span>${plural(m.importers, "importer")}</span></li>`).join("")}</ul>`
    : `<p class="muted">No internal imports found.</p>`;
  return `${section("Outside services", "Found from dependencies, imports, the repo's own API clients, config and env vars.", integrations)}
    ${section("Most-used internal code", "The files the rest of the code imports most: likely building blocks.", blocks)}
    ${section("Languages", `${sum.files.toLocaleString("en-US")} source files, ${sum.lines.toLocaleString("en-US")} lines.`, langs)}`;
}

function emptyState(): string {
  return `<section class="hsec first"><h2>Write the docs</h2>
    <p class="start-p">Run one command. It uses your own Claude Code or Codex to read the code and write the architecture, guidelines and lessons. Every claim is checked against the code before it's kept, and it can't edit your files.</p>
    <pre class="listing"><code>${HR} generate</code></pre>
    <p class="section-intro">Takes a while on a big repo. Until then, the diagrams already work: they're drawn straight from the code. <a href="/diagrams#entry">Explore how work gets in ›</a></p></section>`;
}

function cell(k: string, v: string, sub: string): string {
  return `<div class="cell"><div class="k">${esc(k)}</div><div class="v">${esc(v)}</div><div class="s">${esc(sub)}</div></div>`;
}

// ---------- doc pages ----------

export function docPage(s: State, docId: string): string {
  const spec = DOC_SPECS.find((d) => d.id === docId)!;
  const sections = s.store.docs[spec.id]?.sections ?? {};
  const all = spec.sections.flatMap((sec) => (sections[sec.id]?.items ?? []).map((it) => ({ sec, it })));
  const state = (secId: string, it: Item) => {
    const key = `${spec.id}/${secId}/${it.id}`;
    return s.broken.has(key) ? "broken" : s.changed.has(key) ? "changed" : "ok";
  };
  const counts = {
    verified: all.filter((x) => x.it.confidence === "verified").length,
    inferred: all.filter((x) => x.it.confidence === "inferred").length,
    ask: all.filter((x) => x.it.confidence === "needs-human").length,
    attention: all.filter((x) => state(x.sec.id, x.it) !== "ok").length,
  };

  const chips = all.length
    ? `<div class="chips" role="toolbar" aria-label="Filter items">
        <button class="chip" data-filter="all" aria-pressed="true">All <span class="n">${all.length}</span></button>
        ${counts.verified ? `<button class="chip" data-filter="verified" aria-pressed="false">Evidence checked <span class="n">${counts.verified}</span></button>` : ""}
        ${counts.inferred ? `<button class="chip" data-filter="inferred" aria-pressed="false">Inferred <span class="n">${counts.inferred}</span></button>` : ""}
        ${counts.ask ? `<button class="chip" data-filter="needs-human" aria-pressed="false">Ask a maintainer <span class="n">${counts.ask}</span></button>` : ""}
        ${counts.attention ? `<button class="chip" data-filter="attention" aria-pressed="false">Needs attention <span class="n">${counts.attention}</span></button>` : ""}
      </div>`
    : "";

  const filled = spec.sections.filter((sec) => sections[sec.id]?.items.length);
  const body = filled.length
    ? filled
        .map(
          (sec) =>
            `<section class="doc-section" id="${sec.id}"><h2>${esc(sec.title)}<span class="count">${sections[sec.id]!.items.length}</span></h2>${sections[sec.id]!.items.map((it) => itemHtml(s, spec.id, sec.id, it, state(sec.id, it))).join("")}</section>`,
        )
        .join("")
    : `<div class="empty-good" style="border:1px dashed var(--border-strong);border-radius:12px;margin-top:24px"><div class="big" style="background:var(--hover);color:var(--muted)">${icon("spark")}</div><strong>Nothing written yet</strong><span>In Claude Code or Codex, ask the agent to "run houserules", then refresh.</span></div>`;

  const rulesSection = spec.id === "guidelines" && s.rules.length ? `<section class="doc-section" id="checked"><h2>Checked on every pull request<span class="count">${s.rules.length}</span></h2><p class="section-intro">The guidelines above that a pattern can catch, as checks. Places that already broke a rule when it was written are allowed; anything new is flagged in the pull request, and agents check it before they finish.</p>${rulesHtml(s)}</section>` : "";
  const toc = filled.length
    ? `<nav class="toc" aria-label="On this page"><div class="toc-title">On this page</div>${filled
        .map((sec) => `<a href="#${sec.id}">${esc(sec.title)}</a>`)
        .join("")}${rulesSection ? `<a href="#checked">Checked on every PR</a>` : ""}</nav>`
    : "";

  const generated = Object.values(sections)
    .map((x) => x?.updatedAt)
    .filter(Boolean)
    .sort()
    .pop();
  return `<main class="page"><div class="doc-layout"><article class="reading">
      <div class="eyebrow">${esc(spec.title)}</div>
      <h1>${spec.id === "guidelines" ? "How we write code here" : `How ${esc(s.analysis.root)} is built`}</h1>
      <p class="lede">${esc(spec.purpose)}</p>
      ${all.length ? `<p class="doc-meta"><i class="dot ${counts.attention ? "warn" : "ok"}"></i>${all.length} item${all.length === 1 ? "" : "s"}, each checked against the code${counts.attention ? ` · ${counts.attention} need${counts.attention === 1 ? "s" : ""} a look` : ""}${generated ? ` · written ${esc(new Date(generated).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }))}` : ""}</p>
      <p class="doc-note">Written by an AI agent from the code. The checks prove each cited file, line and name exists, not that the claim is right.</p>` : ""}
      ${chips}
      ${body}
      ${rulesSection}
    </article>${toc}</div></main>`;
}

function itemHtml(s: State, doc: string, section: string, item: Item, st: "ok" | "broken" | "changed"): string {
  const key = `${doc}/${section}/${item.id}`;
  // Only the unusual gets a label; "checked" is said once, quietly, next to the sources.
  const label =
    st === "broken"
      ? `<div class="item-label bad">Out of date</div>`
      : item.confidence === "needs-human"
        ? `<div class="item-label ask">Ask your team</div>`
        : item.confidence === "inferred"
          ? `<div class="item-label warn" title="A conclusion drawn from the code, not read in it.">Inferred from the code</div>`
          : section === "pitfalls"
            ? `<div class="item-label warn">Pitfall${ruled(s, doc, item.id) ? ` <span class="ruled">· checked on every PR</span>` : ""}</div>`
            : ruled(s, doc, item.id)
              ? `<div class="item-label ok">Checked on every PR</div>`
            : section === "tradeoffs"
              ? `<div class="item-label ok">Looks like a bug, isn't</div>`
              : "";
  const problems = st === "broken" ? s.broken.get(key)!.problems : st === "changed" ? s.changed.get(key)!.problems : [];
  const alert = problems.length
    ? `<div class="alert ${st === "broken" ? "bad" : "warn"}">${icon("alert")}<div><strong>${st === "broken" ? "Out of date: the evidence no longer matches the code" : "The cited code changed since this was written"}</strong><ul>${problems.map((p) => `<li>${esc(p)}</li>`).join("")}</ul></div></div>`
    : "";
  const plainTitle = item.title.replace(/`/g, "");
  const checked = item.confidence === "verified" && st === "ok";
  const sources = item.evidence.length ? `<div class="sources">${checked ? `<span class="label checked" title="The cited files, lines and names exist in the code. The claim itself was written by an agent.">${icon("check")}Checked in</span>` : `<span class="label">Sources</span>`}${item.evidence.map((e) => evidencePill(e, plainTitle)).join("")}</div>` : "";
  // Examples first: show the first cited code right under the claim (the top advice from devs reading docs).
  const firstCode = item.evidence.find((e) => e.kind === "file" && e.line);
  const snippet = firstCode && st !== "broken" ? snippetHtml(s.root, firstCode, plainTitle, OPEN_CODE.has(section)) : "";
  const long = item.body.length > 460 || item.body.split(/\n\s*\n|\n(?=\d+\.|- )/).length > 4;
  const stepper = section === "flows" && st !== "broken" ? flowStepperHtml(flowSteps(item.evidence), plainTitle) : "";
  const prose = `<div class="prose${long ? " fold" : ""}">${linkPaths(md.parse(item.body) as string, item.body, s.root)}</div>${long ? `<button class="more" type="button">Show more</button>` : ""}`;
  const where = item.evidence.slice(0, 3).map((e) => `${e.path}${e.line ? `:${e.line}` : ""}`).join(", ");
  const prompt = `In this repo, explain "${plainTitle}" and show me where it happens in the code.${item.body ? ` The repo's docs say: ${firstSentence(item.body)}` : ""}${where ? ` Start from ${where}.` : ""} If it helps, use the houserules MCP tools (find_importers, get_symbols).`;
  const actions = `<div class="actions">
      <button class="act" type="button" data-copy="${esc(prompt)}" data-done="Prompt copied: paste it into Claude Code or Codex" title="Copy a prompt that asks your agent to walk you through this">${icon("chat")}Ask your agent</button>
      <button class="act" type="button" data-copy-link="#${item.id}" title="Copy a link to this item">${icon("link")}Copy link</button>
      <button class="act read-toggle" type="button" aria-pressed="false" title="Track what you've read">${icon("circle")}<span>Mark as read</span></button>
    </div>`;
  return `<div class="item${st === "broken" ? " is-broken" : ""}${item.confidence === "needs-human" ? " is-ask" : ""}" id="${item.id}" data-key="${esc(`${doc}/${section}/${item.id}`)}" data-conf="${item.confidence}" data-state="${st}">
    ${label}<div class="item-head"><h3><a href="${pathLink ? `/doc/${doc}#${item.id}` : `#${item.id}`}">${md.parseInline(item.title) as string}<span class="hash">#</span></a></h3></div>
    ${stepper}
    ${prose}
    ${stepper ? "" : snippet}
    ${sources}${alert}
    ${actions}
  </div>`;
}

const ruled = (s: State, doc: string, id: string) => s.rules?.some((r) => r.rule.guideline && r.rule.guideline.startsWith(doc) && r.rule.guideline.endsWith(`/${id}`));

// Sections where seeing the code is the point; elsewhere the snippet starts folded.
const OPEN_CODE = new Set(["patterns", "building-blocks", "flows", "integrations", "conventions"]);
let pathLink = false; // set while rendering a path page, so titles link back to the full doc

function firstSentence(body: string): string {
  const plain = body.replace(/`/g, "").replace(/\s+/g, " ").trim();
  const m = /^(.{20,240}?[.;:])(\s|$)/.exec(plain);
  return m ? m[1]! : plain.slice(0, 200);
}

const fileCache = new Map<string, { mtime: number; lines: string[] }>();
function fileLines(root: string, rel: string): string[] | null {
  try {
    const abs = path.join(root, rel);
    const st = statSync(abs);
    if (st.size > 2_000_000) return null;
    const hit = fileCache.get(abs);
    if (hit && hit.mtime === st.mtimeMs) return hit.lines;
    const lines = readFileSync(abs, "utf8").split(/\r?\n/);
    fileCache.set(abs, { mtime: st.mtimeMs, lines });
    return lines;
  } catch {
    return null;
  }
}

/** A few lines of the cited code, dedented, with the cited range highlighted. */
function snippetHtml(root: string, e: Evidence, citedBy: string, open: boolean): string {
  const lines = fileLines(root, e.path);
  if (!lines || !e.line) return "";
  const from = e.line;
  const to = Math.min(e.endLine && e.endLine > from ? e.endLine : from, from + 10);
  const start = Math.max(1, from - (to - from > 3 ? 0 : 2));
  const stop = Math.min(lines.length, Math.max(to, from + 5), start + 13);
  const slice = lines.slice(start - 1, stop);
  const indent = Math.min(...slice.filter((l) => l.trim()).map((l) => /^[\t ]*/.exec(l)![0].replace(/\t/g, "    ").length));
  const rows = slice
    .map((raw, i) => {
      const n = start + i;
      const text = raw.replace(/\t/g, "    ").slice(Number.isFinite(indent) ? indent : 0);
      return `<tr class="${n >= from && n <= to ? "hit" : ""}"><td class="n">${n}</td><td>${esc(text) || " "}</td></tr>`;
    })
    .join("");
  const more = stop < (e.endLine ?? 0) || stop < lines.length;
  const label = `${path.posix.basename(e.path)}:${from}${to > from ? `–${to}` : ""}`;
  return `<details class="snippet"${open ? " open" : ""}><summary>${icon("chevron")}<span class="file">${esc(e.path)}</span><span class="ln">:${from}${to > from ? `–${to}` : ""}</span></summary>
    <table class="code">${rows}</table>
    <div class="snippet-foot"><a class="src" href="/source?${new URLSearchParams({ path: e.path, line: String(from), ...(e.endLine ? { end: String(e.endLine) } : {}) })}" data-path="${esc(e.path)}" data-line="${from}"${e.endLine ? ` data-end="${e.endLine}"` : ""} data-item="${esc(citedBy.slice(0, 70))}">${icon("file")}<span class="file">Open ${esc(label)}${more ? " in context" : ""}</span></a></div>
  </details>`;
}

function evidencePill(e: Evidence, citedBy: string): string {
  const q = new URLSearchParams({ path: e.path, ...(e.line ? { line: String(e.line) } : {}), ...(e.endLine ? { end: String(e.endLine) } : {}) });
  const name = e.kind === "dir" ? `${e.path.split("/").pop()}/` : path.posix.basename(e.path);
  const lines = e.line ? `:${e.line}${e.endLine && e.endLine !== e.line ? `–${e.endLine}` : ""}` : "";
  const title = `${e.path}${lines}${e.symbol ? ` · ${e.symbol}` : ""}${e.note ? ` · ${e.note}` : ""}`;
  return `<a class="src" href="/source?${q}" data-path="${esc(e.path)}"${e.line ? ` data-line="${e.line}"` : ""}${e.endLine ? ` data-end="${e.endLine}"` : ""} data-item="${esc(citedBy.length > 70 ? `${citedBy.slice(0, 68)}…` : citedBy)}" title="${esc(title)}">${icon("file")}<span class="file">${esc(name)}</span><span class="ln">${esc(lines)}</span></a>`;
}

// ---------- start here + task paths ----------

interface TaskPath {
  id: string;
  title: string;
  blurb: string;
  icon: string;
  sections: [doc: "architecture" | "guidelines", section: string][];
}

// What developers come to docs to do, mapped onto the sections houserules writes.
export const PATHS: TaskPath[] = [
  { id: "big-picture", title: "Understand the big picture", blurb: "What this is, how it's laid out, and where things live.", icon: "map", sections: [["architecture", "overview"], ["architecture", "layout"]] },
  { id: "run", title: "Get it running", blurb: "Install, run, test and build it the way this repo does.", icon: "play", sections: [["architecture", "running"]] },
  { id: "flows", title: "Follow a request end to end", blurb: "The main paths through the code, step by step.", icon: "route", sections: [["architecture", "flows"]] },
  { id: "build", title: "Build a feature the house way", blurb: "The patterns to follow and the building blocks to reuse.", icon: "hammer", sections: [["guidelines", "patterns"], ["architecture", "building-blocks"], ["guidelines", "conventions"]] },
  { id: "services", title: "Work with third-party services", blurb: "How each integration is wired, configured and fails.", icon: "plug", sections: [["architecture", "integrations"], ["architecture", "cross-cutting"]] },
  { id: "safe", title: "Change things without breaking them", blurb: "Pitfalls, and tradeoffs that look like bugs but aren't.", icon: "shield", sections: [["guidelines", "pitfalls"], ["guidelines", "tradeoffs"]] },
];

function pathItems(s: State, p: TaskPath): { doc: string; section: string; sectionTitle: string; item: Item }[] {
  return p.sections.flatMap(([doc, section]) => {
    const spec = DOC_SPECS.find((d) => d.id === doc)!;
    const title = spec.sections.find((x) => x.id === section)?.title ?? section;
    return (s.store.docs[doc]?.sections[section]?.items ?? []).map((item) => ({ doc, section, sectionTitle: title, item }));
  });
}

function minutes(items: { item: Item }[]): number {
  const words = items.reduce((n, { item }) => n + `${item.title} ${item.body}`.split(/\s+/).length, 0);
  return Math.max(1, Math.round(words / 180 + items.length * 0.3)); // reading plus a glance at the code
}

const LANG_NAMES: Record<string, string> = { typescript: "TypeScript", javascript: "JavaScript", python: "Python", java: "Java", kotlin: "Kotlin", php: "PHP" };

const TOPIC_GROUPS: [string, string[]][] = [
  ["Essentials", ["big-picture", "run"]],
  ["Everyday work", ["flows", "build"]],
  ["Working safely", ["services", "safe"]],
];

function topicLink(href: string, title: string, abstract: string, meta: string, extra = ""): string {
  return `<li class="topic"><a class="topic-title" href="${href}">${esc(title)}</a>${extra}<p class="topic-abstract">${esc(abstract)}</p><p class="topic-meta">${meta}</p></li>`;
}

export function startPage(s: State): string {
  const repo = s.analysis.root;
  const sum = summarize(s.analysis);
  const paths = PATHS.map((p) => ({ p, items: pathItems(s, p) })).filter((x) => x.items.length);
  const total = paths.reduce((n, x) => n + x.items.length, 0);
  const overviewItem = s.store.docs.architecture?.sections.overview?.items[0];
  const lede = overviewItem ? (md.parseInline(overviewItem.title) as string) : `How ${esc(repo)} works and how it wants code written.`;
  const routes = s.diagrams.routes.length;
  const lessons = allLessons(s.lessons).length;
  const topLang = [...sum.languages].sort((x, y) => y.lines - x.lines)[0];
  const facts = [
    ...sum.frameworks.map((f) => `${f.name}${f.version ? ` ${f.version}` : ""}`),
    ...(topLang && topLang.language !== "other" ? [LANG_NAMES[topLang.language] ?? topLang.language] : []),
    plural(sum.files, "file"),
    ...(routes ? [plural(routes, "way in", "ways in")] : []),
    ...(sum.integrations.length ? [plural(sum.integrations.length, "outside service")] : []),
  ];
  const hero = `<header class="hero-band">
      <div class="hero-eyebrow">Repository</div>
      <h1 class="hero-title">${esc(repo)}</h1>
      <p class="hero-lede">${total ? lede : "houserules has scanned this repo, but no docs have been written yet."}</p>
      <ul class="hero-facts">${facts.map((f) => `<li>${esc(f)}</li>`).join("")}</ul>
    </header>`;
  const foot = `<footer class="start-foot">Generated from the code by houserules · checked <span data-checked-at="${new Date(s.loadedAt).toISOString()}">just now</span></footer>`;
  if (!total) {
    return `<main class="start">${hero}<div class="start-body">${emptyState()}<p style="margin-top:20px"><a href="/health">See what the scan found</a></p>${foot}</div></main>`;
  }
  const allKeys = paths.flatMap((x) => x.items.map((i) => `${i.doc}/${i.section}/${i.item.id}`));
  const allMin = minutes(paths.flatMap((x) => x.items));
  const questions = DOC_SPECS.flatMap((d) => d.sections.flatMap((sec) => (s.store.docs[d.id]?.sections[sec.id]?.items ?? []).filter((it) => it.confidence === "needs-human").map((it) => ({ d, it }))));
  const first = paths[0]?.p.id;

  const pathTopic = ({ p, items }: { p: TaskPath; items: ReturnType<typeof pathItems> }) => {
    const keys = items.map((x) => `${x.doc}/${x.section}/${x.item.id}`).join(" ");
    return topicLink(
      `/path/${p.id}`,
      p.title,
      p.blurb,
      `${plural(items.length, "item")} · ${minutes(items)} min<span class="path-done" data-done-keys="${esc(keys)}" hidden></span>`,
      p.id === first ? `<span class="start-label">Start here</span>` : "",
    );
  };
  const groups = TOPIC_GROUPS.map(([title, ids]) => [title, ids.map((id) => paths.find((x) => x.p.id === id)).filter((x) => x != null).map(pathTopic)] as [string, string[]]);
  const explore = [
    ...(routes ? [topicLink("/diagrams#entry", "How work gets in", "Every way into the app, and what each one runs, step by step.", plural(routes, "way in", "ways in"))] : []),
    ...(lessons ? [topicLink("/learn", "Learn the stack", "The framework concepts this repo is built on, taught with its own code.", plural(lessons, "lesson"))] : []),
  ];
  groups.push(["Explore", explore]);
  const topics = groups
    .filter(([, links]) => links.length)
    .map(([title, links]) => `<div class="topic-group"><h3>${esc(title)}</h3><ul class="topic-list">${links.join("")}</ul></div>`)
    .join("");

  const seeAlso = [
    ["/doc/architecture", "Architecture", DOC_SPECS.find((d) => d.id === "architecture")?.purpose ?? "How this repository is put together."],
    ["/doc/guidelines", "Guidelines", DOC_SPECS.find((d) => d.id === "guidelines")?.purpose ?? "How this repo wants code written."],
    ["/health", "Repo health", "What the scan found, docs coverage, and anything that no longer matches the code."],
  ];

  return `<main class="start">${hero}
    <div class="start-body">
      <section class="start-sec first">
        <h2>Overview</h2>
        <p class="start-p">Pick a path below. Each one is a short, ordered read for a single job, checked against the code on every run, so you can trust it without reading anything else first.</p>
        <div class="overall" data-progress-text="${esc(allKeys.join(" "))}" data-suffix=" · about ${allMin} minutes in all"><span class="progress" data-progress="${esc(allKeys.join(" "))}"><i></i></span><span class="ptext">You've read 0 of ${total} · about ${allMin} minutes in all</span></div>
        <button class="bigsearch open-search field" type="button">${icon("search")}<span>What are you trying to do?</span><kbd>⌘K</kbd></button>
      </section>
      <section class="start-sec"><h2>Paths</h2>${topics}</section>
      ${
        questions.length
          ? `<section class="start-sec"><h2>Questions only your team can answer</h2><p class="start-p">The code couldn't settle these. Worth asking a maintainer in your first week.</p><ul class="questions">${questions
              .map(({ d, it }) => `<li><a class="question" href="/doc/${d.id}#${it.id}"><span class="q-dot"></span><span>${md.parseInline(it.title) as string}</span></a></li>`)
              .join("")}</ul></section>`
          : ""
      }
      <section class="start-sec"><h2>Related</h2><ul class="see-also">${seeAlso.map(([href, t, ab]) => `<li><a href="${href}">${esc(t!)}</a><p>${esc(ab!)}</p></li>`).join("")}</ul></section>
      ${foot}
    </div>
  </main>`;
}

export function pathPage(s: State, id: string): string | null {
  const idx = PATHS.findIndex((p) => p.id === id);
  if (idx < 0) return null;
  const p = PATHS[idx]!;
  const items = pathItems(s, p);
  const keys = items.map((x) => `${x.doc}/${x.section}/${x.item.id}`);
  const next = PATHS.slice(idx + 1).concat(PATHS.slice(0, idx)).find((x) => pathItems(s, x).length);
  pathLink = true;
  let lastSection = "";
  const body = items
    .map(({ doc, section, sectionTitle, item }) => {
      const key = `${doc}/${section}/${item.id}`;
      const st = s.broken.has(key) ? "broken" : s.changed.has(key) ? "changed" : "ok";
      const heading = sectionTitle !== lastSection ? `<div class="path-section">${esc(sectionTitle)}</div>` : "";
      lastSection = sectionTitle;
      return heading + itemHtml(s, doc, section, item, st);
    })
    .join("");
  pathLink = false;
  return `<main class="page"><div class="doc-layout"><article class="reading">
    <div class="eyebrow"><a href="/">Start here</a> › Path</div>
    <h1>${esc(p.title)}</h1>
    <p class="lede">${esc(p.blurb)}</p>
    <div class="overall"><span class="progress wide" data-progress="${esc(keys.join(" "))}"><i></i></span><span class="ptext" data-progress-text="${esc(keys.join(" "))}">${items.length} items · ~${minutes(items)} min</span></div>
    ${body || `<p class="muted">Nothing here yet.</p>`}
    ${next ? `<a class="next-path" href="/path/${next.id}"><span class="faint">Next path</span><strong>${esc(next.title)}</strong>${icon("chevron")}</a>` : ""}
  </article></div></main>`;
}

// ---------- diagrams ----------

function allItems(s: State) {
  return DOC_SPECS.flatMap((d) => d.sections.flatMap((sec) => (s.store.docs[d.id]?.sections[sec.id]?.items ?? []).map((it) => ({ doc: d.id, section: sec.id, id: it.id, title: it.title, evidence: it.evidence }))));
}

/** The documented flow (agent-written, verified) that starts at this entry point's handler, if any. */
function documentedFlow(s: State, r: Route): Item | undefined {
  return (s.store.docs.architecture?.sections.flows?.items ?? []).find((it) => {
    const e = it.evidence[0];
    return e && e.path === r.file && (e.symbol === r.handler || (e.line != null && Math.abs(e.line - r.line) <= 3));
  });
}

export function tracePage(s: State, r: Route): string {
  const st = s.diagrams.entry.stories.get(r.id);
  const story = st && {
    title: st.title,
    area: s.diagrams.entry.areas.find((a) => a.id === st.area)?.title ?? st.area,
    audience: s.diagrams.entry.audiences.find((a) => a.id === st.audience)?.label ?? "",
    guards: st.steps.filter((x) => x.kind === "guard" && !x.file).map((x) => ({ label: x.label, code: x.code })),
    summary: st.steps.filter((x) => x.kind !== "guard").map((x) => (x.when ? `${x.when}: ${x.label.charAt(0).toLowerCase()}${x.label.slice(1)}` : x.label)),
  };
  return tracePageHtml(r, s.diagrams.traces.get(r.id), documentedFlow(s, r), (t) => md.parse(t) as string, story);
}

export function diagramsPage(s: State): string {
  const { map, model, history } = s.diagrams;
  const flows = s.store.docs.architecture?.sections.flows?.items ?? [];
  const agentDiagrams = s.store.docs.architecture?.sections.diagrams?.items ?? [];
  const flowHtml = flows.length
    ? flows
        .map((it) => {
          const steps = flowSteps(it.evidence);
          return `<div class="flow-card"><a class="flow-title" href="/doc/architecture#${it.id}">${md.parseInline(it.title) as string}</a>${flowStepperHtml(steps, it.title.replace(/\`/g, "")) || `<p class="faint">Not enough steps to draw.</p>`}</div>`;
        })
        .join("")
    : `<p class="muted">No flows traced yet. They appear once an agent has run houserules.</p>`;
  const sections = diagramSections(s);
  return `<main class="page page-wide"><article class="reading full">
    <div class="eyebrow">Diagrams</div>
    <h1>See how it fits together</h1>
    <p class="lede">Start from a way into the app and see what runs, step by step. Everything here is drawn from the code on every check, so it can't go out of date.</p>
    <nav class="chips" aria-label="Jump to">${sections.map(([id, t]) => `<a class="chip" href="#${id}">${t}</a>`).join("")}</nav>
    <section class="doc-section" id="entry"><h2>How work gets in</h2>
      <p class="section-intro">Who comes in, which part of the app they reach, and what that touches. Pick an area to see what each way in actually does.</p>
      ${entryMapHtml(s.diagrams.entry, s.diagrams.routes)}
    </section>
    ${model.entities.length ? `<section class="doc-section" id="model"><h2>Data model</h2><p class="section-intro">What the app stores and how it connects. Click a name to open its definition, or a relationship to jump to it.</p>${dataModelHtml(model)}</section>` : ""}
    <section class="doc-section" id="map"><h2>Structure</h2>
      <p class="section-intro">The folders and how they depend on each other. Useful for "what breaks if I change this folder?": click one to see its blast radius.${map.root ? ` Paths are relative to <code>${esc(map.root)}</code>.` : ""}</p>
      ${explorerHtml(map, model, s.analysis.root, explorerData(map, s.analysis, allItems(s), new Set([...s.broken.keys(), ...s.changed.keys()])))}
    </section>
    <section class="doc-section" id="flows"><h2>Documented flows</h2><p class="section-intro">The main paths as an agent described them, each step checked against the code.</p><div class="flow-grid">${flowHtml}</div></section>
    ${
      agentDiagrams.length
        ? `<section class="doc-section" id="journeys"><h2>Journeys & lifecycles</h2><p class="section-intro">Drawn by the agent from the code, with each step's source checked.</p>${agentDiagrams
            .map((it) => itemHtml(s, "architecture", "diagrams", it, s.broken.has(`architecture/diagrams/${it.id}`) ? "broken" : "ok"))
            .join("")}</section>`
        : ""
    }
    <section class="doc-section" id="history"><h2>History</h2><p class="section-intro">When each part of the codebase appeared, from git.</p>${timelineHtml(history)}</section>
  </article></main>`;
}

// ---------- AGENTS.md ----------

export function agentsPage(s: State): string {
  const raw = renderAgents(s.store, s.rules.map((r) => r.rule));
  const heads: [string, string][] = [];
  const html = (md.parse(raw) as string)
    .replaceAll('href="docs/houserules/ARCHITECTURE.md"', 'href="/doc/architecture"')
    .replaceAll('href="docs/houserules/GUIDELINES.md"', 'href="/doc/guidelines"')
    .replace(/<h2>[^<]*<\/h2>/, "")
    .replace(/<h3>(.*?)<\/h3>/g, (_m, t: string) => {
      const id = `a-${t.replace(/<[^>]+>/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
      heads.push([id, t.replace(/<[^>]+>/g, "")]);
      return `<h3 id="${id}">${t}</h3>`;
    });
  const rail = `<nav class="toc" aria-label="On this page"><div class="toc-title">Files</div><a href="#claude"><code>AGENTS.md</code></a><span class="toc-sub"><code>CLAUDE.md</code> imports it</span>
    ${heads.length ? `<div class="toc-title" style="margin-top:18px">On this page</div>${heads.map(([id, t]) => `<a href="#${id}">${esc(t)}</a>`).join("")}` : ""}
    <button class="btn" type="button" style="margin-top:18px" data-copy="${esc(raw)}" data-done="Copied the AGENTS.md block">Copy markdown</button></nav>`;
  return `<main class="page"><div class="doc-layout"><article class="reading">
    <div class="eyebrow">For agents</div><h1>AGENTS.md</h1>
    <p class="lede">The short version that Claude Code, Codex and other agents read before working here: commands, patterns to follow, what to reuse, and tradeoffs not to "fix".</p>
    <aside class="note" id="claude"><b>How this file is made</b>Written into <code>AGENTS.md</code>, and imported by <code>CLAUDE.md</code>, by <code>houserules render</code>. Your own text in those files is kept: houserules only updates its own marked block.</aside>
    <div class="prose agents">${html}</div>
  </article>${rail}</div></main>`;
}

// ---------- house rules ----------

function rulesHtml(s: State): string {
  if (!s.rules.length) return "";
  return `<ul class="rules">${s.rules
    .map(({ rule, violations }) => {
      const known = violations.filter((v) => !v.isNew).length, fresh = violations.filter((v) => v.isNew).length;
      const link = rule.guideline ? `/doc/${rule.guideline.split("/")[0]}#${rule.guideline.split("/").pop()}` : "";
      return `<li class="rule"><div class="rule-title">${link ? `<a href="${esc(link)}">${esc(rule.title)}</a>` : esc(rule.title)}</div>
        ${rule.why ? `<p class="rule-why">${esc(rule.why)}</p>` : ""}${rule.fix ? `<p class="rule-fix"><b>Instead:</b> ${md.parseInline(rule.fix) as string}</p>` : ""}
        <p class="rule-meta"><code>${esc(rule.files.join(", "))}</code>${rule.except?.length ? ` · not <code>${esc(rule.except.join(", "))}</code>` : ""} · ${rule.files_checked} files${known ? ` · ${plural(known, "older exception")} allowed` : " · no exceptions"}${fresh ? ` · <span class="bad">${fresh} new</span>` : ""}</p></li>`;
    })
    .join("")}</ul>`;
}

// ---------- saved answers ----------

export function answersPage(s: State): string {
  const list = s.answers.answers;
  const header = `<div class="eyebrow">Team memory</div><h1>Answers</h1>
    <p class="lede">Explanations your team's agents worked out and saved, each with the code it rests on. Like everything here, they're re-checked against the code on every run, so you can trust the ones without a warning.</p>`;
  if (!list.length)
    return `<main class="page"><article class="reading">${header}
      <section class="hsec first"><h2>Nothing saved yet</h2>
      <p class="start-p">Ask your agent how something works. When it explains with file and line evidence, say <em>"save this for the team"</em>. It calls houserules, which checks every citation before keeping the answer.</p>
      <p class="section-intro">Agents also search these answers before reading the code, so the next person asking gets the same, checked answer.</p></section></article></main>`;
  const when = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  const items = list
    .map((a) => {
      const key = `answers/answers/${a.id}`;
      const st = s.broken.has(key) ? "broken" : s.changed.has(key) ? "changed" : "ok";
      return itemHtml(s, "answers", "answers", { ...a, title: a.question }, st).replace('<div class="actions">', `<p class="answer-meta">Saved ${when(a.savedAt)}${a.updatedAt ? ` · updated ${when(a.updatedAt)}` : ""}${a.askedIn ? ` · from ${esc(a.askedIn)}` : ""}</p><div class="actions">`);
    })
    .join("");
  return `<main class="page"><article class="reading">${header}
    <p class="doc-meta"><i class="dot ${[...s.broken.keys(), ...s.changed.keys()].some((k) => k.startsWith("answers/")) ? "warn" : "ok"}"></i>${plural(list.length, "answer")}, each checked against the code</p>
    <section class="doc-section" id="answers">${items}</section></article></main>`;
}

// ---------- full source page ----------

export function sourcePage(rel: string, lines: string[], from: number, to: number, importers: number): string {
  const rows = lines
    .map((l, i) => {
      const n = i + 1;
      const hit = from && n >= from && n <= to;
      return `<tr id="L${n}" class="${hit ? "hit" : ""}"><td class="n"><a href="#L${n}">${n}</a></td><td>${esc(l) || " "}</td></tr>`;
    })
    .join("");
  return `<main class="page"><div class="eyebrow">Source</div><h1 style="font:600 18px var(--mono);overflow-wrap:anywhere">${esc(rel)}${from ? `<span class="faint">:${from}${to !== from ? `–${to}` : ""}</span>` : ""}</h1>
    <p class="muted" style="margin:0 0 16px">${lines.length} lines${importers ? ` · imported by ${importers} file${importers === 1 ? "" : "s"}` : ""}</p>
    <div class="code-page"><table class="code">${rows}</table></div>
    ${from ? `<script>document.getElementById("L${Math.max(1, from - 6)}")?.scrollIntoView();</script>` : ""}</main>`;
}

export function dirPage(rel: string, files: string[]): string {
  return `<main class="page"><div class="eyebrow">Directory</div><h1 style="font:600 18px var(--mono)">${esc(rel)}/</h1>
    <div class="card"><div class="card-body blocks">${files.map((f) => `<a href="/source?${new URLSearchParams({ path: f })}"><span class="p">${esc(f.slice(rel.length + 1))}</span></a>`).join("") || `<p class="muted">No source files.</p>`}</div></div></main>`;
}

export function messagePage(title: string, text: string): string {
  return `<main class="page message"><h1>${esc(title)}</h1><p class="lede">${text}</p><p class="message-links"><a href="/">Start here ›</a><a href="#" class="open-search">Search ⌘K</a><a href="/health">Repo health ›</a></p></main>`;
}

// ---------- helpers ----------

function srcAnchor(p: string): string {
  return `<a href="/source?${new URLSearchParams({ path: p })}" title="${esc(p)}">${esc(shortPath(p))}</a>`;
}

/** `src/main/java/org/acme/shop/owner/Owner.java` → `src/…/shop/owner/Owner.java`. */
export function shortPath(p: string): string {
  const parts = p.split("/");
  return parts.length > 5 ? `${parts[0]}/…/${parts.slice(-3).join("/")}` : p;
}

/** Turns `path/like/this.ts` code spans that exist in the repo into source links. */
function linkPaths(html: string, body: string, root: string): string {
  let out = html;
  for (const token of pathLikeTokens(body)) {
    const rel = normalize(token);
    if (!rel || !existsSync(path.join(root, rel))) continue;
    out = out.split(`<code>${esc(token)}</code>`).join(`<a href="/source?${new URLSearchParams({ path: rel })}"><code>${esc(token)}</code></a>`);
  }
  return out;
}

export function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function jsonForScript(v: unknown): string {
  return JSON.stringify(v).replace(/</g, "\\u003c");
}

// ---------- learn: lessons grounded in the latest official docs and this repo's code ----------

const SOURCE_NAME: Record<string, string> = Object.fromEntries(DOC_SOURCES.map((d) => [d.id, d.name]));

/** Wraps the first mention of each glossary term in a hover definition, so readers never leave the page. */
function withTerms(html: string, terms: Lesson["terms"]): string {
  let out = html;
  for (const t of terms ?? []) {
    const re = new RegExp(`(^|[^\\w-])(${t.term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})(?![\\w-])(?![^<]*>)(?![^<]*</(?:a|code|dfn)>)`, "i");
    out = out.replace(re, (_m, pre: string, word: string) => `${pre}<dfn class="term" tabindex="0" data-def="${esc(t.definition)}">${word}</dfn>`);
  }
  return out;
}

export function learnPage(s: State): string {
  const lessons = allLessons(s.lessons);
  const repo = s.analysis.root;
  const sources = [...new Set(lessons.flatMap((l) => l.docs.map((d) => `${SOURCE_NAME[d.source] ?? d.source} docs${d.version ? ` v${d.version}` : ""}`)))];
  const hands = lessons.filter((l) => l.exercises.some((e) => e.kind === "change")).length;
  const facts = [plural(lessons.length, "lesson"), ...sources.slice(0, 2), ...(hands ? [`${hands} hands-on change${hands === 1 ? "" : "s"}`] : []), "Exercises check your editor"];
  const hero = `<header class="hero-band"><div class="hero-eyebrow">Learn</div><h1 class="hero-title">Learn ${esc(repo)}</h1>
    <p class="hero-lede">Short lessons that teach the stack through this repo. Every quote comes from the framework's latest official docs, and every code line from here.</p>
    ${lessons.length ? `<ul class="hero-facts">${facts.map((f) => `<li>${esc(f)}</li>`).join("")}</ul>` : ""}</header>`;
  if (!lessons.length) {
    return `<main class="start">${hero}<div class="start-body"><section class="start-sec first"><h2>No lessons yet</h2>
      <p class="start-p">Run <code>${HR} generate</code>, or ask your agent to "use houserules to write the lessons". It reads the latest official docs for your stack, follows your entry points, and every quote and code reference is checked before it's saved.</p></section></div></main>`;
  }
  const chapters = TRACKS.map((t, ti) => {
    const list = s.lessons.tracks[t.id]?.lessons ?? [];
    if (!list.length) return "";
    return `<section class="chapter" id="${t.id}" data-track="${t.id}">
      <div class="ch-side"><div class="ch-num">Chapter ${ti + 1}</div><h2>${esc(t.title)}</h2><p>${esc(t.blurb)}</p><span class="track-progress" data-progress="${t.id}"></span></div>
      <ol class="lesson-list">${list
        .map((l, i) => {
          const key = `learn/${l.track}/${l.id}`;
          const flag = s.broken.has(key) ? `<span class="ln-flag bad">Out of date</span>` : s.changed.has(key) ? `<span class="ln-flag warn">Needs review</span>` : "";
          const kinds = [...new Set(l.exercises.map((e) => (e.kind === "change" ? "change" : "predict")))];
          const meta = [kinds.length ? sentenceCase(kinds.join(" + ")) : "Read", ...new Set(l.docs.map((d) => `${SOURCE_NAME[d.source] ?? d.source} docs`)), ...(l.drift ? ["differs from latest docs"] : [])].join(" · ");
          return `<li><a class="lesson-card" href="/learn/${esc(l.id)}" data-lesson="${esc(l.id)}"><span class="ln-num">${i + 1}</span><span class="ln-body"><span class="ln-title">${md.parseInline(l.title) as string}</span><span class="ln-abstract">${md.parseInline(l.concept) as string}</span><span class="ln-meta">${esc(meta)}${flag}</span></span><span class="ln-done">✓ Done</span></a></li>`;
        })
        .join("")}</ol></section>`;
  }).join("");
  return `<main class="start">${hero}<div class="start-body">
    <section class="start-sec first"><h2>Overview</h2>
      <p class="start-p">Start with the first chapter if the framework is new to you, or jump to how this repo works. Each lesson asks you to predict what the code does before it explains, and some end with a small change you make in your own editor. houserules checks it as you save.</p>
      <div class="learn-overall"><div class="progress"><span data-overall-bar></span></div><span data-overall>0 of ${lessons.length} done</span></div>
      <div class="learn-stack" data-stack hidden></div>
    </section>
    <section class="start-sec chapters">${chapters}</section>
  </div></main>
    <script type="application/json" id="lesson-ids">${JSON.stringify(lessons.map((l) => ({ id: l.id, track: l.track })))}</script>`;
}

const sentenceCase = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Why a lesson may be out of date: code it cites was removed or edited, or the official page changed. */
function lessonStatus(s: State, lesson: Lesson): string {
  const key = `learn/${lesson.track}/${lesson.id}`;
  const bad = s.broken.get(key), warn = s.changed.get(key);
  const r = bad ?? warn;
  if (!r) return "";
  return `<div class="alert ${bad ? "bad" : "warn"}">${icon("alert")}<div><strong>${bad ? "This lesson is out of date." : "This lesson may need a refresh."}</strong> ${bad ? "Code it points to no longer exists, so some examples below may be wrong." : "Something it relies on changed since it was written; the explanation may still hold."}<ul>${r.problems.map((p) => `<li>${esc(p)}</li>`).join("")}</ul><span class="faint">Ask your agent to refresh the lessons; houserules will re-check them.</span></div></div>`;
}

export function lessonPage(s: State, lesson: Lesson): string {
  const all = allLessons(s.lessons);
  const idx = all.findIndex((l) => l.id === lesson.id);
  const inTrack = all.filter((l) => l.track === lesson.track);
  const track = TRACKS.find((t) => t.id === lesson.track)!;
  const prev = all[idx - 1], next = all[idx + 1];
  const term = (h: string) => withTerms(h, lesson.terms);
  const docsHtml = lesson.docs
    .map((d) => `<figure class="doc-quote"><blockquote>${md.parseInline(d.quote) as string}</blockquote><figcaption><a href="${esc(d.url)}" target="_blank" rel="noopener">${esc(SOURCE_NAME[d.source] ?? d.source)} docs${d.version ? ` · v${esc(d.version)}` : ""} ↗</a><span class="faint">${esc(d.url.replace(/^https:\/\//, ""))}</span><span class="verified" title="This sentence was found on the official page when the lesson was saved">✓ quote checked</span></figcaption></figure>`)
    .join("");
  const codeHtml = lesson.code.map((e) => snippetHtml(s.root, e, lesson.title, true) || `<p>${evidencePill(e, lesson.title)}</p>`).join("");
  const predicts = lesson.exercises.map((e, i) => ({ e, i })).filter((x) => x.e.kind === "predict");
  const changes = lesson.exercises.map((e, i) => ({ e, i })).filter((x) => x.e.kind === "change");
  const predictHtml = predicts
    .map(({ e, i }) => {
      if (e.kind !== "predict") return "";
      return `<section class="predict" data-ex="${i}" data-answer="${e.answer}">
        <div class="eyebrow">Predict first</div><h3>${term(md.parseInline(e.question) as string)}</h3>
        <p class="faint">Make a guess before reading on. Being wrong is fine: guessing first is what makes it stick.</p>
        <div class="pr-options">${e.options.map((o, n) => `<button type="button" class="pr-opt" data-n="${n}"><span class="pr-key">${String.fromCharCode(65 + n)}</span>${md.parseInline(o) as string}</button>`).join("")}</div>
        <div class="pr-reveal" hidden><p class="pr-verdict"></p><div class="prose">${term(md.parse(e.explain) as string)}</div>${e.evidence.map((ev) => snippetHtml(s.root, ev, lesson.title, false) || evidencePill(ev, lesson.title)).join("")}</div>
      </section>`;
    })
    .join("");
  const changeHtml = changes
    .map(({ e, i }) => {
      if (e.kind !== "change") return "";
      return `<section class="change" data-ex="${i}">
        <div class="eyebrow">Change it</div><h3>${term(md.parseInline(e.task) as string)}</h3>
        <p class="faint">Make the change in your own editor. houserules checks your files every time you save; nothing here edits them.</p>
        <div class="ch-files">Files: ${e.files.map((f) => evidencePill({ path: f, kind: "file" }, lesson.title)).join("")}</div>
        <ul class="ch-checks">${e.checks.map((c) => `<li><span class="ch-mark">○</span>${md.parseInline(c.describe) as string}</li>`).join("")}</ul>
        <div class="ch-actions"><button type="button" class="btn primary ch-watch">Start checking as I save</button><span class="ch-status faint"></span></div>
        <p class="ch-other" hidden></p>
        ${e.hint ? `<details class="ex-hint"><summary>Hint</summary><p>${term(md.parseInline(e.hint) as string)}</p></details>` : ""}
        ${e.solution ? `<details class="ex-answer"><summary>Show a solution</summary><div class="prose">${md.parse(e.solution) as string}</div></details>` : ""}
        <details class="ex-hint"><summary>Undo your changes</summary><pre class="cmd"><code>git checkout -- ${e.files.map(esc).join(" ")}</code></pre></details>
      </section>`;
    })
    .join("");
  return `<main class="page"><article class="reading lesson" data-lesson="${esc(lesson.id)}" data-changes="${changes.length}">
    <a class="back" href="/learn">← All lessons</a>
    <div class="eyebrow">${esc(track.title)} · lesson ${inTrack.indexOf(lesson) + 1} of ${inTrack.length}</div>
    <h1>${md.parseInline(lesson.title) as string}</h1>
    ${lessonStatus(s, lesson)}
    <p class="lede">${term(md.parseInline(lesson.concept) as string)}</p>
    ${predictHtml}
    <div class="why"><b>Why it matters here.</b> ${term(md.parseInline(lesson.why) as string)}</div>
    <h2>What the official docs say</h2>${docsHtml}
    <div class="prose">${term(md.parse(lesson.body) as string)}</div>
    <h2>In this repo</h2>${codeHtml}
    ${lesson.drift ? `<div class="drift"><b>This repo vs the latest docs.</b> ${term(md.parseInline(lesson.drift) as string)}</div>` : ""}
    ${lesson.terms?.length ? `<details class="glossary"><summary>Terms in this lesson (${lesson.terms.length})</summary><dl>${lesson.terms.map((t) => `<dt>${t.url ? `<a href="${esc(t.url)}" target="_blank" rel="noopener">${esc(t.term)} ↗</a>` : esc(t.term)}</dt><dd>${esc(t.definition)}</dd>`).join("")}</dl></details>` : ""}
    ${changeHtml}
    <nav class="lesson-nav">${prev ? `<a class="next-path" href="/learn/${esc(prev.id)}"><span class="faint">← Previous</span><strong>${md.parseInline(prev.title) as string}</strong></a>` : "<span></span>"}${next ? `<a class="next-path right" href="/learn/${esc(next.id)}"><span class="faint">Next →</span><strong>${md.parseInline(next.title) as string}</strong></a>` : `<a class="next-path right" href="/learn"><span class="faint">Finished</span><strong>Back to all lessons</strong></a>`}</nav>
  </article></main>`;
}
