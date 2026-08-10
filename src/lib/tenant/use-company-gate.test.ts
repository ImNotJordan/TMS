import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchAuthSession = vi.fn();
const ensureCompanyContext = vi.fn();
const refreshCompanyContext = vi.fn();

vi.mock("aws-amplify/auth", () => ({
  fetchAuthSession: (...a: unknown[]) => fetchAuthSession(...a),
}));
vi.mock("@/lib/tenant/company-context", () => ({
  ensureCompanyContext: (...a: unknown[]) => ensureCompanyContext(...a),
  refreshCompanyContext: (...a: unknown[]) => refreshCompanyContext(...a),
}));

// The decision function, not the hook — the tenancy rules live here, and the
// hook is state plumbing around it.
const { resolveCompanyGateState } = await import("@/lib/tenant/use-company-gate");

function tokenWith(claims: Record<string, unknown>) {
  fetchAuthSession.mockResolvedValue({ tokens: { idToken: { payload: claims } } });
}

beforeEach(() => {
  fetchAuthSession.mockReset();
  ensureCompanyContext.mockReset().mockResolvedValue(null);
  refreshCompanyContext.mockReset().mockResolvedValue(null);
  tokenWith({ sub: "u1" });
});

describe("an assigned user gets the app", () => {
  it("is ready when a company resolves", async () => {
    ensureCompanyContext.mockResolvedValue({ companyId: "acme", companyName: "Acme" });
    await expect(resolveCompanyGateState()).resolves.toBe("ready");
  });
});

describe("an unassigned user is gated", () => {
  it("needs a company when none resolves", async () => {
    ensureCompanyContext.mockResolvedValue(null);
    await expect(resolveCompanyGateState()).resolves.toBe("needs-company");
  });
});

describe("Rule B — drivers are exempt, not gated", () => {
  it("lets a Driver through without a company", async () => {
    // Gating a driver on having a companyId would lock them out permanently:
    // Rule B says they must never be assigned one.
    tokenWith({ sub: "d1", "custom:role": "Driver" });
    ensureCompanyContext.mockResolvedValue(null);

    await expect(resolveCompanyGateState()).resolves.toBe("ready");
    // Short-circuited: no point resolving a company for someone who must not
    // have one.
    expect(ensureCompanyContext).not.toHaveBeenCalled();
  });

  it("recognises Driver from a Cognito group too", async () => {
    tokenWith({ sub: "d1", "cognito:groups": ["Driver"] });
    await expect(resolveCompanyGateState()).resolves.toBe("ready");
  });
});

describe("platform operators are exempt", () => {
  it("lets a SuperAdmin group member through", async () => {
    // Onboarding the first company means acting before any company exists.
    tokenWith({ sub: "p1", "cognito:groups": ["SuperAdmin"] });
    ensureCompanyContext.mockResolvedValue(null);
    await expect(resolveCompanyGateState()).resolves.toBe("ready");
  });

  it("lets a platform-admin group member through", async () => {
    tokenWith({ sub: "p1", "cognito:groups": ["platform-admin"] });
    await expect(resolveCompanyGateState()).resolves.toBe("ready");
  });

  it("ignores a claimed platform role that is not a group membership", async () => {
    // The Profile role is browser-writable. If a stored "SuperAdmin" string
    // conferred exemption, a user could promote themselves past the gate.
    tokenWith({ sub: "u1", "custom:role": "SuperAdmin" });
    ensureCompanyContext.mockResolvedValue(null);
    await expect(resolveCompanyGateState()).resolves.toBe("needs-company");
  });
});

describe("rechecking after an assignment", () => {
  it("forces a token refresh, because the claim only changes on a new token", async () => {
    refreshCompanyContext.mockResolvedValue({ companyId: "acme", companyName: "Acme" });

    await expect(resolveCompanyGateState({ forceRefresh: true })).resolves.toBe("ready");
    expect(refreshCompanyContext).toHaveBeenCalled();
    expect(ensureCompanyContext).not.toHaveBeenCalled();
  });

  it("stays gated when the assignment still has not happened", async () => {
    refreshCompanyContext.mockResolvedValue(null);
    await expect(resolveCompanyGateState({ forceRefresh: true })).resolves.toBe("needs-company");
  });
});

describe("fail closed", () => {
  it("gates when the token cannot be read", async () => {
    fetchAuthSession.mockRejectedValue(new Error("no session"));
    ensureCompanyContext.mockResolvedValue(null);
    await expect(resolveCompanyGateState()).resolves.toBe("needs-company");
  });

  it("gates when the session carries no claims", async () => {
    fetchAuthSession.mockResolvedValue({ tokens: undefined });
    ensureCompanyContext.mockResolvedValue(null);
    await expect(resolveCompanyGateState()).resolves.toBe("needs-company");
  });

  it("does not treat an unrecognised role as exempt", async () => {
    // normalizeRole would answer "Operations Manager" here; strictRole answers
    // null, and null is not an exemption.
    tokenWith({ sub: "u1", "custom:role": "definitely-not-a-role" });
    ensureCompanyContext.mockResolvedValue(null);
    await expect(resolveCompanyGateState()).resolves.toBe("needs-company");
  });

  it("does not treat a driver-ish string as a Driver", async () => {
    tokenWith({ sub: "u1", "custom:role": "driver-supervisor" });
    ensureCompanyContext.mockResolvedValue(null);
    await expect(resolveCompanyGateState()).resolves.toBe("needs-company");
  });

  it("does not treat an admin-ish string as a platform operator", async () => {
    // normalizeRole returns "Admin" for anything containing "admin".
    tokenWith({ sub: "u1", "custom:role": "readonly-admin" });
    ensureCompanyContext.mockResolvedValue(null);
    await expect(resolveCompanyGateState()).resolves.toBe("needs-company");
  });
});
