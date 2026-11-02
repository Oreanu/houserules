import assert from "node:assert/strict";
import { test } from "node:test";
import { scan } from "../scan/index.js";
import { buildSymbolIndex } from "../symbols/index.js";
import { makeTree } from "../test-utils.js";
import { buildCallGraph } from "./graph.js";
import { listRoutes, type Route } from "./routes.js";
import { audienceOf, buildEntryMap, guardLabel, readEntryOverrides, routeTitle, submitEntryOverrides, whenWords } from "./story.js";
import { traceRoute } from "./trace.js";

const r = (o: Partial<Route>): Route => ({ id: "x", kind: "api", path: "/", file: "routes/api.php", line: 1, handler: "X.y", ...o });

test("titles read like actions: route names, resource methods, invokable controllers, jobs, pages and server actions", () => {
  assert.equal(routeTitle(r({ name: "api.v1.bookings.cancel", path: "/api/v1/user/bookings/:booking/cancel" })), "Cancel a booking");
  assert.equal(routeTitle(r({ name: "admin.orders.index", path: "/admin/orders" })), "List orders");
  assert.equal(routeTitle(r({ name: "api.v1.partner.bookings.update-status", middleware: ["verify.partner"] })), "Update booking status");
  assert.equal(routeTitle(r({ name: "users.ban", path: "/admin/users/:username/ban" })), "Ban a user");
  assert.equal(routeTitle(r({ handler: "BookingCancelController.__invoke", path: "/bookings/:booking/cancel", methods: ["PUT"] })), "Cancel booking");
  assert.equal(routeTitle(r({ handler: "authController.forgotPassword", path: "/forgot-password", methods: ["POST"] })), "Forgot password");
  assert.equal(routeTitle(r({ kind: "job", path: "queued CreateShipmentAndParcelsJob", handler: "CreateShipmentAndParcelsJob.handle" })), "Create shipment and parcels");
  assert.equal(routeTitle(r({ kind: "job", path: "scheduled PruneStaleCarts (daily)", handler: "PruneStaleCarts.handle" })), "Prune stale carts (daily)");
  assert.equal(routeTitle(r({ kind: "page", path: "/product/:handle", file: "app/product/[handle]/page.tsx", handler: "ProductPage" })), "Product page");
  assert.equal(routeTitle(r({ kind: "page", path: "/", handler: "HomePage" })), "Home page");
  assert.equal(routeTitle(r({ kind: "action", path: "addItem", handler: "addItem" })), "Add item");
});

test("guards and branches in plain words", () => {
  assert.equal(guardLabel("auth:sanctum"), "Must be signed in");
  assert.equal(guardLabel("auth:admin"), "Staff only");
  assert.equal(guardLabel("can:update,booking"), "Must be allowed to update this booking");
  assert.equal(guardLabel("throttle:3,1"), "At most 3 a minute");
  assert.equal(guardLabel("verify.partner"), "Must come from Partner");
  assert.equal(guardLabel("api"), undefined, "plumbing middleware says nothing to a reader");
  assert.equal(whenWords("if $request->requiresPayment()"), "If requires payment");
  assert.equal(whenWords("if !order"), "If not order");
  assert.equal(whenWords("match $status"), "Depending on status");
  assert.equal(whenWords("if $booking->status === 'paid'"), "If status is paid");
  assert.equal(whenWords("else"), "Otherwise");
  assert.equal(whenWords("catch"), "If it fails");
});

test("who calls it comes from middleware first, the URL second", () => {
  assert.equal(audienceOf(r({ middleware: ["api", "auth:sanctum"] })), "customers");
  assert.equal(audienceOf(r({ middleware: ["auth:admin", "ability:admin"], path: "/api/v1/admin/orders" })), "staff");
  assert.equal(audienceOf(r({ middleware: ["api", "verify.partner"] })), "systems");
  assert.equal(audienceOf(r({ kind: "webhook", path: "/webhooks/stripe" })), "systems");
  assert.equal(audienceOf(r({ kind: "job", path: "queued X" })), "automatic");
  assert.equal(audienceOf(r({ kind: "page", path: "/about" })), "website");
  assert.equal(audienceOf(r({ path: "/api/menus" })), "anyone");
});

