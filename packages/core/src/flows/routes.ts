import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Analysis } from "../types.js";
import { isTestFile } from "../scan/tooling.js";

export type RouteKind = "page" | "screen" | "api" | "action" | "webhook" | "job" | "middleware";

/** A way into the app: a URL, an API endpoint, a server action, a webhook or a scheduled job. */
export interface Route {
  id: string;
  kind: RouteKind;
  path: string; // URL ("/product/:handle"), or a name for actions and jobs
  methods?: string[]; // HTTP methods, for API endpoints
  file: string;
  line: number;
  handler: string; // the function or class that handles it
  handlerFile?: string; // where the handler is defined, when it's not in `file` (Laravel controllers)
  inline?: [number, number]; // lines of an inline handler (Express/Laravel closures), when it has no name
  middleware?: string[]; // what runs before the handler, as written ("auth:sanctum", "can:update,order")
  name?: string; // the framework's route name ("bookings.cancel"), when it has one
}

const HTTP = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];
// Paths that receive calls from other services. Not "callback" or a vendor name: those are usually OAuth logins
// and payment redirects that a browser follows.
const WEBHOOK = /webhook|revalidate|\bhooks?\b/i;

/** Every entry point we can find for Next.js, Django and Spring, in a stable order. */
export async function listRoutes(rootDir: string, analysis: Analysis): Promise<Route[]> {
  const root = path.resolve(rootDir);
  const read = async (p: string) => {
    try {
      return await readFile(path.join(root, p), "utf8");
    } catch {
      return "";
    }
  };
  const lineOf = (text: string, index: number) => text.slice(0, index).split("\n").length;
  const files = analysis.files.map((f) => f.path).filter((p) => !isTestFile(p) && !p.split("/").includes("node_modules"));
  const out: Route[] = [];
  const push = (r: Omit<Route, "id">) => out.push({ ...r, id: `${r.kind}:${r.methods?.join(",") ?? ""}:${r.path}:${r.file}:${r.handler}` });

  const isNext = analysis.frameworks.some((f) => f.id === "nextjs");
  if (isNext) {
    for (const p of files) {
      // app/ or pages/ at the project root, under src/, or inside a monorepo package.
      const app = p.match(/^(?:(?:apps|packages)\/[^/]+\/)?(?:src\/)?app\/(.*?)\/?(page|route)\.(tsx|ts|jsx|js)$/);
      const pages = !app && p.match(/^(?:(?:apps|packages)\/[^/]+\/)?(?:src\/)?pages\/(.*)\.(tsx|ts|jsx|js)$/);
      if (app) {
        const url = nextUrl(app[1]!);
        const text = await read(p);
        if (app[2] === "page") {
          const m = defaultExport(text);
          push({ kind: "page", path: url, file: p, line: m ? lineOf(text, m.index) : 1, handler: m?.name ?? "default" });
        } else {
          for (const m of text.matchAll(new RegExp(`export\\s+(?:async\\s+)?(?:function|const)\\s+(${HTTP.join("|")})\\b`, "g"))) {
            push({ kind: WEBHOOK.test(url) ? "webhook" : "api", path: url, methods: [m[1]!], file: p, line: lineOf(text, m.index!), handler: m[1]! });
          }
        }
      } else if (pages && !/^_(app|document|error)$/.test(path.posix.basename(pages[1]!))) {
        const url = nextUrl(pages[1]!.replace(/(^|\/)index$/, ""));
        const text = await read(p);
        const m = text.match(/export\s+default\s+(?:async\s+)?(?:function\s+(\w+)|(\w+)\s*;)/);
        const api = pages[1]!.startsWith("api/");
        push({ kind: api ? (WEBHOOK.test(url) ? "webhook" : "api") : "page", path: url, file: p, line: m ? lineOf(text, m.index!) : 1, handler: m?.[1] ?? m?.[2] ?? "default" });
      }
    }
    // Server actions: every exported async function in a "use server" file.
    for (const p of files.filter((f) => /\.(tsx?|jsx?)$/.test(f))) {
      const text = await read(p);
      if (!/^\s*(?:\/\/[^\n]*\n|\/\*[\s\S]*?\*\/\s*)*['"]use server['"]/.test(text)) continue;
      for (const m of text.matchAll(/export\s+async\s+function\s+(\w+)/g)) push({ kind: "action", path: m[1]!, file: p, line: lineOf(text, m.index!), handler: m[1]! });
    }
    for (const p of files.filter((f) => /^(src\/)?middleware\.(ts|js)$/.test(f))) {
      const text = await read(p);
      const m = text.match(/export\s+(?:async\s+)?function\s+(\w+)/);
      push({ kind: "middleware", path: "every request", file: p, line: m ? lineOf(text, m.index!) : 1, handler: m?.[1] ?? "middleware" });
    }
    const vercel = await read("vercel.json");
    try {
      for (const c of (JSON.parse(vercel || "{}").crons ?? []) as { path: string; schedule: string }[]) {
        const r = out.find((x) => x.path === c.path && (x.kind === "api" || x.kind === "webhook"));
        if (r) push({ ...r, kind: "job", path: `${c.path} (${c.schedule})` });
      }
    } catch {
      // not JSON
    }
  }

  const has = (id: string) => analysis.frameworks.some((f) => f.id === id);
  if (has("django")) await djangoRoutes(files, read, lineOf, push);
  if (has("spring")) await springRoutes(files, read, lineOf, push);
  if (analysis.dependencies.some((d) => d.name === "expo-router")) await expoRoutes(files, read, lineOf, push);
  if (has("laravel")) await laravelRoutes(files, read, lineOf, push, analysis);
  if (has("symfony")) await symfonyRoutes(files, read, lineOf, push);
  if (has("nestjs")) await nestRoutes(files, read, lineOf, push);
  if (["express", "fastify", "hono", "koa"].some(has) || analysis.dependencies.some((d) => d.name === "@koa/router" || d.name === "koa-router")) await nodeRoutes(files, read, lineOf, push, analysis);
  if (analysis.dependencies.some((d) => d.ecosystem === "npm")) await nodeJobs(files, read, lineOf, push);

  // Laravel controllers can add middleware in their constructor: $this->middleware([Authenticate::class, …]).
  for (const r of out) {
    if (!r.handlerFile?.endsWith(".php")) continue;
    const text = await read(r.handlerFile);
    const ctor = text.match(/function\s+__construct\s*\([^)]*\)[^{]*\{([\s\S]*?)\n\s{4}\}/)?.[1] ?? "";
    // Each call can be limited to some actions: ['except' => ['index']], ['only' => [...]], or ->except([...]).
    const action = r.handler.split(".")[1] ?? "";
    for (const stmt of ctor.split(";")) {
      if (!/\$this->middleware\(/.test(stmt)) continue;
      const list = (re: RegExp) => { const m = stmt.match(re); return m ? [...m[1]!.matchAll(/['"](\w+)['"]/g)].map((x) => x[1]!) : undefined; };
      const only = list(/only['"]?\s*(?:=>|\()\s*(\[[^\]]*\]|['"]\w+['"])/);
      const except = list(/except['"]?\s*(?:=>|\()\s*(\[[^\]]*\]|['"]\w+['"])/);
      if ((only && !only.includes(action)) || except?.includes(action)) continue;
      const mw = middlewareIn(stmt.replace(/\$this->middleware\(/g, "->middleware("));
      if (mw.length) r.middleware = [...new Set([...(r.middleware ?? []), ...mw])];
    }
  }

  const order: RouteKind[] = ["page", "screen", "api", "action", "webhook", "job", "middleware"];
  return out.sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind) || a.path.localeCompare(b.path));
}

/** "(shop)/product/[handle]" → "/product/:handle"; route groups and parallel slots don't appear in URLs. */
function nextUrl(dir: string): string {
  const parts = dir.split("/").filter((s) => s && !/^\(.*\)$/.test(s) && !s.startsWith("@"));
  return "/" + parts.map((s) => s.replace(/^\[\[?\.\.\.(\w+)\]?\]$/, "*$1").replace(/^\[(\w+)\]$/, ":$1")).join("/");
}

type Read = (p: string) => Promise<string>;
type LineOf = (text: string, index: number) => number;
type Push = (r: Omit<Route, "id">) => void;

async function djangoRoutes(files: string[], read: Read, lineOf: LineOf, push: Push): Promise<void> {
  // urls.py: path("orders/<int:pk>/", views.detail) and include("shop.urls") with a prefix.
  const urlFiles = files.filter((p) => path.posix.basename(p) === "urls.py");
  const prefixes = new Map<string, string>(); // module path ("shop/urls.py") -> URL prefix
  const texts = new Map<string, string>();
  for (const p of urlFiles) texts.set(p, await read(p));
  for (const [p, text] of texts) {
    for (const m of text.matchAll(/(?:re_)?path\(\s*r?['"]([^'"]*)['"]\s*,\s*include\(\s*['"]([\w.]+)['"]/g)) {
      const target = urlFiles.find((f) => f.replace(/\.py$/, "").replace(/\//g, ".").endsWith(m[2]!));
      if (target) prefixes.set(target, (prefixes.get(p) ?? "") + m[1]!);
    }
  }
  // path("checks/<uuid:code>/", include(check_urls)) where check_urls = [...] is a list in the same file.
  const listPrefix = (p: string, text: string, at: number): string => {
    let out = "";
    for (const m of text.matchAll(/(?:re_)?path\(\s*r?['"]([^'"]*)['"]\s*,\s*include\(\s*(\w+)\s*\)/g)) {
      const def = text.match(new RegExp(`^${m[2]}\\s*=\\s*\\[`, "m"));
      if (!def) continue;
      const start = def.index! + def[0].length;
      let depth = 1, end = start;
      while (end < text.length && depth) depth += text[end] === "[" ? 1 : text[end] === "]" ? -1 : 0, end++;
      // A list included under several prefixes (api/v1/, api/v2/…): the last one, usually the current version.
      if (at > start && at < end) out = listPrefix(p, text, m.index!) + m[1]!.replace(/^\^/, "");
    }
    return out;
  };
  const views = await djangoViews(files.filter((f) => f.endsWith(".py") && !/(^|\/)(tests?|migrations)(\/|_|\.)/.test(f)), read);
  for (const [p, text] of texts) {
    for (const m of text.matchAll(/(?:re_)?path\(\s*r?['"]([^'"]*)['"]\s*,\s*([\w.]+?)(\.as_view\(\))?\s*[,)]/g)) {
      if (m[2] === "include") continue;
      const url = "/" + ((prefixes.get(p) ?? "") + listPrefix(p, text, m.index!) + m[1]!.replace(/^\^/, "")).replace(/<(?:\w+:)?(\w+)>/g, ":$1").replace(/^\^|\$$/g, "");
      const handler = m[2]!.split(".").pop()!;
      // The rest of this path(...) call, for name="…".
      const rest = text.slice(m.index! + m[0].length - 1, text.indexOf("\n", m.index! + m[0].length) + 1 || undefined);
      const name = rest.match(/\bname\s*=\s*['"]([^'"]+)['"]/)?.[1];
      const dir = path.posix.dirname(p);
      const found = views.get(handler) ?? [];
      const view = found.find((v) => path.posix.dirname(v.file) === dir || path.posix.dirname(v.file) === `${dir}/views`) ?? (found.length === 1 ? found[0] : undefined);
      const api = /\bapi\b/.test(url) || /ViewSet|APIView/.test(handler) || Boolean(view?.api);
      const kind = WEBHOOK.test(url) ? "webhook" : api || view?.guards.includes("csrf_exempt") ? "api" : "page";
      push({
        kind,
        path: url.replace(/\/+/g, "/"),
        file: p,
        line: lineOf(text, m.index!),
        handler,
        ...(view && view.file !== p ? { handlerFile: view.file } : {}),
        ...(view?.methods ? { methods: view.methods } : {}),
        ...(view?.guards.length ? { middleware: view.guards } : {}),
        ...(name ? { name } : {}),
      });
    }
  }
  for (const p of files.filter((f) => /\/management\/commands\/(?!_)\w+\.py$/.test(f))) {
    push({ kind: "job", path: `manage.py ${path.posix.basename(p, ".py")}`, file: p, line: 1, handler: "Command.handle" });
  }
  for (const p of files.filter((f) => f.endsWith(".py"))) {
    const text = await read(p);
    for (const m of text.matchAll(/@(?:shared_task|app\.task|\w+\.task)(?:\([^)]*\))?\s*\n\s*def\s+(\w+)/g)) push({ kind: "job", path: `task ${m[1]}`, file: p, line: lineOf(text, m.index!), handler: m[1]! });
  }
}

interface DjangoView {
  file: string;
  guards: string[]; // as middleware: "auth", "admin", "permission:x", "csrf_exempt"
  methods?: string[];
  api?: boolean;
}

/**
 * Who may call each Django view, read from its decorators (@login_required, @csrf_exempt, @require_POST…),
 * class mixins (LoginRequiredMixin) and DRF permission_classes. Keyed by function or class name.
 */
async function djangoViews(files: string[], read: Read): Promise<Map<string, DjangoView[]>> {
  const out = new Map<string, DjangoView[]>();
  const add = (name: string, v: DjangoView) => out.set(name, [...(out.get(name) ?? []), v]);
  for (const file of files) {
    const text = await read(file);
    if (!/^\s*@|\bclass\s+\w+\(.*(View|Mixin)/m.test(text)) continue;
    for (const m of text.matchAll(/^((?:@[^\n]+\n)*)(?:async\s+)?(def|class)\s+(\w+)\s*(?:\(([^)]*)\))?/gm)) {
      const [, decorators = "", what, name, args = ""] = m;
      let source = decorators;
      if (what === "class") {
        const end = text.slice(m.index! + m[0].length).search(/\n(?:class|def|@)\b/);
        source += `\n${args}\n${text.slice(m.index! + m[0].length, end < 0 ? undefined : m.index! + m[0].length + end)}`;
      } else if (!decorators && !/\brequest\b/.test(args)) continue;
      add(name!, { file, ...djangoGuards(source), ...(what === "class" && /APIView|ViewSet|permission_classes/.test(source) ? { api: true } : {}) });
    }
  }
  return out;
}

function djangoGuards(src: string): Omit<DjangoView, "file"> {
  const guards: string[] = [];
  const has = (re: RegExp) => re.test(src);
  if (has(/staff_member_required|IsAdminUser|is_staff|is_superuser|superuser_required/)) guards.push("admin");
  if (has(/login_required|LoginRequiredMixin|\bIsAuthenticated\b|IsAuthenticatedOrReadOnly|require_sudo_mode/)) guards.push("auth");
  else if (has(/@\w*(authori[sz]e|api_?key|token_required)\w*/i)) guards.push("auth:api-key");
  for (const p of src.matchAll(/permission_required\(\s*['"]([\w.]+)['"]/g)) guards.push(`permission:${p[1]!.split(".").pop()}`);
  if (has(/PermissionRequiredMixin/) && !guards.some((g) => g.startsWith("permission"))) guards.push("permission");
  if (!guards.length && has(/@csrf_exempt/)) guards.push("csrf_exempt"); // no session and no CSRF token: called by other programs
  const only = src.match(/@require_(GET|POST|safe)\b/)?.[1];
  const listed = src.match(/@require_http_methods\(\s*\[([^\]]*)\]/)?.[1]?.match(/[A-Z]+/g);
  const methods = only ? (only === "safe" ? ["GET", "HEAD"] : [only]) : listed ?? undefined;
  return { guards, ...(methods ? { methods } : {}) };
}

async function springRoutes(files: string[], read: Read, lineOf: LineOf, push: Push): Promise<void> {
  for (const p of files.filter((f) => /\.(java|kt)$/.test(f))) {
    const text = await read(p);
    const isController = /@(Rest)?Controller\b/.test(text);
    if (isController) {
      const cls = text.match(/@RequestMapping\(\s*(?:value\s*=\s*|path\s*=\s*)?\{?\s*"([^"]*)"/);
      const classIdx = text.search(/\b(class|object)\s+\w+/);
      const prefix = cls && cls.index! < classIdx ? cls[1]! : "";
      const re = /@(Get|Post|Put|Patch|Delete|Request)Mapping(?:\(([^)]*)\))?[\s\S]*?(?:fun|public|private|protected)?\s*[\w<>[\],? ]*?\s(\w+)\s*\(/g;
      const body = text.slice(classIdx); // skip the class-level @RequestMapping
      for (const m0 of body.matchAll(re)) {
        const m = Object.assign(m0, { index: m0.index! + classIdx });
        const args = m[2] ?? "";
        const sub = args.match(/"([^"]*)"/)?.[1] ?? "";
        const method = m[1] === "Request" ? (args.match(/RequestMethod\.(\w+)/)?.[1] ?? "ANY") : m[1]!.toUpperCase();
        const url = ("/" + prefix + "/" + sub).replace(/\/+/g, "/").replace(/(.)\/$/, "$1").replace(/\{(\w+)\}/g, ":$1");
        push({ kind: WEBHOOK.test(url) ? "webhook" : /@RestController/.test(text) || /ResponseBody/.test(text) ? "api" : "page", path: url, methods: [method], file: p, line: lineOf(text, m.index!), handler: m[3]! });
      }
    }
    for (const m of text.matchAll(/@Scheduled\(([^)]*)\)[\s\S]*?\s(\w+)\s*\(/g)) {
      const when = m[1]!.match(/"([^"]+)"/)?.[1] ?? m[1]!.trim();
      push({ kind: "job", path: `${m[2]} (${when})`, file: p, line: lineOf(text, m.index!), handler: m[2]! });
    }
  }
}

// ---------- shared helpers ----------

/** The component a page/screen file exports as default, including `export { X as default } from "…"`. */
function defaultExport(text: string): { name: string; index: number } | null {
  const m = text.match(/export\s+default\s+(?:async\s+)?(?:function\s+(\w+)|class\s+(\w+)|(\w+)\s*;?\s*$)/m) ?? text.match(/export\s*\{\s*(\w+)\s+as\s+default\s*\}/);
  if (!m) return null;
  return { name: m[1] ?? m[2] ?? m[3]!, index: m.index! };
}

/** Index of the bracket that closes the one at `open`, skipping strings and comments. */
function matchBracket(text: string, open: number): number {
  const pairs: Record<string, string> = { "(": ")", "[": "]", "{": "}" };
  const stack: string[] = [];
  for (let i = open; i < text.length; i++) {
    const ch = text[i]!;
    if (ch === "'" || ch === '"' || ch === "`") {
      for (i++; i < text.length && text[i] !== ch; i++) if (text[i] === "\\") i++;
      continue;
    }
    if (ch === "/" && text[i + 1] === "/") { i = text.indexOf("\n", i); if (i < 0) return text.length - 1; continue; }
    if (ch === "/" && text[i + 1] === "*") { i = text.indexOf("*/", i + 2) + 1; if (i <= 0) return text.length - 1; continue; }
    if (pairs[ch]) stack.push(pairs[ch]!);
    else if (ch === ")" || ch === "]" || ch === "}") {
      stack.pop();
      if (!stack.length) return i;
    }
  }
  return text.length - 1;
}

/** Top-level comma-separated arguments of a call whose "(" is at `open`. */
function callArgs(text: string, open: number): { text: string; start: number }[] {
  const end = matchBracket(text, open);
  const out: { text: string; start: number }[] = [];
  let depth = 0, start = open + 1;
  for (let i = open + 1; i < end; i++) {
    const ch = text[i]!;
    if (ch === "'" || ch === '"' || ch === "`") { for (i++; i < end && text[i] !== ch; i++) if (text[i] === "\\") i++; continue; }
    if ("([{".includes(ch)) depth++;
    else if (")]}".includes(ch)) depth--;
    else if (ch === "," && depth === 0) { out.push({ text: text.slice(start, i).trim(), start }); start = i + 1; }
  }
  const last = text.slice(start, end).trim();
  if (last) out.push({ text: last, start });
  return out;
}

/** Middleware named in a chunk of Laravel route code: ->middleware('auth'), ->middleware(['a', 'b']), 'middleware' => […], X::class. */
function middlewareIn(code: string): string[] {
  const out: string[] = [];
  // Only the first argument: ->middleware(X::class, ['except' => 'logout']) names X, not its options.
  for (const m of code.matchAll(/(?:(?:->|::)middleware\(|['"]middleware['"]\s*=>)\s*(\[[^\]]*\]|'[^']*'|"[^"]*"|[^,)]*)/g)) {
    for (const s of m[1]!.matchAll(/['"]([^'"]+)['"]|(\w+)::class/g)) out.push(s[1] ?? MIDDLEWARE_CLASS[s[2]!] ?? s[2]!);
  }
  return out;
}
const MIDDLEWARE_CLASS: Record<string, string> = { Authenticate: "auth", EnsureEmailIsVerified: "verified", ValidateSignature: "signed", ThrottleRequests: "throttle" };

const joinUrl = (...parts: string[]) => ("/" + parts.map((p) => p.replace(/^\/+|\/+$/g, "")).filter(Boolean).join("/")).replace(/\/+/g, "/");
const isInlineFn = (arg: string) => /^(async\s+)?(function\b|\([^)]*\)\s*(:\s*[^=]+)?=>|\w+\s*=>|fn\s*\(|static\s+fn|static\s+function)/.test(arg);

// ---------- Expo Router ----------

/** app/(tabs)/profile/[id].tsx → /profile/:id; app/api/users+api.ts → API /api/users. */
async function expoRoutes(files: string[], read: Read, lineOf: LineOf, push: Push): Promise<void> {
  for (const p of files) {
    const m = p.match(/^(?:(?:apps|packages)\/[^/]+\/)?(?:src\/)?app\/(.+)\.(tsx|ts|jsx|js)$/);
    if (!m || /(^|\/)(_layout|\+html|\+not-found|\+native-intent)$/.test(m[1]!)) continue;
    const api = m[1]!.endsWith("+api");
    const segs = m[1]!.replace(/\+api$/, "").split("/").filter((s) => !/^\(.*\)$/.test(s)).map((s) => (s === "index" ? "" : s));
    const url = nextUrl(segs.join("/"));
    const text = await read(p);
    if (api) {
      for (const h of text.matchAll(new RegExp(`export\\s+(?:async\\s+)?(?:function|const)\\s+(${HTTP.join("|")})\\b`, "g"))) {
        push({ kind: WEBHOOK.test(url) ? "webhook" : "api", path: url, methods: [h[1]!], file: p, line: lineOf(text, h.index!), handler: h[1]! });
      }
    } else {
      const d = defaultExport(text);
      if (d) push({ kind: "screen", path: url, file: p, line: lineOf(text, d.index), handler: d.name });
    }
  }
}

// ---------- Laravel ----------

async function laravelRoutes(files: string[], read: Read, lineOf: LineOf, push: Push, analysis: Analysis): Promise<void> {
  const routeFiles = files.filter((p) => /(^|\/)routes\/[\w/-]+\.php$/.test(p));
  // Where route files are mounted: Route::middleware('api')->prefix('api/v1')->group(module_path($this->name, '/routes/api.php'))
  // in a (module) RouteServiceProvider, or base_path('routes/x.php') in bootstrap/app.php.
  const mounts = new Map<string, { prefix: string; api: boolean; middleware: string[]; name: string }>();
  for (const p of files.filter((f) => /(^|\/)(bootstrap\/app|Providers\/\w*Route\w*)\.php$/.test(f))) {
    const text = await read(p);
    for (const g of text.matchAll(/->group\s*\(\s*([^;]*?routes\/[\w/-]+\.php[^;]*?)\)\s*;/g)) {
      const target = g[1]!.match(/routes\/[\w/-]+\.php/)![0];
      const head = text.slice(Math.max(0, text.lastIndexOf("Route::", g.index!)), g.index!);
      const module = /module_path\(/.test(g[1]!) ? p.match(/^(.*?Modules\/\w+)\//)?.[1] : undefined;
      const file = module ? `${module}/${target}` : target;
      mounts.set(file, { prefix: head.match(/prefix\(\s*['"]([^'"]*)['"]/)?.[1] ?? "", api: /middleware\(\s*\[?\s*['"]api['"]/.test(head) || /^\/?api\b/.test(head.match(/prefix\(\s*['"]([^'"]*)['"]/)?.[1] ?? ""), middleware: middlewareIn(head), name: head.match(/->name\(\s*['"]([^'"]*)['"]/)?.[1] ?? "" });
    }
  }
  for (const p of routeFiles) {
    const text = await read(p);
    const mount = mounts.get(p);
    const isApi = /(^|\/)routes\/api\.php$/.test(p) || !!mount?.api;
    const filePrefix = mount ? mount.prefix : isApi ? "api" : "";
    // Groups: Route::prefix('admin')->…->group(…), Route::group(['prefix' => 'x'], …), Route::controller(X::class)->group(…).
    const groups: { from: number; to: number; prefix: string; controller?: string; middleware: string[]; name: string }[] = [];
    for (const g of text.matchAll(/->group\s*\(|Route::group\s*\(/g)) {
      const open = text.indexOf("(", g.index!);
      // Route::prefix('x')->…->group(: the chain starts at the last Route:: in this statement; Route::group( starts here.
      const from = g[0].startsWith("->") ? Math.max(text.lastIndexOf("Route::", g.index! - 1), text.lastIndexOf(";", g.index! - 1) + 1) : g.index!;
      const head = text.slice(Math.max(0, from), g.index! + g[0].length + 200);
      const prefix = head.match(/prefix\(\s*['"]([^'"]*)['"]/)?.[1] ?? head.match(/['"]prefix['"]\s*=>\s*['"]([^'"]*)['"]/)?.[1] ?? "";
      const controller = head.match(/controller\(\s*\\?([\w\\]+)::class/)?.[1]?.split("\\").pop();
      const own = head.slice(0, head.indexOf(g[0]) + 1);
      const name = own.match(/->name\(\s*['"]([^'"]*)['"]/)?.[1] ?? own.match(/['"]as['"]\s*=>\s*['"]([^'"]*)['"]/)?.[1] ?? "";
      groups.push({ from: open, to: matchBracket(text, open), prefix, ...(controller ? { controller } : {}), middleware: middlewareIn(own), name });
    }
    const ctx = (at: number) => groups.filter((g) => g.from < at && at < g.to).sort((a, b) => a.from - b.from);
    const imports = new Map<string, string>();
    for (const u of text.matchAll(/^use\s+\\?([\w\\]+?)(?:\s+as\s+(\w+))?\s*;/gm)) imports.set(u[2] ?? u[1]!.split("\\").pop()!, u[1]!);
    const fileOf = (cls: string) => {
      const fq = imports.get(cls);
      return fq ? (analysis.imports.find((e) => e.from === p && e.specifier === fq)?.resolved ?? undefined) : undefined;
    };
    // `use …\Admin\ArticlesController as AdminArticlesController`: handlers are named by the real class.
    const real = (alias: string) => imports.get(alias)?.split("\\").pop() ?? alias;
    const urlFor = (at: number, path: string) => joinUrl(filePrefix, ...ctx(at).map((g) => g.prefix), path).replace(/\{(\w+)(\?)?\}/g, ":$1$2");
    const kindFor = (url: string) => (WEBHOOK.test(url) ? "webhook" : isApi ? "api" : "page");

    for (const r of text.matchAll(/Route::(get|post|put|patch|delete|options|any|match|view|redirect)\s*\(/g)) {
      const args = callArgs(text, r.index! + r[0].length - 1);
      const verbs = r[1] === "match" ? (args.shift()?.text.match(/['"](\w+)['"]/g) ?? []).map((v) => v.replace(/['"]/g, "").toUpperCase()) : r[1] === "any" ? ["ANY"] : r[1] === "view" || r[1] === "redirect" ? ["GET"] : [r[1]!.toUpperCase()];
      const path = args[0]?.text.match(/^['"]([^'"]*)['"]/)?.[1];
      if (path === undefined) continue;
      const action = args[1]?.text ?? "";
      const url = urlFor(r.index!, path);
      const line = lineOf(text, r.index!);
      const close = matchBracket(text, r.index! + r[0].length - 1);
      const end = text.indexOf(";", close);
      const tail = text.slice(close, end < 0 ? undefined : end);
      const enclosing = ctx(r.index!);
      const middleware = [...(mount?.middleware ?? []), ...enclosing.flatMap((g) => g.middleware), ...middlewareIn(tail)];
      const ownName = tail.match(/->name\(\s*['"]([^'"]*)['"]/)?.[1];
      const name = ownName !== undefined ? (mount?.name ?? "") + enclosing.map((g) => g.name).join("") + ownName : undefined;
      const base = { kind: kindFor(url) as RouteKind, path: url, methods: verbs, file: p, line, ...(middleware.length ? { middleware: [...new Set(middleware)] } : {}), ...(name ? { name } : {}) };
      let m: RegExpMatchArray | null;
      if (r[1] === "view") push({ ...base, kind: "page", handler: `view ${args[1]?.text.replace(/['"]/g, "") ?? ""}` });
      else if ((m = action.match(/^\[\s*\\?([\w\\]+)::class\s*,\s*['"](\w+)['"]\s*\]/))) {
        const cls = m[1]!.split("\\").pop()!;
        push({ ...base, handler: `${real(cls)}.${m[2]}`, ...(fileOf(cls) ? { handlerFile: fileOf(cls) } : {}) });
      } else if ((m = action.match(/^['"]([\w\\]+)@(\w+)['"]/))) push({ ...base, handler: `${m[1]!.split("\\").pop()}.${m[2]}` });
      else if ((m = action.match(/^\\?([\w\\]+)::class$/))) {
        const cls = m[1]!.split("\\").pop()!;
        push({ ...base, handler: `${real(cls)}.__invoke`, ...(fileOf(cls) ? { handlerFile: fileOf(cls) } : {}) });
      } else if ((m = action.match(/^['"](\w+)['"]$/)) && ctx(r.index!).some((g) => g.controller)) {
        const cls = ctx(r.index!).reverse().find((g) => g.controller)!.controller!;
        push({ ...base, handler: `${real(cls)}.${m[1]}`, ...(fileOf(cls) ? { handlerFile: fileOf(cls) } : {}) });
      } else if (isInlineFn(action)) {
        const start = args[1]!.start;
        const end = matchBracket(text, text.indexOf("{", start) >= 0 && text.indexOf("{", start) < text.indexOf(";", start) ? text.indexOf("{", start) : start);
        push({ ...base, handler: "closure", inline: [lineOf(text, start), lineOf(text, end)] });
      }
    }
    // Resource controllers expand to the standard actions.
    for (const r of text.matchAll(/Route::(apiResource|resource)s?\s*\(\s*['"]([^'"]+)['"]\s*,\s*\\?([\w\\]+)::class/g)) {
      const cls = r[3]!.split("\\").pop()!;
      const name = r[2]!;
      const param = `{${name.split(".").pop()!.replace(/s$/, "")}}`;
      const actions: [string, string, string][] = [["GET", "", "index"], ...(r[1] === "resource" ? [["GET", "create", "create"] as [string, string, string]] : []), ["POST", "", "store"], ["GET", param, "show"], ...(r[1] === "resource" ? [["GET", `${param}/edit`, "edit"] as [string, string, string]] : []), ["PUT", param, "update"], ["DELETE", param, "destroy"]];
      for (const [verb, sub, action] of actions) {
        const url = urlFor(r.index!, `${name.replace(/\./g, "/")}/${sub}`);
        const mw = [...new Set([...(mount?.middleware ?? []), ...ctx(r.index!).flatMap((g) => g.middleware)])];
        const rn = (mount?.name ?? "") + ctx(r.index!).map((g) => g.name).join("") + `${name}.${action}`;
        push({ kind: kindFor(url) as RouteKind, path: url, methods: [verb], file: p, line: lineOf(text, r.index!), handler: `${real(cls)}.${action}`, ...(fileOf(cls) ? { handlerFile: fileOf(cls) } : {}), ...(mw.length ? { middleware: mw } : {}), name: rn });
      }
    }
    // routes/console.php: Artisan::command('name', fn) and scheduled commands.
    for (const c of text.matchAll(/Artisan::command\s*\(\s*['"]([^'"\s]+)/g)) push({ kind: "job", path: `artisan ${c[1]}`, file: p, line: lineOf(text, c.index!), handler: "closure", inline: [lineOf(text, c.index!), lineOf(text, matchBracket(text, text.indexOf("(", c.index!)))] });
    for (const c of text.matchAll(/Schedule::(?:command|job)\s*\(\s*([^)]+)\)\s*->\s*(\w+)/g)) push({ kind: "job", path: `scheduled ${c[1]!.replace(/['"]|::class|new\s+/g, "").trim()} (${c[2]})`, file: p, line: lineOf(text, c.index!), handler: c[1]!.match(/(\w+)::class/)?.[1] ? `${c[1]!.match(/(\w+)::class/)![1]}.handle` : "schedule" });
  }
  // Artisan commands and queued jobs defined as classes.
  for (const p of files.filter((f) => f.endsWith(".php") && /(^|\/)app\/(Console\/Commands|Jobs)\//.test(f))) {
    const text = await read(p);
    const cls = text.match(/class\s+(\w+)/)?.[1];
    if (!cls || /\babstract\s+class\b/.test(text)) continue;
    const sig = text.match(/\$signature\s*=\s*['"]([^'"\s]+)/)?.[1] ?? text.match(/#\[AsCommand\(\s*(?:name:\s*)?['"]([^'"]+)/)?.[1];
    if (sig) push({ kind: "job", path: `artisan ${sig}`, file: p, line: lineOf(text, text.indexOf("class ")), handler: `${cls}.handle` });
    else if (/ShouldQueue/.test(text)) push({ kind: "job", path: `queued ${cls}`, file: p, line: lineOf(text, text.indexOf("class ")), handler: `${cls}.handle` });
  }
}

// ---------- Symfony ----------

async function symfonyRoutes(files: string[], read: Read, lineOf: LineOf, push: Push): Promise<void> {
  for (const p of files.filter((f) => f.endsWith(".php"))) {
    const text = await read(p);
    const classIdx = text.search(/^\s*(?:final\s+|abstract\s+)*class\s+\w+/m);
    if (classIdx >= 0 && /#\[Route\(|@Route\(/.test(text)) {
      const cls = text.slice(classIdx).match(/class\s+(\w+)/)![1]!;
      const before = text.slice(0, classIdx);
      const prefix = [...before.matchAll(/(?:#\[Route|@Route)\(\s*(?:path:\s*)?['"]([^'"]*)['"]/g)].pop()?.[1] ?? "";
      for (const m of text.slice(classIdx).matchAll(/(?:#\[Route|@Route)\(([^)]*)\)\]?[\s\S]*?function\s+(\w+)\s*\(/g)) {
        const args = m[1]!;
        const sub = args.match(/^\s*(?:path:\s*)?['"]([^'"]*)['"]/)?.[1] ?? "";
        const methods = (args.match(/methods\s*[:=]\s*[[{]([^\]}]*)/)?.[1]?.match(/\w+/g) ?? ["ANY"]).map((x) => x.toUpperCase());
        const url = joinUrl(prefix, sub).replace(/\{(\w+)\}/g, ":$1");
        push({ kind: WEBHOOK.test(url) ? "webhook" : /api/.test(url) || /JsonResponse/.test(text) ? "api" : "page", path: url, methods, file: p, line: lineOf(text, classIdx + m.index!), handler: `${cls}.${m[2]}` });
      }
    }
    const cmd = text.match(/#\[AsCommand\(\s*(?:name:\s*)?['"]([^'"]+)/);
    if (cmd && classIdx >= 0) push({ kind: "job", path: `console ${cmd[1]}`, file: p, line: lineOf(text, cmd.index!), handler: `${text.slice(classIdx).match(/class\s+(\w+)/)![1]}.execute` });
  }
}

// ---------- NestJS ----------

async function nestRoutes(files: string[], read: Read, lineOf: LineOf, push: Push): Promise<void> {
  let global = "";
  for (const p of files.filter((f) => /\.(ts|js)$/.test(f))) {
    const text = await read(p);
    global = text.match(/setGlobalPrefix\(\s*['"`]([^'"`]+)/)?.[1] ?? global;
  }
  for (const p of files.filter((f) => /\.(ts|js)$/.test(f))) {
    const text = await read(p);
    const ctrl = text.match(/@Controller\(\s*(?:['"`]([^'"`]*)['"`]|\{[^}]*path:\s*['"`]([^'"`]*)['"`][^}]*\})?\s*\)\s*(?:@\w+\([^)]*\)\s*)*export\s+(?:default\s+)?class\s+(\w+)/);
    if (ctrl) {
      const prefix = ctrl[1] ?? ctrl[2] ?? "";
      const cls = ctrl[3]!;
      for (const m of text.matchAll(/@(Get|Post|Put|Patch|Delete|All|Head|Options)\(\s*(?:['"`]([^'"`]*)['"`])?\s*\)(?:\s*@\w+(?:\([^)]*\))?)*\s*(?:public\s+|async\s+)*(\w+)\s*\(/g)) {
        const url = joinUrl(global, prefix, m[2] ?? "");
        push({ kind: WEBHOOK.test(url) ? "webhook" : "api", path: url, methods: [m[1]!.toUpperCase()], file: p, line: lineOf(text, m.index!), handler: `${cls}.${m[3]}` });
      }
    }
    const cls = text.match(/export\s+(?:default\s+)?class\s+(\w+)/)?.[1];
    for (const m of text.matchAll(/@(Cron|Interval|Process|OnEvent|Processor)\(([^)]*)\)\s*(?:async\s+)?(\w+)\s*\(/g)) {
      const what = m[2]!.replace(/['"`]/g, "").trim();
      push({ kind: "job", path: `${m[1] === "OnEvent" ? "event" : m[1] === "Cron" || m[1] === "Interval" ? "scheduled" : "queue"} ${m[3]}${what ? ` (${what})` : ""}`, file: p, line: lineOf(text, m.index!), handler: cls ? `${cls}.${m[3]}` : m[3]! });
    }
  }
}

// ---------- Express, Fastify, Hono, Koa ----------

const SERVER_PKG = /['"](express|fastify|hono|koa|@koa\/router|koa-router|express-promise-router)(\/[\w-]+)?['"]/;

async function nodeRoutes(files: string[], read: Read, lineOf: LineOf, push: Push, analysis: Analysis): Promise<void> {
  const js = files.filter((f) => /\.(ts|js|mjs|cjs)$/.test(f) && !/\.d\.ts$/.test(f));
  const texts = new Map<string, string>();
  for (const p of js) texts.set(p, await read(p));
  // Which identifiers in a file are routers: created from a server package, or a parameter typed/named like one.
  const routersIn = (text: string) => {
    const names = new Set<string>();
    for (const m of text.matchAll(/(?:const|let|var)\s+(\w+)\s*(?::\s*[\w.<>]+\s*)?=\s*(?:await\s+)?(?:express\s*\(\s*\)|express\.Router\s*\(|Router\s*\(|new\s+(?:Hono|Router|Koa)\b|Fastify\s*\(|fastify\s*\(|PromiseRouter\s*\()/g)) names.add(m[1]!);
    if (SERVER_PKG.test(text) || /FastifyInstance|: Router\b|: Express\b|: Application\b/.test(text)) for (const n of ["app", "router", "api", "server", "fastify", "instance", "routes"]) names.add(n);
    // Plugin and route-module files often take the server as a parameter without importing anything.
    else if (/\(\s*(fastify|app|router|server)\b[^)]*\)\s*(=>|\{)|function\s*\w*\s*\(\s*(fastify|app|router|server)\b/.test(text)) for (const n of ["app", "router", "server", "fastify"]) names.add(n);
    return names;
  };
  const resolveIdent = (file: string, text: string, ident: string): string | null => {
    const spec =
      text.match(new RegExp(`import\\s+(?:\\{[^}]*\\b${ident}\\b[^}]*\\}|${ident}|\\*\\s+as\\s+${ident})\\s*(?:,\\s*\\{[^}]*\\})?\\s+from\\s+['"]([^'"]+)['"]`))?.[1] ??
      text.match(new RegExp(`(?:const|let|var)\\s+(?:\\{[^}]*\\b${ident}\\b[^}]*\\}|${ident})\\s*=\\s*require\\(\\s*['"]([^'"]+)['"]`))?.[1];
    return spec ? (analysis.imports.find((e) => e.from === file && e.specifier === spec)?.resolved ?? null) : null;
  };
  // Mount prefixes: app.use('/api', usersRouter), app.route('/api', sub), fastify.register(plugin, { prefix: '/api' }).
  const prefix = new Map<string, string>();
  for (let pass = 0; pass < 3; pass++) {
    for (const [p, text] of texts) {
      const routers = routersIn(text);
      for (const m of text.matchAll(/\b(\w+)\.(use|route|register)\s*\(/g)) {
        if (!routers.has(m[1]!)) continue;
        const args = callArgs(text, m.index! + m[0].length - 1);
        let at = "", target: string | undefined;
        if (m[2] === "register") {
          target = args[0]?.text;
          at = args[1]?.text.match(/prefix\s*:\s*['"`]([^'"`]*)['"`]/)?.[1] ?? "";
        } else {
          at = args[0]?.text.match(/^['"`]([^'"`]*)['"`]$/)?.[1] ?? "";
          target = args[args.length - 1]?.text;
        }
        if (!at || !target) continue;
        const req = target.match(/^(?:await\s+)?(?:import|require)\(\s*['"]([^'"]+)['"]\s*\)/)?.[1];
        const file = req ? (analysis.imports.find((e) => e.from === p && e.specifier === req)?.resolved ?? null) : /^\w+$/.test(target) ? resolveIdent(p, text, target) : null;
        if (file && file !== p) prefix.set(file, joinUrl(prefix.get(p) ?? "", at));
      }
    }
  }
  for (const [p, text] of texts) {
    const routers = routersIn(text);
    if (!routers.size) continue;
    for (const m of text.matchAll(/\b(\w+)\.(get|post|put|patch|delete|all|options|head)\s*\(\s*(['"`])([^'"`]*)\3/g)) {
      if (!routers.has(m[1]!) || !(m[4]!.startsWith("/") || m[4] === "*" || m[4] === "")) continue;
      const args = callArgs(text, text.indexOf("(", m.index! + m[1]!.length + m[2]!.length));
      const last = args[args.length - 1];
      if (!last || args.length < 2) continue;
      const url = joinUrl(prefix.get(p) ?? "", m[4]!).replace(/\{(\w+)\}/g, ":$1");
      const base = { kind: (WEBHOOK.test(url) ? "webhook" : "api") as RouteKind, path: url, methods: [m[2]!.toUpperCase().replace("ALL", "ANY")], file: p, line: lineOf(text, m.index!) };
      if (isInlineFn(last.text)) push({ ...base, handler: "inline handler", inline: [lineOf(text, last.start), lineOf(text, last.start + last.text.length)] });
      else push({ ...base, handler: handlerLabel(last.text) });
    }
    // fastify.route({ method: 'GET', url: '/x', handler })
    for (const m of text.matchAll(/\b(\w+)\.route\s*\(\s*\{/g)) {
      if (!routers.has(m[1]!)) continue;
      const body = text.slice(m.index!, matchBracket(text, text.indexOf("{", m.index!)) + 1);
      const url = body.match(/url\s*:\s*['"`]([^'"`]+)/)?.[1];
      if (!url) continue;
      const methods = (body.match(/method\s*:\s*(\[[^\]]*\]|['"`]\w+['"`])/)?.[1]?.match(/\w+/g) ?? ["GET"]).map((x) => x.toUpperCase());
      const h = body.match(/handler\s*:\s*([\w.]+)/)?.[1] ?? (/\bhandler\s*[,}]/.test(body) ? "handler" : "inline handler");
      const full = joinUrl(prefix.get(p) ?? "", url);
      push({ kind: WEBHOOK.test(full) ? "webhook" : "api", path: full, methods, file: p, line: lineOf(text, m.index!), handler: h, ...(h === "inline handler" ? { inline: [lineOf(text, m.index!), lineOf(text, m.index! + body.length)] as [number, number] } : {}) });
    }
  }
}

/** `controller.list`, `this.list.bind(this)` → the function; a factory call like `cors()` → "cors(…)". */
function handlerLabel(arg: string): string {
  const t = arg.replace(/\.bind\([^)]*\)$/, "").replace(/^this\./, "").trim();
  if (/^[\w$.]+$/.test(t)) return t;
  const callee = t.match(/^([\w$.]+)\s*\(/)?.[1];
  return callee ? `${callee}(…)` : t.split("\n")[0]!.slice(0, 40);
}

/** Background work in Node apps: node-cron schedules and BullMQ workers. */
async function nodeJobs(files: string[], read: Read, lineOf: LineOf, push: Push): Promise<void> {
  for (const p of files.filter((f) => /\.(ts|js|mjs|cjs)$/.test(f) && !/\.d\.ts$/.test(f))) {
    const text = await read(p);
    if (!/node-cron|bullmq|['"]cron['"]/.test(text)) continue;
    for (const m of text.matchAll(/\bcron\.schedule\s*\(\s*['"`]([^'"`]+)['"`]/g)) {
      const args = callArgs(text, text.indexOf("(", m.index!));
      const h = args[1]?.text ?? "";
      push({ kind: "job", path: `scheduled (${m[1]})`, file: p, line: lineOf(text, m.index!), handler: isInlineFn(h) ? "inline handler" : h, ...(isInlineFn(h) ? { inline: [lineOf(text, args[1]!.start), lineOf(text, args[1]!.start + h.length)] as [number, number] } : {}) });
    }
    for (const m of text.matchAll(/new\s+Worker\s*\(\s*['"`]([^'"`]+)['"`]/g)) {
      const args = callArgs(text, text.indexOf("(", m.index!));
      const h = args[1]?.text ?? "";
      push({ kind: "job", path: `queue ${m[1]}`, file: p, line: lineOf(text, m.index!), handler: isInlineFn(h) ? "inline handler" : h, ...(isInlineFn(h) ? { inline: [lineOf(text, args[1]!.start), lineOf(text, args[1]!.start + h.length)] as [number, number] } : {}) });
    }
  }
}
