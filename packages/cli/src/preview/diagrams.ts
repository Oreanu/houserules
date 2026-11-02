import dagre from "@dagrejs/dagre";
import type { ArchitectureMap, DataModel, EntryMap, FlowStep, Route, Timeline, Trace } from "@houserules/core";

// Native, theme-aware diagrams for the preview. Everything here is computed from the scan, so the
// pictures are redrawn on every check and can't drift from the code.

export interface Diagrams {
  map: ArchitectureMap;
  model: DataModel;
  history: Timeline;
  routes: Route[];
  traces: Map<string, Trace>; // by route id
  entry: EntryMap; // who comes in, the areas they reach, and a story per way in
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const q = (o: Record<string, string>) => new URLSearchParams(o).toString();

// ---------- architecture map: laid out by dagre (the engine Mermaid uses), drawn as our own SVG ----------

const NODE_W = 184, NODE_H = 54;

export function architectureSvg(map: ArchitectureMap, opts: { compact?: boolean } = {}): string {
  if (!map.nodes.length) return `<p class="muted">No source modules found.</p>`;
  const services = map.services.filter((s) => s.usedBy.length);
  const build = (rankdir: "LR" | "TB") => {
    const g = new dagre.graphlib.Graph({ multigraph: false });
    g.setGraph({ rankdir, nodesep: rankdir === "LR" ? 22 : 30, ranksep: rankdir === "LR" ? 74 : 56, edgesep: 14, marginx: 24, marginy: 24, ranker: "network-simplex" });
    g.setDefaultEdgeLabel(() => ({}));
    for (const n of map.nodes) g.setNode(n.id, { width: NODE_W, height: NODE_H });
    for (const s of services) g.setNode(s.id, { width: NODE_W, height: NODE_H });
    // Heavier dependencies pull their modules closer together and straighter.
    for (const e of map.edges) g.setEdge(e.from, e.to, { weight: Math.max(1, Math.round(Math.log2(1 + e.imports) * 2)), minlen: 1 });
    for (const s of services) for (const u of s.usedBy) g.setEdge(u, s.id, { weight: 1, minlen: 1 });
    dagre.layout(g);
    return g;
  };
  // Shallow graphs read left to right; deep dependency chains read better top to bottom on a wide screen.
  let g = build("LR");
  const ranks = new Set(g.nodes().map((id: string) => (g.node(id) as { rank?: number }).rank)).size;
  if (ranks > 4) g = build("TB");
  const { width = 600, height = 300 } = g.graph() as { width?: number; height?: number };

  const byId = new Map(map.nodes.map((n) => [n.id, n]));
  const maxW = Math.max(1, ...map.edges.map((e) => e.imports));
  const edges = map.edges
    .map((e) => {
      const pts = (g.edge(e.from, e.to) as { points?: { x: number; y: number }[] } | undefined)?.points ?? [];
      const w = 1 + Math.log2(1 + (e.imports / maxW) * 15);
      return `<path class="edge" data-from="${e.from}" data-to="${e.to}" d="${basis(pts)}" stroke-width="${w.toFixed(2)}" marker-end="url(#arrow)"><title>${esc(byId.get(e.from)!.label)} imports ${esc(byId.get(e.to)!.label)} ${e.imports}×</title></path>`;
    })
    .join("");
  const svcEdges = services
    .flatMap((s) =>
      s.usedBy.map((u) => {
        const pts = (g.edge(u, s.id) as { points?: { x: number; y: number }[] } | undefined)?.points ?? [];
        return `<path class="edge svc" data-from="${u}" data-to="${s.id}" d="${basis(pts)}"><title>${esc(byId.get(u)?.label ?? u)} uses ${esc(s.name)}</title></path>`;
      }),
    )
    .join("");
  const at = (id: string) => { const n = g.node(id) as { x: number; y: number }; return { x: n.x - NODE_W / 2, y: n.y - NODE_H / 2 }; };
  const nodes = map.nodes
    .map((n) => {
      const p = at(n.id);
      return `<a class="node" data-id="${n.id}" href="/source?${q({ path: n.dir })}"><g transform="translate(${p.x.toFixed(1)},${p.y.toFixed(1)})">
        <rect width="${NODE_W}" height="${NODE_H}" rx="10"/>
        <line class="heat" x1="4" y1="9" x2="4" y2="${NODE_H - 9}"/>
        <text x="${NODE_W - 12}" y="23" text-anchor="end" class="hv"></text>
        <text x="14" y="23" class="nl">${esc(clip(n.label, 21))}</text>
        <text x="14" y="41" class="ns">${n.files} file${n.files === 1 ? "" : "s"} · ${n.lines.toLocaleString("en-US")} lines</text>
        <title>${esc(n.dir || n.label)}</title></g></a>`;
    })
    .join("");
  const svcNodes = services
    .map((s) => {
      const p = at(s.id);
      return `<g class="svc-node" data-id="${s.id}" transform="translate(${p.x.toFixed(1)},${p.y.toFixed(1)})"><rect width="${NODE_W}" height="${NODE_H}" rx="27"/><text x="${NODE_W / 2}" y="24" text-anchor="middle" class="nl">${esc(clip(s.name, 22))}</text><text x="${NODE_W / 2}" y="41" text-anchor="middle" class="ns">${esc(s.sdk ? s.category : `${s.category} · no SDK`)}</text></g>`;
    })
    .join("");
  return `<div class="diagram-scroll${opts.compact ? " compact" : ""}"><svg class="arch" viewBox="0 0 ${Math.ceil(width)} ${Math.ceil(height)}" data-w="${Math.ceil(width)}" data-h="${Math.ceil(height)}" style="width:100%;height:min(72vh,${Math.ceil(height)}px)" role="img" aria-label="Architecture map">
    <defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerUnits="userSpaceOnUse" markerWidth="9" markerHeight="9" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z"/></marker></defs>
    ${edges}${svcEdges}${nodes}${svcNodes}</svg></div>`;
}

/** Smooth B-spline through dagre's routed points (the same curve d3's curveBasis draws). */
function basis(pts: { x: number; y: number }[]): string {
  if (!pts.length) return "";
  if (pts.length < 3) return `M${f(pts[0]!.x)},${f(pts[0]!.y)} L${f(pts.at(-1)!.x)},${f(pts.at(-1)!.y)}`;
  let d = `M${f(pts[0]!.x)},${f(pts[0]!.y)}`;
  let [x0, y0, x1, y1] = [pts[0]!.x, pts[0]!.y, pts[1]!.x, pts[1]!.y];
  d += ` L${f((5 * x0 + x1) / 6)},${f((5 * y0 + y1) / 6)}`;
  for (const p of pts.slice(2)) {
    d += ` C${f((2 * x0 + x1) / 3)},${f((2 * y0 + y1) / 3)} ${f((x0 + 2 * x1) / 3)},${f((y0 + 2 * y1) / 3)} ${f((x0 + 4 * x1 + p.x) / 6)},${f((y0 + 4 * y1 + p.y) / 6)}`;
    [x0, y0, x1, y1] = [x1, y1, p.x, p.y];
  }
  d += ` C${f((2 * x0 + x1) / 3)},${f((2 * y0 + y1) / 3)} ${f((x0 + 2 * x1) / 3)},${f((y0 + 2 * y1) / 3)} ${f(x1)},${f(y1)}`;
  return d;
}
const f = (n: number) => n.toFixed(1);

const avg = (xs: number[], empty: number) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : empty);
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

