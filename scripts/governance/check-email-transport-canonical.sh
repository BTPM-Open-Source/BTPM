#!/usr/bin/env bash
# check-email-transport-canonical.sh
#
# Phase 4D.14A.7H advisory guard. Grep-based static check that flags common
# ways of bypassing the canonical BTPM email transport layers documented
# in docs/governance/architecture/email-transport-canonical-model.md.
#
# Exits non-zero when a forbidden pattern is found. Warnings only for the
# soft SMTP env-var scan. Test files that enforce these invariants are
# excluded from the scans.

set -u
cd "$(dirname "$0")/../.."

fail=0
warn=0

# Exclude enforcement test files themselves from the pattern scans.
EXCLUDE_TESTS='(_test\.ts|\.test\.ts)$'

echo "[check-email-transport] scanning supabase/functions ..."

# 1. nodemailer may only be imported by tenantOutboundEmail.ts
nm=$(grep -RIl --include='*.ts' 'from "npm:nodemailer' supabase/functions 2>/dev/null | grep -v 'supabase/functions/_shared/tenantOutboundEmail.ts' || true)
if [ -n "$nm" ]; then
  echo "FAIL: nodemailer imported outside tenantOutboundEmail.ts:"
  echo "$nm" | sed 's/^/  /'
  fail=1
fi

# 2. sendGraphMail is retired. No source file may reference it.
gm=$(grep -RIln --include='*.ts' 'sendGraphMail' supabase/functions src 2>/dev/null | grep -Ev "$EXCLUDE_TESTS" || true)
if [ -n "$gm" ]; then
  echo "FAIL: sendGraphMail is retired but still referenced:"
  echo "$gm" | sed 's/^/  /'
  fail=1
fi

# 2b. No source file may hold the retired graphMail.ts transport helper.
if [ -f supabase/functions/_shared/graphMail.ts ]; then
  echo "FAIL: supabase/functions/_shared/graphMail.ts must be deleted (Phase 4D.14A.7H)"
  fail=1
fi

# 2c. No Microsoft Graph /sendMail endpoint may appear in BTPM runtime.
sm=$(grep -RIln --include='*.ts' '/sendMail' supabase/functions src 2>/dev/null | grep -Ev "$EXCLUDE_TESTS" || true)
if [ -n "$sm" ]; then
  echo "FAIL: Microsoft Graph /sendMail endpoint reference detected (Graph mail retired):"
  echo "$sm" | sed 's/^/  /'
  fail=1
fi

# 2d. The retired transport outcome literal must not appear.
gg=$(grep -RIln --include='*.ts' -E 'global_graph_fallback|sent_fallback|failed_fallback' supabase/functions src 2>/dev/null | grep -Ev "$EXCLUDE_TESTS" || true)
if [ -n "$gg" ]; then
  echo "FAIL: retired Graph-fallback transport outcome literal remains:"
  echo "$gg" | sed 's/^/  /'
  fail=1
fi

# 2e. M365_SENDER_EMAIL / M365_SENDER_NAME are runtime-unused after 7H.
ms=$(grep -RIln --include='*.ts' -E 'Deno\.env\.get\("M365_SENDER_(EMAIL|NAME)"\)' supabase/functions 2>/dev/null | grep -Ev "$EXCLUDE_TESTS" || true)
if [ -n "$ms" ]; then
  echo "FAIL: M365_SENDER_EMAIL / M365_SENDER_NAME are retired runtime env reads:"
  echo "$ms" | sed 's/^/  /'
  fail=1
fi

# 3. SMTP_* env vars must not appear in BTPM notification functions
smtp=$(grep -RIn --include='*.ts' -E 'Deno\.env\.get\("SMTP_(HOST|PORT|USER|PASS|PASSWORD|FROM|FROM_EMAIL|FROM_NAME)"\)' supabase/functions 2>/dev/null || true)
if [ -n "$smtp" ]; then
  echo "WARN: SMTP_* env var read detected (should not exist in BTPM notification code):"
  echo "$smtp" | sed 's/^/  /'
  warn=1
fi

# 4. New email-sending edge functions must call sendTenantEmail or sendAuthEmail.
#    Heuristic: any index.ts under supabase/functions/send-*, notify-*, invite-*
#    or *-email/ that does not import one of the canonical helpers.
#
# Allowlist — name matches the heuristic but the function does NOT send email:
#   - get-kpi-app-system-email: metadata fetch helper. Read-only.
ALLOWLIST_REGEX='supabase/functions/get-kpi-app-system-email/index.ts'
suspects=$(ls -d supabase/functions/send-* supabase/functions/*-email supabase/functions/invite-* supabase/functions/notify-* supabase/functions/process-notifications 2>/dev/null || true)
for dir in $suspects; do
  idx="$dir/index.ts"
  [ -f "$idx" ] || continue
  if echo "$idx" | grep -Eq "$ALLOWLIST_REGEX"; then
    continue
  fi
  if ! grep -qE 'sendTenantEmail|sendAuthEmail' "$idx"; then
    echo "WARN: $idx sends email flavor but imports neither sendTenantEmail nor sendAuthEmail"
    warn=1
  fi
done

if [ "$fail" -ne 0 ]; then
  echo "[check-email-transport] FAILED"
  exit 1
fi
if [ "$warn" -ne 0 ]; then
  echo "[check-email-transport] passed with warnings"
  exit 0
fi
echo "[check-email-transport] OK"
