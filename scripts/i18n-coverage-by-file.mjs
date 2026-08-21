#!/usr/bin/env node
/**
 * Per-file translation coverage.
 *
 * `i18n-phrases.mjs` answers "how much of the vocabulary is translated".
 * This answers the question a user actually asks — "will *this page* be in
 * Chinese" — by counting, for each file, how many of its `t(...)` calls resolve
 * to a translation and how many fall back to English.
 *
 * Usage: node scripts/i18n-coverage-by-file.mjs [--locale zh-CN] [--min 0]
 */
import { readFileSync, globSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const localeIndex = args.indexOf("--locale");
const LOCALE = localeIndex >= 0 ? args[localeIndex + 1] : "zh-CN";
const minIndex = args.indexOf("--min");
const MIN = minIndex >= 0 ? Number(args[minIndex + 1]) : 0;

const SYMBOLIC_KEY = /^[a-z]+(\.[a-zA-Z]+)+$/;
const normalize = (phrase) => phrase.replace(/\s+/g, " ").trim();

/**
 * Property-name text, whichever form the file happens to use.
 *
 * Prettier strips quotes from any key that is a valid identifier, so a table
 * written as `{"Status": "..."}` comes back as `{Status: "..."}` after the first
 * format pass. Reading only `StringLiteral` names silently missed 322 of them —
 * which under-reported coverage and, in the merge script, would have dropped
 * every one of those entries on the next write.
 */
function propertyName(node, ts) {
  if (ts.isStringLiteral(node.name) || ts.isNoSubstitutionTemplateLiteral(node.name)) {
    return node.name.text;
  }
  if (ts.isIdentifier(node.name) || ts.isNumericLiteral(node.name)) {
    return node.name.text;
  }
  return null;
}

function tableKeys(path, allowMissing = false) {
  let source;
  try {
    source = readFileSync(path, "utf8");
  } catch {
    if (allowMissing) return new Set();
    throw new Error(`Cannot read ${path}`);
  }
  const sf = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const keys = new Set();
  const visit = (node) => {
    if (ts.isPropertyAssignment(node)) {
      const key = propertyName(node, ts);
      if (key !== null) keys.add(normalize(key));
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sf, visit);
  return keys;
}

// Both lookup sources the runtime consults: the phrase table and the keyed
// dictionary. Counting only the first would under-report every hand-written
// call site.
const known = new Set([
  ...tableKeys(join(ROOT, `src/lib/i18n/phrases.${LOCALE}.ts`)),
  ...tableKeys(join(ROOT, "src/lib/i18n/dictionary.ts"), true),
]);

const rows = [];
let totalSites = 0;
let totalDone = 0;

for (const rel of globSync("src/**/*.{ts,tsx}", { cwd: ROOT })) {
  if (/\.test\.tsx?$/.test(rel)) continue;
  if (/[\\/]lib[\\/]i18n[\\/]/.test(rel)) continue;

  const source = readFileSync(join(ROOT, rel), "utf8");
  if (!source.includes("t(")) continue;

  const sf = ts.createSourceFile(rel, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let sites = 0;
  let done = 0;
  const missing = [];

  const visit = (node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "t" &&
      node.arguments.length >= 1 &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      const raw = node.arguments[0].text;
      const key = SYMBOLIC_KEY.test(raw) ? raw : normalize(raw);
      sites += 1;
      if (known.has(key)) done += 1;
      else missing.push(key);
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sf, visit);

  if (sites === 0) continue;
  totalSites += sites;
  totalDone += done;
  rows.push({ file: rel, sites, done, pct: Math.round((100 * done) / sites), missing });
}

rows.sort((a, b) => a.pct - b.pct || b.sites - a.sites);

console.log(`Per-file ${LOCALE} coverage\n`);
console.log("  pct   done/sites  file");
for (const row of rows) {
  if (row.pct < MIN) continue;
  console.log(
    `  ${String(row.pct).padStart(3)}%  ${String(`${row.done}/${row.sites}`).padStart(10)}  ${row.file}`,
  );
}

console.log(
  `\nTotal: ${totalDone}/${totalSites} render sites translated ` +
    `(${Math.round((100 * totalDone) / Math.max(1, totalSites))}%) across ${rows.length} files`,
);

const incomplete = rows.filter((r) => r.pct < 100);
if (incomplete.length > 0) {
  console.log(`\n${incomplete.length} file(s) below 100%:`);
  for (const row of incomplete) {
    console.log(`  ${row.file}`);
    for (const phrase of [...new Set(row.missing)].slice(0, 6)) {
      console.log(`      ${JSON.stringify(phrase)}`);
    }
  }
}
