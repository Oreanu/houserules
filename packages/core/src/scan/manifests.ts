import path from "node:path";
import { parse as parseToml } from "smol-toml";
import type { Dependency } from "../types.js";

export type ReadText = (rel: string) => Promise<string | null>;

export function isManifest(rel: string): boolean {
  const base = path.posix.basename(rel);
  return (
    base === "package.json" ||
    base === "composer.json" ||
    base === "pyproject.toml" ||
    base === "Pipfile" ||
    base === "pom.xml" ||
    base === "build.gradle" ||
    base === "build.gradle.kts" ||
    /^requirements.*\.txt$/.test(base) ||
    (/\.txt$/.test(base) && path.posix.basename(path.posix.dirname(rel)) === "requirements")
  );
}

export async function parseManifests(manifests: string[], read: ReadText): Promise<Dependency[]> {
  const deps: Dependency[] = [];
  for (const rel of manifests) {
    const text = await read(rel);
    if (text === null) continue;
    try {
      deps.push(...parseManifest(rel, text));
    } catch {
      // A malformed manifest shouldn't sink the whole scan; it just contributes nothing.
    }
  }
  return deps;
}

export function parseManifest(rel: string, text: string): Dependency[] {
  const base = path.posix.basename(rel);
  if (base === "package.json") return parsePackageJson(rel, text);
  if (base === "composer.json") return parseComposer(rel, text);
  if (base === "pyproject.toml") return parsePyproject(rel, text);
  if (base === "Pipfile") return parsePipfile(rel, text);
  if (base === "pom.xml") return parsePom(rel, text);
  if (base.startsWith("build.gradle")) return parseGradle(rel, text);
  return parseRequirements(rel, text, /dev|test|lint/i.test(rel));
}

function parseComposer(manifest: string, text: string): Dependency[] {
  const pkg = JSON.parse(text) as { require?: Record<string, string>; "require-dev"?: Record<string, string> };
  const out: Dependency[] = [];
  for (const [field, dev] of [["require", false], ["require-dev", true]] as const) {
    for (const [name, version] of Object.entries(pkg[field] ?? {})) {
      // php itself and ext-* are platform requirements, not packages
      if (name === "php" || name.startsWith("ext-") || !name.includes("/")) continue;
      out.push({ name, version: typeof version === "string" ? version : null, ecosystem: "packagist", manifest, dev });
    }
  }
  return out;
}

function parsePackageJson(manifest: string, text: string): Dependency[] {
  const pkg = JSON.parse(text) as Record<string, unknown>;
  const out: Dependency[] = [];
  const add = (field: string, dev: boolean) => {
    const block = pkg[field];
    if (!block || typeof block !== "object") return;
    for (const [name, version] of Object.entries(block as Record<string, unknown>)) {
      out.push({ name, version: typeof version === "string" ? version : null, ecosystem: "npm", manifest, dev });
    }
  };
  add("dependencies", false);
  add("peerDependencies", false);
  add("optionalDependencies", false);
  add("devDependencies", true);
  return out;
}

