import { builtinModules } from "node:module";
import path from "node:path";
import type { ImportEdge, SourceFile } from "../types.js";
import { lineIndex } from "./files.js";
import type { ReadText } from "./manifests.js";

// Regex extraction is deliberately simple for M0. M1 swaps in tree-sitter, which the
// claim verifier needs for symbols anyway; the ImportEdge shape stays the same.

const JS_PATTERNS = [
  /\bimport\s+(?:type\s+)?[\w*{}\s,$]+?\s+from\s*['"]([^'"\n]+)['"]/g,
  /\bimport\s*['"]([^'"\n]+)['"]/g,
  /\bexport\s+(?:type\s+)?(?:\*(?:\s+as\s+\w+)?|\{[^}]*\})\s*from\s*['"]([^'"\n]+)['"]/g,
  /\b(?:require|import)\s*\(\s*['"]([^'"\n]+)['"]\s*\)/g,
];
const JS_EXTS = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"];
const NODE_BUILTINS = new Set(builtinModules);

interface RawImport {
  specifier: string;
  offset: number;
  names?: string[]; // python `from x import a, b`
  wildcard?: boolean; // jvm `import a.b.*`
}

export interface ImportContext {
  files: SourceFile[];
  sources: Map<string, string>;
  paths: string[];
  read: ReadText;
}

export async function extractImports(ctx: ImportContext): Promise<ImportEdge[]> {
  const fileSet = new Set(ctx.paths);
  const aliases = await loadPathAliases(ctx.paths, ctx.read);
  const workspaces = await loadWorkspacePackages(ctx.paths, ctx.read);
  // Index every .py path, including files too large to parse, so imports of them still resolve.
  const pyIndex = buildPythonIndex(ctx.paths.filter((p) => p.endsWith(".py")), pythonRoots(ctx.paths));
  const jvm = buildJvmIndex(ctx.files, ctx.sources);
  const php = buildPhpIndex(ctx.files, ctx.sources);
  const edges: ImportEdge[] = [];

  for (const file of ctx.files) {
    const text = ctx.sources.get(file.path);
    if (text === undefined) continue;
    const lineOf = lineIndex(text);
    const push = (raw: RawImport, resolved: string | null, external: string | null) =>
      edges.push({ from: file.path, specifier: raw.specifier, resolved, external, line: lineOf(raw.offset) });

    if (file.language === "typescript" || file.language === "javascript") {
      for (const raw of jsImports(text)) {
        const resolved = resolveJs(file.path, raw.specifier, fileSet, aliases) ?? resolveWorkspace(raw.specifier, fileSet, workspaces);
        push(raw, resolved, resolved || raw.specifier.startsWith(".") ? null : jsPackageName(raw.specifier));
      }
    } else if (file.language === "python") {
      for (const raw of pythonImports(text)) {
        const resolved = resolvePython(file.path, raw, pyIndex);
        push(raw, resolved, resolved || raw.specifier.startsWith(".") ? null : raw.specifier);
      }
    } else if (file.language === "java" || file.language === "kotlin") {
      for (const raw of jvmImports(text)) {
        // `import a.b.*` names a package (→ its directory); `import static a.b.C.*` names a class.
        const resolved = raw.wildcard
          ? (jvm.packages.get(raw.specifier) ?? jvm.classes.get(raw.specifier) ?? null)
          : (jvm.classes.get(raw.specifier) ?? jvm.classes.get(raw.specifier.split(".").slice(0, -1).join(".")) ?? null);
        push(raw, resolved, resolved ? null : raw.specifier);
      }
    } else if (file.language === "php") {
      for (const raw of phpImports(text)) {
        // `use App\Models\User;` → the class's file; `require __DIR__ . '/x.php'` → that path.
        const resolved = raw.specifier.endsWith(".php")
          ? (fileSet.has(path.posix.normalize(path.posix.join(path.posix.dirname(file.path), raw.specifier))) ? path.posix.normalize(path.posix.join(path.posix.dirname(file.path), raw.specifier)) : null)
          : (php.get(raw.specifier) ?? null);
        push(raw, resolved, resolved ? null : phpPackage(raw.specifier));
      }
    }
  }
  return edges;
}

