import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Language, LanguageStat, SourceFile } from "../types.js";

const EXTENSIONS: Record<string, Language> = {
  ".ts": "typescript",
  ".tsx": "typescript",
  ".mts": "typescript",
  ".cts": "typescript",
  ".js": "javascript",
  ".jsx": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".py": "python",
  ".java": "java",
  ".kt": "kotlin",
  ".kts": "kotlin",
  ".php": "php",
};

// Larger files are almost always generated or vendored; hashing them is fine, parsing them is not.
export const MAX_SOURCE_BYTES = 1_000_000;

export function languageOf(rel: string): Language | null {
  return EXTENSIONS[path.extname(rel).toLowerCase()] ?? null;
}

export interface LoadedSource {
  file: SourceFile;
  text: string;
}

export async function loadSource(root: string, rel: string, language: Language): Promise<LoadedSource | { skipped: string }> {
  const buf = await readFile(path.join(root, rel));
  if (buf.byteLength > MAX_SOURCE_BYTES) return { skipped: `larger than ${MAX_SOURCE_BYTES} bytes` };
  if (buf.includes(0)) return { skipped: "binary content" };
  const text = buf.toString("utf8");
  return {
    text,
    file: {
      path: rel,
      language,
      lines: countLines(text),
      bytes: buf.byteLength,
      sha256: createHash("sha256").update(buf).digest("hex"),
    },
  };
}

function countLines(text: string): number {
  if (text.length === 0) return 0;
  let n = 1;
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) n++;
  return text.endsWith("\n") ? n - 1 : n;
}

export function languageStats(files: SourceFile[]): LanguageStat[] {
  const byLang = new Map<Language, LanguageStat>();
  for (const f of files) {
    const s = byLang.get(f.language) ?? { language: f.language, files: 0, lines: 0 };
    s.files++;
    s.lines += f.lines;
    byLang.set(f.language, s);
  }
  return [...byLang.values()].sort((a, b) => b.lines - a.lines);
}

/** Returns a lookup from character offset to 1-based line number. */
export function lineIndex(text: string): (offset: number) => number {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) starts.push(i + 1);
  return (offset) => {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid]! <= offset) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  };
}
