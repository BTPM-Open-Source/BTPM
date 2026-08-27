// AI-GUIDE.V2-HISTORY.1
// Front-end switch selecting which Guide model the user-facing BTPM Guide
// drawer calls. V2 is now the permanent model — the V1 ai-help-chat path
// is kept only as an emergency-only break-glass and is no longer part of
// the normal product surface. Conversation persistence is shared between
// both via the public.ai_help_* RPCs; V2 reuses that backend directly.
export type GuideModel = "v1" | "v2";
export const GUIDE_MODEL: GuideModel = "v2";