// ---------- JavaScript / TypeScript ----------

function jsImports(text: string): RawImport[] {
  const seen = new Set<number>();
  const out: RawImport[] = [];
  for (const re of JS_PATTERNS) {
    for (const m of text.matchAll(re)) {
      const offset = m.index! + m[0].lastIndexOf(m[1]!);
      if (seen.has(offset)) continue;
      seen.add(offset);
      out.push({ specifier: m[1]!, offset });
    }
  }
  return out.sort((a, b) => a.offset - b.offset);
}

interface AliasScope {
  dir: string; // dir containing the tsconfig/jsconfig ("" for root)
  baseUrl: string | null; // repo-relative ("" is the repo root); null when the config sets none
  paths: [prefix: string, targets: string[]][]; // "@/" -> ["src/"]
}

async function loadPathAliases(paths: string[], read: ReadText): Promise<AliasScope[]> {
  const scopes: AliasScope[] = [];
  for (const p of paths) {
    const base = path.posix.basename(p);
    if (base !== "tsconfig.json" && base !== "jsconfig.json") continue;
    const text = await read(p);
    if (!text) continue;
    let opts: any;
    try {
      opts = JSON.parse(stripJsonComments(text)).compilerOptions ?? {};
    } catch {
      continue;
    }
    const dir = path.posix.dirname(p) === "." ? "" : path.posix.dirname(p);
    const baseUrl = typeof opts.baseUrl === "string" ? path.posix.normalize(path.posix.join(dir, opts.baseUrl)) : null;
    const entries: AliasScope["paths"] = Object.entries((opts.paths ?? {}) as Record<string, string[]>).map(([k, v]) => [
      k.replace(/\*$/, ""),
      v.map((t) => t.replace(/\*$/, "")),
    ]);
    scopes.push({ dir, baseUrl: baseUrl === "." ? "" : baseUrl, paths: entries });
  }
  // Deepest config first, so the nearest one wins.
  return scopes.sort((a, b) => b.dir.length - a.dir.length);
}

export function stripJsonComments(text: string): string {
  let out = "";
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (inString) {
      out += c;
      if (c === "\\") out += text[++i] ?? "";
      else if (c === '"') inString = false;
    } else if (c === '"') {
      inString = true;
      out += c;
    } else if (c === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      out += "\n";
    } else if (c === "/" && text[i + 1] === "*") {
      i += 2;
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i++;
      i++;
    } else out += c;
  }
  return out.replace(/,(\s*[}\]])/g, "$1");
}

function resolveJs(from: string, spec: string, files: Set<string>, aliases: AliasScope[]): string | null {
  if (spec.startsWith(".")) return tryJsFile(path.posix.join(path.posix.dirname(from), spec), files);
  const scope = aliases.find((s) => s.dir === "" || from.startsWith(`${s.dir}/`));
  if (!scope) return null;
  for (const [prefix, targets] of scope.paths) {
    if (prefix ? !spec.startsWith(prefix) : false) continue;
    const rest = spec.slice(prefix.length);
    for (const target of targets) {
      // Without baseUrl, TypeScript resolves `paths` relative to the config file itself.
      const hit = tryJsFile(path.posix.join(scope.baseUrl ?? scope.dir, target, rest), files);
      if (hit) return hit;
    }
  }
  if (scope.baseUrl !== null) return tryJsFile(path.posix.join(scope.baseUrl, spec), files);
  return null;
}

function tryJsFile(candidate: string, files: Set<string>): string | null {
  const c = path.posix.normalize(candidate);
  if (files.has(c) && JS_EXTS.includes(path.posix.extname(c))) return c;
  // NodeNext-style "./foo.js" that is really foo.ts
  const stem = /\.(m|c)?jsx?$/.test(c) ? c.replace(/\.(m|c)?jsx?$/, "") : c;
  for (const ext of JS_EXTS) if (files.has(stem + ext)) return stem + ext;
  for (const ext of JS_EXTS) if (files.has(`${c}/index${ext}`)) return `${c}/index${ext}`;
  // Type-only modules (`import type { X } from "../types"`) often live in .d.ts files.
  if (files.has(`${stem}.d.ts`)) return `${stem}.d.ts`;
  if (files.has(`${c}/index.d.ts`)) return `${c}/index.d.ts`;
  return null;
}

