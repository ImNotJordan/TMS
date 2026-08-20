import { describe, expect, it } from "vitest";

import {
  money,
  moneyExact,
  buildDraftLinesFromLoad,
  describeLoadBillingProblems,
  isInvoiceLocked,
  parseMoneyStrict,
  totalsFromLines,
  type InvoiceLineItem,
} from "./accounting-store";
import type { LoadRecord } from "./loads-store";

function load(overrides: Partial<LoadRecord> = {}): LoadRecord {
  return {
    loadId: "L-1001",
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    customer: "Acme Foods",
    ...overrides,
  } as LoadRecord;
}

describe("parseMoneyStrict", () => {
  it("parses the shapes that arrive from rate confirmations", () => {
    expect(parseMoneyStrict("1,847.30")).toBe(1847.3);
    expect(parseMoneyStrict("$2,400")).toBe(2400);
    expect(parseMoneyStrict(" 1800.00 ")).toBe(1800);
    expect(parseMoneyStrict(".5")).toBe(0.5);
  });

  it("refuses a malformed amount instead of billing it as zero", () => {
    // The old parser stripped non-numerics and coerced: "$1.2.3" became NaN and
    // then 0, so a typo'd rate was silently invoiced as nothing.
    expect(parseMoneyStrict("$1.2.3")).toBeNull();
    expect(parseMoneyStrict("1-2")).toBeNull();
    expect(parseMoneyStrict("twelve hundred")).toBeNull();
    expect(parseMoneyStrict("")).toBeNull();
    expect(parseMoneyStrict(undefined)).toBeNull();
  });

  it("keeps the sign on an accounting negative", () => {
    // "(500)" used to become +500 — a credit applied as a charge.
    expect(parseMoneyStrict("(500)")).toBe(-500);
    expect(parseMoneyStrict("($1,250.50)")).toBe(-1250.5);
    expect(parseMoneyStrict("-500")).toBe(-500);
    expect(parseMoneyStrict("500-")).toBe(-500);
  });

  it("does not double-negate a parenthesised minus", () => {
    expect(parseMoneyStrict("(-500)")).toBe(500);
  });
});

describe("buildDraftLinesFromLoad — the carrier's rate is never billed to the customer", () => {
  it("does not fall back to carrierRate when the customer rate is missing", () => {
    // The bug: a brokered load with the buy rate filled in and the sell rate
    // blank invoiced the customer the buy rate. Entire margin, given away, on an
    // invoice that looked normal.
    const lines = buildDraftLinesFromLoad(load({ carrierRate: "1800.00" }));
    const linehaul = lines.find((l) => l.kind === "linehaul");
    expect(linehaul?.amount).toBe(0);
    expect(JSON.stringify(lines)).not.toContain("1800");
  });

  it("flags the missing customer rate rather than quietly producing a zero", () => {
    const problems = describeLoadBillingProblems(load({ carrierRate: "1800.00" }));
    expect(problems).toHaveLength(1);
    expect(problems[0]?.code).toBe("missing_customer_rate");
  });

  it("prefers customerRate, then linehaulRate", () => {
    expect(
      buildDraftLinesFromLoad(load({ customerRate: "2400", linehaulRate: "2000" })).find(
        (l) => l.kind === "linehaul",
      )?.amount,
    ).toBe(2400);
    expect(
      buildDraftLinesFromLoad(load({ linehaulRate: "2000", carrierRate: "1800" })).find(
        (l) => l.kind === "linehaul",
      )?.amount,
    ).toBe(2000);
  });

  it("reports which field the linehaul came from", () => {
    const lines = buildDraftLinesFromLoad(load({ customerRate: "2400" }));
    expect(lines[0]?.source).toBe("derived");
    expect(lines[0]?.sourceField).toBe("customerRate");
  });

  it("keeps a negative accessorial as an explicit credit line", () => {
    // Every line used to be gated `if (amount > 0)`, so a credit vanished from
    // the invoice with no line and no warning.
    const lines = buildDraftLinesFromLoad(
      load({ customerRate: "2400", accessorialCharges: "(150)" }),
    );
    const credit = lines.find((l) => l.kind === "credit");
    expect(credit).toBeDefined();
    expect(credit?.amount).toBe(-150);
    expect(credit?.label).toContain("credit");
  });

  it("reports an unparseable accessorial rather than dropping it", () => {
    const problems = describeLoadBillingProblems(
      load({ customerRate: "2400", lumperFee: "1.2.3" }),
    );
    expect(problems.map((p) => p.code)).toContain("unparseable_amount");
    expect(problems.map((p) => p.field)).toContain("lumperFee");
  });

  it("omits charges that are genuinely absent", () => {
    const lines = buildDraftLinesFromLoad(load({ customerRate: "2400" }));
    expect(lines).toHaveLength(1);
  });

  it("carries every accessorial with its source field", () => {
    const lines = buildDraftLinesFromLoad(
      load({
        customerRate: "2400",
        fuelSurcharge: "300",
        detentionRate: "180",
        lumperFee: "125",
        layoverFee: "250",
        tonuFee: "150",
        accessorialCharges: "75",
      }),
    );
    expect(lines.every((l) => l.source === "derived")).toBe(true);
    expect(lines.map((l) => l.sourceField)).toContain("detentionRate");
    expect(lines).toHaveLength(7);
  });
});

