import path from "node:path";
import type { Analysis } from "../types.js";
import { isTestFile } from "../scan/tooling.js";

export interface ArchNode {
  id: string;
  label: string; // path relative to the common source root, e.g. "lib/shopify"
  dir: string; // repo-relative directory
  files: number;
  lines: number;
}

export interface ArchEdge {
  from: string;
  to: string;
  imports: number;
}

export interface ArchService {
  id: string;
  name: string;
  category: string;
  usedBy: string[]; // node ids
  sdk: boolean;
}

export interface ArchitectureMap {
  root: string; // common source prefix that was stripped ("" for none)
  nodes: ArchNode[];
  edges: ArchEdge[];
  services: ArchService[];
}

const MIN_GROUPS = 6;
// Generated or vendored code says nothing about how the app is structured.
const GENERATED_DIRS = new Set(["migrations", "generated", "__generated__", "vendor", "node_modules", "dist", "build", "tests", "test", "__tests__", "spec", "e2e", "playwright", "cypress", "fixtures"]);
// Folders that hold separate projects in a monorepo; each child is a module of its own.
const MONOREPO_DIRS = new Set(["apps", "packages", "libs", "services", "modules", "projects", "crates"]);
const MAX_GROUPS = 14;

/**
 * Groups source files into modules (top-level folders below the common source root, split further
 * while there are too few to be interesting) and aggregates imports between them.
 */
export function architectureMap(a: Analysis): ArchitectureMap {
  // Tooling folders (.github, .semgrep, .husky…) aren't part of the application's architecture.
  const files = a.files.filter((f) => !isTestFile(f.path) && !f.path.split("/").some((p) => p.startsWith(".") || GENERATED_DIRS.has(p)));
  const dirs = files.map((f) => path.posix.dirname(f.path).split("/").filter((p) => p !== "."));
  const prefix: string[] = [];
  if (dirs.length) {
    for (let i = 0; ; i++) {
      const seg = dirs[0]![i];
      if (seg === undefined || !dirs.every((d) => d[i] === seg)) break;
      prefix.push(seg);
    }
  }
  // Keep at least one level so a single-package repo still has modules.
  const root = prefix.join("/");
  const rel = (p: string) => (root ? p.slice(root.length + 1) : p);

  // Start one level deep, then split the biggest folder into its subfolders while there are too few groups.
  const dirOf = (file: string) => rel(file).split("/").slice(0, -1);
  const keys = new Set<string>(files.map((f) => dirOf(f.path)[0] ?? "(root)"));
  const keyFor = (file: string): string => {
    const parts = dirOf(file);
    for (let d = parts.length; d >= 1; d--) {
      const k = parts.slice(0, d).join("/");
      if (keys.has(k)) return k;
    }
    return "(root)";
  };
  const splitDone = new Set<string>();
  const collapsed = new Set<string>(); // groups reached by stepping down a single-folder chain
  let dominanceUsed = false;
  const info = (k: string, fs: typeof files) => {
    const depth = k === "(root)" ? 0 : k.split("/").length;
    const dirs = fs.map((f) => dirOf(f.path));
    const children = new Set(dirs.filter((p) => p.length > depth).map((p) => p.slice(0, depth + 1).join("/")));
    const direct = dirs.some((p) => p.length === depth);
    return { k, fs, children, direct, splittable: k !== "(root)" && children.size > 0 };
  };
  for (let guard = 0; guard < 24; guard++) {
    const groups = [...groupFiles(files, keyFor).entries()].map(([k, fs]) => info(k, fs)).sort((x, y) => y.fs.length - x.fs.length);
    const largest = groups[0];
    const monorepo = groups.find((g) => MONOREPO_DIRS.has(g.k.split("/").pop()!) && !splitDone.has(g.k) && g.splittable);
    let pick;
    // A monorepo package (apps/web) is already the right unit; don't step down into its src/.
    const isPackage = (k: string) => { const p = k.split("/"); return p.length === 2 && MONOREPO_DIRS.has(p[0]!); };
    const chain = groups.find((g) => g.splittable && g.children.size === 1 && !g.direct && !splitDone.has(g.k) && !isPackage(g.k));
    const packageRoot = groups.find((g) => collapsed.has(g.k) && !splitDone.has(g.k) && g.children.size > 1 && g.children.size <= 12);
    if (monorepo) pick = monorepo; // apps/, packages/: every child is a project
    else if (chain) { pick = chain; } // src/main/java/org/acme/app: step down to where the code branches
    else if (packageRoot) pick = packageRoot; // ...then show that package's parts
    else if (!dominanceUsed && largest && largest.fs.length > files.length * 0.45 && largest.children.size <= 40) {
      // One folder dominates (src/, a single app package): open it up once. Doing it again would
      // explode plugin folders (integrations/*, graphql/*) into dozens of near-identical boxes.
      pick = largest.splittable ? largest : undefined;
      dominanceUsed = true;
    }
    else if (groups.length < MIN_GROUPS) pick = groups.find((g) => g.splittable && (g.children.size > 1 || g.direct));
    if (!pick) break;
    splitDone.add(pick.k);
    // A folder with a single subfolder and no files of its own just steps down a level (apps -> apps/web).
    if (pick.children.size === 1 && !pick.direct) {
      keys.delete(pick.k);
      for (const c of pick.children) collapsed.add(c);
      collapsed.delete(pick.k);
    }
    for (const c of pick.children) keys.add(c);
  }

  const groups = groupFiles(files, keyFor);
  let ordered = [...groups.entries()].sort((x, y) => y[1].length - x[1].length);
  if (ordered.length > MAX_GROUPS) {
    const rest = ordered.slice(MAX_GROUPS - 1).flatMap(([, fs]) => fs);
    ordered = [...ordered.slice(0, MAX_GROUPS - 1), ["(other)", rest]];
  }
  const nodeOf = new Map<string, string>();
  const nodes: ArchNode[] = ordered.map(([k, fs], i) => {
    const id = `m${i}`;
    for (const f of fs) nodeOf.set(f.path, id);
    const parts = k.split("/");
    return {
      id,
      // Long Java-style chains read better as "mall-admin/…/mall"; the full folder stays in `dir`.
      label: parts.length > 3 ? `${parts[0]}/…/${parts.slice(-2).join("/")}` : k,
      dir: k === "(root)" || k === "(other)" ? root : root ? `${root}/${k}` : k,
      files: fs.length,
      lines: fs.reduce((n, f) => n + f.lines, 0),
    };
  });

  const weights = new Map<string, number>();
  for (const e of a.imports) {
    if (!e.resolved) continue;
    const from = nodeOf.get(e.from);
    const to = nodeOf.get(e.resolved) ?? nodeOf.get(a.files.find((f) => f.path.startsWith(`${e.resolved}/`))?.path ?? "");
    if (!from || !to || from === to) continue;
    const key = `${from}>${to}`;
    weights.set(key, (weights.get(key) ?? 0) + 1);
  }
  const edges = [...weights.entries()]
    .map(([k, imports]) => {
      const [from, to] = k.split(">") as [string, string];
      return { from, to, imports };
    })
    .sort((x, y) => y.imports - x.imports)
    .slice(0, 40);

  const services: ArchService[] = a.integrations.map((i) => ({
    id: `s_${i.id}`,
    name: i.name,
    category: i.category,
    usedBy: [...new Set([...i.files, ...i.configFiles].map((f) => nodeOf.get(f)).filter((x): x is string => Boolean(x)))],
    sdk: !(i.detectedBy.length === 1 && i.detectedBy[0] === "env"),
  }));

  return { root, nodes, edges, services };
}

