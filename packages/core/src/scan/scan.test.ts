import assert from "node:assert/strict";
import { test } from "node:test";
import { makeTree } from "../test-utils.js";
import { scan } from "./index.js";

test("Next.js repo: aliases, routes, integrations, env vars, gitignore", async () => {
  const root = await makeTree({
    ".gitignore": "generated/\n",
    "package.json": JSON.stringify({ dependencies: { next: "15.1.0", stripe: "^17.0.0", react: "19.0.0" }, devDependencies: { vitest: "^4.0.0" }, scripts: { dev: "next dev" } }),
    "tsconfig.json": `{
      // comments and trailing commas are allowed here
      "compilerOptions": { "baseUrl": ".", "paths": { "@/*": ["src/*"], }, },
    }`,
    "next.config.ts": "export default {};\n",
    ".env.example": "STRIPE_SECRET_KEY=\n",
    "src/app/page.tsx": `import { db } from "@/lib/db";\nimport Button from "../components/Button";\nexport default function Page() { return null; }\n`,
    "src/app/billing/route.ts": `import Stripe from "stripe";\nimport { db } from "@/lib/db";\nconst stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);\nconst hook = process.env.STRIPE_WEBHOOK_SECRET;\nconst pk = process.env.NEXT_PUBLIC_STRIPE_KEY;\n`,
    "src/lib/db.ts": `import fs from "node:fs";\nimport path from "path";\nexport const db = {};\n`,
    "src/components/Button.tsx": "export default function Button() { return null; }\n",
    "src/lib/db.test.ts": `import { db } from "./db.js";\n`,
    "generated/huge.ts": "export const x = 1;\n",
    "node_modules/stripe/index.js": "module.exports = {};\n",
  });

  const a = await scan(root);

  assert.ok(!a.files.some((f) => f.path.startsWith("generated/") || f.path.startsWith("node_modules/")), "ignored paths are skipped");
  assert.deepEqual(a.frameworks.map((f) => [f.id, f.version]), [["nextjs", "15.1.0"]]);

  const resolved = (from: string) => a.imports.filter((e) => e.from === from).map((e) => e.resolved ?? `ext:${e.external}`);
  assert.deepEqual(resolved("src/app/page.tsx"), ["src/lib/db.ts", "src/components/Button.tsx"]);
  assert.deepEqual(resolved("src/lib/db.ts"), ["ext:node:fs", "ext:node:path"]);
  assert.deepEqual(resolved("src/lib/db.test.ts"), ["src/lib/db.ts"], "NodeNext .js specifiers resolve to .ts files");

  const route = a.entryPoints.find((e) => e.kind === "next-app-router");
  assert.deepEqual(route, { kind: "next-app-router", path: "src/app", detail: "2 routes" });

  const stripe = a.integrations.find((i) => i.id === "stripe");
  assert.ok(stripe, "stripe detected");
  assert.deepEqual(stripe.files, ["src/app/billing/route.ts"]);
  assert.deepEqual(stripe.envVars, ["NEXT_PUBLIC_STRIPE_KEY", "STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"]);

  const webhook = a.envVars.find((v) => v.name === "STRIPE_WEBHOOK_SECRET");
  assert.equal(webhook?.documented, false);
  assert.equal(a.envVars.find((v) => v.name === "STRIPE_SECRET_KEY")?.documented, true);

  assert.deepEqual(a.tests.files, ["src/lib/db.test.ts"]);
  assert.deepEqual(a.tests.frameworks, ["vitest"]);
  assert.equal(a.root.includes("/"), false, "root is a name, not an absolute path");
});

test("tsconfig baseUrl at the repo root resolves bare internal imports", async () => {
  const root = await makeTree({
    "tsconfig.json": `{ "compilerOptions": { "baseUrl": "." } }`,
    "components/cart/index.tsx": "export const Cart = 1;\n",
    "app/page.tsx": `import { Cart } from "components/cart";\nimport clsx from "clsx";\nimport x from ".";\n`,
  });
  const a = await scan(root);
  const edges = a.imports.filter((e) => e.from === "app/page.tsx");
  assert.deepEqual(edges.map((e) => [e.resolved, e.external]), [["components/cart/index.tsx", null], [null, "clsx"], [null, null]]);
});

