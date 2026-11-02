import path from "node:path";
import type { CiConfig, Dependency, ImportEdge, TestInfo } from "../types.js";

const TEST_FILE = [
  /\.(test|spec)\.(ts|tsx|js|jsx|mjs|cjs|mts|cts)$/,
  /(^|\/)__tests__\//,
  /(^|\/)test_[^/]+\.py$/,
  /(^|\/)[^/]+_test\.py$/,
  /(^|\/)tests?\.py$/,
  /(^|\/)src\/test\/.+\.(java|kt)$/,
  /Tests?\.(java|kt)$/,
];

const TEST_FRAMEWORKS: [string, (d: Dependency) => boolean][] = [
  ["jest", (d) => d.name === "jest"],
  ["vitest", (d) => d.name === "vitest"],
  ["mocha", (d) => d.name === "mocha"],
  ["playwright", (d) => d.name === "@playwright/test"],
  ["cypress", (d) => d.name === "cypress"],
  ["testing-library", (d) => d.name.startsWith("@testing-library/")],
  ["pytest", (d) => d.name === "pytest" || d.name.startsWith("pytest-")],
  ["junit", (d) => d.name.startsWith("org.junit") || d.name === "junit:junit"],
  // Spring Boot 4 splits the test starter per module: spring-boot-starter-webmvc-test, …-data-jpa-test.
  ["spring-boot-test", (d) => /^org\.springframework\.boot:spring-boot-(starter-([\w-]+-)?test|test)$/.test(d.name)],
  ["mockito", (d) => d.name.startsWith("org.mockito")],
  ["testcontainers", (d) => d.name.startsWith("org.testcontainers") || d.name === "testcontainers" || d.name === "@testcontainers/postgresql"],
];

// What test files import is better evidence than dependency names (starters pull these in transitively).
const TEST_IMPORTS: [string, (ext: string) => boolean][] = [
  ["junit", (x) => x.startsWith("org.junit")],
  ["mockito", (x) => x.startsWith("org.mockito")],
  ["assertj", (x) => x.startsWith("org.assertj")],
  ["pytest", (x) => x === "pytest" || x.startsWith("pytest.")],
  ["vitest", (x) => x === "vitest"],
  ["jest", (x) => x === "@jest/globals"],
  ["playwright", (x) => x === "@playwright/test"],
  ["testing-library", (x) => x.startsWith("@testing-library/")],
];

export function isTestFile(rel: string): boolean {
  return TEST_FILE.some((re) => re.test(rel));
}

export function detectTests(paths: string[], dependencies: Dependency[], hasDjango: boolean, imports: ImportEdge[] = []): TestInfo {
  const files = paths.filter(isTestFile);
  const testFiles = new Set(files);
  const testExternals = imports.filter((e) => e.external && testFiles.has(e.from)).map((e) => e.external!);
  const frameworks = TEST_FRAMEWORKS.filter(([, pred]) => dependencies.some(pred)).map(([name]) => name);
  for (const [name, pred] of TEST_IMPORTS) if (!frameworks.includes(name) && testExternals.some(pred)) frameworks.push(name);
  if (hasDjango && files.some((f) => f.endsWith(".py")) && !frameworks.includes("pytest")) frameworks.push("django-test");
  return { files, frameworks };
}

export function detectCi(paths: string[]): CiConfig[] {
  const out: CiConfig[] = [];
  for (const p of paths) {
    if (/^\.github\/workflows\/[^/]+\.ya?ml$/.test(p)) out.push({ provider: "github-actions", path: p });
    else if (p === ".gitlab-ci.yml") out.push({ provider: "gitlab", path: p });
    else if (p === ".circleci/config.yml") out.push({ provider: "circleci", path: p });
    else if (path.posix.basename(p) === "Jenkinsfile") out.push({ provider: "jenkins", path: p });
    else if (p === "azure-pipelines.yml") out.push({ provider: "azure-pipelines", path: p });
  }
  return out;
}
