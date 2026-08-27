// ENG.0.2 — Diff-aware TypeScript debt ratchet.
//
// Repository guard only. It inspects TypeScript lines added between an explicit
// Git base and head and rejects new explicit `any` usage, `@ts-ignore`
// suppressions and undocumented `@ts-expect-error` suppressions. Historical
// debt that is untouched by the diff is not scanned.
//
// Source classification uses the TypeScript compiler's own parser and trivia,
// so JSX text, string and template text, regex literals, comments and property
// names are distinguished structurally instead of by a hand-written scanner.
//
// A narrowly documented `as any` exception is permitted only when a real
// comment on the same line contains:
//   BTPM-ENG-ANY-EXCEPTION: <non-empty reason>
// A narrowly documented `@ts-expect-error` requires:
//   BTPM-ENG-TS-EXPECT-ERROR-EXCEPTION: <non-empty reason>
// Both are intentionally narrower than a general allowlist.

// The TypeScript compiler is consumed from the repository's existing dependency.
// Deno resolves the CommonJS bundle without types, so the API surface is typed
// from the package's own declarations at this single boundary.
import type * as TypeScriptApi from "../../node_modules/typescript/lib/typescript.d.ts";
import typeScriptCompiler from "../../node_modules/typescript/lib/typescript.js";

const ts = typeScriptCompiler as unknown as typeof TypeScriptApi;

export const GUARD_ID = "eng_0_2_no_new_typescript_debt_guard_v1";
export const ANY_EXCEPTION_MARKER = "BTPM-ENG-ANY-EXCEPTION:";
export const TS_EXPECT_ERROR_EXCEPTION_MARKER = "BTPM-ENG-TS-EXPECT-ERROR-EXCEPTION:";

export type ReasonCode = "explicit_any" | "ts_ignore" | "ts_expect_error_undocumented";

export interface Violation {
  path: string;
  line: number;
  reason: ReasonCode;
}

export interface GuardResult {
  changedTypeScriptFiles: number;
  addedTypeScriptLines: number;
  violations: Violation[];
}

export class GuardBlocked extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GuardBlocked";
  }
}

const TS_EXTENSIONS = [".ts", ".tsx", ".mts", ".cts"] as const;

export function isTypeScriptPath(path: string): boolean {
  return TS_EXTENSIONS.some((extension) => path.endsWith(extension));
}

export function isSafeGitRef(ref: string): boolean {
  return ref.length > 0 &&
    ref.length <= 160 &&
    /^[A-Za-z0-9][A-Za-z0-9._\/-]*$/.test(ref) &&
    !ref.includes("..") &&
    !ref.includes("//") &&
    !ref.endsWith("/") &&
    !ref.endsWith(".") &&
    !ref.includes("@{");
}

export interface CliArgs {
  base: string;
  head: string;
}

export function parseCliArgs(args: string[]): CliArgs {
  let base = "";
  let head = "";

  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--base") {
      base = args[++index] ?? "";
    } else if (arg === "--head") {
      head = args[++index] ?? "";
    } else {
      throw new GuardBlocked(`Unknown argument: ${arg}`);
    }
  }

  if (!isSafeGitRef(base) || !isSafeGitRef(head)) {
    throw new GuardBlocked("Both --base and --head must be safe Git refs.");
  }

  return { base, head };
}

/**
 * A real TypeScript comment, resolved from compiler trivia rather than from a
 * hand-written character scanner.
 */
export interface SourceComment {
  /** Full comment text, including its `//` or block delimiters. */
  text: string;
  /** 1-based first line covered by the comment. */
  startLine: number;
  /** 1-based last line covered by the comment. */
  endLine: number;
  /** Comment text restricted to a single 1-based line. */
  lineText: (line: number) => string;
}

export function scriptKindForPath(path: string): TypeScriptApi.ScriptKind {
  return path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
}

function lineOf(sourceFile: TypeScriptApi.SourceFile, position: number): number {
  return sourceFile.getLineAndCharacterOfPosition(position).line + 1;
}

