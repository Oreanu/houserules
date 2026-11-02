import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Analysis } from "../types.js";
import { buildSymbolIndex } from "../symbols/index.js";
import { DOC_SPECS, sectionSpec, type DocId } from "./spec.js";
import { Verifier, type Evidence, type Item, type ItemInput } from "./verify.js";

export const DOCS_STORE = "docs.json"; // in .houserules/, committed: it's the source the markdown is rendered from
const STORE_VERSION = 1;

export interface SectionState {
  items: Item[];
  updatedAt: string;
}

export interface DocStore {
  version: number;
  docs: Partial<Record<DocId, { sections: Record<string, SectionState> }>>;
}

export function storePath(rootDir: string): string {
  return path.join(path.resolve(rootDir), ".houserules", DOCS_STORE);
}

export async function readStore(rootDir: string): Promise<DocStore> {
  try {
    const store = JSON.parse(await readFile(storePath(rootDir), "utf8")) as DocStore;
    if (store.version === STORE_VERSION) return store;
  } catch {
    // fall through to an empty store
  }
  return { version: STORE_VERSION, docs: {} };
}

export async function writeStore(rootDir: string, store: DocStore): Promise<void> {
  const file = storePath(rootDir);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(store, null, 2)}\n`);
}

export interface SubmitResult {
  doc: string;
  section: string;
  accepted: { index: number; id: string; title: string; confidence: Item["confidence"] }[];
  rejected: { index: number; title: string; problems: string[] }[];
  notes: string[];
}

/**
 * Verifies a section's items and stores the ones that pass, replacing whatever the section held.
 * Rejected items are returned with reasons so the agent can fix and resubmit.
 */
export async function submitSection(rootDir: string, analysis: Analysis, doc: string, section: string, inputs: ItemInput[]): Promise<SubmitResult> {
  const spec = sectionSpec(doc, section);
  if (!spec) {
    const known = DOC_SPECS.map((d) => `${d.id}: ${d.sections.map((s) => s.id).join(", ")}`).join("; ");
    throw new Error(`Unknown section "${doc}/${section}". Known sections: ${known}`);
  }
  const root = path.resolve(rootDir);
  const verifier = new Verifier(root, await buildSymbolIndex(root, analysis));
  const result: SubmitResult = { doc, section, accepted: [], rejected: [], notes: [] };
  const items: Item[] = [];
  const ids = new Set<string>();

  for (const [index, input] of inputs.slice(0, spec.maxItems).entries()) {
    let id = slugify(input.title) || `item-${index + 1}`;
    for (let n = 2; ids.has(id); n++) id = `${slugify(input.title)}-${n}`;
    const verified = await verifier.verify(input, id);
    const problems = [...verified.problems, ...(section === "diagrams" ? checkDiagram(input.body) : [])];
    const item = problems.length ? undefined : verified.item;
    if (item) {
      ids.add(id);
      items.push(item);
      result.accepted.push({ index, id, title: item.title, confidence: item.confidence });
    } else {
      result.rejected.push({ index, title: input.title, problems });
    }
  }
  if (inputs.length > spec.maxItems) result.notes.push(`Only the first ${spec.maxItems} items were considered; this section is capped to keep the doc readable.`);
  if (items.length < spec.minItems) result.notes.push(`This section needs at least ${spec.minItems} accepted item(s).`);
  if (result.rejected.length) result.notes.push("Fix the rejected items and resubmit the whole section (accepted items included); a submit replaces the section.");

  const store = await readStore(root);
  const docState = (store.docs[doc as DocId] ??= { sections: {} });
  docState.sections[section] = { items, updatedAt: new Date().toISOString() };
  await writeStore(root, store);
  return result;
}

export interface DocStatus {
  doc: DocId;
  sections: { id: string; title: string; items: number; minItems: number; maxItems: number; updatedAt: string | null }[];
}

export function docStatus(store: DocStore): DocStatus[] {
  return DOC_SPECS.map((d) => ({
    doc: d.id,
    sections: d.sections.map((s) => {
      const state = store.docs[d.id]?.sections[s.id];
      return { id: s.id, title: s.title, items: state?.items.length ?? 0, minItems: s.minItems, maxItems: s.maxItems, updatedAt: state?.updatedAt ?? null };
    }),
  }));
}

export interface StaleReport {
  doc: string;
  section: string;
  id: string;
  title: string;
  problems: string[];
}

/** Re-checks every stored item against the current code: broken evidence and changed files. */
export async function recheckStore(rootDir: string, analysis: Analysis): Promise<{ broken: StaleReport[]; changed: StaleReport[]; total: number }> {
  const root = path.resolve(rootDir);
  const store = await readStore(root);
  const verifier = new Verifier(root, await buildSymbolIndex(root, analysis));
  const broken: StaleReport[] = [];
  const changed: StaleReport[] = [];
  let total = 0;
  for (const [doc, state] of Object.entries(store.docs)) {
    for (const [section, { items }] of Object.entries(state?.sections ?? {})) {
      for (const item of items) {
        total++;
        const res = await recheckEvidence(verifier, item.title, item.body, item.evidence, item.confidence === "verified" ? "observed" : item.confidence);
        if (res.broken) broken.push({ doc, section, id: item.id, title: item.title, problems: res.broken });
        else if (res.changed.length) changed.push({ doc, section, id: item.id, title: item.title, problems: res.changed });
      }
    }
  }
  return { broken, changed, total };
}

/**
 * Re-verifies stored evidence against the code now. `broken`: it no longer checks out (file gone, symbol
 * missing). `changed`: it checks out but the cited lines were edited (lines that merely moved are fine).
 */
export async function recheckEvidence(verifier: Verifier, title: string, body: string, evidence: Evidence[], confidence: ItemInput["confidence"] = "observed"): Promise<{ broken?: string[]; changed: string[] }> {
  const input: ItemInput = { title, body, evidence: evidence.map(({ kind: _kind, sha256: _sha, snippetHash: _snip, ...ev }) => ev), confidence };
  const { item: now, problems } = await verifier.verify(input, "recheck");
  if (!now) return { broken: problems, changed: [] };
  const changed: string[] = [];
  for (const [i, e] of evidence.entries()) {
    const n = now.evidence[i];
    if (!n) continue;
    // Cited lines: only their content matters, and the same lines found elsewhere just moved.
    // Whole-file citations (and items written before snippet hashes existed) use the file hash.
    if (e.snippetHash && n.snippetHash && e.line) {
      if (e.snippetHash === n.snippetHash) continue;
      const length = (e.endLine ?? e.line) - e.line + 1;
      if (await verifier.locateSnippet(e.path, e.snippetHash, length)) continue;
      const range = e.endLine && e.endLine !== e.line ? `lines ${e.line}–${e.endLine}` : `line ${e.line}`;
      changed.push(`${range} of ${e.path} changed since this was written`);
    } else if (e.sha256 && n.sha256 !== e.sha256) {
      changed.push(`${e.path} changed since this was written`);
    }
  }
  return { changed };
}

const DIAGRAM_TYPES = ["journey", "stateDiagram-v2", "stateDiagram", "sequenceDiagram", "flowchart", "graph", "timeline", "erDiagram", "classDiagram"];

/** A diagram item must carry exactly one Mermaid block of a supported type. */
function checkDiagram(body: string): string[] {
  const blocks = [...(body ?? "").matchAll(/```mermaid\s*\n([\s\S]*?)```/g)];
  if (blocks.length !== 1) return ["diagram items need exactly one ```mermaid block"];
  const first = blocks[0]![1]!.trim().split(/\s/)[0] ?? "";
  if (!DIAGRAM_TYPES.includes(first)) return [`unsupported diagram type "${first}"; use one of ${DIAGRAM_TYPES.join(", ")}`];
  if (blocks[0]![1]!.trim().split("\n").length < 3) return ["the diagram is too small to be useful; show at least two steps or states"];
  return [];
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[`'"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}
