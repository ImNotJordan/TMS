/**
 * Statutory rate data for per-load tax estimation.
 *
 * Every entry carries an `effectiveFrom` and a source, because a tax rate
 * without a date is not data — it is a number someone remembered. The estimator
 * reports which snapshot it used so a figure produced today can be explained
 * six months from now.
 *
 * ## Why this file is small on the US side and detailed on the China side
 *
 * The two regimes are not symmetrical, and pretending otherwise is the main way
 * a freight tax feature ends up wrong:
 *
 * - **China levies VAT on the transportation service itself.** The rate is
 *   statutory, uniform nationwide, and there are three of them. A table is the
 *   correct representation, and the arithmetic is fully determinable from the
 *   load.
 * - **The United States has no VAT and no federal sales tax.** Interstate
 *   freight is not a taxable sale in the ordinary case, so the honest answer for
 *   most US loads is *zero* sales tax. What actually costs a US carrier money
 *   per mile is fuel tax under IFTA, which is a quarterly, per-jurisdiction
 *   apportionment — not a line item on a load.
 *
 * So this file encodes China's rates exactly, and for the US encodes only what
 * is genuinely uniform, marking the rest `unknown` rather than inventing a
 * fifty-state matrix of service-taxability that would be stale within a quarter.
 * `unknown` routes the caller to a licensed provider — see `tax-providers`.
 */

/** Bumped whenever any rate below changes. Stamped onto every estimate. */
export const TAX_RATE_SNAPSHOT = "2026-08-20";

/* ------------------------------------------------------------------ *
 * China
 * ------------------------------------------------------------------ */

/**
 * VAT rates under the PRC VAT Law, effective 1 January 2026.
 *
 * The Law (passed 25 December 2024) lifted VAT from State Council regulation to
 * national statute and kept the existing three-tier structure — 13% / 9% / 6% —
 * so these rates are a continuation rather than a change. What changed is that
 * they are now legislated, which is why this snapshot cites the Law rather than
 * the older circulars.
 *
 * Source: PRC VAT Law, effective 2026-01-01. EY tax alert, "China officially
 * enacts VAT law"; vatcalc.com "China VAT law 2026".
 */
export const CHINA_VAT_RATES = {
  /**
   * 交通运输服务 — transportation services. The rate that applies when the
   * company actually carries the freight, or contracts as the carrier of record.
   */
  transportation: 0.09,
  /**
   * 物流辅助服务 — logistics auxiliary services: freight forwarding, agency,
   * warehousing, loading and unloading.
   *
   * The distinction is worth money and is decided by the contract, not the
   * activity: an agent arranging carriage bills 6%, a carrier of record bills 9%.
   * A broker that has never made the determination is usually assuming the wrong
   * one.
   */
  logisticsAuxiliary: 0.06,
  /** 货物 — tangible goods, for the freight-inclusive-in-goods-sale case. */
  goods: 0.13,
  /**
   * 小规模纳税人征收率 — small-scale taxpayer levy rate.
   *
   * A levy rate, not a VAT rate: a small-scale taxpayer charges this and takes
   * no input credit at all, which is why `netVatPayable` for them equals their
   * output tax. Periodic relief has cut it to 1% in some years; the statutory
   * figure is 3%.
   */
  smallScaleLevy: 0.03,
  /**
   * Qualifying international transportation is zero-rated rather than exempt,
   * and the difference matters: zero-rating preserves the input credit, while
   * exemption forfeits it.
   */
  internationalTransportZeroRated: 0,
} as const;

/**
 * VAT surcharges (附加税费), levied on the VAT *actually payable* — not on
 * revenue, and not on output VAT before credits.
 *
 * This is the detail most spreadsheets get wrong. Surcharges follow the net
 * figure, so an input credit reduces them too; a load that nets to zero VAT
 * carries zero surcharge.
 */
