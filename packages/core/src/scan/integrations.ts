import type { Dependency, EnvVarUsage, ImportEdge, Integration, IntegrationCategory } from "../types.js";

interface CatalogEntry {
  id: string;
  name: string;
  category: IntegrationCategory;
  npm?: (string | RegExp)[];
  pypi?: (string | RegExp)[];
  maven?: (string | RegExp)[]; // matched against "group:artifact" and JVM import prefixes
  packagist?: (string | RegExp)[]; // Composer package names
  php?: RegExp; // PHP namespaces the SDK lives under (`use Stripe\StripeClient;`)
  env?: RegExp; // env vars that belong to this integration
  refs?: RegExp; // how config refers to it when nothing imports it (DB URLs, Django backends, Prisma providers)
  // The env prefix names this vendor and nothing else, so env vars alone are enough to report it.
  // That catches services called over plain HTTP with no SDK (e.g. Shopify via fetch).
  vendorEnv?: boolean;
}

// Extend freely: an entry only needs one matching package to show up.
export const CATALOG: CatalogEntry[] = [
  { id: "stripe", name: "Stripe", category: "payments", npm: ["stripe", "@stripe/stripe-js", "@stripe/react-stripe-js"], pypi: ["stripe"], maven: ["com.stripe"], env: /^STRIPE_/, vendorEnv: true },
  { id: "shopify", name: "Shopify", category: "payments", npm: [/^@shopify\//, "shopify-api-node"], pypi: ["shopifyapi"], maven: ["com.shopify"], env: /^SHOPIFY_/, vendorEnv: true },
  { id: "paypal", name: "PayPal", category: "payments", npm: [/^@paypal\//], pypi: ["paypalrestsdk", "paypal-server-sdk"], maven: ["com.paypal"], env: /^PAYPAL_/, vendorEnv: true },
  { id: "alipay", name: "Alipay", category: "payments", maven: ["com.alipay.sdk"], pypi: ["python-alipay-sdk", "alipay-sdk-python"], env: /^ALIPAY_/ },
  { id: "paystack", name: "Paystack", category: "payments", npm: ["paystack", "@paystack/inline-js"], pypi: ["paystackapi", "pypaystack2"], env: /^PAYSTACK_/, vendorEnv: true },
  { id: "flutterwave", name: "Flutterwave", category: "payments", npm: ["flutterwave-node-v3"], pypi: ["rave-python"], env: /^(FLUTTERWAVE_|FLW_)/, vendorEnv: true },
  { id: "aws", name: "AWS SDK", category: "cloud", npm: [/^@aws-sdk\//, "aws-sdk"], pypi: ["boto3", "botocore", "aioboto3"], maven: ["software.amazon.awssdk", "com.amazonaws"], env: /^AWS_/, refs: /storages\.backends\.s3|S3Boto3Storage/ },
  { id: "google-apis", name: "Google APIs (Calendar, Drive, …)", category: "cloud", npm: ["googleapis", /^@googleapis\//, "google-auth-library"], pypi: ["google-api-python-client", "google-auth", "google-auth-oauthlib"], maven: ["com.google.api-client", "com.google.apis"] },
  { id: "gcp", name: "Google Cloud", category: "cloud", npm: [/^@google-cloud\//], pypi: [/^google-cloud(-|$)/], maven: ["com.google.cloud"], env: /^(GOOGLE_|GCP_|GCLOUD_)/, refs: /storages\.backends\.gcloud/ },
  { id: "azure", name: "Azure", category: "cloud", npm: [/^@azure\//], pypi: [/^azure-/], maven: ["com.azure", "com.microsoft.azure"], env: /^AZURE_/ },
  { id: "firebase", name: "Firebase", category: "cloud", npm: ["firebase", "firebase-admin"], pypi: ["firebase-admin"], maven: ["com.google.firebase"], env: /^(NEXT_PUBLIC_)?FIREBASE_/ },
  { id: "supabase", name: "Supabase", category: "database", npm: [/^@supabase\//], pypi: ["supabase"], env: /^(NEXT_PUBLIC_)?SUPABASE_/, vendorEnv: true },
  { id: "openai", name: "OpenAI", category: "ai", npm: ["openai", "@ai-sdk/openai"], pypi: ["openai"], maven: ["com.openai"], env: /^OPENAI_/, vendorEnv: true },
  { id: "anthropic", name: "Anthropic", category: "ai", npm: ["@anthropic-ai/sdk", "@ai-sdk/anthropic"], pypi: ["anthropic"], maven: ["com.anthropic"], env: /^ANTHROPIC_/, vendorEnv: true },
  { id: "vercel-ai", name: "Vercel AI SDK", category: "ai", npm: ["ai", /^@ai-sdk\//] },
  { id: "langchain", name: "LangChain", category: "ai", npm: ["langchain", /^@langchain\//], pypi: ["langchain", /^langchain-/] },
  { id: "twilio", name: "Twilio", category: "messaging", npm: ["twilio"], pypi: ["twilio"], maven: ["com.twilio"], env: /^TWILIO_/, vendorEnv: true },
  { id: "slack", name: "Slack", category: "messaging", npm: [/^@slack\//], pypi: ["slack-sdk", "slack-bolt"], maven: ["com.slack"], env: /^SLACK_/, vendorEnv: true },
  { id: "pusher", name: "Pusher", category: "messaging", npm: ["pusher", "pusher-js"], pypi: ["pusher"], env: /^(NEXT_PUBLIC_)?PUSHER_/ },
  { id: "sendgrid", name: "SendGrid", category: "email", npm: [/^@sendgrid\//], pypi: ["sendgrid"], maven: ["com.sendgrid"], env: /^SENDGRID_/, vendorEnv: true },
  { id: "resend", name: "Resend", category: "email", npm: ["resend", /(^|[/-])resend($|-)/], pypi: ["resend"], env: /^RESEND_/, vendorEnv: true },
  { id: "postmark", name: "Postmark", category: "email", npm: ["postmark"], pypi: ["postmarker"], env: /^POSTMARK_/, vendorEnv: true },
  { id: "nodemailer", name: "SMTP (Nodemailer)", category: "email", npm: ["nodemailer"], env: /^(SMTP_|EMAIL_)/ },
  { id: "sentry", name: "Sentry", category: "observability", npm: [/^@sentry\//], pypi: ["sentry-sdk"], maven: ["io.sentry"], env: /^(NEXT_PUBLIC_)?SENTRY_/, vendorEnv: true },
  { id: "datadog", name: "Datadog", category: "observability", npm: ["dd-trace", /^@datadog\//], pypi: ["ddtrace", "datadog"], maven: ["com.datadoghq"], env: /^(DD_|DATADOG_)/ },
  { id: "opentelemetry", name: "OpenTelemetry", category: "observability", npm: [/^@opentelemetry\//], pypi: [/^opentelemetry-/], maven: ["io.opentelemetry"], env: /^OTEL_/ },
  { id: "posthog", name: "PostHog", category: "observability", npm: ["posthog-js", "posthog-node"], pypi: ["posthog"], env: /^(NEXT_PUBLIC_)?POSTHOG_/, vendorEnv: true },
  { id: "prisma", name: "Prisma", category: "database", npm: ["prisma", "@prisma/client"], env: /^DATABASE_URL$/ },
  { id: "drizzle", name: "Drizzle ORM", category: "database", npm: ["drizzle-orm"] },
  { id: "postgres", name: "PostgreSQL driver", category: "database", npm: ["pg", "postgres", "@neondatabase/serverless"], pypi: ["psycopg2", "psycopg2-binary", "psycopg", "asyncpg"], maven: ["org.postgresql"], env: /^(POSTGRES_|PG[A-Z]+$)/, refs: /django\.db\.backends\.postgresql|jdbc:postgresql|postgres(?:ql)?:\/\/|provider\s*=\s*"postgresql"/ },
  { id: "mysql", name: "MySQL driver", category: "database", npm: ["mysql", "mysql2"], pypi: ["mysqlclient", "pymysql"], maven: ["mysql:mysql-connector-java", "com.mysql"], env: /^MYSQL_/, refs: /django\.db\.backends\.mysql|jdbc:mysql|mysql:\/\/|provider\s*=\s*"mysql"/ },
  { id: "mongodb", name: "MongoDB", category: "database", npm: ["mongodb", "mongoose"], pypi: ["pymongo", "motor", "mongoengine"], maven: ["org.mongodb", "org.springframework.boot:spring-boot-starter-data-mongodb", "org.springframework.data.mongodb"], env: /^MONGO/, refs: /mongodb(?:\+srv)?:\/\/|^\s*mongodb:\s*$/m },
  { id: "sqlalchemy", name: "SQLAlchemy", category: "database", pypi: ["sqlalchemy"] },
  { id: "mybatis", name: "MyBatis", category: "database", maven: ["org.mybatis", "com.baomidou"] },
  { id: "spring-data-jpa", name: "Spring Data JPA", category: "database", maven: ["org.springframework.boot:spring-boot-starter-data-jpa", "org.springframework.data.jpa"] },
  { id: "redis", name: "Redis", category: "cache", npm: ["redis", "ioredis", "@upstash/redis"], pypi: ["redis", "django-redis"], maven: ["org.springframework.boot:spring-boot-starter-data-redis", "org.springframework.data.redis", "redis.clients", "io.lettuce", "org.redisson"], env: /^(REDIS_|UPSTASH_)/, refs: /django_redis|rediss?:\/\/|^\s*redis:\s*$/m },
  { id: "celery", name: "Celery", category: "queue", pypi: ["celery"], env: /^CELERY_/, refs: /\bCELERY_[A-Z_]+\s*=/ },
  { id: "bullmq", name: "BullMQ", category: "queue", npm: ["bullmq", "bull"] },
  { id: "kafka", name: "Kafka", category: "queue", npm: ["kafkajs"], pypi: ["kafka-python", "confluent-kafka", "aiokafka"], maven: ["org.apache.kafka", "org.springframework.kafka"], env: /^KAFKA_/ },
  { id: "rabbitmq", name: "RabbitMQ", category: "queue", npm: ["amqplib"], pypi: ["pika", "kombu"], maven: ["com.rabbitmq", "org.springframework.boot:spring-boot-starter-amqp", "org.springframework.amqp"], env: /^(RABBITMQ_|AMQP_)/, refs: /amqps?:\/\/|^\s*rabbitmq:\s*$/m },
  { id: "inngest", name: "Inngest", category: "queue", npm: ["inngest"], pypi: ["inngest"], env: /^INNGEST_/ },
  { id: "nextauth", name: "Auth.js / NextAuth", category: "auth", npm: ["next-auth", /^@auth\//], env: /^(NEXTAUTH_|AUTH_)/ },
  { id: "clerk", name: "Clerk", category: "auth", npm: [/^@clerk\//], pypi: ["clerk-backend-api"], env: /^(NEXT_PUBLIC_)?CLERK_/, vendorEnv: true },
  { id: "auth0", name: "Auth0", category: "auth", npm: [/^@auth0\//, "auth0"], pypi: ["auth0-python"], maven: ["com.auth0"], env: /^AUTH0_/, vendorEnv: true },
  { id: "spring-security", name: "Spring Security", category: "auth", maven: ["org.springframework.boot:spring-boot-starter-security", "org.springframework.security"] },
  { id: "django-allauth", name: "django-allauth", category: "auth", pypi: ["django-allauth"] },
  { id: "jwt", name: "JWT library", category: "auth", npm: ["jsonwebtoken", "jose"], pypi: ["pyjwt", "djangorestframework-simplejwt"], maven: ["io.jsonwebtoken"], env: /^JWT_/ },
  { id: "s3-storage", name: "Object storage (S3-compatible)", category: "storage", pypi: ["django-storages"], env: /^(S3_|R2_)/, refs: /storages\.backends\.(s3|gcloud|azure)|S3Boto3Storage/ },
  { id: "aliyun-oss", name: "Aliyun OSS", category: "storage", npm: ["ali-oss"], pypi: ["oss2"], maven: ["com.aliyun.oss"], env: /^(ALIYUN_|OSS_)/ },
  { id: "minio", name: "MinIO", category: "storage", npm: ["minio"], pypi: ["minio"], maven: ["io.minio"], env: /^MINIO_/ },
  { id: "cloudinary", name: "Cloudinary", category: "storage", npm: ["cloudinary", "next-cloudinary"], pypi: ["cloudinary"], maven: ["com.cloudinary"], env: /^(NEXT_PUBLIC_)?CLOUDINARY_/, vendorEnv: true },
  { id: "uploadthing", name: "UploadThing", category: "storage", npm: ["uploadthing", /^@uploadthing\//], env: /^UPLOADTHING_/ },
  { id: "algolia", name: "Algolia", category: "search", npm: ["algoliasearch"], pypi: ["algoliasearch"], maven: ["com.algolia"], env: /^(NEXT_PUBLIC_)?ALGOLIA_/, vendorEnv: true },
  { id: "elasticsearch", name: "Elasticsearch", category: "search", npm: ["@elastic/elasticsearch"], pypi: ["elasticsearch", "elasticsearch-dsl"], maven: ["co.elastic.clients", "org.elasticsearch", "org.springframework.data.elasticsearch"], env: /^(ELASTIC|ES_)/ },
  { id: "axios", name: "Axios", category: "http-client", npm: ["axios"] },
  { id: "python-http", name: "Python HTTP client", category: "http-client", pypi: ["requests", "httpx", "aiohttp"] },
  { id: "spring-http", name: "Spring HTTP client", category: "http-client", maven: ["org.springframework.cloud:spring-cloud-starter-openfeign", "org.springframework.boot:spring-boot-starter-webflux"] },
];

function matches(patterns: (string | RegExp)[] | undefined, name: string, prefix = false): boolean {
  if (!patterns) return false;
  return patterns.some((p) => (typeof p === "string" ? name === p || (prefix && (name.startsWith(`${p}.`) || name.startsWith(`${p}:`))) : p.test(name)));
}

// PHP packages for catalog entries, kept apart so the table above stays readable.
const PHP: Record<string, { packagist: (string | RegExp)[]; php: RegExp }> = {
  stripe: { packagist: ["stripe/stripe-php", "laravel/cashier"], php: /^Stripe\\|^Laravel\\Cashier\\/ },
  paypal: { packagist: [/^paypal\//, "srmklive/paypal"], php: /^PayPal|^Srmklive\\PayPal/ },
  paystack: { packagist: [/paystack/], php: /^(Unicodeveloper\\)?Paystack/ },
  aws: { packagist: ["aws/aws-sdk-php", "league/flysystem-aws-s3-v3"], php: /^Aws\\/ },
  "google-apis": { packagist: ["google/apiclient"], php: /^Google\\(Client|Service)/ },
  gcp: { packagist: [/^google\/cloud/], php: /^Google\\Cloud\\/ },
  firebase: { packagist: ["kreait/firebase-php", "kreait/laravel-firebase"], php: /^Kreait\\/ },
  openai: { packagist: ["openai-php/client", "openai-php/laravel"], php: /^OpenAI\\?/ },
  anthropic: { packagist: [/anthropic/], php: /^Anthropic\\/ },
  twilio: { packagist: ["twilio/sdk"], php: /^Twilio\\/ },
  slack: { packagist: [/slack/], php: /Slack/ },
  sendgrid: { packagist: ["sendgrid/sendgrid", "s-ichikawa/laravel-sendgrid-driver"], php: /^SendGrid/ },
  sentry: { packagist: ["sentry/sentry-laravel", "sentry/sentry-symfony", "sentry/sentry"], php: /^Sentry\\/ },
  redis: { packagist: ["predis/predis"], php: /^Predis\\/ },
  algolia: { packagist: ["algolia/algoliasearch-client-php", "laravel/scout"], php: /^Algolia\\/ },
  pusher: { packagist: ["pusher/pusher-php-server", "laravel/reverb"], php: /^Pusher\\/ },
  mailgun: { packagist: ["mailgun/mailgun-php", "symfony/mailgun-mailer"], php: /^Mailgun\\/ },
};
for (const e of CATALOG) if (PHP[e.id]) Object.assign(e, PHP[e.id]);

export function detectIntegrations(
  dependencies: Dependency[],
  imports: ImportEdge[],
  envVars: EnvVarUsage[],
  texts: Map<string, string> = new Map(), // sources and config files to search for `refs`
): Integration[] {
  const out: Integration[] = [];
  for (const entry of CATALOG) {
    const packages = new Set<string>();
    for (const d of dependencies) {
      const list = d.ecosystem === "npm" ? entry.npm : d.ecosystem === "pypi" ? entry.pypi : d.ecosystem === "packagist" ? entry.packagist : entry.maven;
      if (matches(list, d.name, d.ecosystem === "maven")) packages.add(d.name);
    }
    const files = new Set<string>();
    for (const e of imports) {
      if (!e.external) continue;
      const ext = e.external;
      let hit: boolean;
      if (/\.py$/.test(e.from)) hit = pythonModuleNames(ext).some((n) => matches(entry.pypi, n));
      else if (/\.(java|kt|kts)$/.test(e.from)) hit = matches(entry.maven, ext, true);
      else if (/\.php$/.test(e.from)) hit = Boolean(entry.php?.test(e.specifier));
      else hit = matches(entry.npm, ext);
      if (hit) {
        files.add(e.from);
        packages.add(/\.py$/.test(e.from) ? ext.split(".")[0]! : ext);
      }
    }
    const matchedEnv = entry.env ? envVars.filter((v) => entry.env!.test(stripEnvPrefix(v.name))) : [];
    const env = matchedEnv.map((v) => v.name);
    const detectedBy: Integration["detectedBy"] = [];
    if (dependencies.some((d) => packages.has(d.name))) detectedBy.push("package");
    if (files.size) detectedBy.push("import");
    if (packages.size === 0 && files.size === 0) {
      // No SDK at all: report vendor-specific env vars used in code, and point at where they're read.
      const used = matchedEnv.filter((v) => v.files.some((f) => texts.has(f) && !isConfigFile(f)));
      if (!entry.vendorEnv || !used.length) continue;
      for (const v of used) for (const f of v.files) if (!isConfigFile(f)) files.add(f);
      detectedBy.push("env");
    }
    const configFiles = entry.refs ? [...texts].filter(([p, t]) => !files.has(p) && entry.refs!.test(t)).map(([p]) => p) : [];
    if (configFiles.length) detectedBy.push("config");
    out.push({
      id: entry.id,
      name: entry.name,
      category: entry.category,
      packages: [...packages].sort(),
      files: [...files].sort(),
      configFiles: configFiles.sort(),
      envVars: env.sort(),
      detectedBy,
    });
  }
  return out;
}

// Vendors that usually show up as a repo's own client folder rather than an SDK, so they get a real category.
const CLIENT_CATEGORY: Record<string, IntegrationCategory> = {
  klaviyo: "email", mailchimp: "email", postmark: "email", sendgrid: "email", mailgun: "email", resend: "email", customerio: "email", brevo: "email",
  intercom: "messaging", zendesk: "messaging", twilio: "messaging", slack: "messaging", discord: "messaging",
  stripe: "payments", checkoutcom: "payments", applepay: "payments", paypal: "payments", adyen: "payments", gocardless: "payments", paystack: "payments", braintree: "payments",
  algolia: "search", typesense: "search", meilisearch: "search", openai: "ai", anthropic: "ai",
};
const CLIENT_NAME: Record<string, string> = { checkoutcom: "Checkout.com", applepay: "Apple Pay", dpd: "DPD", ups: "UPS", dhl: "DHL", fedex: "FedEx", usps: "USPS", hubspot: "HubSpot", gocardless: "GoCardless" };

/**
 * Outside APIs a repo calls through its own client: an `integrations/<Name>/` folder (Saloon's layout for Laravel,
 * and a common one elsewhere). Without this, a repo that wraps an email service or a courier in its own client shows no
 * integrations at all. Each one lists the files that use its client, not just the folder itself.
 */
const TEST_DIR = /(^|\/)(tests?|__tests__|spec|fixtures?)\//i;

export function detectOwnClients(paths: string[], imports: ImportEdge[], known: Integration[]): Integration[] {
  const dirs = new Map<string, string>(); // client dir -> folder name
  for (const p of paths) {
    if (TEST_DIR.test(p)) continue; // tests mirror the client layout
    const m = p.match(/^(.*?\/[Ii]ntegrations\/([A-Z][\w-]*|[a-z][\w-]*))\//);
    if (m && !/^(index|utils?|shared|common|base|contracts?|tests?)$/i.test(m[2]!)) dirs.set(m[1]!, m[2]!);
  }
  const byName = new Map<string, { name: string; dirs: string[] }>();
  for (const [dir, folder] of dirs) {
    const slug = folder.toLowerCase().replace(/[^a-z0-9]/g, "");
    const entry = byName.get(slug) ?? { name: CLIENT_NAME[slug] ?? folder.replace(/[-_]/g, " ").replace(/^\w/, (c) => c.toUpperCase()), dirs: [] };
    entry.dirs.push(dir);
    byName.set(slug, entry);
  }
  const out: Integration[] = [];
  for (const [slug, { name, dirs: ds }] of byName) {
    const inside = (f: string | null) => !!f && ds.some((d) => f.startsWith(d + "/"));
    const files = new Set(paths.filter((p) => inside(p)));
    for (const e of imports) if (inside(e.resolved) && !inside(e.from) && !TEST_DIR.test(e.from)) files.add(e.from);
    const existing = known.find((i) => i.id === slug || i.name.toLowerCase().replace(/[^a-z0-9]/g, "") === slug);
    if (existing) {
      existing.files = [...new Set([...existing.files, ...files])].sort();
      if (!existing.detectedBy.includes("client")) existing.detectedBy.push("client");
      continue;
    }
    out.push({ id: `client:${slug}`, name, category: CLIENT_CATEGORY[slug] ?? "service", packages: [], files: [...files].sort(), configFiles: [], envVars: [], detectedBy: ["client"] });
  }
  return out;
}

// Frameworks namespace env vars (NEXT_PUBLIC_STRIPE_KEY, VITE_SENTRY_DSN); match on what's left.
const ENV_PREFIX = /^(NEXT_PUBLIC_|NEXT_PRIVATE_|VITE_|REACT_APP_|EXPO_PUBLIC_|NUXT_PUBLIC_|NUXT_|PUBLIC_|GATSBY_)/;

function stripEnvPrefix(name: string): string {
  return name.replace(ENV_PREFIX, "");
}

// Import names that differ from their PyPI distribution names.
const PY_MODULE_TO_DIST: Record<string, string> = {
  jwt: "pyjwt",
  kafka: "kafka-python",
  MySQLdb: "mysqlclient",
  rest_framework_simplejwt: "djangorestframework-simplejwt",
  allauth: "django-allauth",
  storages: "django-storages",
  slack_bolt: "slack-bolt",
  postmarker: "postmarker",
};

/** Candidate PyPI names for a dotted Python import, e.g. "google.cloud.storage" → "google-cloud-storage". */
function pythonModuleNames(mod: string): string[] {
  const top = mod.split(".")[0]!;
  const parts = mod.split(".");
  const names = new Set([PY_MODULE_TO_DIST[top] ?? top.toLowerCase().replace(/_/g, "-")]);
  for (let i = 2; i <= parts.length; i++) names.add(parts.slice(0, i).join("-").toLowerCase().replace(/_/g, "-"));
  return [...names];
}

// ---------- environment variables ----------

const ENV_PATTERNS = [
  /process\.env\.([A-Z][A-Z0-9_]*)/g,
  /process\.env\[\s*['"]([A-Z][A-Z0-9_]*)['"]\s*\]/g,
  /import\.meta\.env\.([A-Z][A-Z0-9_]*)/g,
  /os\.environ\[\s*['"]([A-Z][A-Z0-9_]*)['"]\s*\]/g,
  /os\.(?:environ\.get|getenv)\(\s*['"]([A-Z][A-Z0-9_]*)['"]/g,
  /\benv(?:\.\w+)?\(\s*['"]([A-Z][A-Z0-9_]*)['"]/g, // django-environ / decouple config("X")
  /\bconfig\(\s*['"]([A-Z][A-Z0-9_]*)['"]/g,
  /System\.getenv\(\s*"([A-Z][A-Z0-9_]*)"/g,
];

// `${VAR}` / `${VAR:default}` placeholders. Only in config files: in JS source the same syntax is a
// template literal interpolating a constant, not an env var.
const CONFIG_ENV_PATTERNS = [/\$\{([A-Z][A-Z0-9_]*)(?::[^}]*)?\}/g, /\benv\(\s*"([A-Z][A-Z0-9_]*)"\s*\)/g];

const ENV_EXAMPLE = /(^|\/)\.env(\.[\w-]+)?\.(example|sample|template|dist)$|(^|\/)\.env\.(example|sample|template)$|(^|\/)env\.example$/;
const SPRING_CONFIG = /(^|\/)application(-[\w-]+)?\.(ya?ml|properties)$/;
const OTHER_CONFIG = /\.prisma$|(^|\/)(docker-)?compose(\.[\w-]+)?\.ya?ml$/;

/** Non-source files worth reading for env vars and integration wiring. */
export function isConfigFile(rel: string): boolean {
  return ENV_EXAMPLE.test(rel) || SPRING_CONFIG.test(rel) || OTHER_CONFIG.test(rel);
}

export function detectEnvVars(sources: Map<string, string>, configTexts: Map<string, string>): EnvVarUsage[] {
  const usage = new Map<string, Set<string>>();
  const add = (name: string, file: string) => {
    const s = usage.get(name) ?? new Set();
    s.add(file);
    usage.set(name, s);
  };
  for (const [file, text] of sources) {
    for (const re of ENV_PATTERNS) for (const m of text.matchAll(re)) add(m[1]!, file);
  }
  for (const [file, text] of configTexts) {
    if (ENV_EXAMPLE.test(file)) continue;
    for (const re of CONFIG_ENV_PATTERNS) for (const m of text.matchAll(re)) add(m[1]!, file);
  }
  const documented = new Set<string>();
  for (const [p, text] of configTexts) {
    if (!ENV_EXAMPLE.test(p)) continue;
    for (const m of text.matchAll(/^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=/gm)) documented.add(m[1]!);
  }
  for (const name of documented) if (!usage.has(name)) usage.set(name, new Set());
  return [...usage]
    .map(([name, files]) => ({ name, files: [...files].sort(), documented: documented.has(name) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
