import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Analysis } from "../types.js";
import { isTestFile } from "../scan/tooling.js";
import { walk } from "../scan/walk.js";

export interface EntityField {
  name: string;
  type: string;
  pk?: boolean;
  fk?: boolean;
}

export interface Entity {
  name: string;
  file: string;
  line: number;
  fields: EntityField[];
}

export type RelationKind = "one-to-many" | "many-to-one" | "one-to-one" | "many-to-many" | "extends";

export interface Relation {
  from: string;
  to: string;
  kind: RelationKind;
  label: string; // the field that holds it
}

export interface DataModel {
  source: "prisma" | "django" | "jpa" | "sql" | "typescript" | "none";
  entities: Entity[];
  relations: Relation[];
}

const MAX_FIELDS = 10;

/** Extracts the data model from the strongest source available: ORM schemas first, then SQL, then TS types. */
export async function dataModel(rootDir: string, a: Analysis): Promise<DataModel> {
  const root = path.resolve(rootDir);
  const read = async (rel: string) => {
    try {
      return await readFile(path.join(root, rel), "utf8");
    } catch {
      return "";
    }
  };
  const sources = a.files.filter((f) => !isTestFile(f.path));
  // Schema and SQL files aren't source files, so they're not in the analysis; walk once if needed.
  let walked: string[] | null = null;
  const findFiles = async (re: RegExp) => {
    walked ??= (await walk(root)).paths;
    return walked.filter((p) => re.test(p) && !/(^|\/)(test|tests|fixtures?|__tests__)\//.test(p));
  };

  // Every source the project has, then the richest one wins (a repo can have 4 Mongo documents
  // and a 70-table SQL schema; the schema is the real data model).
  const candidates: DataModel[] = [];
  const prismaFiles = await findFiles(/\.prisma$/);
  candidates.push({ source: "prisma", ...(await parseAll(prismaFiles, read, parsePrisma)) });

  const djangoFiles = sources.filter((f) => f.language === "python" && /(^|\/)models(\/[^/]+)?\.py$/.test(f.path)).map((f) => f.path);
  candidates.push({ source: "django", ...(await parseAll(djangoFiles, read, parseDjango)) });

  const javaFiles = sources.filter((f) => f.language === "java" || f.language === "kotlin").map((f) => f.path);
  candidates.push({ source: "jpa", ...(await parseAll(javaFiles, read, parseJpa)) });

  const sqlFiles = await findFiles(/\.sql$/);
  candidates.push({ source: "sql", ...(await parseAll(sqlFiles.slice(0, 30), read, parseSql)) });
  // ORM models beat raw SQL when they describe a comparable number of entities.
  const score = (m: DataModel) => m.entities.length * (m.source === "sql" ? 0.6 : 1) + m.relations.length * 0.5;
  const best = candidates.filter((c) => c.entities.length).sort((x, y) => score(y) - score(x))[0];
  if (best) return best;

  const typeFiles = sources.filter((f) => f.language === "typescript" && /(^|\/)(types?|models?|schema|domain)(\/[^/]+)?\.(ts|d\.ts)$/.test(f.path)).map((f) => f.path);
  const fromTs = await parseAll(typeFiles, read, parseTsTypes);
  if (fromTs.entities.length >= 3) return { source: "typescript", ...prune(fromTs) };

  return { source: "none", entities: [], relations: [] };
}

type Parser = (file: string, text: string) => { entities: Entity[]; relations: Relation[] };

async function parseAll(files: string[], read: (rel: string) => Promise<string>, parse: Parser): Promise<{ entities: Entity[]; relations: Relation[] }> {
  const entities: Entity[] = [];
  const relations: Relation[] = [];
  const byName = new Set<string>();
  for (const f of files) {
    const text = await read(f);
    if (text.length > 5_000_000) continue;
    const r = parse(f, text);
    // The same schema often exists per database (h2/mysql/postgres); keep the first definition.
    for (const e of r.entities) if (!byName.has(e.name.toLowerCase())) { byName.add(e.name.toLowerCase()); entities.push(e); }
    relations.push(...r.relations);
  }
  const names = new Set(entities.map((e) => e.name));
  const seen = new Set<string>();
  const rels = relations.filter((r) => {
    if (!names.has(r.to) || !names.has(r.from)) return false;
    const key = [r.from, r.to].sort().join("|") + r.kind.replace("many-to-one", "one-to-many");
    const back = [r.to, r.from].sort().join("|") + r.kind.replace("many-to-one", "one-to-many");
    if (seen.has(key) || seen.has(back)) return false;
    seen.add(key);
    return true;
  });
  return { entities, relations: rels };
}

const lineAt = (text: string, idx: number) => text.slice(0, idx).split("\n").length;

// ---------- Prisma ----------
function parsePrisma(file: string, text: string) {
  const entities: Entity[] = [];
  const relations: Relation[] = [];
  const models = [...text.matchAll(/^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm)];
  const modelNames = new Set(models.map((m) => m[1]!));
  for (const m of models) {
    const name = m[1]!;
    const fields: EntityField[] = [];
    for (const raw of m[2]!.split("\n")) {
      const line = raw.trim();
      const f = /^(\w+)\s+(\w+)(\[\])?(\?)?(.*)$/.exec(line);
      if (!f || line.startsWith("@@") || line.startsWith("//")) continue;
      const [, field, type, list, , rest] = f as unknown as [string, string, string, string | undefined, string | undefined, string];
      if (modelNames.has(type)) {
        relations.push({ from: name, to: type, kind: list ? "one-to-many" : /@relation\([^)]*fields:/.test(rest) ? "many-to-one" : "one-to-one", label: field });
        continue;
      }
      fields.push({ name: field, type: type + (list ? "[]" : ""), pk: /@id\b/.test(rest), fk: false });
    }
    // Mark foreign-key scalars (`authorId` next to `author Author @relation(fields: [authorId])`).
    for (const rf of m[2]!.matchAll(/fields:\s*\[([^\]]+)\]/g)) for (const k of rf[1]!.split(",").map((x) => x.trim())) { const f = fields.find((x) => x.name === k); if (f) f.fk = true; }
    entities.push({ name, file, line: lineAt(text, m.index!), fields: fields.slice(0, MAX_FIELDS) });
  }
  return { entities, relations };
}

