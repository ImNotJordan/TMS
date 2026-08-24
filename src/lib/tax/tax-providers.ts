/**
 * The catalogue of external tax engines, and what each is actually good for.
 *
 * ## Why there is a seam here at all
 *
 * `tax-domain` deliberately returns `indeterminate` for US intrastate freight
 * outside a short well-settled list, because a combined state-and-local rate
 * depends on exact addresses across thousands of taxing jurisdictions that
 * change every quarter. Nobody should maintain that table by hand, and a
 * hand-maintained version is worse than none — it is wrong silently.
 *
 * That is precisely the problem the commercial engines solve, and the only part
 * of this feature worth paying for. So the internal engine answers everything it
 * can determine from statute, and this seam exists for the residue.
 *
 * ## Why the internal engine is the default and not a fallback
 *
 * For the two cases that motivated the feature it is not merely adequate, it is
 * better:
 *
 * - **China VAT** is a statutory 9% / 6% / 3% with an input-credit mechanism.
 *   The arithmetic is fully determinable and the interesting figure — output VAT
 *   net of the credit on purchased carriage — is a modelling decision, not a
 *   rate lookup. An external engine returns the output tax and knows nothing
 *   about your carrier's invoice.
 * - **US interstate freight** is not a taxable sale. The correct answer is zero,
 *   and paying per transaction to be told zero is a poor trade.
 *
 * So a provider is an upgrade for a specific gap, never a prerequisite.
 *
 * ## Keys never reach the browser
 *
 * Every adapter is invoked server-side through `tax-proxy`, with the credential
 * read from the WorkspaceSettings `secrets` partition — the same arrangement as
 * the OpenAI and Google Maps keys. An engine that quotes tax is also an engine
 * that can post transactions to a filing account; its key is not a public value.
 */

export type TaxProviderId = "internal" | "avalara" | "stripe-tax" | "vertex" | "fonoa";

export type TaxProviderCapability =
  | "us-sales-tax"
  | "us-fuel-tax"
  | "china-vat"
  | "global-vat"
  | "filing"
  | "einvoicing";

export type TaxProviderSpec = {
  id: TaxProviderId;
  name: string;
  /** One line on what it is for. Rendered in Settings. */
  summary: string;
  capabilities: TaxProviderCapability[];
  /** Env / secrets key the server reads. Null for the built-in engine. */
  secretKey: string | null;
  docsUrl: string | null;
  /** Honest note on cost, so the choice is not made blind. */
  commercials: string;
  /**
   * True when the adapter has been exercised against a live account. Written
   * down because "implemented" and "verified" are different states, and a tax
   * integration is a bad place to blur them.
   */
  verified: boolean;
};

export const TAX_PROVIDERS: TaxProviderSpec[] = [
  {
    id: "internal",
    name: "Built-in estimator",
    summary:
      "Statutory China VAT with input-credit netting, US interstate/intrastate determination, " +
      "and fuel tax from the published per-jurisdiction IFTA matrix. No account, no " +
      "per-transaction cost.",
    capabilities: ["china-vat", "us-fuel-tax"],
    secretKey: null,
    docsUrl: null,
    commercials: "Included. No external calls.",
    verified: true,
  },
  {
    id: "avalara",
    name: "Avalara AvaTax",
    summary:
      'The recommended external engine for this app. Publishes FR020100 — "shipping only, ' +
      'common carrier, FOB destination" — which is the actual classification for brokered ' +
      "truckload freight, plus address-level rooftop determination for US state and local tax.",
    capabilities: ["us-sales-tax", "global-vat", "china-vat", "filing"],
    secretKey: "AVALARA_ACCOUNT_KEY",
    docsUrl: "https://developer.avalara.com/avalara-apis/",
    commercials:
      "Paid, per-transaction with an annual commitment. Sales-led; expect a quote rather " +
      "than a price page. The right choice if US intrastate freight is a real part of the book.",
    verified: false,
  },
  {
    id: "stripe-tax",
    name: "Stripe Tax",
    summary:
      "Not recommended for freight. Checked against Stripe's published tax-code list: there " +
      "is no code for shipping, freight or transportation. The nearest is txcd_20030000 " +
      '"General services", which is itself a guess about how a state treats freight — the ' +
      "exact thing a tax engine is supposed to remove. Fine for goods and SaaS, wrong tool here.",
    capabilities: ["us-sales-tax", "global-vat", "filing"],
    secretKey: "STRIPE_SECRET_KEY",
    docsUrl: "https://docs.stripe.com/tax/tax-codes",
    commercials:
      "Subscription tiers. Cheap, but the saving is not worth classifying freight as a " +
      "generic service.",
    verified: false,
  },
  {
    id: "fonoa",
    name: "Fonoa",
    summary:
      "API-first global indirect tax with China coverage and e-invoicing. Strong fit if " +
      "fapiao issuance matters as much as calculation.",
    capabilities: ["global-vat", "china-vat", "einvoicing", "filing"],
    secretKey: "FONOA_API_KEY",
    docsUrl: "https://www.fonoa.com/",
    commercials: "Tiered subscription by transaction volume, roughly from $99/month.",
    verified: false,
  },
  {
    id: "vertex",
    name: "Vertex",
    summary:
      "Enterprise determination engine covering US sales tax, global VAT and communications " +
      "tax. Assumes a dedicated tax function on your side.",
    capabilities: ["us-sales-tax", "global-vat", "china-vat", "filing"],
    secretKey: "VERTEX_API_KEY",
    docsUrl: "https://www.vertexinc.com/",
    commercials:
      "Enterprise contracts, tens to hundreds of thousands annually. Overkill unless the " +
      "tax problem already has an owner.",
    verified: false,
  },
];

const BY_ID = new Map(TAX_PROVIDERS.map((provider) => [provider.id, provider]));

export function findTaxProvider(id: string): TaxProviderSpec | undefined {
  return BY_ID.get(id as TaxProviderId);
}

/** Providers that can answer the question the internal engine declines. */
export function providersCoveringUsSalesTax(): TaxProviderSpec[] {
  return TAX_PROVIDERS.filter((provider) => provider.capabilities.includes("us-sales-tax"));
}

/**
 * Why the internal engine could not answer, phrased as what a provider would add.
 *
 * Returned to the UI so the "connect a provider" prompt appears when it is
 * genuinely useful and stays quiet when it is not — an upsell on a load whose
 * tax is already statutory is just noise.
 */
export function providerWouldHelp(
  regime: string,
  confidence: string,
): { helps: boolean; reason: string | null } {
  if (confidence !== "indeterminate") {
    return { helps: false, reason: null };
  }
  if (regime === "us-no-vat") {
    return {
      helps: true,
      reason:
        "This lane is intrastate, where freight taxability and the combined state-and-local " +
        "rate depend on the exact addresses. A licensed engine resolves that to a rooftop.",
    };
  }
  return {
    helps: false,
    reason: null,
  };
}
