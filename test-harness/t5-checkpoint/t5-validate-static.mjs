// t5-validate-static.mjs
// Offline, read-only structural validation of the T5 preparation artifacts.
// It does NOT connect to a database, does not touch R2, and never writes to the
// repository. It exists to prove the T3/T4-style fail-closed invariants hold in
// the SQL TEXT before any human-approved execution on TEST.
//
// Usage:  node t5-validate-static.mjs <temp-dir> [repo]

import { readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";

const dir = process.argv[2];
const repo = process.argv[3] ?? process.cwd();

const PREFLIGHT = join(dir, "slmm-storage-deletion-t5-preflight.sql");
const LIVE = join(dir, "slmm-storage-deletion-t5-live-test.sql");
const RESIDUE = join(dir, "slmm-storage-deletion-t5-residue.sql");
const REGISTRY = join(repo, "test-harness", "harness-registry.mjs");

const TEST_PROJECT = "nqadtfqyurkpmxcodswc";
const PROD_PROJECT = "sxpkutjkqfekqwpabgrk";

// Pins derived offline from the committed migrations (CRLF-normalized prosrc md5).
const PINS = {
  "request_storage_deletion(text)": "901ca9300b271f352a7b363f37e51dcb",
  "cancel_storage_deletion(uuid)": "c2e48b0f107ac242e191c9bdd2386133",
  "record_storage_deletion_failure(uuid,uuid,text,integer)": "12a965130212b9698995b4b9f81036f0",
  "set_r2_confirmed_absent(uuid,uuid)": "5a63fbd22c45a30be3873192ea7ba623",
  "finalize_storage_deletion(uuid,uuid)": "b94615e59b820ca251eecd676da95c82",
  "mark_storage_deletion_quota_resynced(uuid)": "65b6302eb1e8034d2ae78c504525af75",
  "list_storage_deletion_quota_resyncs(integer)": "693ebf9c15509a5c6c859b69b22724a2",
  "block_storage_deletion(uuid,uuid,text)": "c2f7bddfdcaf151b77def518a00f9fb7",
  "check_storage_deletion_references(text)": "cf3285a4bfc7ba3bbf39125f4a3ef923",
  "claim_storage_deletion_request(uuid)": "ca2d313afeab415ee946dbe6937b7d8b",
  "claim_storage_deletion_requests(integer)": "367b363648b8fd457fc37adbfad7ac35",
  "fence_storage_key_for_deletion(uuid,uuid)": "1d0b4fcec0a921b97b0bd85722800564",
  "enforce_storage_key_fence()": "49f49ea6fc593dc3ddb602385d765ee2",
  "is_storage_key_fenced(text)": "210a8e5b4444968bb62b1d4abdde3a38",
};

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok: !!ok, detail });
}
function slurp(p) { try { return readFileSync(p, "utf8"); } catch { return null; } }
function stripComments(s) {
  return s.replace(/--[^\n]*/g, "");
}
function hasAllPins(s) {
  return Object.entries(PINS).every(([k, v]) => s.includes(v));
}

const live = slurp(LIVE);
const pre = slurp(PREFLIGHT);
const res = slurp(RESIDUE);

