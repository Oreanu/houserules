export const ANALYSIS_VERSION = 1;

export type Language =
  | "typescript"
  | "javascript"
  | "python"
  | "java"
  | "kotlin"
  | "php"
  | "other";

export type Ecosystem = "npm" | "pypi" | "maven" | "packagist";

export interface SourceFile {
  path: string; // repo-relative, forward slashes
  language: Language;
  lines: number;
  bytes: number;
  sha256: string;
}

export interface LanguageStat {
  language: Language;
  files: number;
  lines: number;
}

export interface Dependency {
  name: string;
  version: string | null; // as declared; null when unpinned
  ecosystem: Ecosystem;
  manifest: string;
  dev: boolean;
}

export interface Framework {
  id: "nextjs" | "django" | "spring" | "expo" | "laravel" | "symfony" | "express" | "fastify" | "nestjs" | "hono" | "koa";
  name: string;
  version: string | null;
  evidence: string[]; // repo-relative paths that triggered detection
}

export interface ImportEdge {
  from: string; // importing file
  specifier: string; // as written in source
  resolved: string | null; // internal file it resolves to (a directory for JVM wildcard imports)
  external: string | null; // package name, if third-party or stdlib
  line: number;
}

export type IntegrationCategory =
  | "payments"
  | "cloud"
  | "ai"
  | "messaging"
  | "email"
  | "observability"
  | "database"
  | "cache"
  | "queue"
  | "auth"
  | "storage"
  | "search"
  | "http-client"
  | "service"; // an outside API the repo calls through its own client (no SDK)

export interface Integration {
  id: string;
  name: string;
  category: IntegrationCategory;
  packages: string[]; // matched dependency/import names
  files: string[]; // files importing it
  configFiles: string[]; // files wiring it up by name or URL (settings, application.yml, schema.prisma…)
  envVars: string[];
  detectedBy: ("package" | "import" | "config" | "env" | "client")[]; // env alone means it's called without an SDK (plain HTTP); client means the repo's own API client
}

export interface EnvVarUsage {
  name: string;
  files: string[];
  documented: boolean; // listed in a .env.example-style file
}

export interface EntryPoint {
  kind:
    | "package-main"
    | "package-bin"
    | "package-script"
    | "next-app-router"
    | "next-pages-router"
    | "expo-router"
    | "laravel-routes"
    | "artisan"
    | "symfony-console"
    | "django-manage"
    | "django-settings"
    | "django-urls"
    | "wsgi"
    | "asgi"
    | "spring-main"
    | "dockerfile"
    | "procfile";
  path: string;
  detail?: string;
}

export interface TestInfo {
  files: string[];
  frameworks: string[];
}

export interface CiConfig {
  provider: "github-actions" | "gitlab" | "circleci" | "jenkins" | "azure-pipelines";
  path: string;
}

export interface Analysis {
  version: typeof ANALYSIS_VERSION;
  generatedAt: string;
  tool: { name: "houserules"; version: string };
  root: string; // repo name only, never an absolute path
  languages: LanguageStat[];
  files: SourceFile[];
  dependencies: Dependency[];
  frameworks: Framework[];
  entryPoints: EntryPoint[];
  imports: ImportEdge[];
  integrations: Integration[];
  envVars: EnvVarUsage[];
  tests: TestInfo;
  ci: CiConfig[];
  skipped: { path: string; reason: string }[];
}
