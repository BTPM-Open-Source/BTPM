/**
 * API-G.5.10D-2B — behavioral tests for the typed Organization rate-profile
 * reader, setter, query options and mutation options. Exactly four test cases.
 */
import { describe, it, expect } from "vitest";
import {
  buildOrganizationClientRateProfileQueryOptions,
  buildSetOrganizationClientRateProfileMutationOptions,
  createOrganizationClientRateProfileReader,
  createOrganizationClientRateProfileSetter,
  organizationClientRateProfileQueryKey,
  type OrganizationClientRateProfile,
  type OrganizationClientRateProfileOptions,
  type OrganizationClientRateProfileRpcClient,
} from "../useOrganizationClientRateProfile";

const ORG_ID = "22222222-2222-2222-2222-222222222222";
const CLIENT_ID = "11111111-1111-1111-1111-111111111111";

const options: OrganizationClientRateProfileOptions = {
  organizationId: ORG_ID,
  apiClientId: CLIENT_ID,
};

interface Call {
  fn: string;
  args: Record<string, unknown>;
}

function stubClient(impl: (call: Call) => unknown) {
  const calls: Call[] = [];
  const client = {
    rpc: (fn: string, args: Record<string, unknown>) => {
      const call: Call = { fn, args };
      calls.push(call);
      return impl(call) as PromiseLike<{ data: unknown; error: unknown }>;
    },
  } as unknown as OrganizationClientRateProfileRpcClient;
  return { client, calls };
}

function defaultRow(overrides: Record<string, unknown> = {}) {
  return {
    profile_key: "standard",
    display_name: "Standard",
    description: "60 requests per 60 seconds",
    request_limit: 60,
    window_seconds: 60,
    is_default: true,
    is_explicit: false,
    assigned_at: null,
    ...overrides,
  };
}

