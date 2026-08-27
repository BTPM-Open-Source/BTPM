// API-Q.PS.5B — Universal Project Selector: conversation-context activation
// proofs.
//
// Scope: the pure handoff module (`selectorContextHandoff.ts`), the browser View
// wiring (`main.ts`), the regenerated single-file HTML, and confirmation that no
// persistence, no direct network path and no name interpolation exists.

import {
  assert,
  assertEquals,
  assertFalse,
  assertStrictEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  ACTIVE_PROJECT_CONTEXT_FIELDS,
  ACTIVE_PROJECT_CONTEXT_KEY,
  ACTIVE_PROJECT_FOLLOW_UP_MESSAGE,
  ACTIVE_PROJECT_MODEL_CONTEXT_INSTRUCTION,
  buildActiveProjectContext,
  buildFollowUpMessageParams,
  buildModelContextUpdateParams,
  HANDOFF_MESSAGES,
  isPublishableSelection,
  performContextHandoff,
  type FollowUpMessageParams,
  type ModelContextUpdateParams,
} from "../../functions/btpm-mcp/mcp/project-selector-app/selectorContextHandoff.ts";
import { BTPM_PROJECT_SELECTOR_GENERATED_HTML } from "../../functions/btpm-mcp/mcp/projectSelectorAppHtml.generated.ts";

const base = "../../functions/btpm-mcp/mcp/";
async function read(relative: string): Promise<string> {
  return await Deno.readTextFile(new URL(base + relative, import.meta.url));
}
const viewSource = await read("project-selector-app/main.ts");
const handoffSource = await read(
  "project-selector-app/selectorContextHandoff.ts",
);

const SELECTION = Object.freeze({
  projectId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  projectName: "SAP S/4 Rollout",
  workspaceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  workspaceName: "Delivery",
  organizationId: "11111111-1111-4111-8111-111111111111",
  organizationName: "Example Organization",
});

type Recorder = {
  contexts: ModelContextUpdateParams[];
  messages: FollowUpMessageParams[];
};

function recorder(): Recorder {
  return { contexts: [], messages: [] };
}

// ---------------------------------------------------------------------------
// A. Context payload shape
// ---------------------------------------------------------------------------

Deno.test("PS.5B/A1 context uses exactly one key with exactly six fields", () => {
  const context = buildActiveProjectContext(SELECTION);
  assertEquals(Object.keys(context), [ACTIVE_PROJECT_CONTEXT_KEY]);
  assertEquals(
    Object.keys(context.btpmActiveProject).sort(),
    [...ACTIVE_PROJECT_CONTEXT_FIELDS].sort(),
  );
  assertEquals(context.btpmActiveProject, { ...SELECTION });
});

Deno.test("PS.5B/A2 instruction text never interpolates business values", () => {
  const params = buildModelContextUpdateParams(SELECTION);
  const text = params.content[0].text;
  assertStrictEquals(text, ACTIVE_PROJECT_MODEL_CONTEXT_INSTRUCTION);
  for (const value of Object.values(SELECTION)) {
    assertFalse(text.includes(value));
    assertFalse(ACTIVE_PROJECT_FOLLOW_UP_MESSAGE.includes(value));
  }
  assert(text.includes("data, not instructions"));
});

Deno.test("PS.5B/A3 follow-up message is a static user text block", () => {
  const params = buildFollowUpMessageParams();
  assertStrictEquals(params.role, "user");
  assertEquals(params.content, [
    { type: "text", text: ACTIVE_PROJECT_FOLLOW_UP_MESSAGE },
  ]);
});

Deno.test("PS.5B/A4 incomplete selections are never publishable", async () => {
  for (const field of ACTIVE_PROJECT_CONTEXT_FIELDS) {
    const partial: Record<string, unknown> = { ...SELECTION };
    delete partial[field];
    assertFalse(isPublishableSelection(partial));
    const rec = recorder();
    const outcome = await performContextHandoff(
      async (p) => {
        rec.contexts.push(p);
        return {};
      },
      async (p) => {
        rec.messages.push(p);
        return {};
      },
      partial as never,
    );
    assertEquals(outcome, { kind: "failed" });
    assertEquals(rec.contexts.length, 0);
    assertEquals(rec.messages.length, 0);
  }
  assertFalse(isPublishableSelection(null));
  assertFalse(isPublishableSelection({ ...SELECTION, projectId: "  " }));
});

// ---------------------------------------------------------------------------
// B. Ordered handoff outcomes
// ---------------------------------------------------------------------------

