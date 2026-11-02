import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Analysis, Integration } from "../types.js";
import type { Route } from "./routes.js";
import type { Trace, TraceStep } from "./trace.js";

// The Entry points page in plain words: who comes in, which area of the app they reach, what that touches, and
// what each way in does as a short story. Everything here is derived from routes and traces; an agent can add
// friendlier area names, a customer-journey order and titles (see EntryOverrides), never facts.

export type AudienceId = "customers" | "staff" | "anyone" | "website" | "systems" | "automatic";

export const AUDIENCES: { id: AudienceId; label: string; blurb: string }[] = [
  { id: "customers", label: "Signed-in users", blurb: "Customers and members with an account" },
  { id: "staff", label: "Staff", blurb: "Admin and back office" },
  { id: "anyone", label: "Anyone", blurb: "No account needed" },
  { id: "website", label: "Website pages", blurb: "Pages people open in a browser" },
  { id: "systems", label: "Other systems", blurb: "Services calling in: webhooks, integrations" },
  { id: "automatic", label: "Schedules & queues", blurb: "Runs on its own" },
];

export interface StoryStep {
  label: string; // plain words: "Remove credit"
  code: string; // what it is in the code: "Order.removeCredit", "can:update,order"
  kind: "guard" | "code" | "job" | "service" | "framework";
  file?: string;
  line?: number;
  guess?: boolean; // matched by name only: not certain
  when?: string; // only runs sometimes: "If requires payment", "Otherwise", "Depending on status"
}

export interface Story {
  id: string; // route id
  title: string;
  audience: AudienceId;
  area: string; // area id
  steps: StoryStep[];
  more: number; // steps left out
  services: string[]; // outside services this way in reaches
  shares?: { code: string; with: string[] }; // non-trivial code it shares with other ways in (their route ids)
}

export interface Area {
  id: string;
  title: string;
  blurb?: string;
  order?: number; // position in the customer journey, when an agent has described it
  count: number;
}

export interface EntryMap {
  audiences: { id: AudienceId; label: string; blurb: string; count: number }[];
  areas: Area[];
  services: { id: string; name: string; category: string; areas: string[] }[];
  links: { from: AudienceId; to: string; count: number }[];
  stories: Map<string, Story>;
}

/** What an agent can add: friendlier area names and blurbs, the customer-journey order, and route titles. */
export interface EntryOverrides {
  areas?: Record<string, { title?: string; blurb?: string; order?: number }>;
  titles?: Record<string, string>; // route id -> title
}

export function buildEntryMap(routes: Route[], traces: Map<string, Trace>, analysis: Analysis, overrides: EntryOverrides = {}): EntryMap {
  const clientDirs = ownClientDirs(analysis.integrations);
  const stories = new Map<string, Story>();
  for (const r of routes) {
    if (r.kind === "middleware") continue;
    const t = traces.get(r.id);
    const steps = t ? storySteps(r, t, clientDirs) : guardSteps(r);
    const shown = steps.slice(0, MAX_STEPS);
    stories.set(r.id, {
      id: r.id,
      title: overrides.titles?.[r.id] ?? routeTitle(r),
      audience: audienceOf(r),
      area: areaOf(r),
      steps: shown,
      more: steps.length - shown.length,
      services: t ? reachedServices(t, clientDirs) : [],
    });
  }
  markShared(stories, traces);

  // Areas: biggest first unless an agent gave the journey order; small ones fold into "Other".
  const counts = new Map<string, number>();
  for (const s of stories.values()) counts.set(s.area, (counts.get(s.area) ?? 0) + 1);
  let areaIds = [...counts.keys()];
  const ordered = (id: string) => overrides.areas?.[id]?.order;
  areaIds.sort((a, b) => (ordered(a) ?? 1e6) - (ordered(b) ?? 1e6) || counts.get(b)! - counts.get(a)! || a.localeCompare(b));
  if (areaIds.length > MAX_AREAS) {
    const keep = new Set(areaIds.slice(0, MAX_AREAS - 1));
    for (const s of stories.values()) if (!keep.has(s.area)) s.area = "other";
    counts.set("other", [...stories.values()].filter((s) => s.area === "other").length);
    areaIds = [...keep, "other"];
  }
  const areas = areaIds.map((id) => ({ id, title: overrides.areas?.[id]?.title ?? titleCase(id), ...(overrides.areas?.[id]?.blurb ? { blurb: overrides.areas[id]!.blurb } : {}), ...(ordered(id) != null ? { order: ordered(id) } : {}), count: counts.get(id) ?? 0 }));

  const links = new Map<string, number>();
  for (const s of stories.values()) links.set(`${s.audience}|${s.area}`, (links.get(`${s.audience}|${s.area}`) ?? 0) + 1);

  // Services: which areas use each one, from the files that use it (module folders, or the areas whose traces reach the file).
  const fileArea = new Map<string, Map<string, number>>();
  for (const s of stories.values()) for (const f of traces.get(s.id)?.files ?? []) {
    const m = fileArea.get(f) ?? new Map<string, number>();
    m.set(s.area, (m.get(s.area) ?? 0) + 1);
    fileArea.set(f, m);
  }
  const areaOfFile = (f: string): string | undefined => {
    const mod = moduleOf(f);
    if (mod && counts.has(mod)) return areaIds.includes(mod) ? mod : "other";
    const votes = fileArea.get(f);
    return votes ? [...votes].sort((a, b) => b[1] - a[1])[0]![0] : undefined;
  };
  const services = analysis.integrations
    .filter((i) => !HIDDEN_SERVICE.has(i.category))
    .map((i) => ({ id: i.id, name: i.name, category: i.category, areas: [...new Set(i.files.map(areaOfFile).filter((a): a is string => !!a))] }))
    .filter((s) => s.areas.length)
    .sort((a, b) => b.areas.length - a.areas.length || a.name.localeCompare(b.name));

  return {
    audiences: AUDIENCES.map((a) => ({ ...a, count: [...stories.values()].filter((s) => s.audience === a.id).length })).filter((a) => a.count),
    areas,
    services,
    links: [...links].map(([k, count]) => ({ from: k.split("|")[0] as AudienceId, to: k.split("|")[1]!, count })).sort((a, b) => b.count - a.count),
    stories,
  };
}

