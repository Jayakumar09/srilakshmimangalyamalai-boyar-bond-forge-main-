// slmm-sql-contract-tests.mjs
//
// Phase 5A: offline static security-contract tests over the SQL migrations.
//
// WHAT THIS IS
//   69 assertions (S01-S69) that read migration and harness files as plain
//   TEXT and check that the security contracts the project documents are
//   actually present in source: which guard exists, where it sits relative to
//   the bypass it is meant to beat, what scope it touches, which privileges
//   are granted/revoked, and that the wiring on the application side still
//   calls the RPCs those migrations define.
//
// WHAT THIS IS NOT
//   It is not a database test. It never proves that a migration was applied,
//   that RLS fired, that an ACL bit is set, or that an UPDATE was refused at
//   runtime. Those claims belong to the live `test-harness/*.sql` harnesses
//   (psql against a real database), which are deliberately NOT run here.
//   A static PASS plus a live FAIL is possible (migration never applied,
//   later migration overwrote the object, Supabase's direct default-ACL
//   entries -- exactly the E3 defect). A static FAIL is a real source defect.
//
// ISOLATION
//   Node built-ins only (node:assert/strict, node:fs, node:test).
//   No network, no database, no .env, no credentials, no SQL execution,
//   no child_process, no psql, no external service of any kind. Every path
//   opened is funnelled through a scope guard (S69) that refuses anything
//   outside supabase/migrations/, test-harness/ and the two pinned
//   src/lib/*.ts files, and S68 re-checks this file's own source.
//
// PHASE 5A SCOPE (per approval)
//   Covered: client-field protection, admin self-approval (UPDATE and
//   INSERT), admin identity/plan protection, payment verification
//   permissions, messaging restrictions, admin deletion restrictions.
//   Excluded and reserved for a separately approved phase: the document
//   client-verification guard, the payment method UTR constraints and the
//   admin profile approval RPC (their existence is only checked so that a
//   harness cannot point at a file that no longer exists).
//
// Run: node --test test-harness/slmm-sql-contract-tests.mjs

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";

// ---------------------------------------------------------------------------
// Scope-guarded repository IO. Nothing outside these prefixes is ever opened.
// ---------------------------------------------------------------------------

const ROOT = new URL("../", import.meta.url);
const ALLOWED_DIR_PREFIXES = ["supabase/migrations/", "test-harness/"];
const ALLOWED_SRC_FILES = ["src/lib/admin-data.ts", "src/lib/payments.functions.ts"];
const SELF = "test-harness/slmm-sql-contract-tests.mjs";

const READ_FILES = new Set();
const READ_DIRS = new Set();
const LOAD_ERRORS = new Map();

const rel = (p) => String(p).replaceAll("\\", "/");

function withinScope(p) {
  if (ALLOWED_SRC_FILES.includes(p)) return true;
  return ALLOWED_DIR_PREFIXES.some((pre) => p.startsWith(pre) || p + "/" === pre);
}

function readText(path) {
  const p = rel(path);
  if (!withinScope(p)) throw new Error("S69 scope guard refused a read: " + p);
  READ_FILES.add(p);
  try {
    return readFileSync(new URL(p, ROOT), "utf8");
  } catch (e) {
    LOAD_ERRORS.set(p, e.code || e.message);
    return "";
  }
}

function listSql(path) {
  const p = rel(path);
  if (!withinScope(p)) throw new Error("S69 scope guard refused a listing: " + p);
  READ_DIRS.add(p);
  try {
    return readdirSync(new URL(p + "/", ROOT))
      .filter((n) => n.endsWith(".sql"))
      .sort();
  } catch (e) {
    LOAD_ERRORS.set(p, e.code || e.message);
    return [];
  }
}

// ---------------------------------------------------------------------------
// SQL noise removal.
//
// Migrations document their own security properties in prose, so a naive
// substring match on the raw file matches COMMENTS: 20260926150000:61 contains
// the literal text "ALTER DEFAULT PRIVILEGES" inside a comment that says it was
// deliberately NOT included, and the three profile-guard successors mention
// REVOKE/GRANT only in comments. Everything below is therefore matched against
// comment-stripped, whitespace-normalised text.
//
// Stripping must run INSIDE dollar-quoted function bodies (the guards carry
// `--` comments in their plpgsql) but never inside '...' string literals (the
// RAISE EXCEPTION messages are load-bearing content). Hence the scanner.
// ---------------------------------------------------------------------------

