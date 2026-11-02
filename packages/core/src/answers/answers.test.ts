import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { checkRules, globToRegExp, readRules, submitRules } from "../rules/index.js";
import { scan } from "../scan/index.js";
import { makeTree } from "../test-utils.js";
import { readAnswers, recheckAnswers, saveAnswer, searchAnswers } from "./index.js";

const repo = () =>
  makeTree({
    "package.json": JSON.stringify({ dependencies: { stripe: "^17" } }),
    "src/orders.ts": `export function skipOrder(order: { status: string }) {\n  removeCredit(order);\n  order.status = "skipped";\n}\n\nfunction removeCredit(order: unknown) {}\n`,
    "src/billing.ts": `import Stripe from "stripe";\nexport const stripe = new Stripe(process.env.STRIPE_KEY!);\n`,
    "src/models/order.ts": `export class Order {\n  status = "pending";\n  changeStatus(s: string) {\n    this.status = s;\n  }\n}\n`,
    "src/api/skip.ts": `import { Order } from "../models/order";\nexport function handle(o: Order) {\n  o.changeStatus("skipped");\n}\n`,
  });

test("saved answers: evidence is checked, the same question replaces the old answer, search finds it, and a code change flags it", async () => {
  const root = await repo();
  const a = await scan(root);

  const none = await saveAnswer(root, a, { question: "How does skipping an order work?", answer: "It removes credit.", evidence: [] });
  assert.equal(none.accepted, false, "answers need evidence");

  const bad = await saveAnswer(root, a, { question: "How does skipping an order work?", answer: "It removes credit.", evidence: [{ path: "src/nope.ts", line: 1 }] });
  assert.equal(bad.accepted, false);
  assert.match(bad.problems.join(" "), /nope\.ts/);

  const ok = await saveAnswer(root, a, { question: "How does skipping an order work?", answer: "`skipOrder` removes credit, then sets the status.", evidence: [{ path: "src/orders.ts", line: 1, endLine: 4, symbol: "skipOrder" }], askedIn: "claude" });
  assert.equal(ok.accepted, true, ok.problems.join("; "));
  const again = await saveAnswer(root, a, { question: "how does skipping an order work", answer: "`skipOrder` removes credit first.", evidence: [{ path: "src/orders.ts", line: 2 }] });
  assert.equal(again.replaced, true, "the same question updates the answer instead of piling up");
  await saveAnswer(root, a, { question: "Where do we talk to Stripe?", answer: "Only in `src/billing.ts`.", evidence: [{ path: "src/billing.ts", line: 2 }] });

  const store = await readAnswers(root);
  assert.equal(store.answers.length, 2);
  assert.equal(searchAnswers(store, "what happens when an order is skipped")[0]?.question, "How does skipping an order work?");
  assert.equal(searchAnswers(store, "stripe")[0]?.question, "Where do we talk to Stripe?");

  assert.deepEqual(await recheckAnswers(root, a).then((r) => [r.total, r.broken.length, r.changed.length]), [2, 0, 0]);
  await writeFile(path.join(root, "src/orders.ts"), `export function skipOrder(order: { status: string }) {\n  order.status = "skipped";\n}\n`);
  const after = await recheckAnswers(root, await scan(root));
  assert.equal(after.changed.length + after.broken.length, 1, "editing the cited lines flags the answer");
});

test("house rules: rejected unless they describe today's code; old violations are a baseline; new ones are caught", async () => {
  assert.ok(globToRegExp("src/**/*.ts").test("src/api/skip.ts"));
  assert.ok(globToRegExp("src/**/*.ts").test("src/orders.ts"));
  assert.ok(!globToRegExp("src/models/**").test("src/orders.ts"));
  assert.ok(globToRegExp("**/*.{ts,tsx}").test("a/b.tsx"));

  const root = await repo();
  const a = await scan(root);
  const res = await submitRules(root, a, [
    { title: "Change order status through Order.changeStatus, not by assigning status", files: ["src/**/*.ts"], except: ["src/models/**"], forbid: "\\.status\\s*=[^=]", fix: "Call `order.changeStatus(...)`.", guideline: "guidelines/patterns/tell-the-owning-model" },
    { title: "Too vague", files: ["src/**/*.ts"], forbid: "(" },
    { title: "Nothing matches these files at all", files: ["lib/**/*.rb"], forbid: "x" },
    { title: "Every line has a semicolon somewhere, apparently", files: ["src/**/*.ts"], forbid: "\\S" },
  ]);
  assert.deepEqual(res.accepted.map((r) => [r.title.slice(0, 20), r.grandfathered]), [["Change order status ", 1]], "the existing assignment in orders.ts is grandfathered");
  assert.match(res.rejected.find((r) => r.title === "Too vague")!.problems.join(" "), /regular expression|10 characters|sentence/);
  assert.match(res.rejected.find((r) => r.title.startsWith("Nothing"))!.problems.join(" "), /No files match/);
  assert.match(res.rejected.find((r) => r.title.startsWith("Every line"))!.problems.join(" "), /already break it/);
  assert.equal((await readRules(root)).rules.length, 1);

  let results = await checkRules(root, a);
  assert.deepEqual(results[0]!.violations.map((v) => [v.path, v.isNew]), [["src/orders.ts", false]]);

  await writeFile(path.join(root, "src/api/skip.ts"), `import { Order } from "../models/order";\nexport function handle(o: Order) {\n  o.status = "skipped";\n}\n`);
  results = await checkRules(root, await scan(root), { files: ["src/api/skip.ts"] });
  assert.deepEqual(results[0]!.violations.map((v) => [v.path, v.line, v.isNew]), [["src/api/skip.ts", 3, true]], "a new violation in a changed file is caught, on its line");
});
