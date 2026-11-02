import assert from "node:assert/strict";
import { test } from "node:test";
import { scan } from "../scan/index.js";
import { buildSymbolIndex } from "../symbols/index.js";
import { makeTree } from "../test-utils.js";
import { buildCallGraph } from "./graph.js";
import { listRoutes } from "./routes.js";
import { traceRoute } from "./trace.js";

const lines = (t: ReturnType<typeof traceRoute>) => t.steps.map((s) => `${"  ".repeat(s.depth)}${s.name}${s.repeat ? " ↺" : ""}`);

test("Next.js: pages, API routes, server actions and webhooks, traced through barrels and default exports", async () => {
  const root = await makeTree({
    "package.json": JSON.stringify({ dependencies: { next: "15.0.0", react: "19.0.0", stripe: "1" } }),
    "tsconfig.json": JSON.stringify({ compilerOptions: { baseUrl: "." } }),
    "app/(shop)/product/[handle]/page.tsx": `import { getProduct } from "lib/store";\nimport Gallery from "components/gallery";\nexport default async function ProductPage() {\n  const p = await getProduct();\n  return <Gallery p={p} />;\n}\n`,
    "app/api/stripe/webhook/route.ts": `import { charge } from "lib/store";\nexport async function POST() {\n  return charge();\n}\n`,
    "app/api/health/route.ts": `export const GET = () => new Response("ok");\n`,
    "components/gallery.tsx": `export default function Gallery() {\n  return <div />;\n}\n`,
    "components/actions.ts": `"use server";\nimport { revalidateTag } from "next/cache";\nimport * as store from "lib/store";\nexport async function addItem() {\n  await store.addToCart();\n  revalidateTag("cart");\n}\n`,
    "lib/store/index.ts": `export * from "./products";\nexport { charge } from "./billing";\n`,
    "lib/store/products.ts": `import { db } from "../db";\nexport async function getProduct() {\n  return db();\n}\nexport async function addToCart() {\n  return getProduct();\n}\n`,
    "lib/store/billing.ts": `import Stripe from "stripe";\nexport async function charge() {\n  return new Stripe("k");\n}\n`,
    "lib/db.ts": `export function db() {\n  return fetch("http://x");\n}\n`,
  });
  const a = await scan(root);
  const routes = await listRoutes(root, a);
  assert.deepEqual(routes.map((r) => `${r.kind} ${r.methods?.join(",") ?? ""} ${r.path} ${r.handler}`), [
    "page  /product/:handle ProductPage",
    "api GET /api/health GET",
    "action  addItem addItem",
    "webhook POST /api/stripe/webhook POST",
  ]);
  const sym = await buildSymbolIndex(root, a);
  const g = await buildCallGraph(root, a, sym);
  const trace = (path: string) => traceRoute(g, sym, routes.find((r) => r.path === path)!);
  assert.deepEqual(lines(trace("/product/:handle")), ["ProductPage", "  getProduct", "    db", "      HTTP (fetch)", "  Gallery"]);
  assert.deepEqual(lines(trace("addItem")), ["addItem", "  addToCart", "    getProduct", "      db", "        HTTP (fetch)", "  next/cache · revalidateTag"]);
  const hook = trace("/api/stripe/webhook");
  assert.deepEqual(lines(hook), ["POST", "  charge", "    Stripe"]);
  assert.deepEqual(hook.externals, ["Stripe"]);
});

test("Django: urls with include prefixes, views, management commands and tasks", async () => {
  const root = await makeTree({
    "manage.py": "",
    "requirements.txt": "django==5.1\n",
    "site/urls.py": `from django.urls import include, path\nurlpatterns = [\n    path("shop/", include("shop.urls")),\n]\n`,
    "shop/urls.py": `from django.urls import path\nfrom . import views\nurlpatterns = [\n    path("orders/<int:pk>/", views.order_detail),\n    path("hooks/stripe/", views.StripeHook.as_view()),\n]\n`,
    "shop/views.py": `from .services import load_order\n\ndef order_detail(request, pk):\n    return load_order(pk)\n\nclass StripeHook:\n    def post(self, request):\n        return None\n`,
    "shop/services.py": `def load_order(pk):\n    return pk\n`,
    "shop/management/commands/sync_stock.py": "class Command:\n    def handle(self):\n        pass\n",
    "shop/tasks.py": "@shared_task\ndef send_receipt(order_id):\n    pass\n",
  });
  const a = await scan(root);
  const routes = await listRoutes(root, a);
  assert.deepEqual(routes.map((r) => `${r.kind} ${r.path} ${r.handler}`), [
    "page /shop/orders/:pk/ order_detail",
    "webhook /shop/hooks/stripe/ StripeHook",
    "job manage.py sync_stock Command.handle",
    "job task send_receipt send_receipt",
  ]);
  const sym = await buildSymbolIndex(root, a);
  const g = await buildCallGraph(root, a, sym);
  assert.deepEqual(lines(traceRoute(g, sym, routes[0]!)), ["order_detail", "  load_order"]);
});

test("Spring: controller prefixes, mapping annotations, @Scheduled, and injected services linked by unique name", async () => {
  const root = await makeTree({
    "pom.xml": "<project><dependencies><dependency><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter-web</artifactId></dependency></dependencies></project>",
    "src/main/java/a/OrderController.java": `package a;\n@RestController\n@RequestMapping("/api/orders")\npublic class OrderController {\n  private final OrderService service;\n  @GetMapping("/{id}")\n  public Order get(@PathVariable Long id) {\n    return service.loadOrder(id);\n  }\n  @PostMapping\n  public Order create() {\n    return null;\n  }\n}\n`,
    "src/main/java/a/OrderService.java": `package a;\npublic class OrderService {\n  public Order loadOrder(Long id) {\n    return null;\n  }\n  @Scheduled(cron = "0 0 * * * *")\n  public void nightly() {\n  }\n}\n`,
  });
  const a = await scan(root);
  const routes = await listRoutes(root, a);
  assert.deepEqual(routes.map((r) => `${r.kind} ${r.methods?.join(",") ?? ""} ${r.path} ${r.handler}`), [
    "api POST /api/orders create",
    "api GET /api/orders/:id get",
    "job  nightly (0 0 * * * *) nightly",
  ]);
  const sym = await buildSymbolIndex(root, a);
  const g = await buildCallGraph(root, a, sym);
  const t = traceRoute(g, sym, routes[1]!);
  assert.deepEqual(lines(t), ["OrderController.get", "  OrderService.loadOrder"]);
  assert.equal(t.steps[1]!.via, "name", "an injected field is resolved by unique method name, and says so");
});
