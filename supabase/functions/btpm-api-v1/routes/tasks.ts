// Canonical location: supabase/functions/_shared/btpm-api/routes/tasks.ts
// This shim keeps the historical btpm-api-v1 import path working while the
// contract lives in _shared so every function bundle can reach it.
export * from "../../_shared/btpm-api/routes/tasks.ts";
