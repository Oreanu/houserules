<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/brand/wordmark-white.svg">
    <img src="assets/brand/wordmark-black.svg" alt="houserules" width="250">
  </picture>
</p>

# houserules

Learn a repo's house rules, then teach them to humans and coding agents.

houserules scans a repository (stack, entry points, dependencies, imports, third-party integrations,
env vars, tests, CI) and gives Claude Code and Codex the tools and playbook to explain how the repo
already works, so people and agents reuse what exists and follow established patterns.

> Status: **M1**. Scan, agent setup, verified doc generation (architecture, guidelines, AGENTS.md) and a
> local preview work. Drift against official docs, reuse maps and learning paths are next. See [PLAN.md](../PLAN.md).

## Quick start

```bash
npx houserules generate  # scan, then write the docs and lessons with your Claude Code or Codex
```

`generate` runs your own signed-in agent headless. It can read the repo and call the houserules tools,
nothing else: no edits, no shell. Prefer to drive it yourself? `npx houserules init` installs the skill and
MCP server, then ask Claude Code or Codex inside the repo to *"run houserules"*.

The agent reads the code, fills each doc section through the MCP tools, and every claim is checked
against the code (file exists, line in range, symbol appears there, paths in the text are real) before it's
kept. Then it renders `docs/houserules/ARCHITECTURE.md`, `docs/houserules/GUIDELINES.md` and a houserules
block in `AGENTS.md` (imported from `CLAUDE.md`). Your own text in those files is left alone.

```bash
npx houserules preview      # browse the docs with clickable evidence, live verification and the scan results
npx houserules verify       # re-check the docs against the current code; exits 1 if anything broke
npx houserules render       # re-render the markdown from .houserules/docs.json
```

Other commands:

```bash
npx houserules scan [path] [--json] [--out file]
npx houserules init --dry-run          # preview changes
npx houserules init --agent codex      # or claude, all
npx houserules init --scope user       # install into your home directory instead of the repo
```

## What `init` changes

| Agent | Project scope (default) | User scope |
|---|---|---|
| Claude Code | `.claude/skills/houserules/`, `.mcp.json` | `~/.claude/skills/houserules/`; prints a `claude mcp add` command for you to run |
| Codex | `.agents/skills/houserules/`, `~/.codex/config.toml` (appended, existing content kept) | `~/.agents/skills/houserules/`, `~/.codex/config.toml` |
| Both | `.houserules/.gitignore` (ignores `analysis.json` and `cache/`) | same |

It always shows the plan first and asks before changing anything (`--yes` skips the question).

## MCP tools

| Tool | What it does |
|---|---|
| `scan` | Scan the repo, write `.houserules/analysis.json`, return a summary |
| `get_analysis` | One section of the analysis at a time (paginated) |
| `find_importers` | Everywhere a file or package is imported |
| `list_imports` | What one file imports |
| `get_symbols` / `find_symbol` | Functions, classes and methods with line ranges (tree-sitter; regex for Kotlin) |
| `get_doc_spec` | The docs, sections, limits and what's filled |
| `submit_section` | Submit a section's items; each is verified, rejected ones come back with reasons |
| `render_docs` | Write the markdown docs and the AGENTS.md / CLAUDE.md block |

## Development

```bash
npm install
npm test        # builds with tsc -b, then runs node:test
npm run houserules -- scan /path/to/repo
npm run eval    # scan the public repos in evals/repos.json and flag likely scanner mistakes
npm run eval -- documenso netbox   # just some of them
```

`evals/audit.mjs` clones each repo (shallow, into `evals/.repos/`) and checks for unresolved relative
imports, in-repo packages treated as third-party, local Python/JVM packages left external, and missing
framework detection. Targets that don't exist in git (generated code, build output) are reported as info,
not failures. Add a repo to `evals/repos.json` to cover a new stack or layout.

Packages: `core` (engine), `cli` (`houserules` bin), `mcp` (MCP server), `skills` (SKILL.md).
Node ≥ 20. MIT licensed.
