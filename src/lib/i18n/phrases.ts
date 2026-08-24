/**
 * Phrase table: English UI string → translation.
 *
 * Generated-shaped but hand-authored. `scripts/i18n-wrap.mjs --extract` lists
 * every phrase the app renders; the translations here are written and reviewed
 * rather than machine-produced, because freight vocabulary is where machine
 * translation reliably goes wrong. "Load" is 货运订单 (a shipment), not 负载
 * (a load in the electrical sense); "Detention" is 滞留费, not 拘留.
 *
 * ## Glossary — keep these consistent
 *
 * | English            | Chinese      | Note                                  |
 * | ------------------ | ------------ | ------------------------------------- |
 * | Load               | 货运订单     | a shipment, never 负载                |
 * | Carrier            | 承运商       |                                       |
 * | Broker             | 经纪商       |                                       |
 * | Shipper            | 托运人       |                                       |
 * | Dispatcher         | 调度员       |                                       |
 * | Lane               | 运输线路     |                                       |
 * | TruckBoard         | 车源看板     |                                       |
 * | Bid / Bidding      | 报价 / 竞标  |                                       |
 * | Quote              | 报价单       |                                       |
 * | RFP                | 招标书       |                                       |
 * | BOL                | 提单         | bill of lading                        |
 * | POD                | 签收单       | proof of delivery                     |
 * | Detention          | 滞留费       |                                       |
 * | Deadhead           | 空驶         |                                       |
 * | Reefer             | 冷藏车       |                                       |
 * | Dry Van            | 干货厢车     |                                       |
 * | Flatbed            | 平板车       |                                       |
 * | Hazmat             | 危险品       |                                       |
 * | Pallet             | 托盘         |                                       |
 * | On hand            | 现有库存     |                                       |
 * | Allocated          | 已分配       |                                       |
 * | Invoice            | 发票         |                                       |
 * | Accessorial        | 附加费       |                                       |
 * | Fuel surcharge     | 燃油附加费   |                                       |
 *
 * ## Missing entries are fine
 *
 * `t()` returns the English unchanged when a phrase is absent, so this file can
 * grow incrementally and an untranslated screen is partly English rather than
 * broken. Run `node scripts/i18n-wrap.mjs --extract --json .i18n-phrases.json`
 * and diff against `Object.keys` here to see what is still outstanding.
 */
import { DEFAULT_LOCALE, type LocaleCode } from "@/lib/i18n/locales";
import { ZH_CN_PHRASES } from "@/lib/i18n/phrases.zh-CN";

export type PhraseTable = Record<string, string>;

/**
 * Only non-default locales appear here. English is the key space, so an
 * `en-US` table would map every phrase to itself for no benefit.
 */
const PHRASE_TABLES: Partial<Record<LocaleCode, PhraseTable>> = {
  "zh-CN": ZH_CN_PHRASES,
};

/**
 * Whitespace inside JSX text is a formatting artifact — the same phrase can
 * arrive as `"Save changes"` from one file and `"Save  changes"` from another
 * after a prettier reflow. Normalizing on lookup means the table holds one entry
 * rather than one per line-break position.
 */
function normalize(phrase: string): string {
  return phrase.replace(/\s+/g, " ").trim();
}

const normalizedCache = new Map<LocaleCode, PhraseTable>();

function normalizedTable(locale: LocaleCode): PhraseTable {
  const cached = normalizedCache.get(locale);
  if (cached) return cached;

  const source = PHRASE_TABLES[locale] ?? {};
  const table: PhraseTable = {};
  for (const [english, translated] of Object.entries(source)) {
    table[normalize(english)] = translated;
  }
  normalizedCache.set(locale, table);
  return table;
}

/** `undefined` when this locale has no translation for the phrase. */
export function lookupPhrase(locale: LocaleCode, phrase: string): string | undefined {
  if (locale === DEFAULT_LOCALE) return undefined;
  return normalizedTable(locale)[normalize(phrase)];
}

/** Coverage, for the test and for reporting progress. */
export function phraseCoverage(locale: LocaleCode): number {
  return Object.keys(PHRASE_TABLES[locale] ?? {}).length;
}

export { normalize as normalizePhrase };