test("Laravel end to end: middleware from groups, mounts and constructors (with except), stories with branches and jobs, own API clients, shared code, agent names", async () => {
  const root = await makeTree({
    "composer.json": JSON.stringify({ require: { php: "^8.4", "laravel/framework": "^13.0" }, autoload: { "psr-4": { "App\\": "app/" } } }),
    "app/Providers/RouteServiceProvider.php": `<?php\n\nclass RouteServiceProvider\n{\n    public function map(): void\n    {\n        Route::middleware('api')->prefix('api')->group(base_path('routes/shop.php'));\n    }\n}\n`,
    "routes/shop.php": `<?php\n\nuse App\\Http\\Controllers\\BookingCancelController;\nuse App\\Http\\Controllers\\BookingResumeController;\nuse App\\Http\\Controllers\\ArticlesController;\nuse App\\Http\\Controllers\\AdminBookingStatusController;\nuse Illuminate\\Support\\Facades\\Route;\n\nRoute::middleware(['auth:sanctum'])->group(function () {\n    Route::put('bookings/{booking}/cancel', BookingCancelController::class)->middleware('can:update,booking')->name('bookings.cancel');\n    Route::put('bookings/{booking}/resume', BookingResumeController::class)->name('bookings.resume');\n});\nRoute::put('admin/bookings/{booking}/status', AdminBookingStatusController::class)->middleware(['auth:admin'])->name('admin.bookings.update-status');\nRoute::get('articles', [ArticlesController::class, 'index'])->name('articles.index');\nRoute::post('articles', [ArticlesController::class, 'store'])->name('articles.store');\n`,
    "app/Http/Controllers/BookingCancelController.php": `<?php\n\nnamespace App\\Http\\Controllers;\n\nuse App\\Models\\Booking;\n\nclass BookingCancelController\n{\n    public function __invoke(Booking $booking)\n    {\n        $booking->cancel();\n        return $booking;\n    }\n}\n`,
    "app/Http/Controllers/AdminBookingStatusController.php": `<?php\n\nnamespace App\\Http\\Controllers;\n\nuse App\\Models\\Booking;\n\nclass AdminBookingStatusController\n{\n    public function __invoke(Booking $booking, string $status)\n    {\n        match ($status) {\n            'cancelled' => $booking->cancel(),\n            default => null,\n        };\n    }\n}\n`,
    "app/Http/Controllers/BookingResumeController.php": `<?php\n\nnamespace App\\Http\\Controllers;\n\nuse App\\Jobs\\ChargeDepositJob;\nuse App\\Integrations\\Notifier\\NotifierClient;\n\nclass BookingResumeController\n{\n    public function __invoke($request, $booking, NotifierClient $klaviyo)\n    {\n        if ($request->requiresPayment()) {\n            ChargeDepositJob::dispatch($booking);\n        }\n        $klaviyo->trackResume($booking);\n    }\n}\n`,
    "app/Http/Controllers/ArticlesController.php": `<?php\n\nnamespace App\\Http\\Controllers;\n\nclass ArticlesController\n{\n    public function __construct()\n    {\n        $this->middleware(Authenticate::class, ['except' => ['index']]);\n    }\n\n    public function index() { return []; }\n    public function store() { return []; }\n}\n`,
    "app/Models/Booking.php": `<?php\n\nnamespace App\\Models;\n\nclass Booking\n{\n    public function cancel()\n    {\n        $this->removeCredit();\n        $this->changeStatus('cancelled');\n    }\n    public function removeCredit() {}\n    public function changeStatus($s) {}\n}\n`,
    "app/Jobs/ChargeDepositJob.php": `<?php\n\nnamespace App\\Jobs;\n\nclass ChargeDepositJob implements ShouldQueue\n{\n    public static function dispatch($booking) {}\n    public function handle() {}\n}\n`,
    "app/Integrations/Notifier/NotifierClient.php": `<?php\n\nnamespace App\\Integrations\\Notifier;\n\nclass NotifierClient\n{\n    public function trackResume($booking) {}\n}\n`,
  });
  const a = await scan(root);
  assert.ok(a.integrations.some((i) => i.name === "Notifier" && i.category === "service" && i.files.includes("app/Http/Controllers/BookingResumeController.php")), "own API client folder is a service, with the files that use it");
  const routes = await listRoutes(root, a);
  const by = (p: string, m = "PUT") => routes.find((x) => x.path === p && x.methods?.includes(m))!;
  assert.deepEqual(by("/api/bookings/:booking/cancel").middleware, ["api", "auth:sanctum", "can:update,booking"]);
  assert.equal(by("/api/bookings/:booking/cancel").name, "bookings.cancel");
  assert.equal(by("/api/articles", "GET").middleware?.includes("auth"), false, "except: ['index'] leaves index public");
  assert.equal(by("/api/articles", "POST").middleware?.includes("auth"), true);

  const sym = await buildSymbolIndex(root, a);
  const g = await buildCallGraph(root, a, sym);
  const traces = new Map(routes.map((x) => [x.id, traceRoute(g, sym, x)]));
  const m = buildEntryMap(routes, traces, a);
  const story = (p: string, mth = "PUT") => m.stories.get(by(p, mth).id)!;
  const skip = story("/api/bookings/:booking/cancel");
  assert.equal(skip.title, "Cancel a booking");
  assert.equal(skip.audience, "customers");
  assert.deepEqual(skip.steps.map((s) => s.label), ["Must be signed in", "Must be allowed to update this booking", "Remove credit", "Change status"], "a delegating handler tells its delegate's story");
  const resume = story("/api/bookings/:booking/resume");
  assert.deepEqual(resume.steps.map((s) => [s.label, s.kind, s.when ?? ""]), [
    ["Must be signed in", "guard", ""],
    ["Charge deposit in the background", "job", "If requires payment"],
    ["Call Notifier", "service", ""],
  ]);
  assert.deepEqual(resume.services, ["Notifier"]);
  const status = story("/api/admin/bookings/:booking/status");
  assert.equal(status.audience, "staff");
  assert.equal(status.title, "Update booking status");
  assert.equal(status.shares?.code, "Booking.cancel", "staff and customers run the same cancel");
  assert.ok(m.services.some((s) => s.name === "Notifier"));
  assert.ok(m.links.some((l) => l.from === "customers" && l.count >= 2));

  const area = m.stories.get(by("/api/bookings/:booking/cancel").id)!.area;
  const res = await submitEntryOverrides(root, routes, { areas: [{ id: area, title: "Deliveries", order: 1 }, { id: "nope" }], titles: [{ id: by("/api/bookings/:booking/resume").id, title: "Resume a cancelled booking" }] });
  assert.equal(res.accepted, 2);
  assert.match(res.rejected[0]!.problem, /No area "nope"/);
  const named = buildEntryMap(routes, traces, a, await readEntryOverrides(root));
  assert.equal(named.areas[0]!.title, "Deliveries");
  assert.equal(named.areas[0]!.order, 1);
  assert.equal(named.stories.get(by("/api/bookings/:booking/resume").id)!.title, "Resume a cancelled booking");
});

