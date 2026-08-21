import { afterEach, describe, expect, it } from "vitest";

import { corsHeadersFor } from "./api-cors";

describe("corsHeadersFor", () => {
  const previous = process.env.TITAN_ALLOWED_ORIGINS;

  afterEach(() => {
    if (previous === undefined) delete process.env.TITAN_ALLOWED_ORIGINS;
    else process.env.TITAN_ALLOWED_ORIGINS = previous;
  });

  it("allows the client portal's geocode key header on preflight", () => {
    process.env.TITAN_ALLOWED_ORIGINS = "http://localhost:5175";
    const headers = corsHeadersFor(
      new Request("https://ops.test/api/geocode/search", {
        headers: { Origin: "http://localhost:5175" },
      }),
    );
    expect(headers["Access-Control-Allow-Headers"]).toContain("X-Titan-Geocode-Key");
  });
});
