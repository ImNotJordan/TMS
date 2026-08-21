#!/usr/bin/env node
/**
 * Wrap user-visible strings in `t(...)` across the app, via the TypeScript AST.
 *
 * ## Why a codemod
 *
 * The app is ~50k lines of TSX across ~90 files, with prose in JSX text, in
 * placeholders and in dialog copy. Hand-editing that is not a translation
 * project, it is a typo generator. Parsing with the compiler API and rewriting
 * exact source ranges is the only version of this that is reviewable, because
 * the edit is provably confined to the nodes matched.
 *
 * ## What it touches, and what it refuses to
 *
 * **JSX text** and a **whitelist of display-only JSX attributes**. Nothing else.
 *
 * It specifically does *not* touch object-literal values, and that omission is
 * the most important safety property in the file. `USER_STATUSES`,
 * `LOAD_STATUS_VALUES`, `MODULES` and friends are string arrays whose values are
 * written to DynamoDB and compared on the server. Translating `"Active"` there
 * would put Chinese in the database and silently break every status comparison
 * in the app. Display-side translation keeps every persisted value English,
 * which is why the translator is phrase-keyed: a render site can call
 * `t(row.status)` without the stored value ever changing.
 *
 * Usage:
 *   node scripts/i18n-wrap.mjs --extract          # report phrases, write nothing
 *   node scripts/i18n-wrap.mjs --extract --json out.json
 *   node scripts/i18n-wrap.mjs --apply            # rewrite files
 *   node scripts/i18n-wrap.mjs --apply --only src/routes/quotes.tsx
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { globSync } from "node:fs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const EXTRACT = args.includes("--extract") || !APPLY;
const jsonIndex = args.indexOf("--json");
const JSON_OUT = jsonIndex >= 0 ? args[jsonIndex + 1] : null;
const onlyIndex = args.indexOf("--only");
const ONLY = onlyIndex >= 0 ? args[onlyIndex + 1] : null;

/**
 * Files excluded, each for a reason:
 *
 * - `components/ui/**` — shadcn primitives. Their only text is `sr-only` labels
 *   inside generic components; wrapping them buys nothing and churns vendored code.
 * - tests — assertions compare against English on purpose.
 * - generated files — overwritten by their generator.
 * - `i18n/**` — the dictionary itself; wrapping it would be circular.
 * - `apps/**` — the driver portal is a separate app with no provider mounted.
 */
const EXCLUDE_PATTERNS = [
  /[\\/]components[\\/]ui[\\/]/,
  /\.test\.tsx?$/,
  /routeTree\.gen\.ts/,
  /[\\/]lib[\\/]i18n[\\/]/,
  /[\\/]components[\\/]settings[\\/]locale-fields\.tsx$/,
];

/**
 * JSX attributes whose string value is shown to a person.
 *
 * Deliberately narrow. `name`, `id`, `type`, `value`, `variant`, `size`, `href`,
 * `to` and `key` are all load-bearing and are never in this list — translating a
 * form field's `name` or a route's `to` would break the form or the link.
 */
const TEXT_ATTRIBUTES = new Set([
  "placeholder",
  "title",
  "alt",
  "aria-label",
  "aria-description",
  "aria-placeholder",
  "tooltip",
  "label",
  "description",
  "subtitle",
  "heading",
  "help",
  "hint",
  "emptyMessage",
  "emptyLabel",
  "helperText",
  "confirmLabel",
  "cancelLabel",
  "actionLabel",
  "buttonLabel",
  "reason",
  "fallback",
]);

/** Entities JSX decodes for you and a JS string literal does not. */
const ENTITIES = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&apos;": "'",
  "&#39;": "'",
  "&nbsp;": " ",
  "&rsquo;": "’",
  "&lsquo;": "‘",
  "&rdquo;": "”",
  "&ldquo;": "“",
  "&mdash;": "—",
  "&ndash;": "–",
  "&hellip;": "…",
  "&times;": "×",
  "&middot;": "·",
};

