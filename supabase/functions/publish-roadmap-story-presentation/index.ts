// Phase 6B.8b.2 — Publish current Roadmap Story Presentation as an
// immutable Published Story Version.
//
// Snapshot source precedence (report content):
//   1. Client-supplied `renderedPresentationSnapshot` — the OVERLAID
//      (AI-on-deterministic) or deterministic blueprint the owner just
//      reviewed in Preview. Publishing must freeze exactly that.
//   2. Client-supplied `deterministicSnapshot` (legacy fallback).
//
// The raw AI Presentation Blueprint (`blueprint_json`) is NEVER used as
// report content. It lacks BTPM-specific render data (project cards,
// portfolio rows, Gantt rows, KPI items, etc.) that only the client-side
// deterministic overlay can produce. If no client snapshot is provided,
// publish fails with `rendered_snapshot_required`.
//
// The Edge Function still calls `get_latest_roadmap_story_presentation_blueprint`
// for METADATA ONLY — to recover the latest valid run id and its
// `story_pack_version_id` when the caller omitted them, so the publish
// RPC can prefer the actual source snapshot for scope derivation.
//
// Both client-provided snapshots MUST be `btpm_published_story_v1`
// envelopes (typically produced by `buildRenderedPublishedSnapshot`).
// Raw `roadmap_story_presentation_v1` AI-blueprint shapes are rejected
// with `invalid_rendered_snapshot`.
//
// Access scope: NEVER trusted from the client. Derived entirely inside
// `publish_roadmap_story_presentation_version` from the Story Pack
// version source snapshot first, then the Story Pack scope_config
// filter fallback.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.50.0";
import { assertBrowserSessionOnly } from "../_shared/btpm-api/assertBrowserSessionOnly.ts";
import { createSupabaseTokenVerifier } from "../_shared/btpm-api/resolveTokenContext.ts";
import { toSafeErrorResponse } from "../_shared/btpm-api/apiErrors.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const MAX_SNAPSHOT_BYTES = 750_000;
const MAX_BLOCKS = 200;
const SCHEMA_VERSION = "btpm_published_story_v1";
const PRESENTATION_SCHEMA_VERSION = "roadmap_story_presentation_v1";
const TEMPLATE_ID = "steerco_briefing_v1";
const FUTURE_VIEWER_PATH = "/story-presentations";

/**
 * Keys forbidden anywhere in the snapshot tree. Publish-time recursive
 * sanitiser strips every occurrence — root or nested inside blocks.
 */
const DISALLOWED_KEYS = new Set([
  "prompt",
  "promptText",
  "prompt_text",
  "systemPrompt",
  "system_prompt",
  "input",
  "inputPackage",
  "input_package",
  "rawResponse",
  "raw_response",
  "raw",
  "response",
  "parsed",
  "parsed_blueprint",
  "parsedBlueprint",
  "validation",
  "validation_json",
  "validationJson",
  "debug",
  "sourceSnapshot",
  "source_snapshot",
  "sourcePackage",
  "source_package",
  "providerMetadata",
  "provider_metadata",
  // File bytes / raw content
  "bytes",
  "base64",
  "contentBytes",
  "fileContent",
  "rawContent",
]);

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
function safeMsg(e: unknown, max = 500): string {
  const s = e instanceof Error ? e.message : (typeof e === "string" ? e : JSON.stringify(e ?? ""));
  return String(s).slice(0, max);
}

function isDisallowedKey(k: string): boolean {
  if (DISALLOWED_KEYS.has(k)) return true;
  if (k.endsWith("_encrypted") || k.endsWith("Encrypted")) return true;
  return false;
}

/**
 * Recursively strip disallowed keys anywhere in the value tree while
 * preserving all render-safe fields. Arrays are walked element-wise;
 * objects have offending keys removed then recursed.
 */
