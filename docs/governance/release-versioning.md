# BTPM — Release Versioning & Refresh Gate (Wave B)

## Concepts

- **APP_VERSION** — human-readable app version, sourced from `package.json`.
  Stable across builds within a single approved implementation step.
- **BUILD_VERSION** — per-build fingerprint: `${APP_VERSION}+${UTC stamp}`.
  Regenerated on every build/dev start.
- **RELEASED_AT_UTC** — ISO-8601 UTC timestamp of metadata generation.

These three values are emitted into `src/release/releaseMetadata.generated.ts`
by `scripts/generate-release-metadata.mjs`, run automatically via the `prebuild`
and `dev` scripts. The generated file is committed (so dev installs work) but is
overwritten on every build.

## Per-step version bump

Before code changes for a new approved step:

```bash
npm run version:step
```

This bumps `package.json` patch version (e.g. `0.1.0 → 0.1.1`) once per step.
**Do not** wire this into `build` — repeated local builds in one step must not
inflate the version.

## Browser release gate

`src/release/releaseGate.ts` runs in `src/main.tsx` BEFORE React renders.

On startup it compares the embedded `BUILD_VERSION` to
`localStorage["btpm:release:applied-build"]`:

| Case | Behavior |
|---|---|
| First load (no applied build) | Record current build, continue (no reload). |
| Match | Clear reload guard, continue. |
| Mismatch | Record new build → clear BTPM UI state → clear React Query cache → unregister any service workers → one-time hard reload (guarded). |

### Cleared keys on mismatch

Only keys under these prefixes are removed:

- `btpm:view-state:v1:*`
- `btpm:saved-views:v1:*`
- `btpm:release:*` (excluding the applied-build pointer + reload guard)

### Preserved on mismatch

- Supabase auth/session (`sb-*` keys) — user stays signed in.
- Any non-`btpm:` keys.

## BTPM client-storage namespace rule

**All future BTPM-owned browser-persisted keys MUST live under the `btpm:`
namespace.** This keeps the release gate's invalidation surface predictable and
avoids accidental wipe of unrelated storage (especially Supabase auth).

## UI surface

App / Build / Released-At are shown on the Account page, low-noise.

## Service workers

None today. The gate calls `navigator.serviceWorker.getRegistrations()` and
unregisters whatever it finds during a mismatch reload — safe no-op when absent.
