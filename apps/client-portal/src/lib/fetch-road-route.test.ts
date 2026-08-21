import { afterEach, describe, expect, it, vi } from "vitest";

import { decodeGooglePolyline, fetchRoadPath } from "./fetch-road-route";

describe("decodeGooglePolyline", () => {
  it("decodes Google's documented sample", () => {
    const points = decodeGooglePolyline("_p~iF~ps|U_ulLnnqC_mqNvxq`@");
    expect(points).toHaveLength(3);
    expect(points[0]?.lat).toBeCloseTo(38.5, 3);
    expect(points[0]?.lng).toBeCloseTo(-120.2, 3);
    expect(points[2]?.lat).toBeCloseTo(43.252, 3);
    expect(points[2]?.lng).toBeCloseTo(-126.453, 3);
  });
});

describe("fetchRoadPath", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("asks the Worker for a high-quality driving polyline, not a geodesic", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ polyline: "_p~iF~ps|U_ulLnnqC_mqNvxq`@" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const path = await fetchRoadPath(
      { lat: 36.67, lng: -121.65, fallbackAddress: "Salinas, CA" },
      { lat: 34.05, lng: -118.24, fallbackAddress: "Los Angeles, CA" },
      "AIza-company",
      new AbortController().signal,
    );

    expect(path?.length).toBe(3);
    const url = String(fetchMock.mock.calls[0]?.[0]);
    expect(url).toContain("/api/google/directions?");
    expect(url).toContain("quality=high");
    expect(url).toContain("originFallback=Salinas%2C+CA");
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      headers: expect.objectContaining({ "X-Titan-Geocode-Key": "AIza-company" }),
    });
  });

  it("does not invent a straight line when Directions is empty", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ polyline: null }),
      }),
    );
    await expect(
      fetchRoadPath(
        { lat: 1, lng: 2 },
        { lat: 3, lng: 4 },
        "AIza-company",
        new AbortController().signal,
      ),
    ).resolves.toBeNull();
  });
});
