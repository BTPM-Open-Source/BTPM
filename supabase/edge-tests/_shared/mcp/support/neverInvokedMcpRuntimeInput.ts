// MCP-HARDENING-C3 — TEST-ONLY support module.
//
// Several MCP endpoint tests exercise behaviour that fails *before* any runtime
// dependency can be used (for example authentication failure returning 401).
// Those tests previously hand-listed every dependency of
// `BtpmMcpRuntimeInput`, which is a maintained inventory: every new canonical
// reader/writer broke them even though the tested behaviour never changed.
//
// This helper replaces that inventory with a durable structural invariant:
// every dependency that is NOT explicitly provided by the test is a stub that
// throws/rejects the moment it is touched. So the test still proves "no
// dependency was invoked", without tracking the dependency list.
//
// No production module is modified and no production type is widened.

import type { BtpmMcpRuntimeInput } from "../../../../functions/btpm-mcp/index.ts";

const NEVER_INVOKED_MESSAGE =
  "MCP runtime dependency must not be invoked in this test";

/**
 * A deeply lazy stub: callable (rejects) and every property access yields
 * another equally strict stub. Suitable for object-shaped dependencies such as
 * `{ resolve }` / `{ consume }` as well as bare function dependencies.
 */
function neverInvokedStub(path: string): unknown {
  const target = () => Promise.reject(new Error(`${NEVER_INVOKED_MESSAGE}: ${path}`));
  return new Proxy(target, {
    apply() {
      return Promise.reject(new Error(`${NEVER_INVOKED_MESSAGE}: ${path}`));
    },
    get(_target, property) {
      if (property === "then") return undefined; // never mistaken for a thenable
      return neverInvokedStub(`${path}.${String(property)}`);
    },
  });
}

/**
 * Builds a complete `BtpmMcpRuntimeInput` from the explicitly supplied
 * dependencies. Anything omitted is a never-invoked stub.
 */
export function neverInvokedMcpRuntimeInput(
  provided: Partial<BtpmMcpRuntimeInput>,
): BtpmMcpRuntimeInput {
  const explicit = new Map<string, unknown>(
    Object.entries(provided).filter(([, value]) => value !== undefined),
  );

  return new Proxy({} as BtpmMcpRuntimeInput, {
    get(_target, property) {
      const key = String(property);
      if (explicit.has(key)) return explicit.get(key);
      return neverInvokedStub(key);
    },
    has() {
      return true;
    },
  });
}
