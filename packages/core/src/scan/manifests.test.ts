import assert from "node:assert/strict";
import { test } from "node:test";
import { parseManifest } from "./manifests.js";

const names = (deps: { name: string; dev: boolean }[]) => deps.map((d) => `${d.name}${d.dev ? " (dev)" : ""}`);

test("package.json: runtime, peer and dev dependencies", () => {
  const deps = parseManifest("web/package.json", JSON.stringify({ dependencies: { next: "15.1.0" }, peerDependencies: { react: "^19" }, devDependencies: { vitest: "^4" } }));
  assert.deepEqual(names(deps), ["next", "react", "vitest (dev)"]);
  assert.equal(deps[0]!.version, "15.1.0");
  assert.equal(deps[0]!.manifest, "web/package.json");
});

test("requirements.txt: skips comments, options and URLs; normalises names", () => {
  const deps = parseManifest(
    "requirements.txt",
    "# web\nDjango>=4.2,<5\nrequests[socks]==2.31.0 ; python_version>'3.8'\n-r base.txt\ngit+https://example.com/x.git\npsycopg2_binary\n",
  );
  assert.deepEqual(names(deps), ["django", "requests", "psycopg2-binary"]);
  assert.equal(deps[0]!.version, ">=4.2,<5");
  assert.equal(deps[2]!.version, null);
});

test("requirements-dev.txt is treated as dev", () => {
  assert.equal(parseManifest("requirements-dev.txt", "pytest\n")[0]!.dev, true);
});

test("pyproject.toml: PEP 621, dependency groups and Poetry", () => {
  const deps = parseManifest(
    "pyproject.toml",
    `[project]
dependencies = ["Django>=5.0", "celery"]
[project.optional-dependencies]
test = ["pytest"]
[dependency-groups]
lint = ["ruff"]
[tool.poetry.dependencies]
python = "^3.12"
stripe = "^10"
boto3 = { version = "1.34" }
[tool.poetry.group.dev.dependencies]
mypy = "*"
`,
  );
  assert.deepEqual(names(deps), ["django", "celery", "pytest (dev)", "ruff (dev)", "stripe", "boto3", "mypy (dev)"]);
  assert.equal(deps.find((d) => d.name === "boto3")!.version, "1.34");
});

test("pom.xml: parent, property-resolved versions and test scope", () => {
  const deps = parseManifest(
    "pom.xml",
    `<project>
  <parent><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter-parent</artifactId><version>3.3.2</version></parent>
  <properties><stripe.version>26.1.0</stripe.version></properties>
  <dependencies>
    <dependency><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter-web</artifactId></dependency>
    <dependency><groupId>com.stripe</groupId><artifactId>stripe-java</artifactId><version>\${stripe.version}</version></dependency>
    <dependency><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter-test</artifactId><scope>test</scope></dependency>
  </dependencies>
</project>`,
  );
  assert.deepEqual(names(deps), [
    "org.springframework.boot:spring-boot-starter-parent",
    "org.springframework.boot:spring-boot-starter-web",
    "com.stripe:stripe-java",
    "org.springframework.boot:spring-boot-starter-test (dev)",
  ]);
  assert.equal(deps[0]!.version, "3.3.2");
  assert.equal(deps[2]!.version, "26.1.0");
});

test("build.gradle.kts: configurations and the Spring Boot plugin version", () => {
  const deps = parseManifest(
    "build.gradle.kts",
    `plugins { id("org.springframework.boot") version "3.2.5" }
dependencies {
  implementation("org.springframework.boot:spring-boot-starter-web")
  implementation("com.stripe:stripe-java:24.0.0")
  testImplementation("org.springframework.boot:spring-boot-starter-test")
}`,
  );
  assert.deepEqual(names(deps), [
    "org.springframework.boot:spring-boot-starter-web",
    "com.stripe:stripe-java",
    "org.springframework.boot:spring-boot-starter-test (dev)",
    "org.springframework.boot:spring-boot-gradle-plugin",
  ]);
  assert.equal(deps[1]!.version, "24.0.0");
  assert.equal(deps[3]!.version, "3.2.5");
});
