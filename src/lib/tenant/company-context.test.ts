import { beforeEach, describe, expect, it, vi } from "vitest";

const getSection = vi.fn();
const fetchAuthSession = vi.fn();

vi.mock("@/lib/profile-store", () => ({
  getSection: (...args: unknown[]) => getSection(...args),
}));
vi.mock("aws-amplify/auth", () => ({
  fetchAuthSession: (...args: unknown[]) => fetchAuthSession(...args),
}));

const {
  MissingCompanyError,
  belongsToCompany,
  clearCompanyContext,
  ensureCompanyContext,
  filterByCompany,
  newCompanyId,
  normalizeCompanyName,
  peekCompanyContext,
  refreshCompanyContext,
  requireCompanyId,
  setCompanyContextUser,
} = await import("@/lib/tenant/company-context");

/** Put `custom:companyId` on the current ID token (or leave it absent). */
function tokenClaims(companyId?: string) {
  fetchAuthSession.mockResolvedValue({
    tokens: {
      idToken: {
        payload: companyId === undefined ? {} : { "custom:companyId": companyId },
      },
    },
  });
}

const ACME = "11111111-1111-4111-8111-111111111111";
const RIVAL = "22222222-2222-4222-8222-222222222222";

function sectionReturns(data: unknown) {
  getSection.mockResolvedValue({ data, updatedAt: null });
}

beforeEach(() => {
  getSection.mockReset();
  fetchAuthSession.mockReset();
  // Default: no claim on the token, so the suites below that predate the
  // Cognito attribute keep exercising the legacy Profile fallback. The
  // claim-first suite sets it explicitly.
  tokenClaims(undefined);
  clearCompanyContext();
});

describe("token claim is authoritative", () => {
  it("uses custom:companyId from the ID token", async () => {
    tokenClaims(ACME);
    sectionReturns({ companyName: "Acme Logistics" });
    setCompanyContextUser("user-1");

    await expect(ensureCompanyContext()).resolves.toEqual({
      companyId: ACME,
      companyName: "Acme Logistics",
    });
  });

  // The Profile row is browser-writable; the signed claim is not.
  it("prefers the claim when the Profile row disagrees", async () => {
    tokenClaims(ACME);
    sectionReturns({ companyId: RIVAL, companyName: "Rival Freight" });
    setCompanyContextUser("user-1");

    expect((await ensureCompanyContext())?.companyId).toBe(ACME);
  });

  it("still resolves the id when the display name cannot be read", async () => {
    tokenClaims(ACME);
    getSection.mockRejectedValue(new Error("Dynamo unavailable"));
    setCompanyContextUser("user-1");

    await expect(ensureCompanyContext()).resolves.toEqual({
      companyId: ACME,
      companyName: "",
    });
  });

  it("falls back to the Profile row for accounts assigned before the claim existed", async () => {
    tokenClaims(undefined);
    sectionReturns({ companyId: ACME, companyName: "Acme Logistics" });
    setCompanyContextUser("user-1");

    expect((await ensureCompanyContext())?.companyId).toBe(ACME);
  });

  it("resolves to nothing when neither source has a company", async () => {
    tokenClaims(undefined);
    sectionReturns({});
    setCompanyContextUser("user-1");

    await expect(ensureCompanyContext()).resolves.toBeNull();
  });

  it("forces a token refresh when re-reading after an assignment", async () => {
    tokenClaims(undefined);
    sectionReturns({});
    setCompanyContextUser("user-1");
    await ensureCompanyContext();

    tokenClaims(ACME);
    sectionReturns({ companyName: "Acme Logistics" });
    expect((await refreshCompanyContext())?.companyId).toBe(ACME);
    expect(fetchAuthSession).toHaveBeenCalledWith({ forceRefresh: true });
  });
});

