# agent-bench

One question, answered with numbers: **does a coding agent answer questions about a codebase better, faster and cheaper when it has the houserules MCP server than when it only reads the code?**

Each question in `questions.json` (your own, kept out of git; start from `questions.example.json`) runs headless through Claude Code twice, in the target repo, read-only:

| condition    | tools                                                                 | prompt                                                   |
|--------------|-----------------------------------------------------------------------|----------------------------------------------------------|
| `baseline`   | Read, Grep, Glob                                                      | answer concisely, cite `path:line`, don't edit anything |
| `houserules` | same + the houserules MCP server (`node packages/cli/dist/index.js mcp <repo>`) | same + "A houserules MCP server is available ...; use it first." |

Both conditions run with `--strict-mcp-config` (no user or project MCP servers), with Edit, Write, Bash, WebFetch, WebSearch, Task, Agent, Skill and the unrelated harness tools (Cron*, Monitor, Workflow, SendMessage, ...) disallowed, plus `--no-session-persistence`.

houserules also writes its docs into the repo (`docs/houserules/*.md`, `.houserules/`). In the pilot the baseline agent found and read `docs/houserules/ARCHITECTURE.md`, so by default both conditions are denied Read/Grep/Glob on those paths (the MCP server still reads them itself). Pass `--allow-generated-docs` to measure "repo with houserules docs committed, no MCP" instead. The repo's own `CLAUDE.md`/`AGENTS.md` are loaded in both conditions.

## What it measures

Per run (see `grade.mjs`; deterministic, no LLM judge):

- **fact recall**: share of the question's `facts` (case-insensitive regexes) found in the answer
- **correct**: fact recall >= 0.6; a timed-out or crashed run is never correct
- **citation score**: share of the question's gold `files` mentioned (full path or basename)
- **tokens**: input + output + cache read (cache creation is recorded separately), **cost** (`total_cost_usd`), **duration** (`duration_ms`), **turns**
- **tool calls**: houserules MCP calls vs file tools, and any write-tool attempts (should be 0)

The report (`results/<ts>/report.md` and a self-contained `report.html`) shows per-condition accuracy, average recall and citation score, median time and tokens over completed runs, total cost, a per-question table and a "where houserules lost" list.

Regex facts are cheap and reproducible but blunt: they miss paraphrases and can reward a wrong answer that names the right identifiers. A future option is an LLM judge that scores each answer against the gold `answer`, alongside (not instead of) the regex facts.

## Run it

Build houserules first (`npm run build`). The target repo must already be scanned (`.houserules/` present).

```sh
# a couple of questions
node evals/agent-bench/run.mjs --only q01,q02

# every question, both conditions
node evals/agent-bench/run.mjs --concurrency 2

# test the harness without spending tokens (stub agent)
node evals/agent-bench/run.mjs --fake

# rebuild the report for an existing run
node evals/agent-bench/report.mjs evals/agent-bench/results/<ts>

# check every gold answer passes its own facts
node evals/agent-bench/grade.mjs
```

Options: `--only q01,q02`, `--conditions baseline,houserules`, `--model <m>`, `--concurrency <n>` (default 2), `--timeout <sec>` (default 360), `--questions <file>`, `--agent-bin <path>`, `--out <dir>`, `--allow-generated-docs`, `--fake`.

The agent is `claude` from PATH, else the newest CLI bundled with the Claude desktop app. It must be signed in (`claude auth status`). A run that ends without a result event (for example the MCP server failed because `dist` was mid-rebuild) is retried once; timeouts are not retried.

Output: `results/<ts>/raw/<id>.<condition>.jsonl` (raw stream-json), `.result.json` (parsed + graded), `.stderr.txt`; `results.json`, `summary.json`, `meta.json`, `report.md`, `report.html`.

**Cost warning.** Every run is a real Claude Code session on your account. Answering one question about a large repo typically reads tens of files: expect roughly $0.20 to $1+ and 30 s to 3 min per run, so a 20-question suite (40 runs) can cost tens of dollars of usage. Start with `--only`.

## Add questions for another repo

Copy `questions.example.json` to `questions.json` and point `repo` at your checkout (scan it with houserules first), then pass `--questions path/to/your.json`. For each question:

```json
{
  "id": "q01",
  "kind": "flow | where | authorization | integration | convention | pitfall | change-impact",
  "difficulty": "easy | medium | hard",
  "trace": true,
  "question": "What a new developer would really ask",
  "answer": "Short gold answer you verified in the code",
  "facts": ["DistinctIdentifier", "can:update,order", "either|or"],
  "files": ["path/relative/to/repo/File.php"]
}
```

Rules that keep the numbers honest:

- Establish the truth by reading the code yourself, not from houserules' docs; only keep questions you verified.
- Prefer distinctive identifiers for facts (class, method, route, config key). Avoid generic words that any answer contains. Escape regex characters (`\\(`, `\\.`).
- 2 to 5 facts and 1 to 3 gold files per question; mix easy lookups with questions that need tracing across files.
- Run `node evals/agent-bench/grade.mjs your.json` to check each gold answer passes its own facts.
