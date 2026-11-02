#!/usr/bin/env node
// Scans the public repos in repos.json and flags results that are probably scanner mistakes.
// Usage: node evals/audit.mjs [name ...]     (run `npm run build` first)
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pythonRoots, scan } from "../packages/core/dist/index.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const reposDir = path.join(here, ".repos");
const resultsDir = path.join(here, "results");
const repos = JSON.parse(readFileSync(path.join(here, "repos.json"), "utf8"));
const only = process.argv.slice(2);

mkdirSync(reposDir, { recursive: true });
mkdirSync(resultsDir, { recursive: true });

const CODE_EXT = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;
const ASSET_EXT = /\.(css|scss|sass|less|svg|png|jpe?g|gif|webp|ico|json|md|mdx|html|txt|woff2?|ttf|yaml|yml|graphql|gql|wasm)(\?.*)?$/;

let totalIssues = 0;
for (const repo of repos) {
  if (only.length && !only.includes(repo.name)) continue;
  const dir = path.join(reposDir, repo.name);
  if (!existsSync(dir)) {
    console.error(`cloning ${repo.url} …`);
    execFileSync("git", ["clone", "-q", "--depth", "1", repo.url, dir], { stdio: "inherit" });
  }

  const started = Date.now();
  const a = await scan(dir);
  const ms = Date.now() - started;
  const { issues, info } = audit(a, repo);
  totalIssues += issues.reduce((n, i) => n + i.count, 0);

  const internal = a.imports.filter((e) => e.resolved).length;
  console.log(`\n=== ${repo.name} (${repo.stack}) — ${a.files.length} files, ${ms} ms, ${a.imports.length} imports (${internal} internal)`);
  console.log(`frameworks: ${a.frameworks.map((f) => `${f.name} ${f.version ?? "?"}`).join(", ") || "none"}`);
  console.log(`integrations: ${a.integrations.map((i) => `${i.name}(${i.files.length}${i.configFiles.length ? `+${i.configFiles.length}cfg` : ""})`).join(", ") || "none"}`);
  console.log(`entry points: ${countBy(a.entryPoints.map((e) => e.kind))}`);
  console.log(`tests: ${a.tests.files.length} files [${a.tests.frameworks.join(", ")}]   ci: ${a.ci.length}   skipped: ${a.skipped.length}`);
  for (const i of issues) {
    console.log(`  ✗ ${i.check}: ${i.count}`);
    for (const ex of i.examples) console.log(`      ${ex}`);
  }
  for (const line of info) console.log(`  · ${line}`);
  if (!issues.length) console.log("  ✓ no issues flagged");
  writeFileSync(path.join(resultsDir, `${repo.name}.json`), JSON.stringify({ ms, issues, info, summary: { files: a.files.length, imports: a.imports.length, internal } }, null, 2));
}
console.log(`\nTotal flagged: ${totalIssues}`);

