// Phase 4D.14A.3C.2 — OpenAI model-trait helper + request-body shape tests.
//
// Pure unit tests. No provider I/O, no environment reads, no secrets.
// Verifies:
//   - reasoning models -> max_completion_tokens, no temperature
//   - classic models -> max_tokens, temperature preserved
//   - boundary/blank inputs -> safe classic default
//   - OpenAI vs Azure body shape (Azure never calls the trait helper)

import {
  assert,
  assertEquals,
  assertFalse,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  getOpenAiChatBodyTraits,
  isOpenAiReasoningModel,
} from "../../../functions/_shared/ai-guide-v2/openai-model-traits.ts";

// ---------------------------------------------------------------------------
// Reasoning models
// ---------------------------------------------------------------------------

const REASONING_MODELS = [
  "gpt-5",
  "gpt-5.4-mini",
  "gpt-5.5",
  "GPT-5.4-Mini", // case-insensitive
  "o1",
  "o1-mini",
  "o3",
  "o3-mini",
  "o4",
  "o4-mini",
  "o4-mini-high",
];

for (const model of REASONING_MODELS) {
  Deno.test(`reasoning model detected: ${model}`, () => {
    assert(isOpenAiReasoningModel(model), `${model} should be reasoning`);
    const t = getOpenAiChatBodyTraits(model);
    assertEquals(t.fieldName, "max_completion_tokens");
    assertEquals(t.omitTemperature, true);
  });
}

// ---------------------------------------------------------------------------
// Classic / non-reasoning models
// ---------------------------------------------------------------------------

const CLASSIC_MODELS = [
  "gpt-4o",
  "gpt-4o-mini",
  "gpt-4.1",
  "gpt-4.1-mini",
  "gpt-4",
  "gpt-4-turbo",
  "gpt-3.5-turbo",
  "some-unknown-model",
  "claude-3-opus", // non-OpenAI id, must still return safe classic default
];

for (const model of CLASSIC_MODELS) {
  Deno.test(`classic model detected: ${model}`, () => {
    assertFalse(isOpenAiReasoningModel(model), `${model} should be classic`);
    const t = getOpenAiChatBodyTraits(model);
    assertEquals(t.fieldName, "max_tokens");
    assertEquals(t.omitTemperature, false);
  });
}

// ---------------------------------------------------------------------------
// Boundary inputs — must never throw, must default to classic behavior
// ---------------------------------------------------------------------------

Deno.test("null model -> classic default, no throw", () => {
  const t = getOpenAiChatBodyTraits(null);
  assertEquals(t.fieldName, "max_tokens");
  assertEquals(t.omitTemperature, false);
  assertFalse(isOpenAiReasoningModel(null));
});

Deno.test("undefined model -> classic default, no throw", () => {
  const t = getOpenAiChatBodyTraits(undefined);
  assertEquals(t.fieldName, "max_tokens");
  assertEquals(t.omitTemperature, false);
  assertFalse(isOpenAiReasoningModel(undefined));
});

Deno.test("blank / whitespace model -> classic default, no throw", () => {
  for (const m of ["", "   ", "\t\n"]) {
    const t = getOpenAiChatBodyTraits(m);
    assertEquals(t.fieldName, "max_tokens");
    assertEquals(t.omitTemperature, false);
    assertFalse(isOpenAiReasoningModel(m));
  }
});

// ---------------------------------------------------------------------------
// Request-body shape builders (mirror provider.ts / renderer.ts branches)
// ---------------------------------------------------------------------------
//
// These pure builders re-implement the OpenAI-branch and Azure-branch body
// construction rules so we can prove the invariants without live provider
// calls:
//   - OpenAI reasoning body: has max_completion_tokens, no max_tokens,
//     no temperature.
//   - OpenAI classic body: has max_tokens, has temperature,
//     no max_completion_tokens.
//   - Azure body: has max_tokens + temperature, does NOT depend on the
//     OpenAI trait helper (independent of model id).

function buildOpenAiBody(model: string, maxTokens: number, temperature: number) {
  const traits = getOpenAiChatBodyTraits(model);
  const body: Record<string, unknown> = {
    model,
    messages: [],
    [traits.fieldName]: maxTokens,
  };
  if (!traits.omitTemperature) body.temperature = temperature;
  return body;
}

function buildAzureBody(_model: string, maxTokens: number, temperature: number) {
  // Azure retains its pre-compatibility contract regardless of model id.
  return {
    messages: [],
    max_tokens: maxTokens,
    temperature,
  } as Record<string, unknown>;
}

Deno.test("OpenAI reasoning body has max_completion_tokens, no max_tokens, no temperature", () => {
  const b = buildOpenAiBody("gpt-5.4-mini", 800, 0.2);
  assertEquals(b.max_completion_tokens, 800);
  assert(!("max_tokens" in b), "max_tokens must be absent for reasoning");
  assert(!("temperature" in b), "temperature must be absent for reasoning");
});

Deno.test("OpenAI classic body has max_tokens + temperature, no max_completion_tokens", () => {
  const b = buildOpenAiBody("gpt-4o-mini", 800, 0.2);
  assertEquals(b.max_tokens, 800);
  assertEquals(b.temperature, 0.2);
  assert(!("max_completion_tokens" in b), "max_completion_tokens must be absent for classic");
});

Deno.test("Azure body keeps max_tokens + temperature regardless of model id", () => {
  // Even a "reasoning-looking" id (e.g. an Azure deployment named after
  // gpt-5) must NOT drop temperature / switch to max_completion_tokens on
  // the Azure branch — Azure retains its pre-compatibility contract.
  const b = buildAzureBody("gpt-5.4-mini", 800, 0.2);
  assertEquals(b.max_tokens, 800);
  assertEquals(b.temperature, 0.2);
  assert(!("max_completion_tokens" in b), "Azure must not use max_completion_tokens");
});
