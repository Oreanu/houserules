import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { Analysis } from "../types.js";

// House rules the code must pass. Guidelines say "tell the owning model to change state"; a rule makes that
// checkable: in these files, this pattern must not (or must) appear. A rule is only accepted if it describes
// how the code is written today, and the few places that already break it are recorded as a baseline, so
// checks in CI and in an agent's own work flag only what's new.

export interface RuleInput {
  title: string; // the rule as a sentence: "Change order status through Order methods, not by assigning status"
  why?: string; // one line: what goes wrong otherwise
  guideline?: string; // the doc item it enforces: "guidelines/patterns/<item id>"
  files: string[]; // globs the rule applies to: "Modules/**/app/**/*.php"
  except?: string[]; // globs it doesn't apply to: "app/Models/**", "**/tests/**"
  forbid?: string; // regex a line must not match
  require?: string; // regex each matching file must contain somewhere
  fix?: string; // how to do it the house way instead
  severity?: "error" | "warning";
}

export interface Rule extends RuleInput {
  id: string;
  severity: "error" | "warning";
  baseline: string[]; // fingerprints of violations that existed when the rule was accepted
  files_checked: number;
  createdAt: string;
}

export interface RuleStore {
  version: 1;
  rules: Rule[];
}

export interface Violation {
  path: string;
  line: number;
  text: string; // the offending line, trimmed (empty for a missing `require`)
  isNew: boolean; // not in the baseline
}

export interface RuleResult {
  rule: Rule;
  violations: Violation[];
}

const storePath = (root: string) => path.join(root, ".houserules", "rules.json");

export async function readRules(rootDir: string): Promise<RuleStore> {
  try {
    const s = JSON.parse(await readFile(storePath(path.resolve(rootDir)), "utf8")) as RuleStore;
    if (s.version === 1 && Array.isArray(s.rules)) return s;
  } catch {
    // no rules yet
  }
  return { version: 1, rules: [] };
}

/** "Modules/**\/app/**\/*.php" → RegExp over repo-relative paths. Supports **, *, ? and {a,b}. */
export function globToRegExp(glob: string): RegExp {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]!;
    if (c === "*" && glob[i + 1] === "*") {
      const slash = glob[i + 2] === "/";
      re += slash ? "(?:.*/)?" : ".*";
      i += slash ? 2 : 1;
    } else if (c === "*") re += "[^/]*";
    else if (c === "?") re += "[^/]";
    else if (c === "{") {
      const end = glob.indexOf("}", i);
      if (end < 0) re += "\\{";
      else {
        re += `(?:${glob.slice(i + 1, end).split(",").map((p) => p.replace(/[.+^$()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*")).join("|")})`;
        i = end;
      }
    } else re += c.replace(/[.+^$()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${re}$`);
}

const fingerprint = (p: string, text: string) => `${p}::${createHash("sha256").update(text.replace(/\s+/g, " ").trim()).digest("hex").slice(0, 16)}`;

function compile(pattern: string | undefined, what: string, problems: string[]): RegExp | undefined {
  if (!pattern) return undefined;
  try {
    return new RegExp(pattern, "m");
  } catch (e) {
    problems.push(`${what} isn't a valid regular expression: ${e instanceof Error ? e.message : e}`);
    return undefined;
  }
}

function filesFor(rule: RuleInput, all: string[]): string[] {
  const inc = rule.files.map(globToRegExp);
  const exc = (rule.except ?? []).map(globToRegExp);
  return all.filter((f) => inc.some((r) => r.test(f)) && !exc.some((r) => r.test(f)));
}

async function violationsOf(root: string, rule: RuleInput, files: string[], baseline: Set<string>): Promise<Violation[]> {
  const problems: string[] = [];
  const forbid = compile(rule.forbid, "forbid", problems);
  const require = compile(rule.require, "require", problems);
  const out: Violation[] = [];
  for (const f of files) {
    let text: string;
    try {
      text = await readFile(path.join(root, f), "utf8");
    } catch {
      continue;
    }
    if (text.length > 1_500_000) continue;
    if (forbid) {
      text.split(/\r?\n/).forEach((line, i) => {
        if (forbid.test(line)) out.push({ path: f, line: i + 1, text: line.trim().slice(0, 200), isNew: !baseline.has(fingerprint(f, line)) });
      });
    }
    if (require && !require.test(text)) out.push({ path: f, line: 1, text: "", isNew: !baseline.has(`${f}::missing`) });
  }
  return out;
}

