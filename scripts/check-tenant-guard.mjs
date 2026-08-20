#!/usr/bin/env node
/**
 * Report violations of the tenant-isolation lint rules only.
 *
 * A plain `eslint` run drowns these in pre-existing formatting noise. This
 * filters to the two rules that matter — direct DynamoDB imports and Scan usage
 * outside the enforcement layer — so the signal is visible and the exit code is
 * usable in CI.
 *
 * Usage: node scripts/check-tenant-guard.mjs
 */
import { execFileSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";

const TENANT_RULES = new Set(["no-restricted-imports", "no-restricted-syntax"]);

// Written to a file rather than piped: the full report is ~9MB and the child
// process is killed before stdout drains.
const REPORT = ".tenant-guard-report.json";

try {
  execFileSync("npx", ["eslint", "src", "apps", "-f", "json", "-o", REPORT], {
    encoding: "utf8",
    stdio: "ignore",
    // Node refuses to spawn .cmd/.bat directly since CVE-2024-27980, and on
    // Windows `npx` is a .cmd. Without this the child never starts and the
    // report is never written.
    shell: true,
  });
} catch {
  // eslint exits non-zero whenever it reports anything, including the
  // pre-existing formatting noise this script deliberately ignores.
}

let files;
try {
  files = JSON.parse(readFileSync(REPORT, "utf8"));
} catch {
  console.error(`Could not read ${REPORT} — did eslint run?`);
  process.exit(1);
} finally {
  rmSync(REPORT, { force: true });
}
const hits = [];

for (const file of files) {
  for (const message of file.messages ?? []) {
    if (!TENANT_RULES.has(message.ruleId)) continue;
    const relative = file.filePath.replace(process.cwd(), "").replace(/^[\\/]/, "");
    hits.push({ file: relative, line: message.line, message: message.message });
  }
}

if (hits.length === 0) {
  console.log("Tenant guard: no violations.");
  console.log("No code outside the enforcement layer imports DynamoDB or issues a Scan.");
  process.exit(0);
}

console.log(`Tenant guard: ${hits.length} violation(s)\n`);
for (const hit of hits) {
  console.log(`  ${hit.file}:${hit.line}`);
  console.log(`    ${hit.message}\n`);
}
process.exit(1);
