import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Analysis } from "../types.js";
import { canExtract } from "../symbols/extract.js";
import { CATALOG } from "../scan/integrations.js";
import { extractCalls, type FileCalls } from "../symbols/calls.js";
import type { SymbolDef, SymbolIndex } from "../symbols/index.js";

/** A function, method or component in the call graph, or an outside service it reaches. */
export interface GraphNode {
  id: string; // "file#name", "file#Class.method", or "ext:<name>"
  file?: string;
  name: string;
  line?: number;
  endLine?: number;
  external?: { name: string; category?: string }; // a package/integration rather than repo code
}

export interface GraphEdge {
  from: string;
  to: string;
  line: number; // where the call is written, in the caller's file
  kind: "call" | "render" | "new";
  via: "import" | "local" | "name"; // how the target was resolved; "name" is a unique-name guess
  cond?: string; // the branch the call sits in ("if $x->paid()", "else", "match $status", "catch")
  end?: number; // source offset where the call ends, to order calls on one line
}

export interface CallGraph {
  nodes: Map<string, GraphNode>;
  out: Map<string, GraphEdge[]>;
  /** The node for a named symbol in a file, if it exists. */
  find(file: string, name: string): GraphNode | undefined;
}

const CACHE_VERSION = 7; // 7: handler-shaped arrow properties are nodes; 2: CommonJS require bindings; 3: branch conditions on edges; 4: typed PHP receivers
const CALLABLE = new Set(["function", "method", "class"]);
// Names too common to resolve by name alone: they would link unrelated code.
const GENERIC = new Set(["get", "set", "add", "map", "find", "filter", "update", "save", "delete", "create", "run", "init", "handle", "render", "toString", "push", "call", "apply", "then", "catch"]);

// Framework APIs worth showing in a trace (they're what the official docs explain): next/cache, django.shortcuts…
const FRAMEWORK = /^(next(\/|$)|react(-dom|-native)?(\/|$)|expo(-[\w-]+)?(\/|$)|@expo\/|django(\.|$)|rest_framework(\.|$)|org\.springframework\.|Illuminate\\|Symfony\\|express(\/|$)|fastify(\/|$)|@nestjs\/|hono(\/|$)|koa(\/|$)|node:)/;

const nodeId = (file: string, s: SymbolDef) => `${file}#${s.container && s.kind === "method" ? `${s.container}.${s.name}` : s.name}`;

/**
 * A function-level call graph: which function calls (or renders) which, resolved through each
 * file's imports. Resolution is static and best-effort; edges say how they were resolved so the
 * UI can mark guesses. Per-file call extraction is cached by file hash like symbols.
 */