test("every way in tells a story: container-resolved builders, return-type chains, global facades, view pages and package commands", async () => {
  const root = await makeTree({
    "composer.json": JSON.stringify({ require: { php: "^8.4", "laravel/framework": "^13.0" }, autoload: { "psr-4": { "App\\": "app/" } } }),
    "routes/web.php": `<?php\n\nuse Illuminate\\Support\\Facades\\Route;\n\nRoute::view('privacy', 'privacy')->name('privacy');\n`,
    "routes/console.php": `<?php\n\nuse Illuminate\\Support\\Facades\\Schedule;\n\nSchedule::command('horizon:snapshot')->everyFiveMinutes();\n`,
    "app/Jobs/GenerateInvoiceJob.php": `<?php\n\nnamespace App\\Jobs;\n\nuse App\\Actions\\GenerateInvoice;\n\nclass GenerateInvoiceJob implements ShouldQueue\n{\n    public function handle(): void\n    {\n        \\Log::info('starting');\n        app(GenerateInvoice::class)->withCustomer(1)->handle();\n    }\n}\n`,
    "app/Jobs/RecalculateInvoiceJob.php": `<?php\n\nnamespace App\\Jobs;\n\nuse App\\Models\\InvoiceRef;\n\nclass RecalculateInvoiceJob implements ShouldQueue\n{\n    public function __construct(public readonly InvoiceRef $invoiceRef) {}\n\n    public function handle(): void\n    {\n        $this->invoiceRef->invoice()->recalculate();\n    }\n}\n`,
    "app/Actions/GenerateInvoice.php": `<?php\n\nnamespace App\\Actions;\n\nclass GenerateInvoice\n{\n    public function withCustomer(int $id): static\n    {\n        return $this;\n    }\n\n    public function handle(): void\n    {\n        $this->createInvoice();\n    }\n\n    private function createInvoice(): void {}\n}\n`,
    "app/Models/InvoiceRef.php": `<?php\n\nnamespace App\\Models;\n\nclass InvoiceRef\n{\n    public function invoice(): ?Invoice\n    {\n        return Invoice::find(1);\n    }\n}\n`,
    "app/Models/Invoice.php": `<?php\n\nnamespace App\\Models;\n\nclass Invoice\n{\n    public function recalculate(): self\n    {\n        $this->applyDiscount();\n        return $this;\n    }\n\n    private function applyDiscount(): void {}\n}\n`,
    "app/Other/Invoice.php": `<?php\n\nnamespace App\\Other;\n\nclass Invoice\n{\n    public function recalculate(): void {}\n}\n`,
  });
  const a = await scan(root);
  const routes = await listRoutes(root, a);
  const sym = await buildSymbolIndex(root, a);
  const g = await buildCallGraph(root, a, sym);
  const traces = new Map(routes.map((x) => [x.id, traceRoute(g, sym, x)]));
  const names = (p: string) => traces.get(routes.find((x) => x.path === p)!.id)!.steps.map((s) => s.name);
  assert.deepEqual(names("queued GenerateInvoiceJob"), ["GenerateInvoiceJob.handle", "Illuminate\\Support\\Facades\\Log · info", "GenerateInvoice.withCustomer", "GenerateInvoice.handle", "GenerateInvoice.createInvoice"], "app(X::class)->withCustomer()->handle() resolves through the declared `static` return");
  const recalc = traces.get(routes.find((x) => x.path === "queued RecalculateInvoiceJob")!.id)!;
  assert.deepEqual(recalc.steps.map((s) => [s.name, s.file]), [["RecalculateInvoiceJob.handle", "app/Jobs/RecalculateInvoiceJob.php"], ["InvoiceRef.invoice", "app/Models/InvoiceRef.php"], ["Invoice.recalculate", "app/Models/Invoice.php"], ["Invoice.applyDiscount", "app/Models/Invoice.php"]], "invoice()'s return type is resolved where it's declared, not to the other Invoice class");
  const m = buildEntryMap(routes, traces, a);
  for (const s of m.stories.values()) assert.ok(s.steps.length, `${s.title} says something`);
  assert.equal(m.stories.get(routes.find((x) => x.path === "/privacy")!.id)!.steps[0]!.label, "Show the privacy page template");
  assert.match(m.stories.get(routes.find((x) => /horizon:snapshot/.test(x.path))!.id)!.steps[0]!.label, /`horizon:snapshot`, a command that comes with a package/);
});

