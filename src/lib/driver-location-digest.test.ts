import { beforeEach, describe, expect, it, vi } from "vitest";

import type { LoadRecord } from "@/lib/loads-store";
import {
  digestIsDue,
  projectDigestRows,
  recipientsFromSettings,
  runCompanyDriverLocationDigest,
  type DigestDeps,
} from "@/lib/driver-location-digest";

const COMPANY = { companyId: "company-1", companyName: "Oakwell AG" };

function deps(overrides: Partial<DigestDeps> = {}): DigestDeps {
  return {
    listCompanies: async () => [COMPANY],
    readResend: async () => ({
      apiKey: "re_test",
      fromEmail: "desk@oakwell.com",
      enabled: true,
    }),
    readAppSettings: async () => ({
      driver_location_digest_enabled: true,
      driver_location_digest_email: "ops@oakwell.com",
    }),
    listLoads: async () => [],
    sendEmail: async () => ({ ok: true, id: "email_1" }),
    stampDigest: async () => undefined,
    now: () => Date.parse("2026-08-21T00:00:00.000Z"),
    ...overrides,
  };
}

describe("digestIsDue", () => {
  it("waits out a cron retry inside the 12-hour window", () => {
    const now = Date.parse("2026-08-21T06:00:00.000Z");
    expect(digestIsDue("2026-08-21T00:00:00.000Z", now)).toBe(false);
    expect(digestIsDue("2026-08-20T12:00:00.000Z", now)).toBe(true);
    expect(digestIsDue(undefined, now)).toBe(true);
  });
});

describe("recipientsFromSettings", () => {
  it("prefers the digest field and falls back to Default Audience only when it is an email", () => {
    expect(
      recipientsFromSettings({
        driver_location_digest_email: "a@x.com, b@x.com",
        automation_default_audience: "Ops Managers",
      }),
    ).toEqual(["a@x.com", "b@x.com"]);
    expect(
      recipientsFromSettings({
        driver_location_digest_email: "ops@x.com",
        driver_location_digest_cc: "billing@x.com, ops@x.com",
      }),
    ).toEqual(["ops@x.com", "billing@x.com"]);
    expect(
      recipientsFromSettings({
        driver_location_digest_email: "",
        automation_default_audience: "dispatch@x.com",
      }),
    ).toEqual(["dispatch@x.com"]);
    expect(recipientsFromSettings({ automation_default_audience: "Ops Managers" })).toEqual([]);
  });
});

describe("projectDigestRows", () => {
  it("keeps active freight and real driver GPS, drops drafts and simulated ticks", () => {
    const rows = projectDigestRows([
      {
        loadId: "L-live",
        createdAt: "",
        updatedAt: "",
        loadStatus: "in-transit",
        customer: "Oakwell Farms",
        pickupCity: "Salinas",
        pickupState: "CA",
        deliveryCity: "Los Angeles",
        deliveryState: "CA",
        assignedDriver: "jordan",
        driverGps: {
          lat: 34.95,
          lng: -120.43,
          lastPingAt: new Date().toISOString(),
          sharedByName: "Jordan Amilasan",
        },
      },
      {
        loadId: "L-draft",
        createdAt: "",
        updatedAt: "",
        loadStatus: "draft",
      },
      {
        loadId: "L-fake",
        createdAt: "",
        updatedAt: "",
        loadStatus: "in-transit",
        trackingSession: {
          gps: {
            location: { lat: 1, lng: 2 },
            lastPingAt: new Date().toISOString(),
            source: "simulated",
            speedMph: 0,
            headingDeg: 0,
          },
        },
      } as LoadRecord,
    ]);
    expect(rows.map((row) => row.loadId)).toEqual(["L-live", "L-fake"]);
    expect(rows[0]?.gps?.lat).toBe(34.95);
    expect(rows[0]?.driverName).toBe("Jordan Amilasan");
    expect(rows[1]?.gps).toBeNull();
  });
});

describe("runCompanyDriverLocationDigest", () => {
  const sendEmail = vi.fn();
  const stampDigest = vi.fn();

  beforeEach(() => {
    sendEmail.mockReset().mockResolvedValue({ ok: true, id: "email_1" });
    stampDigest.mockReset();
  });

  it("does not send when Automations has the digest off", async () => {
    const outcome = await runCompanyDriverLocationDigest(
      COMPANY,
      deps({
        readAppSettings: async () => ({ driver_location_digest_enabled: false }),
        sendEmail,
        stampDigest,
      }),
    );
    expect(outcome).toBe("disabled");
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("does not send when Resend is not connected", async () => {
    const outcome = await runCompanyDriverLocationDigest(
      COMPANY,
      deps({ readResend: async () => null, sendEmail, stampDigest }),
    );
    expect(outcome).toBe("no_key");
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("mails the Automations recipients and stamps the run", async () => {
    const outcome = await runCompanyDriverLocationDigest(COMPANY, deps({ sendEmail, stampDigest }));
    expect(outcome).toBe("sent");
    expect(sendEmail).toHaveBeenCalledTimes(1);
    const payload = sendEmail.mock.calls[0]?.[0] as { to: string[]; from: string; subject: string };
    expect(payload.to).toEqual(["ops@oakwell.com"]);
    expect(payload.from).toBe("desk@oakwell.com");
    expect(payload.subject).toContain("Oakwell AG");
    expect(stampDigest).toHaveBeenCalledWith("company-1", "2026-08-21T00:00:00.000Z");
  });
});