function audit(a, repo) {
  const issues = [];
  const info = [];
  const repoDir = path.join(reposDir, repo.name);
  // A target that isn't on disk at all is generated or gitignored, not a scanner miss.
  const onDisk = (base) => ["", ".ts", ".tsx", ".js", ".jsx", ".py", "/index.ts", "/index.tsx", "/index.js", "/__init__.py", ".d.ts"].some((ext) => isExactFile(base + ext));
  const add = (check, items, fmt = String) => {
    if (items.length) issues.push({ check, count: items.length, examples: items.slice(0, 6).map(fmt) });
  };
  const fmtEdge = (e) => `${e.from}:${e.line}  ${e.specifier}`;

  // 1. Relative JS/TS imports should always resolve to a file (assets and typegen output excluded).
  const relMisses = a.imports.filter((e) => CODE_EXT.test(e.from) && e.specifier.startsWith(".") && !e.resolved && !ASSET_EXT.test(e.specifier));
  const relPresent = relMisses.filter((e) => onDisk(path.join(repoDir, path.dirname(e.from), e.specifier.replace(/\.(m|c)?js$/, ""))));
  add("unresolved relative JS/TS imports", relPresent, fmtEdge);
  if (relMisses.length > relPresent.length) info.push(`${relMisses.length - relPresent.length} relative JS/TS imports point at files not in the repo (generated or build output)`);

  // 2. Bare specifiers that name a package defined inside this repo (workspace packages) or a top-level dir.
  const workspaceDirs = new Map();
  for (const p of listFiles(a, /(^|\/)package\.json$/)) {
    try {
      const name = JSON.parse(readFileSync(path.join(repoDir, p), "utf8")).name;
      if (name) workspaceDirs.set(name, path.dirname(p));
    } catch {}
  }
  const workspaceNames = new Set(workspaceDirs.keys());
  const topDirs = new Set(a.files.filter((f) => f.path.includes("/")).map((f) => f.path.split("/")[0]));
  const bareMisses = a.imports.filter(
    (e) => CODE_EXT.test(e.from) && e.external && !ASSET_EXT.test(e.specifier) && (workspaceNames.has(e.external) || (topDirs.has(e.external) && !e.external.includes("."))),
  );
  const barePresent = bareMisses.filter((e) => {
    const dir = workspaceDirs.get(e.external);
    if (!dir) return true;
    const sub = e.specifier.slice(e.external.length).replace(/^\//, "");
    return !sub || onDisk(path.join(repoDir, dir, sub)) || onDisk(path.join(repoDir, dir, "src", sub));
  });
  add("bare JS/TS imports of in-repo packages", barePresent, fmtEdge);
  if (bareMisses.length > barePresent.length) info.push(`${bareMisses.length - barePresent.length} in-repo package imports point at files not in the repo (generated or build output)`);

  // 3. Python relative imports should resolve.
  const pyRelMisses = a.imports.filter((e) => e.from.endsWith(".py") && e.specifier.startsWith(".") && !e.resolved);
  const pyTarget = (e) => {
    const dots = /^\.+/.exec(e.specifier)[0].length;
    const dir = path.dirname(e.from).split("/").slice(0, path.dirname(e.from).split("/").length - (dots - 1));
    return path.join(repoDir, ...dir, ...e.specifier.slice(dots).split(".").filter(Boolean));
  };
  const pyRelPresent = pyRelMisses.filter((e) => onDisk(pyTarget(e)));
  add("unresolved relative Python imports", pyRelPresent, fmtEdge);
  if (pyRelMisses.length > pyRelPresent.length) {
    info.push(`${pyRelMisses.length - pyRelPresent.length} relative Python imports point at modules not in the repo (gitignored, or stale code): ${pyRelMisses.filter((e) => !pyRelPresent.includes(e)).slice(0, 3).map(fmtEdge).join("; ")}`);
  }

  // 4. Absolute Python imports that name a package sitting directly under a source root should resolve.
  const roots = pythonRoots([...a.files.map((f) => f.path), ...a.dependencies.map((d) => d.manifest)]);
  const rootPkg = (top) => roots.some((r) => existsSync(path.join(repoDir, r, top, "__init__.py")) || existsSync(path.join(repoDir, r, `${top}.py`)));
  add(
    "Python imports of local packages left external",
    a.imports.filter((e) => e.from.endsWith(".py") && e.external && rootPkg(e.external.split(".")[0])),
    fmtEdge,
  );

  // 5. JVM imports of the repo's own packages.
  const ownPrefixes = new Set();
  for (const f of a.files) {
    if (!/\.(java|kt)$/.test(f.path)) continue;
    const m = /src\/(?:main|test)\/(?:java|kotlin)\/((?:[^/]+\/){2}[^/]+)/.exec(f.path);
    if (m) ownPrefixes.add(m[1].replace(/\//g, "."));
  }
  const jvmMisses = a.imports.filter((e) => /\.(java|kt)$/.test(e.from) && e.external && [...ownPrefixes].some((p) => e.external.startsWith(`${p}.`)));
  // Codegen (DGS, MapStruct, protobuf) writes classes into build/, so a class with no source file is generated.
  const srcDirs = [...new Set(a.files.map((f) => /^(.*?src\/(?:main|test)\/(?:java|kotlin))\//.exec(f.path)?.[1]).filter(Boolean))];
  const hasSource = (fqcn) => {
    const parts = fqcn.split(".");
    for (let n = parts.length; n > 1; n--) {
      const rel = parts.slice(0, n).join("/");
      if (srcDirs.some((d) => existsSync(path.join(repoDir, d, `${rel}.java`)) || existsSync(path.join(repoDir, d, `${rel}.kt`)))) return true;
    }
    return false;
  };
  const jvmPresent = jvmMisses.filter((e) => hasSource(e.external));
  add("JVM imports of own packages left external", jvmPresent, fmtEdge);
  if (jvmMisses.length > jvmPresent.length) info.push(`${jvmMisses.length - jvmPresent.length} JVM imports name classes with no source file (generated at build time)`);

  // 6. Integrations with dependencies but no importing files (may be config-only, worth a look).
  // Declared but unused is a real finding about the repo (maybe a dead dependency), not a scanner bug.
  for (const i of a.integrations.filter((i) => !i.files.length && !i.configFiles.length)) info.push(`declared only: ${i.name} [${i.packages.join(", ")}]`);

  // 7. Expected framework missing.
  if (!a.frameworks.some((f) => f.id === repo.stack)) add("expected framework not detected", [repo.stack]);
  if (a.frameworks.some((f) => f.id === repo.stack && !f.version)) add("framework version missing", [repo.stack]);

  return { issues, info };
}

/** A regular file whose name matches exactly, so case mismatches count as missing even on macOS. */
function isExactFile(p) {
  try {
    if (!statSync(p).isFile()) return false;
    return readdirSync(path.dirname(p)).includes(path.basename(p));
  } catch {
    return false;
  }
}

function listFiles(a, re) {
  // package.json isn't a source file, so walk imports' manifests from dependencies instead.
  return [...new Set(a.dependencies.map((d) => d.manifest).filter((m) => re.test(m)))];
}

function countBy(xs) {
  const m = {};
  for (const x of xs) m[x] = (m[x] ?? 0) + 1;
  return Object.entries(m).map(([k, v]) => `${k}×${v}`).join(", ") || "none";
}
