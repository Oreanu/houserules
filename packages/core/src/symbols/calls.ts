import path from "node:path";
import type { Node as TSNode } from "@vscode/tree-sitter-wasm";
import { parseTree } from "./extract.js";

/** A name a file imports: `import { a as b } from "./x"` binds local "b" to export "a" of "./x". */
export interface Binding {
  local: string;
  imported: string; // export name, "default", or "*" for a namespace/module import
  source: string; // the specifier as written ("./x", "lib/shopify", "app.services")
  line: number;
  reexport?: boolean; // `export { a } from "./x"` / `export * from "./x"`: forwards rather than uses
}

/** A call (or JSX render, or `new`) as written: `foo()`, `obj.foo()`, `<Foo/>`. */
export interface Call {
  callee: string; // "foo" or "obj.foo"
  line: number;
  kind: "call" | "render" | "new";
  cond?: string; // the branch it sits in, within its function: "if <condition>", "else", "match <subject>", "catch"
  end?: number; // where the call ends in the file: on one line, `a()->b()` runs a() (ends first) before b()
}

export interface FileCalls {
  bindings: Binding[];
  calls: Call[];
  defaultExport?: string; // name behind `export default` (JS/TS)
  returns?: { method: string; type: string }[]; // PHP: declared return types ("InvoiceRef.invoice" → "Invoice"), for chained calls
}

/** Imports and calls in one file, for building a function-level call graph. */
export async function extractCalls(rel: string, text: string): Promise<FileCalls> {
  const ext = path.extname(rel).toLowerCase();
  const tree = await parseTree(rel, text);
  if (!tree) return { bindings: [], calls: [] };
  try {
    const out: FileCalls = { bindings: [], calls: [] };
    const lang = ext === ".py" ? "python" : ext === ".java" ? "java" : ext === ".php" ? "php" : "js";
    fnTypeCache.clear();
    propCache.clear();
    chainCache.clear();
    walk(tree.rootNode, (n) => {
      const before = out.calls.length;
      visit(n, lang, out);
      const cond = out.calls.length > before ? branchOf(n) : undefined;
      if (cond) out.calls[before]!.cond = cond;
      if (out.calls.length > before) out.calls[before]!.end = n.endIndex;
    });
    return out;
  } finally {
    tree.delete();
  }
}

const FUNCTION_LIKE = /^(function_declaration|function_definition|function_expression|method_declaration|method_definition|arrow_function|anonymous_function|anonymous_function_creation_expression|arrow_function_expression|lambda|lambda_expression|constructor_declaration|class_body|declaration_list|program)$/;
const clip = (s: string) => s.replace(/^\(\s*|\s*\)$/g, "").replace(/\s+/g, " ").slice(0, 70);

/** The nearest branch around a call inside its own function, so a trace can say a step only runs sometimes. */
function branchOf(n: TSNode): string | undefined {
  let child = n;
  for (let p = n.parent; p && !FUNCTION_LIKE.test(p.type); child = p, p = p.parent) {
    const cond = p.childForFieldName("condition");
    if (cond && (cond.startIndex === child.startIndex || (child.startIndex >= cond.startIndex && child.endIndex <= cond.endIndex))) continue; // in the test itself: always runs
    switch (p.type) {
      case "if_statement":
      case "elif_clause":
      case "else_if_clause":
        if (p.childForFieldName("alternative")?.startIndex === child.startIndex) continue; // the else part is handled below
        return cond ? `if ${clip(cond.text)}` : undefined;
      case "else_clause":
        return "else";
      case "conditional_expression":
      case "ternary_expression":
        return cond ? `if ${clip(cond.text)}` : undefined;
      case "match_expression":
      case "switch_statement":
      case "switch_expression":
      case "match_statement": {
        const subject = p.childForFieldName("value") ?? p.childForFieldName("condition") ?? p.childForFieldName("subject");
        return subject ? `match ${clip(subject.text)}` : "match";
      }
      case "catch_clause":
      case "except_clause":
        return "catch";
    }
  }
  return undefined;
}

function walk(node: TSNode, fn: (n: TSNode) => void): void {
  fn(node);
  for (const c of node.namedChildren) if (c) walk(c, fn);
}

