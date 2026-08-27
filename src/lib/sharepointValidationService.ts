/**
 * SP.3b — Client wrapper for the sharepoint-validate edge function.
 *
 * No Graph calls happen in the browser. This module simply invokes the
 * server-side validation function and returns its outcome.
 */

import { supabase } from "@/integrations/supabase/client";
import type {
  SharepointProjectBinding,
  SharepointWorkspaceBinding,
} from "./sharepointBindingTypes";

export interface ValidationOutcome {
  status: "validated" | "invalid";
  code: string;
  note: string;
}

export async function validateWorkspaceBinding(
  bindingId: string,
): Promise<{ result: ValidationOutcome; binding: SharepointWorkspaceBinding }> {
  const { data, error } = await supabase.functions.invoke("sharepoint-validate", {
    body: { action: "validate_workspace_binding", binding_id: bindingId },
  });
  if (error) throw new Error(error.message);
  return data as { result: ValidationOutcome; binding: SharepointWorkspaceBinding };
}

export async function validateProjectBinding(
  bindingId: string,
): Promise<{ result: ValidationOutcome; binding: SharepointProjectBinding }> {
  const { data, error } = await supabase.functions.invoke("sharepoint-validate", {
    body: { action: "validate_project_binding", binding_id: bindingId },
  });
  if (error) throw new Error(error.message);
  return data as { result: ValidationOutcome; binding: SharepointProjectBinding };
}
