import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { ANALYSIS_VERSION, type Analysis, type SourceFile } from "../types.js";
import { VERSION } from "../version.js";
import { languageOf, languageStats, loadSource } from "./files.js";
import { extractImports } from "./imports.js";
import { detectEnvVars, detectIntegrations, detectOwnClients, isConfigFile } from "./integrations.js";
import { isManifest, parseManifests, type ReadText } from "./manifests.js";
import { detectEntryPoints, detectFrameworks } from "./project.js";
import { detectCi, detectTests } from "./tooling.js";
import { walk } from "./walk.js";

export const HOUSERULES_DIR = ".houserules";
export const ANALYSIS_FILE = "analysis.json";

export async function scan(rootDir: string): Promise<Analysis> {
  const root = path.resolve(rootDir);
  const { paths } = await walk(root);

  const read: ReadText = async (rel) => {
    try {
      return await readFile(path.join(root, rel), "utf8");
    } catch {
      return null;
    }
  };

  const files: SourceFile[] = [];
  const sources = new Map<string, string>();
  const skipped: Analysis["skipped"] = [];
  for (const rel of paths) {
    const language = languageOf(rel);
    if (!language) continue;
    const loaded = await loadSource(root, rel, language);
    if ("skipped" in loaded) {
      skipped.push({ path: rel, reason: loaded.skipped });
      continue;
    }
    files.push(loaded.file);
    sources.set(rel, loaded.text);
  }

  const dependencies = await parseManifests(paths.filter(isManifest), read);
  const project = { paths, sources, dependencies, read };
  const frameworks = detectFrameworks(project);
  const entryPoints = await detectEntryPoints(project);
  const imports = await extractImports({ files, sources, paths, read });

  const configTexts = new Map<string, string>();
  for (const rel of paths.filter(isConfigFile)) {
    const text = await read(rel);
    if (text !== null) configTexts.set(rel, text);
  }
  const envVars = detectEnvVars(sources, configTexts);
  const found = detectIntegrations(dependencies, imports, envVars, new Map([...sources, ...configTexts]));
  const integrations = [...found, ...detectOwnClients(paths, imports, found)];

  return {
    version: ANALYSIS_VERSION,
    generatedAt: new Date().toISOString(),
    tool: { name: "houserules", version: VERSION },
    root: path.basename(root),
    languages: languageStats(files),
    files,
    dependencies,
    frameworks,
    entryPoints,
    imports,
    integrations,
    envVars,
    tests: detectTests(paths, dependencies, frameworks.some((f) => f.id === "django"), imports),
    ci: detectCi(paths),
    skipped,
  };
}

export function analysisPath(rootDir: string): string {
  return path.join(path.resolve(rootDir), HOUSERULES_DIR, ANALYSIS_FILE);
}

export async function writeAnalysis(rootDir: string, analysis: Analysis, outFile = analysisPath(rootDir)): Promise<string> {
  await mkdir(path.dirname(outFile), { recursive: true });
  await writeFile(outFile, `${JSON.stringify(analysis, null, 2)}\n`);
  return outFile;
}

export async function readAnalysis(rootDir: string): Promise<Analysis | null> {
  try {
    return JSON.parse(await readFile(analysisPath(rootDir), "utf8")) as Analysis;
  } catch {
    return null;
  }
}
