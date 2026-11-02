import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { inflateSync } from "node:zlib";
import type { Analysis } from "../types.js";

// The official docs of the stack a repo uses, as the source of truth for lessons. Pages are fetched
// (never recalled from memory), cached with the docs' own version, and quotes are checked against them.

export type DocSourceId = "nextjs" | "react" | "django" | "expo" | "react-native" | "laravel" | "nestjs" | "fastify" | "express" | "hono" | "node";

export interface DocSource {
  id: DocSourceId;
  name: string;
  packages: string[]; // dependency names that mean the repo uses it
  index: string; // where the list of pages comes from
  release: string; // package registry entry, for the latest released version
}

export const DOC_SOURCES: DocSource[] = [
  { id: "nextjs", name: "Next.js", packages: ["next"], index: "https://nextjs.org/docs/llms.txt", release: "https://registry.npmjs.org/next/latest" },
  { id: "react", name: "React", packages: ["react"], index: "https://react.dev/llms.txt", release: "https://registry.npmjs.org/react/latest" },
  { id: "django", name: "Django", packages: ["django", "Django"], index: "https://docs.djangoproject.com/en/stable/objects.inv", release: "https://pypi.org/pypi/django/json" },
  { id: "expo", name: "Expo", packages: ["expo"], index: "https://docs.expo.dev/llms.txt", release: "https://registry.npmjs.org/expo/latest" },
  { id: "react-native", name: "React Native", packages: ["react-native"], index: "https://reactnative.dev/llms.txt", release: "https://registry.npmjs.org/react-native/latest" },
  { id: "laravel", name: "Laravel", packages: ["laravel/framework"], index: "https://laravel.com/docs", release: "https://repo.packagist.org/p2/laravel/framework.json" },
  { id: "nestjs", name: "NestJS", packages: ["@nestjs/core"], index: "https://docs.nestjs.com/llms.txt", release: "https://registry.npmjs.org/@nestjs/core/latest" },
  { id: "fastify", name: "Fastify", packages: ["fastify"], index: "https://fastify.dev/llms.txt", release: "https://registry.npmjs.org/fastify/latest" },
  { id: "express", name: "Express", packages: ["express"], index: "https://expressjs.com/llms/api-5x.txt", release: "https://registry.npmjs.org/express/latest" },
  { id: "hono", name: "Hono", packages: ["hono"], index: "https://hono.dev/llms.txt", release: "https://registry.npmjs.org/hono/latest" },
  { id: "node", name: "Node.js", packages: ["express", "fastify", "@nestjs/core", "koa", "hono"], index: "https://nodejs.org/dist/index.json", release: "https://nodejs.org/dist/index.json" },
];

// Hosts that serve each docs page as Markdown at "<page>.md": cleaner to read and to check quotes against.
const MARKDOWN_HOSTS = /^https:\/\/(nextjs\.org|react\.dev|docs\.expo\.dev|reactnative\.dev|docs\.nestjs\.com|fastify\.dev)\//;

// APIs documented on a concept page rather than one of their own: name → the page's slug.
const ALIASES: Partial<Record<DocSourceId, Record<string, string>>> = {
  nestjs: {
    Injectable: "providers", Inject: "custom-providers", Module: "modules", Global: "modules", Controller: "controllers", Get: "controllers", Post: "controllers",
    Put: "controllers", Patch: "controllers", Delete: "controllers", Param: "controllers", Body: "controllers", Query: "controllers", Headers: "controllers",
    Req: "controllers", Res: "controllers", HttpCode: "controllers", UseGuards: "guards", CanActivate: "guards", UseInterceptors: "interceptors",
    UsePipes: "pipes", ValidationPipe: "validation", Catch: "exception-filters", HttpException: "exception-filters", NestFactory: "first-steps",
    Cron: "task-scheduling", Interval: "task-scheduling", OnEvent: "events", Process: "queues", Processor: "queues", ConfigService: "configuration",
    InjectRepository: "database", Logger: "logger", createParamDecorator: "custom-decorators", SetMetadata: "custom-decorators", applyDecorators: "custom-decorators",
  },
  fastify: { register: "Plugins", decorate: "Decorators", addHook: "Hooks", route: "Routes", get: "Routes", post: "Routes", listen: "Server", inject: "Testing", log: "Logging" },
  "react-native": { StyleSheet: "stylesheet", Platform: "platform" },
};

