import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { scan } from "../scan/index.js";
import { makeTree } from "../test-utils.js";
import { renderDocs } from "../docs/render.js";
import { readStore, submitSection } from "../docs/store.js";
import { architectureMap, architectureMermaid, flowMermaid, flowSteps } from "./architecture.js";
import { dataModel, dataModelMermaid } from "./datamodel.js";
import { timeline } from "./timeline.js";

test("architecture map groups folders into modules and counts imports between them", async () => {
  const root = await makeTree({
    "package.json": JSON.stringify({ dependencies: { stripe: "1" } }),
    "app/page.tsx": `import { db } from "../lib/db";\nimport { Button } from "../components/button";\n`,
    "app/cart/page.tsx": `import { db } from "../../lib/db";\nimport { pay } from "../../lib/pay";\n`,
    "lib/db.ts": "export const db = 1;\n",
    "lib/pay.ts": `import Stripe from "stripe";\nexport const pay = 1;\n`,
    "components/button.tsx": `import { db } from "../lib/db";\nexport const Button = 1;\n`,
    ".github/scripts/release.ts": "export {};\n",
    "app/page.test.tsx": `import { db } from "../lib/db";\n`,
  });
  const map = architectureMap(await scan(root));
  const label = (id: string) => map.nodes.find((n) => n.id === id)!.label;
  assert.deepEqual(map.nodes.map((n) => n.label).sort(), ["app", "app/cart", "components", "lib"].sort(), "tooling folders and tests are left out");
  assert.deepEqual(
    map.edges.map((e) => `${label(e.from)}>${label(e.to)}:${e.imports}`).sort(),
    ["app/cart>lib:2", "app>components:1", "app>lib:1", "components>lib:1"],
  );
  assert.deepEqual(map.services.map((s) => [s.name, s.usedBy.map(label)]), [["Stripe", ["lib"]]]);
  assert.match(architectureMermaid(map), /^flowchart LR\n/);
});

test("monorepos are mapped by package, and Java package chains are collapsed", async () => {
  const root = await makeTree({
    "apps/web/src/a.ts": `import { x } from "@acme/db";\n`,
    "apps/web/src/b.ts": "export {};\n",
    "packages/db/package.json": JSON.stringify({ name: "@acme/db", main: "index.ts" }),
    "packages/db/index.ts": "export const x = 1;\n",
    "packages/ui/index.ts": "export {};\n",
    "src/main/java/com/acme/shop/web/Api.java": "package com.acme.shop.web;\nimport com.acme.shop.service.Billing;\nclass Api {}\n",
    "src/main/java/com/acme/shop/service/Billing.java": "package com.acme.shop.service;\npublic class Billing {}\n",
  });
  const labels = architectureMap(await scan(root)).nodes.map((n) => n.label).sort();
  assert.ok(labels.includes("apps/web") && labels.includes("packages/db") && labels.includes("packages/ui"), labels.join(","));
  assert.ok(labels.some((l) => l.endsWith("shop/web")) && labels.some((l) => l.endsWith("shop/service")), labels.join(","));
});

