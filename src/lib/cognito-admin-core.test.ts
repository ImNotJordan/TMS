import { describe, expect, it } from "vitest";

import { describeCognitoAdminError } from "@/lib/cognito-admin-core";

describe("describeCognitoAdminError", () => {
  it("keeps Cognito exception names so the credentials proxy can classify them", () => {
    const wrapped = describeCognitoAdminError(
      Object.assign(new Error("User account already exists"), { name: "UsernameExistsException" }),
      "AdminCreateUser",
    );

    expect(wrapped.name).toBe("UsernameExistsException");
    expect(wrapped.message).toMatch(/already exists/i);
  });

  it("keeps AccessDenied so missing IAM is not reported as a generic 502", () => {
    const wrapped = describeCognitoAdminError(
      Object.assign(new Error("User is not authorized"), { name: "AccessDeniedException" }),
      "AdminCreateUser",
    );

    expect(wrapped.name).toBe("AccessDeniedException");
    expect(wrapped.message).toMatch(/titan-worker/i);
  });
});