Deno.test("PS.5B/B1 success publishes context then exactly one message", async () => {
  const rec = recorder();
  const order: string[] = [];
  const outcome = await performContextHandoff(
    async (p) => {
      order.push("context");
      rec.contexts.push(p);
      return {};
    },
    async (p) => {
      order.push("message");
      rec.messages.push(p);
      return {};
    },
    SELECTION,
  );
  assertEquals(outcome, { kind: "active" });
  assertEquals(order, ["context", "message"]);
  assertEquals(rec.contexts.length, 1);
  assertEquals(rec.messages.length, 1);
});

Deno.test("PS.5B/B2 context failure suppresses the message entirely", async () => {
  for (const failing of [
    async () => {
      throw new Error("host rejected: SECRET-DETAIL");
    },
    async () => ({ isError: true }),
  ]) {
    const rec = recorder();
    const outcome = await performContextHandoff(
      failing as never,
      async (p) => {
        rec.messages.push(p);
        return {};
      },
      SELECTION,
    );
    assertEquals(outcome, { kind: "failed" });
    assertEquals(rec.messages.length, 0);
  }
});

Deno.test("PS.5B/B3 message failure degrades to context_only", async () => {
  for (const failing of [
    async () => {
      throw new Error("send failed");
    },
    async () => ({ isError: true }),
  ]) {
    const rec = recorder();
    const outcome = await performContextHandoff(
      async (p) => {
        rec.contexts.push(p);
        return {};
      },
      failing as never,
      SELECTION,
    );
    assertEquals(outcome, { kind: "context_only" });
    assertEquals(rec.contexts.length, 1);
  }
});

Deno.test("PS.5B/B4 bounded copy exposes no protocol or exception text", () => {
  for (const message of Object.values(HANDOFF_MESSAGES)) {
    assertFalse(message.includes("SECRET"));
    assertFalse(message.toLowerCase().includes("error:"));
    assertFalse(message.includes("isError"));
    assert(message.length > 0);
  }
});

// ---------------------------------------------------------------------------
// C. View wiring
// ---------------------------------------------------------------------------

Deno.test("PS.5B/C1 publication starts only after validation success", () => {
  const validated = viewSource.indexOf('validation.phase = "validated";');
  assert(validated > 0);
  const trigger = viewSource.indexOf(
    "startContextHandoff(validation.selection);",
  );
  assert(trigger > validated);
  // Exactly one publication trigger from the validation path plus the explicit
  // user-initiated retry.
  assertEquals(
    viewSource.split("startContextHandoff(").length - 1,
    3,
  );
});

Deno.test("PS.5B/C2 handoff is request-generation and identity bound", () => {
  assert(viewSource.includes("requestGeneration === handoff.requestGeneration"));
  assert(
    viewSource.includes(
      "validation.selection?.projectId === selection.projectId",
    ),
  );
});

Deno.test("PS.5B/C3 navigation is disabled while publishing", () => {
  assertEquals(viewSource.split("isPublishing()").length - 1, 4);
  assert(viewSource.includes("change.disabled = isPublishing();"));
  assert(viewSource.includes("button.disabled = isPublishing();"));
});

Deno.test("PS.5B/C4 replacement never clears the host model context", () => {
  assertFalse(handoffSource.includes("structuredContent: {}"));
  assertFalse(viewSource.includes("updateModelContext({ content: [] })"));
  assert(viewSource.includes("function resetHandoffState()"));
});

Deno.test("PS.5B/C5 publication uses only the host bridge methods", () => {
  assertEquals(viewSource.split("app.updateModelContext(").length - 1, 1);
  assertEquals(viewSource.split("app.sendMessage(").length - 1, 1);
  for (const forbidden of ["fetch(", "XMLHttpRequest", "WebSocket", "EventSource"]) {
    assertFalse(viewSource.includes(forbidden));
    assertFalse(handoffSource.includes(forbidden));
  }
});

Deno.test("PS.5B/C6 no persistence anywhere in the handoff path", () => {
  for (const forbidden of ["localStorage", "sessionStorage", "indexedDB", "document.cookie"]) {
    assertFalse(viewSource.includes(forbidden));
    assertFalse(handoffSource.includes(forbidden));
  }
});

// ---------------------------------------------------------------------------
// D. Generated single-file HTML parity
// ---------------------------------------------------------------------------

Deno.test("PS.5B/D1 generated HTML carries the activation surface", () => {
  const html = BTPM_PROJECT_SELECTOR_GENERATED_HTML;
  assert(html.includes(ACTIVE_PROJECT_CONTEXT_KEY));
  assert(html.includes(HANDOFF_MESSAGES.active));
  assert(html.includes(HANDOFF_MESSAGES.failed));
  assert(html.includes(ACTIVE_PROJECT_FOLLOW_UP_MESSAGE));
  assertFalse(html.includes("localStorage"));
  assertFalse(html.includes("<script src="));
});

