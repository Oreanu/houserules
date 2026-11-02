import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Analysis } from "../types.js";
import { canExtract, extractSymbols, type SymbolDef } from "./extract.js";

export { extractSymbols, type SymbolDef, type SymbolKind } from "./extract.js";

const CACHE_VERSION = 2; // 2: request handlers written as arrow-function properties and class fields

interface CacheFile {
  version: number;
  files: Record<string, { sha256: string; symbols: SymbolDef[] }>;
}

export interface SymbolIndex {
  byFile: Map<string, SymbolDef[]>;
  find(name: string): { file: string; symbol: SymbolDef }[];
}

/**
 * Symbols for every source file in the analysis. Parsing is the slow part, so results are cached
 * in .houserules/cache/symbols.json keyed by file hash; only changed files are re-parsed.
 */
export async function buildSymbolIndex(rootDir: string, analysis: Analysis): Promise<SymbolIndex> {
  const root = path.resolve(rootDir);
  const cachePath = path.join(root, ".houserules", "cache", "symbols.json");
  let cache: CacheFile = { version: CACHE_VERSION, files: {} };
  try {
    const loaded = JSON.parse(await readFile(cachePath, "utf8")) as CacheFile;
    if (loaded.version === CACHE_VERSION) cache = loaded;
  } catch {
    // no cache yet
  }

  const byFile = new Map<string, SymbolDef[]>();
  const next: CacheFile = { version: CACHE_VERSION, files: {} };
  let changed = false;
  for (const f of analysis.files) {
    if (!canExtract(f.path)) continue;
    const hit = cache.files[f.path];
    let symbols: SymbolDef[];
    if (hit && hit.sha256 === f.sha256) symbols = hit.symbols;
    else {
      changed = true;
      try {
        symbols = await extractSymbols(f.path, await readFile(path.join(root, f.path), "utf8"));
      } catch {
        symbols = [];
      }
    }
    byFile.set(f.path, symbols);
    next.files[f.path] = { sha256: f.sha256, symbols };
  }
  if (changed || Object.keys(cache.files).length !== Object.keys(next.files).length) {
    await mkdir(path.dirname(cachePath), { recursive: true });
    await writeFile(cachePath, JSON.stringify(next));
  }

  const byName = new Map<string, { file: string; symbol: SymbolDef }[]>();
  for (const [file, symbols] of byFile) {
    for (const symbol of symbols) {
      const list = byName.get(symbol.name) ?? [];
      list.push({ file, symbol });
      byName.set(symbol.name, list);
    }
  }
  return { byFile, find: (name) => byName.get(name) ?? [] };
}