test("Django repo: relative and absolute imports, settings, integrations", async () => {
  const root = await makeTree({
    "requirements.txt": "Django==5.1.2\ncelery\nboto3\n",
    "manage.py": "import os\n",
    "config/settings.py": `import os\nINSTALLED_APPS = ["shop"]\nSECRET = os.environ.get("DJANGO_SECRET_KEY")\nBUCKET = os.getenv("AWS_STORAGE_BUCKET_NAME")\n`,
    "config/urls.py": `from django.urls import path\nfrom shop import views\nurlpatterns = []\n`,
    "config/wsgi.py": "",
    "shop/__init__.py": "",
    "shop/models.py": "from django.db import models\n",
    "shop/views.py": `from .models import Order\nfrom .services.payments import charge\nimport boto3\n`,
    "shop/services/__init__.py": "",
    "shop/services/payments.py": `from ..models import Order\nfrom google.cloud import storage\n`,
    "shop/tests/test_views.py": "from shop.views import x\n",
  });

  const a = await scan(root);
  assert.deepEqual(a.frameworks.map((f) => [f.id, f.version]), [["django", "==5.1.2"]]);

  const resolved = (from: string) => a.imports.filter((e) => e.from === from).map((e) => e.resolved ?? `ext:${e.external}`);
  assert.deepEqual(resolved("shop/views.py"), ["shop/models.py", "shop/services/payments.py", "ext:boto3"]);
  assert.deepEqual(resolved("shop/services/payments.py"), ["shop/models.py", "ext:google.cloud"]);
  assert.deepEqual(resolved("config/urls.py"), ["ext:django.urls", "shop/views.py"]);

  const kinds = a.entryPoints.map((e) => `${e.kind}:${e.path}`);
  for (const k of ["django-manage:manage.py", "django-settings:config/settings.py", "django-urls:config/urls.py", "wsgi:config/wsgi.py"]) {
    assert.ok(kinds.includes(k), `missing ${k}`);
  }

  const ids = a.integrations.map((i) => i.id);
  assert.ok(ids.includes("aws") && ids.includes("celery") && ids.includes("gcp"), ids.join(","));
  assert.deepEqual(a.integrations.find((i) => i.id === "aws")!.envVars, ["AWS_STORAGE_BUCKET_NAME"]);
  assert.deepEqual(a.integrations.find((i) => i.id === "gcp")!.files, ["shop/services/payments.py"]);
  assert.deepEqual(a.tests.frameworks, ["django-test"]);
});

test("Spring repo: main class, internal imports, config placeholders", async () => {
  const root = await makeTree({
    "pom.xml": `<project><parent><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter-parent</artifactId><version>3.3.2</version></parent>
      <dependencies><dependency><groupId>com.stripe</groupId><artifactId>stripe-java</artifactId><version>26.1.0</version></dependency></dependencies></project>`,
    "src/main/java/com/acme/shop/ShopApplication.java": `package com.acme.shop;\nimport org.springframework.boot.autoconfigure.SpringBootApplication;\n@SpringBootApplication\npublic class ShopApplication {}\n`,
    "src/main/java/com/acme/shop/billing/BillingService.java": `package com.acme.shop.billing;\nimport com.acme.shop.orders.OrderRepository;\nimport com.stripe.Stripe;\npublic class BillingService {}\n`,
    "src/main/java/com/acme/shop/orders/OrderRepository.java": `package com.acme.shop.orders;\npublic interface OrderRepository {}\n`,
    "src/main/resources/application.yml": "stripe:\n  key: ${STRIPE_API_KEY}\n",
    "src/test/java/com/acme/shop/ShopApplicationTests.java": "package com.acme.shop;\n",
  });

  const a = await scan(root);
  assert.deepEqual(a.frameworks.map((f) => [f.id, f.version]), [["spring", "3.3.2"]]);
  assert.ok(a.entryPoints.some((e) => e.kind === "spring-main" && e.path.endsWith("ShopApplication.java")));

  const billing = a.imports.filter((e) => e.from.endsWith("BillingService.java"));
  assert.deepEqual(billing.map((e) => e.resolved ?? `ext:${e.external}`), ["src/main/java/com/acme/shop/orders/OrderRepository.java", "ext:com.stripe.Stripe"]);

  const stripe = a.integrations.find((i) => i.id === "stripe");
  assert.deepEqual(stripe?.envVars, ["STRIPE_API_KEY"]);
  assert.deepEqual(stripe?.files, ["src/main/java/com/acme/shop/billing/BillingService.java"]);
  assert.deepEqual(a.tests.files, ["src/test/java/com/acme/shop/ShopApplicationTests.java"]);
});