// ---------- data model: explorable entity cards ----------

const KIND_LABEL: Record<string, string> = { "one-to-many": "has many", "many-to-one": "belongs to", "one-to-one": "has one", "many-to-many": "many-to-many", extends: "extends" };
const REVERSE_LABEL: Record<string, string> = { "one-to-many": "belongs to", "many-to-one": "has many", "one-to-one": "used by", "many-to-many": "many-to-many", extends: "extended by" };
const SOURCE_LABEL: Record<string, string> = { prisma: "Prisma schema", django: "Django models", jpa: "JPA entities", sql: "SQL schema", typescript: "TypeScript types", none: "" };

export function dataModelHtml(model: DataModel, limit = 24): string {
  if (!model.entities.length) return `<p class="muted">No data model found: no Prisma schema, Django models, JPA entities, SQL tables or domain types.</p>`;
  const degree = new Map<string, number>();
  for (const r of model.relations) for (const n of [r.from, r.to]) degree.set(n, (degree.get(n) ?? 0) + 1);
  const ordered = [...model.entities].sort((a, b) => (degree.get(b.name) ?? 0) - (degree.get(a.name) ?? 0) || a.name.localeCompare(b.name));
  const cards = ordered
    .map((e, i) => {
      const rels = model.relations
        .filter((r) => r.from === e.name || r.to === e.name)
        .map((r) => {
          const other = r.from === e.name ? r.to : r.from;
          const kind = r.from === e.name ? KIND_LABEL[r.kind] : REVERSE_LABEL[r.kind];
          return `<a class="rel" href="#ent-${esc(other)}" data-target="ent-${esc(other)}"><span class="rk">${esc(kind!)}</span>${esc(other)}</a>`;
        })
        .join("");
      const fields = e.fields
        .map((f) => `<li><span class="fname">${esc(f.name)}</span><span class="ftype">${esc(f.type)}</span>${f.pk ? `<span class="ftag pk">PK</span>` : f.fk ? `<span class="ftag fk">FK</span>` : ""}</li>`)
        .join("");
      return `<div class="entity${i >= limit ? " extra" : ""}" id="ent-${esc(e.name)}" data-name="${esc(e.name.toLowerCase())}">
        <div class="ent-head"><a class="src ent-name" href="/source?${q({ path: e.file, line: String(e.line) })}" data-path="${esc(e.file)}" data-line="${e.line}" data-item="${esc(e.name)}" title="${esc(`${e.file}:${e.line}`)}">${esc(e.name)}</a></div>
        ${fields ? `<ul class="fields">${fields}</ul>` : `<p class="faint" style="margin:6px 12px;font-size:12px">No own fields</p>`}
        ${rels ? `<div class="rels">${rels}</div>` : ""}
      </div>`;
    })
    .join("");
  const many = ordered.length > limit;
  return `<div class="model-tools"><span class="tag">${esc(SOURCE_LABEL[model.source] ?? model.source)}</span><span class="faint">${model.entities.length} entities · ${model.relations.length} relationships</span>${
    many ? `<input class="model-filter" type="search" placeholder="Filter entities…" aria-label="Filter entities">` : ""
  }</div>
  <div class="entities${many ? " limited" : ""}">${cards}</div>
  ${many ? `<button class="btn show-all-entities" type="button">Show all ${ordered.length} entities</button>` : ""}`;
}

