/**
 * Per-load tax estimation. Pure, deterministic, no network.
 *
 * ## The question this answers, and the one it refuses to
 *
 * It answers: *given this load's rates and lane, roughly what indirect tax will
 * this movement cost us?* It does not file, remit, or advise. Every result
 * carries `confidence` and `notes`, and the UI never renders a figure without
 * them — a tax number with no provenance is the kind of thing that ends up in a
 * customer quote and then in an argument.
 *
 * ## Why the two regimes are modelled separately
 *
 * Not a style choice — they answer different arithmetic.
 *
 * **China** taxes the transportation service. The interesting number is not 9%
 * of revenue; it is output VAT *minus* the input credit on the purchased
 * carriage. A broker buying at ¥8,000 and selling at ¥10,000 owes VAT on the
 * ¥2,000 of value it added, not on the ¥10,000 it invoiced — *provided* the
 * carrier issues a special VAT invoice (增值税专用发票). If the carrier cannot,
 * the credit vanishes and the same load costs roughly four times as much in tax.
 * That single fact is the most valuable thing this module computes, and it is
 * invisible in any model that just multiplies revenue by a rate.
 *
 * **The United States** has no VAT and no federal sales tax, and interstate
 * freight is not a taxable sale of services in the ordinary case. So for most
 * brokered US loads the honest sales-tax answer is zero, and saying so plainly
 * is more useful than a fabricated percentage. What actually costs money per
 * mile is fuel tax under IFTA — which is a quarterly apportionment across the
 * jurisdictions the truck ran through, not a line item on a shipment.
 *
 * ## What it deliberately does not compute
 *
 * - **Exact IFTA.** Needs miles driven inside each of 58 jurisdictions. A load
 *   record holds total distance. The estimate uses a blended rate and says so.
 * - **Weight-distance taxes** (KY, NM, NY, OR). Same missing input. Flagged, not
 *   guessed.
 * - **Income tax.** Not a per-load quantity.
 * - **HVUT.** Annual and per-vehicle; slicing it per load would be an
 *   allocation policy pretending to be a tax.
 * - **Intrastate US taxability outside a short well-settled list.** Returns
 *   `unknown` and points at a provider rather than inventing state law.
 */
import {
  CHINA_VAT_RATES,
  CHINA_VAT_SURCHARGES,
  DEFAULT_TRUCK_MILES_PER_GALLON,
  IFTA_BLENDED_DIESEL_RATE_USD_PER_GALLON,
  KM_PER_MILE,
  TAX_RATE_SNAPSHOT,
  US_INTRASTATE_TRANSPORT_TREATMENT,
  US_WEIGHT_DISTANCE_STATES,
  type ChinaSurchargeTier,
} from "@/lib/tax/tax-rates";
import { manualRateProvenance, type ManualTaxRates } from "@/lib/tax/manual-rates";

/* ------------------------------------------------------------------ *
 * Jurisdiction
 * ------------------------------------------------------------------ */

export type TaxCountry = "US" | "CN" | "UNKNOWN";

/**
 * Chinese province, municipality and autonomous-region codes, plus the common
 * English spellings a US-built form actually receives.
 *
 * Needed because `LoadRecord` has no country field — it stores `pickupState`
 * only. Adding a country column would be cleaner and is the right eventual fix;
 * inferring it means the feature works on the loads already in the table rather
 * than only on ones created after a migration.
 */
const CN_REGION_TOKENS = new Set([
  // Municipalities
  "beijing",
  "bj",
  "北京",
  "shanghai",
  "sh",
  "上海",
  "tianjin",
  "tj",
  "天津",
  "chongqing",
  "cq",
  "重庆",
  // Provinces
  "guangdong",
  "gd",
  "广东",
  "jiangsu",
  "js",
  "江苏",
  "zhejiang",
  "zj",
  "浙江",
  "shandong",
  "sd",
  "山东",
  "henan",
  "ha",
  "河南",
  "sichuan",
  "sc",
  "四川",
  "hubei",
  "hb",
  "湖北",
  "hunan",
  "hn",
  "湖南",
  "hebei",
  "he",
  "河北",
  "fujian",
  "fj",
  "福建",
  "anhui",
  "ah",
  "安徽",
  "liaoning",
  "ln",
  "辽宁",
  "shaanxi",
  "sn",
  "陕西",
  "jiangxi",
  "jx",
  "江西",
  "shanxi",
  "sx",
  "山西",
  "heilongjiang",
  "hl",
  "黑龙江",
  "jilin",
  "jl",
  "吉林",
  "yunnan",
  "yn",
  "云南",
  "guizhou",
  "gz",
  "贵州",
  "gansu",
  "gs",
  "甘肃",
  "hainan",
  "海南",
  "qinghai",
  "qh",
  "青海",
  // Autonomous regions
  "guangxi",
  "gx",
  "广西",
  "xinjiang",
  "xj",
  "新疆",
  "tibet",
  "xz",
  "西藏",
  "ningxia",
  "nx",
  "宁夏",
  "inner mongolia",
  "nei mongol",
  "nm",
  "内蒙古",
  // SARs — separate tax systems; see the note in `resolveCountry`.
  "hong kong",
  "hk",
  "香港",
  "macau",
  "macao",
  "mo",
  "澳门",
  "china",
  "cn",
  "prc",
  "中国",
]);