test("monorepo workspace packages resolve to their source, including exports subpaths", async () => {
  const root = await makeTree({
    "package.json": JSON.stringify({ name: "acme", workspaces: ["apps/*", "packages/*"] }),
    "packages/db/package.json": JSON.stringify({ name: "@acme/db", main: "./index.ts" }),
    "packages/db/index.ts": "export const db = 1;\n",
    "packages/db/generated/types.ts": "export type T = 1;\n",
    "packages/ui/package.json": JSON.stringify({ name: "@acme/ui", exports: { ".": "./dist/index.js", "./button": { import: "./dist/button.js", types: "./dist/button.d.ts" }, "./icons/*": "./src/icons/*.tsx" } }),
    "packages/ui/src/index.ts": "export {};\n",
    "packages/ui/src/button.tsx": "export {};\n",
    "packages/ui/src/icons/logo.tsx": "export {};\n",
    "apps/web/page.tsx": [
      `import { db } from "@acme/db";`,
      `import type { T } from "@acme/db/generated/types";`,
      `import "@acme/ui";`,
      `import { Button } from "@acme/ui/button";`,
      `import Logo from "@acme/ui/icons/logo";`,
      `import React from "react";`,
    ].join("\n"),
  });
  const a = await scan(root);
  const edges = a.imports.filter((e) => e.from === "apps/web/page.tsx");
  assert.deepEqual(edges.map((e) => e.resolved ?? `ext:${e.external}`), [
    "packages/db/index.ts",
    "packages/db/generated/types.ts",
    "packages/ui/src/index.ts",
    "packages/ui/src/button.tsx",
    "packages/ui/src/icons/logo.tsx",
    "ext:react",
  ]);
});

test("Python: prose in docstrings isn't an import; huge modules still resolve", async () => {
  const big = `X = [${"1,".repeat(600_000)}]\n`;
  const root = await makeTree({
    "app/__init__.py": "",
    "app/data/__init__.py": "from .huge import X\n",
    "app/data/huge.py": big,
    "app/signals.py": `"""\nWe import app.data first.\n"""\nimport os, sys as system\nfrom app.data import X\n`,
  });
  const a = await scan(root);
  assert.deepEqual(a.skipped.map((s) => s.path), ["app/data/huge.py"]);
  assert.deepEqual(a.imports.filter((e) => e.from === "app/data/__init__.py").map((e) => e.resolved), ["app/data/huge.py"]);
  assert.deepEqual(a.imports.filter((e) => e.from === "app/signals.py").map((e) => e.resolved ?? `ext:${e.external}`), ["ext:os", "ext:sys", "app/data/__init__.py"]);
});

test("JVM wildcard imports resolve to the package directory", async () => {
  const root = await makeTree({
    "src/main/java/com/acme/security/Jwt.java": "package com.acme.security;\npublic class Jwt {}\n",
    "src/main/java/com/acme/web/Api.java": "package com.acme.web;\nimport com.acme.security.*;\nimport static com.acme.security.Jwt.*;\nimport java.util.*;\npublic class Api {}\n",
  });
  const a = await scan(root);
  assert.deepEqual(a.imports.map((e) => e.resolved ?? `ext:${e.external}`), [
    "src/main/java/com/acme/security",
    "src/main/java/com/acme/security/Jwt.java",
    "ext:java.util",
  ]);
});

test("integrations wired through config are reported with their config files", async () => {
  const root = await makeTree({
    "requirements.txt": "Django\npsycopg\ndjango-redis\n",
    "site/settings.py": `DATABASES = {"default": {"ENGINE": "django.db.backends.postgresql"}}\nCACHES = {"default": {"BACKEND": "django_redis.cache.RedisCache"}}\n`,
    "pom.xml": `<project><dependencies><dependency><groupId>org.postgresql</groupId><artifactId>postgresql</artifactId></dependency></dependencies>
      <build><plugins><plugin><dependencies><dependency><groupId>com.google.cloud.tools</groupId><artifactId>jib</artifactId></dependency></dependencies></plugin></plugins></build></project>`,
    "src/main/resources/application.yml": "spring:\n  datasource:\n    url: jdbc:postgresql://localhost/app\n    password: ${DB_PASSWORD}\n",
  });
  const a = await scan(root);
  const byId = Object.fromEntries(a.integrations.map((i) => [i.id, i]));
  assert.deepEqual(byId.postgres?.configFiles, ["site/settings.py", "src/main/resources/application.yml"]);
  assert.deepEqual(byId.redis?.configFiles, ["site/settings.py"]);
  assert.equal(byId.gcp, undefined, "build plugins aren't integrations");
  assert.ok(a.envVars.some((v) => v.name === "DB_PASSWORD"));
});

