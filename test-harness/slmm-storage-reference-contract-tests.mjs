// Offline SQL text contracts only. Does not execute SQL or verify deployed RLS.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const sql = readFileSync(new URL("../supabase/migrations/20261017130000_storage_reference_state.sql", import.meta.url), "utf8");
const body = sql.split("AS $$")[1]?.split("$$;")[0];
assert.ok(body);
const executableBody = body.replace(/--[^\n]*/g, "");
const sources = [
  ["payments", "p", "proof_key"],
  ["jathagam_requests", "j", "report_key"],
  ["support_messages", "m", "attachment_key"],
  ["profiles", "p", "photo_url"],
  ["payment_events", "e", "receipt_key"],
];

test("aggregate RPC is narrow, read-only and preserves the committed document RPC", () => {
  assert.match(sql, /CREATE FUNCTION public\.get_storage_reference_state\(p_storage_key text\)/);
  assert.match(sql, /RETURNS TABLE \(\s*has_document_references boolean,\s*may_delete_document_references boolean,\s*has_protected_references boolean\s*\)/);
  assert.match(sql, /LANGUAGE plpgsql\s+STABLE\s+SECURITY DEFINER/);
  assert.doesNotMatch(executableBody, /\b(INSERT|UPDATE|DELETE|EXECUTE)\b/i);
  assert.doesNotMatch(sql, /(?:CREATE|ALTER|DROP) POLICY|ALTER TABLE|(?:CREATE|ALTER|DROP) FUNCTION public\.get_document_storage_reference_state/i);
});

test("claims and Finding 2 authorization/validation precede protected reference access", () => {
  assert.match(body, /auth\.uid\(\) IS NULL OR auth\.role\(\) IS DISTINCT FROM 'authenticated'/);
  assert.match(body, /SELECT s\.has_references, s\.may_delete_references\s+INTO STRICT v_documents, v_may_delete\s+FROM public\.get_document_storage_reference_state\(p_storage_key\) AS s/);
  assert.match(body, /v_documents IS NULL OR v_may_delete IS NULL\s+OR \(NOT v_documents AND NOT v_may_delete\)/);
  const authAt = body.indexOf("FROM public.get_document_storage_reference_state");
  for (const [table] of sources) assert.ok(authAt < body.indexOf(`FROM public.${table} AS`));
});

for (const [table, alias, column] of sources) {
  test(`${table}.${column} protects exact literal keys without owner/status/folder restrictions`, () => {
    assert.ok(body.includes(`EXISTS (SELECT 1 FROM public.${table} AS ${alias} WHERE ${alias}.${column} = p_storage_key)`));
  });
}

test("aggregate includes every protected source via OR, with no status or pagination exclusions", () => {
  const query = executableBody.slice(executableBody.indexOf("RETURN QUERY"));
  assert.match(query, /^RETURN QUERY SELECT v_documents, v_may_delete,/);
  assert.equal((query.match(/EXISTS \(SELECT 1 FROM public\./g) ?? []).length, 5);
  assert.equal((query.match(/OR EXISTS/g) ?? []).length, 4);
  assert.doesNotMatch(query, /\b(status|user_id|sender_id|thread_id|LIMIT|OFFSET|v_admin)\b/i);
});

test("trusted owner visibility guard checks all six required tables, failing on missing relations", () => {
  assert.match(sql, /ALTER FUNCTION public\.get_storage_reference_state\(text\) OWNER TO postgres/);
  const tables = [...sql.matchAll(/'public\.([a-z_]+)'::regclass/g)].map((match) => match[1]);
  assert.deepEqual(tables, ["documents", ...sources.map(([table]) => table)]);
  assert.match(sql, /FOR v_table IN SELECT unnest\(ARRAY\[/);
  assert.match(sql, /JOIN pg_catalog\.pg_class AS c ON c\.oid = v_table/);
  assert.match(sql, /r\.rolname = 'postgres'/);
  assert.match(sql, /r\.rolsuper OR r\.rolbypassrls OR \(c\.relowner = r\.oid AND NOT c\.relforcerowsecurity\)/);
  assert.match(sql, /pg_catalog\.has_table_privilege\(r\.oid, c\.oid, 'SELECT'\)/);
  assert.match(sql, /RAISE EXCEPTION 'Storage reference RPC owner lacks authoritative visibility on %', v_table/);
});

test("search path, RLS safeguard and EXECUTE grants stay restricted", () => {
  assert.match(sql, /SET search_path = pg_catalog, pg_temp/);
  assert.match(sql, /SET row_security = off/);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.get_storage_reference_state\(text\)\s+FROM PUBLIC, anon, authenticated, service_role/);
  assert.deepEqual(sql.match(/GRANT EXECUTE[^;]+;/g), ["GRANT EXECUTE ON FUNCTION public.get_storage_reference_state(text) TO authenticated;"]);
  assert.match(sql, /^BEGIN;/m);
  assert.match(sql, /^COMMIT;/m);
});
