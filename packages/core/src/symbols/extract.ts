import { createRequire } from "node:module";
import path from "node:path";
import type { Language as TSLanguage, Node as TSNode, Parser as TSParser, Query as TSQuery } from "@vscode/tree-sitter-wasm";

export type SymbolKind = "function" | "class" | "interface" | "type" | "enum" | "method" | "variable" | "object";

export interface SymbolDef {
  name: string;
  kind: SymbolKind;
  line: number; // 1-based
  endLine: number;
  exported: boolean;
  container?: string; // enclosing class for methods, or the factory/object that owns an object member
}

type Grammar = "typescript" | "tsx" | "javascript" | "python" | "java" | "php";

const GRAMMAR_BY_EXT: Record<string, Grammar> = {
  ".ts": "typescript",
  ".mts": "typescript",
  ".cts": "typescript",
  ".tsx": "tsx",
  ".js": "javascript",
  ".jsx": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".py": "python",
  ".java": "java",
  ".php": "php",
};

// Each capture is named after the SymbolKind it defines; @name marks the identifier.
const TS_QUERY = `
(function_declaration name: (identifier) @name) @function
(generator_function_declaration name: (identifier) @name) @function
(class_declaration name: (type_identifier) @name) @class
(abstract_class_declaration name: (type_identifier) @name) @class
(interface_declaration name: (type_identifier) @name) @interface
(type_alias_declaration name: (type_identifier) @name) @type
(enum_declaration name: (identifier) @name) @enum
(method_definition name: (property_identifier) @name) @method
(lexical_declaration (variable_declarator name: (identifier) @name value: [(arrow_function) (function_expression)])) @function
(lexical_declaration (variable_declarator name: (identifier) @name)) @variable
(pair key: (property_identifier) @name value: [(arrow_function) (function_expression)]) @method
(public_field_definition name: (property_identifier) @name value: [(arrow_function) (function_expression)]) @method
`;

const JS_QUERY = `
(function_declaration name: (identifier) @name) @function
(generator_function_declaration name: (identifier) @name) @function
(class_declaration name: (identifier) @name) @class
(method_definition name: (property_identifier) @name) @method
(lexical_declaration (variable_declarator name: (identifier) @name value: [(arrow_function) (function_expression)])) @function
(lexical_declaration (variable_declarator name: (identifier) @name)) @variable
(pair key: (property_identifier) @name value: [(arrow_function) (function_expression)]) @method
(field_definition property: (property_identifier) @name value: [(arrow_function) (function_expression)]) @method
`;

const PY_QUERY = `
(function_definition name: (identifier) @name) @function
(class_definition name: (identifier) @name) @class
(module (expression_statement (assignment left: (identifier) @name)) @variable)
`;

const JAVA_QUERY = `
(class_declaration name: (identifier) @name) @class
(record_declaration name: (identifier) @name) @class
(interface_declaration name: (identifier) @name) @interface
(annotation_type_declaration name: (identifier) @name) @interface
(enum_declaration name: (identifier) @name) @enum
(method_declaration name: (identifier) @name) @method
`;

const PHP_QUERY = `
(function_definition name: (name) @name) @function
(class_declaration name: (name) @name) @class
(interface_declaration name: (name) @name) @interface
(trait_declaration name: (name) @name) @class
(enum_declaration name: (name) @name) @enum
(method_declaration name: (name) @name) @method
`;

const QUERIES: Record<Grammar, string> = { typescript: TS_QUERY, tsx: TS_QUERY, javascript: JS_QUERY, python: PY_QUERY, java: JAVA_QUERY, php: PHP_QUERY };
const CLASS_LIKE = new Set(["class_declaration", "abstract_class_declaration", "class_definition", "interface_declaration", "enum_declaration", "record_declaration", "class", "trait_declaration"]);

interface Loaded {
  parser: TSParser;
  query: TSQuery;
}

let runtime: Promise<typeof import("@vscode/tree-sitter-wasm")> | null = null;
const grammars = new Map<Grammar, Promise<Loaded>>();

async function load(grammar: Grammar): Promise<Loaded> {
  let pending = grammars.get(grammar);
  if (!pending) {
    pending = (async () => {
      const require = createRequire(import.meta.url);
      runtime ??= (async () => {
        const mod = require("@vscode/tree-sitter-wasm") as typeof import("@vscode/tree-sitter-wasm");
        await mod.Parser.init();
        return mod;
      })();
      const ts = await runtime;
      const dir = path.dirname(require.resolve("@vscode/tree-sitter-wasm"));
      const language: TSLanguage = await ts.Language.load(path.join(dir, `tree-sitter-${grammar}.wasm`));
      const parser = new ts.Parser();
      parser.setLanguage(language);
      return { parser, query: new ts.Query(language, QUERIES[grammar]) };
    })();
    grammars.set(grammar, pending);
  }
  return pending;
}