// ---- Live test ------------------------------------------------------------
check("live: file exists", live !== null, LIVE);
if (live) {
  const plain = stripComments(live);
  const firstLine = live.split(/\r?\n/).find((l) => l.trim().length);
  check("live: opens with REPEATABLE READ", firstLine.trim() === "BEGIN ISOLATION LEVEL REPEATABLE READ;", firstLine.trim());
  const lastLine = [...live.split(/\r?\n/)].reverse().find((l) => l.trim().length);
  check("live: last statement is ROLLBACK", lastLine.trim() === "ROLLBACK;", lastLine.trim());
  check("live: no COMMIT anywhere", (plain.match(/^\s*COMMIT\b/gim) || []).length === 0, `COMMIT statements: ${(plain.match(/^\s*COMMIT\b/gim) || []).length}`);
  check("live: exactly one ROLLBACK", (plain.match(/^\s*ROLLBACK;\s*$/gim) || []).length === 1, `ROLLBACK statements: ${(plain.match(/^\s*ROLLBACK;\s*$/gim) || []).length}`);
  const begins = (plain.match(/^\s*(START TRANSACTION|BEGIN ISOLATION)/gim) || []).length;
  check("live: exactly one transaction opener", begins === 1, `transaction openers: ${begins}`);
  check("live: search_path isolated", /SET LOCAL search_path = pg_catalog, pg_temp;/.test(live));
  check("live: lock/statement/idle timeouts set", /SET LOCAL lock_timeout/.test(live) && /SET LOCAL statement_timeout/.test(live) && /SET LOCAL idle_in_transaction_session_timeout/.test(live));
  check("live: carries all 14 installed-function pins", hasAllPins(live));
  const pinValues = Object.values(PINS).filter((v) => live.includes(v)).length;
  check("live: pin count is 14", pinValues === 14, `${pinValues}`);
  check("live: targets TEST ref", live.includes(TEST_PROJECT));
  check("live: never names the production ref", !live.includes(PROD_PROJECT));
  check("live: acknowledges the project GUC", live.includes("slmm.t5.target_project"));
  const caseCalls = (plain.match(/PERFORM\s+pg_temp\.t5_case\(/g) || []).length;
  check("live: exact-case count is 49", caseCalls === 49, `t5_case call sites: ${caseCalls}`);
  check("live: records D7 as BLOCKED, not simulated", /'D7','BLOCKED',NULL/.test(plain.replace(/\s+/g, "")));
  check("live: global eligible-ID guard present", plain.includes("status IN ('pending','deleting','blocked','finalizing')") && plain.includes("lease_expires_at IS NULL OR r.lease_expires_at < now()"));
  check("live: complete-row state assertions present", plain.includes("IS DISTINCT FROM to_jsonb(r)") && plain.includes("IS DISTINCT FROM to_jsonb(d)"));
  check("live: no persistent CREATE TABLE public", !/create table public\./i.test(plain));
  check("live: no ALTER TABLE public", !/alter table public\./i.test(plain));
  check("live: no DROP / GRANT / REVOKE", !/\bdrop\s+(table|function|trigger|index|rule)\b/i.test(plain) && !/\bgrant\b/i.test(plain) && !/\brevoke\b/i.test(plain));
  check("live: no CREATE INDEX", !/create\s+(unique\s+)?index/i.test(plain));
  check("live: temp objects only", !/create table (?!t5_)/i.test(plain.replace(/\s+/g, " ")));
  check("live: JSON report emitted", plain.includes("'overall_verdict'") && plain.includes("jsonb_build_object("));
}

// ---- Preflight ------------------------------------------------------------
check("preflight: file exists", pre !== null, PREFLIGHT);
if (pre) {
  const plain = stripComments(pre);
  const firstLine = pre.split(/\r?\n/).find((l) => l.trim().length);
  check("preflight: opens READ ONLY REPEATABLE READ", firstLine.trim() === "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;", firstLine.trim());
  const lastLine = [...pre.split(/\r?\n/)].reverse().find((l) => l.trim().length);
  check("preflight: ends with ROLLBACK", lastLine.trim() === "ROLLBACK;", lastLine.trim());
  check("preflight: carries all 14 pins", hasAllPins(pre));
  check("preflight: no write/DDL statements", !/^\s*(insert|update|delete|create|alter|drop|truncate|grant|revoke)\b/im.test(stripComments(pre)));
  check("preflight: targets TEST ref", pre.includes(TEST_PROJECT));
  check("preflight: never names the production ref", !pre.includes(PROD_PROJECT));
  check("preflight: checks ACLs", pre.includes("has_function_privilege"));
  check("preflight: checks fence triggers", pre.includes("_50_storage_key_fence"));
  check("preflight: checks global eligibility", pre.includes("status IN ('pending','deleting','blocked','finalizing')"));
}

// ---- Residue --------------------------------------------------------------
check("residue: file exists", res !== null, RESIDUE);
if (res) {
  check("residue: READ ONLY transaction", /^BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;/.test(res));
  check("residue: ends with ROLLBACK", /ROLLBACK;\s*$/.test(res));
  check("residue: no write/DDL statements", !/^\s*(insert|update|delete|create|alter|drop|truncate|grant|revoke)\b/im.test(stripComments(res)));
  check("residue: covers all ten relations", ["storage_deletion_requests","storage_deletion_fences","documents","profiles","user_roles","payments","jathagam_requests","support_threads","support_messages","payment_events"].every((r) => res.includes(`public.${r}`)));
  check("residue: never names the production ref", !res.includes(PROD_PROJECT));
}

// ---- Registry classification (report only; never modified here) -----------
const registry = slurp(REGISTRY);
check("registry: file readable", registry !== null, REGISTRY);
if (registry) {
  const classified = /slmm-storage-deletion-t5-live-test\.sql/.test(registry);
  check("registry: T5 SQL classified (informational, NOT modified)", true,
    classified ? "classified" : "NOT classified -> recommended smallest safe change: add the three T5 file names to the harness-registry fail-closed classification");
}

// ---- Report ---------------------------------------------------------------
const failed = results.filter((r) => !r.ok);
for (const r of results) {
  console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}${r.detail ? "  [" + r.detail + "]" : ""}`);
}
console.log("");
console.log(JSON.stringify({
  checks: results.length,
  passed: results.length - failed.length,
  failed: failed.length,
  verdict: failed.length === 0 ? "OFFLINE-VALIDATION-PASS" : "OFFLINE-VALIDATION-FAIL",
}, null, 2));

process.exit(failed.length === 0 ? 0 : 1);
