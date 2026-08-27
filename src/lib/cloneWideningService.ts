/**
 * Helper for parsing BTPM_REQUIRES_WIDENING:{json} errors raised by
 * instantiate_project_from_template / clone_phase_in_project / clone_task_in_phase.
 *
 * The apply RPCs raise this structured error when the new (re-anchored) child
 * graph would not fit inside its parent's current planned window. The UI
 * should catch it, show a confirmation dialog using the parsed payload, and
 * re-call the same apply RPC with _confirm_widening = true.
 */

export interface WideningPayload {
  scope: "project_template_instantiation" | "phase_clone" | "task_clone";
  // Project-instantiation flavor
  nominal_start?: string | null;
  nominal_end?: string | null;
  effective_start?: string | null;
  effective_end?: string | null;
  // Phase/task-clone flavor
  parent_project_id?: string;
  parent_project_name?: string;
  parent_phase_id?: string;
  parent_phase_name?: string;
  parent_current_start?: string | null;
  parent_current_end?: string | null;
  parent_proposed_start?: string | null;
  parent_proposed_end?: string | null;
  reasons?: Array<{ kind: string; name?: string; date?: string }>;
}

const PREFIX = "BTPM_REQUIRES_WIDENING:";

export function parseWideningError(err: unknown): WideningPayload | null {
  // PostgrestError surfaces the RAISE text across message/details/hint depending
  // on the driver version; fall back to JSON-stringifying the whole object so
  // we never miss the prefix.
  let message = "";
  if (typeof err === "string") {
    message = err;
  } else if (err && typeof err === "object") {
    const e = err as Record<string, unknown>;
    const parts = [e.message, e.details, e.hint, e.error_description]
      .filter((v) => typeof v === "string")
      .join(" || ");
    message = parts;
    if (message.indexOf(PREFIX) === -1) {
      try {
        message = `${parts} || ${JSON.stringify(err)}`;
      } catch {
        // ignore
      }
    }
  }
  const idx = message.indexOf(PREFIX);
  if (idx === -1) return null;
  const jsonStart = message.indexOf("{", idx);
  if (jsonStart === -1) return null;
  // Find the matching closing brace (greedy from the end is unsafe; rely on
  // the fact that pg surfaces the entire RAISE message as one string).
  const jsonText = message.slice(jsonStart);
  // Trim trailing context appended by some pg drivers
  let depth = 0;
  let endIdx = -1;
  for (let i = 0; i < jsonText.length; i++) {
    const ch = jsonText[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        endIdx = i + 1;
        break;
      }
    }
  }
  if (endIdx === -1) return null;
  try {
    return JSON.parse(jsonText.slice(0, endIdx)) as WideningPayload;
  } catch {
    return null;
  }
}
