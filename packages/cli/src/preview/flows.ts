import type { AudienceId, EntryMap, Item, Route, RouteKind, Story, StoryStep, Trace, TraceStep } from "@houserules/core";

// Entry points and traces: every way into the app, and what runs when you hit one.

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const q = (o: Record<string, string>) => new URLSearchParams(o).toString();

export const KIND_LABEL: Record<RouteKind, [string, string]> = {
  page: ["Page", "Pages"],
  screen: ["Screen", "Screens"],
  api: ["API", "API endpoints"],
  action: ["Server action", "Server actions"],
  webhook: ["Webhook", "Webhooks"],
  job: ["Job", "Scheduled & background jobs"],
  middleware: ["Middleware", "Middleware"],
};

export const traceHref = (r: Route) => `/trace?${q({ id: r.id })}`;

const isFramework = (s: TraceStep) => s.external?.category === "framework";
const services = (t: Trace) => t.steps.filter((s) => s.external && !isFramework(s)).map((s) => s.name);
const uniq = <T,>(xs: T[]) => [...new Set(xs)];

function srcLink(file: string, line: number | undefined, label: string, citedBy: string, cls = "src"): string {
  return `<a class="${cls}" href="/source?${q({ path: file, ...(line ? { line: String(line) } : {}) })}" data-path="${esc(file)}"${line ? ` data-line="${line}"` : ""} data-item="${esc(citedBy.slice(0, 70))}" title="${esc(`${file}${line ? `:${line}` : ""}`)}">${label}</a>`;
}

const AUD_TONE: Record<AudienceId, string> = { customers: "accent", staff: "ask", anyone: "ok", website: "muted", systems: "warn", automatic: "faint" };

/** The story to suggest first: a short, certain one that a signed-in user or visitor triggers, in a busy area. */
function startStory(m: EntryMap): Story | undefined {
  const size = new Map(m.areas.map((a) => [a.id, a.count]));
  const score = (s: Story) => {
    const code = s.steps.filter((x) => x.kind !== "guard").length;
    // Sign-in plumbing is the same everywhere; a newcomer learns more from what the product itself does.
    const plumbing = /log ?in|log ?out|password|token|social|verif|register|sign ?(in|up)|oauth|session/i.test(s.title) ? 12 : 0;
    return (code >= 3 && code <= 5 ? 10 : 0) + code + s.services.length * 2 - s.steps.filter((x) => x.guess).length - plumbing + (size.get(s.area) ?? 0) / 100 + (s.audience === "customers" ? 3 : 0);
  };
  return [...m.stories.values()].filter((s) => s.audience === "customers" || s.audience === "anyone" || s.audience === "website").sort((a, b) => score(b) - score(a))[0];
}

/**
 * Entry points as a picture and as stories: who comes in → which area they reach → what that touches, then
 * what each way in does, in plain steps. Simplified and Expert are two views of the same page, picked by tabs.
 */
