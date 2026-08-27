# API-F.3A — Explicit wrapper transaction contract

Marker: **API-F.3A — Explicit wrapper transaction contract**

Status: contract-only. This document freezes the shared database transaction
pattern that every future explicit external command wrapper MUST follow.
No generic executor and no real business-command wrapper is created in this
step.

## Scope

Every API-driven mutation exposed to external callers requires a
**dedicated database wrapper** mapped to **exactly one hardcoded canonical PMG command**.

The mapping between a wrapper and its PMG command is fixed at authoring time
and encoded literally in the wrapper's SQL — it is never resolved at runtime.

## Prohibited wrapper inputs

An explicit wrapper MUST NOT accept, and MUST NOT internally resolve, any of
the following:

- a function name;
- an RPC name;
- a table name;
- SQL text;
- a generic command handler;
- a generic payload intended for arbitrary dispatch.

Wrapper parameters MUST be a fixed, typed, route-specific parameter list.

## Required transaction sequence

Each explicit wrapper MUST execute the following steps, in order, inside a
single database transaction:

1. **Derive authoritative scope.**
   The wrapper derives the authoritative Tenant, Organization, Workspace,
   Project, Phase, and Task scope from its **fixed target and parameters**.
   Scope is never taken from the caller.

2. **Establish trusted context.**
   The wrapper calls the existing helper:

   ```sql
   api_e_private.authorize_and_establish(
     _api_version   := <wrapper's fixed API version>,
     _capability_kind := 'command',
     _capability_key  := <wrapper's fixed capability key>,
     ...
   )
   ```

   If trusted context cannot be established, the wrapper stops with a
   controlled, **non-enumerating** authorization failure. It MUST NOT leak
   the reason or reveal the existence or state of any object.

3. **Claim idempotency.**
   The wrapper calls:

   ```sql
   api_e_private.claim_idempotency(_command, _idempotency_key, _payload_hash)
   ```

   where `_command` is the wrapper's **fixed capability key**, identical to
   the value passed to `authorize_and_establish`.

4. **Handle the claim decision.**

   - `conflict` → return a safe idempotency-conflict outcome. **Do not**
     invoke PMG.
   - `pending`  → return a safe in-progress outcome. **Do not** invoke PMG.
   - `replay`   → return the stored bounded canonical result or stable
     failure code from the registry. **Do not** invoke PMG.
   - `execute`  → proceed to the wrapper's one hardcoded PMG call.
   - anything else → fail closed.

5. **Invoke exactly one hardcoded canonical PMG function.**
   The `execute` branch calls exactly one PMG function, referenced by its
   literal fully-qualified name in the wrapper's SQL. There is no lookup,
   no CASE-based dispatch, no dynamic resolution.

   The PMG call preserves all existing PMG behavior, including:

   - user authority;
   - target-derived scope;
   - Tenant and Workspace containment;
   - demo/read-only controls;
   - encryption and protected handling;
   - optimistic concurrency;
   - confirmation requirements;
   - PMG audit;
   - canonical PMG result behavior.

6. **Build a bounded, safe canonical result.**
   The wrapper converts the PMG result into a route-specific canonical
   result object containing **only safe fields required to replay that
   route**, such as:

   - canonical object IDs;
   - status;
   - version or concurrency timestamp;
   - safe response metadata.

   The canonical result MUST NOT contain:

   - raw request payloads;
   - narrative content;
   - credentials, tokens, or secrets;
   - SQL text;
   - stack traces;
   - raw database error messages.

7. **Complete idempotency.**
   The wrapper calls:

   ```sql
   api_e_private.complete_idempotency(_registry_id, _canonical_result)
   ```

   **only after** both the PMG command and the safe canonical result
   construction succeed.

8. **Return the route-specific canonical result** to the caller.

## Failure propagation

Unexpected PMG or database exceptions MUST NOT be caught merely to commit a
failed registry state. Unexpected exceptions MUST propagate so the
surrounding database transaction rolls back:

- the PMG mutation;
- its audit write;
- the new idempotency claim;
- any partial state.

`api_e_private.fail_idempotency(_registry_id, _failure_code)` MAY be used
**only** for an intentional, stable, safe terminal failure code that the
explicit wrapper deliberately chooses to persist and replay. It MUST NEVER
store raw exception messages or internal database details.

## Mandatory anti-generic rules

Explicit wrappers, and any code called from them for dispatch purposes, MUST
NOT use, contain, or depend on:

- dynamic SQL;
- PL/pgSQL `EXECUTE`;
- `regprocedure` or function-OID dispatch;
- a command-to-function lookup table;
- a CASE statement that dispatches arbitrary PMG commands;
- generic table CRUD;
- PostgREST write passthrough;
- consumer-controlled provenance;
- service-role impersonation;
- committing an idempotency result separately from its PMG mutation.

## Enforcement

- The static test
  `supabase/functions/_shared/api-f-3-database-execution-wrapper_static_test.ts`
  verifies this contract, the private helper properties, the absence of any
  generic executor in the API-F.2 migrations, and the absence of any public
  wrapper for the three private helpers.
- A dedicated repository-validation step runs that test on every push.
