// Phase 4D.14A.6B — Compatibility wrapper.
//
// Historically this module held both a Global-secret Graph token
// factory (`getGraphToken`) and a `downloadDriveItemBytes` transport
// helper. The Global-secret path has been REMOVED. Graph credentials
// are now resolved per-Organization via
// `resolveTenantMicrosoftGraphRuntimeConfig` and the acquired token
// MUST be supplied explicitly by the caller.
//
// This file now contains ONLY the download helper, delegating to the
// canonical transport-only helper in `microsoftGraphClient.ts`. It:
//   - never reads `M365_*` env vars;
//   - never resolves Tenant / Organization / integration / credentials;
//   - never acquires tokens;
//   - never caches tokens;
//   - never logs Authorization headers, tokens, response bodies,
//     drive/item IDs, or full Graph paths.

import {
  downloadMicrosoftGraphDriveItemBytes,
  type MicrosoftGraphRuntimeOperation,
} from "./microsoftGraphClient.ts";

export async function downloadDriveItemBytes(
  graphToken: string,
  driveId: string,
  itemId: string,
  opts?: {
    operation?: MicrosoftGraphRuntimeOperation;
    requestId?: string;
  },
): Promise<
  | { ok: true; bytes: Uint8Array }
  | { ok: false; status: number; error: string }
> {
  const result = await downloadMicrosoftGraphDriveItemBytes({
    accessToken: graphToken,
    driveId,
    itemId,
    operation: opts?.operation ?? "download_roadmap_story_source",
    requestId: opts?.requestId ?? crypto.randomUUID(),
  });
  if (result.ok && result.bytes) {
    return { ok: true, bytes: result.bytes };
  }
  return {
    ok: false,
    status: result.httpStatus ?? 0,
    error: `graph_${result.category}`,
  };
}
