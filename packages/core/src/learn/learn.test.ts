import assert from "node:assert/strict";
import { test } from "node:test";
import { scan } from "../scan/index.js";
import { makeTree } from "../test-utils.js";
import { OfficialDocs } from "../official/index.js";
import { checkExercise, lessonPlan, readLessons, recheckLessons, submitLessons, type LessonInput } from "./index.js";

const PAGE = "https://nextjs.org/docs/app/api-reference/functions/revalidateTag";
const pages: Record<string, string> = {
  "https://nextjs.org/docs/llms.txt": `@doc-version: 16.4.3\n- [revalidateTag](${PAGE}): Purge cached data.\n- [cookies](https://nextjs.org/docs/app/api-reference/functions/cookies): Cookies.\n`,
  [`${PAGE}.md`]: "# revalidateTag\n\n`revalidateTag` allows you to invalidate cached data on-demand for a specific cache tag.\n",
};
const fakeDocs = (root: string) =>
  new OfficialDocs(root, async (url) => {
    const body = pages[url];
    return { ok: body !== undefined, status: body ? 200 : 404, text: async () => body ?? "", arrayBuffer: async () => new ArrayBuffer(0) };
  });

const repo = {
  "package.json": JSON.stringify({ dependencies: { next: "15.0.0", react: "19.0.0" } }),
  "app/actions.ts": `"use server";\nimport { revalidateTag } from "next/cache";\nimport { cookies } from "next/headers";\nexport async function addItem() {\n  await cookies();\n  revalidateTag("cart");\n}\n`,
};

const lesson = (over: Partial<LessonInput> = {}): LessonInput => ({
  title: "Refreshing cached data with revalidateTag",
  concept: "Cached data is labelled with tags, and revalidating a tag throws away everything with that label.",
  why: "Adding to the cart has to show the new cart straight away.",
  body: "The server action calls `revalidateTag` after changing the cart.",
  docs: [{ url: PAGE, quote: "allows you to invalidate cached data on-demand for a specific cache tag" }],
  code: [{ path: "app/actions.ts", line: 6 }],
  exercises: [
    { kind: "predict", question: "A shopper adds an item. Does the cart show it on the next request?", options: ["Yes", "Only after a day"], answer: 0, explain: "addItem revalidates the cart tag.", evidence: [{ path: "app/actions.ts", line: 6 }] },
    { kind: "change", task: "Rename the cache tag to basket.", files: ["app/actions.ts"], checks: [{ file: "app/actions.ts", pattern: 'revalidateTag\\("basket"\\)', must: "match", describe: "addItem revalidates the basket tag" }] },
  ],
  ...over,
});