export function entryMapHtml(m: EntryMap, routes: Route[]): string {
  if (!m.stories.size) return `<p class="muted">No entry points found. houserules recognises Next.js, Expo Router, Django, Spring, Laravel, Symfony, NestJS, Express, Fastify, Hono and Koa routes, plus scheduled and queued jobs.</p>`;
  const route = new Map(routes.map((r) => [r.id, r]));
  const start = startStory(m);
  const first = start?.area ?? m.areas[0]!.id;
  const journey = m.areas.some((a) => a.order != null);
  const areaTitle = new Map(m.areas.map((a) => [a.id, a.title]));

  // ----- the map -----
  const W = 1060, WHO_W = 214, WHO_H = 58, AREA_W = 236, AREA_H = 38, SVC_W = 196, SVC_H = 48;
  const services = m.services.slice(0, 9);
  const H = Math.max(m.audiences.length * (WHO_H + 20), m.areas.length * (AREA_H + 9), services.length * (SVC_H + 14)) + 10;
  const ys = (n: number, h: number, gap: number) => { const tot = n * h + (n - 1) * gap; return Array.from({ length: n }, (_, i) => (H - tot) / 2 + i * (h + gap)); };
  const yWho = ys(m.audiences.length, WHO_H, 20), yArea = ys(m.areas.length, AREA_H, 9), ySvc = ys(services.length, SVC_H, 14);
  const X2 = (W - AREA_W) / 2, X3 = W - SVC_W;
  const iWho = new Map(m.audiences.map((a, i) => [a.id, i])), iArea = new Map(m.areas.map((a, i) => [a.id, i]));
  const max = Math.max(...m.links.map((l) => l.count), 1);
  const curve = (x1: number, y1: number, x2: number, y2: number) => { const mx = (x1 + x2) / 2; return `M${x1} ${y1.toFixed(1)}C${mx} ${y1.toFixed(1)} ${mx} ${y2.toFixed(1)} ${x2} ${y2.toFixed(1)}`; };
  const links = [
    ...m.links.filter((l) => iWho.has(l.from) && iArea.has(l.to)).map((l) => `<path class="em-link" data-area="${esc(l.to)}" data-aud="${l.from}" d="${curve(WHO_W, yWho[iWho.get(l.from)!]! + WHO_H / 2, X2, yArea[iArea.get(l.to)!]! + AREA_H / 2)}" stroke-width="${Math.max(1.5, Math.min(16, (l.count / max) * 16)).toFixed(1)}"><title>${esc(`${l.count} from ${m.audiences.find((a) => a.id === l.from)!.label} into ${areaTitle.get(l.to)}`)}</title></path>`),
    ...services.flatMap((sv, si) => sv.areas.filter((a) => iArea.has(a)).map((a) => `<path class="em-link em-link-svc" data-area="${esc(a)}" data-svc="${esc(sv.id)}" d="${curve(X2 + AREA_W, yArea[iArea.get(a)!]! + AREA_H / 2, X3, ySvc[si]! + SVC_H / 2)}" stroke-width="2.2"/>`)),
  ].join("");
  const node = (cls: string, x: number, y: number, w: number, h: number, attrs: string, body: string) =>
    `<g class="${cls}" ${attrs} transform="translate(${x.toFixed(1)} ${y.toFixed(1)})" tabindex="0" role="button"><rect width="${w}" height="${h}" rx="9"/>${body}</g>`;
  const whoNodes = m.audiences.map((a, i) => node("em-who", 0, yWho[i]!, WHO_W, WHO_H, `data-aud="${a.id}" aria-label="${esc(`${a.label}: ${a.count}`)}"`, `<circle class="tone-${AUD_TONE[a.id]}" cx="16" cy="22" r="4"/><text x="28" y="26" class="em-n">${esc(a.label)} <tspan class="em-c">${a.count}</tspan></text><text x="16" y="44" class="em-s">${esc(a.blurb)}</text>`)).join("");
  const areaNodes = m.areas.map((a, i) => node("em-areanode", X2, yArea[i]!, AREA_W, AREA_H, `data-area="${esc(a.id)}" aria-label="${esc(`${a.title}: ${a.count}`)}"`, `${journey && a.order != null ? `<text x="14" y="24" class="em-step">${a.order}</text>` : ""}<text x="${journey && a.order != null ? 30 : 14}" y="24" class="em-n">${esc(a.title)}</text><text x="${AREA_W - 12}" y="24" class="em-c" text-anchor="end">${a.count}</text>`)).join("");
  const svcNodes = services.map((sv, i) => node("em-svc", X3, ySvc[i]!, SVC_W, SVC_H, `data-svc="${esc(sv.id)}" data-areas="${esc(sv.areas.join(" "))}" data-tip="${esc(`${sv.name} · ${SERVICE_WORDS[sv.category] ?? sv.category}. Used by ${sv.areas.map((a) => areaTitle.get(a) ?? a).join(", ")}.`)}"`, `<text x="14" y="21" class="em-n">${esc(sv.name)}</text><text x="14" y="38" class="em-s">${esc(SERVICE_WORDS[sv.category] ?? sv.category)}</text>`)).join("");
  const more = m.services.length - services.length;
  const svg = `<svg class="em-map" viewBox="0 0 ${W} ${H}" role="img" aria-label="Who comes in, which areas they reach, and the outside services those areas use">${links}${whoNodes}${areaNodes}${svcNodes}</svg>`;

  // ----- stories -----
  const stepHtml = (st: StoryStep) =>
    `<li class="em-st k-${st.kind}${st.guess ? " guess" : ""}" title="${esc(`${st.code}${st.file ? ` · ${st.file}${st.line ? `:${st.line}` : ""}` : ""}${st.guess ? " · matched by name only: a best guess" : ""}`)}">${st.when ? `<b>${esc(st.when)}:</b> ` : ""}${esc(st.label)}</li>`;
  const codeHtml = (st: StoryStep) => (st.file ? srcLink(st.file, st.line, `${esc(st.code)}${st.line ? `<i>:${st.line}</i>` : ""}`, st.label, "em-code-step") : `<span class="em-code-step${st.kind === "guard" ? " g" : ""}">${esc(st.code)}</span>`);
  const story = (s: Story) => {
    const r = route.get(s.id)!;
    const aud = m.audiences.find((a) => a.id === s.audience)!;
    const where = `${r.methods ? `${r.methods.join(" ")} ` : ""}${r.path}`;
    const shares = s.shares ? `<span class="em-share">Shares <code>${esc(s.shares.code)}</code> with ${s.shares.with.slice(0, 2).map((id) => `<a href="#" data-goto="${esc(id)}">${esc(m.stories.get(id)?.title ?? id)}</a>`).join(", ")}${s.shares.with.length > 2 ? ` +${s.shares.with.length - 2}` : ""}</span>` : "";
    return `<article class="em-story" id="ep-${esc(s.id)}" data-id="${esc(s.id)}" data-area="${esc(s.area)}" data-aud="${s.audience}" data-q="${esc(`${s.title} ${where} ${r.name ?? ""} ${r.handler} ${r.file}`.toLowerCase())}">
      <div class="em-top"><h3><a href="${traceHref(r)}">${esc(s.title)}</a></h3><span class="em-pill"><i class="tone-${AUD_TONE[s.audience]}"></i>${esc(aud.label)}</span><span class="em-area-tag">in ${esc(areaTitle.get(s.area) ?? s.area)}</span><a class="em-go" href="${traceHref(r)}"><span class="only-simple">Walk through it</span><span class="only-expert">Trace</span> ›</a></div>
      ${s.steps.length ? `<ol class="em-steps">${s.steps.map(stepHtml).join("")}${s.more ? `<li class="em-st more">+${s.more} more</li>` : ""}</ol>` : `<p class="em-none">Not traced yet: houserules couldn't follow this one into the code.</p>`}
      <div class="em-code only-expert">${s.steps.map(codeHtml).join('<span class="em-sep">›</span>')}</div>
      <div class="em-meta"><code>${esc(where)}</code><span class="only-expert"><code>${esc(r.handler)}</code>${r.name ? ` · <code>${esc(r.name)}</code>` : ""}</span>${s.services.length ? `<span class="em-svcs">→ ${esc(s.services.join(", "))}</span>` : ""}${shares}</div>
    </article>`;
  };
  // Within an area: the people the product is for first, then back office and automation; richer stories first.
  const audOrder = ["customers", "anyone", "website", "systems", "staff", "automatic"];
  const codeSteps = (s: Story) => s.steps.filter((x) => x.kind !== "guard").length;
  const stories = [...m.stories.values()].sort((a, b) => audOrder.indexOf(a.audience) - audOrder.indexOf(b.audience) || codeSteps(b) - codeSteps(a) || a.title.localeCompare(b.title));
  const row = (s: Story) => {
    const r = route.get(s.id)!;
    return `<tr data-id="${esc(s.id)}" data-area="${esc(s.area)}" data-aud="${s.audience}" data-q="${esc(`${s.title} ${r.path} ${r.name ?? ""} ${r.handler}`.toLowerCase())}"><td>${esc(s.title)}</td><td class="m">${esc(r.methods?.join(" ") ?? (r.kind === "job" ? "JOB" : r.kind.toUpperCase()))}</td><td><code>${esc(r.path)}</code></td><td><code>${esc(r.name ?? "")}</code></td><td>${esc(m.audiences.find((a) => a.id === s.audience)!.label)}</td><td>${srcLink(r.handlerFile ?? r.file, r.handlerFile ? undefined : r.line, `<code>${esc(r.handler)}</code>`, s.title)}</td><td class="n">${s.steps.length}</td><td><a href="${traceHref(r)}">Trace</a></td></tr>`;
  };
  const chips = (area: string) => {
    const here = stories.filter((s) => s.area === area);
    return [`<button type="button" class="em-chip" data-aud="" aria-pressed="true">Everyone <span>${here.length}</span></button>`, ...m.audiences.filter((a) => here.some((s) => s.audience === a.id)).map((a) => `<button type="button" class="em-chip" data-aud="${a.id}" aria-pressed="false"><i class="tone-${AUD_TONE[a.id]}"></i>${esc(a.label)} <span>${here.filter((s) => s.audience === a.id).length}</span></button>`)].join("");
  };
  const counts = m.audiences.map((a) => `${esc(a.label)} ${a.count}`).join(" · ");
  const firstArea = m.areas.find((a) => a.id === first)!;

  return `<div class="em" data-view="simple" data-area="${esc(first)}">
    <div class="em-tabs" role="tablist" aria-label="View">
      <button type="button" role="tab" class="em-tab" data-view="simple" aria-selected="true"><b>Simplified</b><span>The big picture, in plain words</span></button>
      <button type="button" role="tab" class="em-tab" data-view="expert" aria-selected="false"><b>Expert</b><span>Code names, branches, table</span></button>
    </div>
    ${start ? `<div class="em-start only-simple"><b>New here?</b> <span>Start with <a href="#" data-goto="${esc(start.id)}">${esc(start.title)}</a>: it's short, and a good first look at ${/^(other|general|home)$/.test(start.area) ? "the code" : `the ${esc((areaTitle.get(start.area) ?? start.area).toLowerCase())} area`}. Then pick any area on the map.</span><button type="button" class="em-hide" aria-label="Hide">Hide</button></div>` : ""}
    <div class="em-strip only-expert"><b>Map</b><span>${routes.filter((r) => r.kind !== "middleware").length} entry points · ${counts}</span><button type="button" class="em-mapbtn">Show map</button></div>
    <div class="em-card">
      <div class="em-cols"><span>Who comes in</span><span>Where they go${journey ? " · in customer-journey order" : ""}</span><span>What it touches</span></div>
      <div class="em-svgwrap">${svg}<div class="em-tip" hidden></div></div>
      <p class="em-legend">Line thickness = how many ways in. Click an area to see what each way in does${journey ? "; numbers follow a customer through the app" : ""}.${more > 0 ? ` ${more} more outside service${more === 1 ? "" : "s"} not shown.` : ""}</p>
    </div>
    <section class="em-detail" aria-live="polite">
      <div class="em-head">
        <div><div class="em-eyebrow">${journey && firstArea.order != null ? `Step ${firstArea.order} of the customer journey` : "Area"}</div><h3 class="em-title">${esc(firstArea.title)} <span>${firstArea.count} ways in</span></h3><p class="em-blurb">${esc(firstArea.blurb ?? "")}</p></div>
        <input class="em-search" type="search" placeholder="Search everything: what it does, URL, class…" aria-label="Search entry points">
        <div class="em-mode only-expert" role="group" aria-label="Layout"><button type="button" data-mode="stories" aria-pressed="true">Stories</button><button type="button" data-mode="table" aria-pressed="false">Table</button></div>
      </div>
      <div class="em-chips" role="group" aria-label="Who">${chips(first)}</div>
      <div class="em-list">${stories.map(story).join("")}</div>
      <table class="em-table" hidden><thead><tr><th>Action</th><th></th><th>URL / trigger</th><th>Route name</th><th>Who</th><th>Handler</th><th>Steps</th><th></th></tr></thead><tbody>${stories.map(row).join("")}</tbody></table>
      <p class="em-empty faint" hidden>Nothing matches.</p>
      <p class="em-key"><span class="k-guard">Who's allowed</span><span class="k-job">Runs later, in the background</span><span class="k-service">Outside service</span><span class="guess">Best guess, matched by name</span></p>
    </section>
    <script type="application/json" class="em-areas">${JSON.stringify(m.areas.map((a) => ({ id: a.id, title: a.title, blurb: a.blurb ?? "", count: a.count, order: journey ? a.order ?? null : null, chips: chips(a.id) }))).replace(/</g, "\\u003c")}</script>
  </div>`;
}

const SERVICE_WORDS: Record<string, string> = { payments: "payments", cloud: "cloud", ai: "AI", messaging: "messages and support", email: "email", observability: "monitoring", database: "database", cache: "cache", queue: "queue", auth: "sign-in", storage: "file storage", search: "search", "http-client": "HTTP", service: "outside API" };

/** Steps shown as rows: framework APIs fold into the step that calls them, as chips. */
function visibleSteps(t: Trace): { step: TraceStep; i: number; apis: TraceStep[] }[] {
  const out: { step: TraceStep; i: number; apis: TraceStep[] }[] = [];
  const byIndex = new Map<number, { step: TraceStep; i: number; apis: TraceStep[] }>();
  t.steps.forEach((s, i) => {
    if (isFramework(s)) {
      const parent = s.parent != null ? byIndex.get(s.parent) : undefined;
      if (parent && !parent.apis.some((a) => a.name === s.name)) parent.apis.push(s);
      return;
    }
    const row = { step: s, i, apis: [] as TraceStep[] };
    byIndex.set(i, row);
    out.push(row);
  });
  return out;
}

/** A sequence diagram: one lane per file (and per outside service), one arrow per call, top to bottom. */
function sequenceSvg(t: Trace, rows: { step: TraceStep; i: number }[]): string {
  const laneOf = (s: TraceStep) => s.file ?? `ext:${s.name}`;
  const all = uniq(rows.map((r) => laneOf(r.step)));
  const lanes = all.filter((l) => !l.startsWith("ext:")).concat(all.filter((l) => l.startsWith("ext:"))); // outside services on the right
  if (lanes.length < 2 && rows.length < 2) return "";
  const LW = 168, TOP = 64, ROW = 36, PAD = 20;
  const x = (lane: string) => PAD + lanes.indexOf(lane) * LW + LW / 2;
  const width = PAD * 2 + lanes.length * LW;
  const height = TOP + rows.length * ROW + 24;
  const head = lanes
    .map((l) => {
      const ext = l.startsWith("ext:");
      const name = ext ? l.slice(4) : l.split("/").pop()!;
      const dir = ext ? "outside service" : l.split("/").slice(0, -1).slice(-2).join("/") || "/";
      return `<g class="lane${ext ? " ext" : ""}"><rect x="${x(l) - LW / 2 + 8}" y="8" width="${LW - 16}" height="40" rx="${ext ? 20 : 8}"/><text x="${x(l)}" y="25" text-anchor="middle" class="ln1">${esc(name.length > 22 ? `${name.slice(0, 21)}…` : name)}</text><text x="${x(l)}" y="40" text-anchor="middle" class="ln2">${esc(dir.length > 24 ? `…${dir.slice(-23)}` : dir)}</text></g><line class="life" x1="${x(l)}" y1="48" x2="${x(l)}" y2="${height - 8}"/>`;
    })
    .join("");
  const index = new Map(rows.map((r, n) => [r.i, n]));
  const arrows = rows
    .map((r, n) => {
      const s = r.step;
      const y = TOP + n * ROW + ROW / 2;
      const label = `${s.kind === "render" ? `<${s.name}>` : s.name}${s.repeat ? " ↺" : ""}`;
      if (s.parent == null || !index.has(s.parent)) {
        return `<g class="arrow start" data-i="${n}"><circle cx="${x(laneOf(s)) - 50}" cy="${y}" r="4"/><line x1="${x(laneOf(s)) - 46}" y1="${y}" x2="${x(laneOf(s)) - 4}" y2="${y}" marker-end="url(#seq-arrow)"/><text x="${x(laneOf(s)) + 8}" y="${y - 6}" class="al">${esc(label)}</text></g>`;
      }
      const from = laneOf(rows[index.get(s.parent)!]!.step), to = laneOf(s);
      if (from === to) {
        const xx = x(from);
        return `<g class="arrow self${s.via === "name" ? " guess" : ""}" data-i="${n}"><path d="M${xx} ${y - 8} h26 v14 h-22" marker-end="url(#seq-arrow)"/><text x="${xx + 32}" y="${y + 2}" class="al">${esc(label)}</text></g>`;
      }
      const x1 = x(from), x2 = x(to), dir = x2 > x1 ? 1 : -1;
      return `<g class="arrow${s.via === "name" ? " guess" : ""}${s.external ? " ext" : ""}" data-i="${n}"><line x1="${x1}" y1="${y}" x2="${x2 - dir * 4}" y2="${y}" marker-end="url(#seq-arrow)"/><text x="${(x1 + x2) / 2}" y="${y - 6}" text-anchor="middle" class="al">${esc(label)}</text></g>`;
    })
    .join("");
  return `<div class="seq-scroll"><svg class="seq" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="Sequence diagram">
    <defs><marker id="seq-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerUnits="userSpaceOnUse" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z"/></marker></defs>
    ${head}${arrows}</svg></div>`;
}

/** The trace page for one entry point: summary, step tree with walkthrough, and a sequence diagram. */
/** "Order.removeCredit" → "Remove credit"; "Order.skip" → "Skip order"; components and classes as written. */
function stepLabel(s: TraceStep): string {
  if (s.external) return s.name.split(" · ").pop()!;
  const [cls = "", method] = s.name.split(".");
  const words = (x: string) => x.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").toLowerCase().split(" ").filter(Boolean);
  if (!method || method === "__invoke" || method === "handle") return s.kind === "render" ? `Render ${cls}` : s.kind === "new" ? `Create ${words(cls).join(" ")}` : `Run ${words(cls).join(" ")}`;
  const w = words(method);
  // A factory's member reads as the thing it makes: createOrderController.show → "Show order controller".
  const text = w.length === 1 ? `${w[0]} ${words(cls.replace(/^(create|make|build|new)(?=[A-Z])/, "")).join(" ")}` : w.join(" ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export interface TraceStory {
  title: string;
  area: string;
  audience: string;
  guards: { label: string; code: string }[];
  summary: string[]; // plain labels of what it does
}

export function tracePageHtml(route: Route, trace: Trace | undefined, documented: Item | undefined, renderMd: (s: string) => string, story?: TraceStory): string {
  const rows = trace ? visibleSteps(trace) : [];
  const apis = trace ? uniq(trace.steps.filter(isFramework).map((s) => s.name)) : [];
  const svc = trace ? uniq(services(trace)) : [];
  const guesses = rows.filter((r) => r.step.via === "name").length;
  const title = `${route.methods ? `${route.methods.join(" ")} ` : ""}${route.path}`;
  const guardRows = (story?.guards ?? []).map((g) => `<li class="tstep guard" style="--d:0"><span class="tn"></span><div class="tb"><div class="tl">${esc(g.label)}</div><div class="tcodeline"><code>${esc(g.code)}</code></div></div></li>`).join("");
  const stepRows = rows
    .map((r, n) => {
      const s = r.step;
      const name = s.kind === "render" ? `&lt;${esc(s.name)}&gt;` : esc(s.name);
      const where = s.file ? srcLink(s.file, s.line, `${esc(s.file.split("/").pop()!)}:${s.line}`, title, "src tloc") : `<span class="tloc ext">outside service</span>`;
      return `<li class="tstep${s.repeat ? " repeat" : ""}${s.external ? " ext" : ""}" data-i="${n}" data-path="${esc(s.file ?? "")}" data-line="${s.line ?? ""}" data-end="${s.endLine ?? ""}" style="--d:${s.depth}">
        <span class="tn">${n + 1}</span>
        <div class="tb"><div class="tl">${esc(stepLabel(s))}${s.via === "name" ? ` <span class="tguess" title="Linked by method name, not by an import: probably right, worth checking">best guess</span>` : ""}${s.cond ? ` <span class="tcond">only sometimes</span>` : ""}${s.repeat ? ` <span class="faint">(shown above)</span>` : ""}</div>
        <div class="tcodeline"><code>${name}</code> ${where}</div>
        ${r.apis.length ? `<div class="tapis">${r.apis.map((a) => `<span class="tapi" data-api="${esc(a.name)}" title="${esc(a.name)}"><code>${esc(a.name.split(" · ").pop()!)}</code> <span>${esc(a.name.split(" · ")[0]!)}</span></span>`).join("")}</div>` : ""}</div>
      </li>`;
    })
    .join("");
  const facts = [`${rows.filter((r) => !r.step.repeat).length} steps`, `${trace?.files.length ?? 0} files`, ...(svc.length ? [`reaches ${svc.join(", ")}`] : [])];
  return `<main class="page page-wide"><article class="reading full trace-page">
    <a class="back" href="/diagrams#ep-${encodeURIComponent(route.id)}">← How work gets in</a>
    <div class="eyebrow">${story ? `${esc(story.area)} · ${esc(story.audience)}` : KIND_LABEL[route.kind][0]}</div>
    <h1 class="trace-title">${story ? esc(story.title) : `${route.methods ? `<span class="ep-method">${esc(route.methods.join(" "))}</span> ` : ""}<code>${esc(route.path)}</code>`}</h1>
    ${story?.summary.length ? `<p class="lede">${story.summary.map(esc).join(" → ")}</p>` : ""}
    <p class="trace-meta"><code>${esc(title)}</code><span>${srcLink(route.file, route.line, `<code>${esc(route.handler)}</code>`, title, "src inline")}</span>${facts.map((f) => `<span>${esc(f)}</span>`).join("")}</p>
    ${documented ? `<div class="trace-doc"><div class="eyebrow">What the docs say</div><h3>${renderMd(documented.title)}</h3>${renderMd(documented.body)}</div>` : ""}
    ${
      rows.length
        ? `<div class="twalk"><button type="button" class="btn" data-tw="prev">‹ Back</button><button type="button" class="btn primary" data-tw="next">Next step ›</button><button type="button" class="btn" data-tw="play">▶ Play</button><label class="tw-guess"><input type="checkbox" class="tw-guess-on"> Guess each step first</label><span class="twalk-pos faint"></span></div>
      <div class="tguess-box" hidden></div>
      <div class="tcols"><ol class="tsteps">${guardRows}${stepRows}</ol>
        <aside class="tcode" aria-live="polite"><div class="tcode-head"><span class="tcode-path">Pick a step to see its code</span><a class="tcode-full" href="#" hidden>Open full file ›</a></div><div class="tcode-body"></div><div class="tcode-note" hidden></div></aside></div>
      ${trace?.truncated ? `<p class="faint">Stopped after ${trace.steps.length} steps or 6 levels deep. Open the last steps' code to keep going.</p>` : ""}
      <section class="doc-section"><h2>Sequence diagram</h2><p class="section-intro">Each column is a file or an outside service; each arrow is a call, top to bottom.</p>${sequenceSvg(trace!, rows)}</section>`
        : `<p class="muted">Couldn't find <code>${esc(route.handler)}</code> in the call graph, so there's nothing to trace yet. Open the handler to read it directly.</p>`
    }
    ${apis.length ? `<section class="doc-section"><h2>Framework APIs used</h2><p class="section-intro">Everything from the framework this entry point touches, linked to the latest official docs. These are the parts worth reading.</p><div class="stack-note faint" hidden></div><div class="tapis wide">${apis.map((a) => `<span class="tapi" data-api="${esc(a)}"><code>${esc(a.split(" · ").pop()!)}</code> <span>${esc(a.split(" · ")[0]!)}</span></span>`).join("")}</div></section>` : ""}
    <p class="faint trace-note">Traced from the code's imports and calls without running it${guesses ? `; ${guesses} step${guesses === 1 ? " is" : "s are"} linked by method name and marked "best guess"` : ""}. Calls made dynamically (callbacks, dependency injection, events) may be missing.</p>
  </article></main>`;
}
