// Shared BTPM email template module.
// All outbound emails render through `renderBtpmEmail` to keep a consistent,
// product-neutral shell without depending on company-specific logos or assets.

const BTPM_ACCENT = "#2563EB";

export interface BtpmEmailOptions {
  /** Big H1 inside the card (e.g. "You've been invited"). */
  title: string;
  /** Body paragraphs (HTML allowed). Rendered between the title and the CTA. */
  intro: string[];
  /** Optional CTA button + fallback link block. */
  cta?: {
    label: string;
    url: string;
    /** Optional small line printed under the CTA. */
    note?: string;
    /** Override default backup-link sentence. */
    backupLinkLabel?: string;
  };
  /** Optional muted paragraphs after the CTA. */
  outro?: string[];
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function renderBtpmEmail(opts: BtpmEmailOptions): string {
  const introHtml = opts.intro
    .map(
      (p) =>
        `<p style="margin:0 0 16px 0; font-size:16px; line-height:1.6; color:#374151;">${p}</p>`,
    )
    .join("\n");

  const outroHtml = (opts.outro ?? [])
    .map(
      (p) =>
        `<p style="margin:0 0 12px 0; font-size:14px; line-height:1.6; color:#6b7280;">${p}</p>`,
    )
    .join("\n");

  const ctaBlock = opts.cta
    ? `
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 28px 0;">
          <tr>
            <td align="center" bgcolor="${BTPM_ACCENT}" style="border-radius:8px;">
              <a href="${opts.cta.url}"
                 style="display:inline-block; padding:14px 24px; font-size:16px; font-weight:700; color:#ffffff; text-decoration:none; background-color:${BTPM_ACCENT}; border-radius:8px;">
                ${escapeHtml(opts.cta.label)}
              </a>
            </td>
          </tr>
        </table>
        ${
          opts.cta.note
            ? `<p style="margin:0 0 12px 0; font-size:14px; line-height:1.6; color:#6b7280;">${opts.cta.note}</p>`
            : ""
        }
        <p style="margin:0 0 24px 0; font-size:14px; line-height:1.6; color:#6b7280;">
          If the button does not work, use this
          <a href="${opts.cta.url}" style="color:${BTPM_ACCENT}; text-decoration:underline; font-weight:600;">${escapeHtml(opts.cta.backupLinkLabel ?? "backup link")}</a>.
        </p>`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
  <body style="margin:0; padding:0; background-color:#f4f7fb; font-family:Arial, Helvetica, sans-serif; color:#1f2937;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#f4f7fb; margin:0; padding:24px 0;">
      <tr>
        <td align="center">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:600px; background-color:#ffffff; border-radius:12px; overflow:hidden; border:1px solid #e5e7eb;">
            <tr>
              <td align="center" style="padding:32px 24px 20px 24px; background-color:#ffffff; font-size:28px; line-height:1; font-weight:800; letter-spacing:0.08em; color:#1C1F3F;">
                BTPM
              </td>
            </tr>
            <tr>
              <td style="height:4px; background-color:${BTPM_ACCENT}; font-size:0; line-height:0;">&nbsp;</td>
            </tr>
            <tr>
              <td style="padding:36px 36px 16px 36px;">
                <h1 style="margin:0 0 16px 0; font-size:28px; line-height:1.25; color:#111827; font-weight:700;">
                  ${escapeHtml(opts.title)}
                </h1>
                ${introHtml}
                ${ctaBlock}
                ${outroHtml}
              </td>
            </tr>
            <tr>
              <td style="padding:24px 36px 36px 36px; border-top:1px solid #e5e7eb;">
                <p style="margin:0 0 8px 0; font-size:12px; line-height:1.6; color:#9ca3af;">
                  BTPM
                </p>
                <p style="margin:0; font-size:12px; line-height:1.6; color:#9ca3af;">
                  This is an automated message. Please do not reply directly to this email.
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}