test("type-only modules in .d.ts files resolve", async () => {
  const root = await makeTree({
    "packages/types/package.json": JSON.stringify({ name: "@acme/types" }),
    "packages/types/Calendar.d.ts": "export type Cal = 1;\n",
    "packages/app/types.d.ts": "export type T = 1;\n",
    "packages/app/components/Card.tsx": `import type { T } from "../types";\nimport type { Cal } from "@acme/types/Calendar";\n`,
  });
  const a = await scan(root);
  assert.deepEqual(a.imports.map((e) => e.resolved), ["packages/app/types.d.ts", "packages/types/Calendar.d.ts"]);
});

test("Python absolute imports resolve from source roots, not from any matching folder name", async () => {
  const root = await makeTree({
    "manage.py": "",
    "shop/__init__.py": "",
    "shop/graphql/__init__.py": "",
    "shop/graphql/api.py": "from graphql import GraphQLError\nfrom shop.graphql import schema\nimport email.message\n",
    "shop/graphql/schema.py": "",
    "shop/notify/email/__init__.py": "",
    "backend/pyproject.toml": "[project]\nname = 'x'\n",
    "backend/src/core/__init__.py": "",
    "backend/src/core/app.py": "from core import settings\n",
    "backend/src/core/settings.py": "",
  });
  const a = await scan(root);
  const out = (from: string) => a.imports.filter((e) => e.from === from).map((e) => e.resolved ?? `ext:${e.external}`);
  assert.deepEqual(out("shop/graphql/api.py"), ["ext:graphql", "shop/graphql/schema.py", "ext:email.message"]);
  assert.deepEqual(out("backend/src/core/app.py"), ["backend/src/core/settings.py"]);
});

test("Spring Data packages count as usage of their store", async () => {
  const root = await makeTree({
    "pom.xml": `<project><dependencies>
      <dependency><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter-data-mongodb</artifactId></dependency>
      <dependency><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter-data-redis</artifactId></dependency>
    </dependencies></project>`,
    "src/main/java/com/acme/Repo.java": "package com.acme;\nimport org.springframework.data.mongodb.repository.MongoRepository;\nimport org.springframework.data.redis.core.RedisTemplate;\npublic class Repo {}\n",
    "src/main/resources/application.yml": "spring:\n  data:\n    mongodb:\n      host: localhost\n  redis:\n    host: localhost\n",
  });
  const a = await scan(root);
  const byId = Object.fromEntries(a.integrations.map((i) => [i.id, i]));
  assert.deepEqual(byId.mongodb?.files, ["src/main/java/com/acme/Repo.java"]);
  assert.deepEqual(byId.mongodb?.configFiles, ["src/main/resources/application.yml"]);
  assert.deepEqual(byId.redis?.files, ["src/main/java/com/acme/Repo.java"]);
});

test("services called without an SDK are found from vendor env vars; template literals aren't env vars", async () => {
  const root = await makeTree({
    "package.json": JSON.stringify({ dependencies: { next: "15.0.0" } }),
    "lib/constants.ts": `export const SHOPIFY_GRAPHQL_API_ENDPOINT = "/api/2023-01/graphql.json";\n`,
    "lib/shopify/index.ts": [
      `import { SHOPIFY_GRAPHQL_API_ENDPOINT } from "../constants";`,
      "const domain = process.env.SHOPIFY_STORE_DOMAIN;",
      "const endpoint = `${domain}${SHOPIFY_GRAPHQL_API_ENDPOINT}`;",
      "export const shopifyFetch = () => fetch(endpoint, { headers: { token: process.env.SHOPIFY_STOREFRONT_ACCESS_TOKEN! } });",
    ].join("\n"),
    "lib/mail.ts": "const host = process.env.SMTP_HOST;\n",
  });
  const a = await scan(root);
  assert.deepEqual(a.envVars.map((v) => v.name), ["SHOPIFY_STORE_DOMAIN", "SHOPIFY_STOREFRONT_ACCESS_TOKEN", "SMTP_HOST"]);
  const shopify = a.integrations.find((i) => i.id === "shopify");
  assert.deepEqual(shopify && { files: shopify.files, detectedBy: shopify.detectedBy }, { files: ["lib/shopify/index.ts"], detectedBy: ["env"] });
  assert.equal(a.integrations.find((i) => i.id === "nodemailer"), undefined, "generic prefixes like SMTP_ need a package");
});
