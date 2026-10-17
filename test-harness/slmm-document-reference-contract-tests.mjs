// Static SQL contracts only. No SQL engine, credentials, network or migrations.
// These checks do NOT prove deployed ownership, grants or effective RLS bypass.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const sql = readFileSync(new URL("../supabase/migrations/20261017120000_document_storage_reference_state.sql", import.meta.url), "utf8");
const body = sql.split("AS $$")[1]?.split("$$;")[0];
assert.ok(body);

test("RPC is a single-key read-only boolean-state capability", () => {
  assert.match(sql, /CREATE FUNCTION public\.get_document_storage_reference_state\(p_storage_key text\)/);
  assert.match(sql, /RETURNS TABLE \(has_references boolean, may_delete_references boolean\)/);
  assert.match(sql, /LANGUAGE plpgsql\s+STABLE\s+SECURITY DEFINER/);
  assert.doesNotMatch(body, /\b(INSERT|UPDATE|DELETE|EXECUTE)\b/i);
  assert.doesNotMatch(sql, /CREATE POLICY|ALTER POLICY|DROP POLICY|ALTER TABLE/i);
});

test("trusted owner and effective visibility are guarded, with fail-closed RLS setting", () => {
  assert.match(sql, /SET search_path = pg_catalog, pg_temp/);
  assert.match(sql, /SET row_security = off/);
  assert.match(sql, /ALTER FUNCTION public\.get_document_storage_reference_state\(text\) OWNER TO postgres/);
  assert.match(sql, /r\.rolname = 'postgres'/);
  assert.match(sql, /r\.rolsuper OR r\.rolbypassrls OR \(c\.relowner = r\.oid AND NOT c\.relforcerowsecurity\)/);
  assert.match(sql, /pg_catalog\.has_table_privilege\(r\.oid, c\.oid, 'SELECT'\)/);
  assert.match(sql, /RAISE EXCEPTION 'Reference RPC owner lacks authoritative document visibility'/);
});

test("identity and authorization derive from verified database claims before references", () => {
  assert.match(body, /v_actor uuid := auth\.uid\(\)/);
  assert.match(body, /v_actor IS NULL OR auth\.role\(\) IS DISTINCT FROM 'authenticated'/);
  assert.match(body, /public\.has_role\(v_actor, 'admin'::public\.app_role\)/);
  assert.match(body, /IF v_admin IS NULL THEN\s+RAISE EXCEPTION/);
  assert.match(body, /split_part\(p_storage_key, '\/', 1\) <> v_actor::text AND v_admin IS NOT TRUE/);
  assert.ok(body.indexOf("IF split_part") < body.indexOf("FROM public.documents"));
});

test("SQL validates literal keys without decoding or normalization", () => {
  assert.match(body, /p_storage_key IS NULL/);
  assert.match(body, /length\(p_storage_key\) NOT BETWEEN 1 AND 300/);
  assert.ok(body.includes('p_storage_key COLLATE "C" ~ \'[^A-Za-z0-9._/-]\''));
  assert.match(body, /strpos\(p_storage_key, '\/'\) = 0/);
  assert.match(body, /unnest\(string_to_array\(p_storage_key, '\/'\)\)/);
  assert.ok(body.includes("s.segment IN ('', '.', '..')"));
});

test("reference predicates inspect every exact-key row, including foreign ownership", () => {
  assert.match(body, /EXISTS \(SELECT 1 FROM public\.documents AS d WHERE d\.storage_key = p_storage_key\)/);
  assert.match(body, /v_admin OR NOT EXISTS/);
  assert.match(body, /d\.storage_key = p_storage_key AND d\.user_id IS DISTINCT FROM v_actor/);
  assert.doesNotMatch(body, /\bLIMIT\b|SELECT\s+d\.\*/i);
});

test("only authenticated callers receive EXECUTE and installation is transactional", () => {
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.get_document_storage_reference_state\(text\)\s+FROM PUBLIC, anon, authenticated, service_role/);
  const grants = sql.match(/GRANT EXECUTE[^;]+;/g);
  assert.deepEqual(grants, ["GRANT EXECUTE ON FUNCTION public.get_document_storage_reference_state(text) TO authenticated;"]);
  assert.match(sql, /^BEGIN;/m);
  assert.match(sql, /^COMMIT;/m);
});
