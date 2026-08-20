import { describe, expect, it } from "vitest";

import { directoryCompanyOf, isVisibleInDirectory } from "@/lib/tenant/directory-scope";

const ACME = { companyId: "acme" };
const GLOBEX_ADMIN = { companyId: "globex" };

describe("the bug this replaced", () => {
  // The old filter was:
  //   !user.companyId || user.companyId === context.companyId
  // Rule B means a Driver never has a companyId, so the first clause was always
  // true for them and every company saw every driver in the pool.
  it("hides a driver from a company that does not employ them", () => {
    const driver = { role: "Driver", employerCompanyId: "acme" };
    expect(isVisibleInDirectory(driver, ACME)).toBe(true);
    expect(isVisibleInDirectory(driver, GLOBEX_ADMIN)).toBe(false);
  });

  it("does not fall through to visible when a driver has no employer recorded", () => {
    // This is the exact shape the old carve-out let through.
    const orphan = { role: "Driver" };
    expect(isVisibleInDirectory(orphan, ACME)).toBe(false);
    expect(isVisibleInDirectory(orphan, GLOBEX_ADMIN)).toBe(false);
  });

  it("ignores a companyId that somehow appears on a driver", () => {
    // Rule B says this should not exist. If it ever does, it must not become a
    // second route to visibility.
    const malformed = { role: "Driver", companyId: "globex", employerCompanyId: "acme" };
    expect(isVisibleInDirectory(malformed, GLOBEX_ADMIN)).toBe(false);
    expect(isVisibleInDirectory(malformed, ACME)).toBe(true);
  });
});

describe("non-exempt users", () => {
  it("are scoped to their own company", () => {
    const user = { role: "Operations Manager", companyId: "acme" };
    expect(isVisibleInDirectory(user, ACME)).toBe(true);
    expect(isVisibleInDirectory(user, GLOBEX_ADMIN)).toBe(false);
  });

  it("keep the unassigned carve-out so they can be assigned a company", () => {
    const pending = { role: "Operations Manager" };
    expect(isVisibleInDirectory(pending, ACME)).toBe(true);
    expect(isVisibleInDirectory(pending, GLOBEX_ADMIN)).toBe(true);
  });

  it("treats an unknown role as non-exempt, not as a driver", () => {
    // strictRole returns null for anything unrecognised. A null role must not
    // take the employer branch, or an unrecognised value would hide a user.
    const odd = { role: undefined, companyId: "acme" };
    expect(isVisibleInDirectory(odd, ACME)).toBe(true);
    expect(isVisibleInDirectory(odd, GLOBEX_ADMIN)).toBe(false);
  });
});

describe("viewers", () => {
  it("with no company see nothing", () => {
    // The old code listed the entire pool here, to make the first assignment
    // possible. A platform admin does that job now.
    const user = { role: "Operations Manager", companyId: "acme" };
    expect(isVisibleInDirectory(user, {})).toBe(false);
    expect(isVisibleInDirectory({ role: "Driver" }, {})).toBe(false);
  });

  it("who are platform admins see everyone, including orphaned drivers", () => {
    const viewer = { isPlatformAdmin: true };
    expect(isVisibleInDirectory({ role: "Driver" }, viewer)).toBe(true);
    expect(isVisibleInDirectory({ role: "Driver", employerCompanyId: "x" }, viewer)).toBe(true);
    expect(isVisibleInDirectory({ companyId: "anything" }, viewer)).toBe(true);
  });

  it("who are platform admins with no company still see everyone", () => {
    // Otherwise the bootstrap case would fail closed with nobody able to fix it.
    expect(isVisibleInDirectory({ companyId: "acme" }, { isPlatformAdmin: true })).toBe(true);
  });
});

describe("whitespace is not a company", () => {
  it("treats a blank employer as absent", () => {
    expect(isVisibleInDirectory({ role: "Driver", employerCompanyId: "   " }, ACME)).toBe(false);
  });

  it("treats a blank viewer company as no context", () => {
    expect(isVisibleInDirectory({ companyId: "acme" }, { companyId: "  " })).toBe(false);
  });
});

describe("directoryCompanyOf", () => {
  it("reads the employer for a driver and the company for everyone else", () => {
    expect(directoryCompanyOf({ role: "Driver", employerCompanyId: "acme" })).toBe("acme");
    expect(directoryCompanyOf({ role: "Dispatcher", companyId: "acme" })).toBe("acme");
  });

  it("never reports a company for a driver that only has companyId", () => {
    expect(directoryCompanyOf({ role: "Driver", companyId: "acme" })).toBeNull();
  });

  it("returns null when nothing is recorded", () => {
    expect(directoryCompanyOf({})).toBeNull();
    expect(directoryCompanyOf({ role: "Driver" })).toBeNull();
  });
});