// PEP 508: "Django>=4.2,<5", "requests[socks]==2.31.0 ; python_version>'3.8'"
const PEP508 = /^\s*([A-Za-z0-9][A-Za-z0-9._-]*)\s*(?:\[[^\]]*\])?\s*([^;#]*)/;

function pep508(manifest: string, spec: string, dev: boolean): Dependency | null {
  const m = PEP508.exec(spec);
  if (!m) return null;
  const version = m[2]!.trim();
  return { name: normalizePyName(m[1]!), version: version || null, ecosystem: "pypi", manifest, dev };
}

export function normalizePyName(name: string): string {
  return name.toLowerCase().replace(/[._]+/g, "-");
}

function parseRequirements(manifest: string, text: string, dev: boolean): Dependency[] {
  const out: Dependency[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || line.startsWith("-") || line.includes("://")) continue;
    const dep = pep508(manifest, line, dev);
    if (dep) out.push(dep);
  }
  return out;
}

function parsePyproject(manifest: string, text: string): Dependency[] {
  const doc = parseToml(text) as Record<string, any>;
  const out: Dependency[] = [];
  const project = doc.project ?? {};
  for (const spec of asStrings(project.dependencies)) push(pep508(manifest, spec, false));
  for (const [group, specs] of Object.entries(project["optional-dependencies"] ?? {})) {
    for (const spec of asStrings(specs)) push(pep508(manifest, spec, isDevGroup(group)));
  }
  for (const [group, specs] of Object.entries(doc["dependency-groups"] ?? {})) {
    for (const spec of asStrings(specs)) push(pep508(manifest, spec, isDevGroup(group)));
  }
  const poetry = doc.tool?.poetry ?? {};
  addPoetryTable(poetry.dependencies, false);
  addPoetryTable(poetry["dev-dependencies"], true);
  for (const [group, table] of Object.entries(poetry.group ?? {})) {
    addPoetryTable((table as any)?.dependencies, isDevGroup(group));
  }
  return out;

  function push(dep: Dependency | null) {
    if (dep) out.push(dep);
  }
  function addPoetryTable(table: unknown, dev: boolean) {
    if (!table || typeof table !== "object") return;
    for (const [name, value] of Object.entries(table)) {
      if (name.toLowerCase() === "python") continue;
      const version = typeof value === "string" ? value : typeof (value as any)?.version === "string" ? (value as any).version : null;
      out.push({ name: normalizePyName(name), version, ecosystem: "pypi", manifest, dev });
    }
  }
}

function parsePipfile(manifest: string, text: string): Dependency[] {
  const doc = parseToml(text) as Record<string, any>;
  const out: Dependency[] = [];
  const add = (table: unknown, dev: boolean) => {
    for (const [name, value] of Object.entries((table as object) ?? {})) {
      const version = typeof value === "string" ? (value === "*" ? null : value) : ((value as any)?.version ?? null);
      out.push({ name: normalizePyName(name), version, ecosystem: "pypi", manifest, dev });
    }
  };
  add(doc.packages, false);
  add(doc["dev-packages"], true);
  return out;
}

function parsePom(manifest: string, pomText: string): Dependency[] {
  const out: Dependency[] = [];
  // Build plugins and version management (BOMs) aren't things the application uses.
  const text = pomText.replace(/<build>[\s\S]*?<\/build>/g, "").replace(/<dependencyManagement>[\s\S]*?<\/dependencyManagement>/g, "");
  const props = new Map<string, string>();
  const propsBlock = /<properties>([\s\S]*?)<\/properties>/.exec(text)?.[1] ?? "";
  for (const m of propsBlock.matchAll(/<([\w.-]+)>([^<]*)<\/\1>/g)) props.set(m[1]!, m[2]!.trim());
  const resolve = (v: string | undefined) => (v ? v.replace(/\$\{([^}]+)\}/g, (_, k) => props.get(k) ?? `\${${k}}`) : null);

  const parent = /<parent>([\s\S]*?)<\/parent>/.exec(text)?.[1];
  if (parent) {
    const dep = pomCoordinates(parent);
    if (dep) out.push({ name: dep.name, version: resolve(dep.version), ecosystem: "maven", manifest, dev: false });
  }
  for (const m of text.matchAll(/<dependency>([\s\S]*?)<\/dependency>/g)) {
    const dep = pomCoordinates(m[1]!);
    if (!dep) continue;
    const scope = /<scope>\s*([^<\s]+)\s*<\/scope>/.exec(m[1]!)?.[1];
    out.push({ name: dep.name, version: resolve(dep.version), ecosystem: "maven", manifest, dev: scope === "test" });
  }
  return out;
}

function pomCoordinates(block: string): { name: string; version?: string } | null {
  const g = /<groupId>\s*([^<\s]+)\s*<\/groupId>/.exec(block)?.[1];
  const a = /<artifactId>\s*([^<\s]+)\s*<\/artifactId>/.exec(block)?.[1];
  if (!g || !a) return null;
  return { name: `${g}:${a}`, version: /<version>\s*([^<\s]+)\s*<\/version>/.exec(block)?.[1] };
}

function parseGradle(manifest: string, text: string): Dependency[] {
  const out: Dependency[] = [];
  // implementation 'g:a:v'   implementation("g:a:v")   testImplementation "g:a"
  const re = /\b(\w+)\s*\(?\s*['"]([\w.-]+):([\w.-]+)(?::([^'"@]+))?(?:@\w+)?['"]/g;
  for (const m of text.matchAll(re)) {
    const config = m[1]!;
    if (!/implementation|api|compileOnly|runtimeOnly|annotationProcessor|kapt|ksp|classpath/i.test(config)) continue;
    out.push({ name: `${m[2]}:${m[3]}`, version: m[4] ?? null, ecosystem: "maven", manifest, dev: /^test/i.test(config) });
  }
  // id 'org.springframework.boot' version '3.2.0'   id("org.springframework.boot") version "3.2.0"
  const plugin = /id\s*\(?\s*['"]org\.springframework\.boot['"]\s*\)?\s*version\s*['"]([^'"]+)['"]/.exec(text);
  if (plugin) {
    out.push({ name: "org.springframework.boot:spring-boot-gradle-plugin", version: plugin[1]!, ecosystem: "maven", manifest, dev: false });
  }
  return out;
}

function asStrings(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

function isDevGroup(group: string): boolean {
  return /dev|test|lint|doc|type/i.test(group);
}
