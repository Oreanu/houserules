import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { walk } from "../scan/walk.js";
import type { SymbolIndex } from "../symbols/index.js";
import { ITEM_LIMITS } from "./spec.js";

/** What the agent submits. */
export interface ItemInput {
  title: string;
  body: string;
  evidence: EvidenceInput[];
  confidence: "observed" | "inferred" | "needs-human";
}

export interface EvidenceInput {
  path: string;
  line?: number;
  endLine?: number;
  symbol?: string;
  note?: string;
}

/** What gets stored and rendered, after verification. */
export interface Item {
  id: string;
  title: string;
  body: string;
  evidence: Evidence[];
  confidence: "verified" | "inferred" | "needs-human";
}

export interface Evidence extends EvidenceInput {
  kind: "file" | "dir";
  sha256?: string; // file hash at verification time
  snippetHash?: string; // hash of just the cited lines, so edits elsewhere in the file don't flag this item
}

export interface VerifyResult {
  item?: Item;
  problems: string[];
}

const MODULE_EXTS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".d.ts", ".py", ".java", ".kt"];
const INDEX_FILES = ["index.ts", "index.tsx", "index.js", "index.jsx", "__init__.py"];

// How far from the cited line a symbol may appear (signatures span lines, decorators sit above).
const SYMBOL_WINDOW = 3;

interface FileInfo {
  kind: "file" | "dir";
  lines?: string[];
  sha256?: string;
}

/** Verifies items against the repo on disk. Reuse one Verifier per batch so files are read once. */
export class Verifier {
  private cache = new Map<string, Promise<FileInfo | null>>();

  constructor(
    private readonly root: string,
    private readonly symbols?: SymbolIndex,
  ) {}

  async verify(input: ItemInput, id: string): Promise<VerifyResult> {
    const problems: string[] = [];
    const title = (input.title ?? "").trim();
    const body = (input.body ?? "").trim();
    if (!title) problems.push("title is empty");
    if (title.length > ITEM_LIMITS.title) problems.push(`title is longer than ${ITEM_LIMITS.title} characters`);
    if (body.length > ITEM_LIMITS.body) problems.push(`body is longer than ${ITEM_LIMITS.body} characters; keep it short and put depth in evidence`);
    if (input.evidence.length > ITEM_LIMITS.evidence) problems.push(`more than ${ITEM_LIMITS.evidence} evidence entries`);
    if (input.confidence !== "needs-human" && input.evidence.length === 0) {
      problems.push(`"${input.confidence}" items need at least one evidence entry; use "needs-human" if only a maintainer can answer`);
    }

    const evidence: Evidence[] = [];
    for (const [i, ev] of input.evidence.entries()) {
      const where = `evidence[${i}] (${ev.path})`;
      const rel = normalize(ev.path);
      if (!rel) {
        problems.push(`${where}: path must be repo-relative and stay inside the repo`);
        continue;
      }
      const info = await this.file(rel);
      if (!info) {
        problems.push(`${where}: no such file or directory`);
        continue;
      }
      const out: Evidence = { ...ev, path: rel, kind: info.kind };
      if (info.kind === "dir") {
        if (ev.line || ev.symbol) problems.push(`${where}: is a directory, so it can't have a line or symbol`);
        evidence.push(out);
        continue;
      }
      out.sha256 = info.sha256;
      const lines = info.lines!;
      if (ev.line !== undefined && (ev.line < 1 || ev.line > lines.length)) {
        problems.push(`${where}: line ${ev.line} is outside the file (1–${lines.length})`);
      }
      if (ev.endLine !== undefined && (ev.line === undefined || ev.endLine < ev.line || ev.endLine > lines.length)) {
        problems.push(`${where}: endLine ${ev.endLine} must come after line and be within the file (1–${lines.length})`);
      }
      if (ev.symbol) {
        const sym = ev.symbol.split(".").pop()!; // allow Class.method
        const word = new RegExp(`(^|[^\\w$])${escapeRegex(sym)}([^\\w$]|$)`);
        const hitLines = lines.flatMap((l, n) => (word.test(l) ? [n + 1] : []));
        if (!hitLines.length) {
          problems.push(`${where}: symbol "${ev.symbol}" does not appear in this file`);
        } else if (ev.line !== undefined) {
          const from = ev.line - SYMBOL_WINDOW;
          const to = (ev.endLine ?? ev.line) + SYMBOL_WINDOW;
          if (!hitLines.some((n) => n >= from && n <= to)) {
            problems.push(`${where}: symbol "${ev.symbol}" isn't near line ${ev.line}; it appears on line ${hitLines.slice(0, 5).join(", ")}`);
          }
        } else {
          // No line given: point at the definition if we know it, else the first mention.
          const def = this.symbols?.byFile.get(rel)?.find((s) => s.name === sym);
          out.line = def?.line ?? hitLines[0];
          if (def && def.endLine > def.line) out.endLine = def.endLine;
        }
      }
      if (out.line !== undefined && out.line >= 1 && out.line <= lines.length) {
        const end = Math.min(Math.max(out.endLine ?? out.line, out.line), lines.length);
        out.snippetHash = snippetHash(lines, out.line, end);
      }
      evidence.push(out);
    }

    // Paths mentioned in the body must be real too; that's where made-up file names slip in.
    for (const problem of await this.checkBodyPaths(body, evidence)) problems.push(problem);

    if (problems.length) return { problems };
    const confidence = input.confidence === "observed" ? "verified" : input.confidence;
    return { problems, item: { id, title, body, evidence, confidence } };
  }

