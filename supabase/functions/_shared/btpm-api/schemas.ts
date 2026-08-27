// API-G.1G — Common Zod validation foundation for API v1.
//
// Provides canonical UUID validation, strict empty-object and
// path-parameter schemas, and a safe parser that maps validation
// failures to a public `invalid_request` HTTP error without leaking
// supplied values, Zod issues, schema names, regex patterns or paths.

import { z } from "npm:zod@3.25.76";
import { ApiHttpError } from "./http.ts";

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Canonical UUID schema. Accepts only strings that match RFC 4122
 * versions 1–5 with variant 10xx. Performs no trimming, coercion or
 * normalization; the valid input string is returned unchanged.
 */
export const apiUuidSchema = z
  .string()
  .refine((value) => UUID_REGEX.test(value));

/**
 * Strict empty-object schema. Accepts only a plain object with no
 * enumerable properties. Rejects arrays, primitives, null and undefined.
 */
export const apiEmptyObjectSchema = z.object({}).strict();

export const apiOrganizationPathParamsSchema = z
  .object({ organizationId: apiUuidSchema })
  .strict();

export const apiProjectPathParamsSchema = z
  .object({ projectId: apiUuidSchema })
  .strict();

export const apiPhasePathParamsSchema = z
  .object({ phaseId: apiUuidSchema })
  .strict();

export const apiTaskPathParamsSchema = z
  .object({ taskId: apiUuidSchema })
  .strict();

export type ApiOrganizationPathParams = z.infer<
  typeof apiOrganizationPathParamsSchema
>;
export type ApiProjectPathParams = z.infer<typeof apiProjectPathParamsSchema>;
export type ApiPhasePathParams = z.infer<typeof apiPhasePathParamsSchema>;
export type ApiTaskPathParams = z.infer<typeof apiTaskPathParamsSchema>;

/**
 * Safely evaluate a Zod schema against untrusted input.
 *
 * - Ordinary validation failures throw `ApiHttpError("invalid_request")`
 *   with no internal cause, so supplied values and Zod issues cannot
 *   escape into responses or observability.
 * - `ApiHttpError` instances thrown from within schema execution are
 *   preserved as the exact same instance.
 * - Any other thrown value is wrapped as `ApiHttpError("internal_error")`
 *   with the original cause retained internally only.
 */
export function parseApiSchema<T extends z.ZodTypeAny>(
  schema: T,
  input: unknown,
): z.output<T> {
  let result: z.SafeParseReturnType<unknown, z.output<T>>;
  try {
    result = schema.safeParse(input);
  } catch (cause) {
    if (cause instanceof ApiHttpError) {
      throw cause;
    }
    throw new ApiHttpError("internal_error", cause);
  }
  if (result.success) {
    return result.data;
  }
  throw new ApiHttpError("invalid_request");
}
