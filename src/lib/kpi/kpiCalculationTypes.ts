/**
 * BTPM — Wave C1, Step C1.6b
 *
 * Re-export shim. Canonical implementation:
 * `supabase/functions/_shared/kpi/kpiCalculationTypes.ts`.
 *
 * Note: the canonical module inlines `ReportingScheduleSignal` so it
 * stays Deno-safe. The app's `src/lib/reportingSummary.ts` exports an
 * identically-shaped union, so consumer code remains type-compatible.
 */
export * from "../../../supabase/functions/_shared/kpi/kpiCalculationTypes.ts";
