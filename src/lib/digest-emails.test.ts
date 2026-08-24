import { describe, expect, it } from "vitest";

import { parseDigestEmails } from "./digest-emails";

describe("parseDigestEmails", () => {
  it("keeps real addresses and drops the audience labels on the Automations tab", () => {
    expect(parseDigestEmails("Ops Managers", "dispatch@oakwell.com, billing@oakwell.com")).toEqual(
      ["dispatch@oakwell.com", "billing@oakwell.com"],
    );
  });

  it("dedupes across fields without regard to case", () => {
    expect(parseDigestEmails("a@x.com; A@x.com", "b@x.com")).toEqual(["a@x.com", "b@x.com"]);
  });

  it("returns nothing when nobody typed an email", () => {
    expect(parseDigestEmails("Ops Managers", "Always On")).toEqual([]);
  });
});
