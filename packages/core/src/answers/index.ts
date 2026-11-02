import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { recheckEvidence, type StaleReport } from "../docs/store.js";
import { Verifier, type EvidenceInput, type Item } from "../docs/verify.js";
import { buildSymbolIndex } from "../symbols/index.js";
import type { Analysis } from "../types.js";

// Answers an agent gave in chat, kept as team knowledge. A good explanation usually vanishes with the session;
// saving it here means the next person (or agent) finds it, and houserules re-checks its evidence on every run
// like any doc item, so it can't quietly go stale.

export interface SavedAnswer extends Item {
  question: string; // as asked; `title` holds the same text, so the shared verifier and renderers work unchanged
  savedAt: string;
  updatedAt?: string;
  askedIn?: string; // where it came from: "claude", "codex", "preview"…
}

export interface AnswerStore {
  version: 1;
  answers: SavedAnswer[];
}

export interface AnswerInput {
  question: string;
  answer: string; // markdown
  evidence: EvidenceInput[];
  confidence?: "observed" | "inferred";
  askedIn?: string;
}

const storePath = (root: string) => path.join(root, ".houserules", "answers.json");

export async function readAnswers(rootDir: string): Promise<AnswerStore> {
  try {
    const s = JSON.parse(await readFile(storePath(path.resolve(rootDir)), "utf8")) as AnswerStore;
    if (s.version === 1 && Array.isArray(s.answers)) return s;
  } catch {
    // no answers yet
  }
  return { version: 1, answers: [] };
}

const slug = (s: string) => s.toLowerCase().replace(/`/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 70);
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();

/**
 * Verifies and stores one answer. It needs code evidence: every cited file, line and symbol must exist, the
 * same check doc items get. The same question asked again replaces the old answer instead of piling up.
 */
export async function saveAnswer(rootDir: string, analysis: Analysis, input: AnswerInput): Promise<{ accepted: boolean; id?: string; replaced?: boolean; problems: string[] }> {
  const root = path.resolve(rootDir);
  const question = (input.question ?? "").trim();
  const problems: string[] = [];
  if (question.length < 8) problems.push("Write the question the way someone would ask it (at least a few words).");
  if (!input.evidence?.length) problems.push("Cite the code the answer is based on (file and line). Answers without evidence aren't saved, because they can't be re-checked.");
  if (problems.length) return { accepted: false, problems };
  const verifier = new Verifier(root, await buildSymbolIndex(root, analysis));
  const store = await readAnswers(root);
  const existing = store.answers.find((a) => norm(a.question) === norm(question));
  let id = existing?.id ?? (slug(question) || "answer");
  for (let n = 2; !existing && store.answers.some((a) => a.id === id); n++) id = `${slug(question)}-${n}`;
  const { item, problems: found } = await verifier.verify({ title: question.slice(0, 140), body: input.answer, evidence: input.evidence, confidence: input.confidence ?? "observed" }, id);
  if (!item) return { accepted: false, problems: found };
  const now = new Date().toISOString();
  // Keep the first wording of the question; later askings just refresh the answer.
  const saved: SavedAnswer = { ...item, ...(existing ? { title: existing.title } : {}), question: existing?.question ?? question, savedAt: existing?.savedAt ?? now, ...(existing ? { updatedAt: now } : {}), ...(input.askedIn ? { askedIn: input.askedIn } : {}) };
  store.answers = existing ? store.answers.map((a) => (a.id === existing.id ? saved : a)) : [saved, ...store.answers];
  await mkdir(path.dirname(storePath(root)), { recursive: true });
  await writeFile(storePath(root), JSON.stringify(store, null, 2) + "\n");
  return { accepted: true, id, replaced: Boolean(existing), problems: [] };
}

export async function removeAnswer(rootDir: string, id: string): Promise<boolean> {
  const root = path.resolve(rootDir);
  const store = await readAnswers(root);
  const before = store.answers.length;
  store.answers = store.answers.filter((a) => a.id !== id);
  if (store.answers.length === before) return false;
  await writeFile(storePath(root), JSON.stringify(store, null, 2) + "\n");
  return true;
}

/** Saved answers that match a question, best first: words in the question count most, then the answer and cited paths. */
export function searchAnswers(store: AnswerStore, query: string, limit = 5): SavedAnswer[] {
  const words = norm(query).split(" ").filter((w) => w.length > 2 && !STOP.has(w));
  if (!words.length) return store.answers.slice(0, limit);
  const score = (a: SavedAnswer) => {
    const q = norm(a.question), body = norm(a.body), refs = a.evidence.map((e) => e.path.toLowerCase()).join(" ");
    return words.reduce((n, w) => n + (q.includes(w) ? 3 : 0) + (body.includes(w) ? 1 : 0) + (refs.includes(w) ? 1 : 0), 0);
  };
  return store.answers
    .map((a) => [a, score(a)] as const)
    .filter(([, s]) => s > 0)
    .sort((x, y) => y[1] - x[1])
    .slice(0, limit)
    .map(([a]) => a);
}

const STOP = new Set("the and for with what when where which who how does do this that are was were from into about there their then than have has why can its it's our your you".split(" "));

/** Re-checks every saved answer's evidence against the code now, as doc items are re-checked. */
export async function recheckAnswers(rootDir: string, analysis: Analysis): Promise<{ broken: StaleReport[]; changed: StaleReport[]; total: number }> {
  const root = path.resolve(rootDir);
  const store = await readAnswers(root);
  if (!store.answers.length) return { broken: [], changed: [], total: 0 };
  const verifier = new Verifier(root, await buildSymbolIndex(root, analysis));
  const broken: StaleReport[] = [];
  const changed: StaleReport[] = [];
  for (const a of store.answers) {
    const res = await recheckEvidence(verifier, a.title, a.body, a.evidence, a.confidence === "inferred" ? "inferred" : "observed");
    if (res.broken) broken.push({ doc: "answers", section: "answers", id: a.id, title: a.question, problems: res.broken });
    else if (res.changed.length) changed.push({ doc: "answers", section: "answers", id: a.id, title: a.question, problems: res.changed });
  }
  return { broken, changed, total: store.answers.length };
}
