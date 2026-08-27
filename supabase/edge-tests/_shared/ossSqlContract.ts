// Open-source publication test support.
//
// The publication candidate intentionally carries a clean forward-only migration
// set rather than the private repository's historical timestamped migration
// chain. Deno/API-Q static tests must therefore inspect the current canonical SQL
// state semantically instead of depending on historical migration names/markers.
//
// This module is test-only. It performs read-only filesystem inspection and no
// network/database access.

export interface SqlMigration {
  readonly name: string;
  readonly sql: string;
}

export type FunctionAclAction = "GRANT" | "REVOKE";
export type FunctionAclPrivilege = "ALL" | "EXECUTE";

const MIGRATIONS_DIR = new URL("../../migrations/", import.meta.url);
let migrationCache: readonly SqlMigration[] | null = null;

export function normalizeEol(value: string): string {
  return value.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

export async function readTextNormalized(path: string | URL): Promise<string> {
  return normalizeEol(await Deno.readTextFile(path));
}

export function readTextNormalizedSync(path: string | URL): string {
  return normalizeEol(Deno.readTextFileSync(path));
}

export async function cleanMigrations(): Promise<readonly SqlMigration[]> {
  if (migrationCache) return migrationCache;
  const migrations: SqlMigration[] = [];
  for await (const entry of Deno.readDir(MIGRATIONS_DIR)) {
    if (!entry.isFile || !entry.name.endsWith(".sql")) continue;
    migrations.push({
      name: entry.name,
      sql: normalizeEol(await Deno.readTextFile(new URL(entry.name, MIGRATIONS_DIR))),
    });
  }
  migrations.sort((a, b) => a.name.localeCompare(b.name));
  migrationCache = Object.freeze(migrations);
  return migrationCache;
}

export async function sqlCorpus(): Promise<string> {
  return (await cleanMigrations())
    .map(({ name, sql }) => `\n-- FILE: ${name}\n${sql}`)
    .join("\n");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function normalizeSql(value: string): string {
  return normalizeEol(value).replace(/\s+/g, " ").trim();
}

export function stripSqlComments(sql: string): string {
  let out = "";
  let i = 0;
  while (i < sql.length) {
    const two = sql.slice(i, i + 2);
    if (two === "--") {
      while (i < sql.length && sql[i] !== "\n") i++;
      continue;
    }
    if (two === "/*") {
      i += 2;
      while (i < sql.length && sql.slice(i, i + 2) !== "*/") i++;
      i += 2;
      continue;
    }
    out += sql[i];
    i++;
  }
  return out;
}

export async function allFunctionDefinitions(
  name: string,
  schema = "public",
): Promise<readonly string[]> {
  const qualified = `${escapeRegExp(schema)}\\.${escapeRegExp(name)}`;
  const header = new RegExp(
    `CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+${qualified}\\s*\\(`,
    "gi",
  );
  const definitions: string[] = [];

  for (const { sql } of await cleanMigrations()) {
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

export async function currentFunction(
  name: string,
  options: {
    readonly schema?: string;
    readonly includes?: readonly string[];
  } = {},
): Promise<string> {
  const schema = options.schema ?? "public";
  const includes = options.includes ?? [];
  const matches = (await allFunctionDefinitions(name, schema)).filter((definition) =>
    includes.every((token) => definition.includes(token))
  );
  if (matches.length === 0) {
    throw new Error(
      `Current function not found: ${schema}.${name}` +
        (includes.length ? ` containing ${includes.join(", ")}` : ""),
    );
  }
  return matches[matches.length - 1];
}

export async function tableDefinition(name: string, schema = "public"): Promise<string> {
  const qualified = `${escapeRegExp(schema)}\\.${escapeRegExp(name)}`;
  const pattern = new RegExp(
    `CREATE\\s+TABLE\\s+${qualified}\\s*\\([\\s\\S]*?\\n\\);`,
    "i",
  );
  for (const { sql } of await cleanMigrations()) {
    const match = pattern.exec(sql);
    if (match) return match[0];
  }
  throw new Error(`Table definition not found: ${schema}.${name}`);
}

export async function functionAclStatements(
  name: string,
  schema = "public",
): Promise<readonly string[]> {
  const corpus = stripSqlComments(await sqlCorpus());
  const qualified = `${escapeRegExp(schema)}\\.${escapeRegExp(name)}`;
  const pattern = new RegExp(
    `\\b(?:REVOKE|GRANT)\\s+[^;]*?\\bON\\s+FUNCTION\\s+${qualified}\\s*\\([^;]*?\\)\\s+(?:TO|FROM)\\s+[^;]+;`,
    "gi",
  );
  return corpus.match(pattern) ?? [];
}

export async function hasFunctionAcl(
  name: string,
  expectation: {
    readonly action: FunctionAclAction;
    readonly role: string;
    readonly privilege?: FunctionAclPrivilege;
    readonly schema?: string;
  },
): Promise<boolean> {
  const statements = await functionAclStatements(name, expectation.schema ?? "public");
  const expectedRole = expectation.role.toLowerCase();

  return statements.some((statement) => {
    const normalized = normalizeSql(statement);
    const head = /^(GRANT|REVOKE)\s+(ALL(?:\s+PRIVILEGES)?|EXECUTE)\s+ON\s+FUNCTION\b/i.exec(
      normalized,
    );
    if (!head || head[1].toUpperCase() !== expectation.action) return false;

    const actualPrivilege: FunctionAclPrivilege = head[2].toUpperCase().startsWith("ALL")
      ? "ALL"
      : "EXECUTE";
    if (expectation.privilege && actualPrivilege !== expectation.privilege) return false;

    const direction = expectation.action === "GRANT" ? "TO" : "FROM";
    const roleMatch = new RegExp(`\\s${direction}\\s+(.+?)\\s*;?$`, "i").exec(normalized);
    if (!roleMatch) return false;

    const roles = roleMatch[1]
      .split(",")
      .map((role) => role.trim().replace(/^"|"$/g, "").toLowerCase());
    return roles.includes(expectedRole);
  });
}

export async function functionAcl(name: string, schema = "public"): Promise<string> {
  return (await functionAclStatements(name, schema)).join("\n");
}

export async function tableAcl(name: string, schema = "public"): Promise<string> {
  const corpus = await sqlCorpus();
  const qualified = `${escapeRegExp(schema)}\\.${escapeRegExp(name)}`;
  const pattern = new RegExp(
    `(?:REVOKE|GRANT)\\s+[^;]*?ON\\s+TABLE\\s+${qualified}\\s+[^;]*?;`,
    "gi",
  );
  return (corpus.match(pattern) ?? []).join("\n");
}

export async function sqlStatementsContaining(...tokens: readonly string[]): Promise<string> {
  const statements = (await sqlCorpus()).split(/;\s*(?:\n|$)/);
  return statements
    .filter((statement) => tokens.every((token) => statement.includes(token)))
    .map((statement) => `${statement.trim()};`)
    .join("\n");
}

export async function currentFunctionContract(
  name: string,
  options: {
    readonly schema?: string;
    readonly includes?: readonly string[];
    readonly includeAcl?: boolean;
  } = {},
): Promise<string> {
  const schema = options.schema ?? "public";
  const definition = await currentFunction(name, {
    schema,
    includes: options.includes,
  });
  if (options.includeAcl === false) return definition;
  const acl = await functionAcl(name, schema);
  return acl ? `${definition}\n${acl}` : definition;
}
