import path from "node:path";
import type { SymbolIndex } from "../symbols/index.js";
import type { CallGraph, GraphEdge, GraphNode } from "./graph.js";
import type { Route } from "./routes.js";

export interface TraceStep {
  node: string; // graph node id
  name: string;
  file?: string;
  line?: number;
  endLine?: number;
  depth: number; // 0 is the handler
  parent?: number; // index of the calling step
  callLine?: number; // where the parent calls this, in the parent's file
  kind?: GraphEdge["kind"];
  via?: GraphEdge["via"];
  cond?: string; // only runs in this branch of its caller
  external?: { name: string; category?: string };
  repeat?: boolean; // already shown earlier; not expanded again
}

export interface Trace {
  route: Route;
  steps: TraceStep[];
  truncated: boolean; // stopped at the depth or step limit
  files: string[]; // files touched, in first-visit order
  externals: string[]; // outside services reached
}

/**
 * What runs when an entry point is hit: a depth-first walk of the call graph from its handler.
 * Calls are visited in the order they're written, so the steps read top to bottom like the code.
 */
export function traceRoute(graph: CallGraph, symbols: SymbolIndex, route: Route, opts: { maxDepth?: number; maxSteps?: number } = {}): Trace {
  const maxDepth = opts.maxDepth ?? 6;
  const maxSteps = opts.maxSteps ?? 40;
  const start = route.inline ? inlineNode(graph, route) : handlerNode(graph, symbols, route);
  const steps: TraceStep[] = [];
  let truncated = false;
  if (!start) return { route, steps, truncated, files: [route.file], externals: [] };

  const shown = new Set<string>();
  const visit = (n: GraphNode, depth: number, parent?: number, edge?: GraphEdge) => {
    if (steps.length >= maxSteps) {
      truncated = true;
      return;
    }
    const repeat = shown.has(n.id);
    const idx = steps.push({
      node: n.id, name: n.name, file: n.file, line: n.line, endLine: n.endLine, depth, parent,
      callLine: edge?.line, kind: edge?.kind, via: edge?.via, ...(edge?.cond ? { cond: edge.cond } : {}), external: n.external, ...(repeat ? { repeat } : {}),
    }) - 1;
    if (repeat || n.external) return;
    shown.add(n.id);
    const edges = [...(graph.out.get(n.id) ?? [])].sort((a, b) => a.line - b.line || (a.end ?? 0) - (b.end ?? 0));
    if (depth >= maxDepth) {
      if (edges.length) truncated = true;
      return;
    }
    for (const e of edges) {
      const to = graph.nodes.get(e.to);
      if (to) visit(to, depth + 1, idx, e);
    }
  };
  visit(start, 0);
  const files = [...new Set(steps.map((s) => s.file).filter((f): f is string => Boolean(f)))];
  const externals = [...new Set(steps.filter((s) => s.external).map((s) => s.name))];
  return { route, steps, truncated, files, externals };
}

/** An inline handler (`router.get("/x", async (req, res) => …)`): the file's own calls within its lines. */
function inlineNode(graph: CallGraph, route: Route): GraphNode | undefined {
  const mod = graph.nodes.get(`${route.file}#(module)`);
  const [from, to] = route.inline!;
  const id = `${route.file}#(inline:${from})`;
  if (!graph.nodes.has(id)) {
    graph.nodes.set(id, { id, file: route.file, name: route.handler, line: from, endLine: to });
    graph.out.set(id, (graph.out.get(mod?.id ?? "") ?? []).filter((e) => e.line >= from && e.line <= to).map((e) => ({ ...e, from: id })));
  }
  return graph.nodes.get(id);
}

const TEST_FILE = /(^|\/)(tests?|__tests__|spec|specs|e2e|fixtures?)\/|\.(test|spec|e2e|integration)\.[cm]?[jt]sx?$|(^|\/)test_[^/]+\.py$|_test\.(py|go)$/i;

function handlerNode(graph: CallGraph, symbols: SymbolIndex, route: Route): GraphNode | undefined {
  const all = [...graph.nodes.values()];
  if (route.pinned && route.handlerFile) {
    const pinned = graph.find(route.handlerFile, route.handler) ?? all.find((n) => n.file === route.handlerFile && (n.name === route.handler || n.name.endsWith(`.${route.handler.split(".").pop()}`)));
    if (pinned) return pinned;
  }
  const inFile = all.filter((n) => n.file === route.file);
  const exact = inFile.find((n) => n.name === route.handler) ?? inFile.find((n) => n.name.endsWith(`.${route.handler.split(".").pop()}`) && route.handler.includes(".") === n.name.includes("."));
  if (exact) return exact;
  // "OrderController.show" declared in a routes file: the controller method, wherever it lives.
  if (route.handler.includes(".")) {
    const hits = all.filter((n) => n.name === route.handler && !n.external);
    if (hits.length) return hits.sort((a, b) => Number(Boolean(b.file?.includes(route.handlerFile ?? "\0"))) - Number(Boolean(a.file?.includes(route.handlerFile ?? "\0"))))[0];
  }
  const method = inFile.find((n) => n.name.split(".").pop() === route.handler);
  if (method) return method;
  // `authController.login` (an object of handlers imported through a barrel): `login` in a file named like
  // the object (auth.controller.js), or the only function called `login` in the repo.
  const [obj, fn] = route.handler.includes(".") ? (route.handler.split(".").slice(-2) as [string, string]) : [undefined, undefined];
  if (obj && fn) {
    // The object's own file, when the route file says where it comes from (imported, or built by a factory).
    if (route.handlerFile || route.factory) {
      const real = all.filter((n) => !n.external && n.file && !TEST_FILE.test(n.file));
      // The factory or class itself; through a barrel (`from "../controllers"` → index.ts) it lives in another file.
      const makers = route.factory ? real.filter((n) => n.name === route.factory) : [];
      const homes = [...new Set([route.handlerFile, ...makers.map((n) => n.file)].filter((f): f is string => Boolean(f)))];
      for (const home of homes) {
        const own = real.find((n) => n.file === home && (n.name === fn || n.name === `${route.factory}.${fn}` || (!route.factory && n.name.endsWith(`.${fn}`))));
        if (own) return own;
      }
      // A handler written in a way that has no node of its own: start from the factory, which holds its code.
      const maker = makers.find((n) => homes.includes(n.file!)) ?? makers[0];
      if (maker) return maker;
    }
    const key = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
    // Tests often define helpers with the same names (`route`, `list`); they never handle a real request.
    const named = all.filter((n) => n.name === fn && !n.external && n.file && !TEST_FILE.test(n.file));
    const byFile = named.find((n) => key(path.posix.basename(n.file!).replace(/\.[^.]+$/, "")) === key(obj));
    if (byFile) return byFile;
    if (named.length === 1) return named[0];
  }
  // Django: urls.py names a view defined elsewhere; prefer one in the same app.
  const dir = path.posix.dirname(route.file);
  const hits = symbols.find(route.handler.split(".")[0]!).filter((h) => !TEST_FILE.test(h.file)).sort((a, b) => Number(path.posix.dirname(b.file) === dir) - Number(path.posix.dirname(a.file) === dir));
  const hit = hits[0];
  if (!hit) return undefined;
  return graph.find(hit.file, hit.symbol.name) ?? [...graph.nodes.values()].find((n) => n.file === hit.file && n.name.split(".").pop() === hit.symbol.name);
}