const line = (n: TSNode) => n.startPosition.row + 1;
const unquote = (s: string) => s.replace(/^['"`]|['"`]$/g, "");

/** "foo" or "obj.foo": the receiver and the final property are what resolution needs (`a.b.c()` → "b.c"). */
function calleeName(n: TSNode | null | undefined): string | null {
  if (!n) return null;
  if (n.type === "identifier" || n.type === "property_identifier" || n.type === "type_identifier") return n.text;
  if (n.type === "member_expression" || n.type === "attribute" || n.type === "nested_identifier") {
    const obj = n.childForFieldName("object") ?? n.namedChildren[0];
    const prop = n.childForFieldName("property") ?? n.childForFieldName("attribute") ?? n.namedChildren[n.namedChildren.length - 1];
    if (!prop) return null;
    const root = obj && (obj.type === "identifier" || obj.type === "this") ? obj.text : obj ? calleeName(obj)?.split(".").pop() : null;
    return root ? `${root}.${prop.text}` : prop.text;
  }
  if (n.type === "await_expression" || n.type === "parenthesized_expression") return calleeName(n.namedChildren[0]);
  return null;
}

const PHP_SCALAR = /^(int|integer|string|bool|boolean|float|double|array|mixed|void|null|callable|iterable|object|self|static|parent|never|false|true)$/i;
const short = (t: string) => t.replace(/^\\/, "").split("\\").pop()!;

/** The class a PHP type annotation names (`?Order`, `Order|null`, `\\App\\Models\\Order`), or null for scalars. */
function phpTypeName(t: TSNode | null | undefined): string | null {
  if (!t) return null;
  const names = t.text.replace(/^\?/, "").split(/[|&]/).map((x) => x.trim().replace(/^\?/, "")).filter((x) => x && !PHP_SCALAR.test(short(x)));
  return names.length === 1 ? short(names[0]!) : null;
}

function enclosing(n: TSNode, types: RegExp): TSNode | null {
  for (let p = n.parent; p; p = p.parent) if (types.test(p.type)) return p;
  return null;
}

const CONTAINER_CALL = /^(?:\\?app|\\?resolve)$/;
/** `X::class` as the first argument of app()/resolve()/App::make()/app()->make(): the class the container returns. */
function containerClass(call: TSNode): string | null {
  const args = call.childForFieldName("arguments");
  const first = args?.namedChildren.find((c) => c?.type === "argument")?.namedChildren[0] ?? args?.namedChildren[0];
  const m = first?.text.match(/^\\?([\w\\]+)::class$/);
  return m ? short(m[1]!) : null;
}

// Per-file caches (cleared for each file): a function's variable types and a class's property types are
// computed once, and a function being computed returns what it has so far, so `$a = $b->x()` can't recurse forever.
const fnTypeCache = new Map<number, Map<string, string>>();
const propCache = new Map<number, Map<string, string>>();

/** Variable → class inside one function: typed parameters, `$x = new X`, `$x = app(X::class)`. */
function functionTypes(fn: TSNode): Map<string, string> {
  const cached = fnTypeCache.get(fn.startIndex);
  if (cached) return cached;
  const out = new Map<string, string>();
  fnTypeCache.set(fn.startIndex, out);
  const params = fn.childForFieldName("parameters");
  for (const p of params?.namedChildren ?? []) {
    if (!p) continue;
    const name = p.childForFieldName("name")?.text.replace(/^\$/, "");
    const t = phpTypeName(p.childForFieldName("type"));
    if (name && t) out.set(name, t);
  }
  const body = fn.childForFieldName("body");
  const visit = (x: TSNode) => {
    if (x.type === "assignment_expression") {
      const left = x.childForFieldName("left"), right = x.childForFieldName("right");
      if (left?.type === "variable_name" && right) {
        const t = valueType(right) ?? (right.type === "member_call_expression" || right.type === "nullsafe_member_call_expression" ? chainType(right) : null);
        if (t) out.set(left.text.replace(/^\$/, ""), t);
      }
    }
    for (const c of x.namedChildren) if (c && !/^(anonymous_function|arrow_function|function_definition|method_declaration)/.test(c.type)) visit(c);
  };
  if (body) visit(body);
  return out;
}

/** Property → class for a PHP class: constructor-promoted and declared properties with a type. */
function classProps(cls: TSNode): Map<string, string> {
  const cached = propCache.get(cls.startIndex);
  if (cached) return cached;
  const out = new Map<string, string>();
  propCache.set(cls.startIndex, out);
  const body = cls.childForFieldName("body");
  for (const m of body?.namedChildren ?? []) {
    if (!m) continue;
    if (m.type === "property_declaration") {
      const t = phpTypeName(m.childForFieldName("type") ?? m.namedChildren.find((c) => c && /type$/.test(c.type)));
      if (t) for (const el of m.namedChildren) if (el?.type === "property_element") out.set(el.text.replace(/^\$/, "").replace(/\s*=.*$/s, ""), t);
    } else if (m.type === "method_declaration" && m.childForFieldName("name")?.text === "__construct") {
      for (const p of m.childForFieldName("parameters")?.namedChildren ?? []) {
        if (p?.type !== "property_promotion_parameter") continue;
        const name = p.childForFieldName("name")?.text.replace(/^\$/, "");
        const t = phpTypeName(p.childForFieldName("type"));
        if (name && t) out.set(name, t);
      }
    }
  }
  return out;
}

/** The class an expression evaluates to, when the code says so plainly. */
function valueType(v: TSNode): string | null {
  if (v.type === "object_creation_expression") {
    const c = v.namedChildren.find((x) => x?.type === "name" || x?.type === "qualified_name");
    return c ? short(c.text) : null;
  }
  if (v.type === "function_call_expression" && CONTAINER_CALL.test(v.childForFieldName("function")?.text ?? "")) return containerClass(v);
  if (v.type === "scoped_call_expression" && /^\\?App$/.test(v.childForFieldName("scope")?.text ?? "") && /^(make|makeWith|get)$/.test(v.childForFieldName("name")?.text ?? "")) return containerClass(v);
  if (v.type === "member_call_expression" && /^(make|makeWith)$/.test(v.childForFieldName("name")?.text ?? "") && CONTAINER_CALL.test(v.childForFieldName("object")?.text.replace(/\(\)$/, "") ?? "")) return containerClass(v);
  if (v.type === "parenthesized_expression") return v.namedChildren[0] ? valueType(v.namedChildren[0]) : null;
  return null;
}

/** The receiver's class for `$obj->m()`, `$this->prop->m()`, `app(X::class)->m()`, `(new X)->m()` and fluent chains. */
function phpType(obj: TSNode | null | undefined): string | null {
  if (!obj) return null;
  const direct = valueType(obj);
  if (direct) return direct;
  if (obj.type === "variable_name" && obj.text !== "$this") {
    const fn = enclosing(obj, /^(method_declaration|function_definition|anonymous_function|arrow_function)/);
    return fn ? (functionTypes(fn).get(obj.text.replace(/^\$/, "")) ?? null) : null;
  }
  if (obj.type === "member_access_expression" && obj.childForFieldName("object")?.text === "$this") {
    const cls = enclosing(obj, /^(class_declaration|trait_declaration)$/);
    const prop = obj.childForFieldName("name")?.text;
    return cls && prop ? (classProps(cls).get(prop) ?? null) : null;
  }
  // A call's result (`$this->ref->invoice()->recalculate()`): the graph looks up the declared return type of
  // InvoiceRef::invoice. Encoded without dots so the callee still splits at its last dot.
  if (obj.type === "member_call_expression" || obj.type === "nullsafe_member_call_expression") return chainType(obj);
  return null;
}

// Memoised by position: each link of a long chain (Pest's expect()->toBe()->and()…) is worked out once.
const chainCache = new Map<number, string | null>();

function chainType(call: TSNode): string | null {
  const key = call.startIndex * 31 + call.endIndex;
  if (chainCache.has(key)) return chainCache.get(key)!;
  chainCache.set(key, null);
  const name = call.childForFieldName("name")?.text;
  const inner = call.childForFieldName("object");
  const innerType = inner?.text === "$this" ? (enclosing(call, /^(class_declaration|trait_declaration)$/)?.childForFieldName("name")?.text ?? null) : phpType(inner);
  const out = name && innerType ? `ret(${innerType}|${name})` : null;
  chainCache.set(key, out);
  return out;
}

/** PHP receivers: `$this` and `self`/`static` mean the current class; `$this->repo` names the field. */
function phpReceiver(n: TSNode | null | undefined): string | null {
  if (!n) return null;
  const t = n.text.replace(/^\$/, "");
  if (n.type === "variable_name") return t === "this" ? "this" : t;
  if (n.type === "member_access_expression" || n.type === "nullsafe_member_access_expression") return n.childForFieldName("name")?.text ?? null;
  if (n.type === "relative_scope" || /^(self|static|parent)$/.test(t)) return "this";
  if (n.type === "name" || n.type === "qualified_name") return t.split("\\").pop()!;
  return null;
}

function visit(n: TSNode, lang: "js" | "python" | "java" | "php", out: FileCalls): void {
  if (lang === "php") {
    if (n.type === "namespace_use_declaration") {
      if (/^use\s+(function|const)\b/.test(n.text)) return;
      const m = n.text.match(/^use\s+\\?([\w\\]+?)(?:\\\{([^}]*)\})?\s*(?:as\s+(\w+))?\s*;/);
      if (!m) return;
      const add = (full: string, alias?: string) => out.bindings.push({ local: alias ?? full.split("\\").pop()!, imported: full.split("\\").pop()!, source: full, line: line(n) });
      if (m[2]) for (const part of m[2].split(",")) {
        const [name, alias] = part.trim().split(/\s+as\s+/);
        if (name) add(`${m[1]}\\${name.trim()}`, alias?.trim());
      }
      else add(m[1]!, m[3]);
    } else if (n.type === "function_call_expression") {
      const fn = n.childForFieldName("function");
      if (fn && (fn.type === "name" || fn.type === "qualified_name")) out.calls.push({ callee: fn.text.split("\\").pop()!, line: line(n), kind: "call" });
    } else if (n.type === "member_call_expression" || n.type === "nullsafe_member_call_expression" || n.type === "scoped_call_expression") {
      const name = n.childForFieldName("name")?.text;
      const obj = n.childForFieldName(n.type === "scoped_call_expression" ? "scope" : "object");
      // Prefer the receiver's class when the code says it: typed parameters and properties, `new X`,
      // app(X::class), fluent chains. `$gen->run()` then resolves to OrderGenerator::run, not a name guess.
      const typed = n.type === "scoped_call_expression" ? null : phpType(obj);
      const recv = typed ?? phpReceiver(obj);
      if (name) out.calls.push({ callee: recv ? `${recv}.${name}` : name, line: line(n), kind: "call" });
    } else if (n.type === "object_creation_expression") {
      const cls = n.namedChildren.find((c) => c?.type === "name" || c?.type === "qualified_name");
      if (cls) out.calls.push({ callee: cls.text.split("\\").pop()!, line: line(n), kind: "new" });
    } else if (n.type === "method_declaration") {
      const name = n.childForFieldName("name")?.text;
      const cls = enclosing(n, /^(class_declaration|trait_declaration|interface_declaration|enum_declaration)$/)?.childForFieldName("name")?.text;
      const rt = n.childForFieldName("return_type");
      const type = rt && /^\??(static|self|\$this)$/.test(rt.text.trim()) ? cls : phpTypeName(rt);
      if (name && cls && type) (out.returns ??= []).push({ method: `${cls}.${name}`, type });
    }
    return;
  }
  if (lang === "js") {
    if (n.type === "import_statement") {
      const src = n.childForFieldName("source");
      if (!src) return;
      const source = unquote(src.text);
      const clause = n.namedChildren.find((c) => c?.type === "import_clause");
      for (const c of clause?.namedChildren ?? []) {
        if (!c) continue;
        if (c.type === "identifier") out.bindings.push({ local: c.text, imported: "default", source, line: line(n) });
        else if (c.type === "namespace_import") {
          const id = c.namedChildren.find((x) => x?.type === "identifier");
          if (id) out.bindings.push({ local: id.text, imported: "*", source, line: line(n) });
        } else if (c.type === "named_imports") {
          for (const s of c.namedChildren) {
            if (s?.type !== "import_specifier") continue;
            const name = s.childForFieldName("name")?.text;
            const alias = s.childForFieldName("alias")?.text;
            if (name) out.bindings.push({ local: alias ?? name, imported: name, source, line: line(n) });
          }
        }
      }
    } else if (n.type === "export_statement") {
      const src = n.childForFieldName("source");
      if (!src) {
        if (/^export\s+default\b/.test(n.text)) {
          const decl = n.childForFieldName("declaration") ?? n.childForFieldName("value");
          const name = decl?.type === "identifier" ? decl.text : decl?.childForFieldName("name")?.text;
          if (name) out.defaultExport = name;
        }
        return;
      }
      const source = unquote(src.text);
      const clause = n.namedChildren.find((c) => c?.type === "export_clause");
      if (!clause) out.bindings.push({ local: "*", imported: "*", source, line: line(n), reexport: true });
      for (const s of clause?.namedChildren ?? []) {
        if (s?.type !== "export_specifier") continue;
        const name = s.childForFieldName("name")?.text;
        const alias = s.childForFieldName("alias")?.text;
        if (name) out.bindings.push({ local: alias ?? name, imported: name, source, line: line(n), reexport: true });
      }
    } else if (n.type === "variable_declarator" && n.childForFieldName("value")?.type === "call_expression") {
      // CommonJS: `const x = require("y")` and `const { a, b: c } = require("y")` bind like imports.
      const call = n.childForFieldName("value")!;
      const arg = call.childForFieldName("arguments")?.namedChildren[0];
      if (call.childForFieldName("function")?.text !== "require" || arg?.type !== "string") return;
      const source = unquote(arg.text);
      const name = n.childForFieldName("name");
      if (name?.type === "identifier") out.bindings.push({ local: name.text, imported: "*", source, line: line(n) });
      else if (name?.type === "object_pattern") {
        for (const p of name.namedChildren) {
          if (p?.type === "shorthand_property_identifier_pattern") out.bindings.push({ local: p.text, imported: p.text, source, line: line(n) });
          else if (p?.type === "pair_pattern") {
            const key = p.childForFieldName("key")?.text, val = p.childForFieldName("value")?.text;
            if (key && val) out.bindings.push({ local: val, imported: key, source, line: line(n) });
          }
        }
      }
    } else if (n.type === "call_expression") {
      const callee = calleeName(n.childForFieldName("function"));
      if (callee && callee !== "require" && callee !== "import") out.calls.push({ callee, line: line(n), kind: "call" });
    } else if (n.type === "new_expression") {
      const callee = calleeName(n.childForFieldName("constructor"));
      if (callee) out.calls.push({ callee, line: line(n), kind: "new" });
    } else if (n.type === "jsx_opening_element" || n.type === "jsx_self_closing_element") {
      const callee = calleeName(n.childForFieldName("name"));
      // Lower-case tags are HTML elements, not components.
      if (callee && /^[A-Z]/.test(callee.split(".").pop()!)) out.calls.push({ callee, line: line(n), kind: "render" });
    }
  } else if (lang === "python") {
    if (n.type === "import_from_statement") {
      const mod = n.childForFieldName("module_name")?.text ?? "";
      for (const c of n.namedChildren.slice(1)) {
        if (!c) continue;
        if (c.type === "dotted_name") out.bindings.push({ local: c.text.split(".").pop()!, imported: c.text, source: mod, line: line(n) });
        else if (c.type === "aliased_import") {
          const name = c.childForFieldName("name")?.text;
          const alias = c.childForFieldName("alias")?.text;
          if (name) out.bindings.push({ local: alias ?? name, imported: name, source: mod, line: line(n) });
        }
      }
    } else if (n.type === "import_statement") {
      for (const c of n.namedChildren) {
        if (c?.type === "dotted_name") out.bindings.push({ local: c.text.split(".")[0]!, imported: "*", source: c.text, line: line(n) });
        else if (c?.type === "aliased_import") {
          const name = c.childForFieldName("name")?.text;
          const alias = c.childForFieldName("alias")?.text;
          if (name && alias) out.bindings.push({ local: alias, imported: "*", source: name, line: line(n) });
        }
      }
    } else if (n.type === "call") {
      const callee = calleeName(n.childForFieldName("function"));
      if (callee) out.calls.push({ callee, line: line(n), kind: "call" });
    }
  } else {
    if (n.type === "import_declaration") {
      const name = n.namedChildren.find((c) => c?.type === "scoped_identifier" || c?.type === "identifier")?.text;
      if (name && !n.text.includes("*")) out.bindings.push({ local: name.split(".").pop()!, imported: name.split(".").pop()!, source: name, line: line(n) });
    } else if (n.type === "method_invocation") {
      const name = n.childForFieldName("name")?.text;
      const obj = n.childForFieldName("object");
      if (name) out.calls.push({ callee: obj && obj.type === "identifier" ? `${obj.text}.${name}` : name, line: line(n), kind: "call" });
    } else if (n.type === "object_creation_expression") {
      const t = n.childForFieldName("type")?.text;
      if (t) out.calls.push({ callee: t.replace(/<.*$/, ""), line: line(n), kind: "new" });
    }
  }
}
