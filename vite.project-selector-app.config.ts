// API-Q.PS.3 — Dedicated Vite build for the MCP Apps Project-selector View.
//
// This is a narrowly scoped, single-file widget build. It does NOT alter the
// ordinary BTPM application build/prebuild behavior and never writes into the
// main BTPM `dist/`.

import { defineConfig } from "vite";
import path from "path";
import { viteSingleFile } from "vite-plugin-singlefile";

const appRoot = path.resolve(
  __dirname,
  "./supabase/functions/btpm-mcp/mcp/project-selector-app",
);

export default defineConfig({
  root: appRoot,
  // Deterministic, dependency-free output: everything inlined into one HTML.
  plugins: [viteSingleFile({ removeViteModuleLoader: true })],
  build: {
    outDir: path.resolve(__dirname, "./.tmp/project-selector-app"),
    emptyOutDir: true,
    target: "es2020",
    assetsInlineLimit: 100_000_000,
    cssCodeSplit: false,
    modulePreload: false,
    sourcemap: false,
    minify: "esbuild",
    reportCompressedSize: false,
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
      },
    },
  },
});