// ---------- flows: numbered step diagram ----------

export function flowStepperHtml(steps: FlowStep[], citedBy: string): string {
  if (steps.length < 2) return "";
  const items = steps
    .map((s, i) => {
      const lines = s.line ? `:${s.line}${s.endLine && s.endLine !== s.line ? `–${s.endLine}` : ""}` : "";
      const href = `/source?${q({ path: s.file, ...(s.line ? { line: String(s.line) } : {}), ...(s.endLine ? { end: String(s.endLine) } : {}) })}`;
      return `<li><span class="sn">${i + 1}</span><div class="sbody"><code class="slabel">${esc(s.label)}</code><a class="src" href="${href}" data-path="${esc(s.file)}"${s.line ? ` data-line="${s.line}"` : ""}${s.endLine ? ` data-end="${s.endLine}"` : ""} data-item="${esc(citedBy.slice(0, 70))}" title="${esc(s.file + lines)}"><span class="file">${esc(s.file.split("/").pop()!)}</span><span class="ln">${esc(lines)}</span></a></div></li>`;
    })
    .join("");
  return `<ol class="flowsteps" aria-label="Steps">${items}</ol>`;
}

// ---------- history ----------

export function timelineHtml(t: Timeline): string {
  if (!t.available) return `<p class="muted">No history to draw: ${esc(t.reason ?? "unavailable")}.</p>`;
  const meta = [t.commits ? `${t.commits.toLocaleString("en-US")} commits` : "", t.contributors ? `${t.contributors} contributors` : ""].filter(Boolean).join(" · ");
  return `${meta ? `<p class="faint" style="margin:0 0 10px">${esc(meta)}</p>` : ""}<ol class="history">${t.events
    .map((e) => `<li class="${e.kind}"><span class="hd">${esc(e.date)}</span><span class="hl">${esc(e.label)}</span></li>`)
    .join("")}</ol>`;
}

// ---------- system level (C4 "context"): the app, who uses it, what it talks to ----------