/** A parsed syntax tree for files tree-sitter can read; the caller must `delete()` it. */
export async function parseTree(rel: string, text: string) {
  const grammar = GRAMMAR_BY_EXT[path.extname(rel).toLowerCase()];
  if (!grammar) return null;
  const { parser } = await load(grammar);
  return parser.parse(text);
}

export function canExtract(rel: string): boolean {
  const ext = path.extname(rel).toLowerCase();
  return ext in GRAMMAR_BY_EXT || ext === ".kt" || ext === ".kts";
}

export async function extractSymbols(rel: string, text: string): Promise<SymbolDef[]> {
  const ext = path.extname(rel).toLowerCase();
  if (ext === ".kt" || ext === ".kts") return kotlinSymbols(text);
  const grammar = GRAMMAR_BY_EXT[ext];
  if (!grammar) return [];

  const { parser, query } = await load(grammar);
  const tree = parser.parse(text);
  if (!tree) return [];
  try {
    const seen = new Map<string, SymbolDef>();
    for (const match of query.matches(tree.rootNode)) {
      const def = match.captures.find((c) => c.name !== "name");
      const name = match.captures.find((c) => c.name === "name");
      if (!def || !name) continue;
      const kind = def.name as SymbolKind;
      const node = def.node;
      if (kind === "variable" && !isTopLevel(node)) continue;
      // Object members belong to the factory or object that owns them (`createCheckout` → `{ forCart() {} }`),
      // so `createCheckout.forCart` names one function even when several factories share method names.
      const owner = /^(pair|method_definition)$/.test(node.type) ? objectOwner(node) : undefined;
      if (/^(pair|public_field_definition|field_definition)$/.test(node.type) && !isRequestHandler(node) && !owner) continue;

      const container = enclosingClass(node) ?? owner;
      const sym: SymbolDef = {
        name: name.node.text,
        kind: kind === "function" && container && grammar === "python" ? "method" : kind,
        line: node.startPosition.row + 1,
        endLine: node.endPosition.row + 1,
        exported: isExported(node, name.node.text, grammar),
        ...(container ? { container } : {}),
      };
      // `const f = () => …` matches both the function and variable patterns; keep the more specific one.
      const key = `${sym.line}:${sym.name}`;
      if (!seen.has(key) || seen.get(key)!.kind === "variable") seen.set(key, sym);
    }
    return [...seen.values()].sort((a, b) => a.line - b.line);
  } finally {
    tree.delete();
  }
}

/**
 * `route: async (req, res) => …` in a returned object, or `route = async (req, res) => …` as a class field: a
 * request handler written as an arrow function. Only these become symbols; other object callbacks
 * (`{ onError: () => … }`) stay part of the function around them, so its calls aren't split off.
 */