/** Collect every real comment via compiler trivia over all token positions. */
export function collectComments(sourceFile: TypeScriptApi.SourceFile): SourceComment[] {
  const text = sourceFile.getFullText();
  const seen = new Set<number>();
  const comments: SourceComment[] = [];

  const record = (ranges: readonly TypeScriptApi.CommentRange[] | undefined) => {
    for (const range of ranges ?? []) {
      if (seen.has(range.pos)) continue;
      seen.add(range.pos);
      const commentText = text.slice(range.pos, range.end);
      const startLine = lineOf(sourceFile, range.pos);
      const commentLines = commentText.split("\n");
      comments.push({
        text: commentText,
        startLine,
        endLine: startLine + commentLines.length - 1,
        lineText: (line: number) => commentLines[line - startLine] ?? "",
      });
    }
  };

  const visit = (node: TypeScriptApi.Node): void => {
    if (node.kind !== ts.SyntaxKind.SourceFile) {
      record(ts.getLeadingCommentRanges(text, node.getFullStart()));
      record(ts.getTrailingCommentRanges(text, node.getEnd()));
    }
    for (const child of node.getChildren(sourceFile)) visit(child);
  };

  visit(sourceFile);
  return comments;
}

interface AnyOccurrence {
  line: number;
  /** True when the occurrence is the type of an `expr as any` cast. */
  isAsAnyCast: boolean;
}

/**
 * Collect real explicit `any` type syntax via AST nodes. Identifiers, property
 * names, string/template text, JSX text, regex literals and comments can never
 * produce an `AnyKeyword` node, so they are structurally excluded. Executable
 * template interpolations are ordinary expressions and remain inspected.
 */
export function collectExplicitAny(sourceFile: TypeScriptApi.SourceFile): AnyOccurrence[] {
  const occurrences: AnyOccurrence[] = [];

  const visit = (node: TypeScriptApi.Node): void => {
    if (node.kind === ts.SyntaxKind.AnyKeyword) {
      const parent = node.parent;
      const isAsAnyCast = parent !== undefined &&
        ts.isAsExpression(parent) &&
        parent.type === node;
      occurrences.push({ line: lineOf(sourceFile, node.getStart(sourceFile)), isAsAnyCast });
    }
    node.forEachChild(visit);
  };

  visit(sourceFile);
  return occurrences;
}

function documentedReasonAfter(commentText: string, marker: string): boolean {
  const markerIndex = commentText.indexOf(marker);
  if (markerIndex === -1) return false;
  const reason = commentText
    .slice(markerIndex + marker.length)
    .replace(/\*\/\s*$/, "")
    .trim();
  return reason.length > 0;
}

function isSuppressionDirectiveLine(
  commentLine: string,
  directive: "@ts-ignore" | "@ts-expect-error",
): boolean {
  const normalized = commentLine.replace(/^\s*(?:\/\/|\/\*+|\*)\s*/, "");
  if (!normalized.startsWith(directive)) return false;
  const next = normalized[directive.length] ?? "";
  return next === "" || !/[A-Za-z0-9_$-]/.test(next);
}

export function findViolationsInSource(
  path: string,
  source: string,
  addedLines: ReadonlySet<number>,
): Violation[] {
  const sourceFile = ts.createSourceFile(
    path,
    source,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    scriptKindForPath(path),
  );

  const rawLineCount = source.split("\n").length;
  const comments = collectComments(sourceFile);
  const anyOccurrences = collectExplicitAny(sourceFile);
  const violations: Violation[] = [];

  for (const line of [...addedLines].sort((a, b) => a - b)) {
    if (line < 1 || line > rawLineCount) {
      throw new GuardBlocked(`Added line ${line} is outside ${path}.`);
    }

    const commentsCoveringLine = comments.filter(
      (comment) => comment.startLine <= line && comment.endLine >= line,
    );

    const directiveOnLine = (directive: "@ts-ignore" | "@ts-expect-error") =>
      commentsCoveringLine.some((comment) =>
        isSuppressionDirectiveLine(comment.lineText(line), directive)
      );

    if (directiveOnLine("@ts-ignore")) {
      violations.push({ path, line, reason: "ts_ignore" });
    }

    if (directiveOnLine("@ts-expect-error")) {
      const documented = commentsCoveringLine.some((comment) => {
        const commentLine = comment.lineText(line);
        return isSuppressionDirectiveLine(commentLine, "@ts-expect-error") &&
          documentedReasonAfter(commentLine, TS_EXPECT_ERROR_EXCEPTION_MARKER);
      });
      if (!documented) {
        violations.push({ path, line, reason: "ts_expect_error_undocumented" });
      }
    }

    const anyOnLine = anyOccurrences.filter((occurrence) => occurrence.line === line);
    if (anyOnLine.length > 0) {
      const documentedAsAnyException = anyOnLine.every((occurrence) => occurrence.isAsAnyCast) &&
        commentsCoveringLine.some((comment) =>
          documentedReasonAfter(comment.text, ANY_EXCEPTION_MARKER)
        );
      if (!documentedAsAnyException) {
        violations.push({ path, line, reason: "explicit_any" });
      }
    }
  }

  return violations;
}

