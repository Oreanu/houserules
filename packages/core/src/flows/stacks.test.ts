import assert from "node:assert/strict";
import { test } from "node:test";
import { scan } from "../scan/index.js";
import { buildSymbolIndex } from "../symbols/index.js";
import { makeTree } from "../test-utils.js";
import { buildCallGraph } from "./graph.js";
import { listRoutes, type Route } from "./routes.js";
import { traceRoute } from "./trace.js";

const lines = (t: ReturnType<typeof traceRoute>) => t.steps.map((s) => `${"  ".repeat(s.depth)}${s.name}`);
const show = (r: Route) => `${r.kind} ${r.methods?.join(",") ?? ""} ${r.path} ${r.handler}`.replace(/\s+/g, " ").trim();

async function setup(files: Record<string, string>) {
  const root = await makeTree(files);
  const a = await scan(root);
  const routes = await listRoutes(root, a);
  const sym = await buildSymbolIndex(root, a);
  const g = await buildCallGraph(root, a, sym);
  return { a, routes, trace: (pred: (r: Route) => boolean) => traceRoute(g, sym, routes.find(pred)!) };
}

test("Expo Router: screens (groups and dynamic segments), +api routes, layouts skipped, Expo APIs in traces", async () => {
  const { a, routes, trace } = await setup({
    "package.json": JSON.stringify({ dependencies: { expo: "54.0.0", "expo-router": "6.0.0", "react-native": "0.81.0", "expo-image-picker": "1.0.0" } }),
    "app/_layout.tsx": "export default function Layout() {\n  return null;\n}\n",
    "app/(tabs)/index.tsx": `import { fetchFeed } from "../../lib/api";\nexport default function HomeScreen() {\n  fetchFeed();\n  return null;\n}\n`,
    "app/profile/[id].tsx": `import * as ImagePicker from "expo-image-picker";\nexport default function Profile() {\n  ImagePicker.launchImageLibraryAsync();\n  return null;\n}\n`,
    "app/api/users+api.ts": "export async function GET() {\n  return Response.json([]);\n}\n",
    "lib/api.ts": `export async function fetchFeed() {\n  return fetch("https://example.com/feed");\n}\n`,
  });
  assert.ok(a.frameworks.some((f) => f.id === "expo"));
  assert.deepEqual(routes.map(show), ["screen / HomeScreen", "screen /profile/:id Profile", "api GET /api/users GET"]);
  assert.deepEqual(lines(trace((r) => r.path === "/")), ["HomeScreen", "  fetchFeed", "    HTTP (fetch)"]);
  assert.deepEqual(lines(trace((r) => r.path === "/profile/:id")), ["Profile", "  expo-image-picker · launchImageLibraryAsync"]);
});

