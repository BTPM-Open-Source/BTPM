/**
 * DC.14 + DC.16 — Decision Case Data Package service.
 *
 * Invokes the JSON-only generator (DC.14) and the ZIP bundle generator
 * (DC.16), plus the protected signed-URL flow to download a bundle.
 */
import { supabase } from "@/integrations/supabase/client";

export type GenerateDataPackageResult = {
  ok: true;
  package_id: string;
  version_number: number;
  package_filename: string;
  package_hash: string;
  package_json?: string;
  source_snapshot_at: string;
};

export async function generateDecisionCaseDataPackage(
  recordId: string,
): Promise<GenerateDataPackageResult> {
  const { data, error } = await supabase.functions.invoke(
    "generate-decision-case-data-package",
    { body: { recordId } },
  );
  if (error) throw error;
  const payload = data as any;
  if (!payload?.ok) {
    const msg = payload?.note || payload?.error || "Could not generate data package.";
    throw new Error(msg);
  }
  return payload as GenerateDataPackageResult;
}

export type GenerateDataPackageBundleResult = {
  ok: true;
  package_id: string;
  version_number: number;
  package_filename: string;
  package_hash: string;
  bundle_filename: string;
  bundle_hash: string;
  bundle_size_bytes: number;
  bundle_status: "generated" | "partial";
  bundle_file_count: number;
  bundle_packaged_file_count: number;
  bundle_failed_file_count: number;
  bundle_metadata_only_count: number;
  source_snapshot_at: string;
};

export async function generateDecisionCaseDataPackageBundle(
  recordId: string,
): Promise<GenerateDataPackageBundleResult> {
  const { data, error } = await supabase.functions.invoke(
    "generate-decision-case-data-package-bundle",
    { body: { recordId } },
  );
  if (error) throw error;
  const payload = data as any;
  if (!payload?.ok) {
    const msg = payload?.note || payload?.error || "Could not generate ZIP bundle.";
    throw new Error(msg);
  }
  return payload as GenerateDataPackageBundleResult;
}

export type DataPackageBundleSignedUrlResult = {
  signed_url: string;
  bundle_filename: string | null;
  bundle_size_bytes: number | null;
  expires_in_seconds: number;
};

export async function getDecisionCaseDataPackageBundleDownloadUrl(
  recordId: string,
  packageId: string,
): Promise<DataPackageBundleSignedUrlResult> {
  const { data, error } = await supabase.functions.invoke(
    "get-decision-case-data-package-bundle-download-url",
    { body: { recordId, packageId } },
  );
  if (error) throw error;
  const payload = data as any;
  if (!payload?.ok) {
    const msg = payload?.note || payload?.error || "Could not get download link.";
    throw new Error(msg);
  }
  return {
    signed_url: payload.signed_url,
    bundle_filename: payload.bundle_filename ?? null,
    bundle_size_bytes: payload.bundle_size_bytes ?? null,
    expires_in_seconds: payload.expires_in_seconds ?? 300,
  };
}