export interface AddedLinesByPath {
  [path: string]: Set<number>;
}

/** Parse a `git diff --unified=0 --no-renames` patch into added head lines. */
export function parseAddedLinesFromDiff(diff: string): AddedLinesByPath {
  const byPath: AddedLinesByPath = {};
  let currentPath: string | null = null;
  let headLine = 0;

  for (const line of diff.split("\n")) {
    if (line.startsWith("+++ ")) {
      const raw = line.slice(4);
      currentPath = raw === "/dev/null" ? null : raw.replace(/^b\//, "");
      continue;
    }

    const hunk = /^@@\s+-\d+(?:,\d+)?\s+\+(\d+)(?:,(\d+))?\s+@@/.exec(line);
    if (hunk) {
      headLine = Number(hunk[1]);
      continue;
    }

    if (!currentPath || line.startsWith("diff --git ") || line.startsWith("--- ")) {
      continue;
    }

    if (line.startsWith("+") && !line.startsWith("+++")) {
      if (isTypeScriptPath(currentPath)) {
        (byPath[currentPath] ??= new Set<number>()).add(headLine);
      }
      headLine++;
      continue;
    }

    if (line.startsWith("-")) continue;
    if (line.startsWith("\\ No newline at end of file")) continue;

    // Unified=0 should not contain context lines, but handle them correctly if
    // Git supplies one for format reasons.
    if (line.startsWith(" ")) headLine++;
  }

  return byPath;
}

async function runGit(args: string[]): Promise<string> {
  const command = new Deno.Command("git", {
    args,
    stdout: "piped",
    stderr: "piped",
  });
  const output = await command.output();
  if (!output.success) {
    const stderr = new TextDecoder().decode(output.stderr).trim();
    throw new GuardBlocked(stderr || `git ${args[0] ?? "command"} failed.`);
  }
  return new TextDecoder().decode(output.stdout);
}

async function verifyCommit(ref: string): Promise<void> {
  await runGit(["rev-parse", "--verify", `${ref}^{commit}`]);
}

async function readFileAtRef(ref: string, path: string): Promise<string> {
  return await runGit(["show", `${ref}:${path}`]);
}

export async function runGuard(base: string, head: string): Promise<GuardResult> {
  if (!isSafeGitRef(base) || !isSafeGitRef(head)) {
    throw new GuardBlocked("Unsafe Git ref supplied to guard.");
  }

  await verifyCommit(base);
  await verifyCommit(head);

  const diff = await runGit([
    "diff",
    "--unified=0",
    "--no-ext-diff",
    "--no-renames",
    base,
    head,
    "--",
    "*.ts",
    "*.tsx",
    "*.mts",
    "*.cts",
  ]);

  const additions = parseAddedLinesFromDiff(diff);
  const paths = Object.keys(additions).sort();
  const violations: Violation[] = [];
  let addedTypeScriptLines = 0;

  for (const path of paths) {
    const addedLines = additions[path];
    if (!addedLines || addedLines.size === 0) continue;
    addedTypeScriptLines += addedLines.size;
    const source = await readFileAtRef(head, path);
    violations.push(...findViolationsInSource(path, source, addedLines));
  }

  return {
    changedTypeScriptFiles: paths.length,
    addedTypeScriptLines,
    violations,
  };
}

function printResult(result: GuardResult): void {
  console.log(`ENG.0.2 TypeScript debt guard: ${GUARD_ID}`);
  console.log(`Changed TypeScript files with additions: ${result.changedTypeScriptFiles}`);
  console.log(`Added TypeScript lines inspected: ${result.addedTypeScriptLines}`);

  if (result.violations.length === 0) {
    console.log("Result: PASS — no new prohibited TypeScript debt detected.");
    return;
  }

  console.error(`Result: FAIL — ${result.violations.length} violation(s).`);
  for (const violation of result.violations) {
    console.error(`${violation.path}:${violation.line} [${violation.reason}]`);
  }
}

if (import.meta.main) {
  try {
    const { base, head } = parseCliArgs(Deno.args);
    const result = await runGuard(base, head);
    printResult(result);
    if (result.violations.length > 0) Deno.exit(1);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`ENG.0.2 TypeScript debt guard blocked: ${message}`);
    Deno.exit(2);
  }
}