export async function buildCallGraph(rootDir: string, analysis: Analysis, symbols: SymbolIndex): Promise<CallGraph> {
  const root = path.resolve(rootDir);
  const calls = await fileCalls(root, analysis);
  const nodes = new Map<string, GraphNode>();
  const byFile = new Map<string, GraphNode[]>();
  for (const [file, defs] of symbols.byFile) {
    const list: GraphNode[] = [];
    for (const s of defs) {
      // Top-level consts count too: `const login = catchAsync(async (req, res) => …)` is a function in all but syntax.
      if (!CALLABLE.has(s.kind) && !(s.kind === "variable" && !s.container)) continue;
      const n: GraphNode = { id: nodeId(file, s), file, name: s.container && s.kind === "method" ? `${s.container}.${s.name}` : s.name, line: s.line, endLine: s.endLine };
      nodes.set(n.id, n);
      list.push(n);
    }
    byFile.set(file, list);
  }
  const exportsOf = (file: string, name: string, seen = new Set<string>()): GraphNode | undefined => {
    if (seen.has(file)) return undefined;
    seen.add(file);
    const defs = symbols.byFile.get(file) ?? [];
    const dflt = calls.get(file)?.defaultExport;
    const hit = name === "default" ? defs.find((d) => d.name === dflt && !d.container) : defs.find((d) => d.name === name && d.exported && !d.container);
    if (hit) return nodes.get(nodeId(file, hit));
    // Follow barrel re-exports (`export { x } from "./y"`, `export * from "./y"`).
    for (const b of calls.get(file)?.bindings ?? []) {
      if (!b.reexport || (b.local !== name && b.local !== "*")) continue;
      const target = resolveSource(analysis, file, b.source);
      const found = target && exportsOf(target, b.local === "*" ? name : b.imported, seen);
      if (found) return found;
    }
    return undefined;
  };
  const integrationOf = new Map<string, { name: string; category: string }>();
  for (const i of analysis.integrations) for (const p of i.packages) integrationOf.set(p, { name: i.name, category: i.category });

  const out = new Map<string, GraphEdge[]>();
  const add = (e: GraphEdge, keepRepeats = false) => {
    const list = out.get(e.from) ?? [];
    // A file's top-level calls keep every occurrence: each inline handler needs its own lines.
    if (keepRepeats || !list.some((x) => x.to === e.to)) list.push(e);
    out.set(e.from, list);
  };
  // Where a PHP class lives, as seen from one file: its `use` import, else a class of that name in the same
  // folder (same namespace), else the only class of that name in the repo.
  const classFile = (from: string, name: string): string | undefined => {
    const b = calls.get(from)?.bindings.find((x) => x.local === name && !x.reexport);
    if (b) return resolveSource(analysis, from, b.source) ?? undefined;
    const classes = symbols.find(name).filter((h) => (h.symbol.kind === "class" || h.symbol.kind === "interface") && !h.symbol.container);
    const dir = path.posix.dirname(from);
    return (classes.find((h) => path.posix.dirname(h.file) === dir) ?? (classes.length === 1 ? classes[0] : undefined))?.file;
  };
  // Declared return types across the repo, resolved where they're declared, so `$x->order()->recalculate()`
  // knows which Order `order()` gives back even in a file that never imports it.
  const returnType = new Map<string, { name: string; file?: string }>();
  for (const [file, fc] of calls) for (const r of fc.returns ?? []) returnType.set(r.method, { name: r.type, file: classFile(file, r.type) });
  const classOf = (head: string): { name: string; file?: string } | null => {
    const m = /^ret\((.*)\|(\w+)\)$/.exec(head);
    if (!m) return { name: head };
    const inner = classOf(m[1]!);
    if (!inner) return null;
    // Undeclared return type: assume a fluent builder (returns itself). Kept only if the next method exists on it.
    return returnType.get(`${inner.name}.${m[2]}`) ?? inner;
  };
  for (const [file, fc] of calls) {
    const local = byFile.get(file) ?? [];
    // Calls outside any named function (inline route handlers, top-level setup) belong to the file itself,
    // so a trace can start from the lines of an inline handler.
    const moduleNode: GraphNode = { id: `${file}#(module)`, file, name: path.posix.basename(file), line: 1, endLine: Number.MAX_SAFE_INTEGER };
    const enclosing = (line: number) => {
      let best: GraphNode | undefined;
      for (const n of local) if (n.line! <= line && line <= n.endLine! && (!best || n.line! >= best.line!)) best = n;
      if (!best && !nodes.has(moduleNode.id)) nodes.set(moduleNode.id, moduleNode);
      return best ?? moduleNode;
    };
    const bindings = new Map(fc.bindings.filter((b) => !b.reexport).map((b) => [b.local, b]));
    for (const c of fc.calls) {
      const from = enclosing(c.line);
      if (!from) continue;
      const dot = c.callee.lastIndexOf(".");
      const rawHead = dot >= 0 ? c.callee.slice(0, dot) : c.callee;
      const prop = dot >= 0 ? c.callee.slice(dot + 1) : undefined;
      const typed = classOf(rawHead);
      const head = typed?.name ?? "";
      let to: GraphNode | undefined;
      let via: GraphEdge["via"] = "import";
      const b = bindings.get(head);
      if (b) {
        const target = resolveSource(analysis, file, b.source);
        if (target) {
          // CommonJS files export with `module.exports = …`, which isn't an `export`: fall back to a top-level
          // function of that name in the target file.
          const topLevel = (name: string) => nodes.get(`${target}#${name}`);
          if (b.imported === "*") to = prop ? (exportsOf(target, prop) ?? topLevel(prop)) : (exportsOf(target, "default") ?? topLevel(head));
          // `Billing::charge()` / `Billing.charge()` on an imported class: that class's method.
          else if (prop) to = nodes.get(`${target}#${b.imported}.${prop}`) ?? exportsOf(target, prop);
          else to = exportsOf(target, b.imported) ?? topLevel(b.imported);
        }
        else {
          // A third-party package: show it as an outside service when it's a known integration.
          const pkg = packageName(b.source);
          // PHP SDKs are known by namespace (Stripe\StripeClient), not package name.
          const phpEntry = file.endsWith(".php") ? CATALOG.find((e) => e.php?.test(b.source)) : undefined;
          const integ = integrationOf.get(pkg) ?? (phpEntry ? { name: phpEntry.name, category: phpEntry.category } : undefined);
          if (integ) to = ensureExternal(nodes, integ.name, integ.category);
          else if (FRAMEWORK.test(b.source)) {
            // JS names the imported API (next/server · NextResponse); PHP facades name the method (Cache · remember).
            const api = file.endsWith(".php") && prop ? prop : b.imported === "*" || b.imported === "default" ? (prop ?? head) : b.imported;
            to = ensureExternal(nodes, `${b.source} · ${api}`, "framework", `fw:${b.source}#${api}`);
          }
        }
      } else if (prop && file.endsWith(".php") && LARAVEL_ALIASES.has(head)) {
        // `\Log::info()` without a use statement: Laravel's global facade aliases.
        to = ensureExternal(nodes, `Illuminate\\Support\\Facades\\${head} · ${prop}`, "framework", `fw:Illuminate\\Support\\Facades\\${head}#${prop}`);
      } else if (prop && file.endsWith(".php") && /^[A-Z]/.test(head)) {
        // A class known from a return type, or from the same namespace (no use statement needed).
        const where = typed?.file ?? classFile(file, head);
        if (where) to = nodes.get(`${where}#${head}.${prop}`);
      } else if (!prop) {
        via = "local";
        to = local.find((n) => n.name === head && n !== from);
        if (!to && c.callee === "fetch") {
          // Plain fetch in a file that talks to an SDK-less integration (found by its env vars) is that service.
          const svc = analysis.integrations.find((i) => i.detectedBy.length === 1 && i.detectedBy[0] === "env" && i.files.includes(file));
          to = svc ? ensureExternal(nodes, svc.name, svc.category) : ensureExternal(nodes, "HTTP (fetch)", "http-client");
        }
      } else if (head === "this" || head === "self") {
        via = "local";
        const cls = from.name.includes(".") ? from.name.split(".")[0] : undefined;
        to = cls ? local.find((n) => n.name === `${cls}.${prop}`) : undefined;
      }
      if (!to && prop && !GENERIC.has(prop) && head !== "this" && head !== "self") {
        // `service.charge()` on an injected field or a barrel-exported object: link only when the name is unique.
        const hits = symbols.find(prop).filter((h) => (h.symbol.kind === "method" || h.symbol.kind === "function" || (h.symbol.kind === "variable" && !h.symbol.container)) && nodeId(h.file, h.symbol) !== from.id);
        if (hits.length === 1) {
          via = "name";
          to = nodes.get(nodeId(hits[0]!.file, hits[0]!.symbol));
        }
      }
      if (to && to !== from) add({ from: from.id, to: to.id, line: c.line, kind: c.kind, via, ...(c.cond ? { cond: c.cond } : {}), ...(c.end != null ? { end: c.end } : {}) }, from === moduleNode);
    }
  }
  return { nodes, out, find: (file, name) => nodes.get(`${file}#${name}`) };
}

