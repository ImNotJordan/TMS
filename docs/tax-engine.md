# Per-load tax: what's available, and what we built

You asked for an API for China tax and US tax per load. The short version is that
**no single API answers both well**, and for the two cases you actually care
about, most of the answer is computable without one. This documents the vendor
landscape, then what shipped.

---

## 1. The thing to understand before choosing a vendor

The US and China are not two instances of the same problem.

| | China | United States |
| --- | --- | --- |
| Tax on the transport service? | **Yes** — VAT, 9% | **No** — no VAT, no federal sales tax |
| Rate source | Statutory, national, 3 tiers | ~13,000 state + local jurisdictions |
| Interstate freight | N/A (VAT applies domestically) | Generally **not** a taxable sale |
| Recoverable? | **Yes** — input VAT credit | No (it isn't charged) |
| Real per-load cost | Output VAT − input credit + surcharges | Fuel tax (IFTA), per mile |

Two consequences drive everything below:

**China's rate is not the interesting number.** A broker buying carriage at
¥8,000 and selling at ¥10,000 does not owe 9% of ¥10,000. It owes VAT on the
value it added — output VAT less the input credit on the purchased carriage. On
that load: ¥825.69 output, ¥660.55 credit, **¥165.14 payable**, plus ¥19.82 of
surcharges. About **1.85% of revenue**, not 9%.

But that credit only exists if the carrier issues a **special VAT invoice**
(增值税专用发票). Without one, the same load costs **¥925** — five times more.
That is a procurement decision worth more than any rate lookup, and no tax API
knows whether your carrier will issue a fapiao.

**The correct US answer is usually zero.** A separately-stated charge for
interstate freight is not a taxable sale of services. Paying per transaction to
be told zero is a poor trade. What actually costs money per mile is fuel tax
under IFTA — and that is a quarterly apportionment across up to 58
jurisdictions, not a line item on a shipment.

---

## 2. Vendor landscape

### Sales tax / VAT calculation

| Vendor | Covers | Freight fit | Commercials | Verdict |
| --- | --- | --- | --- | --- |
| **[Avalara AvaTax](https://developer.avalara.com/avalara-apis/)** | US state+local, global VAT incl. China | **Best** — has freight-specific tax codes and [documented freight taxability](https://knowledge.avalara.com/bundle/dqa1657870670369_dqa1657870670369/page/Understanding_freight_taxability.html) | Paid, per-transaction + annual commitment, sales-led | **Pick this** if US intrastate is real volume |
| **[Stripe Tax](https://stripe.com/tax)** | 100+ countries, 600+ product categories | Weak — built for goods and SaaS, not transportation | Subscription; Tax Basic = calculation only, Tax Complete adds filing | Cheapest real rate if you already use Stripe |
| **[Fonoa](https://www.fonoa.com/)** | 100+ countries, API-first, China + e-invoicing | Decent, and strong on fapiao issuance | Tiered by volume, ~$99/mo up | Best if fapiao issuance matters as much as calculation |
| **[Vertex](https://www.vertexinc.com/)** | US sales tax, global VAT, communications tax | Good | Enterprise, tens–hundreds of thousands/yr | Overkill unless tax already has an owner |
| TaxJar / TaxCloud / Zamp | US-centric | Poor for China | Cheaper | Not worth it for a two-country problem |

### Fuel tax (IFTA)

There is **no official IFTA API**. Rates are published quarterly as a matrix by
IFTA, Inc. at **[iftach.org/taxmatrix4](https://www.iftach.org/taxmatrix4/)** —
the authoritative source, currently on the Q3 2026 matrix. Only five
jurisdictions changed rates for Q2 2026 (FL, GA, IN, MA, NY), so the data is
stable enough to snapshot rather than poll.

For real IFTA filing (as opposed to estimation) you need per-state mileage,
which means a telematics or routing product, not a tax API:

- **Trimble / PC*MILER**, **ProMiles** — state-by-state mileage, the standard
  for IFTA
- **Motive**, **Samsara** — ELD data with IFTA reporting built in
- **TruckLogics**, CalculateIFTA — filing-oriented

### China e-invoicing (fapiao)

Not calculation but you will need it: **Baiwang (百望)**, **Aisino / 航天信息**,
**Sovos**, **Fonoa**. The Golden Tax System has no public API — you go through a
licensed provider.

---

## 3. What shipped

A built-in estimator, plus a seam for a licensed engine to cover the gap.

```
src/lib/tax/tax-rates.ts        statutory rate data, dated and sourced
src/lib/tax/tax-domain.ts       the estimator — pure, 43 tests
src/lib/tax/tax-providers.ts    vendor catalogue + when a provider actually helps
src/features/tax/use-load-tax.ts   maps a LoadRecord / draft onto the estimator
src/features/tax/load-tax-panel.tsx   the per-load panel
```

Surfaced on the **load detail page**, next to Review — it updates as rates are
typed, because a tax number that only appears after saving is one nobody prices
with.

### China: what it computes

- Output VAT at **9%** (transportation) or **6%** (logistics auxiliary /
  forwarding), per the [PRC VAT Law effective 1 January 2026](https://www.ey.com/en_gl/technical/tax-alerts/china-officially-enacts-vat-law-ushering-in-a-new-era-of-tax-governance)
- **3%** levy rate for small-scale taxpayers, with no input credit
- **Input VAT credit** on the carrier leg — gated on whether the carrier issues a
  special VAT invoice
- **Surcharges** on VAT *payable*, not revenue: urban construction (7% / 5% / 1%
  by registration tier) + education 3% + local education 2%
- **Zero-rating** for qualifying international transportation, which preserves
  the credit
- Tax-inclusive (含税) vs exclusive handling — the default is inclusive, because
  that is the Chinese contract convention and getting it backwards misstates
  every figure by ~9%

### US: what it computes

- Interstate vs intrastate determination
- Interstate → **no sales tax**, stated plainly with the reason
- Intrastate → a short list of well-settled states; everything else returns
  `indeterminate` and points at a provider
- **Fuel tax estimate** from lane miles ÷ fleet MPG × blended IFTA rate

### What it refuses to do

This is the part worth reading:

- **No fifty-state intrastate matrix.** A hand-maintained one would be
  confidently wrong somewhere, and the place it was wrong would be the state you
  operate in. Unsettled states return `indeterminate`.
- **No invented combined rate.** For a state that does tax transportation (HI,
  NM, SD, WV), it names the exposure and declines to guess the rate — that
  depends on rooftop addresses.
- **No exact IFTA.** Needs per-jurisdiction miles; a load has total distance. The
  blended estimate is labelled as one, good for order of magnitude only.
- **No weight-distance tax** (KY, NM, NY, OR). Same missing input. Flagged, not
  guessed.
- **No HVUT or income tax apportionment.** Annual and entity-level; slicing them
  per load would be an allocation policy dressed as a tax figure.

Every estimate carries `confidence` (`statutory` / `estimated` /
`indeterminate`), a `notes` list of caveats, and a `rateSnapshot` date. The panel
renders all three. It is not tax advice and says so.

---

## 4. Configuration

**Settings → Accounting → Tax Estimation** — company-level facts, set once:

| Setting | Why it matters |
| --- | --- |
| China VAT taxpayer status | Small-scale = 3% and no credits |
| China service classification | Carrier of record 9% vs forwarder 6% — decided by contract |
| China rates are VAT-inclusive | Wrong value misstates everything by ~9% |
| Carriers issue special VAT invoices | The single biggest driver of brokered-load tax cost |
| China surcharge tier | 7% city / 5% county / 1% elsewhere |
| Fleet average MPG | Turns lane miles into gallons |

---

## 5. Recommendation

1. **Start with the built-in estimator.** It is complete for China VAT and
   correct for US interstate — which is most brokered freight. No account, no
   per-transaction cost.
2. **Add Avalara only when US intrastate becomes real volume.** That is the one
   question the built-in engine deliberately declines, and the only part worth
   paying for. The seam is in `tax-providers.ts`; the key belongs in the
   WorkspaceSettings `secrets` partition and must be read server-side, like the
   OpenAI and Google Maps keys.
3. **For fuel tax, buy mileage, not tax.** PC*MILER or your ELD gives per-state
   miles; the rates are free from iftach.org. That combination beats any tax API
   for IFTA.
4. **If you invoice in China, budget for a fapiao provider** — that is a
   compliance requirement, not an optimisation.

### Provider adapters: not yet verified

`tax-providers.ts` carries a `verified` flag per vendor, and every external
adapter is currently `false`. The catalogue, capabilities and commercials are
researched; no adapter has been exercised against a live account, because none
of these vendors issues a sandbox key without a sales conversation. Treat the
external path as designed-not-proven until someone runs a real transaction
through it. The built-in engine is `verified: true` and covered by tests.

---

## 6. China tax API — where to get one, and what it's for

**Important: it is not for the rate.** China's VAT rates are statutory (9% / 6% /
3%) and the built-in estimator already applies them exactly. No API knows them
better than the statute.

What an API tells you that statute cannot is whether a **specific invoice is
real**. That matters more here than anywhere else in this app: the largest driver
of tax cost on a brokered Chinese load is whether the carrier issued a valid
**special VAT invoice (增值税专用发票)**. With one, a ¥10,000 / ¥8,000 load costs
about **¥185**. Without, **¥925**. Right now that is a workspace *setting* — an
assumption. Verification turns it into a fact, per invoice.

### Where to buy a key

The State Taxation Administration's own platform (`inv-veri.chinatax.gov.cn`) is
a captcha-gated web form with **no public API**. Every option below wraps it.

| Provider | Auth | Self-serve? | Where |
| --- | --- | --- | --- |
| **Alibaba Cloud Marketplace 发票查验** | single `APPCODE` header | Yes, with an Aliyun account | [market.aliyun.com/apimarket/detail/cmapi025075](https://market.aliyun.com/apimarket/detail/cmapi025075) |
| **Juhe Data 聚合数据** | key as query param | Yes, free tier | [juhe.cn/docs/api/id/336](https://www.juhe.cn/docs/api/id/336) |
| Baidu AI 发票核验 | OAuth token exchange | Yes | [ai.baidu.com/tech/ocr/vat_invoice_verification](https://ai.baidu.com/tech/ocr/vat_invoice_verification) |
| Tencent Cloud 增值税发票核验 | TC3-HMAC-SHA256 signing | Yes | [cloud.tencent.com/document/product/866/73674](https://cloud.tencent.com/document/product/866/73674) |
| Huawei Cloud 发票验真 | IAM token | Yes | [support.huaweicloud.com/api-ocr/ocr_03_0134.html](https://support.huaweicloud.com/api-ocr/ocr_03_0134.html) |

**Start with Alibaba Cloud Marketplace.** One header, no signing, no token
exchange — the two implemented adapters are that one and Juhe. Baidu, Tencent and
Huawei need OAuth or request signing, and I deliberately did not implement those
blind; use the **custom endpoint** option if you buy one of them.

### Known limits of every one of them

- **Query caps.** Typically ~5 verifications per invoice per day. The adapter
  reports quota exhaustion as its own error code, because the fix is to wait
  rather than to reconfigure.
- **Five-year window.** Invoices older than five years cannot be verified.
- **Next-day availability.** Some providers cannot verify an invoice until the
  day after issuance.
- **Six required elements.** Invoice number, date, and depending on type the
  invoice code, check code, or tax-excluded amount. Deliberate: the authority
  requires details only the holder of the invoice has, so the API cannot be used
  to enumerate invoices.

### Where to put the key

**Settings → Integrations → China tax API → Connect.**

Pick the provider, paste the key, save. It is stored in the WorkspaceSettings
`secrets` partition — server-only, denied to the browser's Identity Pool role,
exactly like the OpenAI key. It is **write-only**: the status response returns
`connected` and the last four characters, and nothing reveals it. Leaving the key
field blank on a later save keeps the stored one, so you can switch provider
without having the key to hand.

Admin roles only (`handleSettingsChinaTaxWriteRequest` calls
`authorizeAdminRequest`).

### For issuing fapiao, not verifying

Separate problem, separate vendors. Since **December 2024** all Chinese
businesses must issue fully-digital invoices (数电发票), so if you invoice in China
this is a compliance requirement rather than an option:

- **[Baiwang 百望云](https://www.baiwang.com/)** — the largest independent provider
- **[Nuonuo 诺诺开放平台](https://nuonuo.com/open/)** — Aisino/航天信息, good docs
- **[fa-piao.com](https://fa-piao.com/)** — API-first, SDKs for most languages
- **[Fonoa](https://www.fonoa.com/)** / **Sovos** — if you want one vendor across
  several countries

Not implemented here. Issuance writes to your Golden Tax device and is a
different risk class from a read-only verification call.

### Status

The adapter is implemented and unit-tested (19 tests) against recorded response
shapes. `verified: false` — no live account has exercised it, because these keys
are metered and I have none. The pure request builder and response parser are
covered; only the transport is unproven.

One behaviour worth knowing: a valid **general** invoice (普通发票) is a real
invoice that credits *nothing*. The parser only sets `isSpecialVatInvoice` when
the type name contains 专用 **and** the verdict is positive — conflating the two
would overstate your recoverable VAT by the full 9%.

---

## 7. Manual entry — working the tax out yourself

No API key, no vendor contract, no per-query metering. You look the number up,
type it in, and it becomes the figure of record for that load. This is the route
that needs nothing from anybody, and for a broker doing tens of loads a month it
is the honest answer.

### Where the number goes

**Load → Review step → Tax card → "Enter tax manually".** Same card in the
create-load wizard and on an existing load's detail page — one component, so a
figure recorded during booking and one added at invoicing land in the same place.

Four things are stored on the load:

| Field | Meaning |
| --- | --- |
| `taxManualAmount` | The figure. Blank reverts to the estimate. |
| `taxCurrency` | USD / CNY / CAD / MXN. |
| `taxManualSource` | Where you got it — "Avalara lookup, 75201 → 30303". |
| `taxManualNote` | Why it differs from the estimate, if it does. |

The last two are not decoration. Three months from now the only thing that makes
a hand-typed tax figure defensible is a record of what was consulted, and the
person who can answer that is the person entering it — so the field is there at
the moment they can fill it.

### What it does *not* do

It does not overwrite the estimate. Both stay on screen with the variance between
them called out, and a gap over 25% is highlighted. A ¥900 entry against a ¥185
estimate should read as *"someone decided the input credit doesn't apply"* — a
question worth asking — rather than quietly becoming the truth.

### Who can enter one

`LOAD_TAX_SETTERS`: Organization Owner, Admin, SuperAdmin, Operations Manager,
Broker, **and Accounting**. Accounting is deliberately included even though it
cannot price a load, because Accounting is exactly who reads a VAT calculator and
types the answer in. Dispatchers, Drivers, Sales and Marketing cannot; the server
refuses with `role_cannot_set_load_tax` and the client is only a courtesy.

The tax fields are deliberately **absent** from
`LOAD_POST_DELIVERY_FROZEN_FIELDS`. Rates freeze once a load delivers, and that
is right — but tax is determined at invoicing, which happens *after* delivery by
definition. Freezing it would lock the field exactly when it needs filling in.
Every change is written to the load audit log from→to, the same as a rate change.

### Onto the invoice

`buildDraftLinesFromLoad` emits a `kind: "tax"` line last, after the charges it
is levied on, with `sourceField: "taxManualAmount"` so the invoice records where
the number came from. A zero is **kept**, unlike an unbilled accessorial: "we
checked, and it is zero" is a meaningful statement on a freight invoice — and it
is the usual answer for US interstate. Omitting the line would make a deliberate
zero indistinguishable from never having looked.

### Calculators to work it out with

Linked inside the dialog itself, filtered to the load's regime — the moment
someone needs a calculator is the moment they have that dialog open.

**China (VAT):**

| Site | What it does |
| --- | --- |
| [国家税务总局全国增值税发票查验平台](https://inv-veri.chinatax.gov.cn/) | The authority's own invoice check. Captcha-gated, free, five queries per invoice per day. This is what the paid APIs in §6 wrap — do it by hand and you need no key at all. |
| [vatcalcul.com China VAT calculator](https://vatcalcul.com/china-vat-calculator/) | 含税 ⇄ 不含税 both directions at 13/9/6/3%. |
| [增值税计算器 (价税分离)](https://smart-calculators.net/zh-CN/tools/vat-calculator) | Chinese-language price/tax separation. |

The arithmetic is small enough to check by hand, and worth checking once.
Transportation is **9%**, logistics auxiliary services **6%**, small-scale
taxpayers **3%**. Both legs are tax-inclusive (含税) by default — the Chinese
contract convention, and what §1 works through:

```
sale        ¥10,000 incl.  → output VAT   10000 − 10000 ÷ 1.09 = ¥825.69
carrier     ¥ 8,000 incl.  → input credit  8000 −  8000 ÷ 1.09 = ¥660.55
                             VAT payable                        = ¥165.14
                             surcharges  165.14 × 12%           = ¥ 19.82
                             total                              = ¥184.95
```

Two places this goes wrong. **The surcharge base:** 附加税费 (city maintenance 7%,
education 3%, local education 2%) apply to the **¥165.14 payable**, not to the
¥825.69 output — charging them on output overstates them fivefold. **The
inclusive/exclusive flag:** if a quoted figure is actually tax-*exclusive*,
multiply by 9% instead of dividing out, and every number above moves by ~9%.
Check which convention the contract uses before typing anything in.

**US:**

| Site | What it does |
| --- | --- |
| [Avalara rate lookup by address](https://www.avalara.com/us/en/taxrates/calculator.html) | Free, no signup. Combined state/county/city/district rate. |
| [TaxJar sales tax calculator](https://www.taxjar.com/sales-tax-calculator) | Same job, second opinion. |
| [IFTA calculator (per-state miles)](https://iftacalculators.com/) | Fuel tax by jurisdiction miles — the tax that actually applies to a haul. |
| [IFTA, Inc. official rate matrix](https://www.iftach.org/taxmatrix4/) | The source of record, updated quarterly. The system parses this directly; use it to check what the system used. |

For US interstate freight the answer is usually **zero sales tax** — moving goods
across state lines is not a taxable sale, and a freight charge is not tangible
personal property. The lookups above matter for *intrastate* hauls, where roughly
half the states tax transportation as part of the sale. The tax that does apply on
essentially every mile is IFTA, and it is a fuel cost apportioned by jurisdiction
rather than something billed to a customer — which is why the estimator reports it
as a cost line and not as a tax on the invoice.

---

## 8. Manual rates in Settings — applied to every load

Section 7 covers typing one tax *amount* onto one load. This is the other half:
typing a *rate* once, in Settings, and having every load you build use it.

**Settings → Accounting → Tax Estimation → Manual rates.**

| Field | What it does |
| --- | --- |
| Use Manual Tax Rates | Master switch. Off leaves the numbers stored but unused. |
| US Transportation Tax Rate (%) | Combined state + local, for intrastate hauls. |
| IFTA Diesel Rate ($/gal) | Replaces the national blended estimate. |
| China VAT Rate Override (%) | Replaces the statutory 9 / 6 / 3% pick, domestic only. |
| China Surcharge Rate Override (%) | Replaces the 12 / 10 / 6% tier total. |
| Manual Rate Source | Recorded beside every figure these produce. |
| Rates Verified As Of | `YYYY-MM-DD`, so a stale rate reads as stale. |

### Rates, not amounts

An amount in Settings would be the same tax on a $900 load and a $9,000 one. A
rate scales, which is what "apply it to every load" actually requires. The
per-load amount from section 7 still exists and is still the right tool for a
one-off.

### What it fills, and what it refuses to touch

The estimator returns `indeterminate` for any US state outside a short settled
list — deliberately, because a wrong invented rate is worse than a blank. That
refusal is exactly the hole this fills:

| Situation | Without a manual rate | With one |
| --- | --- | --- |
| Intrastate, state taxes freight (HI, NM, SD, WV) | `indeterminate`, no figure | Priced at your rate |
| Intrastate, no determination carried (e.g. OH) | `indeterminate`, no figure | Priced, and the note says taxability was never verified |
| Intrastate, state exempts freight (CA, TX, IL, GA, FL, ...) | Exempt | **Still exempt** — see below |
| Interstate | Not a taxable sale | **Still not** — note says the rate was skipped |

The last two rows are the important ones. A manual rate fills gaps; it does not
overrule a settled determination. Charging tax in a state that exempts freight
would invent a liability, which is worse than the blank it replaces. And
interstate freight is not a taxable sale whatever rate is configured.

Confidence lands on `estimated`, never `statutory` — the figure is only as good
as whoever typed it, and the panel says so. A `Settings rate` badge appears on
the load, derived from the lines the estimator actually produced rather than from
the settings, so it means "this shaped the number you are looking at" rather than
"something is configured somewhere".

### Fuel tax precedence

`published lane rates > manual rate > national blend`

Live published rates win because they are the per-jurisdiction figures for *that
lane*, pulled from the same iftach.org matrix you would have consulted by hand —
the better version of what you asked for, not a disregard of it. When a manual
rate is set but unused the note says so outright, because a setting that is
quietly ignored is indistinguishable from one that failed.

### China: what an override may and may not replace

The VAT override replaces the statutory rate for a **domestic** movement only.
Zero-rated cross-border transport and the small-scale levy are left alone: those
are legal *statuses* carrying their own input-credit rules, so replacing the
percentage would change the regime rather than just the number.

A manual surcharge rate changes the percentage, never the base. Surcharges stay
levied on VAT **payable** — applying them to revenue is the error the whole
module exists to avoid, and an override must not reintroduce it.

### Why the parsing is strict

`9` means 9%. The hazard is typing `0.09` meaning nine percent: taken at face
value that is nine *hundredths* of a percent, understating tax roughly a
hundredfold, and the result is small but plausible enough to survive months of
review. So values are range-checked per field, anything under 0.5% is rejected as
a suspected fraction, and the reason appears under the field in red.

A rate that fails validation is **dropped, not defaulted** — that one rate falls
back to built-in behaviour while the others keep working. A default would be a
number nobody entered, presented as one somebody did. Blank and zero stay
distinct: blank is "not set", zero is "I checked, and this state exempts it".

Rates arriving at `POST /api/tax/estimate` are re-sanitised server-side. The
domain multiplies revenue by these numbers, and a `NaN` there propagates into
every total without throwing — it renders as a dash, not as an error anyone
chases. Out-of-range values are dropped rather than clamped, because clamping
answers a question nobody asked.

### Bugs this feature exposed

Making manual rates work turned a dormant code path live. `salesTax` in the US
branch had been hardcoded to zero since the estimator was written, so nothing
downstream of it had ever run with a real number. Four defects surfaced on the
first adversarial probe; all four are now covered by
`manual-rate-regressions.test.ts`.

**Sales tax was being counted as a cost you bear.** The US branch returned
`totalTaxCost: salesTax + fuelTax` while the comment three lines above said only
fuel tax belonged there. Invisible while sales tax was always zero; an
overstatement of the load's cost by the entire sales tax the moment a rate made
it non-zero. `totalTaxCost` is now fuel tax only.

Excluding it creates a second-order trap: a sales-tax-only load then headlines as
**zero cost**, which is true and reads at a glance as "no tax". So the panel now
states the remittance beside the headline — `Sales tax to collect and remit
$113.09 — billed to the customer, so not a cost you bear` — mirroring the
`Output − Credit → VAT payable` line the China branch already had. A caveat lower
down would not have done; nobody weighs a footnote against a number in 24px type.

**The badge missed the China VAT override.** It was derived by scanning line
labels for the word "manual", and the China VAT path changes the rate while
leaving its label untouched — so the badge went dark on the case where the figure
moved most. `TaxEstimate` now carries an explicit `usesManualRates`, set from what
was *applied* rather than what was configured.

**The China override's provenance was invisible.** It was recorded in a note, and
the notes list sits behind a collapsed section — so the one rate whose origin most
needed stating was the one you could not see. It is now on the line itself, like
every other manual path.

**A rate that changed nothing still changed the confidence label.** A China
surcharge override with no VAT payable to levy on downgraded `statutory` to
`estimated` while moving no number, marking an estimate less trustworthy for a
reason not visible anywhere on screen. Now gated on the rate actually applying.

One related defect is **pre-existing and left alone**: with the delivery state
blank, a load is reported as an "Interstate movement" rather than as
undetermined. The manual-rate note no longer piles a second unfounded claim on
top of it, but the underlying mislabelling is outside this feature.

---

## Sources

- [China officially enacts VAT law — EY](https://www.ey.com/en_gl/technical/tax-alerts/china-officially-enacts-vat-law-ushering-in-a-new-era-of-tax-governance)
- [China VAT law 2026 — vatcalc](https://www.vatcalc.com/china/china-vat-law-2026/)
- [China's VAT Law Reform: Key Changes Effective January 2026 — VATabout](https://vatabout.com/chinas-vat-law-reform-key-changes-effective-january-2026)
- [Avalara Developer — APIs](https://developer.avalara.com/avalara-apis/)
- [Understanding freight taxability — Avalara](https://knowledge.avalara.com/bundle/dqa1657870670369_dqa1657870670369/page/Understanding_freight_taxability.html)
- [Freight (Shipping) Taxability — Leyton](https://leyton.com/us/insights/articles/freight-shipping-taxability/)
- [Trucking Companies: Adhering to a Complex Network of State Taxes — HBK](https://hbkcpa.com/insights/trucking-companies-adhering-to-a-complex-network-of-state-taxes/)
- [IFTA, Inc. tax rate matrix](https://www.iftach.org/taxmatrix4/)
- [Q2 2026 IFTA rate changes — TruckLogics](https://blog.trucklogics.com/q2-2026-ifta-filing-key-fuel-tax-rate-changes-and-filing-tips/)
- [Avalara free sales tax rate calculator](https://www.avalara.com/us/en/taxrates/calculator.html)
- [国家税务总局全国增值税发票查验平台](https://inv-veri.chinatax.gov.cn/)
- [Stripe Tax](https://stripe.com/tax) · [Fonoa](https://www.fonoa.com/) · [Vertex](https://www.vertexinc.com/)
