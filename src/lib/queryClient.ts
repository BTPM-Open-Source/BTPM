/**
 * Shared QueryClient instance.
 *
 * Extracted from App.tsx so the release gate (src/release/releaseGate.ts) can
 * clear the cache before React mounts when a new build is detected.
 */
import { QueryClient } from "@tanstack/react-query";

export const queryClient = new QueryClient();