/**
 * Verifies and stores rules (merged by title). A rule is rejected if it doesn't compile, matches no files, or
 * doesn't describe today's code (too many places already break it: then it isn't a house rule yet).
 */
export async function submitRules(rootDir: string, analysis: Analysis, inputs: RuleInput[]): Promise<{ accepted: { id: string; title: string; files: number; grandfathered: number }[]; rejected: { title: string; problems: string[] }[] }> {
  const root = path.resolve(rootDir);
  const all = analysis.files.map((f) => f.path);
  const store = await readRules(root);
  const accepted: { id: string; title: string; files: number; grandfathered: number }[] = [];
  const rejected: { title: string; problems: string[] }[] = [];
  for (const input of inputs) {
    const problems: string[] = [];
    const title = (input.title ?? "").trim();
    if (title.length < 10) problems.push("State the rule as a sentence a reviewer would say.");
    if (!input.files?.length) problems.push("Say which files it applies to (globs such as Modules/**/app/**/*.php).");
    if (!input.forbid && !input.require) problems.push("Give a `forbid` pattern (a line must not match) or a `require` pattern (each file must contain it).");
    compile(input.forbid, "forbid", problems);
    compile(input.require, "require", problems);
    const files = problems.length ? [] : filesFor(input, all);
    if (!problems.length && !files.length) problems.push(`No files match ${input.files.join(", ")}${input.except?.length ? ` (except ${input.except.join(", ")})` : ""}.`);
    let found: Violation[] = [];
    if (!problems.length) {
      found = await violationsOf(root, input, files, new Set());
      const allowed = Math.max(5, Math.ceil(files.length * 0.05));
      if (found.length > allowed)
        problems.push(
          `${found.length} places in ${files.length} files already break it, so it isn't how this code is written today. Narrow the files or the pattern. For example: ${found
            .slice(0, 3)
            .map((v) => `${v.path}:${v.line}`)
            .join(", ")}`,
        );
    }
    if (problems.length) {
      rejected.push({ title: title || "(untitled)", problems });
      continue;
    }
    const id = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
    const rule: Rule = {
      ...input,
      title,
      id,
      severity: input.severity ?? "error",
      baseline: found.map((v) => (v.text ? fingerprint(v.path, v.text) : `${v.path}::missing`)),
      files_checked: files.length,
      createdAt: new Date().toISOString(),
    };
    store.rules = [...store.rules.filter((r) => r.id !== id), rule];
    accepted.push({ id, title, files: files.length, grandfathered: found.length });
  }
  await mkdir(path.dirname(storePath(root)), { recursive: true });
  await writeFile(storePath(root), JSON.stringify(store, null, 2) + "\n");
  return { accepted, rejected };
}

/** Runs every rule over `files` (default: all scanned files). New violations are the ones a change introduced. */
export async function checkRules(rootDir: string, analysis: Analysis, opts: { files?: string[] } = {}): Promise<RuleResult[]> {
  const root = path.resolve(rootDir);
  const { rules } = await readRules(root);
  const scope = opts.files ? new Set(opts.files) : undefined;
  const all = analysis.files.map((f) => f.path).filter((f) => !scope || scope.has(f));
  const out: RuleResult[] = [];
  for (const rule of rules) {
    const violations = await violationsOf(root, rule, filesFor(rule, all), new Set(rule.baseline));
    out.push({ rule, violations });
  }
  return out;
}

const run = promisify(execFile);

/** Files changed against a base ref (for PRs), or uncommitted changes when no base is given. Null outside git. */
export async function changedFiles(rootDir: string, base?: string): Promise<string[] | null> {
  const root = path.resolve(rootDir);
  try {
    const git = (args: string[]) => run("git", args, { cwd: root, maxBuffer: 16 * 1024 * 1024 }).then((r) => r.stdout.split("\n").filter(Boolean));
    const files = base ? await git(["diff", "--name-only", `${base}...HEAD`]) : [...(await git(["diff", "--name-only", "HEAD"])), ...(await git(["ls-files", "--others", "--exclude-standard"]))];
    return [...new Set(files)];
  } catch {
    return null;
  }
}