test("Django: who may call a view comes from its decorators, titles from route names, and channel folders aren't services", async () => {
  const root = await makeTree({
    "requirements.txt": "django==5.0\n",
    "app/urls.py": `from django.urls import include, path\nfrom app import views\n\nbooking_urls = [\n    path("pause/", views.pause, name="bk-pause"),\n    path("name/", views.update_name, name="bk-update-name"),\n    path("details/", views.details, name="bk-details"),\n]\n\nurlpatterns = [\n    path("", views.index, name="bk-index"),\n    path("bookings/<uuid:code>/", include(booking_urls)),\n    path("ping/<uuid:code>", views.ping),\n    path("admin-report/", views.report),\n    path("accounts/login/", views.login, name="bk-login"),\n]\n`,
    "app/views.py": `from django.contrib.auth.decorators import login_required\nfrom django.contrib.admin.views.decorators import staff_member_required\nfrom django.views.decorators.csrf import csrf_exempt\nfrom django.views.decorators.http import require_POST\n\ndef index(request):\n    pass\n\n@require_POST\n@login_required\ndef pause(request, code):\n    pass\n\n@require_POST\n@login_required\ndef update_name(request, code):\n    pass\n\n@login_required\ndef details(request, code):\n    pass\n\n@csrf_exempt\ndef ping(request, code):\n    pass\n\n@staff_member_required\ndef report(request):\n    pass\n\ndef login(request):\n    pass\n`,
    "app/integrations/webhook/transport.py": "def send(): pass\n",
    "app/integrations/pd/transport.py": "def send(): pass\n",
  });
  const a = await scan(root);
  const routes = await listRoutes(root, a);
  const at = (p: string) => routes.find((x) => x.path === p)!;
  assert.deepEqual([at("/bookings/:code/pause/").methods, at("/bookings/:code/pause/").middleware], [["POST"], ["auth"]], "prefix from include(list), method and guard from decorators");
  assert.equal(audienceOf(at("/bookings/:code/pause/")), "customers");
  assert.equal(audienceOf(at("/ping/:code")), "systems");
  assert.equal(audienceOf(at("/admin-report/")), "staff");
  assert.equal(routeTitle(at("/bookings/:code/pause/")), "Pause a booking");
  assert.equal(routeTitle(at("/bookings/:code/name/")), "Update booking name");
  assert.equal(routeTitle(at("/bookings/:code/details/")), "Booking details page");
  assert.equal(routeTitle(at("/")), "Home page");
  assert.equal(routeTitle(at("/accounts/login/")), "Sign in");
  assert.equal(routeTitle(r({ kind: "job", path: "manage.py sendalerts", handler: "Command.handle", file: "app/management/commands/sendalerts.py" })), "Send alerts");
  const names = a.integrations.map((i) => i.name);
  assert.ok(names.includes("PagerDuty") && !names.some((n) => /webhook/i.test(n)), names.join(", "));
});

