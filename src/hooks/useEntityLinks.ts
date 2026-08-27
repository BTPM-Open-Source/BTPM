/**
 * Centralized entity-link hooks.
 *
 * Reads `entity_user_links` and `entity_object_links` for any owner type
 * (comment / blocker / risk) via the protected `list_entity_links` RPC.
 * Labels (project/phase/task names, user display names) are resolved
 * server-side through `btpm_decrypt`. The link tables themselves never
 * store plaintext labels.
 */
import { useQuery } from "@tanstack/react-query";
import {
  rpcTyped,
  type EntityLinkOwnerType,
  type EntityObjectLinkRole,
  type EntityUserLinkRole,
  type LinkedObjectRow,
  type LinkedObjectType,
  type LinkedPersonRow,
  type ObjectLinkInput,
  type OwnerLinksGroup,
  type UserLinkInput,
} from "@/lib/entityLinks";

// Re-export for backwards compatibility with existing call sites.
export type {
  EntityLinkOwnerType as EntityOwnerType,
  EntityObjectLinkRole as ObjectLinkRole,
  EntityUserLinkRole as UserLinkRole,
  LinkedObjectRow as LinkedObject,
  LinkedPersonRow as LinkedPerson,
  ObjectLinkInput,
  UserLinkInput,
};

export type LinksByOwnerId = Record<string, OwnerLinksGroup>;

interface OwnerLinksRpcRow {
  owner_id: string;
  people: LinkedPersonRow[] | null;
  objects: LinkedObjectRow[] | null;
}

/**
 * Batch-load links for a list of owner ids of a given owner type.
 * Returns a map keyed by owner_id for easy O(1) chip rendering.
 */
export function useEntityLinks(ownerType: EntityLinkOwnerType, ownerIds: string[]) {
  const sortedKey = [...ownerIds].sort().join(",");
  return useQuery<LinksByOwnerId>({
    queryKey: ["entity-links", ownerType, sortedKey],
    queryFn: async () => {
      if (ownerIds.length === 0) return {};
      const { data, error } = await rpcTyped<OwnerLinksRpcRow[]>("list_entity_links", {
        _owner_type: ownerType,
        _owner_ids: ownerIds,
      });
      if (error) throw new Error(error.message);
      const map: LinksByOwnerId = {};
      for (const r of data ?? []) {
        map[r.owner_id] = { people: r.people ?? [], objects: r.objects ?? [] };
      }
      return map;
    },
    enabled: ownerIds.length > 0,
  });
}

// Re-export referenced object type for downstream consumers
export type { LinkedObjectType };
