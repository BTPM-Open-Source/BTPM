/**
 * Centralized linking — shared explicit types and a typed RPC wrapper.
 *
 * These types form the single source of truth for the centralized linking
 * substrate (entity_user_links / entity_object_links) and the surrounding
 * blocker / risk RPCs. Components and hooks should import from here rather
 * than re-declaring loose shapes.
 *
 * Runtime behavior is unchanged — these are typing primitives only.
 */
import { supabase } from "@/integrations/supabase/client";
import type { CommentReferenceTargetType } from "@/hooks/useExecutionData";

// -------------------- Roles & owner discriminators --------------------

export type EntityLinkOwnerType = "comment" | "blocker" | "risk";
export type EntityObjectLinkRole = "reference" | "related_object";
export type EntityUserLinkRole = "mention" | "related_person";
export type LinkedObjectType = CommentReferenceTargetType; // 'project' | 'phase' | 'task'

// -------------------- Saved row shapes (read side) --------------------

export type LinkedPersonKind = "workspace_member" | "external";

export interface LinkedPersonRow {
  id: string;
  /** Set when the link points at a workspace user (profiles row). */
  user_id: string | null;
  /** Set when the link points at a project stakeholder (internal or external). */
  stakeholder_id: string | null;
  /** workspace_member when user_id is set OR stakeholder is internal; external otherwise. */
  stakeholder_type: LinkedPersonKind | null;
  link_role: EntityUserLinkRole;
  display_name: string | null;
  sort_order: number;
}

export interface LinkedObjectRow {
  id: string;
  referenced_type: LinkedObjectType;
  referenced_id: string;
  workspace_id: string;
  link_role: EntityObjectLinkRole;
  project_id: string | null;
  phase_id: string | null;
  display_label: string | null;
  context_label: string | null;
  sort_order: number;
}

export interface OwnerLinksGroup {
  people: LinkedPersonRow[];
  objects: LinkedObjectRow[];
}

// -------------------- Draft (in-form) selection shapes ----------------

/**
 * Draft "person" selected in a form. Exactly one of user_id / stakeholder_id is set.
 */
export interface DraftPersonLink {
  user_id: string | null;
  stakeholder_id: string | null;
  stakeholder_type: LinkedPersonKind | null;
  display_name: string | null;
}

export interface DraftObjectLink {
  referenced_type: LinkedObjectType;
  referenced_id: string;
  workspace_id: string;
  project_id: string | null;
  phase_id: string | null;
  display_label: string | null;
  context_label: string | null;
}

// -------------------- RPC payload shapes (write side) -----------------

/** Each person link must have exactly one of user_id / stakeholder_id set. */
export interface UserLinkInput {
  user_id?: string | null;
  stakeholder_id?: string | null;
}

export interface ObjectLinkInput {
  referenced_type: LinkedObjectType;
  referenced_id: string;
}

/** Stable selection key for a draft person, regardless of which kind it is. */
export function personDraftKey(p: Pick<DraftPersonLink, "user_id" | "stakeholder_id">): string {
  return p.user_id ? `u:${p.user_id}` : `s:${p.stakeholder_id ?? ""}`;
}

// -------------------- Aggregated row shapes used by lists -------------

/**
 * Common fields returned by `list_project_all_risks` / `list_project_all_blockers`.
 * These RPCs return jsonb rows that are decrypted server-side. We narrow at the
 * boundary so consuming components do not need `any`.
 */
export interface ProjectRiskRow {
  id: string;
  title: string;
  description: string | null;
  mitigation_plan: string | null;
  likelihood: string;
  impact: string;
  status: string;
  target_type: string;
  target_id: string;
  source_name: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProjectBlockerRow {
  id: string;
  title: string;
  description: string | null;
  severity: string;
  status: string;
  target_type: string;
  target_id: string;
  source_name: string | null;
  reported_by: string | null;
  resolved_at: string | null;
  resolved_by: string | null;
  created_at: string;
  updated_at: string;
}

// -------------------- Typed RPC helper --------------------------------

/**
 * Generic typed wrapper for SECURITY DEFINER RPCs that return jsonb.
 * Generated supabase types model these as `Json`, so we narrow once at the
 * boundary instead of sprinkling `as any` through call sites. The .call()
 * binding is required so the underlying Supabase client retains its `this`
 * (otherwise internal access to `.rest` fails — see prior fix).
 */
export type RpcResult<T> = { data: T | null; error: { message: string } | null };
export type RpcCallable = <T>(name: string, args: Record<string, unknown>) => Promise<RpcResult<T>>;

export const rpcTyped: RpcCallable = <T>(name: string, args: Record<string, unknown>) =>
  (
    supabase.rpc as unknown as (
      n: string,
      a: Record<string, unknown>,
    ) => Promise<RpcResult<T>>
  ).call(supabase, name, args) as Promise<RpcResult<T>>;
