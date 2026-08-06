import { describe, expect, it } from "vitest";

import {
  assertTransition,
  canTransition,
  transitionStatus,
} from "@/features/communications/lib/statusMachine";

describe("statusMachine", () => {
  it("allows legal transitions", () => {
    expect(canTransition("draft", "sending")).toBe(true);
    expect(canTransition("sending", "sent")).toBe(true);
    expect(canTransition("sent", "delivered")).toBe(true);
    expect(canTransition("delivered", "read")).toBe(true);
    expect(transitionStatus("failed", "sending")).toBe("sending");
  });

  it("rejects illegal transitions", () => {
    expect(canTransition("delivered", "sending")).toBe(false);
    expect(canTransition("read", "failed")).toBe(false);
    expect(() => assertTransition("delivered", "sending")).toThrow(/Illegal/);
  });
});