describe("API-G.5.10D-2B typed Organization rate-profile client", () => {
  it("issues the exact read request and parses a default response", async () => {
    const { client, calls } = stubClient(() =>
      Promise.resolve({ data: [defaultRow()], error: null }),
    );
    const read = createOrganizationClientRateProfileReader(client);
    const result = await read(options);

    expect(calls).toHaveLength(1);
    expect(calls[0].fn).toBe("api_g_5_10_get_organization_client_rate_profile");
    expect(calls[0].args).toEqual({
      _organization_id: ORG_ID,
      _api_client_id: CLIENT_ID,
    });
    expect(Object.keys(calls[0].args)).toHaveLength(2);

    expect(result).toEqual({
      profileKey: "standard",
      displayName: "Standard",
      description: "60 requests per 60 seconds",
      requestLimit: 60,
      windowSeconds: 60,
      isDefault: true,
      isExplicit: false,
      assignedAt: null,
    });
    expect(result.isExplicit).toBe(false);
    expect(result.assignedAt).toBeNull();
    expect(Object.isFrozen(result)).toBe(true);
  });

  it("preserves explicit timestamps and contains all read failures", async () => {
    const explicitRow = defaultRow({
      is_default: false,
      is_explicit: true,
      assigned_at: "2026-08-05T12:00:00.000Z",
    });
    const okRead = createOrganizationClientRateProfileReader(
      stubClient(() => Promise.resolve({ data: [explicitRow], error: null })).client,
    );
    const explicit = await okRead(options);
    expect(explicit.isExplicit).toBe(true);
    expect(explicit.assignedAt).toBe("2026-08-05T12:00:00.000Z");

    const missingAssignedAt = defaultRow();
    delete (missingAssignedAt as { assigned_at?: unknown }).assigned_at;

    const badResponses: unknown[] = [
      [defaultRow({ profile_key: "Bad-Key" })],
      [defaultRow({ display_name: "" })],
      [defaultRow({ description: "" })],
      [defaultRow({ request_limit: 0 })],
      [defaultRow({ window_seconds: 86_401 })],
      [defaultRow({ is_default: "yes" })],
      [defaultRow({ is_explicit: true, assigned_at: null })],
      [defaultRow({ is_explicit: false, assigned_at: "2026-08-05T12:00:00.000Z" })],
      [defaultRow({ assigned_at: undefined })],
      [missingAssignedAt],
      [],
      [defaultRow(), defaultRow()],
      {},
      null,
    ];

    for (const data of badResponses) {
      const reader = createOrganizationClientRateProfileReader(
        stubClient(() => Promise.resolve({ data, error: null })).client,
      );
      await expect(reader(options)).rejects.toThrow("rate_profile_unavailable");
    }

    const errored = createOrganizationClientRateProfileReader(
      stubClient(() =>
        Promise.resolve({ data: null, error: { message: "permission denied for xyz" } }),
      ).client,
    );
    await expect(errored(options)).rejects.toThrow("rate_profile_unavailable");

    const thrown = createOrganizationClientRateProfileReader(
      stubClient(() => Promise.reject(new Error("internal detail"))).client,
    );
    await expect(thrown(options)).rejects.toThrow("rate_profile_unavailable");

    const invalidInput = createOrganizationClientRateProfileReader(
      stubClient(() => Promise.resolve({ data: [defaultRow()], error: null })).client,
    );
    await expect(
      invalidInput({ organizationId: "", apiClientId: CLIENT_ID }),
    ).rejects.toThrow("rate_profile_unavailable");
  });

  it("builds exact query options with context isolation", () => {
    const reader = async () => defaultRow() as unknown as OrganizationClientRateProfile;
    const built = buildOrganizationClientRateProfileQueryOptions(options, reader);

    expect(built.queryKey).toEqual([
      "organization-client-rate-profile",
      ORG_ID,
      CLIENT_ID,
    ]);
    expect(organizationClientRateProfileQueryKey(ORG_ID, CLIENT_ID)).toEqual(
      built.queryKey,
    );
    expect(built.enabled).toBe(true);
    expect(built.staleTime).toBe(30_000);
    expect(built.retry).toBe(false);

    expect(
      buildOrganizationClientRateProfileQueryOptions(
        { organizationId: null, apiClientId: CLIENT_ID },
        reader,
      ).enabled,
    ).toBe(false);
    expect(
      buildOrganizationClientRateProfileQueryOptions(
        { organizationId: ORG_ID, apiClientId: null },
        reader,
      ).enabled,
    ).toBe(false);
    expect(
      buildOrganizationClientRateProfileQueryOptions(
        { ...options, enabled: false },
        reader,
      ).enabled,
    ).toBe(false);

    const keys = Object.keys(built);
    expect(keys).not.toContain("placeholderData");
    expect(keys).not.toContain("initialData");
    expect(keys).not.toContain("refetchInterval");
    expect(keys).not.toContain("refetchIntervalInBackground");
  });

  it("issues the exact set request and updates only the exact read cache", async () => {
    const explicitRow = defaultRow({
      is_default: false,
      is_explicit: true,
      assigned_at: "2026-08-05T12:30:00.000Z",
    });
    const { client, calls } = stubClient(() =>
      Promise.resolve({ data: [explicitRow], error: null }),
    );
    const setter = createOrganizationClientRateProfileSetter(client);
    const result = await setter(options, { profileKey: "standard" });

    expect(calls).toHaveLength(1);
    expect(calls[0].fn).toBe("api_g_5_10_set_organization_client_rate_profile");
    expect(calls[0].args).toEqual({
      _organization_id: ORG_ID,
      _api_client_id: CLIENT_ID,
      _profile_key: "standard",
    });
    expect(Object.keys(calls[0].args)).toHaveLength(3);
    expect(JSON.stringify(calls[0].args)).not.toContain("request_limit");
    expect(JSON.stringify(calls[0].args)).not.toContain("window_seconds");
    expect(result.isExplicit).toBe(true);

    const guard = stubClient(() =>
      Promise.resolve({ data: [explicitRow], error: null }),
    );
    const guardedSetter = createOrganizationClientRateProfileSetter(guard.client);
    for (const bad of ["", "Standard", "1standard", "bad-key", "x".repeat(65)]) {
      await expect(
        guardedSetter(options, { profileKey: bad }),
      ).rejects.toThrow("rate_profile_update_unavailable");
    }
    expect(guard.calls).toHaveLength(0);

    const errored = createOrganizationClientRateProfileSetter(
      stubClient(() =>
        Promise.resolve({ data: null, error: { code: "42501" } }),
      ).client,
    );
    await expect(
      errored(options, { profileKey: "standard" }),
    ).rejects.toThrow("rate_profile_update_unavailable");

    const setCalls: unknown[][] = [];
    const invalidateCalls: unknown[] = [];
    const queryClient = {
      setQueryData: (key: unknown, data: unknown) => {
        setCalls.push([key, data]);
        return data;
      },
      invalidateQueries: (arg: unknown) => {
        invalidateCalls.push(arg);
      },
    };
    const mutationOptions = buildSetOrganizationClientRateProfileMutationOptions(
      options,
      queryClient,
      setter,
    );
    expect(mutationOptions.mutationKey).toEqual([
      "set-organization-client-rate-profile",
      ORG_ID,
      CLIENT_ID,
    ]);
    expect(mutationOptions.retry).toBe(false);
    expect(Object.keys(mutationOptions)).not.toContain("onMutate");

    mutationOptions.onSuccess(result);
    expect(setCalls).toHaveLength(1);
    expect(setCalls[0][0]).toEqual([
      "organization-client-rate-profile",
      ORG_ID,
      CLIENT_ID,
    ]);
    expect(setCalls[0][1]).toBe(result);
    expect(invalidateCalls).toHaveLength(0);
  });
});
