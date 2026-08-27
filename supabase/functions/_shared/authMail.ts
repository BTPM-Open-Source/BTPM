// BTPM auth-style email templates. All rendering goes through the shared
// BTPM shell in `emailBrand.ts` so visual style stays consistent across
// invitations, resets, access notifications, and operational notifications.

import { renderBtpmEmail } from "./emailBrand.ts";

export function inviteEmailTemplate(actionUrl: string, recipientEmail?: string): { subject: string; html: string } {
  return {
    subject: "You've been invited to BTPM",
    html: renderBtpmEmail({
      title: "You've been invited",
      intro: [
        "You have been invited to access <strong>BTPM</strong> (Business Transformation &amp; Project Management).",
        "Click the button below to accept the invitation and complete your account setup.",
      ],
      cta: {
        label: "Accept Invitation",
        url: actionUrl,
        note: recipientEmail
          ? `This invitation was sent to <strong>${recipientEmail}</strong>.`
          : "This invitation link expires in 7 days.",
      },
      outro: [
        "If you were not expecting this invitation, you can safely ignore this email.",
      ],
    }),
  };
}

export function inviteResendEmailTemplate(actionUrl: string, recipientEmail?: string): { subject: string; html: string } {
  return {
    subject: "Your BTPM invitation (resent)",
    html: renderBtpmEmail({
      title: "Your BTPM invitation",
      intro: [
        "Here is a fresh invitation link for <strong>BTPM</strong>. Click below to accept and set up your account.",
      ],
      cta: {
        label: "Accept Invitation",
        url: actionUrl,
        note: recipientEmail
          ? `This invitation was sent to <strong>${recipientEmail}</strong>.`
          : "This invitation link expires in 7 days.",
      },
      outro: [
        "If you were not expecting this invitation, you can safely ignore this email.",
      ],
    }),
  };
}

export function existingUserAccessEmailTemplate(signInUrl: string): { subject: string; html: string } {
  return {
    subject: "You've been granted access in BTPM",
    html: renderBtpmEmail({
      title: "Access granted in BTPM",
      intro: [
        "An organization administrator has granted you access to a <strong>BTPM</strong> workspace.",
        "Since you already have a BTPM account, simply sign in normally and your new access will be activated automatically.",
      ],
      cta: {
        label: "Sign in to BTPM",
        url: signInUrl,
      },
    }),
  };
}

export function passwordResetEmailTemplate(actionUrl: string): { subject: string; html: string } {
  return {
    subject: "Reset your BTPM password",
    html: renderBtpmEmail({
      title: "Reset your password",
      intro: [
        "We received a request to reset the password for your <strong>BTPM</strong> account.",
        "Click the button below to choose a new password. If you did not request this, you can safely ignore this email.",
      ],
      cta: {
        label: "Reset password",
        url: actionUrl,
        note: "This link will expire shortly for security reasons.",
      },
    }),
  };
}