/** Two-letter codes for US states, DC and the territories a carrier may serve. */
const US_STATE_CODES = new Set([
  "AL",
  "AK",
  "AZ",
  "AR",
  "CA",
  "CO",
  "CT",
  "DE",
  "FL",
  "GA",
  "HI",
  "ID",
  "IL",
  "IN",
  "IA",
  "KS",
  "KY",
  "LA",
  "ME",
  "MD",
  "MA",
  "MI",
  "MN",
  "MS",
  "MO",
  "MT",
  "NE",
  "NV",
  "NH",
  "NJ",
  "NM",
  "NY",
  "NC",
  "ND",
  "OH",
  "OK",
  "OR",
  "PA",
  "RI",
  "SC",
  "SD",
  "TN",
  "TX",
  "UT",
  "VT",
  "VA",
  "WA",
  "WV",
  "WI",
  "WY",
  "DC",
  "PR",
  "VI",
  "GU",
]);

/**
 * Hong Kong and Macau run their own tax systems and levy no VAT, so a movement
 * touching them is not a mainland VAT transaction. Kept distinct rather than
 * folded into `CN`, because folding them in would apply a 9% rate that does not
 * exist there.
 */
const CN_SAR_TOKENS = new Set(["hong kong", "hk", "香港", "macau", "macao", "mo", "澳门"]);

export function isChineseSAR(region: string | undefined | null): boolean {
  if (!region) return false;
  return CN_SAR_TOKENS.has(region.trim().toLowerCase());
}

/**
 * Infer the country a state/province string belongs to.
 *
 * `explicit` short-circuits everything — once a load carries a real country
 * field, or a user corrects the guess, inference stops being consulted.
 */
export function resolveCountry(
  region: string | undefined | null,
  explicit?: TaxCountry,
): TaxCountry {
  if (explicit && explicit !== "UNKNOWN") return explicit;
  const key = region?.trim().toLowerCase();
  if (!key) return "UNKNOWN";

  if (US_STATE_CODES.has(key.toUpperCase())) return "US";
  if (CN_REGION_TOKENS.has(key)) return "CN";
  return "UNKNOWN";
}

/* ------------------------------------------------------------------ *
 * Inputs
 * ------------------------------------------------------------------ */

export type ChinaTaxpayerKind = "general" | "smallScale";

/** What the company is selling, which decides the VAT rate in China. */
export type ChinaServiceKind = "transportation" | "logisticsAuxiliary";

export type TaxEstimateInput = {
  /** What the customer is billed, in the load's currency. */
  customerRate: number;
  /** What the carrier is paid. Drives the China input-VAT credit. */
  carrierRate?: number;
  /** Billed on top of linehaul; taxed the same way as the freight charge. */
  fuelSurcharge?: number;
  accessorialCharges?: number;

  originRegion?: string;
  destinationRegion?: string;
  /** Overrides inference when a load or a user says otherwise. */
  originCountry?: TaxCountry;
  destinationCountry?: TaxCountry;

  /** Total lane distance. Used only for the US fuel-tax estimate. */
  distanceMiles?: number;
  distanceKm?: number;

  /* ---- China settings, from workspace configuration ---- */
  chinaTaxpayerKind?: ChinaTaxpayerKind;
  chinaServiceKind?: ChinaServiceKind;
  /**
   * Whether quoted amounts already include VAT. Chinese contracts are usually
   * written 含税 (inclusive); US rates never are. Defaulted per country rather
   * than globally, because a wrong default here misstates every figure by ~9%.
   */
  amountsIncludeVat?: boolean;
  /** No special VAT invoice from the carrier means no input credit. */
  carrierIssuesSpecialVatInvoice?: boolean;
  /** Creditable input VAT from fuel, tolls, leasing — outside the carrier leg. */
  otherCreditableInputVat?: number;
  chinaSurchargeTier?: ChinaSurchargeTier;

  /* ---- US settings ---- */
  truckMilesPerGallon?: number;
  /**
   * Real per-jurisdiction diesel rate for this lane, supplied by the server from
   * the published IFTA matrix.
   *
   * When present the fuel-tax figure stops being a national blend. Absent, the
   * estimator falls back to the blended constant and labels the line differently
   * — a reader never has to guess which they are looking at.
   */
  iftaRateOverride?: number;
  /** Provenance for the override. Rendered verbatim, never translated. */
  iftaRateSource?: string;

  /* ---- Manual rates, from Settings ---- */
  /**
   * Operator-supplied rates applied to every load.
   *
   * These fill gaps rather than overrule settled determinations: a manual US
   * rate is applied where this module returns `indeterminate`, and *not* where it
   * has a settled exemption, because overriding a known exemption with a typed
   * percentage would charge tax the state does not levy.
   */
  manualRates?: ManualTaxRates;
};

