// ENG.0.2 / ENG.0.2-C2 — tests for the diff-aware TypeScript debt ratchet.
// Pure/synthetic only. No database or network access.

import {
  assertEquals,
  assertThrows,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  ANY_EXCEPTION_MARKER,
  findViolationsInSource,
  GuardBlocked,
  isSafeGitRef,
  isTypeScriptPath,
  parseAddedLinesFromDiff,
  parseCliArgs,
  TS_EXPECT_ERROR_EXCEPTION_MARKER,
} from "./noNewTypeDebtGuard.ts";

function reasons(
  source: string,
  lines: number[],
  path = "src/example.ts",
): string[] {
  return findViolationsInSource(
    path,
    source,
    new Set(lines),
  ).map((violation) => violation.reason);
}

function violations(source: string, lines: number[], path: string) {
  return findViolationsInSource(path, source, new Set(lines))
    .map((violation) => ({ line: violation.line, reason: violation.reason }));
}

Deno.test("TypeScript path scope is explicit", () => {
  assertEquals(isTypeScriptPath("src/a.ts"), true);
  assertEquals(isTypeScriptPath("src/a.tsx"), true);
  assertEquals(isTypeScriptPath("src/a.mts"), true);
  assertEquals(isTypeScriptPath("src/a.cts"), true);
  assertEquals(isTypeScriptPath("src/a.js"), false);
  assertEquals(isTypeScriptPath("README.md"), false);
});

Deno.test("safe Git refs and CLI contract fail closed", () => {
  assertEquals(isSafeGitRef("abc123"), true);
  assertEquals(isSafeGitRef("refs/heads/main"), true);
  assertEquals(isSafeGitRef("../main"), false);
  assertEquals(isSafeGitRef("main^{tree}"), false);
  assertEquals(parseCliArgs(["--base", "abc123", "--head", "def456"]), {
    base: "abc123",
    head: "def456",
  });
  assertThrows(
    () => parseCliArgs(["--base", "abc123"]),
    GuardBlocked,
  );
  assertThrows(
    () => parseCliArgs(["--wat", "abc123", "--head", "def456"]),
    GuardBlocked,
  );
});

Deno.test("JSX text containing 'any' is not explicit-any debt", () => {
  const source = [
    "export const View = () => (",
    "  <p>Pick any project you want</p>",
    ");",
  ].join("\n");
  assertEquals(reasons(source, [1, 2, 3], "src/example.tsx"), []);
});

Deno.test("apostrophe in JSX text does not suppress later detection", () => {
  const source = [
    "export const View = () => <p>Don't worry</p>;",
    "const value: any = input;",
  ].join("\n");
  assertEquals(
    violations(source, [1, 2], "src/example.tsx"),
    [{ line: 2, reason: "explicit_any" }],
  );
});

Deno.test("regex literal quotes do not suppress later detection", () => {
  const source = [
    "const re = /['\"]/;",
    "const value: any = input;",
  ].join("\n");
  assertEquals(
    violations(source, [1, 2], "src/example.ts"),
    [{ line: 2, reason: "explicit_any" }],
  );
});

Deno.test("ordinary comments mentioning suppression directives do not trigger", () => {
  const source = [
    "// This guard rejects new @ts-ignore suppressions.",
    "// A documented @ts-expect-error may be used narrowly.",
    "const value: unknown = input;",
  ].join("\n");
  assertEquals(reasons(source, [1, 2, 3]), []);
});

Deno.test("template interpolation code is inspected while literal text is ignored", () => {
  const source = [
    "const safe = `literal any ${input as unknown}`;",
    "const bad = `value ${input as any}`;",
  ].join("\n");
  assertEquals(reasons(source, [1]), []);
  assertEquals(reasons(source, [2]), ["explicit_any"]);
});

Deno.test("nested template interpolation remains inspectable", () => {
  const source = "const bad = `outer ${`inner ${input as any}`}`;";
  assertEquals(reasons(source, [1]), ["explicit_any"]);
});

Deno.test("new explicit any forms are rejected", () => {
  assertEquals(reasons("const value: any = input;", [1]), ["explicit_any"]);
  assertEquals(reasons("type Result = Promise<any>;", [1]), ["explicit_any"]);
  assertEquals(reasons("const fn = (...args: any[]) => args;", [1]), ["explicit_any"]);
  assertEquals(reasons("type Result = string | any;", [1]), ["explicit_any"]);
  assertEquals(reasons("const value = input as any;", [1]), ["explicit_any"]);
});

Deno.test("documented narrow as-any exception is permitted", () => {
  const source = `const value = input as any; // ${ANY_EXCEPTION_MARKER} legacy SDK boundary has no typed contract`;
  assertEquals(reasons(source, [1]), []);
});

Deno.test("empty as-any exception reason is rejected", () => {
  const source = `const value = input as any; // ${ANY_EXCEPTION_MARKER}`;
  assertEquals(reasons(source, [1]), ["explicit_any"]);
});

