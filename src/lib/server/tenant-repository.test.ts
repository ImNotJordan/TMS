import { beforeEach, describe, expect, it, vi } from "vitest";

const send = vi.fn();
vi.mock("@/lib/server/server-dynamo", () => ({
  getServerDataClient: () => ({ send: (...a: unknown[]) => send(...a) }),
}));

const { RecordNotFoundError, createTenantRepository } =
  await import("@/lib/server/tenant-repository");
const { MissingTenantError, TenantForbiddenError } =
  await import("@/lib/tenant/server-tenant-context");

const ACME = "11111111-1111-4111-8111-111111111111";
const RIVAL = "22222222-2222-4222-8222-222222222222";

type Load = {
  loadId: string;
  createdAt: string;
  updatedAt: string;
  companyId?: string;
  createdBy?: string;
  customer?: string;
  customerRate?: string;
};

const loads = createTenantRepository<Load>({
  table: () => "Loads",
  idKey: "loadId",
  label: "Load",
  companyIndex: "companyId-index",
});

function ctx(overrides: Record<string, unknown> = {}) {
  return {
    userId: "user-1",
    role: "Dispatcher" as const,
    companyId: ACME,
    isTenantExempt: false,
    isPlatformAdmin: false,
    sessionEpoch: null,
    ...overrides,
  };
}

/** The command the repository sent, by SDK class name. */
function sentCommand(name: string) {
  return send.mock.calls
    .map(([c]) => c as { constructor: { name: string }; input: Record<string, unknown> })
    .find((c) => c.constructor.name === name);
}

/**
 * Make the next send reject as DynamoDB would on a failed condition.
 *
 * `Once`, deliberately. A persistent throwing implementation outlives the test
 * that installed it and surfaces as an unhandled rejection attributed to
 * whichever test happens to be running — which reads as a repository bug when
 * it is a mock-lifetime bug.
 */
function rejectWithConditionFailure() {
  send.mockImplementationOnce(async () => {
    throw Object.assign(new Error("condition"), {
      name: "ConditionalCheckFailedException",
    });
  });
}

beforeEach(() => send.mockReset().mockResolvedValue({}));

describe("list", () => {
  it("queries the company GSI, never a Scan", async () => {
    send.mockResolvedValue({ Items: [{ loadId: "L-1", companyId: ACME }] });
    await loads.list(ctx());

    expect(sentCommand("ScanCommand")).toBeUndefined();
    const query = sentCommand("QueryCommand");
    expect(query?.input).toMatchObject({
      IndexName: "companyId-index",
      KeyConditionExpression: "companyId = :companyId",
      ExpressionAttributeValues: { ":companyId": ACME },
    });
  });

  it("follows pagination rather than returning the first page", async () => {
    send
      .mockResolvedValueOnce({ Items: [{ loadId: "L-1" }], LastEvaluatedKey: { loadId: "L-1" } })
      .mockResolvedValueOnce({ Items: [{ loadId: "L-2" }] });

    await expect(loads.list(ctx())).resolves.toHaveLength(2);
  });

  // The property the whole module exists for.
  it("cannot be called without a company", async () => {
    await expect(loads.list(ctx({ companyId: null }))).rejects.toBeInstanceOf(MissingTenantError);
    expect(send).not.toHaveBeenCalled();
  });

  it("refuses a tenant-exempt role on a company-scoped read", async () => {
    await expect(loads.list(ctx({ isTenantExempt: true, role: "Driver" }))).rejects.toBeInstanceOf(
      TenantForbiddenError,
    );
    expect(send).not.toHaveBeenCalled();
  });
});

describe("get", () => {
  it("returns the record when the company matches", async () => {
    send.mockResolvedValue({ Item: { loadId: "L-1", companyId: ACME } });
    await expect(loads.get(ctx(), "L-1")).resolves.toMatchObject({ loadId: "L-1" });
  });

  // Cross-tenant reads as absent, not forbidden.
  it("returns null for another company's record", async () => {
    send.mockResolvedValue({ Item: { loadId: "L-1", companyId: RIVAL } });
    await expect(loads.get(ctx(), "L-1")).resolves.toBeNull();
  });

  it("returns null for an unstamped record", async () => {
    send.mockResolvedValue({ Item: { loadId: "L-1" } });
    await expect(loads.get(ctx(), "L-1")).resolves.toBeNull();
  });

  it("reports a foreign record identically to a missing one", async () => {
    send.mockResolvedValue({ Item: { loadId: "L-1", companyId: RIVAL } });
    const foreignError = await loads.getOrThrow(ctx(), "L-1").catch((e) => e);

    send.mockResolvedValue({ Item: undefined });
    const missingError = await loads.getOrThrow(ctx(), "nope").catch((e) => e);

    expect(foreignError).toBeInstanceOf(RecordNotFoundError);
    expect(foreignError.message).toBe(missingError.message);
  });

  it("leaks no identifier in the error", async () => {
    send.mockResolvedValue({ Item: { loadId: "L-1", companyId: RIVAL } });
    const err = await loads.getOrThrow(ctx(), "L-1").catch((e) => e);
    expect(err.message).not.toMatch(/L-1|11111111|22222222/);
  });
});

