import type { Analysis } from "./types.js";

// A compact view of analysis.json for terminals and agents; the full file can run to megabytes.
export interface AnalysisSummary {
  root: string;
  generatedAt: string;
  files: number;
  lines: number;
  languages: { language: string; files: number; lines: number }[];
  frameworks: { name: string; version: string | null }[];
  dependencies: { total: number; runtime: number; dev: number; byEcosystem: Record<string, number> };
  entryPoints: { kind: string; path: string; detail?: string }[];
  integrations: { name: string; category: string; files: number; configFiles: number; envVars: string[]; sdk: boolean }[];
  envVars: { total: number; undocumented: string[] };
  imports: { internal: number; external: number; mostImported: { path: string; importers: number }[] };
  tests: { files: number; frameworks: string[] };
  ci: string[];
  skipped: number;
}

export function summarize(a: Analysis, topN = 10): AnalysisSummary {
  const byEcosystem: Record<string, number> = {};
  for (const d of a.dependencies) byEcosystem[d.ecosystem] = (byEcosystem[d.ecosystem] ?? 0) + 1;

  const importers = new Map<string, Set<string>>();
  let internal = 0;
  let external = 0;
  for (const e of a.imports) {
    if (e.resolved) {
      internal++;
      const s = importers.get(e.resolved) ?? new Set();
      s.add(e.from);
      importers.set(e.resolved, s);
    } else if (e.external) external++;
  }

  return {
    root: a.root,
    generatedAt: a.generatedAt,
    files: a.files.length,
    lines: a.languages.reduce((n, l) => n + l.lines, 0),
    languages: a.languages,
    frameworks: a.frameworks.map((f) => ({ name: f.name, version: f.version })),
    dependencies: {
      total: a.dependencies.length,
      runtime: a.dependencies.filter((d) => !d.dev).length,
      dev: a.dependencies.filter((d) => d.dev).length,
      byEcosystem,
    },
    entryPoints: a.entryPoints.filter((e) => e.kind !== "package-script").slice(0, topN * 2),
    integrations: a.integrations.map((i) => ({
      name: i.name,
      category: i.category,
      files: i.files.length,
      configFiles: i.configFiles.length,
      envVars: i.envVars,
      sdk: !(i.detectedBy.length === 1 && i.detectedBy[0] === "env"),
    })),
    envVars: { total: a.envVars.length, undocumented: a.envVars.filter((v) => !v.documented && v.files.length).map((v) => v.name) },
    imports: {
      internal,
      external,
      mostImported: [...importers]
        .map(([path, s]) => ({ path, importers: s.size }))
        .sort((x, y) => y.importers - x.importers || x.path.localeCompare(y.path))
        .slice(0, topN),
    },
    tests: { files: a.tests.files.length, frameworks: a.tests.frameworks },
    ci: a.ci.map((c) => `${c.provider}: ${c.path}`),
    skipped: a.skipped.length,
  };
}
