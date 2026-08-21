import { GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { beforeEach, describe, expect, it, vi } from "vitest";

const requireCompanyId = vi.fn();
const send = vi.fn();

vi.mock("@/lib/tenant/company-context", () => ({
  requireCompanyId: (...a: unknown[]) => requireCompanyId(...a),
}));

vi.mock("@/lib/dynamodb", () => ({
  isWorkspaceSettingsConfigured: () => true,
  getWorkspaceSettingsTableName: () => "WorkspaceSettings",
  getDynamoDocClient: async () => ({ send: (...a: unknown[]) => send(...a) }),
  getAwsRegion: () => "us-west-1",
  getProfileTableName: () => "UsersTable",
  isDynamoAccessDenied: () => false,
  isDynamoConfigured: () => true,
  isDynamoResourceNotFound: () => false,
}));

vi.mock("@/lib/rate-limit", () => ({
  createRateLimitedExecutor: () => (fn: () => Promise<unknown>) => fn(),
}));

const { getWorkspaceSetting, putWorkspaceSetting } = await import(
  "@/lib/workspace-settings-store"
);
const { companySettingsScope } = await import("@/lib/ai/settings-scopes");

const ACME = "11111111-1111-4111-8111-111111111111";
const RIVAL = "22222222-2222-4222-8222-222222222222";

beforeEach(() => {
  requireCompanyId.mockReset();
  send.mockReset();
});

describe("workspace settings tenancy", () => {
  it("reads and writes the caller's company partition, never global", async () => {
    requireCompanyId.mockResolvedValue(ACME);
    send.mockResolvedValue({ Item: { data: { googleMaps: { apiKey: "AIza-acme" } } } });

    await getWorkspaceSetting("integrations");
    const get = send.mock.calls[0]?.[0];
    expect(get).toBeInstanceOf(GetCommand);
    expect((get as GetCommand).input.Key).toEqual({
      scope: companySettingsScope(ACME),
      section: "integrations",
    });
    expect((get as GetCommand).input.Key?.scope).not.toBe("global");

    send.mockResolvedValue({});
    await putWorkspaceSetting("integrations", { googleMaps: { apiKey: "AIza-acme" } });
    const put = send.mock.calls[1]?.[0];
    expect(put).toBeInstanceOf(PutCommand);
    expect((put as PutCommand).input.Item?.scope).toBe(ACME);
    expect((put as PutCommand).input.Item?.scope).not.toBe("global");
  });

  it("does not read a rival company's row", async () => {
    requireCompanyId.mockResolvedValue(RIVAL);
    send.mockResolvedValue({ Item: undefined });
    await getWorkspaceSetting("appSettings");
    expect((send.mock.calls[0]?.[0] as GetCommand).input.Key?.scope).toBe(RIVAL);
    expect((send.mock.calls[0]?.[0] as GetCommand).input.Key?.scope).not.toBe(ACME);
  });
});
