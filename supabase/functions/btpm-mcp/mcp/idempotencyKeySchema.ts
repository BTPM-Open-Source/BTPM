// MCP-HARDENING-C7 — presentation-only canonical idempotency-key MCP schema.
//
// This module owns NO idempotency policy. It contains no regex literal, no
// length constant, no error code, no trimming rule of its own. It exists solely
// so every exposed MCP mutation can ADVERTISE the already accepted canonical
// API-F idempotency-key value contract instead of a generic `z.string()`.
//
// The canonical validator `validateIdempotencyKey` in
// `../../_shared/btpm-api/idempotency.ts` remains the single authoritative
// runtime validation path, reached through
// `buildMcpMutationExecutionContext`. This schema is discoverability and
// transport normalization only.

import { z } from "npm:zod@4.4.3";

import { IDEMPOTENCY_KEY_PATTERN } from "../../_shared/btpm-api/idempotency.ts";

/**
 * The single shared MCP presentation schema for `idempotencyKey`.
 *
 * Behavior:
 *   - the input must be a string (non-strings are rejected);
 *   - canonical outer whitespace is accepted and trimmed away;
 *   - the closed canonical pattern (which itself carries the 1–255 normalized
 *     length bound) is applied to the trimmed value.
 *
 * The parsed value is therefore identical to the canonical trimmed key.
 */
export const MCP_IDEMPOTENCY_KEY_SCHEMA = z
  .string()
  .trim()
  .regex(IDEMPOTENCY_KEY_PATTERN);