// Laravel facades and core classes → their docs page.
const LARAVEL_PAGES: Record<string, string> = {
  Route: "routing", Cache: "cache", Queue: "queues", Bus: "queues", Mail: "mail", DB: "database", Schema: "migrations", Storage: "filesystem",
  Http: "http-client", Event: "events", Log: "logging", Auth: "authentication", Gate: "authorization", Validator: "validation", Schedule: "scheduling",
  Session: "session", Notification: "notifications", Redis: "redis", Artisan: "artisan", Config: "configuration", Hash: "hashing", Crypt: "encryption",
  Lang: "localization", View: "views", Response: "responses", Request: "requests", Broadcast: "broadcasting", Cookie: "requests", URL: "urls",
  Password: "passwords", RateLimiter: "rate-limiting", Process: "processes", Concurrency: "concurrency", Context: "context", Model: "eloquent",
  Collection: "collections", Str: "strings", Arr: "helpers", Carbon: "helpers", Blade: "blade", Vite: "vite", Pipeline: "helpers",
};

export interface DocPage {
  title: string;
  url: string; // the page people open
  source: DocSourceId;
  version: string | null; // the docs' version, e.g. "16.4.3"
  renamedFrom?: string; // the repo calls it by an older name (unstable_cacheTag → cacheTag)
}

export interface StackDoc {
  source: DocSource;
  installed: string | null; // the version the repo declares
  latest: string | null; // the version the official docs describe
}

interface Index {
  version: string | null;
  pages: { title: string; url: string; key: string }[]; // key: a lowercase, punctuation-free name for matching
}

type Fetch = (url: string) => Promise<{ ok: boolean; status: number; text(): Promise<string>; arrayBuffer(): Promise<ArrayBuffer> }>;

const DAY = 24 * 60 * 60 * 1000;
const keyOf = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** The repo's dependencies that have an official docs source, with installed vs latest versions. */
export async function stackDocs(docs: OfficialDocs, analysis: Analysis): Promise<StackDoc[]> {
  const out: StackDoc[] = [];
  for (const source of DOC_SOURCES) {
    const dep = analysis.dependencies.find((d) => source.packages.includes(d.name));
    if (!dep) continue;
    const idx = await docs.index(source.id).catch(() => null);
    // Node isn't a dependency: it's listed because a server framework is, so there's no installed version to show.
    out.push({ source, installed: source.id === "node" ? null : (dep.version?.replace(/^[\^~>=<\s]+/, "") ?? null), latest: idx?.version ?? (await docs.latestRelease(source.id)) });
  }
  return out;
}

export class OfficialDocs {
  private indexes = new Map<DocSourceId, Promise<Index | null>>();
  constructor(
    private rootDir: string,
    private fetcher: Fetch = globalThis.fetch as unknown as Fetch,
    private now: () => number = Date.now,
  ) {}

  private cachePath(url: string) {
    return path.join(path.resolve(this.rootDir), ".houserules", "cache", "docs", `${createHash("sha1").update(url).digest("hex").slice(0, 16)}.json`);
  }