describe("ensureCompanyContext", () => {
  it("resolves the assigned company for the bound user", async () => {
    sectionReturns({ companyId: ACME, companyName: "Acme Logistics" });
    setCompanyContextUser("user-1");

    await expect(ensureCompanyContext()).resolves.toEqual({
      companyId: ACME,
      companyName: "Acme Logistics",
    });
    expect(peekCompanyContext()?.companyId).toBe(ACME);
  });

  it("returns null when no user is bound", async () => {
    await expect(ensureCompanyContext()).resolves.toBeNull();
    expect(getSection).not.toHaveBeenCalled();
  });

  it("returns null when the user has no company assigned", async () => {
    sectionReturns({ role: "Dispatcher" });
    setCompanyContextUser("user-1");
    await expect(ensureCompanyContext()).resolves.toBeNull();
  });

  it("loads once and caches for the session", async () => {
    sectionReturns({ companyId: ACME, companyName: "Acme" });
    setCompanyContextUser("user-1");

    await ensureCompanyContext();
    await ensureCompanyContext();
    expect(getSection).toHaveBeenCalledTimes(1);
  });

  it("re-resolves when the bound user changes", async () => {
    sectionReturns({ companyId: ACME, companyName: "Acme" });
    setCompanyContextUser("user-1");
    await ensureCompanyContext();

    sectionReturns({ companyId: RIVAL, companyName: "Rival Freight" });
    setCompanyContextUser("user-2");

    await expect(ensureCompanyContext()).resolves.toEqual({
      companyId: RIVAL,
      companyName: "Rival Freight",
    });
  });

  // A lookup failure must not be mistaken for "no restrictions".
  it("fails closed when the profile read throws", async () => {
    getSection.mockRejectedValue(new Error("Dynamo unavailable"));
    setCompanyContextUser("user-1");
    await expect(ensureCompanyContext()).resolves.toBeNull();
  });

  it("does not cache a failure", async () => {
    getSection.mockRejectedValueOnce(new Error("transient"));
    setCompanyContextUser("user-1");
    await expect(ensureCompanyContext()).resolves.toBeNull();

    sectionReturns({ companyId: ACME, companyName: "Acme" });
    await expect(ensureCompanyContext()).resolves.toEqual({
      companyId: ACME,
      companyName: "Acme",
    });
  });

  it("drops context on clear", async () => {
    sectionReturns({ companyId: ACME, companyName: "Acme" });
    setCompanyContextUser("user-1");
    await ensureCompanyContext();

    clearCompanyContext();
    expect(peekCompanyContext()).toBeNull();
    await expect(ensureCompanyContext()).resolves.toBeNull();
  });
});

describe("requireCompanyId", () => {
  it("returns the id when assigned", async () => {
    sectionReturns({ companyId: ACME, companyName: "Acme" });
    setCompanyContextUser("user-1");
    await expect(requireCompanyId()).resolves.toBe(ACME);
  });

  // Write paths must refuse rather than create an unstamped orphan record.
  it("throws when no company is assigned", async () => {
    sectionReturns({});
    setCompanyContextUser("user-1");
    await expect(requireCompanyId()).rejects.toBeInstanceOf(MissingCompanyError);
  });

  it("carries a machine-readable code", async () => {
    sectionReturns({});
    setCompanyContextUser("user-1");
    await expect(requireCompanyId()).rejects.toMatchObject({
      code: "COMPANY_ASSIGNMENT_REQUIRED",
    });
  });
});

describe("filterByCompany", () => {
  const rows = [
    { id: "a", companyId: ACME },
    { id: "b", companyId: RIVAL },
    { id: "c" }, // pre-migration row, no tenant stamp
  ];

  it("keeps only the active company's rows", () => {
    expect(filterByCompany(rows, ACME)).toEqual([{ id: "a", companyId: ACME }]);
  });

  // The whole point: an unstamped row must not match everyone.
  it("excludes rows with no company stamp", () => {
    expect(filterByCompany(rows, ACME).some((r) => r.id === "c")).toBe(false);
    expect(filterByCompany(rows, RIVAL).some((r) => r.id === "c")).toBe(false);
  });

  it("returns nothing when there is no active company", () => {
    expect(filterByCompany(rows, null)).toEqual([]);
  });
});

describe("belongsToCompany", () => {
  it("accepts a matching record", () => {
    expect(belongsToCompany({ companyId: ACME }, ACME)).toBe(true);
  });

  it("rejects another company's record", () => {
    expect(belongsToCompany({ companyId: RIVAL }, ACME)).toBe(false);
  });

  it("rejects an unstamped record", () => {
    expect(belongsToCompany({}, ACME)).toBe(false);
  });

  it("rejects when there is no active company", () => {
    expect(belongsToCompany({ companyId: ACME }, null)).toBe(false);
  });

  it("rejects a null record", () => {
    expect(belongsToCompany(null, ACME)).toBe(false);
  });
});

describe("normalizeCompanyName", () => {
  // Typo-variant names must resolve to the same existing company in the picker,
  // rather than silently minting a second tenant.
  it("treats case and whitespace variants as the same name", () => {
    const canonical = normalizeCompanyName("Acme Logistics");
    expect(normalizeCompanyName("  acme   logistics ")).toBe(canonical);
    expect(normalizeCompanyName("ACME LOGISTICS")).toBe(canonical);
  });

  it("keeps genuinely different names distinct", () => {
    expect(normalizeCompanyName("Acme Logistics")).not.toBe(
      normalizeCompanyName("Acme Logistics LLC"),
    );
  });
});

describe("newCompanyId", () => {
  it("is opaque and non-sequential", () => {
    const ids = new Set(Array.from({ length: 50 }, () => newCompanyId()));
    expect(ids.size).toBe(50);
    for (const id of ids) expect(id).not.toMatch(/^\d+$/);
  });
});