function dollarTagAt(s, i) {
  if (s[i] !== "$") return null;
  let j = i + 1;
  while (j < s.length) {
    const c = s.charCodeAt(j);
    const word = (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95;
    if (!word) break;
    j++;
  }
  if (j < s.length && s[j] === "$") return s.slice(i, j + 1);
  return null;
}

function stripSql(src) {
  let out = "";
  let i = 0;
  let state = "code";
  let tag = "";
  let escaped = false;
  const back = [];
  const n = src.length;
  while (i < n) {
    const c = src[i];
    const c2 = i + 1 < n ? src[i + 1] : "";
    if (state === "code") {
      if (c === "'" || c === '"') {
        escaped = false;
        if (c === "'") {
          const prev = out.length ? out[out.length - 1] : "";
          escaped = prev === "E" || prev === "e";
        }
        back.push("code");
        state = c === "'" ? "squote" : "dquote";
        out += c;
        i++;
      } else if (c === "$") {
        const t = dollarTagAt(src, i);
        if (t) {
          state = "dollar";
          tag = t;
          out += t;
          i += t.length;
        } else {
          out += c;
          i++;
        }
      } else if (c === "-" && c2 === "-") {
        back.push("code");
        state = "lc";
        i += 2;
      } else if (c === "/" && c2 === "*") {
        back.push("code");
        state = "bc";
        i += 2;
      } else {
        out += c;
        i++;
      }
    } else if (state === "squote") {
      if (escaped && c === "\\") {
        out += c + c2;
        i += 2;
      } else if (c === "'" && c2 === "'") {
        out += "''";
        i += 2;
      } else if (c === "'") {
        state = back.pop() || "code";
        out += c;
        i++;
      } else {
        out += c;
        i++;
      }
    } else if (state === "dquote") {
      if (c === '"' && c2 === '"') {
        out += '""';
        i += 2;
      } else if (c === '"') {
        state = back.pop() || "code";
        out += c;
        i++;
      } else {
        out += c;
        i++;
      }
    } else if (state === "dollar") {
      if (tag && src.startsWith(tag, i)) {
        out += tag;
        i += tag.length;
        state = "code";
      } else if (c === "'") {
        escaped = false;
        back.push("dollar");
        state = "squote";
        out += c;
        i++;
      } else if (c === "-" && c2 === "-") {
        back.push("dollar");
        state = "lc";
        i += 2;
      } else if (c === "/" && c2 === "*") {
        back.push("dollar");
        state = "bc";
        i += 2;
      } else {
        out += c;
        i++;
      }
    } else if (state === "lc") {
      if (c === "\n") {
        out += "\n";
        state = back.pop() || "code";
      }
      i++;
    } else {
      if (c === "*" && c2 === "/") {
        state = back.pop() || "code";
        i += 2;
      } else if (c === "\n") {
        out += "\n";
      }
      i++;
    }
  }
  return out;
}

function splitStatements(src) {
  const out = [];
  let buf = "";
  let i = 0;
  let state = "code";
  let tag = "";
  const back = [];
  const n = src.length;
  while (i < n) {
    const c = src[i];
    const c2 = i + 1 < n ? src[i + 1] : "";
    if (state === "code") {
      if (c === "'" || c === '"') {
        back.push("code");
        state = c === "'" ? "squote" : "dquote";
        buf += c;
        i++;
      } else if (c === "$") {
        const t = dollarTagAt(src, i);
        if (t) {
          state = "dollar";
          tag = t;
          buf += t;
          i += t.length;
        } else {
          buf += c;
          i++;
        }
      } else if (c === ";") {
        out.push(buf);
        buf = "";
        i++;
      } else {
        buf += c;
        i++;
      }
    } else if (state === "squote") {
      if (c === "'" && c2 === "'") {
        buf += "''";
        i += 2;
      } else if (c === "'") {
        state = back.pop() || "code";
        buf += c;
        i++;
      } else {
        buf += c;
        i++;
      }
    } else if (state === "dquote") {
      if (c === '"' && c2 === '"') {
        buf += '""';
        i += 2;
      } else if (c === '"') {
        state = back.pop() || "code";
        buf += c;
        i++;
      } else {
        buf += c;
        i++;
      }
    } else {
      if (tag && src.startsWith(tag, i)) {
        buf += tag;
        i += tag.length;
        state = "code";
      } else {
        buf += c;
        i++;
      }
    }
  }
  if (buf.trim()) out.push(buf);
  return out;
}

const flatten = (s) => s.replace(/\s+/g, " ").trim();

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

const M = {
  base: "supabase/migrations/20260925150000_profile_client_field_guard.sql",
  selfUpdate: "supabase/migrations/20260926120000_profile_admin_self_approval_guard.sql",
  selfInsert: "supabase/migrations/20260926130000_profile_admin_self_approval_insert_guard.sql",
  identity: "supabase/migrations/20260926140000_profile_admin_identity_and_plan_guard.sql",
  b1: "supabase/migrations/20260925130000_payment_b1_atomic.sql",
  e3a: "supabase/migrations/20260926150000_payment_verify_rpc_privilege_hardening.sql",
  e3b: "supabase/migrations/20260926160000_e3_verify_payment_privilege_hardening.sql",
  messaging: "supabase/migrations/20261005120000_block_messaging_enforcement.sql",
  adminDelete: "supabase/migrations/20261005130000_admin_delete_blocks.sql",
  baseSchema: "supabase/migrations/20260919142903_e31e2888-d742-47a3-9d86-352e43618e04.sql",
  hasRoleAcl: "supabase/migrations/20260919142933_ad743131-48fe-4291-a76a-d24cfa925f8d.sql",
  canMessage: "supabase/migrations/20260919152747_cd215052-51f1-4036-ad06-fecf17049f93.sql",
  // Pinned last-definition dependency for can_message(). Its presence on disk
  // is asserted (S53); presence does NOT establish that it has been deployed.
  elite: "supabase/migrations/20261010120000_elite_plan_and_family_value.sql",
};
const EXPECTED_LAST_CAN_MESSAGE = "20261010120000_elite_plan_and_family_value.sql";

const LIVE_HARNESSES = [
  ["test-harness/profile-admin-self-approval-guard.sql", "20260926120000_profile_admin_self_approval_guard.sql"],
  ["test-harness/profile-admin-self-approval-insert-guard.sql", "20260926130000_profile_admin_self_approval_insert_guard.sql"],
  ["test-harness/profile-admin-identity-plan-guard.sql", "20260926140000_profile_admin_identity_and_plan_guard.sql"],
  ["test-harness/payment-verify-rpc-privileges.sql", "20260926160000_e3_verify_payment_privilege_hardening.sql"],
  ["test-harness/payment-b1-rpc-regression.sql", "20260925130000_payment_b1_atomic.sql"],
  ["test-harness/admin-profile-approval-rpc.sql", "20260926190000_admin_profile_approval_rpc.sql"],
];

// The six security domains this phase was approved to cover.
const SEC_DOMAINS = [
  { key: "client-field-protection", migrations: [M.base], stat: "S01-S12, S35" },
  { key: "admin-self-approval", migrations: [M.selfUpdate, M.selfInsert], stat: "S13-S26, S35" },
  { key: "admin-identity-plan-protection", migrations: [M.identity], stat: "S27-S34, S35" },
  { key: "payment-verification-permissions", migrations: [M.b1, M.e3a, M.e3b], stat: "S36-S44" },
  { key: "messaging-restrictions", migrations: [M.messaging], stat: "S45-S55" },
  { key: "admin-deletion-restrictions", migrations: [M.adminDelete], stat: "S56-S62" },
];

const FILE_CACHE = new Map();
function sqlFile(path) {
  const p = rel(path);
  if (FILE_CACHE.has(p)) return FILE_CACHE.get(p);
  const raw = readText(p);
  const stripped = stripSql(raw);
  const entry = {
    rel: p,
    raw,
    stripped,
    flat: flatten(stripped),
    statements: splitStatements(stripped).map(flatten).filter((s) => s.length > 0),
  };
  FILE_CACHE.set(p, entry);
  return entry;
}

const F = {};
for (const key of Object.keys(M)) F[key] = sqlFile(M[key]);
const ADMIN_DATA = readText("src/lib/admin-data.ts");
const PAYMENTS_SRC = readText("src/lib/payments.functions.ts");

const baseName = (p) => p.split("/").pop();

// ---------------------------------------------------------------------------
// Assertion helpers. Each call bumps the executed-assert counter so the final
// report can state an exact number.
// ---------------------------------------------------------------------------

let assertCalls = 0;

function ok(cond, message) {
  assertCalls++;
  assert.ok(cond, message);
}
function eq(actual, expected, message) {
  assertCalls++;
  assert.equal(actual, expected, message);
}
function has(hay, needle, message) {
  assertCalls++;
  assert.ok(hay.includes(needle), message || ("expected to contain: " + needle));
}
function hasNot(hay, needle, message) {
  assertCalls++;
  assert.ok(!hay.includes(needle), message || ("must NOT contain: " + needle));
}
function below(a, b, message) {
  assertCalls++;
  assert.ok(a < b, message);
}
function same(actual, expected, message) {
  assertCalls++;
  assert.deepEqual(actual, expected, message);
}

function countIn(hay, needle) {
  if (!needle) return 0;
  let n = 0;
  let i = 0;
  for (;;) {
    const at = hay.indexOf(needle, i);
    if (at < 0) return n;
    n++;
    i = at + needle.length;
  }
}

function at(hay, needle) {
  return hay.indexOf(needle);
}

function lastAt(hay, needle) {
  return hay.lastIndexOf(needle);
}

// Slice from the last occurrence of `anchor` at-or-before `marker`, through
// `tail` characters past the marker. Returns "" when either marker is absent so
// the following `has()` fails with a readable message.
function guardSlice(flat, anchor, marker, tail) {
  const m = flat.indexOf(marker);
  if (m < 0) return "";
  const g = flat.lastIndexOf(anchor, m);
  if (g < 0) return "";
  return flat.slice(g, m + marker.length + (tail === undefined ? 300 : tail));
}

function trustedBlock(flat) {
  const i = flat.indexOf("v_trusted :=");
  if (i < 0) return null;
  const j = flat.indexOf("IF v_trusted THEN", i);
  if (j < 0) return null;
  return flat.slice(i, j).trim();
}

// Statements that a migration must never contain for its blast radius to be
// what it claims.
const SCOPE_FORBIDDEN = [
  "GRANT",
  "REVOKE",
  "CREATE TRIGGER",
  "DROP TRIGGER",
  "ALTER TABLE",
  "CREATE POLICY",
  "DROP POLICY",
];

const ADMIN_APPROVAL_MSG = "'Admins cannot approve or reject their own profile'";
const CLIENT_APPROVAL_MSG = "'Clients cannot approve or reject their own profile'";
const TRUSTED_CALLER = "current_user IN ('postgres', 'service_role', 'supabase_admin')";
const VERIFY_REVOKE =
  "REVOKE EXECUTE ON FUNCTION public.verify_payment(text, uuid, text) FROM PUBLIC, anon, authenticated;";
const VERIFY_GRANT =
  "GRANT EXECUTE ON FUNCTION public.verify_payment(text, uuid, text) TO service_role;";

// ===========================================================================
// D1 -- client-field protection (20260925150000)
// ===========================================================================

test("S01 client-field guard: trigger function header is SECURITY INVOKER with a pinned search_path", () => {
  const f = F.base.flat;
  has(f, "CREATE OR REPLACE FUNCTION public.profiles_client_field_guard()");
  eq(countIn(f, "CREATE OR REPLACE FUNCTION public.profiles_client_field_guard()"), 1, "defined exactly once");
  has(f, "RETURNS trigger");
  has(f, "LANGUAGE plpgsql");
  has(f, "SECURITY INVOKER", "runs as the caller; RLS is already in effect");
  has(f, "SET search_path = public, pg_temp", "search_path must not be attacker-influencable");
});

test("S02 client-field guard: the BEFORE trigger is bound to public.profiles for INSERT and UPDATE", () => {
  const f = F.base.flat;
  has(f, "DROP TRIGGER IF EXISTS profiles_00_client_field_guard ON public.profiles;");
  has(
    f,
    "CREATE TRIGGER profiles_00_client_field_guard BEFORE INSERT OR UPDATE ON public.profiles " +
      "FOR EACH ROW EXECUTE FUNCTION public.profiles_client_field_guard();"
  );
});

test("S03 client-field guard: function EXECUTE is revoked from PUBLIC/anon/authenticated and granted to authenticated+service_role", () => {
  const f = F.base.flat;
  has(f, "REVOKE ALL ON FUNCTION public.profiles_client_field_guard() FROM PUBLIC, anon, authenticated;");
  has(f, "GRANT EXECUTE ON FUNCTION public.profiles_client_field_guard() TO authenticated, service_role;");
});

test("S04 client-field guard: trusted-caller classification is exactly the three documented clauses", () => {
  const f = F.base.flat;
  eq(countIn(f, "v_trusted :="), 1, "one classification point");
  eq(countIn(f, TRUSTED_CALLER), 1, "one privileged current_user clause");
  has(f, "OR auth.role() = 'service_role'");
  has(f, "OR ( v_uid IS NOT NULL AND public.has_role(v_uid, 'admin'::public.app_role) )");
});

test("S05 client-field guard: regression anchor -- the base migration has the admin bypass hole later migrations close", () => {
  const f = F.base.flat;
  eq(countIn(f, ADMIN_APPROVAL_MSG), 0, "the base file must NOT contain the admin self-approval guard");
  const bypass = at(f, "IF v_trusted THEN");
  const clientCheck = at(f, CLIENT_APPROVAL_MSG);
  ok(bypass >= 0, "bypass branch present");
  ok(clientCheck >= 0, "client self-approval check present");
  below(bypass, clientCheck, "the v_trusted bypass returns NEW before the only self-approval check -- this is the hole D2-D4 close");
});

test("S06 client-field guard: clients cannot approve or reject their own profile", () => {
  const f = F.base.flat;
  eq(countIn(f, CLIENT_APPROVAL_MSG), 1, "client-side self-approval guard present once");
  has(f, "RAISE EXCEPTION " + CLIENT_APPROVAL_MSG + " USING ERRCODE = '42501';");
});

test("S07 client-field guard: a client INSERT can only ever start as pending", () => {
  const f = F.base.flat;
  has(f, "IF TG_OP = 'INSERT' THEN");
  has(f, "RAISE EXCEPTION 'Clients may only create pending profiles' USING ERRCODE = '42501';");
  has(f, "NEW.status := 'pending'::public.approval_status;");
});

test("S08 client-field guard: a client INSERT has every privileged column overwritten server-side", () => {
  const f = F.base.flat;
  has(f, "NEW.membership_plan := 'free'::public.membership_plan;");
  has(f, "NEW.plan_valid_until := NULL;");
  has(f, "NEW.admin_notes := NULL;");
  has(f, "NEW.profile_created_by := 'client';");
  has(f, "NEW.created_by_admin_id := NULL;");
  has(f, "NEW.siblings := NULL;");
});

test("S09 client-field guard: a client UPDATE reverts privileged columns from OLD and re-pins identity", () => {
  const f = F.base.flat;
  has(f, "NEW.id := v_uid;", "identity cannot be moved by a client");
  has(f, "NEW.membership_plan := OLD.membership_plan;");
  has(f, "NEW.plan_valid_until := OLD.plan_valid_until;");
  has(f, "NEW.admin_notes := OLD.admin_notes;");
  has(f, "NEW.created_by_admin_id := OLD.created_by_admin_id;");
});

test("S10 client-field guard: the unknown-field allowlist gate is enforced on BOTH branches", () => {
  const f = F.base.flat;
  eq(countIn(f, "n.key <> ALL (v_allowed_fields)"), 2, "one gate on INSERT, one on UPDATE");
  has(
    f,
    "RAISE EXCEPTION 'Unknown client profile fields: %', array_to_string(v_changed, ', ') USING ERRCODE = '42501';"
  );
});

test("S11 client-field guard: role and row-ownership guards reject anonymous and cross-row writes", () => {
  const f = F.base.flat;
  has(f, "RAISE EXCEPTION 'Profile changes are not permitted for this role' USING ERRCODE = '42501';");
  has(f, "RAISE EXCEPTION 'A client may only change its own profile' USING ERRCODE = '42501';");
  has(f, "IF NEW.id IS DISTINCT FROM v_uid THEN");
  has(f, "IF v_uid IS NULL OR (current_user <> 'authenticated' AND auth.role() <> 'authenticated') THEN");
});

test("S12 client-field guard: exactly one policy is touched and it is ownership-only", () => {
  const f = F.base.flat;
  eq(countIn(f, "CREATE POLICY"), 1, "blast radius is a single policy");
  has(f, 'DROP POLICY IF EXISTS "own profile update" ON public.profiles;');
  has(
    f,
    'CREATE POLICY "own profile update" ON public.profiles FOR UPDATE TO authenticated ' +
      "USING (id = auth.uid()) WITH CHECK (id = auth.uid());",
    "ownership only -- trusted-field protection belongs to the trigger, not the policy"
  );
});

// ===========================================================================
// D2 -- admin self-approval, UPDATE side (20260926120000)
// ===========================================================================

test("S13 admin self-approval UPDATE: migration is transaction-wrapped", () => {
  const f = F.selfUpdate.flat;
  has(f, "BEGIN;");
  has(f, "COMMIT;");
});

test("S14 admin self-approval UPDATE: re-created via CREATE OR REPLACE so trigger binding and ACL survive", () => {
  const f = F.selfUpdate.flat;
  eq(countIn(f, "CREATE OR REPLACE FUNCTION public.profiles_client_field_guard()"), 1);
  hasNot(
    f,
    "CREATE FUNCTION public.profiles_client_field_guard",
    "a bare CREATE FUNCTION would fail on re-run and could reset ownership"
  );
});

test("S15 admin self-approval UPDATE: the guard sits BEFORE the v_trusted bypass it must outlive", () => {
  const f = F.selfUpdate.flat;
  const raise = at(f, ADMIN_APPROVAL_MSG);
  const assign = at(f, "v_trusted :=");
  const bypass = at(f, "IF v_trusted THEN");
  ok(raise >= 0, "admin self-approval raise present");
  ok(assign >= 0, "v_trusted assignment present");
  ok(bypass >= 0, "v_trusted bypass present");
  below(raise, assign, "guard must be evaluated before v_trusted is computed");
  below(assign, bypass, "bypass must remain after the guard");
});

test("S16 admin self-approval UPDATE: predicate is admin + own row + real transition to approved/rejected", () => {
  const f = F.selfUpdate.flat;
  const region = guardSlice(f, "IF TG_OP = 'UPDATE' THEN", ADMIN_APPROVAL_MSG, 300);
  has(region, "IF TG_OP = 'UPDATE' THEN");
  has(region, "public.has_role(v_uid, 'admin'::public.app_role)");
  has(region, "OLD.id = v_uid");
  has(region, "NEW.status IS DISTINCT FROM OLD.status", "a no-op status write is still allowed");
  has(region, "NEW.status IN ('approved'::public.approval_status, 'rejected'::public.approval_status)");
});

test("S17 admin self-approval UPDATE: the guard raises with ERRCODE 42501 (permission denied)", () => {
  const f = F.selfUpdate.flat;
  const region = guardSlice(f, "IF TG_OP = 'UPDATE' THEN", ADMIN_APPROVAL_MSG, 300);
  has(region, "USING ERRCODE = '42501';");
});

test("S18 admin self-approval UPDATE: scope minimality -- no privilege, trigger, policy or table statements", () => {
  const f = F.selfUpdate.flat;
  for (const token of SCOPE_FORBIDDEN) {
    hasNot(f, token, "20260926120000 must not contain " + token + " (function body only)");
  }
});

test("S19 admin self-approval UPDATE: the v_trusted classification block is byte-identical to the base", () => {
  const a = trustedBlock(F.base.flat);
  const b = trustedBlock(F.selfUpdate.flat);
  ok(a !== null, "base v_trusted block found");
  ok(b !== null, "successor v_trusted block found");
  eq(b, a, "successor must not silently widen or narrow trusted-caller classification");
});

// ===========================================================================
// D3 -- admin self-approval, INSERT side (20260926130000)
// ===========================================================================

test("S20 admin self-approval INSERT: carries the UPDATE guard and adds the INSERT guard", () => {
  const f = F.selfInsert.flat;
  eq(countIn(f, ADMIN_APPROVAL_MSG), 2, "one raise for UPDATE, one for INSERT");
  has(f, "IF TG_OP = 'UPDATE' THEN");
  has(f, "IF TG_OP = 'INSERT' THEN");
  has(f, "OLD.id = v_uid");
  has(f, "NEW.id = v_uid", "OLD is not assigned on INSERT");
});

test("S21 admin self-approval INSERT: INSERT guard blocks only own-row approved/rejected creation", () => {
  const f = F.selfInsert.flat;
  const start = at(f, "IF TG_OP = 'INSERT' THEN");
  const end = at(f, "v_trusted :=");
  ok(start >= 0, "INSERT branch present");
  ok(end >= 0, "v_trusted assignment present");
  below(start, end, "the INSERT guard must precede the v_trusted bypass");
  const region = f.slice(start, end);
  has(region, "IF TG_OP = 'INSERT' THEN");
  has(region, "NEW.id = v_uid");
  has(region, "NEW.status IN ('approved'::public.approval_status, 'rejected'::public.approval_status)");
  has(region, "public.has_role(v_uid, 'admin'::public.app_role)");
  has(region, "USING ERRCODE = '42501';");
});

test("S22 admin self-approval INSERT: privileged callers are skipped BEFORE the admin role test", () => {
  const f = F.selfInsert.flat;
  const start = at(f, "IF TG_OP = 'INSERT' THEN");
  const end = at(f, "v_trusted :=");
  const region = start >= 0 && end >= 0 ? f.slice(start, end) : "";
  has(region, "NOT ( " + TRUSTED_CALLER + " OR auth.role() = 'service_role' )");
  below(
    at(region, "NOT ("),
    at(region, "public.has_role(v_uid, 'admin'::public.app_role)"),
    "the service-role skip must be evaluated before the admin test, or service-role writes regress"
  );
});

test("S23 admin self-approval INSERT: BOTH admin raises precede the v_trusted bypass", () => {
  const f = F.selfInsert.flat;
  const last = lastAt(f, ADMIN_APPROVAL_MSG);
  const assign = at(f, "v_trusted :=");
  ok(last >= 0, "admin raise present");
  ok(assign >= 0, "v_trusted assignment present");
  below(last, assign, "a guard placed after the bypass could never protect an admin");
});

test("S24 admin self-approval INSERT: scope minimality -- no privilege, trigger, policy or table statements", () => {
  const f = F.selfInsert.flat;
  for (const token of SCOPE_FORBIDDEN) {
    hasNot(f, token, "20260926130000 must not contain " + token + " (function body only)");
  }
});

test("S25 admin self-approval INSERT: migration is transaction-wrapped", () => {
  const f = F.selfInsert.flat;
  has(f, "BEGIN;");
  has(f, "COMMIT;");
});

test("S26 admin self-approval INSERT: the client-side pending-only INSERT rule is still present", () => {
  has(F.selfInsert.flat, "RAISE EXCEPTION 'Clients may only create pending profiles' USING ERRCODE = '42501';");
});

// ===========================================================================
// D4 -- admin identity and plan protection (20260926140000)
// ===========================================================================

test("S27 admin identity: admins cannot change a profile id (closes the id-swap bypass)", () => {
  const f = F.identity.flat;
  const region = guardSlice(f, "IF TG_OP", "'Admins cannot change a profile id'", 300);
  has(region, "IF TG_OP = 'UPDATE' THEN");
  has(region, "NEW.id IS DISTINCT FROM OLD.id", "identity is the anchor the approval guards depend on");
  has(region, "NOT (");
  has(region, TRUSTED_CALLER);
  has(region, "public.has_role(v_uid, 'admin'::public.app_role)");
  has(region, "USING ERRCODE = '42501';");
});

test("S28 admin identity: admins cannot change their own membership plan or expiry", () => {
  const f = F.identity.flat;
  const region = guardSlice(f, "IF TG_OP", "'Admins cannot change their own membership plan'", 300);
  has(region, "IF TG_OP = 'UPDATE' THEN");
  has(region, "OLD.id = v_uid", "own-row detection is sound only once id is immutable");
  has(region, "NEW.membership_plan IS DISTINCT FROM OLD.membership_plan");
  has(region, "NEW.plan_valid_until IS DISTINCT FROM OLD.plan_valid_until");
  has(region, "USING ERRCODE = '42501';");
});

test("S29 admin identity: an admin INSERT on their own row cannot self-grant a paid plan", () => {
  const f = F.identity.flat;
  const region = guardSlice(f, "IF TG_OP", "'Admins cannot set their own membership plan'", 300);
  has(region, "IF TG_OP = 'INSERT' THEN");
  has(region, "NEW.id = v_uid");
  has(region, "NEW.membership_plan IS DISTINCT FROM 'free'::public.membership_plan");
  has(region, "NEW.plan_valid_until IS NOT NULL");
  has(region, "USING ERRCODE = '42501';");
});

test("S30 admin identity: all five admin guards sit ahead of the v_trusted bypass", () => {
  const f = F.identity.flat;
  eq(countIn(f, "'Admins cannot"), 5, "approval x2, id, plan-change, plan-set");
  const last = lastAt(f, "'Admins cannot");
  const assign = at(f, "v_trusted :=");
  ok(assign >= 0, "v_trusted assignment present");
  below(last, assign, "every admin guard must be evaluated before the bypass");
});

test("S31 admin identity: privileged-caller clause appears exactly five times (three new guards + INSERT skip + v_trusted)", () => {
  eq(countIn(F.identity.flat, TRUSTED_CALLER), 5, "a count change means a guard gained or lost its service-role skip");
});

test("S32 admin identity: scope minimality -- no privilege, trigger, policy or table statements", () => {
  const f = F.identity.flat;
  for (const token of SCOPE_FORBIDDEN) {
    hasNot(f, token, "20260926140000 must not contain " + token + " (function body only)");
  }
});

test("S33 admin identity: migration is transaction-wrapped", () => {
  const f = F.identity.flat;
  has(f, "BEGIN;");
  has(f, "COMMIT;");
});

test("S34 admin identity: the accumulated body still carries every exception from D1, D2 and D3", () => {
  const f = F.identity.flat;
  const inherited = [
    "'Profile changes are not permitted for this role'",
    "'A client may only change its own profile'",
    "'Unknown client profile fields: %'",
    "'Clients may only create pending profiles'",
    "'Consent is required before profile submission'",
    "'Approval status cannot be null'",
    CLIENT_APPROVAL_MSG,
    "'A valid pending submission requires consent'",
    ADMIN_APPROVAL_MSG,
  ];
  for (const m of inherited) has(f, "RAISE EXCEPTION " + m, "inherited guard lost: " + m);
});

// ===========================================================================
// D5 -- cross-migration drift
// ===========================================================================

test("S35 drift: the client allowed-fields array is identical across all four guard migrations", () => {
  const re = /v_allowed_fields text\[\] := ARRAY\[([\s\S]*?)\]::text\[\]/;
  const keys = ["base", "selfUpdate", "selfInsert", "identity"];
  const blocks = keys.map((k) => {
    const m = re.exec(F[k].stripped);
    ok(m !== null, "allowed-fields array found in " + M[k]);
    return m ? flatten(m[1]) : null;
  });
  for (let i = 1; i < blocks.length; i++) {
    eq(blocks[i], blocks[0], "allowed-fields desync: " + M[keys[i]] + " differs from the base migration");
  }
});

// ===========================================================================
// D6 -- payment verification permissions
// ===========================================================================

test("S36 payment verify: verify_payment is SECURITY DEFINER with a pinned search_path", () => {
  const f = F.b1.flat;
  has(f, "CREATE OR REPLACE FUNCTION public.verify_payment(");
  has(f, "SECURITY DEFINER");
  has(f, "SET search_path = public, pg_temp");
});

test("S37 payment verify: the base migration names PUBLIC only -- the defect E3 corrects", () => {
  const f = F.b1.flat;
  has(f, "REVOKE EXECUTE ON FUNCTION public.verify_payment(text, uuid, text) FROM PUBLIC;");
  hasNot(
    f,
    "FROM PUBLIC, anon, authenticated",
    "if the base already named anon/authenticated this migration would be redundant -- and E3 exists precisely because it did not"
  );
});

test("S38 payment verify: base grants EXECUTE to service_role only", () => {
  has(F.b1.flat, "GRANT EXECUTE ON FUNCTION public.verify_payment(text, uuid, text) TO service_role;");
});

test("S39 payment verify: 20260926150000 revokes EXECUTE from PUBLIC, anon and authenticated explicitly", () => {
  has(F.e3a.flat, VERIFY_REVOKE);
});

test("S40 payment verify: 20260926160000 revokes EXECUTE from PUBLIC, anon and authenticated explicitly", () => {
  has(F.e3b.flat, VERIFY_REVOKE);
});

test("S41 payment verify: both hardenings re-grant EXECUTE to service_role and nothing else", () => {
  has(F.e3a.flat, VERIFY_GRANT);
  has(F.e3b.flat, VERIFY_GRANT);
  eq(countIn(F.e3a.flat, "GRANT EXECUTE"), 1, "single grant target in 20260926150000");
  eq(countIn(F.e3b.flat, "GRANT EXECUTE"), 1, "single grant target in 20260926160000");
});

test("S42 payment verify: the two hardening migrations are executable-text duplicates", () => {
  eq(F.e3a.flat, F.e3b.flat, "the duplicated fix has drifted -- one of them no longer matches the other");
});

test("S43 payment verify: each hardening is exactly the REVOKE + GRANT pair, nothing more", () => {
  for (const key of ["e3a", "e3b"]) {
    eq(F[key].statements.length, 2, M[key] + " must contain exactly two statements");
    eq(F[key].statements[0], VERIFY_REVOKE.slice(0, -1), M[key] + " statement 1 is the explicit REVOKE");
    eq(F[key].statements[1], VERIFY_GRANT.slice(0, -1), M[key] + " statement 2 is the service_role GRANT");
  }
});

test("S44 payment verify: ALTER DEFAULT PRIVILEGES is absent from all three files (deliberately out of scope)", () => {
  for (const key of ["b1", "e3a", "e3b"]) {
    hasNot(F[key].flat, "ALTER DEFAULT PRIVILEGES", M[key] + " must not touch the schema default ACL");
  }
});

// ===========================================================================
// D7 -- messaging restrictions (20261005120000)
// ===========================================================================

test("S45 messaging: can_message_to() is a STABLE SECURITY DEFINER function with a pinned search_path", () => {
  const f = F.messaging.flat;
  has(f, "CREATE OR REPLACE FUNCTION public.can_message_to(_from_user_id uuid, _to_user_id uuid)");
  has(f, "RETURNS boolean");
  has(f, "LANGUAGE sql");
  has(f, "STABLE");
  has(f, "SECURITY DEFINER");
  has(f, "SET search_path = public");
});

test("S46 messaging: can_message_to() delegates approval/plan eligibility to can_message()", () => {
  has(F.messaging.flat, "SELECT public.can_message(_from_user_id) AND NOT EXISTS (");
});

test("S47 messaging: the block check is bidirectional across both participants", () => {
  has(
    F.messaging.flat,
    "SELECT 1 FROM public.blocks WHERE (user_id = _from_user_id AND target_id = _to_user_id) " +
      "OR (user_id = _to_user_id AND target_id = _from_user_id)"
  );
});

test("S48 messaging: can_message_to() EXECUTE is revoked from public/anon and granted to authenticated", () => {
  const f = F.messaging.flat;
  has(f, "REVOKE EXECUTE ON FUNCTION public.can_message_to(uuid, uuid) FROM public, anon;");
  has(f, "GRANT EXECUTE ON FUNCTION public.can_message_to(uuid, uuid) TO authenticated;");
});

test("S49 messaging: the conversations INSERT policy is rewritten to require can_message_to()", () => {
  const f = F.messaging.flat;
  has(f, 'DROP POLICY IF EXISTS "paid members start conversations" ON public.conversations;');
  has(f, 'CREATE POLICY "paid members start conversations" ON public.conversations FOR INSERT TO authenticated');
  has(f, "auth.uid() IN (user_a, user_b) AND public.can_message_to( auth.uid(),");
  has(f, "CASE WHEN auth.uid() = user_a THEN user_b ELSE user_a END");
});

test("S50 messaging: the messages INSERT policy re-checks blocks on every send AND re-validates participation", () => {
  const f = F.messaging.flat;
  has(f, 'DROP POLICY IF EXISTS "participants send messages" ON public.messages;');
  has(f, 'CREATE POLICY "participants send messages" ON public.messages FOR INSERT TO authenticated');
  has(f, "sender_id = auth.uid() AND public.can_message_to(");
  has(
    f,
    "EXISTS ( SELECT 1 FROM public.conversations c WHERE c.id = conversation_id " +
      "AND auth.uid() IN (c.user_a, c.user_b) )",
    "a caller must not be able to post into a conversation they are not part of"
  );
});

test("S51 messaging: the reverse block-lookup index is created idempotently", () => {
  has(F.messaging.flat, "CREATE INDEX IF NOT EXISTS blocks_target_user_idx ON public.blocks (target_id, user_id);");
});

test("S52 messaging: parse-time dependency order -- function first, then the two policies that reference it", () => {
  const f = F.messaging.flat;
  const fn = at(f, "CREATE OR REPLACE FUNCTION public.can_message_to");
  const conv = at(f, 'CREATE POLICY "paid members start conversations"');
  const msg = at(f, 'CREATE POLICY "participants send messages"');
  ok(fn >= 0, "can_message_to definition present");
  ok(conv >= 0, "conversations policy present");
  ok(msg >= 0, "messages policy present");
  below(fn, conv, "WITH CHECK is parsed at CREATE POLICY time, so the function must already exist");
  below(conv, msg, "policy order preserved");
});

test("S53 messaging: can_message() last-definition dependency is pinned to 20261010120000 and still elite-aware", () => {
  const names = listSql("supabase/migrations");
  ok(names.length > 0, "migration directory readable");
  let lastFile = null;
  for (const n of names) {
    const flat = sqlFile("supabase/migrations/" + n).flat;
    if (flat.includes("CREATE OR REPLACE FUNCTION public.can_message(")) lastFile = n;
  }
  eq(
    lastFile,
    EXPECTED_LAST_CAN_MESSAGE,
    "the pinned last-definition dependency for can_message() changed. Its presence does NOT establish " +
      "that it was deployed; re-pin deliberately if the Elite migration was intentionally removed or renamed."
  );
  const body = F.elite.flat;
  has(body, "CREATE OR REPLACE FUNCTION public.can_message(_user_id uuid)");
  has(body, "p.status = 'approved'");
  has(body, "membership_plan IN ('standard','premium','elite')", "the elite plan must be treated as paid");
});

test("S54 messaging: the baseline can_message() definition and its privileges are pinned", () => {
  const f = F.canMessage.flat;
  has(f, "CREATE OR REPLACE FUNCTION public.can_message(_user_id uuid)");
  has(f, "RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public");
  has(f, "membership_plan IN ('standard','premium')");
  has(f, "REVOKE EXECUTE ON FUNCTION public.can_message(uuid) FROM public, anon;");
  has(f, "GRANT EXECUTE ON FUNCTION public.can_message(uuid) TO authenticated;");
});

test("S55 coverage: every harness migration reference resolves, and all six approved domains are reported", (t) => {
  const migrations = new Set(listSql("supabase/migrations"));
  const harnesses = listSql("test-harness");
  eq(SEC_DOMAINS.length, 6, "the six approved security domains must all be reported");
  ok(migrations.size > 0, "migration directory readable");
  ok(harnesses.length > 0, "harness directory readable");

  const dangling = [];
  for (const h of harnesses) {
    const raw = sqlFile("test-harness/" + h).raw;
    const refs = [];
    const re = /2026\d{10}_[a-z0-9_.-]+\.sql/g;
    let m;
    while ((m = re.exec(raw)) !== null) if (!refs.includes(m[0])) refs.push(m[0]);
    for (const r of refs) if (!migrations.has(r)) dangling.push(h + " -> " + r);
  }
  eq(dangling.length, 0, "harness(es) point at a migration that no longer exists: " + dangling.join(", "));

  const lines = [
    "Phase 5A security-contract coverage (static, offline -- source text only, never executed)",
    "  domain                          static assertions   live DB harness",
  ];
  for (const d of SEC_DOMAINS) {
    const wanted = d.migrations.map(baseName);
    const live = harnesses.filter((h) => {
      const raw = sqlFile("test-harness/" + h).raw;
      return wanted.some((w) => raw.includes(w));
    });
    lines.push(
      "  " +
        d.key.padEnd(32) +
        d.stat.padEnd(19) +
        (live.length ? live.join(", ") : "none")
    );
  }
  lines.push("  note: a live harness listed above is discovered, not asserted -- adding one is coverage,");
  lines.push("        not a regression. Only a reference to a missing migration fails this check.");
  for (const line of lines) t.diagnostic(line);
});

// ===========================================================================
// D8 -- admin deletion restrictions (20261005130000)
// ===========================================================================

const ADMIN_DELETE_STMT =
  'CREATE POLICY "admins delete blocks" ON public.blocks FOR DELETE TO authenticated ' +
  "USING (public.has_role(auth.uid(), 'admin'::app_role))";

test("S56 admin delete: the migration is exactly one statement -- the admin DELETE policy", () => {
  const f = F.adminDelete;
  eq(f.statements.length, 1, "expected a single statement, found: " + f.statements.join(" | "));
  eq(f.statements[0], ADMIN_DELETE_STMT, "the admin unblock policy text drifted");
});

test("S57 admin delete: no DROP POLICY -- the client's own block privileges cannot have been removed", () => {
  hasNot(F.adminDelete.flat, "DROP POLICY", "adding admin DELETE must not revoke the existing client DELETE");
});

test("S58 admin delete: no DROP TABLE, ALTER TABLE, GRANT or REVOKE", () => {
  const f = F.adminDelete.flat;
  for (const token of ["DROP TABLE", "ALTER TABLE", "GRANT", "REVOKE"]) {
    hasNot(f, token, "20261005130000 must not contain " + token);
  }
});

test("S59 admin delete: the policy is scoped to authenticated admins only", () => {
  const f = F.adminDelete.flat;
  has(f, 'CREATE POLICY "admins delete blocks"');
  has(f, "ON public.blocks FOR DELETE TO authenticated");
  has(f, "USING (public.has_role(auth.uid(), 'admin'::app_role))");
});

test("S60 admin delete: the baseline client policy on blocks is intact, so client DELETE survives", () => {
  has(
    F.baseSchema.flat,
    'CREATE POLICY "own blocks" ON public.blocks FOR ALL TO authenticated ' +
      "USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());"
  );
});

test("S61 admin delete: the baseline grants SELECT/INSERT/DELETE on blocks to authenticated", () => {
  has(F.baseSchema.flat, "GRANT SELECT, INSERT, DELETE ON public.blocks TO authenticated;");
});

test("S62 admin delete: has_role() -- which every admin policy here depends on -- is hard and not anon-callable", () => {
  const schema = F.baseSchema.flat;
  has(schema, "CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)");
  has(
    schema,
    "RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public",
    "a non-definer or un-pinned has_role() would make every admin policy in this phase unreliable"
  );
  const acl = F.hasRoleAcl.flat;
  has(acl, "REVOKE ALL ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon;");
  has(acl, "GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated;");
});

// ===========================================================================
// Cross-cutting: file presence, harness pairing, wiring, self-safety, scope
// ===========================================================================

test("S63 inputs: every pinned migration, harness and source file loads successfully", () => {
  const pinned = [
    ...Object.values(M),
    ...LIVE_HARNESSES.map((h) => h[0]),
    ...ALLOWED_SRC_FILES,
  ];
  // Force every pinned input through the loader first so a missing file shows
  // up here as a load error rather than as an empty string downstream.
  for (const p of pinned) sqlFile(p);
  const missing = pinned.filter((p) => LOAD_ERRORS.has(rel(p)));
  eq(missing.length, 0, "missing or unreadable input(s): " + missing.join(", "));
  ok(pinned.length >= 21, "expected at least 21 pinned inputs, pinned " + pinned.length);
});

test("S64 live harness inventory: the six tracked security harnesses still exist", () => {
  eq(LIVE_HARNESSES.length, 6, "expected six tracked security harnesses");
  for (const [h] of LIVE_HARNESSES) {
    ok(sqlFile(h).raw.length > 0, "harness missing or empty: " + h);
  }
});

test("S65 live harness pairing: each harness header names the migration it actually exercises", () => {
  for (const [h, m] of LIVE_HARNESSES) {
    has(
      sqlFile(h).raw,
      m,
      h + " no longer names its target migration " + m + " -- the pairing claim is stale"
    );
  }
});

test("S66 wiring: the admin approval RPC added by 20260926190000 is the path admin-data.ts calls", () => {
  has(ADMIN_DATA, 'rpc("decide_profile_approval"');
});

test("S67 wiring: verify_payment is called through the service-role admin client E3 preserves", () => {
  has(PAYMENTS_SRC, 'rpc("verify_payment"');
});

test("S68 self-safety: this file imports Node built-ins only and holds no network/env/database capability", () => {
  const raw = readText(SELF);
  const code = stripJs(raw);

  const specs = [];
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (!t.startsWith("import ")) continue;
    const from = t.indexOf("from");
    if (from < 0) continue;
    const q1 = t.indexOf('"', from);
    if (q1 < 0) continue;
    const q2 = t.indexOf('"', q1 + 1);
    if (q2 < 0) continue;
    specs.push(t.slice(q1 + 1, q2));
  }
  same(
    specs.sort(),
    ["node:assert/strict", "node:fs", "node:test"],
    "only Node built-ins may be imported"
  );

  // The deny-list is itself source text, so each token is assembled from
  // fragments that never appear contiguously anywhere in this file. Otherwise
  // the scan would flag its own deny-list and could never pass.
  const denyFragments = [
    ["fet", "ch("],
    ["XMLHttp", "Request"],
    ["process", ".e", "nv"],
    [".e", "nv"],
    ["child_pro", "cess"],
    ["ps", "ql"],
    ["htt", "p://"],
    ["http", "s://"],
    ["supab", "ase.co"],
    ["create", "Client"],
    ["service", "Role"],
    ["SUPABASE_", "SERVICE"],
    ["R", "2_"],
    ["wrang", "ler"],
    ["cloud", "flare"],
    ["INSERT ", "INTO"],
    ["createCon", "nection"],
    ["ms", "sql"],
    ["postgr", "es://"],
  ];
  for (const parts of denyFragments) {
    const token = parts.join("");
    hasNot(code, token, "capability/token not permitted in an offline static test: " + token);
  }
});

