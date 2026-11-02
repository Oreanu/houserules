// The documents houserules generates, and what goes in each section. The agent fills sections with
// items; the engine verifies and renders them. Keeping structure here (not in the skill prompt) means
// every agent produces the same shape, and the limits keep docs short enough to actually be read.

export type DocId = "architecture" | "guidelines";

export interface SectionSpec {
  id: string;
  title: string;
  guidance: string; // what the agent should put here
  minItems: number;
  maxItems: number;
}

export interface DocSpec {
  id: DocId;
  title: string;
  file: string; // rendered path, relative to the docs dir
  purpose: string;
  sections: SectionSpec[];
}

export const DOC_SPECS: DocSpec[] = [
  {
    id: "architecture",
    title: "Architecture",
    file: "ARCHITECTURE.md",
    purpose: "How this repository is put together, so someone new can find their way and trace a change end to end.",
    sections: [
      {
        id: "overview",
        title: "Overview",
        guidance: "What the system does and the shape of it (apps, services, packages) in 1–3 items. Lead with the answer; cite the entry points.",
        minItems: 1,
        maxItems: 3,
      },
      {
        id: "running",
        title: "Running it",
        guidance: "How to install, run, test and build, as the repo actually does it (scripts, manage.py, mvnw/gradlew, docker compose). One item per task; put exact commands in the body.",
        minItems: 1,
        maxItems: 6,
      },
      {
        id: "layout",
        title: "Repository layout",
        guidance: "The top-level directories (and important second-level ones) and what lives in each. Cite the directory itself as evidence.",
        minItems: 2,
        maxItems: 12,
      },
      {
        id: "flows",
        title: "Main flows",
        guidance:
          "The 2–5 most important request/command paths, traced end to end. Body: numbered steps naming each file and function. Evidence: one entry per step, in order, with symbol and line.",
        minItems: 1,
        maxItems: 5,
      },
      {
        id: "diagrams",
        title: "Journeys & lifecycles",
        guidance:
          "Pictures the code can't draw by itself: how a user moves through the product (journey), the lifecycle of a core record (stateDiagram-v2, e.g. order: draft → paid → shipped), or a timeline of a multi-step process. Body: one ```mermaid block (journey, stateDiagram-v2, sequenceDiagram, flowchart or timeline) and one sentence on what it shows. Evidence: the code each state or step comes from. The architecture map, data model and flow diagrams are generated automatically; don't redraw them.",
        minItems: 0,
        maxItems: 6,
      },
      {
        id: "building-blocks",
        title: "Shared building blocks",
        guidance:
          "Modules, helpers, components and services that new code should reuse instead of rewriting. Start from the most-imported internal modules. Body: what it's for and when to use it; evidence: its definition plus one real call site.",
        minItems: 1,
        maxItems: 15,
      },
      {
        id: "integrations",
        title: "Third-party integrations",
        guidance:
          "One item per integration that matters: where it's wrapped, where config and secrets come from, and what happens when it fails (timeouts, retries, idempotency) if you can tell. Say plainly when there is no wrapper.",
        minItems: 0,
        maxItems: 15,
      },
      {
        id: "cross-cutting",
        title: "Cross-cutting concerns",
        guidance:
          "Things that touch every feature: auth and permissions, multi-tenancy, error handling, logging, configuration, feature flags, i18n, background jobs. Only include what this repo actually has.",
        minItems: 0,
        maxItems: 10,
      },
    ],
  },
  {
    id: "guidelines",
    title: "Guidelines",
    file: "GUIDELINES.md",
    purpose: "How this repository wants code to be written: its house rules. Follow the existing pattern first; consistency beats cleverness.",
    sections: [
      {
        id: "patterns",
        title: "Established patterns",
        guidance:
          "How this repo already solves recurring problems (data access, API endpoints, validation, errors, state, jobs, tests…). Title: the rule as an instruction. Body: how it's done here and when it doesn't apply. Evidence: at least two real examples, since a pattern is something repeated.",
        minItems: 1,
        maxItems: 15,
      },
      {
        id: "conventions",
        title: "Conventions",
        guidance: "Naming, file placement, module boundaries, testing conventions, commit/PR conventions if visible. Only conventions the code actually follows, with examples.",
        minItems: 0,
        maxItems: 10,
      },
      {
        id: "tradeoffs",
        title: "Deliberate tradeoffs",
        guidance:
          "Requirements this system appears to deliberately not have (no locking here, best-effort delivery, stale reads accepted…). Mark as inferred or needs-human unless the code or a comment says so explicitly. These stop people and agents from 'fixing' them.",
        minItems: 0,
        maxItems: 8,
      },
      {
        id: "pitfalls",
        title: "Pitfalls",
        guidance: "Non-obvious things that trip people up: exceptions to the patterns, surprising behaviour, hidden coupling, legacy areas to be careful in.",
        minItems: 0,
        maxItems: 8,
      },
    ],
  },
];

export function docSpec(id: string): DocSpec | undefined {
  return DOC_SPECS.find((d) => d.id === id);
}

export function sectionSpec(doc: string, section: string): SectionSpec | undefined {
  return docSpec(doc)?.sections.find((s) => s.id === section);
}

export const ITEM_LIMITS = {
  title: 140,
  body: 2000,
  evidence: 10,
};
