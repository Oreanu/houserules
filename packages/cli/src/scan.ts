import path from "node:path";
import { scan, summarize, writeAnalysis, type AnalysisSummary } from "@houserules/core";

export interface ScanOptions {
  out?: string;
  json: boolean;
}

export async function runScan(target: string, opts: ScanOptions): Promise<number> {
  const started = Date.now();
  const analysis = await scan(target);
  const file = await writeAnalysis(target, analysis, opts.out ? path.resolve(opts.out) : undefined);
  const summary = summarize(analysis);
  const rel = path.relative(process.cwd(), file);
  if (opts.json) console.log(JSON.stringify(summary, null, 2));
  else console.log(formatSummary(summary, rel && !rel.startsWith("..") ? rel : file, Date.now() - started));
  return 0;
}

export function formatSummary(s: AnalysisSummary, file: string, ms: number): string {
  const lines: string[] = [];
  const list = (items: string[], max = 8) => (items.length > max ? [...items.slice(0, max), `… and ${items.length - max} more`] : items);

  lines.push(`Scanned ${s.root}: ${s.files} source files, ${s.lines.toLocaleString("en-US")} lines in ${(ms / 1000).toFixed(1)}s`);
  lines.push(`Languages:    ${s.languages.map((l) => `${l.language} ${l.files}`).join(", ") || "none detected"}`);
  lines.push(`Frameworks:   ${s.frameworks.map((f) => (f.version ? `${f.name} ${f.version}` : f.name)).join(", ") || "none detected"}`);
  const eco = Object.entries(s.dependencies.byEcosystem).map(([k, v]) => `${k} ${v}`).join(", ");
  lines.push(`Dependencies: ${s.dependencies.runtime} runtime, ${s.dependencies.dev} dev${eco ? ` (${eco})` : ""}`);
  lines.push(`Imports:      ${s.imports.internal} internal, ${s.imports.external} external`);
  lines.push(`Tests:        ${s.tests.files} files${s.tests.frameworks.length ? ` (${s.tests.frameworks.join(", ")})` : ""}`);
  lines.push(`CI:           ${s.ci.length ? s.ci.length + " config(s)" : "none detected"}`);

  if (s.entryPoints.length) {
    lines.push("", "Entry points:");
    for (const e of list(s.entryPoints.map((e) => `${e.path}  [${e.kind}${e.detail ? `: ${e.detail}` : ""}]`))) lines.push(`  ${e}`);
  }
  if (s.integrations.length) {
    lines.push("", "Third-party integrations:");
    const width = Math.max(...s.integrations.map((i) => i.name.length));
    for (const i of s.integrations) {
      const where =
        [i.files ? `${i.files} file${i.files === 1 ? "" : "s"}` : "", i.configFiles ? `${i.configFiles} config` : "", i.sdk ? "" : "no SDK, found via env vars"].filter(Boolean).join(", ") ||
        "declared only";
      lines.push(`  ${i.name.padEnd(width)}  ${i.category.padEnd(13)} ${where}${i.envVars.length ? `; env: ${list(i.envVars, 3).join(", ")}` : ""}`);
    }
  }
  if (s.imports.mostImported.length) {
    lines.push("", "Most imported internal modules (likely shared building blocks):");
    for (const m of s.imports.mostImported.slice(0, 8)) lines.push(`  ${String(m.importers).padStart(4)}  ${m.path}`);
  }
  if (s.envVars.undocumented.length) {
    lines.push("", `Env vars used but not in any .env example (${s.envVars.undocumented.length}): ${list(s.envVars.undocumented, 10).join(", ")}`);
  }
  if (s.skipped) lines.push("", `Skipped ${s.skipped} large or binary file(s).`);
  lines.push("", `Wrote ${file}`);
  return lines.join("\n");
}