function isRequestHandler(node: TSNode): boolean {
  const fn = node.childForFieldName("value");
  const params = fn?.childForFieldName("parameters") ?? fn?.childForFieldName("parameter");
  const first = (params?.type === "identifier" ? params : params?.namedChildren[0])?.text ?? "";
  return /^(_?req|request|ctx|context|c)\b/.test(first.replace(/^\{.*$/s, ""));
}

/**
 * The top-level name that owns an object member: the variable an object literal is assigned to
 * (`export const controller = { list() {} }`), or the function that returns it, directly or through
 * `Object.freeze(…)` (`const createCheckout = (deps) => Object.freeze({ forCart() {} })`). Objects anywhere else
 * (arguments, nested objects, class bodies) have no owner, so callbacks stay part of the function around them.
 */
export function objectOwner(node: TSNode): string | undefined {
  const obj = node.parent;
  if (obj?.type !== "object") return undefined;
  let child: TSNode = obj;
  for (let p = obj.parent; p; child = p, p = p.parent) {
    switch (p.type) {
      case "parenthesized_expression":
      case "as_expression":
      case "satisfies_expression":
      case "non_null_expression":
      case "return_statement":
        continue;
      case "arguments": {
        const call = p.parent;
        if (call?.type !== "call_expression" || !/^Object\.(freeze|seal|assign)$/.test(call.childForFieldName("function")?.text ?? "")) return undefined;
        continue;
      }
      case "call_expression":
        continue; // reached through the Object.freeze arguments above
      case "statement_block":
        // Only a function's own body, and only through its `return`.
        if (child.type !== "return_statement" || !/^(arrow_function|function_expression|function|function_declaration|generator_function_declaration)$/.test(p.parent?.type ?? "")) return undefined;
        continue;
      case "arrow_function":
      case "function_expression":
      case "function":
        if (p.childForFieldName("body")?.startIndex !== child.startIndex) return undefined;
        continue;
      case "function_declaration":
      case "generator_function_declaration":
        return isTopLevel(p) ? p.childForFieldName("name")?.text : undefined;
      case "variable_declarator": {
        if (p.childForFieldName("value")?.startIndex !== child.startIndex) return undefined;
        const decl = p.parent;
        const name = p.childForFieldName("name");
        if (decl && isTopLevel(decl)) return name?.type === "identifier" ? name.text : undefined;
        // `const services: CommandServices = { send: async (…) => … }` inside a factory: a typed object is an
        // implementation, owned by the factory that builds it. Untyped local objects (options, callbacks) are not.
        return p.childForFieldName("type") ? factoryName(p) : undefined;
      }
      default:
        return undefined;
    }
  }
  return undefined;
}

/** The top-level function a node sits in: `function createX() {…}` or `const createX = (…) => {…}`. */
function factoryName(node: TSNode): string | undefined {
  let fn: TSNode | null = null;
  for (let p = node.parent; p; p = p.parent) if (/^(arrow_function|function_expression|function|function_declaration|generator_function_declaration)$/.test(p.type)) fn = p;
  if (!fn) return undefined;
  if (/^(function_declaration|generator_function_declaration)$/.test(fn.type)) return isTopLevel(fn) ? fn.childForFieldName("name")?.text : undefined;
  const decl = fn.parent?.type === "variable_declarator" ? fn.parent : null;
  return decl?.parent && isTopLevel(decl.parent) && decl.childForFieldName("name")?.type === "identifier" ? decl.childForFieldName("name")!.text : undefined;
}

function isTopLevel(node: TSNode): boolean {
  const parent = node.parent;
  return !parent || parent.type === "program" || parent.type === "module" || parent.type === "export_statement";
}

function enclosingClass(node: TSNode): string | undefined {
  for (let p = node.parent; p; p = p.parent) {
    if (CLASS_LIKE.has(p.type)) return p.childForFieldName("name")?.text;
  }
  return undefined;
}

function isExported(node: TSNode, name: string, grammar: Grammar): boolean {
  if (grammar === "python") return !name.startsWith("_");
  if (grammar === "php") return !/^\s*(?:#\[[^\]]*\]\s*)*(?:(?:abstract|final|static|readonly)\s+)*(?:private|protected)\b/.test(node.text.slice(0, 300));
  if (grammar === "java") return /^\s*(@[\w.]+(\([^)]*\))?\s*)*public\b/.test(node.text.slice(0, 300));
  for (let p = node.parent; p && p.type !== "program"; p = p.parent) {
    if (p.type === "export_statement") return true;
  }
  return false;
}

// No Kotlin grammar ships with the WASM bundle, so a line-based pattern covers declarations.
const KOTLIN_DECL =
  /^([ \t]*)(?:@[\w.]+(?:\([^)]*\))?\s+)*((?:(?:public|private|internal|protected|open|abstract|final|data|sealed|enum|annotation|inner|override|suspend|inline|operator|infix|tailrec|const|lateinit|value)\s+)*)(class|interface|object|fun|val|var|typealias)\s+(?:<[^>]*>\s*)?(?:[\w.<>?]+\.)?(\w+)/gm;

function kotlinSymbols(text: string): SymbolDef[] {
  const out: SymbolDef[] = [];
  const lineStarts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === "\n") lineStarts.push(i + 1);
  const lineOf = (offset: number) => {
    let lo = 0;
    let hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lineStarts[mid]! <= offset) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  };
  const classes: { name: string; indent: number }[] = [];
  for (const m of text.matchAll(KOTLIN_DECL)) {
    const indent = m[1]!.length;
    const modifiers = m[2]!;
    const keyword = m[3]!;
    const name = m[4]!;
    while (classes.length && classes[classes.length - 1]!.indent >= indent) classes.pop();
    // Members of a class are indented; top-level vals/vars only count when not indented.
    if ((keyword === "val" || keyword === "var") && indent > 0) continue;
    const container = classes[classes.length - 1]?.name;
    const kind: SymbolKind =
      keyword === "fun" ? (container ? "method" : "function") : keyword === "interface" ? "interface" : keyword === "object" ? "object" : keyword === "typealias" ? "type" : keyword === "class" ? (modifiers.includes("enum") ? "enum" : "class") : "variable";
    const line = lineOf(m.index! + m[0].length - name.length); // the name's line, not a preceding annotation
    out.push({ name, kind, line, endLine: line, exported: !/\b(private|internal)\b/.test(modifiers), ...(container ? { container } : {}) });
    if (keyword === "class" || keyword === "interface" || keyword === "object") classes.push({ name, indent });
  }
  return out;
}
