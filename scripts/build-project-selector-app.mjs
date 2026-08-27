// API-Q.PS.3 — Deterministic build/generation script for the MCP Apps
// Project-selector View.
//
// Builds the dedicated single-file widget with Vite + vite-plugin-singlefile,
// reads the produced self-contained HTML document, and serializes it into the
// committed generated TypeScript module consumed by the Supabase Edge Function.
//
// The Edge Function therefore never performs a runtime Vite build and never
// reads the filesystem at runtime.

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tempOutDir = path.join(repoRoot, ".tmp", "project-selector-app");
const builtHtmlPath = path.join(tempOutDir, "index.html");
const generatedModulePath = path.join(
  repoRoot,
  "supabase",
  "functions",
  "btpm-mcp",
  "mcp",
  "projectSelectorAppHtml.generated.ts",
);

function buildWidget() {
  mkdirSync(path.dirname(tempOutDir), { recursive: true });
  execFileSync(
    process.execPath,
    [
      path.join(repoRoot, "node_modules", "vite", "bin", "vite.js"),
      "build",
      "--config",
      path.join(repoRoot, "vite.project-selector-app.config.ts"),
    ],
    { cwd: repoRoot, stdio: "inherit" },
  );
}

/** Serializes the HTML into a TypeScript string literal safely and stably. */
function serializeHtml(html) {
  return JSON.stringify(html);
}

function writeGeneratedModule(html) {
  const contents = `// AUTO-GENERATED — do not edit manually.
//
// Source: supabase/functions/btpm-mcp/mcp/project-selector-app/
// Generator: scripts/build-project-selector-app.mjs (npm run build:project-selector-app)
//
// This module contains the complete, self-contained single-file HTML document
// for the MCP Apps resource \`ui://btpm/project-selector\`. All widget
// JavaScript and CSS is inlined: there is no external script, stylesheet, font,
// image or network reference, and no runtime filesystem read.

/** Complete built single-file HTML document for the BTPM Project selector. */
export const BTPM_PROJECT_SELECTOR_GENERATED_HTML: string = ${serializeHtml(html)};
`;
  writeFileSync(generatedModulePath, contents, "utf8");
}

function main() {
  rmSync(tempOutDir, { recursive: true, force: true });
  buildWidget();
  const html = readFileSync(builtHtmlPath, "utf8");
  writeGeneratedModule(html);
  rmSync(tempOutDir, { recursive: true, force: true });
  console.log(
    `Generated ${path.relative(repoRoot, generatedModulePath)} (${html.length} bytes of HTML).`,
  );
}

main();
