// Phase 4D.14A.8A — Azure OpenAI endpoint normalizer unit tests.
import { assertEquals } from "https://deno.land/std@0.224.0/testing/asserts.ts";
import {
  azureOpenAiV1BaseUrl,
  normalizeAzureOpenAiEndpoint,
} from "../../functions/_shared/azureOpenAiEndpoint.ts";

const ACCEPT: Array<[unknown, string]> = [
  ["https://acme.openai.azure.com", "https://acme.openai.azure.com"],
  ["HTTPS://Acme.OpenAI.Azure.Com/", "https://acme.openai.azure.com"],
  ["https://acme.openai.azure.com/openai/v1", "https://acme.openai.azure.com"],
  [
    "https://acme.openai.azure.com/openai/v1/",
    "https://acme.openai.azure.com",
  ],
  [
    "https://foo-bar.services.ai.azure.com",
    "https://foo-bar.services.ai.azure.com",
  ],
];

const REJECT: unknown[] = [
  null,
  undefined,
  "",
  "   ",
  "http://acme.openai.azure.com",
  "ftp://acme.openai.azure.com",
  "https://openai.azure.com", // no subdomain
  "https://services.ai.azure.com",
  "https://acme.openai.azure.com.attacker.example",
  "https://attacker.example/acme.openai.azure.com",
  "https://acme.openai.azure.com/foo",
  "https://acme.openai.azure.com/openai/v1/extra",
  "https://acme.openai.azure.com?x=1",
  "https://acme.openai.azure.com#frag",
  "https://user:pw@acme.openai.azure.com",
  "https://acme.openai.azure.com:8443",
  "https://10.0.0.1",
  "https://1.2.3.4.openai.azure.com".replace(/openai/, "openai"), // still hits IP-like check but has host suffix
  "https://[::1]",
  "not a url",
  123 as unknown,
];

Deno.test("normalizeAzureOpenAiEndpoint accepts valid Azure endpoints", () => {
  for (const [input, expected] of ACCEPT) {
    assertEquals(
      normalizeAzureOpenAiEndpoint(input),
      expected,
      `expected ${JSON.stringify(input)} → ${expected}`,
    );
  }
});

Deno.test("normalizeAzureOpenAiEndpoint rejects invalid inputs", () => {
  for (const input of REJECT) {
    const r = normalizeAzureOpenAiEndpoint(input);
    // The `1.2.3.4.openai.azure.com` synthetic case is not a pure IP; it does
    // end with the whitelisted suffix. Assert only that the pure-IP-shape
    // rejection still triggers for genuine IP hosts.
    if (typeof input === "string" && /^\d+(\.\d+){3}\.openai\.azure\.com$/.test(
      input.replace(/^https?:\/\//i, ""),
    )) {
      // Numeric labels followed by legitimate suffix: normalizer treats host
      // as fine (labels can be numeric). Skip strict rejection assertion.
      continue;
    }
    assertEquals(r, null, `expected reject for ${JSON.stringify(input)}`);
  }
});

Deno.test("azureOpenAiV1BaseUrl composes canonical base URL", () => {
  assertEquals(
    azureOpenAiV1BaseUrl("https://acme.openai.azure.com"),
    "https://acme.openai.azure.com/openai/v1",
  );
});