const MAX_STEPS = 6;
const MAX_AREAS = 12;
const HIDDEN_SERVICE = new Set(["observability", "http-client"]);

// ---------- who ----------

export function audienceOf(r: Route): AudienceId {
  if (r.kind === "job") return "automatic";
  const mw = (r.middleware ?? []).join(" ");
  if (r.kind === "webhook" || /\bverify\.\w+|webhook|\bsigned\b|client_credentials|csrf_exempt/i.test(mw)) return "systems";
  if (/auth:admin|ability:admin|role:(admin|staff)|is_?admin|VerifyAdmins?|\badmin\b/i.test(mw) || /^\/(api\/)?(v\d+\/)?admin(\/|$)/.test(r.path) || /\/admin(\/|$)/.test(r.path)) return "staff";
  if (/(^|\s)(auth(:[\w-]+)?|verified|Authenticate)(\s|$)/.test(mw) || /^\/(api\/)?(v\d+\/)?(me|user|account)(\/|$)/.test(r.path)) return "customers";
  if (r.kind === "page" || r.kind === "screen") return "website";
  return "anyone";
}

// ---------- where ----------

const NOT_A_RESOURCE = /^(api|v\d+|admin|user|me|web|internal|public|app|_next|:.*|\*.*)$/;

/** The part of the app a way in belongs to: its module (Laravel Modules/X, NestJS-style folders), else its URL noun. */
export function areaOf(r: Route): string {
  const mod = moduleOf(r.handlerFile ?? r.file) ?? moduleOf(r.file);
  if (mod) return mod;
  if (r.kind === "job") return jobArea(r);
  if (r.kind === "action") return slug(r.file.split("/").slice(-2, -1)[0] ?? "actions");
  const seg = r.path.split("/").filter(Boolean).find((s) => !NOT_A_RESOURCE.test(s));
  return seg ? slug(seg) : r.kind === "page" || r.kind === "screen" ? "home" : "general";
}

