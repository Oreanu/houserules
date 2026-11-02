import assert from "node:assert/strict";
import { test } from "node:test";
import { deflateSync } from "node:zlib";
import { makeTree } from "../test-utils.js";
import { OfficialDocs } from "./index.js";

const LLMS = `# Next.js Documentation
@doc-version: 16.4.3

- [cacheTag](https://nextjs.org/docs/app/api-reference/functions/cacheTag): Tag cached data.
- [not-found.js](https://nextjs.org/docs/app/api-reference/file-conventions/not-found): File convention.
- [notFound](https://nextjs.org/docs/app/api-reference/functions/not-found): Throw a 404.
- [cookies](https://nextjs.org/docs/pages/api-reference/functions/cookies): Pages Router.
- [cookies](https://nextjs.org/docs/app/api-reference/functions/cookies): Read cookies.
- [Image](https://nextjs.org/docs/app/api-reference/components/image): The Image component.
`;

function inventory(): Buffer {
  const body = "django.shortcuts.render py:function 1 topics/http/shortcuts/#$ -\ndjango.db.models.ForeignKey py:class 1 ref/models/fields/#$ -\nindex std:doc -1 index Home\n";
  return Buffer.concat([Buffer.from("# Sphinx inventory version 2\n# Project: Django\n# Version: 6.1\n# The remainder of this file is compressed using zlib.\n"), deflateSync(body)]);
}

function fakeFetch(pages: Record<string, string | Buffer>, calls: string[] = []) {
  return async (url: string) => {
    calls.push(url);
    const body = pages[url];
    if (body === undefined) return { ok: false, status: 404, text: async () => "", arrayBuffer: async () => new ArrayBuffer(0) };
    const buf = typeof body === "string" ? Buffer.from(body) : body;
    return { ok: true, status: 200, text: async () => buf.toString("utf8"), arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer };
  };
}

test("official docs: API lookup prefers the App Router reference page and follows renames out of unstable_", async () => {
  const root = await makeTree({ "package.json": "{}" });
  const docs = new OfficialDocs(root, fakeFetch({ "https://nextjs.org/docs/llms.txt": LLMS }));
  const url = async (api: string) => (await docs.lookupApi(api))?.url;
  assert.equal(await url("next/navigation · notFound"), "https://nextjs.org/docs/app/api-reference/functions/not-found");
  assert.equal(await url("next/headers · cookies"), "https://nextjs.org/docs/app/api-reference/functions/cookies");
  assert.equal(await url("next/image · Image"), "https://nextjs.org/docs/app/api-reference/components/image");
  const renamed = await docs.lookupApi("next/cache · unstable_cacheTag");
  assert.deepEqual(renamed, { title: "cacheTag", url: "https://nextjs.org/docs/app/api-reference/functions/cacheTag", source: "nextjs", version: "16.4.3", renamedFrom: "unstable_cacheTag" });
  assert.equal(await docs.lookupApi("lodash · map"), null, "only framework packages with an official source");
});

test("official docs: Django APIs map through the Sphinx inventory, with its version", async () => {
  const root = await makeTree({ "manage.py": "" });
  const docs = new OfficialDocs(root, fakeFetch({ "https://docs.djangoproject.com/en/stable/objects.inv": inventory() }));
  const p = await docs.lookupApi("django.shortcuts · render");
  assert.deepEqual(p, { title: "django.shortcuts.render", url: "https://docs.djangoproject.com/en/6.1/topics/http/shortcuts/#django.shortcuts.render", source: "django", version: "6.1" });
});

test("official docs: quotes are checked against the fetched page; the cache serves repeats and offline use", async () => {
  const root = await makeTree({ "package.json": "{}" });
  const calls: string[] = [];
  const page = "# cacheTag\n\nThe `cacheTag` function allows you to **tag cached data** for on-demand invalidation.";
  let now = 0;
  const pages: Record<string, string> = { "https://nextjs.org/docs/app/api-reference/functions/cacheTag.md": page };
  const docs = new OfficialDocs(root, fakeFetch(pages, calls), () => now);
  assert.equal(await docs.verifyQuote("https://nextjs.org/docs/app/api-reference/functions/cacheTag", "allows you to tag cached data"), true);
  assert.equal(await docs.verifyQuote("https://nextjs.org/docs/app/api-reference/functions/cacheTag", "caches forever by default"), false, "a made-up quote fails");
  assert.equal(calls.length, 1, "the second check used the cache");
  delete pages["https://nextjs.org/docs/app/api-reference/functions/cacheTag.md"]; // network gone, cache stale
  now = 30 * 24 * 60 * 60 * 1000;
  const offline = new OfficialDocs(root, fakeFetch(pages, calls), () => now);
  assert.equal(await offline.verifyQuote("https://nextjs.org/docs/app/api-reference/functions/cacheTag", "tag cached data"), true, "a stale copy beats nothing when offline");
});
