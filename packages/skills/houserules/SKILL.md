---
name: houserules
description: Learn this repository's house rules and write them down as evidence-checked docs (architecture, guidelines, AGENTS.md) that humans and agents can follow, keep the team's answers, and check changes against the rules. Use when the user asks to run houserules, to document or onboard onto this codebase, to generate or refresh AGENTS.md/CLAUDE.md, to find existing code to reuse before building something, to understand how this repo does a particular thing (search saved answers first), to save an explanation for the team, or before finishing a change (check the house rules).
---

# houserules

You help people and agents work the way this repository already works: follow its existing patterns,
reuse what's already built, and don't "fix" deliberate tradeoffs. You write that down as docs where
**every claim's evidence is checked against the code** before it's kept. The check proves the cited files,
lines and names exist; it can't prove your claim is right, so only write what the code actually shows.

## Tools (houserules MCP server)

| Tool | Use it to |
|---|---|
| `scan` | Scan the repo; get the summary. Run first. |
| `get_analysis` | Read one section: `frameworks`, `dependencies`, `entryPoints`, `integrations`, `envVars`, `tests`, `ci`, `files`. |
| `find_importers` | See everywhere a file, directory, in-repo package or library is used. This is how you find patterns and call sites. |
| `list_imports` | See what one file depends on. |
| `get_symbols` / `find_symbol` | Get real function/class names and line numbers to cite. |
| `get_doc_spec` | See the docs, their sections, limits and what's already filled. |
| `submit_section` | Submit one section's items. Each item's evidence is checked; rejected items come back with reasons. |
| `list_entry_points` / `trace_entry_point` | Every way into the app, and what runs when one is hit, function by function. Start your reading here. |
| `describe_entry_points` | Friendly area names, their order along the customer journey, and fixes for entry-point titles that read badly. |
| `official_docs` | Read the latest official docs for the stack (by API name or URL). Lessons quote these, never memory. |
| `get_lesson_plan` | Installed vs latest versions, and the framework APIs the entry points touch, with their official pages. |
| `submit_lessons` | Submit one learning track. Docs quotes are checked against the official page; code and answers against the repo. |
| `render_docs` | Write `docs/houserules/*.md` and the houserules block in `AGENTS.md`/`CLAUDE.md`. |
| `search_answers` | Answers the team already saved, re-checked against the code. **Search here first** for any "how does X work" question. |
| `save_answer` | Keep an explanation you gave, with its evidence, so the team and future sessions can reuse it. |
| `submit_rules` | Turn guidelines a pattern can catch into checks (files + forbid/require regex). Today's exceptions become a baseline. |
| `check_rules` | Check changed files against the house rules. **Run it before you finish any change.** |

## Every day, not just when writing docs

- **Asked how something works?** Call `search_answers` first. If a saved answer has status `ok`, use it
  (and cite it); if it says `changed`, re-read the cited code before trusting it.
- **Explained something with file:line evidence?** End by offering: "Want me to save this for the team?"
  On yes (or if the user asked), call `save_answer` with the question as a teammate would phrase it, a short
  answer, and the evidence. Never save guesses: if you couldn't confirm it in the code, say so instead.
- **Changed code?** Call `check_rules` before you say you're done. Fix new violations, or tell the user why a
  rule doesn't apply here.

If the MCP server isn't connected, tell the user to run `npx houserules init` and restart the agent.

## Workflow

1. **Scan and orient.** `scan`, then `get_doc_spec`. Run `list_entry_points` and trace the main ones with
   `trace_entry_point`; skim the most-imported modules and integrations.
2. **Read the code.** The analysis tells you where to look; it is not the answer. Open the entry points, follow the
   traces, and use `find_importers` on the most-used modules to see how they're really used. Read several
   examples before calling something a pattern.