describe("totalsFromLines", () => {
  const line = (over: Partial<InvoiceLineItem>): InvoiceLineItem => ({
    id: "x",
    kind: "accessorial",
    label: "x",
    amount: 0,
    ...over,
  });

  it("holds total === sum of lines", () => {
    const lines = [
      line({ kind: "linehaul", amount: 1847.3 }),
      line({ kind: "fuel", amount: 312.45 }),
      line({ kind: "accessorial", amount: 180 }),
    ];
    const { subtotal, total } = totalsFromLines(lines);
    expect(subtotal).toBe(2339.75);
    expect(total).toBe(2339.75);
    expect(total).toBe(Number(lines.reduce((s, l) => s + l.amount, 0).toFixed(2)));
  });

  it("lets a credit reduce the subtotal rather than sitting outside it", () => {
    const { total } = totalsFromLines([
      line({ kind: "linehaul", amount: 2400 }),
      line({ kind: "credit", amount: -150 }),
    ]);
    expect(total).toBe(2250);
  });

  it("adds tax on top of the subtotal rather than inside it", () => {
    const { subtotal, tax, total } = totalsFromLines([
      line({ kind: "linehaul", amount: 1000 }),
      line({ kind: "tax", amount: 87.5 }),
    ]);
    expect(subtotal).toBe(1000);
    expect(tax).toBe(87.5);
    expect(total).toBe(1087.5);
  });

  it("reconciles across a spread of generated rate structures", () => {
    // Stands in for the property test until fast-check is installed. Seeded, so
    // a failure is reproducible.
    let seed = 42;
    const next = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    for (let i = 0; i < 1000; i += 1) {
      const lines = Array.from({ length: 1 + Math.floor(next() * 6) }, (_unused, n) =>
        line({
          id: `l${n}`,
          kind: n === 0 ? "linehaul" : "accessorial",
          // Two decimal places, the precision a rate confirmation carries.
          amount: Math.round(next() * 500000) / 100,
        }),
      );
      const { subtotal, tax, total } = totalsFromLines(lines);
      expect(total, `iteration ${i}`).toBe(Math.round((subtotal + tax) * 100) / 100);
      const expected = Math.round(lines.reduce((s, l) => s + l.amount, 0) * 100) / 100;
      expect(subtotal, `iteration ${i}`).toBe(expected);
    }
  });
});

describe("isInvoiceLocked", () => {
  it("locks everything past draft", () => {
    // `sent` used to be a status and nothing more: an invoice already in a
    // shipper's AP queue could be rewritten with no record that it changed.
    for (const status of ["sent", "in-dispute", "factored", "sent-to-collections"] as const) {
      expect(isInvoiceLocked({ status }), status).toBe(true);
    }
  });

  it("leaves a draft editable", () => {
    expect(isInvoiceLocked({ status: "ready-to-bill" })).toBe(false);
  });
});

describe("money() never hides cents", () => {
  it("renders two decimal places, always", () => {
    // Previously `maximumFractionDigits: 0`. Every accounting figure was rounded to
    // the dollar on screen, so a one-cent variance — the kind an AP system rejects
    // an invoice over — was invisible to the clerk looking straight at it.
    expect(money(1847.3)).toBe("$1,847.30");
    expect(money(1847)).toBe("$1,847.00");
    expect(money(0)).toBe("$0.00");
    expect(money(0.01)).toBe("$0.01");
  });

  it("shows the cent that used to disappear", () => {
    // The $1,847.29 vs $1,847.30 case: two amounts that used to render identically.
    expect(money(1847.29)).not.toBe(money(1847.3));
  });

  it("agrees with moneyExact", () => {
    for (const v of [0, 0.005, 12.5, 1847.29, 1_234_567.891]) {
      expect(money(v), String(v)).toBe(moneyExact(v));
    }
  });

  it("handles a null-ish amount without rendering NaN", () => {
    expect(money(undefined as unknown as number)).toBe("$0.00");
  });
});