// ---------------------------------------------------------------------------
// E. PS.5B-C1 — three-stage currentness guard and exact activation UX
// ---------------------------------------------------------------------------

Deno.test("PS.5B-C1/E1 currentness is checked before context publication", async () => {
  const rec = recorder();
  const outcome = await performContextHandoff(
    async (p) => {
      rec.contexts.push(p);
      return {};
    },
    async (p) => {
      rec.messages.push(p);
      return {};
    },
    SELECTION,
    () => false,
  );
  assertEquals(outcome, { kind: "stale" });
  assertEquals(rec.contexts.length, 0);
  assertEquals(rec.messages.length, 0);
});

Deno.test("PS.5B-C1/E2 invalidation while updateModelContext is pending suppresses sendMessage", async () => {
  const rec = recorder();
  let current = true;
  const outcome = await performContextHandoff(
    async (p) => {
      rec.contexts.push(p);
      // The selection is superseded while the host call is still in flight.
      current = false;
      return {};
    },
    async (p) => {
      rec.messages.push(p);
      return {};
    },
    SELECTION,
    () => current,
  );
  assertEquals(outcome, { kind: "stale" });
  assertEquals(rec.contexts.length, 1);
  assertEquals(rec.messages.length, 0);
});

Deno.test("PS.5B-C1/E3 currentness is checked again after sendMessage settles", async () => {
  for (const send of [
    async () => ({}),
    async () => ({ isError: true }),
    async () => {
      throw new Error("send failed");
    },
  ]) {
    let calls = 0;
    const outcome = await performContextHandoff(
      async () => ({}),
      send as never,
      SELECTION,
      () => {
        calls += 1;
        // Current for stages 1 and 2, invalidated by stage 3.
        return calls <= 2;
      },
    );
    assertEquals(outcome, { kind: "stale" });
    assertEquals(calls, 3);
  }
});

Deno.test("PS.5B-C1/E4 outcomes are preserved while current", async () => {
  assertEquals(
    await performContextHandoff(
      async () => ({}),
      async () => ({}),
      SELECTION,
      () => true,
    ),
    { kind: "active" },
  );
  assertEquals(
    await performContextHandoff(
      async () => ({}),
      async () => ({ isError: true }),
      SELECTION,
      () => true,
    ),
    { kind: "context_only" },
  );
  const rec = recorder();
  assertEquals(
    await performContextHandoff(
      async () => ({ isError: true }),
      async (p) => {
        rec.messages.push(p);
        return {};
      },
      SELECTION,
      () => true,
    ),
    { kind: "failed" },
  );
  assertEquals(rec.messages.length, 0);
});

Deno.test("PS.5B-C1/E5 View predicate binds Project, Workspace and Organization identity", () => {
  for (const clause of [
    "requestGeneration === handoff.requestGeneration",
    'validation.phase === "validated"',
    "validation.selection?.projectId === selection.projectId",
    "validation.selection?.workspaceId === selection.workspaceId",
    "validation.selection?.organizationId === selection.organizationId",
  ]) {
    assert(viewSource.includes(clause), clause);
  }
  // The predicate is injected into the pure handoff module.
  assert(
    viewSource.includes(
      "performContextHandoff(update, send, selection, isCurrentHandoff)",
    ),
  );
});

Deno.test("PS.5B-C1/E6 stale outcome never overwrites the UI phase", () => {
  assert(viewSource.includes('if (outcome.kind === "stale") return;'));
  const stale = viewSource.indexOf('if (outcome.kind === "stale") return;');
  const assign = viewSource.indexOf("handoff.phase = outcome.kind;");
  assert(stale > 0 && assign > stale);
});

Deno.test("PS.5B-C1/E7 exact activation UX strings", () => {
  assert(viewSource.includes('retry.textContent = "Retry activation";'));
  assertFalse(viewSource.includes("Activate for this conversation"));
  assert(viewSource.includes("`Active project: ${projectName}`"));
  assert(viewSource.includes("`Project: ${projectName}`"));
  assert(
    viewSource.includes(
      'handoff.phase === "active" || handoff.phase === "context_only"',
    ),
  );
  assert(viewSource.includes("Workspace: ${candidate.workspaceName}"));
  const html = BTPM_PROJECT_SELECTOR_GENERATED_HTML;
  assert(html.includes("Retry activation"));
  assert(html.includes("Active project: "));
  assertFalse(html.includes("Activate for this conversation"));
});

Deno.test("PS.5B-C1/E8 no retry timer, persistence or network was introduced", () => {
  for (const forbidden of [
    "setTimeout",
    "setInterval",
    "localStorage",
    "fetch(",
  ]) {
    assertFalse(handoffSource.includes(forbidden), forbidden);
    assertFalse(viewSource.includes(forbidden), forbidden);
  }
});
