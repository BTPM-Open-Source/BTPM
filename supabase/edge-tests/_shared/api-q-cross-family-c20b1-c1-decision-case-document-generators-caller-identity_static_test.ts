/**
 * API-Q Cross-Family-C20B1-C1 — static/contract test.
 *
 * Proves the two Decision Case document generator Edge Functions preserve
 * caller identity when invoking the C20B1-protected native-browser Governance
 * read RPCs: mappers now take (callerClient, adminClient, ...), all protected
 * browser RPCs run on callerClient, and service-role use is limited to the
 * pre-existing direct Organization/Profile reads and btpm_decrypt helper.
 */
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

const WORD_FN = "supabase/functions/generate-decision-case-word-brief/index.ts";
const WORD_MAP = "supabase/functions/generate-decision-case-word-brief/dataMapper.ts";
const PPT_FN = "supabase/functions/generate-decision-case-ppt-onepager/index.ts";
const PPT_MAP = "supabase/functions/generate-decision-case-ppt-onepager/dataMapper.ts";

const wordFn = await Deno.readTextFile(WORD_FN);
const wordMap = await Deno.readTextFile(WORD_MAP);
const pptFn = await Deno.readTextFile(PPT_FN);
const pptMap = await Deno.readTextFile(PPT_MAP);

const FNS: Array<[string, string]> = [["word", wordFn], ["ppt", pptFn]];
const MAPS: Array<[string, string]> = [["word", wordMap], ["ppt", pptMap]];

const PROTECTED_RPCS = [
  "get_governance_record_detail",
  "list_governance_record_stakeholder_packages",
  "get_governance_record_decision_outcome",
  "list_governance_record_evidence_references",
  "list_governance_record_cross_project_links",
  "get_decrypted_project",
];

Deno.test("C20B1-C1: Edge Functions keep caller-scoped client, browser guard, auth", () => {
  for (const [name, src] of FNS) {
    assert(
      src.includes("createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {") &&
        src.includes("Authorization: authHeader"),
      `${name}: caller-scoped anon client with Authorization header`,
    );
    assert(src.includes("assertBrowserSessionOnly(req, verifier)"), `${name}: browser guard`);
    assert(src.includes("await supabase.auth.getUser()"), `${name}: caller authentication`);
    assert(
      src.includes('createClient(SUPABASE_URL, SERVICE_ROLE)'),
      `${name}: admin client retained`,
    );
  }
});

Deno.test("C20B1-C1: PM authority is checked before mapper execution", () => {
  for (const [name, src] of FNS) {
    const guard = src.indexOf("assertBrowserSessionOnly(req, verifier)");
    const auth = src.indexOf('"has_project_pm_authority"');
    const mapper = src.indexOf("mapDecisionCaseTo");
    const mapperCall = src.indexOf("mapping = await mapDecisionCaseTo");
    assert(guard >= 0 && auth > guard, `${name}: authority after browser guard`);
    assert(mapper >= 0, `${name}: mapper imported`);
    assert(mapperCall > auth, `${name}: mapper invoked after PM authority`);
    assert(src.includes("authorized !== true"), `${name}: authority enforcement preserved`);
  }
});

Deno.test("C20B1-C1: mapper call sites pass callerClient then adminClient", () => {
  assert(
    wordFn.includes(
      "mapDecisionCaseToBriefData(supabase, adminClient, recordId, userData.user.id)",
    ),
  );
  assert(
    pptFn.includes(
      "mapDecisionCaseToOnepagerData(supabase, adminClient, recordId, userData.user.id)",
    ),
  );
});

Deno.test("C20B1-C1: mapper signatures accept separate caller/admin clients", () => {
  for (const [name, src] of MAPS) {
    assert(
      /export async function mapDecisionCaseTo\w+\(\s*callerClient: SupabaseClient,\s*adminClient: SupabaseClient,\s*recordId: string,\s*callerUserId: string,\s*\): Promise<MapResult>/
        .test(src),
      `${name}: dual-client signature`,
    );
    // no ambiguous single `supabase` mapper parameter remains
    assert(!/mapDecisionCaseTo\w+\(\s*supabase: SupabaseClient/.test(src), `${name}: no ambiguous param`);
  }
});

Deno.test("C20B1-C1: every protected browser RPC is invoked with callerClient", () => {
  for (const [name, src] of MAPS) {
    for (const rpc of PROTECTED_RPCS) {
      const occurrences = src.split(`"${rpc}"`).length - 1;
      assert(occurrences >= 1, `${name}: ${rpc} present`);
      const re = new RegExp(`callerClient\\.rpc\\(\\s*"${rpc}"`);
      assert(re.test(src), `${name}: ${rpc} must use callerClient`);
      assert(
        !new RegExp(`adminClient\\.rpc\\(\\s*"${rpc}"`).test(src),
        `${name}: ${rpc} must never use adminClient`,
      );
    }
  }
});

Deno.test("C20B1-C1: adminClient limited to direct org/profile reads and btpm_decrypt", () => {
  for (const [name, src] of MAPS) {
    assert(src.includes('adminClient\n      .from("organizations")'), `${name}: org read on admin`);
    assert(src.includes('adminClient\n      .from("profiles")'), `${name}: profile read on admin`);
    assert(src.includes("decrypt(adminClient,"), `${name}: server-side decrypt on admin`);
    // decrypt helper only ever calls btpm_decrypt
    const adminRpcs = [...src.matchAll(/adminClient\.rpc\(\s*"([a-z_]+)"/g)].map((m) => m[1]);
    assertEquals(adminRpcs, [], `${name}: no direct adminClient.rpc protected reads`);
    assert(src.includes('rpc("btpm_decrypt"'), `${name}: btpm_decrypt helper preserved`);
    // caller-scoped RPCs only; no service-role RPC fallbacks
    assert(!src.includes("SUPABASE_SERVICE_ROLE_KEY"), `${name}: no service-role key in mapper`);
  }
});

Deno.test("C20B1-C1: no bypass language introduced", () => {
  for (const [name, src] of [...MAPS, ...FNS]) {
    for (const forbidden of ["source_channel", "trusted_context", "connected_app", "mcp_", "service_role_bypass"]) {
      assert(!src.toLowerCase().includes(forbidden), `${name}: must not reference ${forbidden}`);
    }
  }
});

Deno.test("C20B1-C1: mapper result structures preserved", () => {
  for (const [name, src] of MAPS) {
    for (
      const key of [
        "snapshotAt",
        "projectId",
        "organizationId",
        "workspaceId",
        "governanceRecordId",
        "packageVersionNumber",
      ]
    ) {
      assert(src.includes(key), `${name}: ${key} retained`);
    }
    assert(src.includes("export class MapError"), `${name}: MapError retained`);
    assert(src.includes("generatedByLabel"), `${name}: generated-by retained`);
    assert(src.includes("organizationName"), `${name}: organization naming retained`);
  }
});

Deno.test("C20B1-C1: shared guard and accepted migration remain present", async () => {
  const guard = await Deno.readTextFile(
    "supabase/functions/_shared/btpm-api/assertBrowserSessionOnly.ts",
  );
  assert(guard.includes("assertBrowserSessionOnly"), "guard export intact");
  const c20b1 = await Deno.readTextFile(
    "supabase/migrations/20260820075407_2416cea5-a2d7-4c3a-a589-c65a05ba76bf.sql",
  );
  assert(c20b1.includes("_gov_assert_project_read"), "C20B1 migration still present");
});
