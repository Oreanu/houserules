import assert from "node:assert/strict";
import { test } from "node:test";
import { extractSymbols } from "./extract.js";

const brief = (syms: { name: string; kind: string; line: number; exported: boolean; container?: string }[]) =>
  syms.map((s) => `${s.line} ${s.kind} ${s.container ? `${s.container}.` : ""}${s.name}${s.exported ? " exported" : ""}`);

test("TypeScript: functions, arrow consts, classes, methods, types; top-level vars only", async () => {
  const src = [
    "export function createUser(name: string) {", // 1
    "  const local = 1;", // 2
    "  return name;", // 3
    "}", // 4
    "export const getUser = async (id: string) => id;", // 5
    "const LIMIT = 10;", // 6
    "export class UserService {", // 7
    "  find(id: string) { return id; }", // 8
    "}", // 9
    "export interface User { id: string }", // 10
    "type Role = 'admin' | 'member';", // 11
    "export enum Status { Active }", // 12
  ].join("\n");
  assert.deepEqual(brief(await extractSymbols("src/users.ts", src)), [
    "1 function createUser exported",
    "5 function getUser exported",
    "6 variable LIMIT",
    "7 class UserService exported",
    "8 method UserService.find exported",
    "10 interface User exported",
    "11 type Role",
    "12 enum Status exported",
  ]);
});

test("TSX and JavaScript parse with their own grammars", async () => {
  assert.deepEqual(brief(await extractSymbols("a.tsx", "export default function Page() { return <div/>; }\n")), ["1 function Page exported"]);
  assert.deepEqual(brief(await extractSymbols("a.js", "class Cart { add() {} }\nmodule.exports = { Cart };\n")), ["1 class Cart", "1 method Cart.add"]);
});

test("Python: classes, methods, functions, module constants; underscore means private", async () => {
  const src = "TIMEOUT = 5\n\nclass Order:\n    def total(self):\n        x = 1\n        return x\n\ndef _helper():\n    pass\n";
  assert.deepEqual(brief(await extractSymbols("shop/models.py", src)), ["1 variable TIMEOUT exported", "3 class Order exported", "4 method Order.total exported", "8 function _helper"]);
});

test("Java: classes and methods, exported when public", async () => {
  const src = "package a;\n\n@Service\npublic class Billing {\n  @Transactional\n  public void charge() {}\n  private int fee() { return 1; }\n}\n";
  assert.deepEqual(brief(await extractSymbols("Billing.java", src)), ["3 class Billing exported", "5 method Billing.charge exported", "7 method Billing.fee"]);
});

test("Kotlin: regex fallback for classes, functions and members", async () => {
  const src = "package blog\n\n@Controller\nclass HtmlController(private val repo: Repo) {\n  fun blog(): String = \"blog\"\n  private fun render() {}\n}\n\nfun main() {}\n";
  assert.deepEqual(brief(await extractSymbols("Blog.kt", src)), ["4 class HtmlController exported", "5 method HtmlController.blog exported", "6 method HtmlController.render", "9 function main exported"]);
});
