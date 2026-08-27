// 4D.13A F-3 cleanup:
// The browser-side btpm_decrypt fallback (matching a legacy PGP-armored
// pattern) was removed. After grant hardening in 4D.12N.x, decrypt helpers
// are service-role only and can never be reached from the browser. The
// supported read path is the SECURITY DEFINER RPC `list_decrypted_project_team`,
// which already returns plaintext role_label values.
//
// This module now provides a passthrough so existing callers keep compiling
// without introducing any client-side decrypt attempt.

export async function normalizeProjectTeamRoleLabels<T extends { role_label: string | null }>(
  _projectId: string,
  members: T[],
): Promise<T[]> {
  return members;
}
