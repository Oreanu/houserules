import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import type { ArchitectureMap } from "./architecture.js";

const run = promisify(execFile);

export interface TimelineEvent {
  date: string; // YYYY-MM-DD
  label: string;
  kind: "start" | "module" | "latest";
}

export interface Timeline {
  available: boolean;
  reason?: string; // why there's no timeline (not a git repo, shallow clone…)
  commits?: number;
  contributors?: number;
  events: TimelineEvent[];
}

async function git(root: string, args: string[], timeout = 8000): Promise<string> {
  const { stdout } = await run("git", ["-C", root, ...args], { timeout, maxBuffer: 8 * 1024 * 1024 });
  return stdout.trim();
}

/** How the codebase grew: first commit, when each module first appeared, and the latest commit. */
export async function timeline(rootDir: string, map: ArchitectureMap): Promise<Timeline> {
  const root = path.resolve(rootDir);
  try {
    if ((await git(root, ["rev-parse", "--is-inside-work-tree"])) !== "true") return { available: false, reason: "not a git repository", events: [] };
  } catch {
    return { available: false, reason: "not a git repository", events: [] };
  }
  try {
    if ((await git(root, ["rev-parse", "--is-shallow-repository"])) === "true") {
      return { available: false, reason: "this is a shallow clone, so the history isn't here (git fetch --unshallow fixes that)", events: [] };
    }
    const [count, authors, first, last] = await Promise.all([
      git(root, ["rev-list", "--count", "HEAD"]),
      git(root, ["shortlog", "-sne", "HEAD"]).catch(() => ""),
      git(root, ["log", "--reverse", "--format=%ad|%s", "--date=short", "--max-parents=0", "HEAD"]),
      git(root, ["log", "-1", "--format=%ad|%s", "--date=short"]),
    ]);
    const events: TimelineEvent[] = [];
    const [fd, fs] = first.split("\n")[0]!.split("|");
    events.push({ date: fd!, label: `First commit: ${fs ?? ""}`.trim(), kind: "start" });
    const born = await Promise.all(
      map.nodes
        .filter((n) => n.dir && !n.label.startsWith("("))
        .map(async (n) => {
          const out = await git(root, ["log", "--diff-filter=A", "--reverse", "--format=%ad", "--date=short", "--", n.dir]).catch(() => "");
          return { n, date: out.split("\n")[0] ?? "" };
        }),
    );
    for (const { n, date } of born) if (date && date !== fd) events.push({ date, label: `${n.label} added`, kind: "module" });
    const [ld, ls] = last.split("|");
    events.push({ date: ld!, label: `Latest: ${ls ?? ""}`.trim(), kind: "latest" });
    events.sort((a, b) => a.date.localeCompare(b.date) || (a.kind === "start" ? -1 : b.kind === "start" ? 1 : 0));
    return { available: true, commits: Number(count), contributors: authors ? authors.split("\n").length : undefined, events };
  } catch (err) {
    return { available: false, reason: `git history couldn't be read (${err instanceof Error ? err.message.split("\n")[0] : err})`, events: [] };
  }
}

/** Mermaid timeline for markdown, grouped by month. */
export function timelineMermaid(t: Timeline, title: string): string {
  const byMonth = new Map<string, string[]>();
  for (const e of t.events) {
    const m = e.date.slice(0, 7);
    byMonth.set(m, [...(byMonth.get(m) ?? []), e.label.replace(/:/g, " -")]);
  }
  return ["timeline", `  title ${title}`, ...[...byMonth].map(([m, labels]) => `  ${m} : ${labels.join(" : ")}`)].join("\n");
}