test("Laravel: routes with controllers, prefix groups, resources, closures, artisan commands and queued jobs; PHP traced through use statements", async () => {
  const { a, routes, trace } = await setup({
    "composer.json": JSON.stringify({ require: { php: "^8.2", "laravel/framework": "^12.0", "stripe/stripe-php": "^16.0" }, autoload: { "psr-4": { "App\\": "app/" } } }),
    artisan: "#!/usr/bin/env php\n<?php\n",
    "routes/web.php": `<?php\n\nuse App\\Http\\Controllers\\OrderController;\nuse App\\Http\\Controllers\\AdminController;\nuse Illuminate\\Support\\Facades\\Route;\n\nRoute::get('/orders/{order}', [OrderController::class, 'show']);\n\nRoute::prefix('admin')->group(function () {\n    Route::get('/stats', [AdminController::class, 'stats']);\n});\n\nRoute::post('/webhooks/stripe', function () {\n    return response()->noContent();\n});\n`,
    "routes/api.php": `<?php\n\nuse App\\Http\\Controllers\\PhotoController;\nuse Illuminate\\Support\\Facades\\Route;\n\nRoute::apiResource('photos', PhotoController::class);\n`,
    "app/Http/Controllers/OrderController.php": `<?php\n\nnamespace App\\Http\\Controllers;\n\nuse App\\Services\\Billing;\nuse Illuminate\\Support\\Facades\\Cache;\n\nclass OrderController extends Controller\n{\n    public function __construct(private Billing $billing) {}\n\n    public function show(int $order)\n    {\n        $total = Cache::remember("order.$order", 60, fn () => 1);\n        return $this->billing->charge($order, $total);\n    }\n}\n`,
    "app/Http/Controllers/AdminController.php": "<?php\n\nnamespace App\\Http\\Controllers;\n\nclass AdminController extends Controller\n{\n    public function stats() { return []; }\n}\n",
    "app/Http/Controllers/PhotoController.php": "<?php\n\nnamespace App\\Http\\Controllers;\n\nclass PhotoController extends Controller\n{\n    public function index() { return []; }\n}\n",
    "app/Services/Billing.php": `<?php\n\nnamespace App\\Services;\n\nuse Stripe\\StripeClient;\n\nclass Billing\n{\n    public function charge(int $order, int $total)\n    {\n        $stripe = new StripeClient(config('services.stripe.secret'));\n        return $stripe;\n    }\n}\n`,
    "app/Console/Commands/SendReport.php": "<?php\n\nnamespace App\\Console\\Commands;\n\nclass SendReport extends Command\n{\n    protected $signature = 'reports:send {user}';\n    public function handle() {}\n}\n",
    "app/Jobs/ProcessPodcast.php": "<?php\n\nnamespace App\\Jobs;\n\nclass ProcessPodcast implements ShouldQueue\n{\n    public function handle() {}\n}\n",
  });
  assert.ok(a.frameworks.some((f) => f.id === "laravel"));
  assert.ok(a.languages.some((l) => l.language === "php"));
  assert.ok(a.integrations.some((i) => i.id === "stripe" && i.files.includes("app/Services/Billing.php")), "Stripe found by Composer package and PHP namespace");
  assert.deepEqual(routes.map(show), [
    "page GET /admin/stats AdminController.stats",
    "page GET /orders/:order OrderController.show",
    "api GET /api/photos PhotoController.index",
    "api POST /api/photos PhotoController.store",
    "api GET /api/photos/:photo PhotoController.show",
    "api PUT /api/photos/:photo PhotoController.update",
    "api DELETE /api/photos/:photo PhotoController.destroy",
    "webhook POST /webhooks/stripe closure",
    "job artisan reports:send SendReport.handle",
    "job queued ProcessPodcast ProcessPodcast.handle",
  ]);
  assert.equal(routes.find((r) => r.path === "/orders/:order")!.handlerFile, "app/Http/Controllers/OrderController.php");
  assert.deepEqual(lines(trace((r) => r.path === "/orders/:order")), [
    "OrderController.show",
    "  Illuminate\\Support\\Facades\\Cache · remember",
    "  Billing.charge",
    "    Stripe",
  ]);
});

test("Laravel modules: route files mounted by a module RouteServiceProvider get its prefix; abstract jobs are skipped", async () => {
  const { routes } = await setup({
    "composer.json": JSON.stringify({ require: { php: "^8.4", "laravel/framework": "^13.0", "nwidart/laravel-modules": "^13.0" } }),
    "Modules/Shop/app/Providers/RouteServiceProvider.php": `<?php\n\nnamespace Modules\\Shop\\Providers;\n\nclass RouteServiceProvider extends ServiceProvider\n{\n    public function map(): void\n    {\n        Route::middleware('api')\n            ->prefix('api/v1')\n            ->group(module_path($this->name, '/routes/api.php'));\n    }\n}\n`,
    "Modules/Shop/routes/api.php": `<?php\n\nuse Modules\\Shop\\Http\\Controllers\\BookingController;\nuse Illuminate\\Support\\Facades\\Route;\n\nRoute::get('bookings/{booking}', [BookingController::class, 'show']);\n`,
    "bootstrap/app.php": `<?php\n\nreturn Application::configure(basePath: dirname(__DIR__))\n    ->withRouting(\n        web: __DIR__.'/../routes/web.php',\n        then: function () {\n            Route::prefix('app')->group(base_path('routes/frontend.php'));\n        }\n    )->create();\n`,
    "routes/frontend.php": "<?php\n\nRoute::get('account', fn () => null);\n",
    "app/Jobs/BaseExportJob.php": "<?php\n\nnamespace App\\Jobs;\n\nabstract class BaseExportJob implements ShouldQueue\n{\n    abstract public function handle();\n}\n",
  });
  assert.deepEqual(routes.map(show), ["page GET /app/account closure", "api GET /api/v1/bookings/:booking BookingController.show"]);
});

test("Symfony: attribute routes with a class prefix, and console commands", async () => {
  const { a, routes } = await setup({
    "composer.json": JSON.stringify({ require: { "symfony/framework-bundle": "7.3.*" } }),
    "src/Controller/BlogController.php": "<?php\n\nnamespace App\\Controller;\n\nuse Symfony\\Component\\Routing\\Attribute\\Route;\n\n#[Route('/blog')]\nclass BlogController extends AbstractController\n{\n    #[Route('/{slug}', name: 'blog_show', methods: ['GET'])]\n    public function show(string $slug): Response\n    {\n        return $this->render('blog/show.html.twig');\n    }\n}\n",
    "src/Command/ImportCommand.php": "<?php\n\nnamespace App\\Command;\n\n#[AsCommand(name: 'app:import')]\nclass ImportCommand extends Command\n{\n    protected function execute() {}\n}\n",
  });
  assert.ok(a.frameworks.some((f) => f.id === "symfony"));
  assert.deepEqual(routes.map(show), ["page GET /blog/:slug BlogController.show", "job console app:import ImportCommand.execute"]);
});