test("data model: Prisma models, relations and keys", async () => {
  const root = await makeTree({
    "package.json": "{}",
    "prisma/schema.prisma": `model User {\n  id    Int     @id\n  email String\n  posts Post[]\n}\n\nmodel Post {\n  id       Int  @id\n  authorId Int\n  author   User @relation(fields: [authorId], references: [id])\n}\n`,
  });
  const m = await dataModel(root, await scan(root));
  assert.equal(m.source, "prisma");
  assert.deepEqual(m.entities.map((e) => e.name), ["User", "Post"]);
  assert.deepEqual(m.entities[1]!.fields.find((f) => f.name === "authorId"), { name: "authorId", type: "Int", pk: false, fk: true });
  assert.deepEqual(m.relations.map((r) => `${r.from}-${r.kind}->${r.to}`), ["User-one-to-many->Post"]);
  assert.match(dataModelMermaid(m), /User \|\|--o\{ Post : "posts"/);
});

test("data model: Django models with foreign keys and inheritance", async () => {
  const root = await makeTree({
    "manage.py": "",
    "shop/models.py": `from django.db import models\n\nclass Base(models.Model):\n    created = models.DateTimeField()\n\nclass Customer(Base):\n    name = models.CharField(max_length=10)\n\nclass Order(models.Model):\n    customer = models.ForeignKey("shop.Customer", on_delete=models.CASCADE)\n    tags = models.ManyToManyField("Tag")\n\nclass Tag(models.Model):\n    label = models.CharField(max_length=5)\n`,
  });
  const m = await dataModel(root, await scan(root));
  assert.equal(m.source, "django");
  assert.deepEqual(m.relations.map((r) => `${r.from}-${r.kind}->${r.to}`).sort(), ["Customer-extends->Base", "Order-many-to-many->Tag", "Order-many-to-one->Customer"]);
});

test("data model: JPA entities ignore 'class' in Javadoc; richest source wins over a few documents", async () => {
  const root = await makeTree({
    "src/main/java/a/Owner.java": `package a;\n/** Used as a base class for people. */\n@Entity\npublic class Owner extends Person {\n  @OneToMany(mappedBy = "owner")\n  private List<Pet> pets;\n  private String city;\n}\n`,
    "src/main/java/a/Person.java": `package a;\n@MappedSuperclass\npublic class Person {\n  @Id\n  private Integer id;\n}\n`,
    "src/main/java/a/Pet.java": `package a;\n@Entity\npublic class Pet {\n  @ManyToOne\n  private Owner owner;\n}\n`,
  });
  const m = await dataModel(root, await scan(root));
  assert.equal(m.source, "jpa");
  assert.deepEqual(m.entities.map((e) => e.name).sort(), ["Owner", "Person", "Pet"]);
  assert.deepEqual(m.relations.map((r) => `${r.from}-${r.kind}->${r.to}`).sort(), ["Owner-extends->Person", "Owner-one-to-many->Pet"]);
});

test("data model: SQL without foreign keys gets relations inferred from *_id columns", async () => {
  const root = await makeTree({
    "db/shop.sql": "CREATE TABLE pms_product (\n  id bigint PRIMARY KEY,\n  name varchar(64)\n);\nCREATE TABLE ums_member (\n  id bigint PRIMARY KEY\n);\nCREATE TABLE oms_cart_item (\n  id bigint PRIMARY KEY,\n  product_id bigint,\n  member_id bigint\n);\n",
  });
  const m = await dataModel(root, await scan(root));
  assert.equal(m.source, "sql");
  assert.deepEqual(m.relations.map((r) => `${r.from}->${r.to}:${r.label}`).sort(), ["oms_cart_item->pms_product:product_id (inferred)", "oms_cart_item->ums_member:member_id (inferred)"]);
});

test("data model: TypeScript domain types when there is no database", async () => {
  const root = await makeTree({
    "lib/types.ts": "export type Money = {\n  amount: string;\n};\nexport type CartItem = {\n  cost: Money;\n};\nexport type Cart = {\n  lines: CartItem[];\n  total: Money;\n};\n",
  });
  const m = await dataModel(root, await scan(root));
  assert.equal(m.source, "typescript");
  assert.ok(m.relations.some((r) => r.from === "Cart" && r.to === "CartItem" && r.kind === "one-to-many"));
});

test("timeline: module birth dates from git history; shallow or missing history is explained", async () => {
  const root = await makeTree({ "lib/a.ts": "export {};\n" });
  const git = (...args: string[]) => execFileSync("git", ["-C", root, ...args], { env: { ...process.env, GIT_AUTHOR_DATE: process.env.D, GIT_COMMITTER_DATE: process.env.D } });
  const commit = (date: string, msg: string) => execFileSync("git", ["-C", root, "commit", "-qm", msg], { env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } });
  assert.equal((await timeline(root, architectureMap(await scan(root)))).available, false);
  git("init", "-q");
  git("add", ".");
  commit("2024-01-10T10:00:00", "Initial commit");
  const { writeFile, mkdir } = await import("node:fs/promises");
  await mkdir(path.join(root, "api"));
  await writeFile(path.join(root, "api/server.ts"), "export {};\n");
  git("add", ".");
  commit("2024-03-05T10:00:00", "Add the API");
  const t = await timeline(root, architectureMap(await scan(root)));
  assert.equal(t.available, true);
  assert.equal(t.commits, 2);
  assert.deepEqual(t.events.map((e) => `${e.date} ${e.label}`), ["2024-01-10 First commit: Initial commit", "2024-03-05 api added", "2024-03-05 Latest: Add the API"]);
});

test("flows become step lists and sequence diagrams; docs embed Mermaid; agent diagrams are checked", async () => {
  const root = await makeTree({
    "package.json": "{}",
    "src/route.ts": "import { query } from './db';\nexport function GET() {\n  return query();\n}\n",
    "src/db.ts": "export function query() {\n  return 1;\n}\n",
  });
  const analysis = await scan(root);
  const steps = flowSteps([{ path: "src/route.ts", line: 2, symbol: "GET" }, { path: "src/db.ts", line: 1, symbol: "query" }]);
  assert.match(flowMermaid("x", steps), /U->>P0: GET\n {2}P0->>P1: query/);

  await submitSection(root, analysis, "architecture", "flows", [
    { title: "Handle a GET", body: "Route calls the db.", evidence: [{ path: "src/route.ts", line: 2, symbol: "GET" }, { path: "src/db.ts", line: 1, symbol: "query" }], confidence: "observed" },
  ]);
  const bad = await submitSection(root, analysis, "architecture", "diagrams", [
    { title: "No diagram", body: "Just words.", evidence: [{ path: "src/db.ts" }], confidence: "observed" },
    { title: "Wrong type", body: "```mermaid\npie\n  a : 1\n  b : 2\n```", evidence: [{ path: "src/db.ts" }], confidence: "observed" },
    { title: "Request lifecycle", body: "```mermaid\nstateDiagram-v2\n  [*] --> Received\n  Received --> Queried\n```\nWhat happens to a request.", evidence: [{ path: "src/route.ts", line: 2 }], confidence: "observed" },
  ]);
  assert.deepEqual(bad.rejected.map((r) => r.problems[0]), ["diagram items need exactly one ```mermaid block", 'unsupported diagram type "pie"; use one of journey, stateDiagram-v2, stateDiagram, sequenceDiagram, flowchart, graph, timeline, erDiagram, classDiagram']);
  assert.equal(bad.accepted.length, 1);

  await renderDocs(root, await readStore(root));
  const md = await readFile(path.join(root, "docs/houserules/ARCHITECTURE.md"), "utf8");
  assert.match(md, /## Diagrams\n/);
  assert.match(md, /### Architecture map\n[\s\S]*```mermaid\nflowchart LR/);
  assert.match(md, /### Handle a GET\n\nRoute calls the db\.\n\n```mermaid\nsequenceDiagram/);
  assert.match(md, /```mermaid\nstateDiagram-v2/);
});