  /**
   * `src/lib/db.ts` (starts at a real top-level entry) must exist exactly; `schema.sql` (a bare file
   * name) must exist somewhere. Other slashed tokens, like view names or routes, aren't repo paths.
   */
  private async checkBodyPaths(body: string, evidence: Evidence[]): Promise<string[]> {
    const problems: string[] = [];
    const tokens = pathLikeTokens(body);
    if (!tokens.length) return problems;
    const { topLevel, basenames } = await this.repoNames();
    for (const token of tokens) {
      const rel = normalize(token);
      if (!rel || evidence.some((e) => e.path === rel)) continue;
      if (token.includes("/")) {
        if (topLevel.has(rel.split("/")[0]!) && !(await this.resolvesToFile(rel))) {
          problems.push(`body mentions \`${token}\`, which doesn't exist as a file, directory or importable module`);
        }
      } else if (!basenames.has(rel) && !(await this.file(rel))) {
        problems.push(`body mentions \`${token}\`, but there's no file with that name anywhere in the repo`);
      }
    }
    return problems;
  }

  /** True for a real path, or an import-style path like `lib/constants` that resolves to a module. */
  private async resolvesToFile(rel: string): Promise<boolean> {
    if (await this.file(rel)) return true;
    for (const ext of MODULE_EXTS) if (await this.file(rel + ext)) return true;
    for (const index of INDEX_FILES) if (await this.file(`${rel}/${index}`)) return true;
    return false;
  }

  /** Where a cited snippet now lives, if the same lines still exist in the file (code moved, not changed). */
  async locateSnippet(rel: string, hash: string, length: number): Promise<number | null> {
    const info = await this.file(rel);
    if (!info?.lines) return null;
    for (let start = 1; start + length - 1 <= info.lines.length; start++) {
      if (snippetHash(info.lines, start, start + length - 1) === hash) return start;
    }
    return null;
  }

  private names: Promise<{ topLevel: Set<string>; basenames: Set<string> }> | null = null;

  private repoNames(): Promise<{ topLevel: Set<string>; basenames: Set<string> }> {
    this.names ??= walk(this.root).then(({ paths }) => ({
      topLevel: new Set(paths.map((p) => p.split("/")[0]!)),
      basenames: new Set(paths.map((p) => path.posix.basename(p))),
    }));
    return this.names;
  }

  private file(rel: string): Promise<FileInfo | null> {
    let pending = this.cache.get(rel);
    if (!pending) {
      pending = (async () => {
        const abs = path.join(this.root, rel);
        try {
          const st = await stat(abs);
          if (st.isDirectory()) return { kind: "dir" };
          const buf = await readFile(abs);
          const lines = buf.toString("utf8").split(/\r?\n/);
          if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop(); // a trailing newline isn't another line
          return { kind: "file", lines, sha256: createHash("sha256").update(buf).digest("hex") };
        } catch {
          return null;
        }
      })();
      this.cache.set(rel, pending);
    }
    return pending;
  }
}

/** Repo-relative, forward slashes, no leading ./ or trailing /, never escaping the root. */
export function normalize(p: string): string | null {
  if (!p || path.isAbsolute(p) || /^[a-zA-Z]:/.test(p)) return null;
  const n = path.posix.normalize(p.replace(/\\/g, "/").replace(/:\d+(-\d+)?$/, "")).replace(/\/$/, "");
  if (n === "." || n === "" ) return "";
  if (n.startsWith("../") || n === "..") return null;
  return n.replace(/^\.\//, "");
}

const PATH_TOKEN = /`([^`\s]+)`/g;

/** Backticked tokens that look like repo paths: contain a slash or end in a file extension. */
export function pathLikeTokens(body: string): string[] {
  const out = new Set<string>();
  for (const m of body.matchAll(PATH_TOKEN)) {
    const t = m[1]!;
    if (/^[a-z]+:\/\//i.test(t) || /[*{}<>|$=,;]/.test(t) || t.startsWith("@") || t.startsWith("-")) continue; // URLs, globs, packages, flags
    if (t.startsWith("/") || t.startsWith("~")) continue; // absolute or home paths aren't repo paths
    const looksLikePath = (t.includes("/") && /^[\w.\-/[\]()+]+(:\d+(-\d+)?)?$/.test(t)) || /^[\w.\-]+\.(ts|tsx|js|jsx|mjs|cjs|py|java|kt|json|ya?ml|toml|md|prisma|sql|xml|gradle|properties|sh|env\.example)$/.test(t);
    if (looksLikePath) out.add(t);
  }
  return [...out];
}

function snippetHash(lines: string[], from: number, to: number): string {
  return createHash("sha256").update(lines.slice(from - 1, to).join("\n")).digest("hex").slice(0, 16);
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