describe("create", () => {
  it("stamps the caller's company", async () => {
    const created = await loads.create(ctx(), { loadId: "L-9", customer: "Acme" } as never);
    expect(created.companyId).toBe(ACME);
    expect(sentCommand("PutCommand")?.input.Item).toMatchObject({ companyId: ACME });
  });

  // Mass assignment: the payload does not get to choose the tenant.
  it("overwrites a companyId supplied on the input", async () => {
    const created = await loads.create(ctx(), {
      loadId: "L-9",
      companyId: RIVAL,
    } as never);
    expect(created.companyId).toBe(ACME);
  });

  it("records the creator from the context, not the payload", async () => {
    const created = await loads.create(ctx(), {
      loadId: "L-9",
      createdBy: "somebody-else",
    } as never);
    expect(created.createdBy).toBe("user-1");
  });

  it("cannot be called without a company", async () => {
    await expect(
      loads.create(ctx({ companyId: null }), { loadId: "L-9" } as never),
    ).rejects.toBeInstanceOf(MissingTenantError);
    expect(send).not.toHaveBeenCalled();
  });
});

describe("update", () => {
  it("is a single scoped statement, not fetch-then-check", async () => {
    send.mockResolvedValue({ Attributes: { loadId: "L-1", companyId: ACME } });
    await loads.update(ctx(), "L-1", { customer: "New" });

    // No read before the write.
    expect(sentCommand("GetCommand")).toBeUndefined();
    const update = sentCommand("UpdateCommand");
    expect(update?.input.ConditionExpression).toBe(
      "attribute_exists(loadId) AND companyId = :ctxCompany",
    );
    expect(update?.input.ExpressionAttributeValues).toMatchObject({ ":ctxCompany": ACME });
  });

  it("reports a cross-tenant miss as not found", async () => {
    rejectWithConditionFailure();
    const err = await loads.update(ctx(), "L-1", { customer: "New" }).catch((e) => e);
    expect(err).toBeInstanceOf(RecordNotFoundError);
  });

  // A record cannot be moved between tenants by an ordinary edit.
  it("ignores companyId in the patch", async () => {
    send.mockResolvedValue({ Attributes: { loadId: "L-1", companyId: ACME } });
    await loads.update(ctx(), "L-1", { companyId: RIVAL, customer: "New" } as Partial<Load>);

    const names = sentCommand("UpdateCommand")?.input.ExpressionAttributeNames as Record<
      string,
      string
    >;
    expect(Object.values(names)).not.toContain("companyId");
    expect(Object.values(names)).toContain("customer");
  });

  it("ignores createdAt in the patch", async () => {
    // Nothing left to set once createdAt is filtered out, so it falls through
    // to a read rather than issuing an update.
    send.mockResolvedValue({ Item: { loadId: "L-1", companyId: ACME } });
    await expect(
      loads.update(ctx(), "L-1", { createdAt: "1970-01-01" } as Partial<Load>),
    ).resolves.toMatchObject({ loadId: "L-1" });
    expect(sentCommand("UpdateCommand")).toBeUndefined();
  });
});

describe("remove", () => {
  it("is scoped in the same statement", async () => {
    await loads.remove(ctx(), "L-1");
    expect(sentCommand("DeleteCommand")?.input.ConditionExpression).toBe(
      "attribute_exists(loadId) AND companyId = :ctxCompany",
    );
  });

  it("reports a cross-tenant miss as not found", async () => {
    rejectWithConditionFailure();
    const err = await loads.remove(ctx(), "L-1").catch((e) => e);
    expect(err).toBeInstanceOf(RecordNotFoundError);
  });

  it("cannot be called without a company", async () => {
    await expect(loads.remove(ctx({ companyId: null }), "L-1")).rejects.toBeInstanceOf(
      MissingTenantError,
    );
    expect(send).not.toHaveBeenCalled();
  });
});
