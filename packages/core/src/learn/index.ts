import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import path from "node:path";
import type { Analysis } from "../types.js";
import { HOUSERULES_DIR } from "../scan/index.js";
import { buildSymbolIndex } from "../symbols/index.js";
import { Verifier, type Evidence, type EvidenceInput } from "../docs/verify.js";
import { recheckEvidence, type StaleReport } from "../docs/store.js";
import { DOC_SOURCES, OfficialDocs, stackDocs, type DocSourceId } from "../official/index.js";
import { buildCallGraph } from "../flows/graph.js";
import { listRoutes, type Route } from "../flows/routes.js";
import { traceRoute } from "../flows/trace.js";

// Lessons: a learning path for this repo whose concepts are grounded in the stack's latest official
// docs (quotes checked against the fetched page) and whose examples are the repo's own code (checked
// like any other evidence). The agent writes them; the engine verifies, stores and orders them.

export const TRACKS = [
  { id: "foundations", title: "Foundations", blurb: "The framework concepts this repo is built on, in the order a request meets them." },
  { id: "repo", title: "How this repo works", blurb: "Its flows, patterns and building blocks, traced through real code." },
  { id: "mastery", title: "Shipping here", blurb: "Tradeoffs, pitfalls, and the changes you'll actually make." },
] as const;
export type TrackId = (typeof TRACKS)[number]["id"];

export const LESSON_LIMITS = { perTrack: 12, title: 90, concept: 240, why: 400, body: 1800, drift: 400, quote: [12, 280] as [number, number], docs: 3, code: 4, terms: 6 };

export interface DocCitationInput {
  url: string; // an official docs page
  quote: string; // a short sentence copied from that page
}

export interface LessonInput {
  title: string;
  concept: string; // the idea in one plain sentence
  why: string; // why it matters in this repo
  body: string; // the explanation, Markdown
  docs: DocCitationInput[];
  code: EvidenceInput[]; // where the repo does it
  drift?: string; // where the repo differs from the latest docs
  exercises: ExerciseInput[];
  terms?: { term: string; definition: string; url?: string }[];
  entryPoint?: string; // the route path this lesson follows, if any
}

/**
 * Exercises, from what works for learning code (PRIMM's predict → modify, Rustlings' fix-and-recheck):
 * - predict: guess what the code does before seeing why; the explanation cites the code that proves it.
 * - change: make a small real edit in your own editor; houserules re-checks your files as you save.
 */
export type ExerciseInput =
  | { kind: "predict"; question: string; options: string[]; answer: number; explain: string; evidence: EvidenceInput[] }
  | { kind: "change"; task: string; files: string[]; checks: ChangeCheck[]; hint?: string; solution?: string };

/** A check on the learner's working copy: a regex that must (or must not) match in a file. */
export interface ChangeCheck {
  file: string;
  pattern: string; // JavaScript regex source, matched against the whole file ("m" flag on)
  must: "match" | "not-match";
  describe: string; // what passing means, shown to the learner ("getProduct caches for hours")
}

export type Exercise =
  | (Omit<Extract<ExerciseInput, { kind: "predict" }>, "evidence"> & { evidence: Evidence[] })
  | Extract<ExerciseInput, { kind: "change" }>;

export interface DocCitation extends DocCitationInput {
  source: DocSourceId;
  version: string | null;
}

export interface Lesson extends Omit<LessonInput, "docs" | "code" | "exercises"> {
  id: string;
  track: TrackId;
  docs: DocCitation[];
  code: Evidence[];
  exercises: Exercise[];
}

export interface LessonStore {
  version: 1;
  tracks: Partial<Record<TrackId, { lessons: Lesson[]; updatedAt: string }>>;
}

export interface LessonSubmitResult {
  track: TrackId;
  accepted: { index: number; id: string; title: string }[];
  rejected: { index: number; title: string; problems: string[] }[];
  notes: string[];
}

