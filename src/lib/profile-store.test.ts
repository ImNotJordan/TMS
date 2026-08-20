import { describe, expect, it } from "vitest";

import { sanitizeSelfServiceSection } from "@/lib/profile-store";

describe("sanitizeSelfServiceSection", () => {
  it("strips every privilege-bearing field from a permissions save", () => {
    const { data, rejected } = sanitizeSelfServiceSection("permissions", {
      role: "SuperAdmin",
      adminAccess: true,
      modulePermissions: { Admin: { "Full Access": true } },
      accessLevel: "Full Access",
      permissionGroup: "owners",
      dataAccessScope: "all",
      fieldPermissions: { rate: true },
      teams: "Night dispatch",
    });

    expect(data).toEqual({ teams: "Night dispatch" });
    expect(rejected.sort()).toEqual(
      [
        "accessLevel",
        "adminAccess",
        "dataAccessScope",
        "fieldPermissions",
        "modulePermissions",
        "permissionGroup",
        "role",
      ].sort(),
    );
  });

  it("reports nothing rejected for an ordinary permissions save", () => {
    const { data, rejected } = sanitizeSelfServiceSection("permissions", {
      teams: "Day dispatch",
      branch: "Chicago",
    });
    expect(data).toEqual({ teams: "Day dispatch", branch: "Chicago" });
    expect(rejected).toEqual([]);
  });

  it("leaves non-permissions sections untouched", () => {
    const personal = { given_name: "Jordan", role: "not a privilege here" };
    const { data, rejected } = sanitizeSelfServiceSection("personal", personal);
    expect(data).toEqual(personal);
    expect(rejected).toEqual([]);
  });

  // The escalation this guard exists to stop: rbac.isPrivilegedRole("SuperAdmin")
  // grants every module, and the Profile → Role & Permissions tab used to write it.
  it("prevents self-assignment of a privileged role", () => {
    const { data } = sanitizeSelfServiceSection("permissions", { role: "SuperAdmin" });
    expect(data.role).toBeUndefined();
  });
});