  /** A cached fetch: fresh for a week, and a stale copy is used when the network is down. */
  private async get(url: string, binary = false): Promise<string | null> {
    const file = this.cachePath(url);
    let cached: { fetchedAt: number; body: string } | null = null;
    try {
      cached = JSON.parse(await readFile(file, "utf8"));
    } catch {
      // not cached
    }
    if (cached && this.now() - cached.fetchedAt < 7 * DAY) return cached.body;
    try {
      const res = await this.fetcher(url);
      if (!res.ok) return cached?.body ?? null;
      const body = binary ? Buffer.from(await res.arrayBuffer()).toString("base64") : await res.text();
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, JSON.stringify({ url, fetchedAt: this.now(), body }));
      return body;
    } catch {
      return cached?.body ?? null;
    }
  }

  /** The list of pages for a docs source, and the version it documents. */
  index(id: DocSourceId): Promise<Index | null> {
    let p = this.indexes.get(id);
    if (!p) {
      p = this.loadIndex(id);
      this.indexes.set(id, p);
    }
    return p;
  }

  private async loadIndex(id: DocSourceId): Promise<Index | null> {
    const source = DOC_SOURCES.find((s) => s.id === id)!;
    if (id === "django") {
      const b64 = await this.get(source.index, true);
      return b64 ? parseSphinxInventory(Buffer.from(b64, "base64")) : null;
    }
    const text = await this.get(source.index);
    if (!text) return null;
    if (id === "laravel") {
      // The docs home lists every current page (/framework/docs/<slug>) and names the version most often.
      const counts = new Map<string, number>();
      for (const m of text.matchAll(/\b(\d+)\.x\b/g)) counts.set(m[1]!, (counts.get(m[1]!) ?? 0) + 1);
      const version = [...counts].sort((a, b) => b[1] - a[1] || Number(b[0]) - Number(a[0]))[0]?.[0];
      const links = [...text.matchAll(/href="(?:https:\/\/laravel\.com)?(\/framework\/docs\/((?:\d+\.x\/)?)([a-z0-9-]+))"/g)].filter((m) => !m[2]);
      const pages = [...new Map(links.map((m) => [m[3]!, { title: m[3]!, url: `https://laravel.com${m[1]}`, key: keyOf(m[3]!) }])).values()];
      return { version: version ? `${version}.x` : null, pages };
    }
    if (id === "node") {
      const latest = (JSON.parse(text) as { version: string; lts: string | false }[]).find((r) => r.lts);
      return { version: latest?.version.replace(/^v/, "") ?? null, pages: [] };
    }
    const origin = new URL(source.index).origin;
    const version = text.match(/@doc-version:\s*(\S+)/)?.[1] ?? null;
    const pages = [...text.matchAll(/\[([^\]]+)\]\(((?:https?:\/\/|\/)[^)\s]+)\)/g)].map((m) => {
      const url = (m[2]!.startsWith("/") ? origin + m[2]! : m[2]!).replace(/(\/index)?\.md$/, "");
      return { title: m[1]!, url, key: keyOf(url.split("/").pop()!) };
    });
    return { version, pages };
  }

  /**
   * The official page for a framework API, as the call graph names it ("next/cache · revalidateTag",
   * "react · useOptimistic", "django.shortcuts · render"). Prefers API reference pages.
   */
  async lookupApi(api: string): Promise<DocPage | null> {
    const [pkg, name] = api.includes(" · ") ? (api.split(" · ") as [string, string]) : ["", api];
    const id: DocSourceId | null =
      /^next(\/|$)/.test(pkg) ? "nextjs"
      : /^react-native(\/|$)/.test(pkg) ? "react-native"
      : /^react(-dom)?(\/|$)/.test(pkg) ? "react"
      : /^(expo(-[\w-]+)?|@expo\/)/.test(pkg) ? "expo"
      : /^django(\.|$)/.test(pkg) ? "django"
      : /^Illuminate\\/.test(pkg) ? "laravel"
      : /^@nestjs\//.test(pkg) ? "nestjs"
      : /^fastify(\/|$)/.test(pkg) ? "fastify"
      : /^express(\/|$)/.test(pkg) ? "express"
      : /^hono(\/|$)/.test(pkg) ? "hono"
      : /^node:/.test(pkg) ? "node"
      : null;
    if (!id) return null;
    if (id === "node") {
      const mod = pkg.slice(5).split("/")[0]!;
      const idx = await this.index("node");
      return { title: `node:${mod}`, url: `https://nodejs.org/docs/latest/api/${mod}.html`, source: id, version: idx?.version ?? null };
    }
    if (id === "express") {
      return { title: name, url: `https://expressjs.com/en/5x/api.html#${name.toLowerCase()}`, source: id, version: (await this.latestRelease("express")) };
    }
    const idx = await this.index(id);
    if (!idx) return null;
    if (id === "laravel") {
      const cls = pkg.split("\\").pop()!;
      const slug = LARAVEL_PAGES[cls] ?? (/\\Events\\/.test(pkg) ? "events" : /\\Pagination\\/.test(pkg) ? "pagination" : /\\Notifications\\/.test(pkg) ? "notifications" : /\\Http\\\w*Response$/.test(pkg) ? "responses" : /\\Validation\\/.test(pkg) ? "validation" : /\\Database\\Eloquent\\/.test(pkg) ? "eloquent" : undefined);
      const hit = slug ? idx.pages.find((p) => p.title === slug) : undefined;
      return hit ? { title: `${cls} (${slug})`, url: hit.url, source: id, version: idx.version } : null;
    }

    if (id === "django") {
      const full = `${pkg}.${name}`;
      const hit = idx.pages.find((p) => p.title === full) ?? idx.pages.find((p) => p.title.endsWith(`.${name}`) && p.title.startsWith(pkg));
      return hit ? { title: hit.title, url: hit.url, source: id, version: idx.version } : null;
    }
    const find = (n: string) => {
      const key = keyOf(ALIASES[id]?.[n] ?? n);
      const candidates = idx.pages.filter((p) => p.key === key || keyOf(p.title) === key);
      // API reference over guides; functions for camelCase names, components for PascalCase; App Router over Pages.
      const kind = /^[A-Z]/.test(n) ? /\/components\// : /\/functions\/|\/reference\/react(-dom)?\//;
      const rank = (u: string) => (/api-reference|\/reference\//.test(u) ? 0 : 4) + (kind.test(u) ? 0 : 1) + (/\/pages\//.test(u) ? 2 : 0) + (/legacy/.test(u) ? 3 : 0);
      return candidates.sort((a, b) => rank(a.url) - rank(b.url))[0];
    };
    const hit = find(name);
    if (hit) return { title: hit.title, url: hit.url, source: id, version: idx.version ?? (await this.latestRelease(id)) };
    // unstable_cacheTag → cacheTag: an API that has since been stabilised under a new name.
    const stable = name.replace(/^(unstable|experimental)_/, "");
    const renamed = stable !== name ? find(stable) : undefined;
    if (renamed) return { title: renamed.title, url: renamed.url, source: id, version: idx.version, renamedFrom: name };
    if (id === "expo" && /^expo-[\w-]+$/.test(pkg)) {
      // expo-image-picker · launchImageLibraryAsync → the SDK page for that package (…/sdk/imagepicker).
      const sdk = keyOf(pkg.replace(/^expo-/, ""));
      const page = idx.pages.find((p) => /\/sdk\//.test(p.url) && p.key === sdk);
      if (page) return { title: page.title, url: page.url, source: id, version: idx.version ?? (await this.latestRelease(id)) };
    }
    return null;
  }

  /** The latest released version, from npm or PyPI, for docs that don't state one. */
  async latestRelease(id: DocSourceId): Promise<string | null> {
    const body = await this.get(DOC_SOURCES.find((s) => s.id === id)!.release);
    try {
      const j = JSON.parse(body ?? "null");
      if (id === "node") return (j as { version: string; lts: string | false }[]).find((r) => r.lts)?.version.replace(/^v/, "") ?? null;
      // Packagist p2: { packages: { "laravel/framework": [{ version: "v12.3.0", … }, …] } }, newest first.
      const pk = j?.packages && (Object.values(j.packages)[0] as { version: string }[] | undefined)?.find((v) => /^v?\d+\.\d+\.\d+$/.test(v.version));
      return pk ? pk.version.replace(/^v/, "") : (j?.version ?? j?.info?.version ?? null);
    } catch {
      return null;
    }
  }

  /** A page's text (Markdown where the site offers it), for reading and for checking quotes. */
  async pageText(url: string): Promise<string | null> {
    if (MARKDOWN_HOSTS.test(url)) return this.get(`${url.replace(/#.*$/, "").replace(/\/$/, "")}.md`);
    const html = await this.get(url.replace(/#.*$/, ""));
    return html ? htmlToText(html) : null;
  }

  /** Whether a quote really appears on the official page (whitespace and Markdown punctuation ignored). */
  async verifyQuote(url: string, quote: string): Promise<boolean> {
    const text = await this.pageText(url);
    if (!text) return false;
    const plain = (s: string) => s.replace(/[`*_>#[\]()]/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
    return plain(text).includes(plain(quote));
  }
}

/** Sphinx objects.inv: four text header lines, then zlib-compressed "name domain:role prio uri dispname" lines. */
export function parseSphinxInventory(buf: Buffer, base?: string): Index {
  let offset = 0;
  const header: string[] = [];
  for (let i = 0; i < 4; i++) {
    const nl = buf.indexOf(10, offset);
    header.push(buf.subarray(offset, nl).toString("utf8"));
    offset = nl + 1;
  }
  const version = header[2]?.replace(/^# Version:\s*/, "").trim() || null;
  const root = base ?? `https://docs.djangoproject.com/en/${version ?? "stable"}/`;
  const pages: Index["pages"] = [];
  for (const line of inflateSync(buf.subarray(offset)).toString("utf8").split("\n")) {
    const m = line.match(/^(.+?)\s+(\S+:\S+)\s+(-?\d+)\s+(\S+)\s+(.*)$/);
    if (!m || !/^py:(function|class|method|attribute|module|data|exception|decorator)$/.test(m[2]!)) continue;
    const uri = m[4]!.endsWith("$") ? m[4]!.slice(0, -1) + m[1]! : m[4]!;
    pages.push({ title: m[1]!, url: root + uri, key: keyOf(m[1]!.split(".").pop()!) });
  }
  return { version, pages };
}

function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|nav|header|footer)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}
