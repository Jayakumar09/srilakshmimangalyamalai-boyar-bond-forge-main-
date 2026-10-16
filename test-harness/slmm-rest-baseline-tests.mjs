// test-harness/slmm-rest-baseline-tests.mjs
// ---------------------------------------------------------------------------
// Phase 5B correction - OFFLINE regression tests for the baseline read
// validator (slmm-rest-baseline.mjs). Hermetic: no network, no credentials.
//
// Covers: failed HTTP responses, malformed payloads, missing required fields,
// invalid ids, incomplete pagination (truncation), duplicate records, ambiguous
// totals, over-reads, the page budget, and successful single/multi-page reads.
// Run: node --test test-harness/slmm-rest-baseline-tests.mjs
// ---------------------------------------------------------------------------
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BaselineError,
  validateRows,
  fetchCompleteBaseline,
  parseContentRange,
  DEFAULT_PAGE_SIZE,
} from "./slmm-rest-baseline.mjs";

const makeRows = (n, prefix = "id") => Array.from({ length: n }, (_, i) => ({ id: `${prefix}-${i}` }));

// Scripted page fetcher: returns queued pages in order, recording each call.
function scripted(pages) {
  const queue = [...pages];
  const calls = [];
  const fetchPage = async (offset, limit) => {
    calls.push({ offset, limit });
    if (queue.length === 0) throw new Error("unexpected extra page request");
    return queue.shift();
  };
  return { fetchPage, calls };
}

// Data-set fetcher emulating PostgREST Range pagination + count=exact.
function datasetFetcher(data, { total = data.length, status = 200 } = {}) {
  const calls = [];
  const fetchPage = async (offset, limit) => {
    calls.push({ offset, limit });
    return { status, rows: data.slice(offset, offset + limit), total };
  };
  return { fetchPage, calls };
}

// ---------------------------------------------------------------------------
// validateRows
// ---------------------------------------------------------------------------
test("validateRows rejects a non-array payload", () => {
  assert.throws(() => validateRows({ message: "no" }, { label: "t" }), BaselineError);
});

test("validateRows rejects a row missing a required field", () => {
  assert.throws(
    () => validateRows([{ id: "a" }], { label: "t", requiredFields: ["id", "thread_id"] }),
    BaselineError,
  );
});

test("validateRows rejects an empty, non-string or non-object row id", () => {
  assert.throws(() => validateRows([{ id: "" }], { label: "t" }), BaselineError);
  assert.throws(() => validateRows([{ id: 42 }], { label: "t" }), BaselineError);
  assert.throws(() => validateRows([null], { label: "t" }), BaselineError);
  assert.throws(() => validateRows([[]], { label: "t" }), BaselineError);
});

test("validateRows allows a present-but-null nullable column", () => {
  assert.doesNotThrow(() =>
    validateRows([{ id: "a", status: null }], { label: "t", requiredFields: ["id", "status"] }),
  );
});

// ---------------------------------------------------------------------------
// Successful reads
// ---------------------------------------------------------------------------
test("successful single-page read returns rows and the verified total", async () => {
  const { fetchPage, calls } = datasetFetcher(makeRows(3));
  const out = await fetchCompleteBaseline(fetchPage, { label: "t", requiredFields: ["id"] });
  assert.equal(out.total, 3);
  assert.equal(out.rows.length, 3);
  assert.equal(calls.length, 1);
});

test("successful MULTI-page read fetches every row exactly once", async () => {
  const data = makeRows(137);
  const { fetchPage, calls } = datasetFetcher(data);
  const out = await fetchCompleteBaseline(fetchPage, { label: "t", requiredFields: ["id"], pageSize: 100 });
  assert.equal(out.total, 137);
  assert.equal(out.rows.length, 137);
  assert.equal(new Set(out.rows.map((r) => r.id)).size, 137);
  assert.equal(calls.length, 2);
  assert.deepEqual(
    calls.map((c) => c.offset),
    [0, 100],
    "second page must resume from the number of rows already read",
  );
});