// Laravel's global aliases (config/app.php): `\Log::info()` works without importing the facade.
const LARAVEL_ALIASES = new Set(["App", "Arr", "Artisan", "Auth", "Blade", "Broadcast", "Bus", "Cache", "Config", "Cookie", "Crypt", "Date", "DB", "Event", "File", "Gate", "Hash", "Http", "Lang", "Log", "Mail", "Notification", "Password", "Process", "Queue", "RateLimiter", "Redirect", "Redis", "Request", "Response", "Route", "Schema", "Session", "Storage", "Str", "URL", "Validator", "View"]);

function ensureExternal(nodes: Map<string, GraphNode>, name: string, category?: string, id = `ext:${name}`): GraphNode {
  let n = nodes.get(id);
  if (!n) {
    n = { id, name, external: { name, category } };
    nodes.set(id, n);
  }
  return n;
}

function packageName(spec: string): string {
  const parts = spec.split("/");
  return spec.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0]!;
}

/** The repo file an import specifier in `file` resolves to (from the scan's import edges). */
export function resolveSource(analysis: Analysis, file: string, source: string): string | null {
  const edge = analysis.imports.find((e) => e.from === file && e.specifier === source);
  if (edge?.resolved) {
    if (analysis.files.some((f) => f.path === edge.resolved)) return edge.resolved;
    // A directory (Python package, JVM wildcard): its __init__/index file.
    const idx = analysis.files.find((f) => /\/(index\.[jt]sx?|__init__\.py)$/.test(f.path) && path.posix.dirname(f.path) === edge.resolved);
    return idx?.path ?? null;
  }
  return null;
}

async function fileCalls(root: string, analysis: Analysis): Promise<Map<string, FileCalls>> {
  const cachePath = path.join(root, ".houserules", "cache", "calls.json");
  let cache: { version: number; files: Record<string, { sha256: string; calls: FileCalls }> } = { version: CACHE_VERSION, files: {} };
  try {
    const loaded = JSON.parse(await readFile(cachePath, "utf8"));
    if (loaded.version === CACHE_VERSION) cache = loaded;
  } catch {
    // no cache yet
  }
  const result = new Map<string, FileCalls>();
  const next: typeof cache = { version: CACHE_VERSION, files: {} };
  let changed = false;
  for (const f of analysis.files) {
    if (!canExtract(f.path) || /\.kts?$/.test(f.path)) continue;
    const hit = cache.files[f.path];
    let fc: FileCalls;
    if (hit && hit.sha256 === f.sha256) fc = hit.calls;
    else {
      changed = true;
      try {
        fc = await extractCalls(f.path, await readFile(path.join(root, f.path), "utf8"));
      } catch {
        fc = { bindings: [], calls: [] };
      }
    }
    result.set(f.path, fc);
    next.files[f.path] = { sha256: f.sha256, calls: fc };
  }
  if (changed) {
    await mkdir(path.dirname(cachePath), { recursive: true });
    await writeFile(cachePath, JSON.stringify(next));
  }
  return result;
}
