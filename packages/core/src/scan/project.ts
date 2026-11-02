import path from "node:path";
import type { Dependency, EntryPoint, Framework } from "../types.js";
import type { ReadText } from "./manifests.js";
import { isTestFile } from "./tooling.js";

export interface ProjectInput {
  paths: string[];
  sources: Map<string, string>; // loaded source text by path
  dependencies: Dependency[];
  read: ReadText;
}

const NEXT_CONFIG = /(^|\/)next\.config\.(js|mjs|cjs|ts|mts)$/;
const NEXT_APP_ROUTE = /(^|\/)(src\/)?app\/(.+\/)?(page|route)\.(tsx|ts|jsx|js)$/;
const NEXT_PAGES_ROUTE = /(^|\/)(src\/)?pages\/(?!_).+\.(tsx|ts|jsx|js)$/;
const SPRING_MAIN = /@SpringBootApplication\b/;

export function detectFrameworks({ paths, sources, dependencies }: ProjectInput): Framework[] {
  const frameworks: Framework[] = [];
  const dep = (pred: (d: Dependency) => boolean) => dependencies.find(pred);

  const next = dep((d) => d.ecosystem === "npm" && d.name === "next");
  const nextConfigs = paths.filter((p) => NEXT_CONFIG.test(p));
  if (next || nextConfigs.length) {
    frameworks.push({
      id: "nextjs",
      name: "Next.js",
      version: next?.version ?? null,
      evidence: [...(next ? [next.manifest] : []), ...nextConfigs],
    });
  }

  const django = dep((d) => d.ecosystem === "pypi" && d.name === "django");
  const managePy = paths.filter((p) => path.posix.basename(p) === "manage.py");
  const settings = paths.filter((p) => /(^|\/)settings(\/__init__)?\.py$/.test(p) && /INSTALLED_APPS/.test(sources.get(p) ?? ""));
  if (django || managePy.length || settings.length) {
    frameworks.push({
      id: "django",
      name: "Django",
      version: django?.version ?? null,
      evidence: [...(django ? [django.manifest] : []), ...managePy, ...settings],
    });
  }

  const boot = dependencies.filter((d) => d.ecosystem === "maven" && d.name.startsWith("org.springframework.boot:"));
  const springMains = [...sources].filter(([p, t]) => /\.(java|kt)$/.test(p) && SPRING_MAIN.test(t) && !isTestFile(p)).map(([p]) => p);
  if (boot.length || springMains.length) {
    frameworks.push({
      id: "spring",
      name: "Spring Boot",
      version: boot.find((d) => d.version && !d.version.includes("${"))?.version ?? null,
      evidence: unique([...boot.map((d) => d.manifest), ...springMains]),
    });
  }

  const npm = (name: string) => dep((d) => d.ecosystem === "npm" && d.name === name);
  const composer = (name: string) => dep((d) => d.ecosystem === "packagist" && d.name === name);
  const add = (id: Framework["id"], name: string, d: Dependency | undefined, extra: string[] = []) => {
    if (d || extra.length) frameworks.push({ id, name, version: d?.version ?? null, evidence: unique([...(d ? [d.manifest] : []), ...extra]) });
  };
  add("expo", "Expo", npm("expo"), paths.filter((p) => /(^|\/)app\.json$/.test(p) && /"expo"\s*:/.test(sources.get(p) ?? "")));
  add("laravel", "Laravel", composer("laravel/framework"), paths.filter((p) => p === "artisan" || p.endsWith("/artisan")));
  add("symfony", "Symfony", composer("symfony/framework-bundle"));
  add("nestjs", "NestJS", npm("@nestjs/core"));
  add("express", "Express", npm("express"));
  add("fastify", "Fastify", npm("fastify"));
  add("hono", "Hono", npm("hono"));
  add("koa", "Koa", npm("koa"));

  return frameworks;
}