export function systemSvg(map: ArchitectureMap, model: DataModel, repo: string): string {
  const services = map.services.filter((s) => s.usedBy.length);
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: "LR", nodesep: 26, ranksep: 90, marginx: 24, marginy: 24 });
  g.setDefaultEdgeLabel(() => ({}));
  const W = 210, H = 64;
  g.setNode("user", { width: 150, height: H });
  g.setNode("app", { width: W + 30, height: H + 20 });
  g.setEdge("user", "app");
  if (model.entities.length) { g.setNode("data", { width: W, height: H }); g.setEdge("app", "data"); }
  for (const s of services) { g.setNode(s.id, { width: W, height: H }); g.setEdge("app", s.id); }
  dagre.layout(g);
  const { width = 600, height = 300 } = g.graph() as { width?: number; height?: number };
  const box = (id: string) => g.node(id) as { x: number; y: number; width: number; height: number };
  const edge = (a: string, b: string, cls = "edge") => `<path class="${cls}" d="${basis((g.edge(a, b) as { points: { x: number; y: number }[] }).points)}" marker-end="url(#arrow-s)"/>`;
  const totalFiles = map.nodes.reduce((n, x) => n + x.files, 0);
  const node = (id: string, cls: string, title: string, sub: string, rx = 12) => {
    const b = box(id);
    return `<g class="${cls}" data-id="${id}" transform="translate(${f(b.x - b.width / 2)},${f(b.y - b.height / 2)})"><rect width="${b.width}" height="${b.height}" rx="${rx}"/><text x="${b.width / 2}" y="${b.height / 2 - 3}" text-anchor="middle" class="nl">${esc(title)}</text><text x="${b.width / 2}" y="${b.height / 2 + 15}" text-anchor="middle" class="ns">${esc(sub)}</text></g>`;
  };
  return `<svg class="arch system" viewBox="0 0 ${Math.ceil(width)} ${Math.ceil(height)}" data-w="${Math.ceil(width)}" data-h="${Math.ceil(height)}" style="width:100%;max-width:${Math.ceil(width)}px" role="img" aria-label="System context">
    <defs><marker id="arrow-s" viewBox="0 0 10 10" refX="9" refY="5" markerUnits="userSpaceOnUse" markerWidth="9" markerHeight="9" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z"/></marker></defs>
    ${edge("user", "app")}${model.entities.length ? edge("app", "data") : ""}${services.map((s) => edge("app", s.id, "edge svc")).join("")}
    ${node("user", "actor-node", "People using it", "browser · API clients", 32)}
    ${node("app", "node app-node", repo, `${map.nodes.length} modules · ${totalFiles} files`)}
    ${model.entities.length ? node("data", "data-node", "Data", `${model.entities.length} ${model.source === "typescript" ? "domain types" : "entities"}`) : ""}
    ${services.map((s) => node(s.id, "svc-node", s.name, s.sdk ? s.category : `${s.category} · no SDK`, 32)).join("")}
  </svg>`;
}

// ---------- data for the interactive explorer ----------

export interface ExplorerData {
  modules: Record<string, { label: string; dir: string; files: number; lines: number; topFiles: { path: string; importers: number }[]; docs: { title: string; href: string }[]; attention: number }>;
  edges: { from: string; to: string; imports: number }[];
  services: { id: string; name: string; usedBy: string[] }[];
  flows: { title: string; href: string; steps: { module: string | null; label: string; file: string; line?: number }[] }[];
}

