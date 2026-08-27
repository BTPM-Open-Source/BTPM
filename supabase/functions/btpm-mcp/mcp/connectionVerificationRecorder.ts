// UX-GAP.1B1 — MCP connection-verification evidence recorder.
//
// Narrow infrastructure adapter over the protected service-role database
// function `public.api_g_5_10_record_mcp_connection_verification`. It records
// exactly one safe connection-evidence activity event after a real MCP protocol
// request has passed bearer authentication, canonical Connected App
// authorization and trusted execution-context construction.
//
// This module NEVER: inserts into any table directly, accepts or forwards a
// token / Authorization header / audience / email / Tenant / Organization /
// Workspace / Project / capability / policy / role value, chooses a route ID or
// HTTP status, retries, or logs provider or SQL error detail. All event field
// values other than the API-client ID, actor user ID and correlation ID are
// server-owned inside the database function.

export interface McpConnectionVerificationInput {
  readonly apiClientId: string;
  readonly actorUserId: string;
  readonly requestId: string;
}

export interface McpConnectionVerificationRecorder {
  /** Returns true only when one evidence event was durably recorded. */
  record(input: McpConnectionVerificationInput): Promise<boolean>;
}

export interface McpConnectionVerificationClient {
  rpc(
    functionName: string,
    args: Record<string, unknown>,
  ): PromiseLike<unknown>;
}

const REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const MCP_CONNECTION_VERIFICATION_RPC =
  "api_g_5_10_record_mcp_connection_verification";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function isValidInput(
  input: unknown,
): input is McpConnectionVerificationInput {
  if (!isPlainObject(input)) return false;
  if (!isUuid(input.apiClientId)) return false;
  if (!isUuid(input.actorUserId)) return false;
  return (
    typeof input.requestId === "string" &&
    REQUEST_ID_PATTERN.test(input.requestId)
  );
}

export function createMcpConnectionVerificationRecorder(
  client: McpConnectionVerificationClient,
): McpConnectionVerificationRecorder {
  if (!isPlainObject(client) || typeof client.rpc !== "function") {
    throw new Error("mcp_connection_verification_recorder_unavailable");
  }

  return Object.freeze({
    async record(input: McpConnectionVerificationInput): Promise<boolean> {
      if (!isValidInput(input)) return false;

      let raw: unknown;
      try {
        raw = await client.rpc(MCP_CONNECTION_VERIFICATION_RPC, {
          _api_client_id: input.apiClientId,
          _actor_user_id: input.actorUserId,
          _request_id: input.requestId,
        });
      } catch {
        return false;
      }

      if (!isPlainObject(raw)) return false;
      if (!("data" in raw) || !("error" in raw)) return false;
      if (raw.error !== null) return false;
      return isUuid(raw.data);
    },
  });
}