function decodeEntities(text) {
  return text.replace(/&[a-zA-Z]+;|&#\d+;/g, (match) => ENTITIES[match] ?? match);
}

/**
 * Is this string worth translating?
 *
 * The bar is "a person reads this as language". Rejecting aggressively here is
 * cheaper than reviewing a diff full of `t("—")`.
 */
function isTranslatablePhrase(raw) {
  const text = raw.trim();
  if (text.length < 2) return false;

  // Must contain a letter. Excludes "—", "·", "0", "12.5", "$", "/", "(", ")".
  if (!/[A-Za-z]/.test(text)) return false;

  // Already Chinese, or already a dictionary key.
  if (/[一-鿿]/.test(text)) return false;
  if (/^[a-z]+(\.[a-zA-Z]+)+$/.test(text)) return false;

  // Looks like code rather than prose.
  if (/^https?:\/\//.test(text)) return false;
  if (/^[/@#$]/.test(text)) return false;
  if (/^[A-Z_]+$/.test(text) && text.length < 4) return false;
  if (/[{}<>]/.test(text)) return false;
  if (/^\w+\(\)$/.test(text)) return false;

  // A single lowercase token with no spaces is nearly always an identifier,
  // a css value or a unit — "sm", "outline", "px", "lb".
  if (!/\s/.test(text) && /^[a-z0-9_-]+$/.test(text)) return false;

  // Version strings, ids, hashes.
  if (/^v?\d+(\.\d+)+$/.test(text)) return false;

  // Config and file names that happen to read like words.
  if (/^\.?[a-z]+(\.[a-z]+)+$/i.test(text) && !/\s/.test(text)) return false;

  // Bare acronyms with no lowercase letters and no space — "BLPK", "MC", "DOT".
  // These are the same in both languages, so wrapping them is pure noise.
  if (!/[a-z]/.test(text) && !/\s/.test(text)) return false;

  // Sample data used as placeholder text: emails, hosts, API-key stubs. These
  // are illustrative literals, not language, and translating them would make the
  // example wrong.
  if (/@[a-z0-9.-]+\.[a-z]{2,}/i.test(text)) return false;
  if (/^[a-z0-9-]+(\.[a-z0-9-]+)+\//i.test(text)) return false;
  if (/^sk-/.test(text)) return false;

  // Expressions and identifiers shown as documentation — `min(a, b)`, `itemKey`.
  if (/^[a-z][A-Za-z0-9]*\([^)]*\)$/.test(text)) return false;
  if (/^[a-z]+[A-Z][A-Za-z]*$/.test(text)) return false;

  // Stray connectives left over from mixed content, which `isWholePhrase`
  // catches structurally; this is the belt to that pair of braces.
  if (/^(an?|the|and|or|of|for|to|by|in|on|at|vs\.?|you|your|it|is|are|with)$/i.test(text)) {
    return false;
  }

  return true;
}

function collectFiles() {
  if (ONLY) return [ONLY.split("/").join(sep)];
  const patterns = ["src/**/*.tsx"];
  const files = [];
  for (const pattern of patterns) {
    for (const file of globSync(pattern, { cwd: ROOT })) {
      const full = file;
      if (EXCLUDE_PATTERNS.some((re) => re.test(full))) continue;
      files.push(full);
    }
  }
  return files.sort();
}

/**
 * Does anything in this file bind `t` to something other than the translator?
 *
 * Three files shadowed it with a callback parameter -- `TESTIMONIALS.map((t, i)
 * => ...)` and `tokens.map((t) => ...)`. The wrapped `t("Copy")` inside those
 * scopes then resolved to the loop variable, which TypeScript caught as "this
 * expression is not callable". Cheap to detect here, and much cheaper than
 * finding it by hand again on the next run.
 */
function shadowsT(source) {
  return /\(\s*t\s*[,)]/.test(source) || /\bfor\s*\(\s*const\s+t\b/.test(source);
}

/** Does this file already bind the identifier `t`? */
function alreadyBindsT(source) {
  return (
    /\bconst\s*\{[^}]*\bt\b[^}]*\}\s*=\s*use(T|LocaleSettings)\(/.test(source) ||
    /\bconst\s+t\s*=\s*useT\(\)/.test(source) ||
    /import\s*\{[^}]*\bt\b[^}]*\}\s*from\s*"@\/lib\/i18n\/t"/.test(source)
  );
}

const IMPORT_LINE = 'import { t } from "@/lib/i18n/t";';

function processFile(relPath) {
  const abs = join(ROOT, relPath);
  const source = readFileSync(abs, "utf8");
  const sourceFile = ts.createSourceFile(
    relPath,
    source,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    ts.ScriptKind.TSX,
  );

  /** @type {{start:number,end:number,replacement:string,phrase:string}[]} */
  const edits = [];
  const phrases = new Set();

  const record = (start, end, replacement, phrase) => {
    edits.push({ start, end, replacement, phrase });
    phrases.add(phrase);
  };

  /**
   * Is this text node a whole phrase, or a fragment of a sentence that has
   * inline markup in the middle of it?
   *
   * This is the difference between a translation and word salad. Given
   *
   *     <p>An <strong>admin</strong> can update this.</p>
   *
   * the AST hands us three children, and translating "An" and "can update this."
   * separately produces Chinese that reads as neither. Chinese word order is not
   * English word order, so a per-fragment translation cannot be reassembled.
   *
   * So a fragment is left in English — visibly untranslated, which is honest —
   * rather than machine-assembled into something wrong. Sibling *elements* are
   * tolerated when they are self-closing, because that is the icon-then-label
   * shape (`<Icon /> Save`) where the text really is the whole phrase.
   *
   * Doing this properly for mixed content needs a `<Trans>`-style component with
   * positional placeholders; that is a larger change than this pass, and the
   * fragments it would unlock are a small minority of the copy.
   */
  const isWholePhrase = (textNode) => {
    const parent = textNode.parent;
    if (!parent || !("children" in parent)) return true;

    for (const child of parent.children) {
      if (child === textNode) continue;
      if (ts.isJsxText(child)) {
        // Whitespace-only siblings are an artifact of formatting, not content.
        if (child.getText(sourceFile).trim() !== "") return false;
        continue;
      }
      if (ts.isJsxExpression(child)) {
        // `{" "}` and `{/* comment */}` are layout, not content.
        const inner = child.expression;
        if (!inner) continue;
        if (ts.isStringLiteral(inner) && inner.text.trim() === "") continue;
        return false;
      }
      if (ts.isJsxSelfClosingElement(child)) continue; // icon
      return false; // a real nested element -> mixed content
    }
    return true;
  };

  const visit = (node) => {
    // ---- JSX text -------------------------------------------------------
    if (ts.isJsxText(node)) {
      if (!isWholePhrase(node)) return;
      const raw = node.getText(sourceFile);
      const decoded = decodeEntities(raw);
      const trimmed = decoded.trim();
      if (isTranslatablePhrase(trimmed)) {
        // Preserve the exact surrounding whitespace. JSX trims whitespace that
        // contains a newline and keeps inline spaces, so re-emitting the original
        // run around the expression is behaviour-preserving.
        const rawTrimmed = raw.trim();
        const offset = raw.indexOf(rawTrimmed);
        const before = raw.slice(0, offset);
        const after = raw.slice(offset + rawTrimmed.length);
        record(
          node.getStart(sourceFile),
          node.getEnd(),
          `${before}{t(${JSON.stringify(trimmed)})}${after}`,
          trimmed,
        );
      }
      return;
    }

    // ---- JSX attributes -------------------------------------------------
    if (ts.isJsxAttribute(node) && node.initializer) {
      const name = node.name.getText(sourceFile);
      if (TEXT_ATTRIBUTES.has(name) && ts.isStringLiteral(node.initializer)) {
        const phrase = node.initializer.text;
        if (isTranslatablePhrase(phrase)) {
          record(
            node.initializer.getStart(sourceFile),
            node.initializer.getEnd(),
            `{t(${JSON.stringify(phrase)})}`,
            phrase,
          );
        }
      }
      // Fall through so nested JSX inside an attribute expression is visited.
    }

    ts.forEachChild(node, visit);
  };

  ts.forEachChild(sourceFile, visit);

  if (edits.length === 0) return { relPath, phrases, changed: false };

  // Refuse rather than emit code that will not compile. Rename the local
  // binding, then re-run.
  if (shadowsT(source)) {
    return { relPath, phrases: new Set(), changed: false, shadowed: true };
  }

  if (!APPLY) return { relPath, phrases, changed: true, count: edits.length };

  // Apply back-to-front so earlier offsets stay valid.
  edits.sort((a, b) => b.start - a.start);
  let output = source;
  for (const edit of edits) {
    output = output.slice(0, edit.start) + edit.replacement + output.slice(edit.end);
  }

  if (!alreadyBindsT(output)) {
    // After the final import, so the file keeps one contiguous import block.
    const importMatches = [...output.matchAll(/^import .*?;$/gms)];
    if (importMatches.length > 0) {
      const last = importMatches[importMatches.length - 1];
      const at = last.index + last[0].length;
      output = `${output.slice(0, at)}\n${IMPORT_LINE}${output.slice(at)}`;
    } else {
      output = `${IMPORT_LINE}\n${output}`;
    }
  }

  writeFileSync(abs, output, "utf8");
  return { relPath, phrases, changed: true, count: edits.length };
}

const files = collectFiles();
const allPhrases = new Set();
const shadowed = [];
let changedFiles = 0;
let totalEdits = 0;
const perFile = [];

for (const file of files) {
  try {
    const result = processFile(file);
    for (const phrase of result.phrases) allPhrases.add(phrase);
    if (result.shadowed) {
      shadowed.push(file);
      continue;
    }
    if (result.changed) {
      changedFiles += 1;
      totalEdits += result.count ?? 0;
      perFile.push({ file: relative(ROOT, join(ROOT, file)), count: result.count ?? 0 });
    }
  } catch (err) {
    console.error(`FAILED ${file}: ${err?.message ?? err}`);
    process.exitCode = 1;
  }
}

console.log(
  `${APPLY ? "Rewrote" : "Would rewrite"} ${changedFiles} file(s), ${totalEdits} site(s).`,
);
console.log(`Distinct phrases: ${allPhrases.size}`);

if (shadowed.length > 0) {
  console.log(`
SKIPPED ${shadowed.length} file(s) that bind t to something else:`);
  for (const file of shadowed) console.log(`  ${file}`);
  console.log("Rename the local binding, then re-run.");
}

perFile.sort((a, b) => b.count - a.count);
console.log("\nTop files:");
for (const row of perFile.slice(0, 15)) {
  console.log(`  ${String(row.count).padStart(4)}  ${row.file}`);
}

if (JSON_OUT) {
  mkdirSync(dirname(join(ROOT, JSON_OUT)), { recursive: true });
  writeFileSync(
    join(ROOT, JSON_OUT),
    `${JSON.stringify(
      [...allPhrases].sort((a, b) => a.localeCompare(b)),
      null,
      2,
    )}\n`,
    "utf8",
  );
  console.log(`\nPhrases written to ${JSON_OUT}`);
}