function groupFiles<T extends { path: string }>(files: T[], keyFor: (p: string) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const f of files) {
    const k = keyFor(f.path);
    const list = out.get(k) ?? [];
    list.push(f);
    out.set(k, list);
  }
  return out;
}

/** Mermaid flowchart for markdown (GitHub renders it). */
export function architectureMermaid(map: ArchitectureMap): string {
  const id = (s: string) => s.replace(/[^\w]/g, "_");
  const lines = ["flowchart LR"];
  for (const n of map.nodes) lines.push(`  ${n.id}["${n.label}<br/><small>${n.files} files</small>"]`);
  for (const s of map.services.filter((s) => s.usedBy.length)) lines.push(`  ${id(s.id)}(["${s.name}"])`);
  for (const e of map.edges) lines.push(`  ${e.from} -->|${e.imports}| ${e.to}`);
  for (const s of map.services) for (const u of s.usedBy) lines.push(`  ${u} -.-> ${id(s.id)}`);
  lines.push("  classDef service fill:#ecfdf8,stroke:#0f766e,color:#0d5f59");
  const svc = map.services.filter((s) => s.usedBy.length).map((s) => id(s.id));
  if (svc.length) lines.push(`  class ${svc.join(",")} service`);
  return lines.join("\n");
}

export interface FlowStep {
  file: string;
  line?: number;
  endLine?: number;
  label: string; // the symbol or note for this step
}

/** The steps of a traced flow, from its evidence in order (what the agent cited, already verified). */
export function flowSteps(evidence: { path: string; line?: number; endLine?: number; symbol?: string; note?: string; kind?: string }[]): FlowStep[] {
  return evidence
    .filter((e) => e.kind !== "dir")
    .map((e) => ({ file: e.path, line: e.line, endLine: e.endLine, label: e.symbol ?? e.note ?? path.posix.basename(e.path) }));
}

/** Mermaid sequence diagram for a flow: each file is a participant, each step a call. */
export function flowMermaid(title: string, steps: FlowStep[]): string {
  const names = new Map<string, string>();
  const alias = (file: string) => {
    if (!names.has(file)) names.set(file, `P${names.size}`);
    return names.get(file)!;
  };
  const lines = ["sequenceDiagram", "  autonumber", "  actor U as Request"];
  for (const s of steps) alias(s.file);
  for (const [file, a] of names) lines.push(`  participant ${a} as ${path.posix.basename(file)}`);
  let prev = "U";
  for (const s of steps) {
    const to = alias(s.file);
    lines.push(`  ${prev}->>${to}: ${s.label.replace(/[;:#]/g, " ")}`);
    prev = to;
  }
  void title;
  return lines.join("\n");
}