test("S69 scope: every file and directory opened stayed inside the approved prefixes", (t) => {
  const bad = [...READ_FILES, ...READ_DIRS].filter((p) => !withinScope(p));
  eq(bad.length, 0, "reads outside the approved prefixes: " + bad.join(", "));
  eq(LOAD_ERRORS.size, 0, "read errors: " + [...LOAD_ERRORS.keys()].join(", "));

  const srcReads = [...READ_FILES].filter((p) => p.startsWith("src/lib/")).sort();
  same(srcReads, ALLOWED_SRC_FILES.slice().sort(), "exactly the two pinned source files may be read");

  t.diagnostic("assert calls executed: " + assertCalls);
  t.diagnostic("files read: " + READ_FILES.size + "  directories read: " + READ_DIRS.size);
});

// ---------------------------------------------------------------------------
// stripJs -- comment/string-aware scan of this module's own source (S68 only).
// No template literals are used in this file, so quotes are the only nesting
// that has to be tracked.
// ---------------------------------------------------------------------------

function stripJs(src) {
  let out = "";
  let i = 0;
  let state = "code";
  const back = [];
  const n = src.length;
  while (i < n) {
    const c = src[i];
    const c2 = i + 1 < n ? src[i + 1] : "";
    if (state === "code") {
      if (c === "/" && c2 === "/") {
        back.push("code");
        state = "lc";
        i += 2;
      } else if (c === "/" && c2 === "*") {
        back.push("code");
        state = "bc";
        i += 2;
      } else if (c === "'" || c === '"') {
        back.push("code");
        state = c === "'" ? "sq" : "dq";
        out += c;
        i++;
      } else {
        out += c;
        i++;
      }
    } else if (state === "sq" || state === "dq") {
      const quote = state === "sq" ? "'" : '"';
      if (c === "\\") {
        out += c + c2;
        i += 2;
      } else if (c === quote && c2 === quote) {
        out += quote + quote;
        i += 2;
      } else if (c === quote) {
        state = back.pop() || "code";
        out += c;
        i++;
      } else {
        out += c;
        i++;
      }
    } else if (state === "lc") {
      if (c === "\n") {
        out += "\n";
        state = back.pop() || "code";
      }
      i++;
    } else {
      if (c === "*" && c2 === "/") {
        state = back.pop() || "code";
        i += 2;
      } else if (c === "\n") {
        out += "\n";
      }
      i++;
    }
  }
  return out;
}
