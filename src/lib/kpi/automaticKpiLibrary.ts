/**
 * BTPM — Wave C1, Step C1.6b
 *
 * Re-export shim. The canonical implementation lives at
 * `supabase/functions/_shared/kpi/automaticKpiLibrary.ts` so the
 * Supabase Edge Function `capture-kpi-snapshot` (Deno bundler cannot
 * reach outside `supabase/`) and the Vite/React app share ONE
 * implementation. Do NOT add formula logic here.
 */
export * from "../../../supabase/functions/_shared/kpi/automaticKpiLibrary.ts";
