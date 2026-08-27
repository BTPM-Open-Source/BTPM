// MCP-HARDENING-C5 — presentation-only closed-vocabulary Zod construction.
//
// This module owns NO vocabulary. It contains no value literal, no default and
// no business rule. It exists solely so an MCP transport schema can advertise a
// closed enum that is derived from an already accepted canonical API vocabulary
// authority supplied as a read-only iterable/collection — for example a
// `ReadonlySet<string>` (Portfolio canonical authorities) or a
// `readonly string[]` (KPI canonical authorities) — instead of a generic
// `z.string()`.
//
// It performs no validation of its own beyond membership in the canonical
// vocabulary it is given, reads no environment variable, creates no client and
// persists nothing. Canonical API parsers remain the sole business-validation
// and defaulting authority.

import { z } from "npm:zod@4.4.3";

/**
 * A narrow read-only collection contract. Any canonical vocabulary authority
 * that is a read-only iterable of strings qualifies: a `ReadonlySet<string>`
 * (Portfolio authorities) or a `readonly string[]` (KPI authorities). The
 * helper only iterates it; it never mutates, sorts, filters or extends it.
 */
export type CanonicalVocabularyCollection = Iterable<string>;

/**
 * Builds a closed Zod enum from an existing canonical vocabulary authority.
 *
 * The caller supplies the canonical union type as `TValue`, so the resulting
 * schema infers the canonical type without redeclaring any value literal.
 */
export function buildClosedVocabularySchema<TValue extends string>(
  canonicalVocabulary: CanonicalVocabularyCollection,
): z.ZodType<TValue> {
  const values = [...canonicalVocabulary];
  if (values.length === 0) {
    // A canonical vocabulary is never empty; failing loudly beats advertising
    // an unconstructable schema.
    throw new Error("A canonical closed vocabulary must not be empty.");
  }
  return z.enum(values as [string, ...string[]]) as unknown as z.ZodType<
    TValue
  >;
}