const OFFICIAL: { source: DocSourceId; re: RegExp }[] = [
  { source: "nextjs", re: /^https:\/\/nextjs\.org\/docs\// },
  { source: "react", re: /^https:\/\/react\.dev\// },
  { source: "django", re: /^https:\/\/docs\.djangoproject\.com\// },
  { source: "expo", re: /^https:\/\/docs\.expo\.dev\// },
  { source: "react-native", re: /^https:\/\/reactnative\.dev\// },
  { source: "laravel", re: /^https:\/\/laravel\.com\/(framework\/)?docs\// },
  { source: "nestjs", re: /^https:\/\/docs\.nestjs\.com\// },
  { source: "fastify", re: /^https:\/\/fastify\.dev\/docs\// },
  { source: "express", re: /^https:\/\/expressjs\.com\// },
  { source: "hono", re: /^https:\/\/hono\.dev\/docs\// },
  { source: "node", re: /^https:\/\/nodejs\.org\/(docs\/latest\/)?api\// },
];

const storePath = (root: string) => path.join(root, HOUSERULES_DIR, "lessons.json");
const slug = (s: string) => s.toLowerCase().replace(/`/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);

export async function readLessons(rootDir: string): Promise<LessonStore> {
  try {
    const s = JSON.parse(await readFile(storePath(path.resolve(rootDir)), "utf8")) as LessonStore;
    if (s.version === 1) return s;
  } catch {
    // none yet
  }
  return { version: 1, tracks: {} };
}

export function allLessons(store: LessonStore): Lesson[] {
  return TRACKS.flatMap((t) => store.tracks[t.id]?.lessons ?? []);
}

/** Verifies and stores one track's lessons (a submit replaces the track, like doc sections). */
export async function submitLessons(rootDir: string, analysis: Analysis, track: string, inputs: LessonInput[], docs = new OfficialDocs(rootDir)): Promise<LessonSubmitResult> {
  if (!TRACKS.some((t) => t.id === track)) throw new Error(`Unknown track "${track}". Tracks: ${TRACKS.map((t) => t.id).join(", ")}`);
  const root = path.resolve(rootDir);
  const verifier = new Verifier(root, await buildSymbolIndex(root, analysis));
  const result: LessonSubmitResult = { track: track as TrackId, accepted: [], rejected: [], notes: [] };
  const lessons: Lesson[] = [];
  const ids = new Set<string>();
  const L = LESSON_LIMITS;

  for (const [index, input] of inputs.slice(0, L.perTrack).entries()) {
    const problems: string[] = [];
    const len = (field: string, v: string | undefined, max: number, required = true) => {
      const t = (v ?? "").trim();
      if (required && !t) problems.push(`${field} is empty`);
      if (t.length > max) problems.push(`${field} is longer than ${max} characters`);
    };
    len("title", input.title, L.title);
    len("concept", input.concept, L.concept);
    len("why", input.why, L.why);
    len("body", input.body, L.body);
    len("drift", input.drift, L.drift, false);
    if (!input.docs?.length) problems.push("cite at least one official docs page: lessons teach the framework's own words, not memory");
    if ((input.docs?.length ?? 0) > L.docs) problems.push(`at most ${L.docs} docs citations`);
    if (!input.code?.length) problems.push("show at least one place in this repo where the concept is used");
    if ((input.code?.length ?? 0) > L.code) problems.push(`at most ${L.code} code examples`);
    if ((input.terms?.length ?? 0) > L.terms) problems.push(`at most ${L.terms} terms`);
    const exInputs = input.exercises ?? [];
    if (!exInputs.length) problems.push("add at least one exercise: a predict question, a change task, or both");
    if (exInputs.length > 3) problems.push("at most 3 exercises per lesson");

    const citations: DocCitation[] = [];
    for (const [i, d] of (input.docs ?? []).slice(0, L.docs).entries()) {
      const where = `docs[${i}] (${d.url})`;
      const official = OFFICIAL.find((o) => o.re.test(d.url ?? ""));
      if (!official) {
        problems.push(`${where}: not an official docs page (${DOC_SOURCES.map((s) => s.name).join(", ")})`);
        continue;
      }
      const q = (d.quote ?? "").trim();
      if (q.length < L.quote[0] || q.length > L.quote[1]) {
        problems.push(`${where}: quote must be ${L.quote[0]}–${L.quote[1]} characters: one sentence, copied exactly`);
        continue;
      }
      if ((await docs.pageText(d.url)) === null) {
        problems.push(`${where}: couldn't fetch the page to check the quote; check the URL (use official_docs to find it) or retry when online`);
        continue;
      }
      if (!(await docs.verifyQuote(d.url, q))) {
        problems.push(`${where}: the quote doesn't appear on that page; copy a sentence exactly from official_docs output`);
        continue;
      }
      const idx = await docs.index(official.source);
      citations.push({ url: d.url, quote: q, source: official.source, version: idx?.version ?? (await docs.latestRelease(official.source)) });
    }

    // Code and exercise evidence are checked by the same verifier as doc items.
    const code = await verifier.verify({ title: input.title || "lesson", body: "", evidence: input.code ?? [], confidence: "observed" }, "lesson");
    problems.push(...code.problems.map((p) => `code: ${p}`));
    const exercises: Exercise[] = [];
    for (const [i, ex] of exInputs.slice(0, 3).entries()) {
      const where = `exercises[${i}] (${ex.kind})`;
      if (ex.kind === "predict") {
        if (!ex.question?.trim() || !ex.explain?.trim()) problems.push(`${where}: needs a question and an explanation`);
        if (!Array.isArray(ex.options) || ex.options.length < 2 || ex.options.length > 4) problems.push(`${where}: give 2–4 options`);
        else if (!Number.isInteger(ex.answer) || ex.answer < 0 || ex.answer >= ex.options.length) problems.push(`${where}: answer must be the index of the right option`);
        if (!ex.evidence?.length) problems.push(`${where}: cite the code that proves the answer`);
        const ev = await verifier.verify({ title: "predict", body: "", evidence: ex.evidence ?? [], confidence: "observed" }, "predict");
        problems.push(...ev.problems.map((p) => `${where}: ${p}`));
        if (ev.item) exercises.push({ ...ex, question: ex.question.trim(), explain: ex.explain.trim(), evidence: ev.item.evidence });
      } else if (ex.kind === "change") {
        const issues = await validateChange(root, ex);
        problems.push(...issues.map((p) => `${where}: ${p}`));
        if (!issues.length) exercises.push({ ...ex, task: ex.task.trim() });
      } else problems.push(`${where}: kind must be "predict" or "change"`);
    }

    if (problems.length || !code.item) {
      result.rejected.push({ index, title: input.title, problems });
      continue;
    }
    let id = slug(input.title) || `lesson-${index + 1}`;
    for (let n = 2; ids.has(id); n++) id = `${slug(input.title)}-${n}`;
    ids.add(id);
    lessons.push({
      id,
      track: track as TrackId,
      title: input.title.trim(),
      concept: input.concept.trim(),
      why: input.why.trim(),
      body: input.body.trim(),
      ...(input.drift?.trim() ? { drift: input.drift.trim() } : {}),
      docs: citations,
      code: code.item.evidence,
      exercises,
      ...(input.terms?.length ? { terms: input.terms } : {}),
      ...(input.entryPoint ? { entryPoint: input.entryPoint } : {}),
    });
    result.accepted.push({ index, id, title: input.title });
  }
  if (inputs.length > L.perTrack) result.notes.push(`Only the first ${L.perTrack} lessons were considered.`);
  if (result.rejected.length) result.notes.push("Fix the rejected lessons and resubmit the whole track; a submit replaces the track.");

  const store = await readLessons(root);
  store.tracks[track as TrackId] = { lessons, updatedAt: new Date().toISOString() };
  await mkdir(path.dirname(storePath(root)), { recursive: true });
  await writeFile(storePath(root), JSON.stringify(store, null, 2) + "\n");
  return result;
}

/**
 * Re-checks every stored lesson: its code examples and exercise answer against the code now, and (when
 * `docs` is given) each quote against the cached official page, so lessons are flagged when either the
 * code or the official docs move on. Reports use doc "learn" and the track as the section.
 */
export async function recheckLessons(rootDir: string, analysis: Analysis, docs?: OfficialDocs): Promise<{ broken: StaleReport[]; changed: StaleReport[]; total: number }> {
  const root = path.resolve(rootDir);
  const store = await readLessons(root);
  const verifier = new Verifier(root, await buildSymbolIndex(root, analysis));
  const broken: StaleReport[] = [];
  const changed: StaleReport[] = [];
  let total = 0;
  for (const lesson of allLessons(store)) {
    total++;
    const report = (problems: string[]) => ({ doc: "learn", section: lesson.track, id: lesson.id, title: lesson.title, problems });
    const code = await recheckEvidence(verifier, lesson.title, "", lesson.code);
    const predictEvidence = (lesson.exercises ?? []).flatMap((e) => (e.kind === "predict" ? e.evidence : []));
    const answer = predictEvidence.length ? await recheckEvidence(verifier, "exercise", "", predictEvidence) : { changed: [] as string[] };
    const brokenProblems = [...(code.broken ?? []).map((p) => `example: ${p}`), ...(answer.broken ?? []).map((p) => `exercise: ${p}`)];
    // A change task whose files vanished is broken; one the code already satisfies is no longer a task.
    for (const ex of lesson.exercises ?? []) {
      if (ex.kind !== "change") continue;
      const issues = await validateChange(root, ex, true);
      if (issues.length) brokenProblems.push(...issues.map((p) => `change task: ${p}`));
    }
    if (brokenProblems.length) {
      broken.push(report(brokenProblems));
      continue;
    }
    const changedProblems = [...code.changed, ...answer.changed.map((p) => `exercise: ${p}`)];
    for (const d of docs ? lesson.docs : []) {
      // Only when the page could be read: an offline machine shouldn't flag every lesson.
      if ((await docs!.pageText(d.url)) !== null && !(await docs!.verifyQuote(d.url, d.quote))) changedProblems.push(`the official page no longer says "${d.quote.length > 60 ? `${d.quote.slice(0, 57)}…` : d.quote}" (${d.url})`);
    }
    if (changedProblems.length) changed.push(report(changedProblems));
  }
  return { broken, changed, total };
}

const run = promisify(execFile);

/**
 * A change task must be possible and not already done: its files exist, its patterns are valid, checks
 * only touch the listed files, and on today's code at least one check fails (otherwise there's nothing to do).
 */
async function validateChange(root: string, ex: Extract<ExerciseInput, { kind: "change" }>, recheck = false): Promise<string[]> {
  const problems: string[] = [];
  if (!recheck) {
    if (!ex.task?.trim()) problems.push("needs a task");
    if (!ex.files?.length) problems.push("list the files the learner should edit");
    if (!ex.checks?.length) problems.push("add at least one check");
  }
  const contents = new Map<string, string>();
  for (const f of ex.files ?? []) {
    try {
      contents.set(f, await readFile(path.join(root, f), "utf8"));
    } catch {
      problems.push(`${f} doesn't exist`);
    }
  }
  if (problems.length) return problems;
  let failing = 0;
  for (const c of ex.checks) {
    if (!contents.has(c.file)) {
      problems.push(`check "${c.describe}" looks at ${c.file}, which isn't in files`);
      continue;
    }
    let re: RegExp;
    try {
      re = new RegExp(c.pattern, "m");
    } catch (e) {
      problems.push(`check "${c.describe}": invalid pattern (${(e as Error).message})`);
      continue;
    }
    const ok = re.test(contents.get(c.file)!) === (c.must === "match");
    if (!ok) failing++;
  }
  if (!problems.length && failing === 0) problems.push(recheck ? "the code already does what the task asks; rewrite or drop it" : "every check already passes on today's code, so there's nothing for the learner to do");
  return problems;
}

export interface ExerciseCheck {
  passed: boolean;
  results: { describe: string; ok: boolean }[];
  otherFiles: string[]; // files changed outside the task's files (from git), worth a second look
}

/** Runs a change task's checks against the learner's working copy. Read-only. */
export async function checkExercise(rootDir: string, lesson: Lesson, index: number): Promise<ExerciseCheck | null> {
  const ex = lesson.exercises?.[index];
  if (!ex || ex.kind !== "change") return null;
  const root = path.resolve(rootDir);
  const results: ExerciseCheck["results"] = [];
  for (const c of ex.checks) {
    let text = "";
    try {
      text = await readFile(path.join(root, c.file), "utf8");
    } catch {
      // a missing file fails its checks
    }
    let ok = false;
    try {
      ok = new RegExp(c.pattern, "m").test(text) === (c.must === "match");
    } catch {
      ok = false;
    }
    results.push({ describe: c.describe, ok });
  }
  let otherFiles: string[] = [];
  try {
    const { stdout } = await run("git", ["-C", root, "diff", "--name-only", "HEAD"]);
    otherFiles = stdout.split("\n").map((s) => s.trim()).filter((f) => f && !ex.files.includes(f) && !f.startsWith(".houserules/"));
  } catch {
    // not a git repo
  }
  return { passed: results.every((r) => r.ok), results, otherFiles };
}

export interface LessonPlanTopic {
  api: string; // "next/cache · revalidateTag"
  usedBy: string[]; // entry point paths whose trace reaches it
  firstSeen: number; // order in which a learner meets it walking entry points
  docs: { url: string; title: string; version: string | null; renamedFrom?: string } | null;
}

export interface LessonPlan {
  stack: { name: string; installed: string | null; latest: string | null }[];
  entryPoints: { path: string; kind: Route["kind"]; handler: string; file: string; steps: number }[];
  topics: LessonPlanTopic[];
  guidance: string[];
}

/**
 * What to teach, worked out from the code: the framework APIs the entry points actually touch, most
 * used first, each with its latest official docs page. The agent turns this into lessons.
 */
export async function lessonPlan(rootDir: string, analysis: Analysis, docs = new OfficialDocs(rootDir)): Promise<LessonPlan> {
  const root = path.resolve(rootDir);
  const symbols = await buildSymbolIndex(root, analysis);
  const graph = await buildCallGraph(root, analysis, symbols);
  const routes = await listRoutes(root, analysis);
  const topics = new Map<string, LessonPlanTopic>();
  let order = 0;
  const entryPoints: LessonPlan["entryPoints"] = [];
  for (const r of routes) {
    const t = traceRoute(graph, symbols, r);
    entryPoints.push({ path: r.path, kind: r.kind, handler: r.handler, file: r.file, steps: t.steps.filter((s) => !s.external).length });
    for (const s of t.steps) {
      if (s.external?.category !== "framework") continue;
      const topic = topics.get(s.name) ?? { api: s.name, usedBy: [], firstSeen: order++, docs: null };
      if (!topic.usedBy.includes(r.path)) topic.usedBy.push(r.path);
      topics.set(s.name, topic);
    }
  }
  const list = [...topics.values()].sort((a, b) => b.usedBy.length - a.usedBy.length || a.firstSeen - b.firstSeen);
  await Promise.all(
    list.map(async (t) => {
      const p = await docs.lookupApi(t.api).catch(() => null);
      t.docs = p ? { url: p.url, title: p.title, version: p.version, ...(p.renamedFrom ? { renamedFrom: p.renamedFrom } : {}) } : null;
    }),
  );
  const stack = (await stackDocs(docs, analysis)).map((s) => ({ name: s.source.name, installed: s.installed, latest: s.latest }));
  return {
    stack,
    entryPoints,
    topics: list,
    guidance: [
      "Foundations: one lesson per framework concept the entry points rely on (group related APIs: cookies + headers; cacheTag + cacheLife + revalidateTag). Order them as a request meets them.",
      "How this repo works: one lesson per main entry point or pattern, following its trace; reuse the Foundations lessons' terms.",
      "Shipping here: the changes people actually make, the tradeoffs and pitfalls, each with an exercise that touches real code.",
      "Every lesson quotes the latest official docs (use official_docs to read the page and copy one sentence exactly) and shows the repo's own code.",
      "Where the repo's version or code differs from the latest docs (renamed or unstable APIs, older patterns), say so in drift: what the docs say now and what that means here.",
      "Exercises: one predict question per lesson (what happens if…, answered before the explanation; cite the code that proves it), and a change task for hands-on lessons (a small real edit; checks are regexes on the learner's files, and at least one must fail on today's code).",
    ],
  };
}