function moduleOf(file: string): string | undefined {
  const m = file.match(/(?:^|\/)(?:Modules|modules|packages|apps|src\/modules)\/([\w-]+)\//);
  return m ? slug(m[1]!) : undefined;
}

function jobArea(r: Route): string {
  const dir = r.file.match(/(?:Jobs|Commands|jobs|commands|tasks)\/([A-Z][\w]+)\//)?.[1];
  return dir ? slug(dir) : "background";
}

const slug = (s: string) => s.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const titleCase = (id: string) => (id === "other" ? "Other areas" : id === "background" ? "Background work" : id.replace(/-/g, " ").replace(/^\w/, (c) => c.toUpperCase()));

// ---------- titles ----------

const SIGN: Record<string, string> = { login: "sign in", logout: "sign out", signin: "sign in", signout: "sign out", signup: "sign up", register: "sign up" };
const ACTION: Record<string, string> = { index: "List", show: "View", store: "Create", create: "Form to create", edit: "Form to edit", update: "Update", destroy: "Delete", delete: "Delete" };
// Mostly-noun words (order, report, request, price…) are left out: in class names they name things, not actions.
const VERBS = new Set("accept activate adjust allocate append assert attempt authenticate broadcast build buy calculate capture claim clone commit compare compose compute convert count create decrement deduct deliver deny deploy destroy dispatch emit encode encrypt ensure enqueue enrich estimate evaluate expire extract fill filter finalise finalize flush format forward grant handle hash hydrate increment init initialise initialize insert load migrate normalise normalize notify parse pay persist prepare prune purchase push queue read rebuild recalculate receive recompute reconcile redeem refill render renew reserve resolve respond reverse rotate scan seed select sell serialize settle ship sign signup split store subtract summarise summarize trigger trim uncache unset upsert use warm write ".split(" ").concat("add apply approve archive assign attach ban block book bulk calculate cancel change charge check clear close collect complete confirm connect copy create decline delete detach disable disapprove disconnect dismiss download duplicate edit enable export fetch find fix flag forget generate get import invite join leave link list lock log login logout mark merge move notify open pause pin preview process publish purge reactivate redirect refresh refund regenerate register reject reload remove reorder replace reset restart restore resend resume retry revoke run save schedule search send set show skip sort start stop store submit subscribe suspend swap sync test toggle track transfer unban unblock unlink unlock unmark unpin unsubscribe update upgrade upload validate verify view void".split(" ")));

/** A plain title from the route name, the handler, or the URL: "Skip an order", "List orders", "Create shipment and parcels". */
export function routeTitle(r: Route): string {
  if (r.kind === "job") return jobTitle(r);
  if (r.kind === "action") return sentence(words(r.handler).join(" "));
  const view = r.handler.match(/^view\s+(\S+)/);
  if (view) return `${sentence(words(view[1]!.split(".").pop()!).join(" "))} page`;
  const dashed = r.name && !r.name.includes(".") ? dashedTitle(r) : undefined;
  if (dashed) return dashed;
  if ((r.kind === "page" || r.kind === "screen") && (!r.name || !r.name.includes(".")) && (!r.methods || r.methods.includes("GET"))) {
    if (r.name) return r.path === "/" ? "Home page" : `${sentence(nameWords(r, r.name).join(" "))} page`;
    const segs = r.path.split("/").filter((s) => s && !s.startsWith(":") && !s.startsWith("*"));
    return segs.length ? `${sentence(words(segs.join(" ")).join(" "))} page` : /:/.test(r.path) ? "Content page" : "Home page";
  }
  if (r.name) {
    const callers = new Set((r.middleware ?? []).filter((m) => /^verify\./.test(m)).map((m) => m.slice(7).toLowerCase()));
    const parts = r.name.split(".").filter((p) => p && !NOT_A_RESOURCE.test(p) && !callers.has(p.toLowerCase()));
    const last = parts.pop();
    // Only when the name ends in an action ("bookings.cancel"); "payments.checkout.intent" says less than the handler.
    if (last && (ACTION[last] || VERBS.has(words(last)[0]!))) return phrase(last, parts.map((p) => words(p).join(" ")));
  }
  const [cls, method] = r.handler.split(".");
  const resource = r.path.split("/").filter((s) => s && !NOT_A_RESOURCE.test(s)).filter((s) => !/^:/.test(s)).map((s) => words(s).join(" "));
  if (cls && method && method !== "__invoke" && method !== "handle" && !/^(GET|POST|PUT|PATCH|DELETE)$/.test(method)) {
    const noun = resource.length ? resource : words(cls.replace(/Controller$|Handler$|View$|Resource$/, ""));
    const m = words(method).join(" ");
    // POST /forgot-password → authController.forgotPassword: the method already says it all.
    if (noun.some((n) => m.includes(singular(n)) || singular(n).includes(m))) return sentence(m);
    return phrase(method, noun.slice(-2));
  }
  if (cls && /Controller$|Action$|Handler$/.test(cls)) {
    const w = words(cls.replace(/Controller$|Action$|Handler$/, ""));
    const verbAt = w.findIndex((x) => VERBS.has(x));
    if (verbAt > 0) return sentence([...w.slice(verbAt), ...w.slice(0, verbAt)].join(" "));
    if (verbAt === 0) return sentence(w.join(" "));
  }
  // A plain Python view function (Django): its name, plus what the URL adds after it ("ping" on /ping/:code/fail).
  const pathWords = r.path.split("/").flatMap((s) => (s.startsWith(":") ? [] : words(s)));
  if (cls && !method && /^[a-z][a-z0-9_]*$/.test(cls) && !/^(single|index|details?|list|view|show|get)$/.test(cls) && !(/s$/.test(cls) && pathWords.includes(cls))) {
    const own = words(cls);
    const tail = r.path.split("/").filter(Boolean).pop() ?? "";
    return sentence([...own, ...(tail && !tail.startsWith(":") ? words(tail).filter((w) => !own.includes(w)) : [])].join(" "));
  }
  const verb = { GET: /\/:\w+\??$/.test(r.path) ? "View" : "List", POST: "Create", PUT: "Update", PATCH: "Update", DELETE: "Delete" }[r.methods?.[0] ?? "GET"] ?? "Open";
  return resource.length ? `${verb} ${resource.slice(-2).map((s) => words(s).join(" ")).join(" ")}` : `${r.methods?.join(" ") ?? ""} ${r.path}`.trim();
}

/** The name's words, without a short app prefix ("hc-update-name" → update, name) and with the URL's resource in front when the name leaves it out. */
function nameWords(r: Route, name: string): string[] {
  const w = words(name);
  if (w.length > 1 && w[0]!.length <= 3 && !VERBS.has(w[0]!) && !ACTION[w[0]!]) w.shift();
  const resource = r.path.split("/").find((s) => s && !s.startsWith(":") && !s.startsWith("*") && !NOT_A_RESOURCE.test(s));
  const noun = resource ? singular(words(resource).join(" ")) : undefined;
  return noun && !w.some((x) => singular(x) === noun) && !w.includes(noun) ? [noun, ...w] : w;
}

/** Django-style names ("hc-pause", "update_timeout"): the verb from the name, the object from the URL: "Pause a check". */
function dashedTitle(r: Route): string | undefined {
  const w = words(r.name!);
  if (w.length > 1 && w[0]!.length <= 3 && !VERBS.has(w[0]!) && !ACTION[w[0]!]) w.shift();
  const at = w.findIndex((x) => VERBS.has(x) || ACTION[x]);
  if (at < 0) return r.methods?.length && !r.methods.includes("GET") ? sentence(`update ${nameWords(r, r.name!).join(" ")}`) : undefined;
  const rest = w.slice(at + 1);
  const sign = SIGN[w[at]!];
  if (sign) return rest.length ? sentence(`${sign} ${rest.join(" ")}`) : sentence(sign);
  if (!rest.length && ACTION[w[at]!] && r.path === "/") return undefined; // "hc-index" on / is the home page
  const resource = r.path.split("/").find((s) => s && !s.startsWith(":") && !s.startsWith("*") && !NOT_A_RESOURCE.test(s));
  let noun = resource ? singular(words(resource).join(" ")) : "";
  if (w.slice(0, at + 1).some((x) => singular(x) === noun)) noun = ""; // POST /login named "login"
  if (!rest.length) return phrase(w[at]!, noun ? [noun] : []);
  if (!noun || rest.some((x) => singular(x) === noun)) return phrase(w[at]!, [rest.join(" ")]);
  return phrase(`${w[at]}-${rest.join("-")}`, [noun]);
}

function phrase(action: string, nouns: string[]): string {
  const a = ACTION[action];
  const object = nouns.map((n, i) => (a === "List" && i === nouns.length - 1 ? n : singular(n))).join(" ").trim();
  if (a) return object ? `${a} ${a === "List" ? object : withArticle(object)}` : a;
  const w = words(action);
  // "update-status" on orders → "Update order status"; "skip" → "Skip an order".
  if (w.length > 1 && VERBS.has(w[0]!)) return sentence(`${w[0]} ${object ? `${object} ` : ""}${w.slice(1).join(" ")}`);
  const verb = w.join(" ");
  return sentence(object ? `${verb} ${withArticle(object)}` : verb);
}

function jobTitle(r: Route): string {
  const cls = r.handler.split(".")[0] ?? r.handler;
  // A scheduled artisan command is named by the command itself (`model:prune`), not by its arguments.
  const command = r.path.match(/^scheduled\s+([\w-]+:[\w:-]+)/)?.[1] ?? r.path.match(/^manage\.py\s+(\S+)/)?.[1];
  const name = command ? command : /closure|schedule|inline/.test(cls) ? r.path.replace(/^(artisan|scheduled|queued|queue|task|console)\s+/, "").replace(/\s*\(.*\)$/, "") : cls.replace(/(Job|Command|Task|Listener)$/, "");
  const when = r.path.match(/\(([^)]+)\)$/)?.[1];
  // Django commands are often one run-together word: "sendalerts" → "send alerts".
  const glued = (w: string) => { const v = /^[a-z]{7,}$/.test(w) ? [...VERBS].filter((x) => x.length >= 3 && w.startsWith(x) && w.length - x.length >= 4).sort((a, b) => b.length - a.length)[0] : undefined; return v ? `${v} ${w.slice(v.length)}` : w; };
  const base = sentence(words(name.replace(/[:]/g, " ")).map((w) => (r.path.startsWith("manage.py") ? glued(w) : w)).join(" "));
  return when && r.path.startsWith("scheduled") ? `${base} (${scheduleWords(when)})` : base;
}

const scheduleWords = (s: string) =>
  ({ everyMinute: "every minute", everyFiveMinutes: "every 5 minutes", everyTenMinutes: "every 10 minutes", everyFifteenMinutes: "every 15 minutes", everyThirtyMinutes: "every 30 minutes", hourly: "hourly", daily: "daily", dailyAt: "daily", weekly: "weekly", monthly: "monthly", twiceDaily: "twice a day", runInBackground: "scheduled" })[s] ?? s.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();

const words = (s: string) => s.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2").split(/[\s_\-.:/]+/).filter(Boolean).map((w) => (/^[A-Z0-9]{2,}$/.test(w) ? w : w.toLowerCase()));
const sentence = (s: string) => s.replace(/^\w/, (c) => c.toUpperCase());
const singular = (w: string) => w.replace(/ies$/, "y").replace(/(ss|us)$/, "$1").replace(/(x|ch|sh)es$/, "$1").replace(/s$/, "");
// "an order", "a user", "an upsell": a leading u only takes "an" when it isn't said "you".
const withArticle = (o: string) => (/\s/.test(o) ? o : `${/^([aeio]|u(?!s|ni|ti|ri))/.test(o) ? "an" : "a"} ${o}`);

// ---------- stories ----------

function guardSteps(r: Route): StoryStep[] {
  const out: StoryStep[] = [];
  for (const m of r.middleware ?? []) {
    const label = guardLabel(m);
    const same = out.find((o) => o.label === label);
    if (same) same.code += `, ${m}`;
    else if (label) out.push({ label, code: m, kind: "guard" });
  }
  return out;
}

export function guardLabel(m: string): string | undefined {
  const [name, arg = ""] = m.split(":");
  const args = arg.split(",");
  if (/^(auth:admin|ability:admin|role:admin|VerifyAdmins?)$/.test(m) || /^(admin|is_admin)$/.test(name!)) return "Staff only";
  if (m === "auth:api-key") return "Needs an API key";
  if (name === "auth" || name === "Authenticate") return "Must be signed in";
  if (m === "csrf_exempt") return "Called by other programs (no CSRF check)";
  if (m === "permission") return "Needs a permission";
  if (name === "can" && args[0]) return `Must be allowed to ${words(args[0]).join(" ")}${args[1] ? ` this ${words(args[1]).join(" ")}` : ""}`;
  if (name === "throttle" && args[0]) return `At most ${args[0]} ${args[1] && args[1] !== "1" ? `every ${args[1]} minutes` : "a minute"}`;
  if (name === "verified" || name === "EnsureEmailIsVerified") return "Email must be verified";
  if (name === "signed" || name === "ValidateSignature") return "Signed link only";
  if (name === "guest" || name === "RedirectIfAuthenticated") return "Signed-out visitors only";
  if (/^verify\./.test(m)) return `Must come from ${sentence(m.slice(7))}`;
  if (name === "ability" || name === "role" || name === "permission") return `Needs ${words(arg).join(" ")}`;
  return undefined;
}

function storySteps(r: Route, t: Trace, clientDirs: Map<string, string>): StoryStep[] {
  const out = guardSteps(r);
  if (!t.steps.length) {
    // Nothing in this repo's code to follow. Say plainly what it is instead.
    const at = { code: r.handler, file: r.file, line: r.line };
    const view = r.handler.match(/^view\s+(\S+)/);
    if (view) out.push({ label: `Show the ${view[1]} page template`, kind: "framework", ...at });
    else if (r.kind === "job" && /^scheduled\s/.test(r.path)) out.push({ label: `Run \`${r.path.replace(/^scheduled\s+/, "").replace(/[,\s]*\[.*$|\s*\(.*\)$/, "")}\`, a command that comes with a package`, kind: "framework", ...at });
    else if (/^[\w.]+\(…\)$/.test(r.handler)) out.push({ label: `Run ${r.handler.replace("(…)", "")} from a package`, kind: "framework", ...at });
    else out.push({ label: `Handled by ${r.handler}, which isn't in this repo's code`, kind: "framework", ...at });
    return out;
  }
  const childrenOf = (i: number) => t.steps.map((s, j) => [s, j] as const).filter(([s]) => s.parent === i && !s.repeat);
  let level = childrenOf(0);
  // A handler that just delegates (BookingCancelController → Booking.cancel): tell the delegate's story instead.
  const internal = level.filter(([s]) => !s.external && s.kind !== "new");
  if (internal.length === 1 && level.filter(([s]) => !s.external || s.external.category !== "framework").length <= 2) {
    const [only, idx] = internal[0]!;
    const deeper = childrenOf(idx);
    // …but only when the delegate's own story says something; otherwise keep the handler's level.
    if (deeper.some(([s]) => stepFor(s, clientDirs))) {
      const self = stepFor(only, clientDirs);
      level = [...deeper.map(([s, j]) => [{ ...s, cond: s.cond ?? only.cond, via: s.via === "name" || only.via === "name" ? "name" : s.via }, j] as const)];
      if (self && self.kind === "service") out.push(self);
    }
  }
  for (const [s] of level) {
    const step = stepFor(s, clientDirs);
    if (step && !out.some((o) => o.label === step.label && o.when === step.when)) out.push(step);
  }
  // Every way in tells some story. If the usual filters left nothing, say what it touches in plainer terms,
  // and failing that, where it's handled: never "not traced" when there's code to show.
  if (!out.some((o) => o.kind !== "guard")) {
    for (const [s] of level.length ? level : childrenOf(0)) {
      const step = s.external?.category === "framework" ? frameworkFallback(s) : undefined;
      if (step && !out.some((o) => o.label === step.label)) out.push(step);
    }
  }
  if (!out.some((o) => o.kind !== "guard")) {
    const h = t.steps[0]!;
    const [cls = h.name, method] = h.name.split(".");
    const what = words(cls.replace(/(Controller|Job|Command|Listener|Handler|Action)$/, "")).join(" ");
    out.push({ label: `Handled in ${what}${method && method !== "__invoke" && method !== "handle" ? ` · ${words(method).join(" ")}` : ""}${t.steps.length === 1 ? ", with no further calls" : ""}`, code: h.name, kind: "code", ...(h.file ? { file: h.file } : {}), ...(h.line ? { line: h.line } : {}) });
  }
  return out;
}

/** Framework calls the main list leaves out, in plain words, for stories that would otherwise say nothing. */
function frameworkFallback(s: TraceStep): StoryStep | undefined {
  const [api = "", method = ""] = s.name.split(" · ");
  const cls = api.split("\\").pop() ?? "";
  const where = { ...(s.file ? { file: s.file } : {}), ...(s.line ? { line: s.line } : {}), ...(s.cond ? { when: whenWords(s.cond) } : {}) };
  const step = (label: string): StoryStep => ({ label, code: `${cls}::${method}`, kind: "framework", ...where });
  if (/\\Events\\/.test(api)) return step(`Fire the ${words(cls).join(" ")} event`);
  if (/ValidationException/.test(cls)) return step("Reject invalid input");
  if (/Hash$/.test(cls) && /check/.test(method)) return step("Check the password");
  if (/^Auth$/.test(cls)) return step(/attempt|login/i.test(method) ? "Sign the user in" : /logout/i.test(method) ? "Sign the user out" : "Check who's signed in");
  if (/^Password$/.test(cls)) return step("Handle the password reset");
  if (/Eloquent|Query\\Builder|^DB$/.test(api) || /^(DB|Model|Builder)$/.test(cls)) {
    if (/^(create|update|save|delete|insert|upsert|increment|decrement|forceDelete|restore|updateOrCreate|firstOrCreate|sync|attach|detach)/.test(method)) return step("Write to the database");
    if (/^(where|find|first|get|paginate|pluck|exists|count|sum|max|min|orderBy|latest|with|select|value)/.test(method)) return step("Read from the database");
  }
  if (/^(Route|Redirect|Response)$/.test(cls) || /redirect|response|view/i.test(method)) return step("Respond");
  if (/^(Collection|Str|Arr|Carbon|Log|Config|Date|Number|Lang|URL)$/.test(cls)) return undefined;
  return step(sentence(`${words(cls).join(" ")}: ${words(method).join(" ")}`));
}

const FRAMEWORK_STEP: [RegExp, string, StoryStep["kind"]][] = [
  [/(Bus|Queue)\b.*(batch|dispatch|chain|push)|\bdispatch(Sync|Now)?$/i, "Run jobs in the background", "job"],
  [/\b(Mail|Mailer)\b|sendMail|send_mail/i, "Send an email", "framework"],
  [/\bNotification\b.*(send|route)|\bnotify$/i, "Send a notification", "framework"],
  [/\bCache\b.*(put|forget|flush|remember|set|delete)|revalidate(Tag|Path)/i, "Update the cache", "framework"],
  [/\bCache\b.*get|unstable_cache/i, "Read the cache", "framework"],
  [/\b(Event|event)\b.*dispatch|\bevent$|emit$/i, "Fire an event", "framework"],
  [/\bStorage\b.*(put|store|delete)/i, "Save a file", "framework"],
  [/\bDB\b.*transaction|\$transaction/i, "Wrap it in a database transaction", "framework"],
  [/\bHttp\b.*(get|post|put|patch|delete|send)/i, "Call an outside API", "service"],
  [/\b(redirect|notFound)$/i, "Redirect", "framework"],
];

function stepFor(s: TraceStep, clientDirs: Map<string, string>): StoryStep | undefined {
  const where = { ...(s.file ? { file: s.file } : {}), ...(s.line ? { line: s.line } : {}), ...(s.via === "name" ? { guess: true } : {}), ...(s.cond ? { when: whenWords(s.cond) } : {}) };
  if (s.external) {
    if (s.external.category === "framework") {
      const hit = FRAMEWORK_STEP.find(([re]) => re.test(s.name));
      if (hit) return { label: hit[1], code: s.name.replace(/^.*\\/, ""), kind: hit[2], ...where };
      // Worth telling in any story: events, rejected input, password and sign-in checks, database writes.
      const extra = frameworkFallback(s);
      return extra && /^(Fire the|Reject invalid|Check the password|Sign the user|Handle the password|Write to the database)/.test(extra.label) ? extra : undefined;
    }
    return { label: `Call ${s.name}`, code: s.name, kind: "service", ...where };
  }
  const client = s.file ? [...clientDirs].find(([dir]) => s.file!.startsWith(dir + "/")) : undefined;
  if (client) return { label: `Call ${client[1]}`, code: s.name, kind: "service", ...where };
  const [cls = "", method] = s.name.split(".");
  if (WRAPPER.test(cls)) return undefined;
  if (s.kind === "new" || !method) {
    if (s.kind === "new" && s.file && /\/(Jobs|Actions|Commands|UseCases|Services)\//.test(s.file) && !/Job$|Task$/.test(cls)) return { label: sentence(words(cls).join(" ")), code: cls, kind: "code", ...where };
    if (/Job$|Task$/.test(cls)) return { label: `${sentence(words(cls.replace(/(Job|Task)$/, "")).join(" "))} in the background`, code: cls, kind: "job", ...where };
    if (s.kind === "new") return undefined; // value objects: Money, Percent, DTOs
    if (!method && /^[a-z]/.test(cls)) return { label: sentence(words(cls).join(" ")), code: cls, kind: "code", ...where };
    return undefined;
  }
  if (/^(get|is|has|to|as|with|find|resolve|current|__construct|make|from|of|build|boot|handle|toArray|jsonSerialize)$/.test(method) && !/Job$/.test(cls)) return undefined;
  if (/^(get|set)[A-Z]/.test(method)) return undefined; // accessors say nothing about what happens
  if (/^(is|has|can|should|requires|needs|was|must)[A-Z]/.test(method)) return { label: `Check: ${words(method).join(" ")}?`, code: s.name, kind: "code", ...where };
  if (/^(authorize|can|allows|denies|check)$/i.test(method) || /Policy$|Gate$/.test(cls)) return { label: "Checks permission", code: s.name, kind: "guard", ...where };
  if (/^dispatch/.test(method) && /Job$/.test(cls)) return { label: `${sentence(words(cls.replace(/Job$/, "")).join(" "))} in the background`, code: s.name, kind: "job", ...where };
  const w = words(method);
  // A story step is an action. Noun-like methods (cacheKey, deliveryPreference, withEvent) are lookups and plumbing.
  if (!VERBS.has(w[0]!)) return undefined;
  const label = w.length === 1 ? `${sentence(w[0]!)} ${words(cls).join(" ")}` : sentence(w.join(" "));
  return { label, code: s.name, kind: "code", ...where };
}

// Wrappers that only add error handling: their callees are the story.
const WRAPPER = /^(catchAsync|asyncHandler|wrapAsync|tryCatch|asyncWrapper|withErrorHandling|handleAsync)$/;

/** "if $request->requiresPayment()" → "If requires payment"; "match $status" → "Depending on status". */
export function whenWords(cond: string): string {
  if (cond === "else") return "Otherwise";
  if (cond === "catch") return "If it fails";
  const subject = (s: string) => {
    const negated = /^!/.test(s.trim());
    const core = s.replace(/^!\s*/, "").replace(/\$this(->|\.)|\$|this\.|self\./g, "").replace(/\(\)/g, "").split(/->|\.|::/).pop()!.replace(/\(.*$/, "");
    const w = words(core).join(" ");
    return negated ? `not ${w}` : w;
  };
  if (cond.startsWith("match ")) return `Depending on ${subject(cond.slice(6))}`;
  const body = cond.replace(/^if\s+/, "").replace(/->|::|\?->/g, ".");
  if (/&&|\|\||\band\b|\bor\b/.test(body) || body.length > 40) return "Only sometimes";
  const cmp = body.match(/^(.+?)\s*(===?|!==?|>=?|<=?)\s*(.+)$/);
  if (cmp) return `If ${subject(cmp[1]!)} ${cmp[2]!.startsWith("!") ? "isn't" : cmp[2]!.startsWith("=") ? "is" : cmp[2]} ${cmp[3]!.replace(/^['"]|['"]$/g, "").replace(/^\w+::/, "").toLowerCase()}`;
  return `If ${subject(body)}`;
}

function reachedServices(t: Trace, clientDirs: Map<string, string>): string[] {
  const out = new Set<string>();
  for (const s of t.steps) {
    if (s.external && s.external.category !== "framework" && s.external.category !== "observability") out.add(s.name);
    const c = s.file ? [...clientDirs].find(([dir]) => s.file!.startsWith(dir + "/")) : undefined;
    if (c) out.add(c[1]);
  }
  return [...out];
}

/** Integration folders of the repo's own API clients ("Modules/Marketing/app/Http/Integrations/Mailer" → "Mailer"). */
function ownClientDirs(integrations: Integration[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const i of integrations) {
    if (!i.detectedBy.includes("client")) continue;
    for (const f of i.files) {
      const m = f.match(/^(.*?\/[Ii]ntegrations\/[\w-]+)\//);
      if (m) out.set(m[1]!, i.name);
    }
  }
  return out;
}

/** Code two or more ways in share (staff "Update status" and customer "Cancel a booking" both run Booking.cancel). */
function markShared(stories: Map<string, Story>, traces: Map<string, Trace>): void {
  const users = new Map<string, Set<string>>(); // node -> handlers' route ids
  const handlerOf = new Map<string, string>();
  for (const s of stories.values()) {
    const t = traces.get(s.id);
    if (!t?.steps.length) continue;
    handlerOf.set(s.id, t.steps[0]!.node);
    for (const st of t.steps) if (st.depth >= 1 && st.depth <= 2 && !st.external && !st.repeat && st.kind === "call") {
      const set = users.get(st.node) ?? new Set<string>();
      set.add(s.id);
      users.set(st.node, set);
    }
  }
  for (const s of stories.values()) {
    const t = traces.get(s.id);
    if (!t) continue;
    let best: { node: string; name: string; with: string[]; depth: number } | undefined;
    for (const st of t.steps) {
      if (st.depth < 1 || st.depth > 2 || st.external || st.repeat || st.kind !== "call") continue;
      const method = st.name.split(".")[1];
      if (method && !VERBS.has(words(method)[0]!)) continue; // lookups and accessors aren't worth pointing at
      const others = [...(users.get(st.node) ?? [])].filter((id) => id !== s.id && handlerOf.get(id) !== handlerOf.get(s.id));
      if (!others.length || others.length > 4) continue; // shared by everything means a utility, not a story
      if (!best || st.depth < best.depth || (st.depth === best.depth && others.length < best.with.length)) best = { node: st.node, name: st.name, with: others, depth: st.depth };
    }
    if (best) s.shares = { code: best.name, with: best.with };
  }
}

// ---------- what an agent adds ----------

const overridesPath = (root: string) => path.join(root, ".houserules", "entrypoints.json");

export async function readEntryOverrides(rootDir: string): Promise<EntryOverrides> {
  try {
    return JSON.parse(await readFile(overridesPath(path.resolve(rootDir)), "utf8")) as EntryOverrides;
  } catch {
    return {};
  }
}

export interface EntryOverridesInput {
  areas?: { id: string; title?: string; blurb?: string; order?: number }[];
  titles?: { id: string; title: string }[];
}

/**
 * Stores friendlier area names, the customer-journey order and route titles. Only names and order: who calls
 * what, and what it does, always come from the code. Unknown ids are rejected so a typo can't hide an area.
 */
export async function submitEntryOverrides(rootDir: string, routes: Route[], input: EntryOverridesInput): Promise<{ accepted: number; rejected: { id: string; problem: string }[] }> {
  const root = path.resolve(rootDir);
  const current = await readEntryOverrides(root);
  const areaIds = new Set(routes.map(areaOf));
  const routeIds = new Set(routes.map((r) => r.id));
  const rejected: { id: string; problem: string }[] = [];
  let accepted = 0;
  for (const a of input.areas ?? []) {
    if (!areaIds.has(a.id)) rejected.push({ id: a.id, problem: `No area "${a.id}". Areas: ${[...areaIds].sort().join(", ")}` });
    else if (a.title && a.title.length > 40) rejected.push({ id: a.id, problem: "Title is over 40 characters" });
    else if (a.blurb && a.blurb.length > 90) rejected.push({ id: a.id, problem: "Blurb is over 90 characters" });
    else {
      (current.areas ??= {})[a.id] = { ...current.areas?.[a.id], ...(a.title ? { title: a.title } : {}), ...(a.blurb ? { blurb: a.blurb } : {}), ...(a.order != null ? { order: a.order } : {}) };
      accepted++;
    }
  }
  for (const t of input.titles ?? []) {
    if (!routeIds.has(t.id)) rejected.push({ id: t.id, problem: "No entry point with this id (use list_entry_points)" });
    else if (!t.title.trim() || t.title.length > 70) rejected.push({ id: t.id, problem: "Title must be 1-70 characters" });
    else {
      (current.titles ??= {})[t.id] = t.title.trim();
      accepted++;
    }
  }
  await mkdir(path.dirname(overridesPath(root)), { recursive: true });
  await writeFile(overridesPath(root), JSON.stringify(current, null, 2) + "\n");
  return { accepted, rejected };
}
