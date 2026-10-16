// test-harness/slmm-rest-baseline.mjs
// ---------------------------------------------------------------------------
// Phase 5B correction - pure, offline-testable baseline read validation.
//
// The live harness baseline reads decide what counts as "pre-existing" data and
// therefore which members are protected from cleanup. A partial, duplicated,
// malformed or ambiguous baseline would silently WEAKEN protection, so these
// reads are read COMPLETELY (fully paginated) and validated STRICTLY, and any
// failure is fatal (the caller aborts before creating or writing anything).
//
// This module performs NO I/O and never calls the network itself: the caller
// supplies a page fetcher `(offset, limit) => Promise<{ status, rows, total }>`
// where `total` is the server-reported row count (from PostgREST count=exact).
// The PostgREST `Content-Range` response header is parsed and validated in full
// by `parseContentRange` (below): the interval's start and end must agree with
// the offset that was requested and with the number of rows actually returned,
// not merely the total. That keeps the whole completeness/validation contract
// testable offline.
// ---------------------------------------------------------------------------

export class BaselineError extends Error {
  constructor(label, message) {
    super(`baseline '${label}' failed: ${message}`);
    this.name = "BaselineError";
    this.label = label;
  }
}

export const DEFAULT_PAGE_SIZE = 1000;
export const DEFAULT_MAX_PAGES = 500;
// PostgREST returns 200 when a range covers every row and 206 for a partial page.
export const DEFAULT_ACCEPTED_STATUSES = Object.freeze([200, 206]);

function assertRowObject(row, label, index) {
  if (row === null || typeof row !== "object" || Array.isArray(row)) {
    throw new BaselineError(label, `row ${index} is not an object`);
  }
}

// Validate one page payload: array shape, required-field presence, id type.
// Nullable columns are allowed to be null; the key must still be present.
export function validateRows(rows, { label = "unknown", requiredFields = [], idField = "id" } = {}) {
  if (!Array.isArray(rows)) {
    throw new BaselineError(label, "response payload is not a JSON array");
  }
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    assertRowObject(row, label, i);
    for (const field of requiredFields) {
      if (!Object.prototype.hasOwnProperty.call(row, field)) {
        throw new BaselineError(label, `row ${i} is missing required field '${field}'`);
      }
    }
    if (idField) {
      const id = row[idField];
      if (typeof id !== "string" || id.length === 0) {
        throw new BaselineError(label, `row ${i} has an invalid '${idField}' (expected a non-empty string)`);
      }
    }
  }
  return rows;
}

// ---------------------------------------------------------------------------
// PostgREST `Content-Range` response header parsing + FULL interval validation.
//
// PostgREST reports the slice of rows it served in a `Content-Range` header,
// e.g. "0-24/137" (rows 0..24 of 137) or "*/0" for an empty result set (the
// star form is PostgREST's empty-range representation and carries no dash).
// Previously only the total was trusted, so a server/proxy could return the
// right total with the WRONG interval and the pagination would silently skip or
// re-read rows.
//
// Parse and validate the whole interval:
//   * the header must be well formed (`start-end/total`, or the star form);
//   * a total must be present and numeric (count=exact was requested);
//   * the returned start must equal the requested offset;
//   * the interval length must equal the number of rows actually returned;
//   * the interval must be possible (end >= start, end < total);
//   * an empty result set is accepted ONLY in the star form.
//
// Returns { start, end, total }; `start`/`end` are null for an empty result.
// Throws BaselineError on any malformed, inconsistent or impossible header.
// ---------------------------------------------------------------------------
const CONTENT_RANGE_RE = /^(\*|\d+(?:-\d+)?)\/(\*|\d+)$/;

