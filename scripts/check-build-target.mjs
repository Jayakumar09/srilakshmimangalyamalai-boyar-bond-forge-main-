import { readdirSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";

const TEST_REF = "nqadtfqyurkpmxcodswc";
const PROD_REF = "sxpkutjkqfekqwpabgrk";
const TEST_WORKER = "slmm-boyar-matrimony-test";
const PROD_WORKER = "slmm-boyar-matrimony";

const target = process.argv[2];
if (target !== "test" && target !== "prod") {
  console.error("Usage: node scripts/check-build-target.mjs <test|prod>");
  process.exit(2);
}

const root = process.cwd();
const outputDir = path.join(root, ".output");
if (!existsSync(outputDir)) {
  console.error("FAIL: .output not found — run a build first.");
  process.exit(2);
}

const SCAN_EXT = /\.(js|mjs|cjs|json|html|css|txt|webmanifest)$/i;

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(p));
    else if (SCAN_EXT.test(entry.name)) out.push(p);
  }
  return out;
}

const files = walk(outputDir);
const hits = { test: [], prod: [] };
for (const file of files) {
  const text = readFileSync(file, "utf8");
  if (text.includes(TEST_REF)) hits.test.push(path.relative(root, file));
  if (text.includes(PROD_REF)) hits.prod.push(path.relative(root, file));
}

const expectedRef = target === "test" ? TEST_REF : PROD_REF;
const forbiddenRef = target === "test" ? PROD_REF : TEST_REF;
const expectedHits = target === "test" ? hits.test : hits.prod;
const forbiddenHits = target === "test" ? hits.prod : hits.test;

console.log(`Build target: ${target}`);
console.log(`  expected ref ${expectedRef}: present in ${expectedHits.length} file(s)`);
console.log(`  forbidden ref ${forbiddenRef}: present in ${forbiddenHits.length} file(s)`);

const workerConfigPath = path.join(outputDir, "server", "wrangler.json");
const expectedWorker = target === "test" ? TEST_WORKER : PROD_WORKER;
const forbiddenWorker = target === "test" ? PROD_WORKER : TEST_WORKER;
let workerName = null;
let workerError = null;
if (!existsSync(workerConfigPath)) {
  workerError = "file not found";
} else {
  try {
    const parsed = JSON.parse(readFileSync(workerConfigPath, "utf8"));
    if (typeof parsed?.name !== "string" || parsed.name.length === 0) {
      workerError = 'missing or non-string "name" field';
    } else {
      workerName = parsed.name;
    }
  } catch (err) {
    workerError = `not valid JSON (${err.message})`;
  }
}

console.log(`  expected Worker name ${expectedWorker}`);
console.log(
  `  actual Worker name   ${workerError ? `(unreadable: ${workerError})` : workerName}`,
);

let ok = true;
if (expectedHits.length === 0) {
  console.error(`FAIL: expected ref ${expectedRef} not found in build output.`);
  ok = false;
}
if (forbiddenHits.length > 0) {
  console.error(
    `FAIL: forbidden ref ${forbiddenRef} found in:\n  - ${forbiddenHits.join("\n  - ")}`,
  );
  ok = false;
}
if (workerError) {
  console.error(
    `FAIL: cannot read Worker name from ${path.relative(root, workerConfigPath)}: ${workerError}.`,
  );
  ok = false;
} else if (workerName === forbiddenWorker) {
  console.error(
    `FAIL: Worker name "${workerName}" targets the wrong environment for build target "${target}".`,
  );
  ok = false;
} else if (workerName !== expectedWorker) {
  console.error(
    `FAIL: Worker name mismatch: expected "${expectedWorker}", got "${workerName}".`,
  );
  ok = false;
}
if (!ok) process.exit(1);

console.log("PASS: build output matches the target environment.");
