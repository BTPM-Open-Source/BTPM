// API-Q.PS.3 — Universal Project Selector: pure browser-View state logic.
//
// This module is intentionally DOM-free, network-free and SDK-free so it can be
// unit-tested directly. It contains NO BTPM business behavior: no Supabase
// client, no RPC, no tool call, no Tenant/Organization/Workspace/Project
// identity, no persistence and no secret.

/** Bounded set of View states rendered by the Project selector shell. */
export type SelectorViewStateKind =
  | "loading"
  | "ready"
  | "host-unsupported"
  | "unavailable";

/** Host themes explicitly supported by the View. */
export type SelectorTheme = "light" | "dark";

/** Bounded, user-safe copy for every View state. No protocol data is exposed. */
export const SELECTOR_STATE_MESSAGES: Readonly<
  Record<SelectorViewStateKind, string>
> = Object.freeze({
  loading: "Connecting to the host\u2026",
  ready: "Ready to load available workspaces.",
  "host-unsupported":
    "Interactive Project selection is unavailable in this host. Use the text fallback in the conversation.",
  unavailable:
    "The Project selector is unavailable right now. Use the text fallback in the conversation.",
});

/**
 * Detects whether the host can proxy server tool calls.
 *
 * Defensive by design: any missing/non-object capability payload yields `false`
 * instead of throwing, so an absent optional host capability never produces an
 * unhandled error.
 */
export function hostSupportsServerTools(hostCapabilities: unknown): boolean {
  if (typeof hostCapabilities !== "object" || hostCapabilities === null) {
    return false;
  }
  const serverTools = (hostCapabilities as Record<string, unknown>)
    .serverTools;
  return typeof serverTools === "object" && serverTools !== null;
}

/**
 * Resolves the host theme from an arbitrary host-context payload.
 * Unknown/absent themes fall back to `light`.
 */
export function resolveHostTheme(hostContext: unknown): SelectorTheme {
  if (typeof hostContext === "object" && hostContext !== null) {
    const theme = (hostContext as Record<string, unknown>).theme;
    if (theme === "dark") return "dark";
    if (theme === "light") return "light";
  }
  return "light";
}

/**
 * Defensively validates the bootstrap structured content returned by
 * `btpm_choose_project`.
 *
 * The bootstrap result is presentation-only and is NEVER treated as authority
 * for Tenant, Organization, Workspace or Project identity.
 */
export function isValidBootstrapResult(structuredContent: unknown): boolean {
  if (typeof structuredContent !== "object" || structuredContent === null) {
    return false;
  }
  const candidate = structuredContent as Record<string, unknown>;
  return candidate.selector === "btpm_project" && candidate.state === "ready";
}

/** Inputs used to derive the bounded View state. */
export type SelectorViewStateInput = {
  connected: boolean;
  /** True only when `app.connect()` actually failed. */
  connectionFailed?: boolean;
  hostCapabilities?: unknown;
  bootstrapResult?: unknown;
  bootstrapReceived?: boolean;
  /**
   * Defensive presentation-only record of bootstrap validity (API-Q.PS.4A-C2).
   * Never a discovery prerequisite and never business authority.
   */
  bootstrapValid?: boolean;

};

/** Derived, bounded View state. */
export type SelectorViewState = {
  kind: SelectorViewStateKind;
  message: string;
};

/**
 * Derives exactly one bounded View state. Never throws and never surfaces raw
 * protocol payloads or exception text.
 */
export function deriveSelectorViewState(
  input: SelectorViewStateInput,
): SelectorViewState {
  const kind = deriveSelectorViewStateKind(input);
  return { kind, message: SELECTOR_STATE_MESSAGES[kind] };
}

function deriveSelectorViewStateKind(
  input: SelectorViewStateInput,
): SelectorViewStateKind {
  if (input.connectionFailed) return "unavailable";
  if (!input.connected) return "loading";
  if (!hostSupportsServerTools(input.hostCapabilities)) {
    return "host-unsupported";
  }
  if (input.bootstrapReceived && !isValidBootstrapResult(input.bootstrapResult)) {
    return "unavailable";
  }
  return "ready";
}