export const CHINA_VAT_SURCHARGES = {
  /**
   * 城市维护建设税 — Urban Maintenance and Construction Tax. The rate depends on
   * where the taxpayer is registered, not where the freight moves.
   */
  urbanConstruction: { city: 0.07, county: 0.05, other: 0.01 },
  /** 教育费附加 — Education Surcharge. */
  education: 0.03,
  /** 地方教育附加 — Local Education Surcharge. */
  localEducation: 0.02,
} as const;

export type ChinaSurchargeTier = keyof typeof CHINA_VAT_SURCHARGES.urbanConstruction;

/* ------------------------------------------------------------------ *
 * United States
 * ------------------------------------------------------------------ */

/**
 * How a state treats a separately-stated charge for *transportation services*
 * on an intrastate movement.
 *
 * Deliberately incomplete. Only entries that are well-settled and widely
 * documented are listed; everything else resolves to `unknown`, which the UI
 * surfaces as "connect a tax provider" rather than as zero. A fabricated
 * fifty-state matrix would be confidently wrong somewhere, and the place it was
 * wrong would be the state you operate in.
 *
 * Two rules do the real work and are handled in `tax-domain`, not here:
 *
 * 1. **Interstate movement** — not a taxable sale of services in the ordinary
 *    case. This is the situation for most brokered freight.
 * 2. **Freight bundled into a taxable sale of goods** — follows the goods and
 *    becomes taxable. That is a shipper's problem, not a carrier's, and this
 *    estimator does not model it.
 *
 * Source: state revenue departments; Avalara "Understanding freight
 * taxability"; J.J. Keller sales-tax state comparison. Verify against your own
 * nexus before relying on it.
 */
export type IntrastateTreatment = "exempt" | "taxable" | "unknown";

export const US_INTRASTATE_TRANSPORT_TREATMENT: Record<string, IntrastateTreatment> = {
  // No general sales tax at all, so nothing to levy on a freight charge.
  DE: "exempt",
  MT: "exempt",
  NH: "exempt",
  OR: "exempt",
  AK: "exempt",
  // Separately-stated transportation of property is not a taxable service.
  CA: "exempt",
  TX: "exempt",
  IL: "exempt",
  GA: "exempt",
  FL: "exempt",
  // Broad services base that reaches intrastate transportation.
  HI: "taxable",
  NM: "taxable",
  SD: "taxable",
  WV: "taxable",
};

/**
 * Weight-distance and highway-use taxes that are charged per mile *in addition*
 * to fuel tax.
 *
 * Listed so the estimator can say what it is leaving out. Computing them needs
 * miles driven inside each state, which a load record does not carry — see the
 * limitation note in `tax-domain`.
 */
export const US_WEIGHT_DISTANCE_STATES = ["KY", "NM", "NY", "OR"] as const;

/**
 * Blended IFTA diesel rate, US dollars per gallon, for a rough per-load fuel
 * tax estimate.
 *
 * A single blended figure is a deliberate simplification and the estimate is
 * labelled as one. Real IFTA is settled quarterly against miles run in each of
 * 58 jurisdictions at rates from roughly $0.19 to $0.97 per gallon; no single
 * number reproduces that, and a load record holds total distance rather than a
 * per-state breakdown. What this figure is good for is order of magnitude —
 * telling an operator that fuel tax on a lane is tens of dollars rather than
 * hundreds — which is the question a pricing screen actually asks.
 *
 * Source: IFTA, Inc. quarterly tax matrix (iftach.org), Q3 2026 matrix.
 */
export const IFTA_BLENDED_DIESEL_RATE_USD_PER_GALLON = 0.34;

/** Fleet-average fuel economy used to turn miles into gallons. Configurable per workspace. */
export const DEFAULT_TRUCK_MILES_PER_GALLON = 6.5;

/**
 * Federal Heavy Vehicle Use Tax — Form 2290.
 *
 * Present for completeness and explicitly *not* apportioned to loads: it is an
 * annual per-vehicle tax, so attributing a slice of it to a single shipment
 * would be an allocation choice dressed up as a tax figure.
 */
export const FEDERAL_HVUT_ANNUAL_MAX_USD = 550;

/** Miles per kilometre, for China lanes quoted in kilometres. */
export const KM_PER_MILE = 1.609344;
