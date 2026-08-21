import { UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { beforeEach, describe, expect, it, vi } from "vitest";

const requireCurrentTenantContext = vi.fn();
const authorizeAdminRequest = vi.fn();
const send = vi.fn();

vi.mock("@/lib/tenant/request-context", () => ({
  requireCurrentTenantContext: (...a: unknown[]) => requireCurrentTenantContext(...a),
}));

vi.mock("@/lib/ai/ai-authz", () => ({
  authorizeAdminRequest: (...a: unknown[]) => authorizeAdminRequest(...a),
}));

vi.mock("@/lib/ai/server-aws", () => ({
  getAiDynamoClient: async () => ({ send: (...a: unknown[]) => send(...a) }),
  getWorkspaceSettingsTable: () => "WorkspaceSettings",
}));

vi.mock("@/lib/server/server-dynamo", () => ({
  getServerDataClient: () => ({ send: (...a: unknown[]) => send(...a) }),
}));

const { handleSettingsResendWriteRequest } = await import("@/lib/settings-resend");
const { companySecretKey, RESEND_SECRET_SECTION } = await import("@/lib/ai/settings-scopes");

const ACME = "11111111-1111-4111-8111-111111111111";
const RIVAL = "22222222-2222-4222-8222-222222222222";

function req(body: unknown): Request {
  return new Request("https://example.test/api/settings/integrations/resend", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  requireCurrentTenantContext.mockReset();
  authorizeAdminRequest.mockReset();
  send.mockReset().mockResolvedValue({ Item: { data: { apiKey: "re_acme", enabled: true } } });
  authorizeAdminRequest.mockResolvedValue({ ok: true, sub: "admin-1", role: "Admin" });
  requireCurrentTenantContext.mockResolvedValue({
    userId: "admin-1",
    role: "Admin",
    companyId: ACME,
    isTenantExempt: false,
    isPlatformAdmin: false,
    sessionEpoch: null,
  });
});

describe("Resend secret is per company", () => {
  it("writes under secrets / <companyId>#resend, never the unscoped row", async () => {
    const response = await handleSettingsResendWriteRequest(
      req({ apiKey: "re_acme_only", fromEmail: "desk@acme.com", enabled: true }),
    );
    expect(response.status).toBe(200);
    const updates = send.mock.calls
      .map(([command]) => command)
      .filter((command) => command instanceof UpdateCommand);
    expect(updates.length).toBeGreaterThan(0);
    for (const command of updates) {
      const key = (command as { input?: { Key?: { scope?: string; section?: string } } }).input?.Key;
      expect(key).toEqual(companySecretKey(ACME, RESEND_SECRET_SECTION));
      expect(key?.section).not.toBe("resend");
      expect(key?.section).not.toContain(RIVAL);
    }
  });
});