function sanitiseTree(value: unknown, depth = 0): unknown {
  if (depth > 32) return null; // guard against pathological nesting
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map((v) => sanitiseTree(v, depth + 1));
  if (typeof value !== "object") return value;

  const src = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(src)) {
    if (isDisallowedKey(k)) continue;
    out[k] = sanitiseTree(v, depth + 1);
  }
  return out;
}

/**
 * Envelope enforcement. Runs AFTER `sanitiseTree` on the caller payload
 * so nested debug/protected keys are already gone.
 */
function toSafeSnapshot(
  raw: Record<string, unknown>,
  mode: "ai_blueprint" | "deterministic",
  sourceRefs: { storyPackVersionId?: string; presentationBlueprintRunId?: string },
): Record<string, unknown> {
  const sanitised = sanitiseTree(raw) as Record<string, unknown>;

  const templateId = typeof sanitised.templateId === "string" ? sanitised.templateId : TEMPLATE_ID;
  let blocks = Array.isArray(sanitised.blocks) ? sanitised.blocks : [];
  if (blocks.length > MAX_BLOCKS) blocks = blocks.slice(0, MAX_BLOCKS);

  const sourceLimitations = Array.isArray(sanitised.sourceLimitations)
    ? (sanitised.sourceLimitations as unknown[])
        .filter((v) => typeof v === "string")
        .slice(0, 40)
    : [];

  const title = typeof sanitised.title === "string" ? sanitised.title : "";
  const subtitle = typeof sanitised.subtitle === "string" ? sanitised.subtitle : undefined;
  const executiveTakeaway =
    typeof sanitised.executiveTakeaway === "string" ? sanitised.executiveTakeaway : undefined;
  const density = typeof sanitised.density === "string" ? sanitised.density : undefined;

  return {
    schemaVersion: SCHEMA_VERSION,
    presentationSchemaVersion: PRESENTATION_SCHEMA_VERSION,
    templateId,
    title,
    ...(subtitle ? { subtitle } : {}),
    ...(executiveTakeaway ? { executiveTakeaway } : {}),
    ...(density ? { density } : {}),
    blocks,
    sourceLimitations,
    objectLinkMode: "btpm_protected_routes",
    publishedFrom: {
      sourceMode: mode,
      ...(sourceRefs.storyPackVersionId
        ? { storyPackVersionId: sourceRefs.storyPackVersionId }
        : {}),
      ...(sourceRefs.presentationBlueprintRunId
        ? { presentationBlueprintRunId: sourceRefs.presentationBlueprintRunId }
        : {}),
    },
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { ok: false, error: "method_not_allowed" });

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader) return json(401, { ok: false, error: "unauthorized" });

    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    try {
      const verifier = createSupabaseTokenVerifier(userClient);
      await assertBrowserSessionOnly(req, verifier);
    } catch (guardError) {
      return toSafeErrorResponse(guardError, corsHeaders);
    }
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) return json(401, { ok: false, error: "unauthorized" });

    const body = await req.json().catch(() => null) as
      | {
          storyPackId?: string;
          storyPackVersionId?: string | null;
          presentationBlueprintRunId?: string | null;
          titleOverride?: string | null;
          /**
           * Final overlaid BTPM-renderable snapshot (preferred). Contains
           * the exact blocks the owner reviewed in Preview.
           */
          renderedPresentationSnapshot?: Record<string, unknown> | null;
          /** Legacy fallback name for the same payload. */
          deterministicSnapshot?: Record<string, unknown> | null;
        }
      | null;

    if (!body?.storyPackId || typeof body.storyPackId !== "string") {
      return json(400, { ok: false, error: "invalid_request", note: "storyPackId required" });
    }

    // --- Owner + pack lookup via existing controlled RPC ------------------
    const { data: cfgData, error: cfgErr } = await userClient.rpc(
      "get_roadmap_story_pack_config",
      { _story_pack_id: body.storyPackId },
    );
    if (cfgErr) {
      const m = String(cfgErr.message ?? "").toLowerCase();
      if (m.includes("forbidden") || m.includes("42501")) return json(403, { ok: false, error: "forbidden" });
      return json(500, { ok: false, error: "pack_lookup_failed", note: safeMsg(cfgErr) });
    }
    const cfg = cfgData as { pack?: { status?: string; title?: string | null } } | null;
    if (!cfg?.pack) return json(404, { ok: false, error: "story_pack_not_found" });
    if (cfg.pack.status === "archived") return json(409, { ok: false, error: "story_pack_archived" });

    // --- Detect latest valid AI Presentation Blueprint (METADATA ONLY) ----
    // Used to (a) tag sourceMode and (b) recover the run's story_pack_version_id
    // when the caller didn't provide one, so the RPC can prefer the actual
    // source snapshot for scope derivation. `blueprint_json` is NEVER used
    // as report content — see Phase 6B.8b.2 notes at top of file.
    let sourceMode: "ai_blueprint" | "deterministic" = "deterministic";
    let effectiveBlueprintRunId: string | null =
      typeof body.presentationBlueprintRunId === "string" ? body.presentationBlueprintRunId : null;
    let effectiveStoryPackVersionId: string | null =
      typeof body.storyPackVersionId === "string" ? body.storyPackVersionId : null;

    const { data: latestBlueprint, error: bpErr } = await userClient.rpc(
      "get_latest_roadmap_story_presentation_blueprint",
      { _story_pack_id: body.storyPackId },
    );
    if (bpErr) {
      console.log("publish_roadmap_story_presentation_blueprint_lookup_warn", {
        note: safeMsg(bpErr),
      });
    }
    if (latestBlueprint && typeof latestBlueprint === "object") {
      const bp = latestBlueprint as {
        run_id?: string;
        story_pack_version_id?: string | null;
      };
      if (bp.run_id) {
        sourceMode = "ai_blueprint";
        if (!effectiveBlueprintRunId) effectiveBlueprintRunId = bp.run_id;
      }
      if (!effectiveStoryPackVersionId && typeof bp.story_pack_version_id === "string") {
        effectiveStoryPackVersionId = bp.story_pack_version_id;
      }
    }

    // --- Snapshot source selection ---------------------------------------
    // The final BTPM-renderable snapshot MUST come from the client
    // (`buildRenderedPublishedSnapshot`). Raw AI blueprints are never
    // published as report content.
    const clientRendered =
      body.renderedPresentationSnapshot && typeof body.renderedPresentationSnapshot === "object"
        ? body.renderedPresentationSnapshot as Record<string, unknown>
        : null;
    const clientDeterministic =
      body.deterministicSnapshot && typeof body.deterministicSnapshot === "object"
        ? body.deterministicSnapshot as Record<string, unknown>
        : null;

    const snapshotSource: Record<string, unknown> | null =
      clientRendered ?? clientDeterministic;

    if (!snapshotSource) {
      return json(400, {
        ok: false,
        error: "rendered_snapshot_required",
        note:
          "Publish requires the final BTPM-renderable presentation snapshot reviewed in Preview.",
      });
    }

    // Envelope enforcement: only `btpm_published_story_v1` is accepted.
    // Reject raw AI blueprint shapes (`roadmap_story_presentation_v1` at
    // root) and shapes with no/blank/other schemaVersion.
    const incomingSchema =
      typeof snapshotSource.schemaVersion === "string" ? snapshotSource.schemaVersion : "";
    const incomingBlocks = Array.isArray(snapshotSource.blocks) ? snapshotSource.blocks : null;
    if (
      incomingSchema !== SCHEMA_VERSION ||
      !incomingBlocks ||
      incomingBlocks.length === 0
    ) {
      return json(400, {
        ok: false,
        error: "invalid_rendered_snapshot",
        note:
          `Snapshot must be a "${SCHEMA_VERSION}" envelope with a non-empty blocks array. ` +
          `Use buildRenderedPublishedSnapshot() on the reviewed Preview state before publishing.`,
      });
    }

    const safeSnapshot = toSafeSnapshot(snapshotSource, sourceMode, {
      storyPackVersionId: effectiveStoryPackVersionId ?? undefined,
      presentationBlueprintRunId: effectiveBlueprintRunId ?? undefined,
    });

    // Title precedence: explicit override -> snapshot title -> pack title.
    const title =
      (typeof body.titleOverride === "string" && body.titleOverride.trim().length > 0
        ? body.titleOverride.trim()
        : (typeof safeSnapshot.title === "string" && (safeSnapshot.title as string).trim().length > 0
            ? (safeSnapshot.title as string).trim()
            : cfg.pack.title ?? "Roadmap Story")).slice(0, 300);

    (safeSnapshot as Record<string, unknown>).title = title;

    const snapshotJson = JSON.stringify(safeSnapshot);
    if (snapshotJson.length > MAX_SNAPSHOT_BYTES) {
      return json(413, {
        ok: false,
        error: "snapshot_too_large",
        note: `Snapshot exceeds ${Math.round(MAX_SNAPSHOT_BYTES / 1024)} KB.`,
      });
    }
    const limitationsJson = JSON.stringify(
      Array.isArray(safeSnapshot.sourceLimitations) ? safeSnapshot.sourceLimitations : [],
    );

    // --- Call transactional publish RPC ----------------------------------
    const { data: rpcData, error: rpcErr } = await userClient.rpc(
      "publish_roadmap_story_presentation_version",
      {
        _story_pack_id: body.storyPackId,
        _story_pack_version_id: effectiveStoryPackVersionId,
        _presentation_blueprint_run_id: effectiveBlueprintRunId,
        _title: title,
        _snapshot_json: snapshotJson,
        _source_limitations_json: limitationsJson,
        _source_mode: sourceMode,
        _publish_warnings: [],
      },
    );
    if (rpcErr) {
      const m = String(rpcErr.message ?? "").toLowerCase();
      if (m.includes("forbidden") || m.includes("42501")) return json(403, { ok: false, error: "forbidden" });
      if (m.includes("archived")) return json(409, { ok: false, error: "story_pack_archived" });
      if (m.includes("inconsistent_story_pack_version_run")) {
        return json(400, { ok: false, error: "inconsistent_story_pack_version_run" });
      }
      if (m.includes("invalid_story_pack_version")) {
        return json(400, { ok: false, error: "invalid_story_pack_version" });
      }
      if (m.includes("invalid_presentation_blueprint_run")) {
        return json(400, { ok: false, error: "invalid_presentation_blueprint_run" });
      }
      if (m.includes("invalid_source_mode") || m.includes("invalid_snapshot")) {
        return json(400, { ok: false, error: "invalid_request", note: safeMsg(rpcErr) });
      }
      return json(500, { ok: false, error: "publish_failed", note: safeMsg(rpcErr) });
    }

    const result = (rpcData ?? {}) as Record<string, unknown>;
    const versionId = result.version_id as string;
    return json(200, {
      ok: true,
      presentationId: result.presentation_id,
      versionId,
      storyPackId: result.story_pack_id,
      storyPackVersionId: result.story_pack_version_id ?? null,
      versionNumber: result.version_number,
      title: result.title,
      status: result.status ?? "active",
      publishedAt: result.published_at,
      sourceProjectCount: result.source_project_count ?? 0,
      sourceMode: result.source_mode ?? sourceMode,
      scopeSource: result.scope_source ?? "none",
      warnings: Array.isArray(result.warnings) ? result.warnings : [],
      futurePath: `${FUTURE_VIEWER_PATH}/${versionId}`,
    });
  } catch (e) {
    console.log("publish_roadmap_story_presentation_unhandled", { message: safeMsg(e) });
    return json(500, { ok: false, error: "internal_error", note: safeMsg(e) });
  }
});
