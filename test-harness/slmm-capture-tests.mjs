// slmm-capture-tests.mjs
// Local mock tests for resolveOfficeReplyId (T10 fix). NO network, NO database.
// Run: node slmm-capture-tests.mjs
// ---------------------------------------------------------------------------
import { resolveOfficeReplyId } from "./slmm-comm-capture.mjs";

const THREAD = "72cc6de6-3946-4bc3-be50-303479ab557f"; // this-run scratch thread
const BODY = "e2e-comm-office-reply-1790263066138";     // this-run unique office body
const results = [];
function check(n, label, got, expected) {
  const pass = got === expected;
  results.push({ n, pass, label });
  console.log(`${pass ? "PASS" : "FAIL"}  CASE ${n} ${label} :: got=${JSON.stringify(got)} expected=${JSON.stringify(expected)}`);
}
function expectThrow(fn, needle) {
  try {
    fn();
    return false;
  } catch (e) {
    return typeof e.message === "string" && e.message.includes(needle);
  }
}

// CASE 1: exactly one scoped match -> returns that id
check(1, "unique scoped match -> id returned",
  resolveOfficeReplyId(
    [{ id: "office-msg-1", thread_id: THREAD, sender_type: "admin", body: BODY }],
    { threadId: THREAD, body: BODY },
  ),
  "office-msg-1");

// CASE 2: empty lookup (e.g. POST row missing) -> FAILS CLOSED, no guess
check(2, "empty result -> throws (fail closed)",
  expectThrow(() => resolveOfficeReplyId([], { threadId: THREAD, body: BODY }), "not uniquely identified"),
  true);

// CASE 3: multiple matches (ambiguous) -> FAILS CLOSED, no guess
check(3, "ambiguous (2 matches) -> throws (fail closed)",
  expectThrow(() => resolveOfficeReplyId(
    [
      { id: "a", thread_id: THREAD, sender_type: "admin", body: BODY },
      { id: "b", thread_id: THREAD, sender_type: "admin", body: BODY },
    ],
    { threadId: THREAD, body: BODY },
  ), "not uniquely identified"),
  true);

// CASE 4: row belongs to a DIFFERENT (real/pre-existing) thread -> excluded, throws
check(4, "other thread's row excluded -> throws",
  expectThrow(() => resolveOfficeReplyId(
    [{ id: "x", thread_id: "some-other-thread", sender_type: "admin", body: BODY }],
    { threadId: THREAD, body: BODY },
  ), "not uniquely identified"),
  true);

// CASE 5: wrong sender_type (member message) -> excluded, throws
check(5, "member sender excluded -> throws",
  expectThrow(() => resolveOfficeReplyId(
    [{ id: "m", thread_id: THREAD, sender_type: "member", body: BODY }],
    { threadId: THREAD, body: BODY },
  ), "not uniquely identified"),
  true);

// CASE 6: wrong body (other content) -> excluded, throws
check(6, "different body excluded -> throws",
  expectThrow(() => resolveOfficeReplyId(
    [{ id: "o", thread_id: THREAD, sender_type: "admin", body: "other content" }],
    { threadId: THREAD, body: BODY },
  ), "not uniquely identified"),
  true);

// CASE 7: non-array / null input -> FAILS CLOSED
check(7, "null input -> throws (fail closed)",
  expectThrow(() => resolveOfficeReplyId(null, { threadId: THREAD, body: BODY }), "not uniquely identified"),
  true);

const failed = results.filter((x) => !x.pass);
console.log("----------------------------------------");
console.log(`CAPTURE TESTS: ${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length === 0 ? 0 : 1);