// ---------- Django ----------
function parseDjango(file: string, text: string) {
  const entities: Entity[] = [];
  const relations: Relation[] = [];
  const classRe = /^class\s+(\w+)\s*\(([^)]*)\)\s*:/gm;
  const classes = [...text.matchAll(classRe)];
  for (const [i, c] of classes.entries()) {
    const name = c[1]!;
    const body = text.slice(c.index! + c[0].length, classes[i + 1]?.index ?? text.length).split(/\n(?=\S)/)[0]!;
    const fields: EntityField[] = [];
    for (const f of body.matchAll(/^\s{4}(\w+)\s*=\s*(?:models\.|modelcluster\.fields\.)?(\w*(?:Field|Key|ForeignKey))\(\s*(?:["']?([\w.]+)["']?)?/gm)) {
      const [, field, type, target] = f;
      if (/ForeignKey|ParentalKey/.test(type!)) relations.push({ from: name, to: lastPart(target), kind: "many-to-one", label: field! });
      else if (type === "OneToOneField") relations.push({ from: name, to: lastPart(target), kind: "one-to-one", label: field! });
      else if (/ManyToMany/.test(type!)) relations.push({ from: name, to: lastPart(target), kind: "many-to-many", label: field! });
      fields.push({ name: field!, type: type!.replace(/Field$/, ""), fk: /ForeignKey|OneToOne|ParentalKey/.test(type!) });
    }
    if (!fields.length) continue;
    for (const base of c[2]!.split(",").map((b) => b.trim().split(".").pop()!)) {
      if (base && classes.some((x) => x[1] === base)) relations.push({ from: name, to: base, kind: "extends", label: "extends" });
    }
    entities.push({ name, file, line: lineAt(text, c.index!), fields: fields.slice(0, MAX_FIELDS) });
  }
  return { entities, relations };
}

function lastPart(target: string | undefined): string {
  return (target ?? "").split(".").pop() ?? "";
}

// ---------- JPA ----------
function parseJpa(file: string, text: string) {
  const entities: Entity[] = [];
  const relations: Relation[] = [];
  if (!/@(Entity|MappedSuperclass|Table|Document)\b/.test(text)) return { entities, relations };
  if (!/@(Entity|MappedSuperclass|Document)\b/.test(text)) return { entities, relations };
  // The declaration itself, at the start of a line, so "a base class for…" in Javadoc doesn't match.
  const cls = /^[ \t]*(?:public\s+|protected\s+|abstract\s+|final\s+|open\s+|data\s+)*class\s+(\w+)(?:\s*\([^)]*\))?(?:\s+extends\s+(\w+))?/m.exec(text);
  if (!cls) return { entities, relations };
  const name = cls[1]!;
  const fields: EntityField[] = [];
  const fieldRe = /((?:@\w+(?:\([^)]*\))?\s*)*)(?:private|protected|public)\s+(?:final\s+)?([\w<>, ?]+?)\s+(\w+)\s*(?:=[^;]*)?;/g;
  for (const f of text.matchAll(fieldRe)) {
    const [, annotations, type, field] = f;
    if (/\bstatic\b/.test(f[0])) continue;
    const generic = /<\s*(\w+)\s*>/.exec(type!)?.[1];
    const target = generic ?? type!.trim();
    if (/@ManyToOne/.test(annotations!)) relations.push({ from: name, to: target, kind: "many-to-one", label: field! });
    else if (/@OneToMany/.test(annotations!)) relations.push({ from: name, to: target, kind: "one-to-many", label: field! });
    else if (/@OneToOne/.test(annotations!)) relations.push({ from: name, to: target, kind: "one-to-one", label: field! });
    else if (/@ManyToMany/.test(annotations!)) relations.push({ from: name, to: target, kind: "many-to-many", label: field! });
    else fields.push({ name: field!, type: type!.trim(), pk: /@Id\b/.test(annotations!) });
  }
  if (cls[2]) relations.push({ from: name, to: cls[2], kind: "extends", label: "extends" });
  entities.push({ name, file, line: lineAt(text, cls.index + cls[0].indexOf(name)), fields: fields.slice(0, MAX_FIELDS) });
  return { entities, relations };
}

// ---------- SQL ----------
function parseSql(file: string, text: string) {
  const entities: Entity[] = [];
  const relations: Relation[] = [];
  for (const t of text.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?[`"]?(\w+)[`"]?\s*\(([\s\S]*?)\)\s*(?:engine[^;]*)?;/gi)) {
    const name = t[1]!;
    const fields: EntityField[] = [];
    for (const raw of t[2]!.split(/,(?![^(]*\))/)) {
      const line = raw.trim();
      const fk = /foreign\s+key\s*\(\s*[`"]?(\w+)[`"]?\s*\)\s*references\s+[`"]?(\w+)/i.exec(line);
      if (fk) {
        relations.push({ from: name, to: fk[2]!, kind: "many-to-one", label: fk[1]! });
        const f = fields.find((x) => x.name === fk[1]);
        if (f) f.fk = true;
        continue;
      }
      const col = /^[`"]?(\w+)[`"]?\s+(\w+(?:\([^)]*\))?)(.*)$/i.exec(line);
      if (!col || /^(primary|unique|key|index|constraint|check)$/i.test(col[1]!)) continue;
      const ref = /references\s+[`"]?(\w+)/i.exec(col[3]!);
      if (ref) relations.push({ from: name, to: ref[1]!, kind: "many-to-one", label: col[1]! });
      fields.push({ name: col[1]!, type: col[2]!.toLowerCase(), pk: /primary\s+key/i.test(col[3]!), fk: Boolean(ref) });
    }
    entities.push({ name, file, line: lineAt(text, t.index!), fields: fields.slice(0, MAX_FIELDS), allFields: fields.map((f) => f.name) } as Entity);
  }
  // Many schemas declare no foreign keys and rely on naming (`product_id` -> `pms_product`).
  if (!relations.length) {
    const names = entities.map((e) => e.name);
    for (const e of entities) {
      for (const col of ((e as Entity & { allFields?: string[] }).allFields ?? [])) {
        const m = /^(\w+?)_id$/.exec(col);
        if (!m || col === "id") continue;
        const base = m[1]!;
        const target = names.find((n) => n === base || n === `${base}s`) ?? names.find((n) => n !== e.name && (n.endsWith(`_${base}`) || n.endsWith(`_${base}s`)) && !n.slice(0, -base.length - 1).includes("_"));
        if (target && target !== e.name) relations.push({ from: e.name, to: target, kind: "many-to-one", label: `${col} (inferred)` });
      }
    }
  }
  for (const e of entities) delete (e as Entity & { allFields?: string[] }).allFields;
  return { entities, relations };
}

// ---------- TypeScript domain types ----------
function parseTsTypes(file: string, text: string) {
  const entities: Entity[] = [];
  const relations: Relation[] = [];
  const decls = [...text.matchAll(/^export\s+(?:type\s+(\w+)\s*=\s*\{|interface\s+(\w+)(?:\s+extends\s+([\w, ]+))?\s*\{)/gm)];
  for (const d of decls) {
    const name = (d[1] ?? d[2])!;
    const start = d.index! + d[0].length;
    let depth = 1, i = start;
    while (i < text.length && depth > 0) { if (text[i] === "{") depth++; else if (text[i] === "}") depth--; i++; }
    const body = text.slice(start, i - 1);
    const fields: EntityField[] = [];
    for (const f of body.matchAll(/^\s{2,4}(\w+)\??\s*:\s*([^;\n]+)/gm)) {
      const type = f[2]!.trim().replace(/,$/, "");
      fields.push({ name: f[1]!, type: type.length > 28 ? `${type.slice(0, 26)}…` : type });
      for (const ref of type.matchAll(/\b([A-Z]\w+)(\[\])?/g)) {
        if (["Array", "Record", "Promise", "Date", "Partial", "Omit", "Pick", "Map", "Set"].includes(ref[1]!)) continue;
        const many = Boolean(ref[2]) || /Array<|Connection<|\[\]/.test(type);
        relations.push({ from: name, to: ref[1]!, kind: many ? "one-to-many" : "one-to-one", label: f[1]! });
      }
    }
    for (const base of (d[3] ?? "").split(",").map((b) => b.trim()).filter(Boolean)) relations.push({ from: name, to: base, kind: "extends", label: "extends" });
    if (fields.length) entities.push({ name, file, line: lineAt(text, d.index!), fields: fields.slice(0, MAX_FIELDS) });
  }
  return { entities, relations };
}

/** TS type files often hold dozens of helper types; keep the connected core so the diagram stays readable. */
function prune(m: { entities: Entity[]; relations: Relation[] }): { entities: Entity[]; relations: Relation[] } {
  const degree = new Map<string, number>();
  for (const r of m.relations) for (const n of [r.from, r.to]) degree.set(n, (degree.get(n) ?? 0) + 1);
  const keep = m.entities.filter((e) => (degree.get(e.name) ?? 0) > 0).sort((a, b) => (degree.get(b.name) ?? 0) - (degree.get(a.name) ?? 0)).slice(0, 14);
  const names = new Set(keep.map((e) => e.name));
  return { entities: keep, relations: m.relations.filter((r) => names.has(r.from) && names.has(r.to)) };
}

/** Mermaid erDiagram for markdown. */
export function dataModelMermaid(m: DataModel): string {
  const id = (s: string) => s.replace(/[^\w]/g, "_");
  const lines = ["erDiagram"];
  const card: Record<RelationKind, string> = { "one-to-many": "||--o{", "many-to-one": "}o--||", "one-to-one": "||--||", "many-to-many": "}o--o{", extends: "||--||" };
  for (const r of m.relations) lines.push(`  ${id(r.from)} ${card[r.kind]} ${id(r.to)} : "${r.kind === "extends" ? "extends" : r.label}"`);
  for (const e of m.entities) {
    lines.push(`  ${id(e.name)} {`);
    for (const f of e.fields.slice(0, 8)) lines.push(`    ${id(f.type.replace(/[<>\[\]|"']/g, "")) || "any"} ${id(f.name)}${f.pk ? " PK" : f.fk ? " FK" : ""}`);
    lines.push("  }");
  }
  return lines.join("\n");
}
