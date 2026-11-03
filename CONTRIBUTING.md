# Contributing to houserules

Thanks for helping. Bug reports, fixes for stacks houserules reads wrongly, and new stack support are all
welcome. This page is the house rules for this repo.

## Before you start

- **Open an issue first for anything big**: a new stack, a new MCP tool, a change to the docs format, or a
  new dependency. A short "here's what I'd change and why" saves us both a rewrite. Small fixes can go
  straight to a pull request.
- **One topic per pull request.** A fix for Express guards and a new Python detector are two PRs.

## Set up

```bash
git clone https://github.com/Oreanu/houserules.git
cd houserules && npm install
npm test                                   # builds with tsc -b, then runs node:test
npm run houserules -- scan /path/to/repo   # try your change on a real repo
npm run eval                               # scan the public repos in evals/repos.json
```

You need Node 20 or later.

## What a good pull request has

1. **A test for every behaviour you change.** Put it next to the code (`packages/*/src/**/*.test.ts`), build
   the smallest repo that shows the problem with `makeTree`, and assert on the result. A fix with no test
   that fails without it won't be merged.
2. **`npm test` passing.** CI runs it on every pull request. If you change an existing expectation, say why in
   the description.
3. **Before and after** for anything that changes scan, trace or docs output: a few lines showing what
   houserules printed on `main` and what it prints now.
4. **The cache version bumped** (`CACHE_VERSION` in `symbols/index.ts` or `flows/graph.ts`) when you change
   what gets cached, so people's old caches aren't reused.
5. **The agent-facing text kept in sync.** If an MCP tool's input or behaviour changes, update its description
   in `packages/mcp/src/index.ts` and the steps in `packages/skills/houserules/SKILL.md`.
6. **Docs updated** in `README.md` when a command, option or default changes.

## Rules for the code

- **houserules never edits the user's code.** It reads the repo and writes only its own files:
  `.houserules/`, `docs/houserules/`, its block in `AGENTS.md` / `CLAUDE.md`, and the skill and MCP config
  that `init` lists and asks about first. Changes that write anywhere else, run the user's code, or reach the
  network during a scan won't be accepted.
- **Don't guess when you can't check.** Anything houserules shows as a fact must trace back to a file, line or
  symbol that exists. When the code doesn't say something plainly, return nothing rather than a likely
  answer, and mark name-only guesses (`via: "name"`) so they can be told apart.
- **Follow the patterns around you.** Match the naming, comment style and structure of the file you're in.
  Comments explain why, in plain words, with a short example of the code they handle.
- **No new runtime dependencies** without an issue first. The install should stay small.
- **No private code or names.** Test fixtures and examples must be made up or come from public, permissively
  licensed repos. Don't paste code from your employer's or a client's repo, and don't name companies in
  fixtures, docs or examples.

## Commits

- Write the commit message as what changed and why, in plain sentences. Explain anything a reviewer would
  ask about.
- Keep the history clean: squash fixups before asking for review.
- By opening a pull request, you agree your contribution is licensed under the MIT license, the same as the
  rest of the project.

## Reporting bugs

Open an issue with:

- what you ran, the houserules version (`houserules --help` prints it), and your Node version;
- what you expected and what happened;
- the smallest code that shows it, if you can. A link to a public repo and a file path is perfect.

For a security problem, don't open a public issue. Contact the maintainer through their GitHub profile.
