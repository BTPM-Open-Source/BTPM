import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

export const REPO_ROOT = resolve(__dirname, "..", "..");
export const MIGRATIONS_DIR = join(REPO_ROOT, "supabase", "migrations");

interface SqlMigration {
  readonly name: string;
  readonly sql: string;
}

let migrationCache: readonly SqlMigration[] | null = null;

export function cleanMigrations(): readonly SqlMigration[] {
  if (migrationCache) return migrationCache;
  migrationCache = readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .map((name) => ({
      name,
      sql: readFileSync(join(MIGRATIONS_DIR, name), "utf8"),
    }));
  return migrationCache;
}

export function sqlCorpus(): string {
  return cleanMigrations()
    .map(({ name, sql }) => `\n-- FILE: ${name}\n${sql}`)
    .join("\n");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function normalizeSql(value: string): string {
  return value.replace(/\r\n/g, "\n").replace(/\s+/g, " ").trim();
}

export function allFunctionDefinitions(
  name: string,
  schema = "public",
): readonly string[] {
  const qualified = `${escapeRegExp(schema)}\\.${escapeRegExp(name)}`;
  const header = new RegExp(
    `CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+${qualified}\\s*\\(`,
    "gi",
  );
  const definitions: string[] = [];

  for (const { sql } of cleanMigrations()) {
    header.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = header.exec(sql)) !== null) {
      const start = match.index;
      const tail = sql.slice(start);
      const asMatch = /\bAS\s+(\$[A-Za-z0-9_]*\$)/i.exec(tail);
      if (!asMatch) {
        throw new Error(`AS delimiter not found for ${schema}.${name}`);
      }
      const delimiter = asMatch[1];
      const bodyStart = start + asMatch.index + asMatch[0].length;
      const close = sql.indexOf(delimiter, bodyStart);
      if (close < 0) {
        throw new Error(`Closing delimiter not found for ${schema}.${name}`);
      }
      const semicolon = sql.indexOf(";", close + delimiter.length);
      if (semicolon < 0) {
        throw new Error(`Function terminator not found for ${schema}.${name}`);
      }
      definitions.push(sql.slice(start, semicolon + 1));
      header.lastIndex = semicolon + 1;
    }
  }

  return definitions;
}

export function currentFunction(
  name: string,
  options: {
    readonly schema?: string;
    readonly includes?: readonly string[];
  } = {},
): string {
  const schema = options.schema ?? "public";
  const includes = options.includes ?? [];
  const matches = allFunctionDefinitions(name, schema).filter((definition) =>
    includes.every((token) => definition.includes(token)),
  );
  if (matches.length === 0) {
    throw new Error(
      `Current function not found: ${schema}.${name}` +
        (includes.length ? ` containing ${includes.join(", ")}` : ""),
    );
  }
  return matches[matches.length - 1];
}

export function tableDefinition(name: string, schema = "public"): string {
  const qualified = `${escapeRegExp(schema)}\\.${escapeRegExp(name)}`;
  const pattern = new RegExp(
    `CREATE\\s+TABLE\\s+${qualified}\\s*\\([\\s\\S]*?\\n\\);`,
    "i",
  );
  for (const { sql } of cleanMigrations()) {
    const match = pattern.exec(sql);
    if (match) return match[0];
  }
  throw new Error(`Table definition not found: ${schema}.${name}`);
}

export function policyDefinition(
  policyName: string,
  tableName: string,
  schema = "public",
): string {
  const corpus = sqlCorpus();
  const pattern = new RegExp(
    `CREATE\\s+POLICY\\s+${escapeRegExp(policyName)}\\s+ON\\s+${escapeRegExp(schema)}\\.${escapeRegExp(tableName)}[\\s\\S]*?;`,
    "i",
  );
  const match = pattern.exec(corpus);
  if (!match) {
    throw new Error(`Policy definition not found: ${schema}.${tableName}.${policyName}`);
  }
  return match[0];
}

export function functionAcl(name: string, schema = "public"): string {
  const corpus = sqlCorpus();
  const qualified = `${escapeRegExp(schema)}\\.${escapeRegExp(name)}`;
  const pattern = new RegExp(
    `(?:REVOKE|GRANT)\\s+[^;]*?ON\\s+FUNCTION\\s+${qualified}\\s*\\([^;]*?;`,
    "gi",
  );
  return (corpus.match(pattern) ?? []).join("\n");
}

export function tableAcl(name: string, schema = "public"): string {
  const corpus = sqlCorpus();
  const qualified = `${escapeRegExp(schema)}\\.${escapeRegExp(name)}`;
  const pattern = new RegExp(
    `(?:REVOKE|GRANT)\\s+[^;]*?ON\\s+TABLE\\s+${qualified}\\s+[^;]*?;`,
    "gi",
  );
  return (corpus.match(pattern) ?? []).join("\n");
}

export function sqlStatementsContaining(...tokens: readonly string[]): string {
  const statements = sqlCorpus().split(/;\s*(?:\n|$)/);
  return statements
    .filter((statement) => tokens.every((token) => statement.includes(token)))
    .map((statement) => `${statement.trim()};`)
    .join("\n");
}
