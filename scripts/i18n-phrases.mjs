#!/usr/bin/env node
/**
 * List every phrase the app passes to `t(...)`, ranked by how often it renders.
 *
 * Companion to `i18n-wrap.mjs`. Once the wrap has been applied there are no bare
 * JSX strings left to extract — the phrases live inside `t("...")` calls — so
 * this is the script that answers "what still needs translating", and the one
 * that reports coverage as it grows.
 *
 * Usage:
 *   node scripts/i18n-phrases.mjs                    # coverage summary
 *   node scripts/i18n-phrases.mjs --json out.json    # ranked list
 *   node scripts/i18n-phrases.mjs --json out.json --missing
 */
import { readFileSync, writeFileSync, globSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const jsonIndex = args.indexOf("--json");
const JSON_OUT = jsonIndex >= 0 ? args[jsonIndex + 1] : null;
const MISSING_ONLY = args.includes("--missing");

/** `action.save` style symbolic keys live in dictionary.ts, not the phrase table. */
const SYMBOLIC_KEY = /^[a-z]+(\.[a-zA-Z]+)+$/;

/**
 * Must match `normalizePhrase` in `src/lib/i18n/phrases.ts`.
 *
 * A JSX text node that wrapped across lines reaches `t()` with its newline and
 * indentation intact, so the runtime normalizes whitespace on both sides of the
 * lookup. Comparing raw strings here reported eight translated phrases as
 * missing *and* as orphaned at the same time — a coverage number that is wrong
 * in both directions is worse than no coverage number.
 */
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

const counts = new Map();

for (const rel of globSync("src/**/*.{ts,tsx}", { cwd: ROOT })) {
  if (/\.test\.tsx?$/.test(rel)) continue;
  if (/[\\/]lib[\\/]i18n[\\/]/.test(rel)) continue;

  const source = readFileSync(join(ROOT, rel), "utf8");
  if (!source.includes("t(")) continue;

  const sf = ts.createSourceFile(rel, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const visit = (node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "t" &&
      node.arguments.length >= 1 &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      const phrase = node.arguments[0].text;
      if (!SYMBOLIC_KEY.test(phrase)) {
        const key = normalize(phrase);
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sf, visit);
}

/**
 * Read the existing table's keys without importing TypeScript at runtime.
 *
 * Parsed with the compiler API rather than a regex: the keys contain quotes,
 * commas and colons, and a regex over them is how a coverage report starts
 * lying.
 */
function translatedKeys() {
  const path = join(ROOT, "src/lib/i18n/phrases.zh-CN.ts");
  const source = readFileSync(path, "utf8");
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

const translated = translatedKeys();

const ranked = [...counts.entries()]
  .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  .map(([phrase, count]) => ({ phrase, count, translated: translated.has(phrase) }));

const missing = ranked.filter((row) => !row.translated);
const doneSites = ranked.filter((r) => r.translated).reduce((sum, r) => sum + r.count, 0);
const allSites = ranked.reduce((sum, r) => sum + r.count, 0);
const pct = (part, whole) => Math.round((100 * part) / Math.max(1, whole));

console.log(`Phrases:  ${ranked.length} distinct, ${allSites} render sites`);
console.log(
  `zh-CN:    ${ranked.length - missing.length} translated ` +
    `(${pct(ranked.length - missing.length, ranked.length)}% of phrases, ` +
    `${pct(doneSites, allSites)}% of render sites)`,
);
console.log(`Missing:  ${missing.length}`);

/**
 * Keys in the table that no *literal* `t("...")` call site references.
 *
 * Not necessarily dead. Strings passed dynamically — `t(note.text)`,
 * `t(line.label)`, `t(field.label)` — are resolved at runtime from data, so a
 * static scan cannot see them even though they are very much in use. Reported as
 * a prompt to check, never as a list to delete.
 */
const orphans = [...translated].filter((key) => !counts.has(key));
if (orphans.length > 0) {
  console.log(
    `Unreferenced: ${orphans.length} translated with no literal call site ` +
      "(expected for strings passed dynamically, e.g. domain notes and data-driven labels)",
  );
}

if (JSON_OUT) {
  const payload = MISSING_ONLY ? missing : ranked;
  writeFileSync(join(ROOT, JSON_OUT), `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log(`\nWritten to ${JSON_OUT}`);
}