test("a 206 partial page is accepted as a valid page", async () => {
  const { fetchPage, calls } = datasetFetcher(makeRows(5), { status: 206 });
  const out = await fetchCompleteBaseline(fetchPage, { label: "t", pageSize: 100 });
  assert.equal(out.rows.length, 5);
  assert.equal(calls.length, 1);
});

test("multi-page read built from 206 partial pages reads completely", async () => {
  const { fetchPage, calls } = datasetFetcher(makeRows(137), { status: 206 });
  const out = await fetchCompleteBaseline(fetchPage, { label: "t", pageSize: 100 });
  assert.equal(out.rows.length, 137);
  assert.equal(calls.length, 2);
});

test("an empty baseline is valid and returns an empty array", async () => {
  const { fetchPage, calls } = scripted([{ status: 200, rows: [], total: 0 }]);
  const out = await fetchCompleteBaseline(fetchPage, { label: "t" });
  assert.deepEqual(out.rows, []);
  assert.equal(out.total, 0);
  assert.equal(calls.length, 1);
});

test("the default page size is a positive integer", () => {
  assert.ok(Number.isInteger(DEFAULT_PAGE_SIZE) && DEFAULT_PAGE_SIZE > 0);
});

// ---------------------------------------------------------------------------
// Failed HTTP responses
// ---------------------------------------------------------------------------
test("rejects a failed HTTP status (500)", async () => {
  const { fetchPage } = datasetFetcher([], { total: 0, status: 500 });
  await assert.rejects(fetchCompleteBaseline(fetchPage, { label: "t" }), BaselineError);
});

test("rejects an unexpected HTTP status (404)", async () => {
  const { fetchPage } = scripted([{ status: 404, rows: [], total: 0 }]);
  await assert.rejects(fetchCompleteBaseline(fetchPage, { label: "t" }), BaselineError);
});

test("rejects a page fetch that throws", async () => {
  const fetchPage = async () => {
    throw new Error("network down");
  };
  await assert.rejects(fetchCompleteBaseline(fetchPage, { label: "t" }), BaselineError);
});

// ---------------------------------------------------------------------------
// Malformed data
// ---------------------------------------------------------------------------
test("rejects a malformed (non-array) payload", async () => {
  const { fetchPage } = scripted([{ status: 200, rows: { message: "no" }, total: 1 }]);
  await assert.rejects(fetchCompleteBaseline(fetchPage, { label: "t" }), BaselineError);
});

test("rejects a baseline page missing a required field", async () => {
  const { fetchPage } = scripted([{ status: 200, rows: [{ id: "a" }], total: 1 }]);
  await assert.rejects(
    fetchCompleteBaseline(fetchPage, { label: "t", requiredFields: ["id", "thread_id"] }),
    BaselineError,
  );
});

test("rejects a baseline page containing an invalid id", async () => {
  const { fetchPage } = scripted([{ status: 200, rows: [{ id: "" }], total: 1 }]);
  await assert.rejects(fetchCompleteBaseline(fetchPage, { label: "t" }), BaselineError);
});

// ---------------------------------------------------------------------------
// Incomplete pagination / completeness
// ---------------------------------------------------------------------------
test("rejects an incomplete read (0-row page while rows are still outstanding)", async () => {
  const { fetchPage } = scripted([
    { status: 200, rows: [{ id: "a" }], total: 3 },
    { status: 200, rows: [], total: 3 },
  ]);
  await assert.rejects(fetchCompleteBaseline(fetchPage, { label: "t", pageSize: 100 }), BaselineError);
});

test("rejects a read that exceeds the page budget without reaching the total", async () => {
  let n = 0;
  const fetchPage = async () => ({ status: 200, rows: [{ id: `x-${n++}` }], total: 10 });
  await assert.rejects(
    fetchCompleteBaseline(fetchPage, { label: "t", pageSize: 1, maxPages: 3 }),
    BaselineError,
  );
});

test("rejects an over-read (more rows returned than the server total)", async () => {
  const { fetchPage } = scripted([{ status: 200, rows: [{ id: "a" }, { id: "b" }], total: 1 }]);
  await assert.rejects(fetchCompleteBaseline(fetchPage, { label: "t", pageSize: 100 }), BaselineError);
});