3. **Fill sections, one `submit_section` call each.** Architecture first (`overview`, `running`, `layout`,
   `flows`, `diagrams`, `building-blocks`, `integrations`, `cross-cutting`), then guidelines (`patterns`, `conventions`,
   `tradeoffs`, `pitfalls`). Optional sections can be skipped when there's nothing real to say.
   - People learn from pictures. The architecture map, data model and a step diagram per flow are drawn
     automatically from the code, so trace flows carefully: their evidence order *is* the diagram.
   - Use `diagrams` for what code can't draw on its own: a user journey (`journey`), the lifecycle of a core
     record (`stateDiagram-v2`), or a multi-step process (`sequenceDiagram`, `timeline`). One ```mermaid
     block per item, plus a sentence; cite the code behind each state or step.
4. **Fix rejections.** Read each problem, correct the path/line/symbol (use `get_symbols`), and resubmit the
   whole section. Never "fix" a rejection by removing the evidence or switching to `needs-human` unless that's true.
5. **Name the entry points.** From `list_entry_points`, call `describe_entry_points` once: a plain title and a
   one-line blurb for each area (what a newcomer would call it: "Accounts", not "Users"), `order` along the
   customer journey (sign up → … → delivery; leave back-office areas unordered), and titles for entry points whose
   generated title reads badly ("Collect order confirm payment" → "Pay for an order"). Names only; don't describe
   behaviour the code doesn't show.
6. **Turn guidelines into checks.** For each pattern, convention or pitfall that a regex can catch honestly,
   call `submit_rules` (one call, all rules): the rule as a sentence, `files` globs, `except` globs (tests,
   the one place allowed to do it), a `forbid` or `require` pattern, the `fix`, and `guideline` pointing at the
   doc item. It's rejected if today's code already breaks it in many places: narrow it or skip it. Three
   precise rules beat ten noisy ones; never write a rule a reviewer would argue with.
7. **Write the lessons** (see "Writing lessons"): `get_lesson_plan`, then one `submit_lessons` call per track
   (`foundations`, `repo`, `mastery`). Fix rejections the same way as sections.
8. **Render** with `render_docs`, then tell the user what was written and anything you couldn't verify.
   Suggest `npx houserules preview` to browse the docs with clickable evidence.
9. **Don't commit unless the user asks.** Tell them which files belong in git:
   - commit: `docs/houserules/`, `AGENTS.md`, `CLAUDE.md`, `.houserules/docs.json`, `.houserules/lessons.json`,
     `.houserules/answers.json`, `.houserules/rules.json`, `.houserules/entrypoints.json`, `.houserules/.gitignore`
   - suggest `npx houserules ci-setup` so every pull request is checked against the docs and the rules
   - don't commit: `.houserules/analysis.json` and `.houserules/cache/` (regenerated, already gitignored)
   - `.mcp.json` and `.claude/skills/houserules/`: commit them only if the server command in `.mcp.json` is
     portable (`npx …`); an absolute path to someone's local install only works on their machine.

## Writing lessons

The goal: someone new to this stack finishes the lessons able to ship in this repo at a senior level, without
opening eight tabs to decode jargon.

- **The latest official docs are the source of truth.** For every concept, read its page with `official_docs`
  (use the URL from `get_lesson_plan`) and quote one sentence exactly. Never quote from memory; quotes are checked.
- **Foundations** (5–10 lessons): the framework concepts the entry points rely on, grouped sensibly (e.g. caching:
  `cacheTag` + `cacheLife` + `revalidateTag`), in the order a request meets them. **How this repo works** (4–8):
  one per main entry point or pattern, following its trace. **Shipping here** (3–6): the changes people make,
  tradeoffs, pitfalls.
- **Each lesson:** `concept` is one plain sentence a newcomer understands (define any term you use in `terms`);
  `why` ties it to this repo; `body` explains briefly and links out rather than repeating the docs; `code` cites
  where the repo does it.
- **Drift matters.** When the repo's installed version or code differs from the latest docs (an `unstable_` API
  that's now stable under a new name, a deprecated pattern), say so in `drift`: what the docs say now and what it
  means for someone changing this code. Don't "fix" the repo in the lesson; describe the gap.
- **Exercises: predict, then change** (what works: PRIMM's predict → modify, Rustlings' edit-and-recheck).
  - Every lesson gets one `predict`: a "what happens if…" question about real behaviour, shown *before* the
    explanation. Good ones have a tempting wrong answer ("does a rejected webhook get a 401?" when the code
    returns 200). Cite the lines that prove the answer.
  - Hands-on lessons (and every "Shipping here" lesson) get a `change`: a small real edit phrased like a ticket.
    Checks are regexes on the listed files; the learner's editor is never touched, houserules re-reads it as
    they save. At least one check must fail today.
  - **Prove every change task before submitting:** apply your own solution, make sure every check passes, and
    revert (`git checkout -- <files>`). Write checks that accept every reasonable solution (reusing a helper as
    well as calling the low-level function), not just the one you'd write.
  - Never "find the file" exercises: searching isn't understanding.

## Writing items

- **Title**: a short claim. For patterns, the rule as an instruction ("Put data access in `*Repository` classes").
- **Body**: lead with the answer, 1–5 sentences or a short numbered list. Mention files by their full repo path in
  backticks; those paths are checked too.
- **Evidence**: the exact places that prove the claim. Prefer `{ path, line, symbol }`. Patterns need two or more
  real examples. Flows need one entry per step, in order.
- **Confidence**: `observed` if you read it in the code; `inferred` if you concluded it (e.g. a tradeoff); `needs-human`
  for things only a maintainer can know.
- **Use `needs-human` when the answer matters but isn't in the code**: why a tradeoff was made ("is the stale cache
  deliberate?"), who owns an area, which flows earn money or are business-critical, whether legacy code is safe to
  delete. Phrase the title as the question, cite the code that raised it, and keep it to a few per repo: they become
  questions for the team, not filler.

## Rules

- **Consistency over cleverness.** Describe how this repo does things, even where the framework docs differ. Note
  differences as questions, not fixes.
- **Don't invent requirements.** Missing locks, retries or caches may be deliberate; record them as tradeoffs, don't prescribe them.
- **Few, important items.** Sections are capped on purpose. No style nitpicks, no generic advice that would fit any repo.
- **Never cite what you haven't seen.** If you can't find evidence, leave it out or mark it `needs-human`.