Deno.test("exception marker does not permit other explicit-any forms", () => {
  const source = `const value: any = input; // ${ANY_EXCEPTION_MARKER} not an as-any boundary`;
  assertEquals(reasons(source, [1]), ["explicit_any"]);
});

Deno.test("as-any exception marker in non-comment text does not authorize the cast", () => {
  const source = `const value = input as any; const label = "${ANY_EXCEPTION_MARKER} pretend reason";`;
  assertEquals(reasons(source, [1]), ["explicit_any"]);
});

Deno.test("new ts-ignore comment is rejected", () => {
  const source = [
    "// @ts-ignore legacy mismatch",
    "const value: unknown = input;",
  ].join("\n");
  assertEquals(reasons(source, [1]), ["ts_ignore"]);
});

Deno.test("undocumented ts-expect-error is rejected", () => {
  const source = [
    "// @ts-expect-error legacy mismatch",
    "const value: unknown = input;",
  ].join("\n");
  assertEquals(reasons(source, [1]), ["ts_expect_error_undocumented"]);
});

Deno.test("documented narrow ts-expect-error is permitted", () => {
  const source = [
    `// @ts-expect-error ${TS_EXPECT_ERROR_EXCEPTION_MARKER} upstream d.ts omits this overload`,
    "const value: unknown = input;",
  ].join("\n");
  assertEquals(reasons(source, [1]), []);
});

Deno.test("empty ts-expect-error exception reason is rejected", () => {
  const source = [
    `// @ts-expect-error ${TS_EXPECT_ERROR_EXCEPTION_MARKER}`,
    "const value: unknown = input;",
  ].join("\n");
  assertEquals(reasons(source, [1]), ["ts_expect_error_undocumented"]);
});

Deno.test("ts-expect-error marker in non-comment source text does not authorize the directive", () => {
  const source = [
    `const label = "${TS_EXPECT_ERROR_EXCEPTION_MARKER} pretend reason";`,
    "// @ts-expect-error undocumented",
    "const value: unknown = input;",
  ].join("\n");
  assertEquals(reasons(source, [1, 2, 3]), ["ts_expect_error_undocumented"]);
});

Deno.test("ts-expect-error marker inside JSX text does not authorize the directive", () => {
  const source = [
    "export const View = () => (",
    `  <p>${TS_EXPECT_ERROR_EXCEPTION_MARKER} pretend reason</p>`,
    ");",
    "// @ts-expect-error undocumented",
    "const value: unknown = input;",
  ].join("\n");
  assertEquals(
    violations(source, [1, 2, 3, 4, 5], "src/example.tsx"),
    [{ line: 4, reason: "ts_expect_error_undocumented" }],
  );
});

Deno.test("debt words in strings and ordinary comments do not false-positive", () => {
  const source = [
    'const literal = "any @ts-ignore";',
    "// any is discussed here but is not code",
    "const value: unknown = literal;",
  ].join("\n");
  assertEquals(reasons(source, [1, 2, 3]), []);
});

Deno.test("value property named any is not treated as a type", () => {
  const source = [
    "const first = payload.any;",
    "const second = payload?.any;",
    "const object = { any: true };",
  ].join("\n");
  assertEquals(reasons(source, [1, 2, 3]), []);
});

Deno.test("multiline block comments do not create explicit-any false positives", () => {
  const source = [
    "/*",
    " * any appears in documentation only",
    " */",
    "const value: unknown = input;",
  ].join("\n");
  assertEquals(reasons(source, [1, 2, 3, 4]), []);
});

Deno.test("only added line numbers are inspected", () => {
  const source = [
    "const historical: any = oldValue;",
    "const added: unknown = newValue;",
  ].join("\n");
  assertEquals(reasons(source, [2]), []);
  assertEquals(reasons(source, [1]), ["explicit_any"]);
});

Deno.test("unified diff parser records only added head lines in TypeScript files", () => {
  const diff = [
    "diff --git a/src/example.ts b/src/example.ts",
    "index 1111111..2222222 100644",
    "--- a/src/example.ts",
    "+++ b/src/example.ts",
    "@@ -2,0 +3,2 @@",
    "+const first: unknown = one;",
    "+const second: unknown = two;",
    "diff --git a/README.md b/README.md",
    "index 3333333..4444444 100644",
    "--- a/README.md",
    "+++ b/README.md",
    "@@ -1,0 +2 @@",
    "+any wording is irrelevant here",
  ].join("\n");

  const parsed = parseAddedLinesFromDiff(diff);
  assertEquals([...parsed["src/example.ts"]], [3, 4]);
  assertEquals(parsed["README.md"], undefined);
});

Deno.test("replacement diff advances head line only for additions/context", () => {
  const diff = [
    "diff --git a/src/example.ts b/src/example.ts",
    "index 1111111..2222222 100644",
    "--- a/src/example.ts",
    "+++ b/src/example.ts",
    "@@ -5 +5 @@",
    "-const oldValue: unknown = oldInput;",
    "+const newValue: unknown = newInput;",
  ].join("\n");

  const parsed = parseAddedLinesFromDiff(diff);
  assertEquals([...parsed["src/example.ts"]], [5]);
});