export function explorerData(
  map: ArchitectureMap,
  analysis: { files: { path: string; lines: number }[]; imports: { resolved: string | null; from: string }[] },
  docItems: { doc: string; section: string; id: string; title: string; evidence: { path: string; line?: number; symbol?: string; note?: string; kind?: string }[] }[],
  attentionKeys: Set<string>,
): ExplorerData {
  // Longest folder prefix wins; "(root)"/"(other)" catch the rest.
  const dirs = map.nodes.filter((n) => n.dir && !n.label.startsWith("(")).sort((a, b) => b.dir.length - a.dir.length);
  const fallback = map.nodes.find((n) => n.label === "(other)") ?? map.nodes.find((n) => n.label === "(root)");
  const moduleOf = (file: string) => dirs.find((n) => file.startsWith(`${n.dir}/`))?.id ?? fallback?.id ?? null;
  const importers = new Map<string, number>();
  for (const e of analysis.imports) if (e.resolved) importers.set(e.resolved, (importers.get(e.resolved) ?? 0) + 1);
  const modules: ExplorerData["modules"] = {};
  for (const n of map.nodes) modules[n.id] = { label: n.label, dir: n.dir, files: n.files, lines: n.lines, topFiles: [], docs: [], attention: 0 };
  for (const file of analysis.files) {
    const m = moduleOf(file.path);
    if (m && modules[m]) modules[m]!.topFiles.push({ path: file.path, importers: importers.get(file.path) ?? 0 });
  }
  for (const m of Object.values(modules)) m.topFiles = m.topFiles.sort((a, b) => b.importers - a.importers || a.path.localeCompare(b.path)).slice(0, 8);
  const flows: ExplorerData["flows"] = [];
  for (const item of docItems) {
    const key = `${item.doc}/${item.section}/${item.id}`;
    const touched = new Set(item.evidence.filter((e) => e.kind !== "dir").map((e) => moduleOf(e.path)).filter((x): x is string => Boolean(x)));
    for (const m of touched) {
      modules[m]?.docs.push({ title: item.title.replace(/`/g, ""), href: `/doc/${item.doc}#${item.id}` });
      if (attentionKeys.has(key) && modules[m]) modules[m]!.attention++;
    }
    if (item.section === "flows") {
      flows.push({
        title: item.title.replace(/`/g, ""),
        href: `/doc/${item.doc}#${item.id}`,
        steps: item.evidence.filter((e) => e.kind !== "dir").map((e) => ({ module: moduleOf(e.path), label: e.symbol ?? e.note ?? e.path.split("/").pop()!, file: e.path, line: e.line })),
      });
    }
  }
  return { modules, edges: map.edges, services: map.services.map((s) => ({ id: s.id, name: s.name, usedBy: s.usedBy })), flows };
}

/** The explorer shell: toolbar, both zoom levels, the focus panel and the flow caption. */
export function explorerHtml(map: ArchitectureMap, model: DataModel, repo: string, data: ExplorerData): string {
  const flowOptions = data.flows.map((fl, i) => `<option value="${i}">${esc(fl.title)}</option>`).join("");
  return `<div class="map-explorer" id="map-explorer" data-level="modules">
    <div class="mx-toolbar">
      <span class="mx-lbl">View</span><div class="seg" role="group" aria-label="Zoom level"><button type="button" data-level="system" aria-pressed="false" title="The app, who uses it and what it talks to">System</button><button type="button" data-level="modules" aria-pressed="true" title="The modules inside the app and how they depend on each other">Modules</button></div>
      <span class="mx-lbl mx-lenses">Colour by</span><div class="seg mx-lenses" role="group" aria-label="Colour by"><button type="button" data-lens="structure" aria-pressed="true" title="No colouring">None</button><button type="button" data-lens="size" aria-pressed="false" title="Lines of code">Size</button><button type="button" data-lens="docs" aria-pressed="false" title="How many doc items cite each module">Doc coverage</button><button type="button" data-lens="attention" aria-pressed="false" title="Doc items that are out of date">Needs attention</button></div>
      ${data.flows.length ? `<select class="mx-flow" aria-label="Walk through a flow"><option value="">▶ Walk through a flow…</option>${flowOptions}</select>` : ""}
      <input class="mx-search" type="search" placeholder="Find a module" aria-label="Find a module">
      <span class="mx-spacer"></span>
      <button type="button" class="btn ghost mx-reset" hidden title="Back to the plain map">Reset view</button>
      <div class="seg mx-zoom" role="group" aria-label="Zoom"><button type="button" data-zoom="out" title="Zoom out (−)">−</button><button type="button" data-zoom="fit" title="Fit (0)">Fit</button><button type="button" data-zoom="in" title="Zoom in (+)">+</button></div>
      <button type="button" class="btn mx-expand" title="Full screen (F)">Expand</button>
    </div>
    <div class="mx-state" hidden></div>
    <div class="mx-guide" aria-live="polite"></div>
    <div class="mx-caption" hidden aria-live="polite"></div>
    <div class="mx-body">
      <div class="mx-stage">
        <div class="mx-level" data-for="modules">${architectureSvg(map)}</div>
        <div class="mx-level" data-for="system" hidden><div class="diagram-scroll">${systemSvg(map, model, repo)}</div></div>
      </div>
      <aside class="mx-panel" hidden></aside>
    </div>
    <div class="mx-legend"></div>
  </div>
  <script type="application/json" id="map-data">${JSON.stringify(data).replace(/</g, "\\u003c")}</script>`;
}
