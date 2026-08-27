// Canonical location: supabase/functions/_shared/btpm-api/routes/workspaceMembers.ts
// This shim keeps the btpm-api-v1 import path consistent with the other route
// contracts while the canonical definition lives in _shared so every function
// bundle can reach it.
export * from "../../_shared/btpm-api/routes/workspaceMembers.ts";
