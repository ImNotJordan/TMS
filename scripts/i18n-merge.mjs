#!/usr/bin/env node
/**
 * Merge a batch of translations into a locale's phrase table.
 *
 * Translations are authored as JSON (`{"English": "译文"}`) and merged here
 * rather than hand-edited into the TypeScript file. Two reasons: the table is
 * ~2,000 entries and an editor round-trip risks a stray comma somewhere in the
 * middle of it, and merging lets a batch be re-run idempotently — a re-translated
 * phrase replaces the old value instead of producing a duplicate key that the
 * later one silently wins.
 *
 * Existing entries are preserved unless the batch overrides them, and the output
 * is written sorted so the diff of adding twenty phrases is twenty lines rather
 * than a reshuffle.
 *
 * Usage:
 *   node scripts/i18n-merge.mjs .i18n-batch.json
 *   node scripts/i18n-merge.mjs .i18n-batch.json --locale zh-CN
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const batchPath = args.find((a) => !a.startsWith("--"));
const localeIndex = args.indexOf("--locale");
const LOCALE = localeIndex >= 0 ? args[localeIndex + 1] : "zh-CN";

if (!batchPath) {
  console.error("Usage: node scripts/i18n-merge.mjs <batch.json> [--locale zh-CN]");
  process.exit(1);
}

const TABLE_PATH = join(ROOT, `src/lib/i18n/phrases.${LOCALE}.ts`);
const EXPORT_NAME = `${LOCALE.replace("-", "_").toUpperCase()}_PHRASES`;

const HEADER = `/**
 * Simplified Chinese phrase table.
 *
 * Keys are the exact English strings the UI renders; see \`phrases.ts\` for the
 * glossary these follow and why consistency there matters more than elegance.
 *
 * Maintained through \`scripts/i18n-merge.mjs\` rather than by hand — at this size
 * a manual edit in the middle of the object is how a trailing comma ships. Run
 * \`node scripts/i18n-phrases.mjs\` for current coverage and what is outstanding.
 *
 * Sorted by key so adding a batch produces a diff of new lines rather than a
 * reshuffle of existing ones.
 */
export const ${EXPORT_NAME}: Record<string, string> = {
`;

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

/** Read the current table with the compiler API — never a regex over quotes. */
function readTable() {
  let source;
  try {
    source = readFileSync(TABLE_PATH, "utf8");
  } catch {
    return {};
  }
  const sf = ts.createSourceFile(
    TABLE_PATH,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const table = {};
  const visit = (node) => {
    if (ts.isPropertyAssignment(node) && ts.isStringLiteral(node.initializer)) {
      const key = propertyName(node, ts);
      if (key !== null) table[key] = node.initializer.text;
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sf, visit);
  return table;
}

const existing = readTable();
const batch = JSON.parse(readFileSync(join(ROOT, batchPath), "utf8"));

let added = 0;
let changed = 0;
let unchanged = 0;
for (const [english, translated] of Object.entries(batch)) {
  if (typeof translated !== "string" || translated.trim() === "") continue;
  if (!(english in existing)) added += 1;
  else if (existing[english] !== translated) changed += 1;
  else unchanged += 1;
  existing[english] = translated;
}

const keys = Object.keys(existing).sort((a, b) => a.localeCompare(b, "en"));
const body = keys
  .map((key) => `  ${JSON.stringify(key)}: ${JSON.stringify(existing[key])},`)
  .join("\n");

const source = `${HEADER}${body}\n};\n`;

/**
 * Format the generated file the way the repo formats everything else.
 *
 * Without this the two tools fight: one entry per line puts a few hundred of
 * them past `printWidth`, so every merge leaves the table lint-dirty and every
 * `npm run format` rewraps it — then the next merge unwraps it again. Neither
 * side is wrong; the generator just has to agree with the formatter.
 *
 * Prettier's own config is resolved rather than assumed, which matters here
 * specifically: `.prettierrc` carries a `quoteProps: "consistent"` override for
 * these tables, and hardcoding options would drop it and strip the quotes from
 * every key that happens to be a valid identifier. That is silent data loss —
 * this script reads keys back through the TypeScript AST, and an unquoted key
 * changes what the phrase *is*.
 *
 * Wrapping itself is safe: verified round-trip lossless at 2,150 entries.
 */
async function formatted(code) {
  try {
    const prettier = await import("prettier");
    const options = (await prettier.resolveConfig(TABLE_PATH)) ?? {};
    return await prettier.format(code, { ...options, parser: "typescript" });
  } catch (err) {
    // Written unformatted rather than not at all — the translations are the
    // point, and `npm run format` will settle the whitespace.
    console.warn(
      `Warning: could not format with Prettier (${err instanceof Error ? err.message : err}). ` +
        "Wrote unformatted output; run `npm run format`.",
    );
    return code;
  }
}

writeFileSync(TABLE_PATH, await formatted(source), "utf8");

console.log(`${LOCALE}: +${added} new, ${changed} updated, ${unchanged} unchanged`);
console.log(`Table now holds ${keys.length} phrases.`);
