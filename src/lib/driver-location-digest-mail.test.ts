import { describe, expect, it } from "vitest";

import { renderDriverLocationDigest } from "./driver-location-digest-mail";

describe("renderDriverLocationDigest", () => {
  it("names the trucks that are sharing and the ones that are not", () => {
    const mail = renderDriverLocationDigest("Oakwell AG", "2026-08-21T00:00:00.000Z", [
      {
        loadId: "L-TRACK-1",
        driverName: "Jordan Amilasan",
        customer: "Oakwell Farms",
        lane: "Salinas, CA → Los Angeles, CA",
        status: "in-transit",
        gps: { lat: 34.95, lng: -120.43, lastPingAt: "2026-08-20T23:50:00.000Z", fresh: true },
      },
      {
        loadId: "L-QUIET",
        driverName: "Unassigned",
        customer: "Oakwell Farms",
        lane: "Fresno, CA → Phoenix, AZ",
        status: "booked",
        gps: null,
      },
    ]);

    expect(mail.subject).toBe("Oakwell AG: 1 of 2 loads reporting location");
    expect(mail.text).toContain("L-TRACK-1");
    expect(mail.text).toContain("Live 34.95000, -120.43000");
    expect(mail.text).toContain("maps.google.com/?q=34.95,-120.43");
    expect(mail.text).toContain("No live GPS from the driver.");
    expect(mail.html).toContain("L-TRACK-1");
    expect(mail.html).not.toContain("<script");
  });

  it("does not invent a location when the board is empty", () => {
    const mail = renderDriverLocationDigest("Acme", "2026-08-21T00:00:00.000Z", []);
    expect(mail.subject).toBe("Acme: 0 of 0 loads reporting location");
    expect(mail.text).toContain("No active loads right now.");
  });
});