export async function detectEntryPoints({ paths, sources, dependencies, read }: ProjectInput): Promise<EntryPoint[]> {
  const out: EntryPoint[] = [];
  const isNext = dependencies.some((d) => d.ecosystem === "npm" && d.name === "next") || paths.some((p) => NEXT_CONFIG.test(p));

  for (const p of paths.filter((p) => path.posix.basename(p) === "package.json")) {
    const text = await read(p);
    if (!text) continue;
    let pkg: Record<string, any>;
    try {
      pkg = JSON.parse(text);
    } catch {
      continue;
    }
    const dir = path.posix.dirname(p);
    const inDir = (f: string) => path.posix.normalize(dir === "." ? f : `${dir}/${f}`);
    if (typeof pkg.main === "string") out.push({ kind: "package-main", path: inDir(pkg.main), detail: p });
    const bins = typeof pkg.bin === "string" ? { [pkg.name ?? "bin"]: pkg.bin } : (pkg.bin ?? {});
    for (const [name, file] of Object.entries(bins)) {
      if (typeof file === "string") out.push({ kind: "package-bin", path: inDir(file), detail: name });
    }
    for (const [name, cmd] of Object.entries(pkg.scripts ?? {})) {
      if (["dev", "start", "build", "test", "serve"].includes(name) && typeof cmd === "string") {
        out.push({ kind: "package-script", path: p, detail: `${name}: ${cmd}` });
      }
    }
  }

  const appRoutes = isNext ? paths.filter((p) => NEXT_APP_ROUTE.test(p)) : [];
  if (appRoutes.length) {
    for (const root of unique(appRoutes.map((p) => p.slice(0, p.indexOf("app/") + 3)))) {
      out.push({ kind: "next-app-router", path: root, detail: `${appRoutes.filter((p) => p.startsWith(root)).length} routes` });
    }
  }
  const pageRoutes = isNext ? paths.filter((p) => NEXT_PAGES_ROUTE.test(p)) : [];
  if (pageRoutes.length) {
    for (const root of unique(pageRoutes.map((p) => p.slice(0, p.indexOf("pages/") + 5)))) {
      out.push({ kind: "next-pages-router", path: root, detail: `${pageRoutes.filter((p) => p.startsWith(root)).length} pages` });
    }
  }

  // Expo Router: screens are files under app/ (or src/app/), like Next.js but for a phone.
  const isExpo = dependencies.some((d) => d.ecosystem === "npm" && d.name === "expo-router");
  if (isExpo) {
    const screens = paths.filter((p) => /^(?:(?:apps|packages)\/[^/]+\/)?(?:src\/)?app\/.+\.(tsx|ts|jsx|js)$/.test(p) && !/\/_layout\.|\/\+(html|not-found)\./.test(p));
    for (const root of unique(screens.map((p) => p.slice(0, p.indexOf("app/") + 3)))) {
      out.push({ kind: "expo-router", path: root, detail: `${screens.filter((p) => p.startsWith(root)).length} screens and API routes` });
    }
  }

  for (const p of paths) {
    const base = path.posix.basename(p);
    if (base === "artisan" && !p.includes("/vendor/")) out.push({ kind: "artisan", path: p });
    else if (/^routes\/(web|api|console|channels)\.php$/.test(p.replace(/^.*?(?=routes\/)/, ""))) out.push({ kind: "laravel-routes", path: p });
    else if (p === "bin/console" || p.endsWith("/bin/console")) out.push({ kind: "symfony-console", path: p });
    const text = sources.get(p) ?? "";
    if (base === "manage.py") out.push({ kind: "django-manage", path: p });
    else if (/^settings(\/__init__)?\.py$/.test(base) && text.includes("INSTALLED_APPS")) out.push({ kind: "django-settings", path: p });
    else if (base === "urls.py" && text.includes("urlpatterns")) out.push({ kind: "django-urls", path: p });
    else if (base === "wsgi.py") out.push({ kind: "wsgi", path: p });
    else if (base === "asgi.py") out.push({ kind: "asgi", path: p });
    else if (/\.(java|kt)$/.test(p) && SPRING_MAIN.test(text) && !isTestFile(p)) out.push({ kind: "spring-main", path: p });
    else if (/^Dockerfile(\..+)?$/.test(base)) out.push({ kind: "dockerfile", path: p });
    else if (base === "Procfile") out.push({ kind: "procfile", path: p });
  }

  return out;
}

function unique<T>(xs: T[]): T[] {
  return [...new Set(xs)];
}