// ---------------------------------------------------------------------------
// Duplicate records / ambiguous totals
// ---------------------------------------------------------------------------
test("rejects duplicate ids ACROSS pages", async () => {
  const { fetchPage } = scripted([
    { status: 200, rows: [{ id: "a" }, { id: "b" }], total: 3 },
    { status: 200, rows: [{ id: "b" }, { id: "c" }], total: 3 },
  ]);
  await assert.rejects(fetchCompleteBaseline(fetchPage, { label: "t", pageSize: 100 }), BaselineError);
});

test("rejects duplicate ids WITHIN a single page", async () => {
  const { fetchPage } = scripted([{ status: 200, rows: [{ id: "a" }, { id: "a" }], total: 2 }]);
  await assert.rejects(fetchCompleteBaseline(fetchPage, { label: "t", pageSize: 100 }), BaselineError);
});

test("rejects an ambiguous read where the server reports no total", async () => {
  const { fetchPage } = scripted([{ status: 200, rows: [{ id: "a" }], total: null }]);
  await assert.rejects(fetchCompleteBaseline(fetchPage, { label: "t" }), BaselineError);
});

test("rejects a total count that changes between pages", async () => {
  const { fetchPage } = scripted([
    { status: 200, rows: [{ id: "a" }], total: 3 },
    { status: 200, rows: [{ id: "b" }], total: 4 },
  ]);
  await assert.rejects(fetchCompleteBaseline(fetchPage, { label: "t", pageSize: 1 }), BaselineError);
});

// ---------------------------------------------------------------------------
// Options / error attribution
// ---------------------------------------------------------------------------
test("rejects an invalid pageSize", async () => {
  const fetchPage = async () => ({ status: 200, rows: [], total: 0 });
  await assert.rejects(fetchCompleteBaseline(fetchPage, { label: "t", pageSize: 0 }), BaselineError);
});

test("BaselineError names the failing baseline label", async () => {
  const { fetchPage } = scripted([{ status: 500, rows: [], total: 0 }]);
  await assert.rejects(
    fetchCompleteBaseline(fetchPage, { label: "profiles" }),
    (err) => err instanceof BaselineError && /profiles/.test(err.message),
  );
});

test("a BaselineError thrown by the page fetcher is not double-wrapped", async () => {
  const fetchPage = async () => {
    throw new BaselineError("t", "range check failed");
  };
  await assert.rejects(
    fetchCompleteBaseline(fetchPage, { label: "t" }),
    (err) => err instanceof BaselineError && /range check failed/.test(err.message) && !/page fetch threw/.test(err.message),
  );
});

// ---------------------------------------------------------------------------
// parseContentRange - FULL Content-Range interval validation
// ---------------------------------------------------------------------------
test("parseContentRange accepts a complete first page", () => {
  assert.deepEqual(parseContentRange("0-24/137", { offset: 0, rowCount: 25, label: "t" }), {
    start: 0,
    end: 24,
    total: 137,
  });
});

test("parseContentRange accepts a complete final partial page", () => {
  assert.deepEqual(parseContentRange("100-136/137", { offset: 100, rowCount: 37, label: "t" }), {
    start: 100,
    end: 136,
    total: 137,
  });
});

test("parseContentRange accepts a single-row page", () => {
  assert.deepEqual(parseContentRange("0-0/1", { offset: 0, rowCount: 1, label: "t" }), {
    start: 0,
    end: 0,
    total: 1,
  });
});

test("parseContentRange tolerates surrounding whitespace", () => {
  assert.equal(parseContentRange("  7-9/10  ", { offset: 7, rowCount: 3, label: "t" }).start, 7);
});

test("parseContentRange accepts PostgREST's empty range representation", () => {
  assert.deepEqual(parseContentRange("*/0", { offset: 0, rowCount: 0, label: "t" }), {
    start: null,
    end: null,
    total: 0,
  });
});