test("Express: a handler passed through a wrapper is traced, and the wrapper is kept as a guard", async () => {
  const root = await makeTree({
    "package.json": JSON.stringify({ dependencies: { express: "^4" } }),
    "src/guard.ts": `export function guarded(area: string, action: string, resource: string, fn: Function) {\n  return (req: any, res: any) => fn(req, res);\n}\nexport const asyncHandler = (fn: Function) => fn;\nexport function requireAuth(req: any, res: any, next: Function) { next(); }\n`,
    "src/vehicles/service.ts": `export function loadRoute(id: string) {\n  return [id];\n}\n`,
    "src/vehicles/controller.ts": `import { loadRoute } from "./service";\nexport const controller = {\n  route(req: any, res: any) {\n    res.json(loadRoute(req.params.id));\n  },\n};\n`,
    "src/vehicles/routes.ts": `import { Router } from "express";\nimport { guarded, asyncHandler, requireAuth } from "../guard";\nimport { controller } from "./controller";\nexport const router = Router();\nrouter.get("/:id/route", guarded("web", "read", "RouteHistory", controller.route));\nrouter.get("/:id/again", requireAuth, asyncHandler(guarded("web", "read", "RouteHistory", controller.route)));\nrouter.get("/health", asyncHandler(async (req: any, res: any) => {\n  res.json({ ok: true });\n}));\n`,
  });
  const a = await scan(root);
  const routes = await listRoutes(root, a);
  const at = (p: string) => routes.find((x) => x.path === p)!;
  assert.equal(at("/:id/route").handler, "controller.route");
  assert.deepEqual(at("/:id/route").middleware, ["guarded:web,read,RouteHistory"]);
  assert.equal(at("/:id/again").handler, "controller.route");
  assert.deepEqual(at("/:id/again").middleware, ["requireAuth", "asyncHandler", "guarded:web,read,RouteHistory"]);
  assert.equal(at("/health").handler, "inline handler");
  const sym = await buildSymbolIndex(root, a);
  const t = traceRoute(await buildCallGraph(root, a, sym), sym, at("/:id/route"));
  assert.ok(t.steps.some((s) => /loadRoute/.test(s.name)), `the trace goes through the wrapper into the controller and its service: ${t.steps.map((s) => s.name).join(", ")}`);
});

