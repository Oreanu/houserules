import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import ignore, { type Ignore } from "ignore";

// Always skipped, even when a repo forgets to gitignore them.
const DEFAULT_IGNORES = [
  ".git/",
  "node_modules/",
  ".next/",
  "dist/",
  "build/",
  "out/",
  "coverage/",
  "target/",
  ".gradle/",
  ".venv/",
  "venv/",
  "__pycache__/",
  ".mypy_cache/",
  ".pytest_cache/",
  ".tox/",
  ".idea/",
  ".vscode/",
  ".houserules/",
  "*.min.js",
  "*.map",
];

export interface WalkResult {
  paths: string[]; // every non-ignored file, repo-relative with forward slashes
}

interface IgnoreScope {
  base: string; // repo-relative dir the .gitignore lives in ("" for root)
  ig: Ignore;
}

export async function walk(root: string): Promise<WalkResult> {
  const paths: string[] = [];
  const rootScope: IgnoreScope = { base: "", ig: ignore().add(DEFAULT_IGNORES) };

  async function visit(dirRel: string, scopes: IgnoreScope[]): Promise<void> {
    const dirAbs = path.join(root, dirRel);
    const local = await loadGitignore(dirAbs, dirRel);
    const active = local ? [...scopes, local] : scopes;

    const entries = await readdir(dirAbs, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const rel = dirRel ? `${dirRel}/${entry.name}` : entry.name;
      const isDir = entry.isDirectory();
      if (isIgnored(rel, isDir, active)) continue;
      if (isDir) await visit(rel, active);
      else if (entry.isFile()) paths.push(rel);
    }
  }

  await visit("", [rootScope]);
  return { paths };
}

function isIgnored(rel: string, isDir: boolean, scopes: IgnoreScope[]): boolean {
  for (const { base, ig } of scopes) {
    const relToBase = base ? rel.slice(base.length + 1) : rel;
    if (ig.ignores(isDir ? `${relToBase}/` : relToBase)) return true;
  }
  return false;
}

async function loadGitignore(dirAbs: string, dirRel: string): Promise<IgnoreScope | null> {
  try {
    const text = await readFile(path.join(dirAbs, ".gitignore"), "utf8");
    return { base: dirRel, ig: ignore().add(text) };
  } catch {
    return null;
  }
}

export async function fileSize(root: string, rel: string): Promise<number> {
  return (await stat(path.join(root, rel))).size;
}