/* ------------------------------------------------------------------ *
 * Output
 * ------------------------------------------------------------------ */

export type TaxLine = {
  /** Stable id, so a UI can key rows and an invoice can reference one. */
  id: string;
  /**
   * Static sentence, safe to pass through `t()`.
   *
   * Interpolated values live in `detail` rather than inside this string. A label
   * built as `` `Fuel tax (${miles} mi)` `` cannot be phrase-translated — every
   * distinct mileage would need its own dictionary entry — so the translatable
   * stem and the data are kept apart.
   */
  label: string;
  /** Interpolated specifics. Rendered verbatim, never translated. */
  detail?: string;
  /** Native-language label, where the tax has one. */
  labelLocal?: string;
  /** Rate applied, as a fraction. Absent when the line is not a simple percentage. */
  rate?: number;
  /** The amount the rate was applied to. */
  basis: number;
  amount: number;
  /** True when this line reduces tax payable — an input credit. */
  credit?: boolean;
};

/**
 * A caveat, split so it can be translated.
 *
 * `text` is a fixed sentence and goes through the dictionary; `detail` carries
 * whatever number or state code the sentence is about and is rendered as-is.
 */
export type TaxNote = { text: string; detail?: string };

export type TaxConfidence =
  /** Statutory rate, determinable arithmetic. */
  | "statutory"
  /** Well-settled rule, but the inputs are inferred. */
  | "estimated"
  /** Needs data or law this module does not have. Do not rely on the number. */
  | "indeterminate";

export type TaxEstimate = {
  country: TaxCountry;
  /** Currency the figures are in. Inferred from the country, not converted. */
  currency: "USD" | "CNY" | "UNKNOWN";
  regime: "china-vat" | "us-no-vat" | "unsupported";
  /** True when origin and destination are in different countries. */
  crossBorder: boolean;
  /** For the US: same state at both ends. Decides freight taxability. */
  intrastate: boolean;

  lines: TaxLine[];
  /** Tax charged to the customer. Money you collect and remit, not a cost. */
  outputTax: number;
  /** Tax recoverable on purchases. */
  inputCredit: number;
  /** What you actually hand over — the number the feature exists to show. */
  netTaxPayable: number;
  /** Levied on `netTaxPayable`, not on revenue. */
  surcharges: number;
  /** `netTaxPayable + surcharges`. The true cash cost of the movement's tax. */
  totalTaxCost: number;

  confidence: TaxConfidence;
  /**
   * True when a rate from Settings actually shaped a figure above.
   *
   * Set from what was *applied*, not from what was configured — a US rate is
   * ignored on an interstate load, and published IFTA rates outrank a manual
   * one. The UI badge reads this, rather than pattern-matching line labels: a
   * heuristic there silently missed the China VAT override, whose line label
   * never changed.
   */
  usesManualRates: boolean;
  /** Plain-language caveats. Always rendered next to the figures. */
  notes: TaxNote[];
  /** Named so a stale figure can be explained later. */
  rateSnapshot: string;
};

/**
 * A caveat. `detail` holds anything interpolated so `text` stays a fixed
 * sentence the dictionary can key on.
 */
function note(text: string, detail?: string): TaxNote {
  return detail === undefined ? { text } : { text, detail };
}

function round(value: number): number {
  // Cents. Tax authorities settle to the minor unit, and float noise
  // accumulating across a thousand loads shows up as a reconciliation break.
  return Math.round((Number.isFinite(value) ? value : 0) * 100) / 100;
}

/**
 * A rate as a percent string, with trailing zeros trimmed.
 *
 * `0.0825` reads as `8.25%` and `0.09` as `9%` rather than `9.000%`. Kept out of
 * a `label` and put in `detail`, because an interpolated number cannot be
 * phrase-translated.
 */
function percentLabel(rate: number): string {
  const percent = rate * 100;
  return `${Number(percent.toFixed(4))}%`;
}

