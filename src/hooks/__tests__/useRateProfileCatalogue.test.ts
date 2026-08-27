/**
 * API-G.5.10D-2C — behavioral tests for the typed read-only approved
 * rate-profile catalogue reader and query options. Exactly four test cases.
 */
import { describe, it, expect } from "vitest";
import {
  buildRateProfileCatalogueQueryOptions,
  createRateProfileCatalogueReader,
  rateProfileCatalogueQueryKey,
  type RateProfileCatalogueItem,
  type RateProfileCatalogueRpcClient,
} from "../useRateProfileCatalogue";

interface Call {
  fn: string;
  argCount: number;
}

function stubClient(impl: () => unknown) {
  const calls: Call[] = [];
  const client = {
    rpc: (...args: unknown[]) => {
      calls.push({ fn: String(args[0]), argCount: args.length });
      return impl() as PromiseLike<{ data: unknown; error: unknown }>;
    },
  } as unknown as RateProfileCatalogueRpcClient;
  return { client, calls };
}

function row(overrides: Record<string, unknown> = {}) {
  return {
    profile_key: "standard",
    display_name: "Standard",
    description: "60 requests per 60 seconds",
    request_limit: 60,
    window_seconds: 60,
    is_default: true,
    ...overrides,
  };
}

describe("API-G.5.10D-2C typed rate-profile catalogue reader", () => {
  it("issues the exact zero-argument request and parses valid rows", async () => {
    const rows = [
      row({ extra_field: "ignored", catalogue_id: "uuid", status: "active" }),
      row({
        profile_key: "elevated",
        display_name: "Elevated",
        description: "600 requests per 60 seconds",
        request_limit: 600,
        is_default: false,
      }),
    ];
    const { client, calls } = stubClient(() =>
      Promise.resolve({ data: rows, error: null }),
    );
    const read = createRateProfileCatalogueReader(client);
    const result = await read();

    expect(calls).toHaveLength(1);
    expect(calls[0].fn).toBe("api_g_5_10_list_rate_profile_catalogue");
    expect(calls[0].argCount).toBe(1);

    expect(result).toEqual([
      {
        profileKey: "standard",
        displayName: "Standard",
        description: "60 requests per 60 seconds",
        requestLimit: 60,
        windowSeconds: 60,
        isDefault: true,
      },
      {
        profileKey: "elevated",
        displayName: "Elevated",
        description: "600 requests per 60 seconds",
        requestLimit: 600,
        windowSeconds: 60,
        isDefault: false,
      },
    ]);
    expect(result.map((i) => i.profileKey)).toEqual(["standard", "elevated"]);
    expect(Object.isFrozen(result)).toBe(true);
    expect(result.every((i) => Object.isFrozen(i))).toBe(true);
    expect(Object.keys(result[0])).toHaveLength(6);
  });

  it("contains every malformed response as rate_profile_catalogue_unavailable", async () => {
    const badResponses: unknown[] = [
      null,
      {},
      "rows",
      [row({ profile_key: "Bad-Key" })],
      [row({ profile_key: "1standard" })],
      [row({ display_name: "" })],
      [row({ display_name: "x".repeat(101) })],
      [row({ description: "" })],
      [row({ description: "x".repeat(501) })],
      [row({ request_limit: 0 })],
      [row({ request_limit: 1_000_001 })],
      [row({ window_seconds: 86_401 })],
      [row({ window_seconds: 0 })],
      [row({ is_default: "yes" })],
      [row(), row({ is_default: false })],
      [row(), row({ profile_key: "elevated" })],
      [null],
      [[]],
    ];

    for (const data of badResponses) {
      const reader = createRateProfileCatalogueReader(
        stubClient(() => Promise.resolve({ data, error: null })).client,
      );
      await expect(reader()).rejects.toThrow("rate_profile_catalogue_unavailable");
    }

    const errored = createRateProfileCatalogueReader(
      stubClient(() =>
        Promise.resolve({ data: null, error: { message: "permission denied", code: "42501" } }),
      ).client,
    );
    await expect(errored()).rejects.toThrow("rate_profile_catalogue_unavailable");

    const thrown = createRateProfileCatalogueReader(
      stubClient(() => Promise.reject(new Error("internal detail"))).client,
    );
    await expect(thrown()).rejects.toThrow("rate_profile_catalogue_unavailable");

    const wrapper = createRateProfileCatalogueReader(
      stubClient(() => Promise.resolve(null)).client,
    );
    await expect(wrapper()).rejects.toThrow("rate_profile_catalogue_unavailable");
  });

  it("treats an empty catalogue as a valid result without fallbacks", async () => {
    const { client, calls } = stubClient(() =>
      Promise.resolve({ data: [], error: null }),
    );
    const result = await createRateProfileCatalogueReader(client)();

    expect(result).toEqual([]);
    expect(result).toHaveLength(0);
    expect(Object.isFrozen(result)).toBe(true);
    expect(JSON.stringify(result)).not.toContain("standard");
    expect(calls).toHaveLength(1);
  });

  it("builds exact query options", () => {
    const reader = async () => [] as readonly RateProfileCatalogueItem[];
    const built = buildRateProfileCatalogueQueryOptions({}, reader);

    expect(built.queryKey).toEqual(["api-rate-profile-catalogue"]);
    expect(rateProfileCatalogueQueryKey()).toEqual(built.queryKey);
    expect(built.queryKey).toHaveLength(1);
    expect(built.enabled).toBe(true);
    expect(buildRateProfileCatalogueQueryOptions(undefined, reader).enabled).toBe(true);
    expect(
      buildRateProfileCatalogueQueryOptions({ enabled: false }, reader).enabled,
    ).toBe(false);
    expect(built.staleTime).toBe(300_000);
    expect(built.retry).toBe(false);

    const keys = Object.keys(built);
    expect(keys).not.toContain("placeholderData");
    expect(keys).not.toContain("initialData");
    expect(keys).not.toContain("refetchInterval");
    expect(keys).not.toContain("refetchIntervalInBackground");
  });
});
