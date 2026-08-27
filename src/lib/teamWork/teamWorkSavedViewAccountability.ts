/**
 * TAE.9D — Saved-view compatibility helpers for the Team Work
 * Requester/Executor accountability filters.
 *
 * Kept as a small, dependency-free module so behavior can be tested without
 * mounting the full Team Work page. The four persisted fields are:
 *   - requester_stakeholder_ids?: string[]
 *   - executor_stakeholder_ids?: string[]
 *   - include_no_requester?: boolean
 *   - include_no_executors?: boolean
 *
 * All four are optional to preserve backward compatibility with existing
 * saved views. Absent fields default to empty arrays / false. No display
 * names, role labels, emails, project names, or decrypted payloads are
 * persisted — IDs and booleans only.
 */

export interface AccountabilitySavedViewFields {
  requester_stakeholder_ids?: string[];
  executor_stakeholder_ids?: string[];
  include_no_requester?: boolean;
  include_no_executors?: boolean;
}

export interface AccountabilityRuntimeState {
  requesterIds: string[];
  executorIds: string[];
  includeNoRequester: boolean;
  includeNoExecutors: boolean;
}

export const EMPTY_ACCOUNTABILITY_RUNTIME: AccountabilityRuntimeState = {
  requesterIds: [],
  executorIds: [],
  includeNoRequester: false,
  includeNoExecutors: false,
};

const isStringArray = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((x) => typeof x === "string");

/**
 * Contract validator: returns true if the four accountability fields on the
 * candidate saved-view object are either all absent, or, when present,
 * carry the correct types. Malformed present values are rejected.
 */
export function validateAccountabilitySavedViewFields(
  raw: Record<string, unknown>,
): boolean {
  const req = raw.requester_stakeholder_ids;
  const exe = raw.executor_stakeholder_ids;
  const noReq = raw.include_no_requester;
  const noExe = raw.include_no_executors;
  if (req !== undefined && !isStringArray(req)) return false;
  if (exe !== undefined && !isStringArray(exe)) return false;
  if (noReq !== undefined && typeof noReq !== "boolean") return false;
  if (noExe !== undefined && typeof noExe !== "boolean") return false;
  return true;
}

/**
 * Normalize the four persisted fields into runtime state, applying
 * backward-compatible defaults for older saved views.
 */
export function readAccountabilityFromSnapshot(
  snap: AccountabilitySavedViewFields,
): AccountabilityRuntimeState {
  return {
    requesterIds: isStringArray(snap.requester_stakeholder_ids)
      ? snap.requester_stakeholder_ids
      : [],
    executorIds: isStringArray(snap.executor_stakeholder_ids)
      ? snap.executor_stakeholder_ids
      : [],
    includeNoRequester:
      typeof snap.include_no_requester === "boolean"
        ? snap.include_no_requester
        : false,
    includeNoExecutors:
      typeof snap.include_no_executors === "boolean"
        ? snap.include_no_executors
        : false,
  };
}

/**
 * Serialize the runtime state into the four persisted fields for inclusion
 * in a Team Work saved-view snapshot.
 */
export function writeAccountabilityToSnapshot(
  state: AccountabilityRuntimeState,
): Required<AccountabilitySavedViewFields> {
  return {
    requester_stakeholder_ids: [...state.requesterIds],
    executor_stakeholder_ids: [...state.executorIds],
    include_no_requester: state.includeNoRequester,
    include_no_executors: state.includeNoExecutors,
  };
}

/**
 * Equality that treats absent fields as empty/false, so an older saved view
 * compares equal to a current state with no active accountability filters.
 */
export function accountabilitySnapshotEqual(
  a: AccountabilitySavedViewFields,
  b: AccountabilitySavedViewFields,
): boolean {
  const na = readAccountabilityFromSnapshot(a);
  const nb = readAccountabilityFromSnapshot(b);
  const eqArr = (x: string[], y: string[]) => {
    if (x.length !== y.length) return false;
    const xs = [...x].sort();
    const ys = [...y].sort();
    return xs.every((v, i) => v === ys[i]);
  };
  return (
    eqArr(na.requesterIds, nb.requesterIds) &&
    eqArr(na.executorIds, nb.executorIds) &&
    na.includeNoRequester === nb.includeNoRequester &&
    na.includeNoExecutors === nb.includeNoExecutors
  );
}
