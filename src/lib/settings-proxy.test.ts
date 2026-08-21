import { UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { beforeEach, describe, expect, it, vi } from "vitest";

const requireCurrentTenantContext = vi.fn();
const authorizeAdminRequest = vi.fn();
const authorizeAiRequest = vi.fn();
const send = vi.fn();
const invalidateOpenAiConfigCache = vi.fn();
const readChinaTaxSecret = vi.fn();

vi.mock("@/lib/tenant/request-context", () => ({
  requireCurrentTenantContext: (...a: unknown[]) => requireCurrentTenantContext(...a),
}));

vi.mock("@/lib/ai/ai-authz", () => ({
  authorizeAdminRequest: (...a: unknown[]) => authorizeAdminRequest(...a),
  authorizeAiRequest: (...a: unknown[]) => authorizeAiRequest(...a),
}));

vi.mock("@/lib/ai/server-aws", () => ({
  getAiDynamoClient: async () => ({ send: (...a: unknown[]) => send(...a) }),
  getWorkspaceSettingsTable: () => "WorkspaceSettings",
}));

vi.mock("@/lib/ai/get-openai-key", () => ({
  invalidateOpenAiConfigCache: (...a: unknown[]) => invalidateOpenAiConfigCache(...a),
}));

vi.mock("@/lib/settings-china-tax", () => ({
  describeChinaTaxSecret: () => ({ connected: false, provider: null, endpoint: null }),
  readChinaTaxSecret: (...a: unknown[]) => readChinaTaxSecret(...a),
  handleSettingsChinaTaxWriteRequest: vi.fn(),
  isSettingsChinaTaxWriteRequest: vi.fn(),
}));

vi.mock("@/lib/settings-resend", () => ({
  describeResendSecret: () => ({ connected: false, fromEmail: null }),
  readResendSecret: vi.fn().mockResolvedValue(null),
  handleSettingsResendWriteRequest: vi.fn(),
  isSettingsResendWriteRequest: vi.fn(),
}));

const { handleSettingsAiWriteRequest, handleSettingsStatusRequest, readOpenAiSecret } =
  await import("@/lib/settings-proxy");
const { companySecretKey, OPENAI_SECRET_SECTION } = await import("@/lib/ai/settings-scopes");

const ACME = "11111111-1111-4111-8111-111111111111";
const RIVAL = "22222222-2222-4222-8222-222222222222";

function req(method: string, body?: unknown): Request {
  return new Request("https://example.test/api/settings/integrations/ai", {
    method,
    ...(body === undefined
      ? {}
      : { body: JSON.stringify(body), headers: { "Content-Type": "application/json" } }),
  });
}

function signedInAs(companyId: string) {
  requireCurrentTenantContext.mockResolvedValue({
    userId: "admin-1",
    role: "Admin",
    companyId,
    isTenantExempt: false,
    isPlatformAdmin: false,
    sessionEpoch: null,
  });
  authorizeAdminRequest.mockResolvedValue({ ok: true, sub: "admin-1", role: "Admin" });
  authorizeAiRequest.mockResolvedValue({ ok: true, sub: "admin-1", role: "Admin" });
}

function commandKey(command: unknown): { scope?: string; section?: string } {
  return (command as { input?: { Key?: { scope?: string; section?: string } } }).input?.Key ?? {};
}

beforeEach(() => {
  requireCurrentTenantContext.mockReset();
  authorizeAdminRequest.mockReset();
  authorizeAiRequest.mockReset();
  send.mockReset();
  invalidateOpenAiConfigCache.mockReset();
  readChinaTaxSecret.mockReset().mockResolvedValue(null);
  send.mockResolvedValue({ Item: { data: { apiKey: "sk-acme-secret", enabled: true } } });
});

describe("settings secrets are per company", () => {
  it("writes the OpenAI key under that company's secrets sort key", async () => {
    signedInAs(ACME);
    const response = await handleSettingsAiWriteRequest(
      req("POST", { apiKey: "sk-acme-only", enabled: true }),
    );
    expect(response.status).toBe(200);

    const updates = send.mock.calls
      .map(([command]) => command)
      .filter((command) => command instanceof UpdateCommand);
    expect(updates.length).toBeGreaterThan(0);
    for (const command of updates) {
      expect(commandKey(command)).toEqual(companySecretKey(ACME, OPENAI_SECRET_SECTION));
      expect(commandKey(command).section).not.toBe("openai");
    }
    expect(invalidateOpenAiConfigCache).toHaveBeenCalledWith(ACME);
  });

  it("does not read the unscoped openai row or another company's key", async () => {
    signedInAs(RIVAL);
    send.mockResolvedValue({ Item: { data: { apiKey: "sk-rival-only", enabled: true } } });
    await readOpenAiSecret(req("GET"), RIVAL);

    const get = send.mock.calls[0]?.[0] as { input?: { Key?: { section?: string } } };
    expect(get.input?.Key).toEqual(companySecretKey(RIVAL, OPENAI_SECRET_SECTION));
    expect(get.input?.Key?.section).not.toBe(companySecretKey(ACME, OPENAI_SECRET_SECTION).section);
    expect(get.input?.Key?.section).not.toBe("openai");
  });

  it("status asks Dynamo for the caller's company, not the shared row", async () => {
    signedInAs(ACME);
    send.mockResolvedValue({ Item: { data: { apiKey: "sk-acme-secret", enabled: true } } });
    const response = await handleSettingsStatusRequest(req("GET"));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { ai: { last4?: string; connected: boolean } };
    expect(body.ai.connected).toBe(true);
    expect(body.ai.last4).toBe("cret");

    expect(commandKey(send.mock.calls[0]?.[0])).toEqual(
      companySecretKey(ACME, OPENAI_SECRET_SECTION),
    );
    expect(readChinaTaxSecret).toHaveBeenCalledWith(expect.any(Request), ACME);
  });

  it("refuses a settings write when the caller has no company", async () => {
    requireCurrentTenantContext.mockResolvedValue({
      userId: "admin-1",
      role: "Admin",
      companyId: null,
      isTenantExempt: false,
      isPlatformAdmin: false,
      sessionEpoch: null,
    });
    authorizeAdminRequest.mockResolvedValue({ ok: true, sub: "admin-1", role: "Admin" });

    const response = await handleSettingsAiWriteRequest(req("POST", { apiKey: "sk-x" }));
    expect(response.status).toBe(403);
    expect(send).not.toHaveBeenCalled();
  });
});