test("Express: mounted routers, middleware before the handler, inline handlers traced by their own lines", async () => {
  const { a, routes, trace } = await setup({
    "package.json": JSON.stringify({ type: "module", dependencies: { express: "5.1.0" } }),
    "src/app.js": `import express from "express";\nimport usersRouter from "./routes/users.js";\nconst app = express();\napp.use("/api/users", usersRouter);\napp.get("/health", (req, res) => res.send("ok"));\nexport default app;\n`,
    "src/routes/users.js": `import express from "express";\nimport { auth } from "../middleware/auth.js";\nimport { getUser, createUser } from "../controllers/users.js";\nconst router = express.Router();\nrouter.get("/:id", auth, getUser);\nrouter.post("/", async (req, res) => {\n  const user = await createUser(req.body);\n  res.json(user);\n});\nexport default router;\n`,
    "src/middleware/auth.js": "export function auth(req, res, next) {\n  next();\n}\n",
    "src/controllers/users.js": "export async function getUser(req, res) {\n  res.json({});\n}\nexport async function createUser(body) {\n  return body;\n}\n",
  });
  assert.ok(a.frameworks.some((f) => f.id === "express"));
  assert.deepEqual(routes.map(show), ["api POST /api/users inline handler", "api GET /api/users/:id getUser", "api GET /health inline handler"]);
  assert.deepEqual(lines(trace((r) => r.path === "/api/users" && r.methods![0] === "POST")), ["inline handler", "  createUser"]);
  assert.deepEqual(lines(trace((r) => r.path === "/api/users/:id")), ["getUser"]);
});

test("NestJS: global prefix, controller prefixes, injected services by unique name, and @Cron jobs", async () => {
  const { routes, trace } = await setup({
    "package.json": JSON.stringify({ dependencies: { "@nestjs/core": "11.0.0", "@nestjs/common": "11.0.0" } }),
    "src/main.ts": `import { NestFactory } from "@nestjs/core";\nasync function bootstrap() {\n  const app = await NestFactory.create(AppModule);\n  app.setGlobalPrefix("api");\n}\n`,
    "src/users/users.controller.ts": `import { Controller, Get, Post, Param } from "@nestjs/common";\nimport { UsersService } from "./users.service";\n@Controller("users")\nexport class UsersController {\n  constructor(private readonly users: UsersService) {}\n  @Get(":id")\n  findOne(@Param("id") id: string) {\n    return this.users.findOne(id);\n  }\n  @Post()\n  create() {\n    return {};\n  }\n}\n`,
    "src/users/users.service.ts": "export class UsersService {\n  findOne(id: string) {\n    return { id };\n  }\n}\n",
    "src/tasks/tasks.service.ts": `import { Cron } from "@nestjs/schedule";\nexport class TasksService {\n  @Cron("0 * * * *")\n  handleCron() {}\n}\n`,
  });
  assert.deepEqual(routes.map(show), ["api POST /api/users UsersController.create", "api GET /api/users/:id UsersController.findOne", "job scheduled handleCron (0 * * * *) TasksService.handleCron"]);
  assert.deepEqual(lines(trace((r) => r.path === "/api/users/:id")), ["UsersController.findOne", "  @nestjs/common · Param", "  UsersService.findOne"]);
});

test("Fastify: plugins registered with a prefix, and route objects", async () => {
  const { routes } = await setup({
    "package.json": JSON.stringify({ type: "module", dependencies: { fastify: "5.0.0" } }),
    "src/server.js": `import Fastify from "fastify";\nimport userRoutes from "./users.js";\nconst app = Fastify();\napp.register(userRoutes, { prefix: "/v1" });\n`,
    "src/users.js": `export default async function userRoutes(fastify) {\n  fastify.get("/users", listUsers);\n  fastify.route({ method: "POST", url: "/users", handler: createUser });\n}\nasync function listUsers() {\n  return [];\n}\nasync function createUser() {\n  return {};\n}\n`,
  });
  assert.deepEqual(routes.map(show), ["api GET /v1/users listUsers", "api POST /v1/users createUser"]);
});