test("Express: a controller built by a factory (or passed in typed) is traced, and tests with the same method names are ignored", async () => {
  const controller = `import { loadRoute } from "./service";\nexport function createDeviceController(deps: { repo: unknown }) {\n  async function route(req: any, res: any) {\n    res.json(loadRoute(req.params.id));\n  }\n  return {\n    route,\n    show: async (req: any, res: any) => {\n      res.json(loadRoute(req.params.id));\n    },\n  };\n}\n`;
  const root = await makeTree({
    "package.json": JSON.stringify({ dependencies: { express: "^4" } }),
    "src/guard.ts": `export function guarded(a: string, b: string, c: string, fn: Function) {\n  return fn;\n}\n`,
    "src/devices/service.ts": `export function loadRoute(id: string) {\n  return [id];\n}\n`,
    "src/devices/deviceController.factory.ts": controller,
    "src/devices/routes.ts": `import { Router } from "express";\nimport { guarded } from "../guard";\nimport { createDeviceController } from "./deviceController.factory";\nexport function deviceRoutes(deps: { repo: unknown }) {\n  const router = Router();\n  const controller = createDeviceController(deps);\n  router.get("/:id/route", guarded("web", "read", "RouteHistory", controller.route));\n  router.get("/:id", guarded("web", "read", "Device", controller.show));\n  return router;\n}\n`,
    "src/trips/routes.ts": `import { Router } from "express";\nimport type { createDeviceController } from "../devices/deviceController.factory";\nexport function tripRoutes(ctl: ReturnType<typeof createDeviceController>) {\n  const router = Router();\n  router.get("/trips/:id/route", ctl.route);\n  return router;\n}\n`,
    "test/route.integration.test.ts": `export async function route() {\n  return 1;\n}\n`,
  });
  const a = await scan(root);
  const routes = await listRoutes(root, a);
  const sym = await buildSymbolIndex(root, a);
  const g = await buildCallGraph(root, a, sym);
  for (const p of ["/:id/route", "/:id", "/trips/:id/route"]) {
    const route = routes.find((x) => x.path === p)!;
    assert.equal(route.handlerFile, "src/devices/deviceController.factory.ts", p);
    const names = traceRoute(g, sym, route).steps.map((s) => `${s.name}@${s.file}`);
    assert.ok(names.some((n) => n.startsWith("loadRoute@")), `${p}: ${names.join(" > ")}`);
    assert.ok(!names.some((n) => n.includes("test/")), `${p} never starts in a test: ${names.join(" > ")}`);
  }
});

test("a route houserules can't follow gets its real handler from the agent, checked to exist", async () => {
  const root = await makeTree({
    "package.json": JSON.stringify({ dependencies: { express: "^4" } }),
    "src/container.ts": `const registry = new Map<string, Function>();\nexport const container = { get: (name: string) => registry.get(name)! };\n`,
    "src/reports/service.ts": `export function buildReport(id: string) {\n  return [id];\n}\n`,
    "src/reports/handlers.ts": `import { buildReport } from "./service";\nexport class ReportHandlers {\n  download(req: any, res: any) {\n    res.json(buildReport(req.params.id));\n  }\n}\n`,
    "src/reports/routes.ts": `import { Router } from "express";\nimport { container } from "../container";\nexport const router = Router();\nrouter.get("/reports/:id", container.get("reports.download"));\n`,
  });
  const a = await scan(root);
  const sym = await buildSymbolIndex(root, a);
  const before = (await listRoutes(root, a)).find((x) => x.path === "/reports/:id")!;
  assert.ok(traceRoute(await buildCallGraph(root, a, sym), sym, before).steps.length <= 1, "houserules can't follow a container lookup by itself");

  const res = await submitEntryOverrides(root, [before], {
    handlers: [
      { id: before.id, file: "src/reports/handlers.ts", symbol: "ReportHandlers.downlod" },
      { id: before.id, file: "src/reports/nope.ts", symbol: "download" },
      { id: before.id, file: "src/reports/handlers.ts", symbol: "ReportHandlers.download" },
    ],
  }, sym);
  assert.equal(res.accepted, 1);
  assert.match(res.rejected[0]!.problem, /No function or method "ReportHandlers.downlod".*ReportHandlers\.download/);
  assert.match(res.rejected[1]!.problem, /No file src\/reports\/nope\.ts/);

  const after = (await listRoutes(root, a)).find((x) => x.path === "/reports/:id")!;
  assert.equal(after.id, before.id, "the id stays the same, so titles and pins keep working");
  const names = traceRoute(await buildCallGraph(root, a, sym), sym, after).steps.map((s) => s.name);
  assert.deepEqual(names.slice(0, 2), ["ReportHandlers.download", "buildReport"]);
});

