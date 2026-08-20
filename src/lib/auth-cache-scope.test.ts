import { describe, expect, it } from "vitest";

import { cacheScopeOf, shouldPurgeForScopeChange } from "@/lib/auth-cache-scope";

const ALICE = "alice-sub";
const BOB = "bob-sub";

describe("cacheScopeOf", () => {
  it("combines user and company", () => {
    expect(cacheScopeOf(ALICE, "acme")).toBe(`${ALICE}:acme`);
  });

  it("distinguishes no-company from a company literally named none", () => {
    // Both render as "none" — acceptable only because a companyId is an opaque
    // uuid, never a display name. Asserted so a future change to human-readable
    // ids has to confront it.
    expect(cacheScopeOf(ALICE, null)).toBe(`${ALICE}:none`);
    expect(cacheScopeOf(ALICE, undefined)).toBe(`${ALICE}:none`);
  });

  it("does not collide across users", () => {
    expect(cacheScopeOf(ALICE, "acme")).not.toBe(cacheScopeOf(BOB, "acme"));
  });
});

describe("shouldPurgeForScopeChange", () => {
  it("purges when a different user signs in", () => {
    // The leak this exists to close: same tab, no reload, Bob reading Alice's
    // cached ["loads"].
    expect(shouldPurgeForScopeChange(cacheScopeOf(ALICE, "acme"), cacheScopeOf(BOB, "acme"))).toBe(
      true,
    );
  });

  it("purges when the same user is reassigned to another company", () => {
    expect(
      shouldPurgeForScopeChange(cacheScopeOf(ALICE, "acme"), cacheScopeOf(ALICE, "globex")),
    ).toBe(true);
  });

  it("purges when a user gains a company they did not have", () => {
    // The onboarding gate opening. Anything cached while unassigned was fetched
    // against no tenant.
    expect(shouldPurgeForScopeChange(cacheScopeOf(ALICE, null), cacheScopeOf(ALICE, "acme"))).toBe(
      true,
    );
  });

  it("does not purge on the first load of a page", () => {
    // Nothing has been cached under another identity yet.
    expect(shouldPurgeForScopeChange(null, cacheScopeOf(ALICE, "acme"))).toBe(false);
  });

  it("does not purge on a plain token refresh", () => {
    // Tab focus revalidates the session and calls loadUser again. Purging here
    // would throw the cache away every time the user switched windows.
    const scope = cacheScopeOf(ALICE, "acme");
    expect(shouldPurgeForScopeChange(scope, scope)).toBe(false);
  });

  it("does not purge for an unassigned user re-checking", () => {
    // The "Check again" button on the onboarding screen, before assignment.
    const scope = cacheScopeOf(ALICE, null);
    expect(shouldPurgeForScopeChange(scope, scope)).toBe(false);
  });
});