interface WorkspacePackage {
  name: string;
  dir: string; // repo-relative ("" for the root package)
  exports: unknown;
  entry: string[]; // main / module / types, in that order
}

/** Packages defined inside this repo (monorepo workspaces), so `@acme/db` resolves to its source. */
async function loadWorkspacePackages(paths: string[], read: ReadText): Promise<Map<string, WorkspacePackage>> {
  const pkgs = new Map<string, WorkspacePackage>();
  for (const p of paths) {
    if (path.posix.basename(p) !== "package.json") continue;
    const text = await read(p);
    if (!text) continue;
    let pkg: Record<string, any>;
    try {
      pkg = JSON.parse(text);
    } catch {
      continue;
    }
    if (typeof pkg.name !== "string" || pkgs.has(pkg.name)) continue;
    const dir = path.posix.dirname(p) === "." ? "" : path.posix.dirname(p);
    const entry = [pkg.source, pkg.main, pkg.module, pkg.types, pkg.typings].filter((e): e is string => typeof e === "string");
    pkgs.set(pkg.name, { name: pkg.name, dir, exports: pkg.exports, entry });
  }
  return pkgs;
}

function resolveWorkspace(spec: string, files: Set<string>, pkgs: Map<string, WorkspacePackage>): string | null {
  if (spec.startsWith(".") || !pkgs.size) return null;
  const name = jsPackageName(spec);
  const pkg = name ? pkgs.get(name) : undefined;
  if (!pkg) return null;
  const sub = spec.slice(pkg.name.length).replace(/^\//, "");
  const inPkg = (rel: string) => path.posix.join(pkg.dir, rel);

  const targets = exportTargets(pkg.exports, sub ? `./${sub}` : ".");
  if (!sub) targets.push(...pkg.entry);
  for (const t of targets) {
    // Exports often point at build output that isn't committed; try the matching source path too.
    for (const candidate of [t, t.replace(/^(\.\/)?(dist|build|lib|out)\//, "$1src/"), t.replace(/^(\.\/)?(dist|build|lib|out)\//, "$1")]) {
      const hit = tryJsFile(inPkg(candidate), files);
      if (hit) return hit;
    }
  }
  for (const candidate of sub ? [sub, `src/${sub}`] : ["src/index", "index"]) {
    const hit = tryJsFile(inPkg(candidate), files);
    if (hit) return hit;
  }
  return null;
}

/** String targets for a subpath in a package.json `exports` field, most specific first. */
function exportTargets(exports: unknown, subpath: string): string[] {
  if (!exports) return [];
  if (typeof exports === "string") return subpath === "." ? [exports] : [];
  if (Array.isArray(exports)) return exports.flatMap((e) => exportTargets(e, subpath));
  if (typeof exports !== "object") return [];
  const map = exports as Record<string, unknown>;
  const isSubpathMap = Object.keys(map).some((k) => k.startsWith("."));
  if (!isSubpathMap) return subpath === "." ? conditionTargets(map) : [];
  if (subpath in map) return conditionTargets(map[subpath]);
  for (const [key, value] of Object.entries(map)) {
    const star = key.indexOf("*");
    if (star < 0) continue;
    const [pre, post] = [key.slice(0, star), key.slice(star + 1)];
    if (subpath.startsWith(pre) && subpath.endsWith(post) && subpath.length >= pre.length + post.length) {
      const matched = subpath.slice(pre.length, subpath.length - post.length);
      return conditionTargets(value).map((t) => t.replace("*", matched));
    }
  }
  return [];
}

function conditionTargets(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(conditionTargets);
  if (!value || typeof value !== "object") return [];
  const conds = value as Record<string, unknown>;
  // Prefer source-like conditions; types often point at .d.ts files we can't use.
  return ["source", "development", "import", "default", "require", "node", "types"].flatMap((k) => conditionTargets(conds[k]));
}

function jsPackageName(spec: string): string | null {
  if (spec.startsWith("node:")) return spec;
  const parts = spec.split("/");
  const name = spec.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0]!;
  if (!name || name.startsWith("#") || name.startsWith("~")) return null;
  return NODE_BUILTINS.has(name) ? `node:${name}` : name;
}

// ---------- Python ----------

const PY_DOTTED = /^[A-Za-z_]\w*(\.[A-Za-z_]\w*)*$/;
const PY_NAME = /^[A-Za-z_]\w*$/;

function pythonImports(text: string): RawImport[] {
  const out: RawImport[] = [];
  // Every part must be a valid `module [as alias]`, which keeps prose in docstrings and comments out.
  for (const m of text.matchAll(/^[ \t]*import[ \t]+([^\n#;]+)/gm)) {
    const parts = m[1]!.split(",").map((p) => p.trim().split(/\s+as\s+/));
    if (!parts.every((p) => p.length <= 2 && PY_DOTTED.test(p[0]!) && (p.length === 1 || PY_NAME.test(p[1]!)))) continue;
    let offset = m.index! + m[0].indexOf(m[1]!);
    for (const part of m[1]!.split(",")) {
      out.push({ specifier: part.trim().split(/\s+as\s+/)[0]!, offset: offset + part.length - part.trimStart().length });
      offset += part.length + 1;
    }
  }
  for (const m of text.matchAll(/^[ \t]*from[ \t]+(\.+[\w.]*|[A-Za-z_][\w.]*)[ \t]+import[ \t]+(\([^)]*\)|[^\n#;]+)/gm)) {
    const names = m[2]!
      .replace(/[()\\]/g, " ")
      .split(",")
      .map((n) => n.trim().split(/\s+as\s+/)[0]!.trim())
      .filter((n) => n);
    if (!names.length || !names.every((n) => n === "*" || PY_NAME.test(n))) continue;
    out.push({ specifier: m[1]!, offset: m.index! + m[0].indexOf(m[1]!), names: names.filter((n) => n !== "*") });
  }
  return out.sort((a, b) => a.offset - b.offset);
}

type PythonIndex = Map<string, string[]>; // dotted module -> files

/**
 * Directories Python code is run from, so absolute imports are relative to them: the repo root,
 * wherever manage.py lives, and src/ layouts next to packaging files. Resolving only from these
 * (not from any path suffix) keeps `import graphql` pointing at the library, not at saleor/graphql/.
 */
export function pythonRoots(paths: string[]): string[] {
  const roots = new Set<string>([""]);
  for (const p of paths) {
    const base = path.posix.basename(p);
    const dir = path.posix.dirname(p) === "." ? "" : path.posix.dirname(p);
    if (base === "manage.py") roots.add(dir);
    if (base === "pyproject.toml" || base === "setup.py" || base === "setup.cfg") {
      roots.add(dir);
      roots.add(dir ? `${dir}/src` : "src");
    }
  }
  return [...roots];
}

function buildPythonIndex(pyPaths: string[], roots: string[]): PythonIndex {
  const index: PythonIndex = new Map();
  for (const file of pyPaths) {
    for (const root of roots) {
      if (root && !file.startsWith(`${root}/`)) continue;
      const parts = file.slice(root ? root.length + 1 : 0).replace(/\.py$/, "").split("/");
      if (parts[parts.length - 1] === "__init__") parts.pop();
      const mod = parts.join(".");
      if (!mod) continue;
      const list = index.get(mod) ?? [];
      if (!list.includes(file)) list.push(file);
      index.set(mod, list);
    }
  }
  return index;
}

function resolvePython(from: string, raw: RawImport, index: PythonIndex): string | null {
  let mod = raw.specifier;
  if (mod.startsWith(".")) {
    const dots = /^\.+/.exec(mod)![0].length;
    const dir = path.posix.dirname(from).split("/").filter((p) => p !== ".");
    const base = dir.slice(0, dir.length - (dots - 1));
    const rest = mod.slice(dots);
    mod = [...base, ...(rest ? rest.split(".") : [])].join(".");
  }
  const candidates = [...(raw.names ?? []).map((n) => (mod ? `${mod}.${n}` : n)), mod];
  for (const c of candidates) {
    const hits = index.get(c);
    if (!hits?.length) continue;
    if (hits.length === 1) return hits[0]!;
    // Ambiguous suffix: prefer the file sharing the longest directory prefix with the importer.
    return hits.reduce((best, h) => (sharedPrefix(h, from) > sharedPrefix(best, from) ? h : best));
  }
  return null;
}

function sharedPrefix(a: string, b: string): number {
  const pa = a.split("/");
  const pb = b.split("/");
  let i = 0;
  while (i < pa.length && i < pb.length && pa[i] === pb[i]) i++;
  return i;
}

// ---------- PHP ----------

function phpImports(text: string): RawImport[] {
  const out: RawImport[] = [];
  // use A\B\C;  use A\B\C as D;  use A\B\{C, D as E};  (not `use function`/`use const`, not closures' use (...))
  for (const m of text.matchAll(/^[ \t]*use[ \t]+(?!function\b|const\b)\\?([A-Za-z_][\w\\]*?)(\\\{([^}]*)\})?[ \t]*(?:as[ \t]+\w+)?[ \t]*;/gm)) {
    const base = m[1]!;
    const offset = m.index! + m[0].indexOf(base);
    if (m[3]) for (const part of m[3].split(",")) {
      const name = part.trim().split(/\s+as\s+/)[0]!.trim();
      if (name) out.push({ specifier: `${base}\\${name}`, offset });
    }
    else out.push({ specifier: base, offset });
  }
  for (const m of text.matchAll(/\b(?:require|include)(?:_once)?\s*\(?\s*(?:__DIR__\s*\.\s*)?['"]\/?([^'"]+\.php)['"]/g)) {
    out.push({ specifier: m[1]!, offset: m.index! });
  }
  return out;
}

/** Fully qualified class → file, from each file's namespace and its class/interface/trait/enum name. */
function buildPhpIndex(files: SourceFile[], sources: Map<string, string>): Map<string, string> {
  const index = new Map<string, string>();
  for (const f of files) {
    if (f.language !== "php") continue;
    const text = sources.get(f.path) ?? "";
    const ns = /^[ \t]*namespace[ \t]+([\w\\]+)[ \t]*;/m.exec(text)?.[1];
    for (const m of text.matchAll(/^[ \t]*(?:(?:abstract|final|readonly)[ \t]+)*(?:class|interface|trait|enum)[ \t]+(\w+)/gm)) {
      index.set(ns ? `${ns}\\${m[1]}` : m[1]!, f.path);
    }
  }
  return index;
}

/** Unresolved PHP imports come from vendor packages; the namespace root ("Illuminate\Support") names them. */
function phpPackage(spec: string): string {
  const parts = spec.split("\\");
  return parts.length > 1 ? `${parts[0]}\\${parts[1]}` : parts[0]!;
}

// ---------- Java / Kotlin ----------

function jvmImports(text: string): RawImport[] {
  const out: RawImport[] = [];
  for (const m of text.matchAll(/^[ \t]*import[ \t]+(?:static[ \t]+)?([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)(\.\*)?/gm)) {
    out.push({ specifier: m[1]!, offset: m.index! + m[0].indexOf(m[1]!), wildcard: Boolean(m[2]) });
  }
  return out;
}

interface JvmIndex {
  classes: Map<string, string>; // fully qualified class -> file
  packages: Map<string, string>; // package -> directory
}

function buildJvmIndex(files: SourceFile[], sources: Map<string, string>): JvmIndex {
  const index: JvmIndex = { classes: new Map(), packages: new Map() };
  for (const f of files) {
    if (f.language !== "java" && f.language !== "kotlin") continue;
    const pkg = /^[ \t]*package[ \t]+([\w.]+)/m.exec(sources.get(f.path) ?? "")?.[1];
    const cls = path.posix.basename(f.path).replace(/\.(java|kt|kts)$/, "");
    index.classes.set(pkg ? `${pkg}.${cls}` : cls, f.path);
    if (pkg && !index.packages.has(pkg)) index.packages.set(pkg, path.posix.dirname(f.path));
  }
  return index;
}