test("parseContentRange accepts an empty page requested past the end", () => {
  assert.deepEqual(parseContentRange("*/10", { offset: 10, rowCount: 0, label: "t" }), {
    start: null,
    end: null,
    total: 10,
  });
});

test("parseContentRange rejects a missing or empty header", () => {
  assert.throws(() => parseContentRange(null, { offset: 0, rowCount: 0, label: "t" }), BaselineError);
  assert.throws(() => parseContentRange("", { offset: 0, rowCount: 0, label: "t" }), BaselineError);
  assert.throws(() => parseContentRange("   ", { offset: 0, rowCount: 0, label: "t" }), BaselineError);
});

test("parseContentRange rejects a malformed header", () => {
  assert.throws(() => parseContentRange("0-24", { offset: 0, rowCount: 25, label: "t" }), BaselineError);
  assert.throws(() => parseContentRange("a-b/c", { offset: 0, rowCount: 1, label: "t" }), BaselineError);
  assert.throws(() => parseContentRange("0-24/1.5", { offset: 0, rowCount: 25, label: "t" }), BaselineError);
});

test("parseContentRange rejects a header with no total count", () => {
  assert.throws(() => parseContentRange("0-24/*", { offset: 0, rowCount: 25, label: "t" }), BaselineError);
});

test("parseContentRange rejects a start offset that does not match the request", () => {
  assert.throws(() => parseContentRange("5-9/100", { offset: 0, rowCount: 5, label: "t" }), BaselineError);
});

test("parseContentRange rejects an interval length that does not match the rows returned", () => {
  assert.throws(() => parseContentRange("0-24/137", { offset: 0, rowCount: 24, label: "t" }), BaselineError);
  assert.throws(() => parseContentRange("0-24/137", { offset: 0, rowCount: 26, label: "t" }), BaselineError);
});

test("parseContentRange rejects an impossible interval (end precedes start)", () => {
  assert.throws(() => parseContentRange("9-5/100", { offset: 9, rowCount: 5, label: "t" }), BaselineError);
});

test("parseContentRange rejects an interval that ends at or beyond the total", () => {
  assert.throws(() => parseContentRange("0-100/100", { offset: 0, rowCount: 101, label: "t" }), BaselineError);
  assert.throws(() => parseContentRange("0-136/100", { offset: 0, rowCount: 137, label: "t" }), BaselineError);
});

test("parseContentRange accepts an interval that exactly spans the whole table", () => {
  assert.deepEqual(parseContentRange("0-24/25", { offset: 0, rowCount: 25, label: "t" }), {
    start: 0,
    end: 24,
    total: 25,
  });
});

test("parseContentRange rejects a concrete interval when no rows were returned", () => {
  assert.throws(() => parseContentRange("0-2/3", { offset: 0, rowCount: 0, label: "t" }), BaselineError);
});

test("parseContentRange rejects the empty form when rows WERE returned", () => {
  assert.throws(() => parseContentRange("*/0", { offset: 0, rowCount: 3, label: "t" }), BaselineError);
});

test("parseContentRange rejects an empty page while rows are still outstanding", () => {
  assert.throws(() => parseContentRange("*/5", { offset: 0, rowCount: 0, label: "t" }), BaselineError);
});

test("parseContentRange rejects a half-star interval with a non-empty page", () => {
  assert.throws(() => parseContentRange("*-24/137", { offset: 0, rowCount: 25, label: "t" }), BaselineError);
});

test("parseContentRange rejects an invalid requested offset or row count", () => {
  assert.throws(() => parseContentRange("0-0/1", { offset: -1, rowCount: 1, label: "t" }), BaselineError);
  assert.throws(() => parseContentRange("0-0/1", { offset: 0, rowCount: 1.5, label: "t" }), BaselineError);
});

test("parseContentRange names the failing baseline label in its error", () => {
  assert.throws(
    () => parseContentRange("0-24/*", { offset: 0, rowCount: 25, label: "profiles" }),
    (err) => err instanceof BaselineError && /profiles/.test(err.message),
  );
});