test("Express: arrow-function handlers in factories and class fields, imported through a barrel, trace to the service", async () => {
  const root = await makeTree({
    "package.json": "{\"dependencies\":{\"express\":\"^4\"}}\n",
    "src/controllers/index.ts": "export * from \"./telematics.controller\";\nexport { TripController } from \"./trip.controller\";\n",
    "src/controllers/telematics.controller.ts": "import { VehicleService } from \"../services/vehicle.service\";\ntype Deps = { vehicles: VehicleService };\nexport const createTelematicsController = ({ vehicles }: Deps) => ({\n  route: async (req: any, res: any) => {\n    res.json(await vehicles.history(req.params.id));\n  },\n  latest: async (req: any, res: any) => {\n    res.json(await vehicles.history(\"latest\"));\n  },\n});\n",
    "src/controllers/trip.controller.ts": "import { VehicleService } from \"../services/vehicle.service\";\nexport class TripController {\n  constructor(private readonly vehicles: VehicleService) {}\n  route = async (req: any, res: any) => {\n    res.json(await this.vehicles.history(req.params.id));\n  };\n  async list(req: any, res: any) {\n    res.json(await this.vehicles.history(\"all\"));\n  }\n}\n",
    "src/lib/db.ts": "export const db = { query(sql: string, args: unknown[]) { return [sql, args]; } };\n",
    "src/lib/guard.ts": "export const guarded = (a: string, b: string, c: string, fn: Function) => fn;\nexport const asyncHandler = (fn: Function) => fn;\n",
    "src/routes/telematics.routes.ts": "import { Router } from \"express\";\nimport { guarded, asyncHandler } from \"../lib/guard\";\nimport { createTelematicsController, TripController } from \"../controllers\";\nimport { makeVehicleService } from \"../services/vehicle.service\";\n\nexport function telematicsRoutes() {\n  const router = Router();\n  const vehicles = makeVehicleService();\n  const controller = createTelematicsController({ vehicles });\n  const trips = new TripController(vehicles);\n  router.get(\"/:id/route\", guarded(\"web\", \"read\", \"RouteHistory\", controller.route));\n  router.get(\"/:id/latest\", asyncHandler(controller.latest));\n  router.get(\"/trips/:id/route\", guarded(\"web\", \"read\", \"Trip\", trips.route));\n  router.get(\"/trips\", guarded(\"web\", \"read\", \"Trip\", trips.list.bind(trips)));\n  return router;\n}\n",
    "src/services/vehicle.service.ts": "import { db } from \"../lib/db\";\nexport class VehicleService {\n  async history(id: string) {\n    return db.query(\"select\", [id]);\n  }\n}\nexport function makeVehicleService() {\n  return new VehicleService();\n}\n",
    "test/helpers.test.ts": "export const route = async () => 1;\nexport function latest() { return 2; }\nexport function list() { return 3; }\n",
  });
  const a = await scan(root);
  const sym = await buildSymbolIndex(root, a);
  const g = await buildCallGraph(root, a, sym);
  const want: Record<string, string> = { "/:id/route": "route", "/:id/latest": "latest", "/trips/:id/route": "TripController.route", "/trips": "TripController.list" };
  for (const r of await listRoutes(root, a)) {
    const names = traceRoute(g, sym, r).steps.map((s) => s.name);
    assert.equal(names[0], want[r.path], `${r.path}: ${names.join(" > ")}`);
    assert.ok(names.includes("VehicleService.history"), `${r.path} reaches the service: ${names.join(" > ")}`);
  }
});