export function parseContentRange(header, { offset, rowCount, label = "unknown" } = {}) {
  if (typeof header !== "string" || header.trim() === "") {
    throw new BaselineError(label, "missing or empty Content-Range header");
  }
  const value = header.trim();
  const match = CONTENT_RANGE_RE.exec(value);
  if (!match) {
    throw new BaselineError(label, `malformed Content-Range header '${value}'`);
  }
  const [, rawRange, rawTotal] = match;

  if (!Number.isInteger(offset) || offset < 0) {
    throw new BaselineError(label, `invalid requested offset (${offset})`);
  }
  if (!Number.isInteger(rowCount) || rowCount < 0) {
    throw new BaselineError(label, `invalid returned row count (${rowCount})`);
  }
  if (rawTotal === "*") {
    throw new BaselineError(label, `Content-Range '${value}' reports no total count (cannot prove completeness; ambiguous)`);
  }
  const total = Number(rawTotal);
  if (!Number.isInteger(total) || total < 0) {
    throw new BaselineError(label, `Content-Range '${value}' reports an invalid total count`);
  }

  // PostgREST's empty-range representation (e.g. "*/0"): no interval, no rows.
  if (rawRange === "*") {
    if (rowCount !== 0) {
      throw new BaselineError(label, `Content-Range '${value}' carries no interval but ${rowCount} rows were returned`);
    }
    if (offset < total) {
      throw new BaselineError(label, `Content-Range '${value}' returned no rows although ${total} exist from offset ${offset}`);
    }
    return { start: null, end: null, total };
  }

  // A concrete interval must accompany a non-empty result set.
  if (rowCount === 0) {
    throw new BaselineError(label, `Content-Range '${value}' declares an interval but no rows were returned`);
  }
  const [rawStart, rawEnd] = rawRange.split("-");
  const start = Number(rawStart);
  const end = Number(rawEnd);
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < 0) {
    throw new BaselineError(label, `Content-Range '${value}' has an invalid interval`);
  }
  if (end < start) {
    throw new BaselineError(label, `Content-Range '${value}' has an impossible interval (end precedes start)`);
  }
  if (start !== offset) {
    throw new BaselineError(label, `Content-Range '${value}' starts at ${start} but offset ${offset} was requested`);
  }
  if (end - start + 1 !== rowCount) {
    throw new BaselineError(label, `Content-Range '${value}' spans ${end - start + 1} rows but ${rowCount} rows were returned`);
  }
  if (end >= total) {
    throw new BaselineError(label, `Content-Range '${value}' ends at ${end} at or beyond the reported total ${total}`);
  }
  return { start, end, total };
}

// Read a table COMPLETELY via the supplied page fetcher and prove completeness.
// Rejects: failed/unexpected HTTP status, non-array payloads, missing required
// fields, invalid ids, duplicate ids (within or across pages), a missing total
// (ambiguous), a total that changes between pages, an over-read, a truncated
// read, and a read that exceeds the page budget.
//
// Returns { rows, total } where rows.length === total, or throws BaselineError.
export async function fetchCompleteBaseline(fetchPage, options = {}) {
  const {
    label = "unknown",
    requiredFields = [],
    idField = "id",
    pageSize = DEFAULT_PAGE_SIZE,
    maxPages = DEFAULT_MAX_PAGES,
    acceptedStatuses = DEFAULT_ACCEPTED_STATUSES,
  } = options;

  if (typeof fetchPage !== "function") throw new BaselineError(label, "no page fetcher was supplied");
  if (!Number.isInteger(pageSize) || pageSize <= 0) throw new BaselineError(label, `invalid pageSize (${pageSize})`);
  if (!Number.isInteger(maxPages) || maxPages <= 0) throw new BaselineError(label, `invalid maxPages (${maxPages})`);

  const seen = new Set();
  const rows = [];
  let offset = 0;
  let total = null;

  for (let page = 0; page < maxPages; page++) {
    let res;
    try {
      res = await fetchPage(offset, pageSize);
    } catch (err) {
      if (err instanceof BaselineError) throw err;
      throw new BaselineError(label, `page fetch threw: ${err && err.message ? err.message : String(err)}`);
    }
    if (res === null || typeof res !== "object") {
      throw new BaselineError(label, "page fetcher returned no result object");
    }
    if (!acceptedStatuses.includes(res.status)) {
      throw new BaselineError(label, `unexpected HTTP status ${res.status}`);
    }
    validateRows(res.rows, { label, requiredFields, idField });

    if (res.total === null || res.total === undefined) {
      throw new BaselineError(label, "server did not report a total count (cannot prove completeness; ambiguous)");
    }
    if (!Number.isInteger(res.total) || res.total < 0) {
      throw new BaselineError(label, `server reported an invalid total count (${res.total})`);
    }
    if (total === null) total = res.total;
    else if (res.total !== total) {
      throw new BaselineError(label, `total count changed between pages (${total} then ${res.total}); ambiguous`);
    }

    for (let i = 0; i < res.rows.length; i++) {
      const id = idField ? res.rows[i][idField] : null;
      if (id === null) continue;
      if (seen.has(id)) throw new BaselineError(label, `duplicate record '${id}' across pages`);
      seen.add(id);
    }
    rows.push(...res.rows);

    if (rows.length > total) {
      throw new BaselineError(label, `received ${rows.length} rows but the server reported only ${total} (over-read / overlap)`);
    }
    if (rows.length === total) break;
    if (page === maxPages - 1) {
      throw new BaselineError(label, `exceeded maxPages (${maxPages}) before reaching the reported total (${total}); truncated`);
    }
    if (res.rows.length === 0) {
      throw new BaselineError(label, `page returned 0 rows while ${total - rows.length} of ${total} are still outstanding; truncated`);
    }
    offset += res.rows.length;
  }

  if (total === null) throw new BaselineError(label, "no baseline pages were fetched");
  if (rows.length !== total) throw new BaselineError(label, `incomplete read: fetched ${rows.length} of ${total}`);
  return { rows, total };
}
