import { beforeEach, describe, expect, it, vi } from "vitest";

const tryVerifiedIdClaims = vi.fn();
const authorizeAiRequest = vi.fn();
const send = vi.fn();

vi.mock("@/lib/ai/cognito-request-credentials", () => ({
  tryVerifiedIdClaims: (...a: unknown[]) => tryVerifiedIdClaims(...a),
  CognitoRequestAuthFailure: class CognitoRequestAuthFailure extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.code = code;
    }
  },
}));

vi.mock("@/lib/ai/ai-authz", () => ({
  authorizeAiRequest: (...a: unknown[]) => authorizeAiRequest(...a),
}));

vi.mock("@/lib/ai/server-aws", () => ({
  getAiDynamoClient: async () => ({ send: (...a: unknown[]) => send(...a) }),
  getWorkspaceSettingsTable: () => "WorkspaceSettings",
}));

const { getConnectedOpenAiConfig, invalidateOpenAiConfigCache } = await import(
  "@/lib/ai/get-openai-key"
);
const { companySecretKey, OPENAI_SECRET_SECTION } = await import("@/lib/ai/settings-scopes");
const { COMPANY_ID_CLAIM } = await import("@/lib/tenant/server-tenant-context");

const ACME = "11111111-1111-4111-8111-111111111111";
const RIVAL = "22222222-2222-4222-8222-222222222222";

function asCompany(companyId: string, sub = "user-1") {
  tryVerifiedIdClaims.mockResolvedValue({
    sub,
    iss: "https://example",
    token_use: "id",
    exp: 9e9,
    iat: 1,
    [COMPANY_ID_CLAIM]: companyId,
  });
  authorizeAiRequest.mockResolvedValue({ ok: true, sub, role: "Dispatcher" });
}

beforeEach(() => {
  tryVerifiedIdClaims.mockReset();
  authorizeAiRequest.mockReset();
  send.mockReset();
  invalidateOpenAiConfigCache();
});

describe("OpenAI key isolation", () => {
  it("reads only that company's secrets row", async () => {
    asCompany(ACME);
    send.mockResolvedValue({ Item: { data: { apiKey: "sk-acme", enabled: true } } });
    const result = await getConnectedOpenAiConfig(new Request("https://example.test/api/ai"), {
      bypassCache: true,
    });
    expect(result).toMatchObject({ status: "ok", apiKey: "sk-acme" });
    const key = (send.mock.calls[0]?.[0] as { input?: { Key?: unknown } }).input?.Key;
    expect(key).toEqual(companySecretKey(ACME, OPENAI_SECRET_SECTION));
  });

  it("does not serve a cached key from another company", async () => {
    asCompany(ACME, "acme-user");
    send.mockResolvedValue({ Item: { data: { apiKey: "sk-acme", enabled: true } } });
    await getConnectedOpenAiConfig(new Request("https://example.test/api/ai"), {
      bypassCache: true,
    });

    asCompany(RIVAL, "rival-user");
    send.mockResolvedValue({ Item: { data: { apiKey: "sk-rival", enabled: true } } });
    const rival = await getConnectedOpenAiConfig(new Request("https://example.test/api/ai"));
    expect(rival).toMatchObject({ status: "ok", apiKey: "sk-rival" });
    expect(rival.status === "ok" && rival.apiKey).not.toBe("sk-acme");
  });

  it("does not fall back to a shared key when the company has none", async () => {
    asCompany(ACME);
    send.mockResolvedValue({ Item: undefined });
    const result = await getConnectedOpenAiConfig(new Request("https://example.test/api/ai"), {
      bypassCache: true,
    });
    expect(result.status).toBe("not_connected");
    expect(send).toHaveBeenCalledTimes(1);
  });
});
