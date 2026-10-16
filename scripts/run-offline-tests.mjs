// scripts/run-offline-tests.mjs
// ---------------------------------------------------------------------------
// Phase 5B - safe offline test runner.
//
// Runs ONLY the suites in the harness registry's explicit OFFLINE_SUITES
// allowlist. It never globs test-harness/*, so it can never pick up a LIVE
// harness (which is additionally gated at runtime by live-guard.mjs).
//
// Usage: node scripts/run-offline-tests.mjs   (also `npm test` / `npm run test:offline`)
// Exits non-zero if any suite fails, if any parsed FAIL is reported, or if a
// suite produced no parseable results.
// ---------------------------------------------------------------------------
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { OFFLINE_SUITES } from "../test-harness/harness-registry.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");

const totals = { tests: 0, pass: 0, fail: 0, skip: 0 };
const rows = [];
let suiteFailures = 0;

console.log("SLMM OFFLINE TEST SUITES (no network, no database, no credentials)");
console.log("=".repeat(72));

for (const suite of OFFLINE_SUITES) {
  const abs = path.join(ROOT, "test-harness", suite.file);
  const args = suite.runner === "node-test" ? ["--test", abs] : [abs];
  console.log(`\n--- ${suite.file} (runner=${suite.runner}) ---`);
  const res = spawnSync(process.execPath, args, { cwd: ROOT, encoding: "utf8" });
  const out = `${res.stdout || ""}${res.stderr || ""}`;
  if (out) process.stdout.write(out);

  let tests = 0;
  let pass = 0;
  let fail = 0;
  let skip = 0;
  if (suite.runner === "node-test") {
    const num = (k) => {
      const m = out.match(new RegExp(`^# ${k} (\\d+)$`, "m"));
      return m ? Number(m[1]) : 0;
    };
    tests = num("tests");
    pass = num("pass");
    fail = num("fail");
    skip = num("skipped");
  } else {
    const m = out.match(/(\d+)\/(\d+)\s+passed/);
    if (m) {
      pass = Number(m[1]);
      tests = Number(m[2]);
      fail = tests - pass;
    }
  }

  const parseMiss = tests === 0;
  const ok = res.status === 0 && fail === 0 && !parseMiss;
  if (!ok) suiteFailures++;

  totals.tests += tests;
  totals.pass += pass;
  totals.fail += fail;
  totals.skip += skip;
  rows.push({ file: suite.file, tests, pass, fail, skip, exit: res.status, parseMiss, ok });
  console.log(
    `>>> ${suite.file}: ${ok ? "OK" : "FAIL"} ` +
      `(tests=${tests} pass=${pass} fail=${fail} skip=${skip} exit=${res.status}${parseMiss ? " no-results-parsed" : ""})`,
  );
}

console.log("\n" + "=".repeat(72));
console.log("SUMMARY");
for (const r of rows) {
  console.log(
    `  ${r.ok ? "OK  " : "FAIL"} ${r.file.padEnd(38)} tests=${r.tests} pass=${r.pass} fail=${r.fail} skip=${r.skip}`,
  );
}
console.log(
  `  TOTAL tests=${totals.tests} pass=${totals.pass} fail=${totals.fail} skip=${totals.skip} ` +
    `suites=${rows.length} failing_suites=${suiteFailures}`,
);
console.log("=".repeat(72));

process.exit(suiteFailures === 0 ? 0 : 1);