function positive(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

/** Gross revenue the tax applies to: linehaul plus everything billed with it. */
function taxableRevenue(input: TaxEstimateInput): number {
  return (
    positive(input.customerRate) +
    positive(input.fuelSurcharge) +
    positive(input.accessorialCharges)
  );
}

/**
 * Split a gross amount into net and tax.
 *
 * The inclusive branch is why this is a function rather than a multiplication.
 * A ¥10,000 tax-inclusive invoice at 9% carries ¥825.69 of VAT, not ¥900 —
 * `gross × rate/(1+rate)`, not `gross × rate`. Getting this backwards overstates
 * China VAT by about 9% on every load, which is exactly large enough to matter
 * and small enough not to be noticed.
 */
export function splitVat(
  gross: number,
  rate: number,
  inclusive: boolean,
): { net: number; vat: number } {
  if (rate <= 0) return { net: round(gross), vat: 0 };
  if (inclusive) {
    const vat = (gross * rate) / (1 + rate);
    return { net: round(gross - vat), vat: round(vat) };
  }
  return { net: round(gross), vat: round(gross * rate) };
}

/* ------------------------------------------------------------------ *
 * China
 * ------------------------------------------------------------------ */

function estimateChina(input: TaxEstimateInput, crossBorder: boolean): TaxEstimate {
  const notes: TaxNote[] = [];
  const lines: TaxLine[] = [];

  const taxpayer = input.chinaTaxpayerKind ?? "general";
  const serviceKind = input.chinaServiceKind ?? "transportation";
  // Chinese contracts are conventionally tax-inclusive; assuming otherwise
  // inflates every figure. Overridable per workspace.
  const inclusive = input.amountsIncludeVat ?? true;

  const revenue = taxableRevenue(input);

  const manual = input.manualRates?.enabled ? input.manualRates : undefined;
  const manualProvenance = manual ? manualRateProvenance(manual) : "";

  let outputRate: number;
  let rateIsManual = false;
  if (crossBorder) {
    // Qualifying international transportation is zero-rated, which preserves the
    // input credit — materially better than exemption, which forfeits it.
    outputRate = CHINA_VAT_RATES.internationalTransportZeroRated;
    notes.push(
      note(
        "Cross-border movement treated as zero-rated international transportation. " +
          "Zero-rating requires qualifying documentation and, for road transport, the " +
          "appropriate operating permits — confirm eligibility before relying on it.",
      ),
    );
  } else if (taxpayer === "smallScale") {
    outputRate = CHINA_VAT_RATES.smallScaleLevy;
    notes.push(
      note(
        "Small-scale taxpayer levy rate applied. Small-scale taxpayers cannot claim " +
          "input VAT credits, so the carrier leg gives no relief. Periodic relief " +
          "policies have reduced this rate to 1% in some years — check the current notice.",
      ),
    );
  } else if (manual?.chinaVatRate !== undefined) {
    // Deliberately below the cross-border and small-scale branches. Zero-rating
    // is a legal *status* that also preserves the input credit, and the
    // small-scale levy carries its own no-credit rule — replacing either with a
    // typed percentage would change the regime, not just the number.
    outputRate = manual.chinaVatRate;
    rateIsManual = true;
    notes.push(
      note(
        "Output VAT uses the rate entered in Settings rather than the statutory rate for this service classification.",
        `${percentLabel(outputRate)} · ${manualProvenance}`,
      ),
    );
  } else {
    outputRate =
      serviceKind === "logisticsAuxiliary"
        ? CHINA_VAT_RATES.logisticsAuxiliary
        : CHINA_VAT_RATES.transportation;
  }

  const output = splitVat(revenue, outputRate, inclusive);
  lines.push({
    id: "cn-output-vat",
    label: rateIsManual
      ? "Output VAT — manual rate from Settings"
      : serviceKind === "logisticsAuxiliary"
        ? "Output VAT — logistics auxiliary services"
        : "Output VAT — transportation services",
    // Inline, not only in a note. The notes list sits behind a collapsed
    // section, so provenance left there alone is invisible by default — and a
    // rate whose origin is hidden is exactly the thing this feature must not
    // produce. Every other manual path already carries it on the line.
    detail: rateIsManual ? manualProvenance : undefined,
    labelLocal:
      serviceKind === "logisticsAuxiliary"
        ? "销项税额（物流辅助服务）"
        : "销项税额（交通运输服务）",
    rate: outputRate,
    basis: output.net,
    amount: output.vat,
  });

  // ---- Input credit -------------------------------------------------------
  //
  // The number that decides whether this load is cheap or expensive to tax.
  let inputCredit = 0;
  const carrierSpend = positive(input.carrierRate);
  const canCredit = taxpayer === "general";
  const hasInvoice = input.carrierIssuesSpecialVatInvoice ?? true;

  if (carrierSpend > 0 && canCredit && hasInvoice) {
    const carrierLeg = splitVat(carrierSpend, CHINA_VAT_RATES.transportation, inclusive);
    inputCredit += carrierLeg.vat;
    lines.push({
      id: "cn-input-vat-carrier",
      label: "Input VAT credit — purchased carriage",
      labelLocal: "进项税额（购进运输服务）",
      rate: CHINA_VAT_RATES.transportation,
      basis: carrierLeg.net,
      amount: carrierLeg.vat,
      credit: true,
    });
  } else if (carrierSpend > 0 && canCredit && !hasInvoice) {
    notes.push(
      note(
        "No input VAT credit taken: the carrier is not issuing a special VAT invoice (增值税专用发票). This is the single largest driver of tax cost on a brokered load.",
        `Credit forgone: ${splitVat(carrierSpend, CHINA_VAT_RATES.transportation, inclusive).vat.toFixed(2)}`,
      ),
    );
  }

  const otherInput = positive(input.otherCreditableInputVat);
  if (otherInput > 0 && canCredit) {
    inputCredit += otherInput;
    lines.push({
      id: "cn-input-vat-other",
      label: "Input VAT credit — fuel, tolls, leasing",
      labelLocal: "进项税额（燃油、通行费、租赁）",
      basis: otherInput,
      amount: otherInput,
      credit: true,
    });
  }

  inputCredit = round(inputCredit);

  // Excess input VAT carries forward as a credit balance rather than becoming a
  // refund, so the payable figure floors at zero and the surplus is called out.
  const rawNet = round(output.vat - inputCredit);
  const netVat = Math.max(0, rawNet);
  if (rawNet < 0) {
    notes.push(
      note(
        "Input VAT exceeds output VAT. The surplus carries forward as a credit balance against later periods; it is not refunded on a domestic movement.",
        `Surplus: ${Math.abs(rawNet).toFixed(2)}`,
      ),
    );
  }

  // ---- Surcharges ---------------------------------------------------------
  //
  // On VAT *payable*, so a credit reduces these too. Computing them on revenue —
  // the common spreadsheet error — overstates them severalfold.
  const tier = input.chinaSurchargeTier ?? "city";
  const statutorySurchargeRate =
    CHINA_VAT_SURCHARGES.urbanConstruction[tier] +
    CHINA_VAT_SURCHARGES.education +
    CHINA_VAT_SURCHARGES.localEducation;
  // Applied only where there is VAT payable to levy on. With nothing payable the
  // rate changes no figure, so it must not downgrade confidence or light the
  // badge — an estimate labelled less trustworthy for no visible reason is worse
  // than one that says nothing.
  const surchargeIsManual = manual?.chinaSurchargeRate !== undefined && netVat > 0;
  const surchargeRate = manual?.chinaSurchargeRate ?? statutorySurchargeRate;
  // Still on VAT payable, whichever rate is used. A manual rate changes the
  // percentage, never the base — applying it to revenue is the error this
  // module exists to avoid.
  const surcharges = round(netVat * surchargeRate);

  if (netVat > 0) {
    lines.push({
      id: "cn-surcharges",
      label: surchargeIsManual
        ? "VAT surcharges — manual rate from Settings"
        : "VAT surcharges — urban construction and education",
      detail: surchargeIsManual ? `${percentLabel(surchargeRate)} · ${manualProvenance}` : tier,
      labelLocal: "附加税费（城建税、教育费附加、地方教育附加）",
      rate: surchargeRate,
      basis: netVat,
      amount: surcharges,
    });
    notes.push(
      note(
        "Surcharges are levied on VAT payable, not on revenue — an input credit reduces " +
          "them proportionally. Qualifying small and micro enterprises may claim a 50% " +
          "reduction (六税两费) that is not applied here.",
      ),
    );
  }

  notes.push(
    note(
      inclusive
        ? "Amounts are treated as VAT-inclusive (含税), the usual Chinese contract convention."
        : "Amounts are treated as VAT-exclusive; VAT is added on top.",
    ),
  );

  return {
    country: "CN",
    currency: "CNY",
    regime: "china-vat",
    crossBorder,
    intrastate: false,
    lines,
    outputTax: output.vat,
    inputCredit,
    netTaxPayable: netVat,
    surcharges,
    totalTaxCost: round(netVat + surcharges),
    // A hand-entered rate is never "statutory" — the module cannot verify it.
    confidence: crossBorder || rateIsManual || surchargeIsManual ? "estimated" : "statutory",
    usesManualRates: rateIsManual || surchargeIsManual,
    notes,
    rateSnapshot: TAX_RATE_SNAPSHOT,
  };
}

/* ------------------------------------------------------------------ *
 * United States
 * ------------------------------------------------------------------ */

function estimateUnitedStates(input: TaxEstimateInput, crossBorder: boolean): TaxEstimate {
  const notes: TaxNote[] = [];
  const lines: TaxLine[] = [];

  const origin = input.originRegion?.trim().toUpperCase() ?? "";
  const destination = input.destinationRegion?.trim().toUpperCase() ?? "";
  const intrastate = Boolean(origin) && origin === destination;
  const revenue = taxableRevenue(input);

  let confidence: TaxConfidence = "statutory";
  let salesTax = 0;

  // A manual rate is only consulted where this module would otherwise decline to
  // answer. See `manualRates` on the input type for why it does not overrule a
  // settled exemption.
  const manual = input.manualRates?.enabled ? input.manualRates : undefined;
  const manualUsRate = manual?.usTransportRate;
  const manualProvenance = manual ? manualRateProvenance(manual) : "";
  let salesTaxIsManual = false;
  let fuelRateIsManual = false;

  if (crossBorder) {
    notes.push(
      note(
        "Cross-border movement. US freight charges carry no federal sales tax or VAT, " +
          "but the import side may attract customs duty, import VAT and consumption tax " +
          "in the destination country. Those are levied on the goods, not on this freight " +
          "charge, and are not estimated here.",
      ),
    );
  } else if (!intrastate) {
    notes.push(
      note(
        "Interstate movement: a separately-stated charge for interstate freight is not a " +
          "taxable sale of services. No sales or use tax is estimated on the freight charge.",
      ),
    );
  } else {
    const treatment = US_INTRASTATE_TRANSPORT_TREATMENT[origin] ?? "unknown";
    if (treatment === "exempt") {
      notes.push(
        note(
          "Intrastate movement. Separately-stated transportation of property is not taxable in this state, so no sales tax is estimated.",
          origin,
        ),
      );
    } else if (manualUsRate !== undefined) {
      // The gap this fills. Without a rate the estimator returns
      // `indeterminate` here — correct, but unhelpful to an operator who has
      // already looked the rate up. Confidence is `estimated`, never
      // `statutory`: the number is only as good as whoever typed it, and the
      // provenance is carried so a reader can judge that for themselves.
      salesTax = round(revenue * manualUsRate);
      salesTaxIsManual = true;
      confidence = "estimated";
      lines.push({
        id: "us-sales-tax-manual",
        label: "Sales tax on transportation — manual rate from Settings",
        detail: `${origin} @ ${percentLabel(manualUsRate)} · ${manualProvenance}`,
        rate: manualUsRate,
        basis: revenue,
        amount: salesTax,
      });
      notes.push(
        note(
          treatment === "taxable"
            ? "This state does reach transportation services with its sales tax, and the rate applied is the one entered in Settings rather than one this estimator determined. Verify it against the exact origin and destination addresses."
            : "No settled determination is carried for that state, so the rate entered in Settings has been applied. This estimator did not verify that transportation is taxable there at all.",
          origin || undefined,
        ),
      );
    } else if (treatment === "taxable") {
      // Rate intentionally not asserted: state plus local combinations run to
      // thousands of jurisdictions and change constantly. Naming the exposure
      // without inventing a percentage is the honest half of this answer.
      confidence = "indeterminate";
      notes.push(
        note(
          "This state does reach transportation services with its sales tax. The combined state and local rate depends on the exact origin and destination addresses — connect a tax provider for an authoritative rate, or enter a rate under Settings, Tax Estimation. No amount is estimated here rather than guessing one.",
          origin,
        ),
      );
    } else {
      confidence = "indeterminate";
      notes.push(
        note(
          "This estimator does not carry a settled determination for that state, and will not invent one. Connect a tax provider, enter a rate under Settings, Tax Estimation, or confirm with your tax advisor.",
          origin || undefined,
        ),
      );
    }
  }

  // Said out loud rather than left as silence. An operator who set a rate and
  // sees no tax line needs to know the reason is the movement, not the setting.
  //
  // Requires a *known* destination. With the delivery state still blank the
  // movement is undetermined, not interstate, and asserting otherwise would add
  // a second unfounded claim on top of the one the branch above already makes.
  if (
    manualUsRate !== undefined &&
    salesTax === 0 &&
    !crossBorder &&
    !intrastate &&
    Boolean(origin) &&
    Boolean(destination)
  ) {
    notes.push(
      note(
        "The manual transportation tax rate from Settings was not applied: this is an interstate movement, which is not a taxable sale regardless of rate.",
      ),
    );
  }

  // ---- Fuel tax -----------------------------------------------------------
  //
  // The tax that actually costs a US carrier money per mile. An estimate, and
  // labelled as one: real IFTA is settled quarterly against miles run in each of
  // 58 jurisdictions, and a load record holds only total distance.
  const miles =
    positive(input.distanceMiles) ||
    (positive(input.distanceKm) ? positive(input.distanceKm) / KM_PER_MILE : 0);

  let fuelTax = 0;
  if (miles > 0) {
    const mpg = positive(input.truckMilesPerGallon) || DEFAULT_TRUCK_MILES_PER_GALLON;
    const gallons = miles / mpg;
    // Precedence: the published matrix, then a manual rate, then the national
    // blend.
    //
    // Live beats manual deliberately. The manual field is one number typed by
    // hand; the live figure is the per-jurisdiction rate for *this lane*, pulled
    // from the same iftach.org matrix the operator would have consulted. It is
    // the better version of what they asked for, not a disregard of it — and the
    // note below says so explicitly, so a set-but-unused rate never looks like a
    // setting that silently failed.
    const liveRate = positive(input.iftaRateOverride);
    const manualFuelRate = positive(manual?.iftaRateUsdPerGallon);
    const appliedRate = liveRate || manualFuelRate || IFTA_BLENDED_DIESEL_RATE_USD_PER_GALLON;
    const rateOrigin = liveRate ? "live" : manualFuelRate ? "manual" : "blended";
    fuelRateIsManual = rateOrigin === "manual";
    fuelTax = round(gallons * appliedRate);
    lines.push({
      id: "us-ifta-fuel-tax",
      label:
        rateOrigin === "live"
          ? "Fuel tax — published IFTA jurisdiction rates"
          : rateOrigin === "manual"
            ? "Fuel tax — manual IFTA rate from Settings"
            : "Fuel tax estimate — IFTA blended rate",
      detail:
        rateOrigin === "manual"
          ? `${Math.round(miles).toLocaleString()} mi @ ${mpg} mpg · ${manualProvenance}`
          : `${Math.round(miles).toLocaleString()} mi @ ${mpg} mpg`,
      rate: appliedRate,
      basis: round(gallons),
      amount: fuelTax,
    });
    if (confidence === "statutory") confidence = "estimated";
    if (liveRate && manualFuelRate) {
      notes.push(
        note(
          "The manual IFTA rate from Settings was not used: published per-jurisdiction rates were available for this lane, which are more specific than a single hand-entered figure.",
          `Settings rate: $${manualFuelRate.toFixed(4)}/gal · applied: $${appliedRate.toFixed(4)}/gal`,
        ),
      );
    }
    notes.push(
      rateOrigin === "manual"
        ? note(
            "Fuel tax uses the per-gallon rate entered in Settings, applied across the whole lane. Real IFTA is settled quarterly against miles actually run in each jurisdiction, so this remains an estimate.",
            manualProvenance,
          )
        : liveRate
          ? note(
              "Fuel tax uses the published IFTA rates for this lane's jurisdictions rather than a " +
                "national average. Mileage apportionment is still an assumption — real IFTA is " +
                "settled quarterly against miles actually run in each jurisdiction.",
              input.iftaRateSource,
            )
          : note(
              "Fuel tax is a blended-rate estimate, not an IFTA figure. Actual liability is " +
                "apportioned quarterly across the jurisdictions the truck ran through, at rates " +
                "from about $0.19 to $0.97 per gallon. Use it for order of magnitude in pricing, " +
                "never for filing.",
            ),
    );

    const weightDistance = [origin, destination].filter((state) =>
      (US_WEIGHT_DISTANCE_STATES as readonly string[]).includes(state),
    );
    if (weightDistance.length > 0) {
      notes.push(
        note(
          "This lane touches a state levying a weight-distance or highway-use tax on top of fuel tax. It depends on miles run inside the state and registered weight, neither of which this load carries, so it is excluded.",
          weightDistance.join(", "),
        ),
      );
    } else {
      notes.push(
        note(
          "Any weight-distance tax for states the route passes through (KY, NM, NY, OR) is " +
            "excluded — the route's per-state mileage is not known from the load.",
        ),
      );
    }
  } else {
    notes.push(
      note(
        "No lane distance on this load, so no fuel tax is estimated. Fuel tax is normally " +
          "the largest per-load tax cost for a US carrier.",
      ),
    );
  }

  notes.push(
    note(
      "Annual obligations are excluded by design: Heavy Vehicle Use Tax (Form 2290) is " +
        "per vehicle per year, and income tax is not a per-load quantity. Apportioning " +
        "either to a shipment would be an allocation policy, not a tax figure.",
    ),
  );

  // Sales tax is money collected from the customer and remitted; fuel tax is a
  // cost the carrier bears. Only the second belongs in "what will this cost us",
  // which is why they are added into different fields.
  //
  // `totalTaxCost` therefore excludes sales tax. That mattered not at all while
  // this branch could only ever produce zero, and matters a great deal now that
  // a rate from Settings can make it non-zero: the panel headlines this field as
  // "tax you bear", and adding collected-and-remitted tax to it would overstate
  // the cost of the load by the entire sales tax amount.
  if (salesTax > 0) {
    notes.push(
      note(
        "Sales tax is billed to the customer and remitted, so it is excluded from the tax you bear. It is shown as a line above because you still have to collect and remit it.",
      ),
    );
  }

  return {
    country: "US",
    currency: "USD",
    regime: "us-no-vat",
    crossBorder,
    intrastate,
    lines,
    outputTax: salesTax,
    inputCredit: 0,
    netTaxPayable: salesTax,
    surcharges: 0,
    totalTaxCost: round(fuelTax),
    confidence,
    // Only true where a manual rate reached a figure: the sales-tax branch fired,
    // or the fuel line actually used the manual rate.
    usesManualRates: salesTaxIsManual || fuelRateIsManual,
    notes,
    rateSnapshot: TAX_RATE_SNAPSHOT,
  };
}

/* ------------------------------------------------------------------ *
 * Entry point
 * ------------------------------------------------------------------ */

export function estimateLoadTax(input: TaxEstimateInput): TaxEstimate {
  const originCountry = resolveCountry(input.originRegion, input.originCountry);
  const destinationCountry = resolveCountry(input.destinationRegion, input.destinationCountry);

  // Origin governs: the service is supplied where the carriage begins, which is
  // the jurisdiction whose rules apply to the sale. Fall back to destination so
  // a load with only one end filled in still produces something.
  const country = originCountry !== "UNKNOWN" ? originCountry : destinationCountry;
  const crossBorder =
    originCountry !== "UNKNOWN" &&
    destinationCountry !== "UNKNOWN" &&
    originCountry !== destinationCountry;

  if (isChineseSAR(input.originRegion) || isChineseSAR(input.destinationRegion)) {
    return {
      country: "UNKNOWN",
      currency: "UNKNOWN",
      regime: "unsupported",
      crossBorder,
      intrastate: false,
      lines: [],
      outputTax: 0,
      inputCredit: 0,
      netTaxPayable: 0,
      surcharges: 0,
      totalTaxCost: 0,
      confidence: "indeterminate",
      usesManualRates: false,
      notes: [
        note(
          "Hong Kong and Macau operate separate tax systems and levy no VAT, so mainland China VAT rules do not apply to this movement. Not estimated.",
        ),
      ],
      rateSnapshot: TAX_RATE_SNAPSHOT,
    };
  }

  if (country === "CN") return estimateChina(input, crossBorder);
  if (country === "US") return estimateUnitedStates(input, crossBorder);

  return {
    country: "UNKNOWN",
    currency: "UNKNOWN",
    regime: "unsupported",
    crossBorder: false,
    intrastate: false,
    lines: [],
    outputTax: 0,
    inputCredit: 0,
    netTaxPayable: 0,
    surcharges: 0,
    totalTaxCost: 0,
    confidence: "indeterminate",
    usesManualRates: false,
    notes: [
      note(
        "Could not determine a tax jurisdiction from this load's origin or destination. Set the pickup and delivery state or province — the estimator supports the United States and mainland China.",
      ),
    ],
    rateSnapshot: TAX_RATE_SNAPSHOT,
  };
}

/**
 * Effective tax rate against gross revenue.
 *
 * Reported because it is the figure an operator can sanity-check. A China
 * brokered load with a compliant carrier invoice lands near 1–2% of revenue, not
 * 9 — and seeing that on screen is what makes the input-credit mechanism
 * legible.
 */
export function effectiveTaxRate(estimate: TaxEstimate, grossRevenue: number): number | null {
  if (!Number.isFinite(grossRevenue) || grossRevenue <= 0) return null;
  return estimate.totalTaxCost / grossRevenue;
}

/** Parse the string-typed money fields on `LoadRecord` without inventing zeros. */
export function parseMoney(value: string | number | undefined | null): number | undefined {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value !== "string") return undefined;
  const cleaned = value.replace(/[^0-9.-]/g, "").trim();
  if (!cleaned) return undefined;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : undefined;
}
