/**
 * BTPM — Wave C1, Step C1.6b
 *
 * Re-export shim. Canonical implementation:
 * `supabase/functions/_shared/kpi/kpiCalculationEngine.ts`.
 * Single source of truth shared between the Supabase Edge Function
 * `capture-kpi-snapshot` and the Vite/React app. Do NOT add formula
 * logic here.
 */
export * from "../../../supabase/functions/_shared/kpi/kpiCalculationEngine.ts";