test("lessons: docs quotes are checked against the official page, code and answers against the repo", async () => {
  const root = await makeTree(repo);
  const a = await scan(root);
  const res = await submitLessons(root, a, "foundations", [
    lesson(),
    lesson({ title: "Made-up quote", docs: [{ url: PAGE, quote: "revalidateTag caches forever by default" }] }),
    lesson({ title: "Blog post", docs: [{ url: "https://someblog.dev/next-caching", quote: "allows you to invalidate cached data" }] }),
    lesson({ title: "Wrong answer", exercises: [{ kind: "predict", question: "?", options: ["a", "b"], answer: 0, explain: "x", evidence: [{ path: "app/missing.ts", line: 1 }] }] }),
    lesson({ title: "Already done", exercises: [{ kind: "change", task: "Use the cart tag.", files: ["app/actions.ts"], checks: [{ file: "app/actions.ts", pattern: "cart", must: "match", describe: "uses cart" }] }] }),
  ], fakeDocs(root));
  assert.deepEqual(res.accepted.map((x) => x.id), ["refreshing-cached-data-with-revalidatetag"]);
  const why = (title: string) => res.rejected.find((r) => r.title === title)!.problems.join(" | ");
  assert.match(why("Made-up quote"), /the quote doesn't appear on that page/);
  assert.match(why("Blog post"), /not an official docs page/);
  assert.match(why("Wrong answer"), /exercises\[0\] \(predict\): evidence\[0\] \(app\/missing\.ts\): no such file/);
  assert.match(why("Already done"), /every check already passes on today's code/);
  const stored = (await readLessons(root)).tracks.foundations!.lessons[0]!;
  assert.deepEqual(stored.docs[0], { url: PAGE, quote: "allows you to invalidate cached data on-demand for a specific cache tag", source: "nextjs", version: "16.4.3" });
  assert.equal(stored.code[0]!.kind, "file");
});

test("lesson plan: framework APIs reached from entry points, with their official pages", async () => {
  const root = await makeTree(repo);
  const plan = await lessonPlan(root, await scan(root), fakeDocs(root));
  assert.deepEqual(plan.entryPoints.map((e) => `${e.kind} ${e.path}`), ["action addItem"]);
  assert.deepEqual(plan.topics.map((t) => [t.api, t.docs?.url ?? null]), [
    ["next/headers · cookies", "https://nextjs.org/docs/app/api-reference/functions/cookies"],
    ["next/cache · revalidateTag", PAGE],
  ]);
  assert.deepEqual(plan.stack.find((s) => s.name === "Next.js"), { name: "Next.js", installed: "15.0.0", latest: "16.4.3" });
});

test("lesson re-checks: moved code is fine; edited code, deleted code and changed official pages are flagged", async () => {
  const { writeFile, rm } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const root = await makeTree(repo);
  const docs = fakeDocs(root);
  await submitLessons(root, await scan(root), "foundations", [lesson()], docs);
  const recheck = async () => recheckLessons(root, await scan(root), fakeDocs(root));

  // Lines shift down: the cited line still exists elsewhere, so nothing to report.
  await writeFile(join(root, "app/actions.ts"), "// a comment\n" + repo["app/actions.ts"]);
  let r = await recheck();
  assert.deepEqual([r.broken.length, r.changed.length, r.total], [0, 0, 1]);

  // The cited call is edited: the lesson needs review.
  await writeFile(join(root, "app/actions.ts"), repo["app/actions.ts"].replace('revalidateTag("cart")', 'revalidateTag("cart-v2")'));
  r = await recheck();
  assert.equal(r.changed.length, 1);
  assert.match(r.changed[0]!.problems.join(" "), /line 6 of app\/actions\.ts changed/);
  assert.deepEqual([r.changed[0]!.doc, r.changed[0]!.section, r.changed[0]!.id], ["learn", "foundations", "refreshing-cached-data-with-revalidatetag"]);

  // The official page no longer says what was quoted.
  await writeFile(join(root, "app/actions.ts"), repo["app/actions.ts"]);
  const original = pages[`${PAGE}.md`]!;
  pages[`${PAGE}.md`] = "# revalidateTag\n\nThis page was rewritten.\n";
  const { readdir } = await import("node:fs/promises");
  for (const f of await readdir(join(root, ".houserules/cache/docs"))) await rm(join(root, ".houserules/cache/docs", f)); // drop the cached copy
  r = await recheck();
  pages[`${PAGE}.md`] = original;
  assert.match(r.changed[0]?.problems.join(" ") ?? "", /the official page no longer says/);

  // The file is gone: broken.
  await rm(join(root, "app/actions.ts"));
  r = await recheck();
  assert.equal(r.broken.length, 1);
  assert.match(r.broken[0]!.problems.join(" "), /example: .*app\/actions\.ts/);
});

test("change tasks: the learner's working copy is checked live; finishing it in the code retires the task", async () => {
  const { writeFile } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const root = await makeTree(repo);
  await submitLessons(root, await scan(root), "foundations", [lesson()], fakeDocs(root));
  const stored = (await readLessons(root)).tracks.foundations!.lessons[0]!;
  assert.deepEqual(await checkExercise(root, stored, 1), { passed: false, results: [{ describe: "addItem revalidates the basket tag", ok: false }], otherFiles: [] });
  assert.equal(await checkExercise(root, stored, 0), null, "predict questions aren't checked against files");
  await writeFile(join(root, "app/actions.ts"), repo["app/actions.ts"].replace('revalidateTag("cart")', 'revalidateTag("basket")'));
  assert.equal((await checkExercise(root, stored, 1))!.passed, true);
  // Committed for real, the task is no longer a task: re-checks flag it so the lesson gets rewritten.
  const r = await recheckLessons(root, await scan(root));
  assert.match(r.broken[0]?.problems.join(" ") ?? "", /change task: the code already does what the task asks/);
});
