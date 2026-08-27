#!/usr/bin/env node
/**
 * version-step.mjs — Bumps package.json patch version once per approved
 * implementation step. Run `npm run version:step` BEFORE making code changes
 * for a new step.
 *
 * Cross-platform (pure Node), no shell-specific syntax.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkgPath = resolve(__dirname, "..", "package.json");

const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
const current = String(pkg.version || "0.0.0");
const parts = current.split(".").map((n) => parseInt(n, 10));
if (parts.length !== 3 || parts.some((n) => Number.isNaN(n))) {
  console.error(`[version-step] Invalid current version: ${current}`);
  process.exit(1);
}
parts[2] += 1;
const next = parts.join(".");
pkg.version = next;
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n", "utf8");
console.log(`[version-step] ${current} -> ${next}`);
