import * as React from "react";

import {
  ACCESS_SCOPES,
  FIELD_PERMISSIONS,
  MODULES,
  PERMISSION_LEVELS,
  PERMISSION_TEMPLATES,
  ROLES,
  TWO_FA_STATUSES,
  USER_STATUSES,
  INVITE_STATUSES,
  type ModuleName,
  type PermissionLevel,
  type FieldPermission,
} from "@/lib/admin-user-constants";
import type { AdminUserEditDraft } from "@/lib/admin-user-edit";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { t } from "@/lib/i18n/t";

function Field({
  label,
  required = false,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="space-y-1">
      <span className="text-xs font-medium text-muted-foreground">
        {label}
        {required ? " *" : ""}
      </span>
      {children}
    </label>
  );
}

export function EditUserForm({
  draft,
  onChange,
}: {
  draft: AdminUserEditDraft;
  onChange: (next: AdminUserEditDraft) => void;
}) {
  const patch = <K extends keyof AdminUserEditDraft>(key: K, value: AdminUserEditDraft[K]) => {
    onChange({ ...draft, [key]: value });
  };

  const toggleModulePermission = (
    moduleName: ModuleName,
    level: PermissionLevel,
    checked: boolean,
  ) => {
    const currentModule = draft.modulePermissions[moduleName];
    const nextModule: Record<PermissionLevel, boolean> = { ...currentModule };

    if (level === "No Access") {
      if (checked) {
        for (const permissionLevel of PERMISSION_LEVELS) {
          nextModule[permissionLevel] = permissionLevel === "No Access";
        }
      } else {
        nextModule["No Access"] = false;
      }
    } else if (level === "Full Access") {
      if (checked) {
        for (const permissionLevel of PERMISSION_LEVELS) {
          nextModule[permissionLevel] = permissionLevel === "Full Access";
        }
      } else {
        nextModule["Full Access"] = false;
        if (
          !Object.entries(nextModule).some(
            ([permissionLevel, enabled]) => permissionLevel !== "No Access" && enabled,
          )
        ) {
          nextModule["No Access"] = true;
        }
      }
    } else {
      nextModule[level] = checked;
      if (checked) {
        nextModule["No Access"] = false;
        nextModule["Full Access"] = false;
      }
      const hasOperationalPermission =
        nextModule["View Only"] ||
        nextModule.Create ||
        nextModule.Edit ||
        nextModule.Delete ||
        nextModule.Approve ||
        nextModule.Export ||
        nextModule["Full Access"];
      if (!hasOperationalPermission) nextModule["No Access"] = true;
    }

    onChange({
      ...draft,
      modulePermissions: {
        ...draft.modulePermissions,
        [moduleName]: nextModule,
      },
    });
  };

  const toggleFieldPermission = (permission: FieldPermission, checked: boolean) => {
    onChange({
      ...draft,
      fieldPermissions: {
        ...draft.fieldPermissions,
        [permission]: checked,
      },
    });
  };

  return (
    <div className="space-y-6">
      <Card className="border-border/70 shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">{t("Profile")}</CardTitle>
          <CardDescription>
            {t("Identity and contact details stored in UsersTable.")}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          <Field label={t("First Name")} required>
            <Input value={draft.firstName} onChange={(e) => patch("firstName", e.target.value)} />
          </Field>
          <Field label={t("Last Name")} required>
            <Input value={draft.lastName} onChange={(e) => patch("lastName", e.target.value)} />
          </Field>
          <Field label={t("Display Name")}>
            <Input
              value={draft.displayName}
              onChange={(e) => patch("displayName", e.target.value)}
            />
          </Field>
          <Field label={t("Email")} required>
            <Input
              type="email"
              value={draft.email}
              onChange={(e) => patch("email", e.target.value)}
            />
          </Field>
          <Field label={t("Phone")}>
            <Input value={draft.phone} onChange={(e) => patch("phone", e.target.value)} />
          </Field>
          <Field label={t("Job Title")}>
            <Input value={draft.jobTitle} onChange={(e) => patch("jobTitle", e.target.value)} />
          </Field>
          <Field label={t("Department")}>
            <Input value={draft.department} onChange={(e) => patch("department", e.target.value)} />
          </Field>
          <Field label={t("Office / Branch")}>
            <Input
              value={draft.officeBranch}
              onChange={(e) => patch("officeBranch", e.target.value)}
            />
          </Field>
          <Field label={t("Time Zone")}>
            <Input value={draft.timeZone} onChange={(e) => patch("timeZone", e.target.value)} />
          </Field>
          <Field label={t("Language")}>
            <Input value={draft.language} onChange={(e) => patch("language", e.target.value)} />
          </Field>
        </CardContent>
      </Card>

      <Card className="border-border/70 shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">{t("Role & access")}</CardTitle>
          <CardDescription>{t("Role, team, branch, and data scope.")}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          <Field label={t("Role")} required>
            <Select
              value={draft.role}
              onValueChange={(value) => patch("role", value as typeof draft.role)}
            >
              <SelectTrigger>
                <SelectValue placeholder={t("Select role")} />
              </SelectTrigger>
              <SelectContent>
                {ROLES.map((role) => (
                  <SelectItem key={role} value={role}>
                    {role}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label={t("Permission template")}>
            <Select
              value={draft.permissionTemplate}
              onValueChange={(value) =>
                patch("permissionTemplate", value as typeof draft.permissionTemplate)
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PERMISSION_TEMPLATES.map((template) => (
                  <SelectItem key={template} value={template}>
                    {template}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label={t("Access level")}>
            <Select
              value={draft.accessLevel}
              onValueChange={(value) => patch("accessLevel", value as typeof draft.accessLevel)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Standard">{t("Standard")}</SelectItem>
                <SelectItem value="Elevated">{t("Elevated")}</SelectItem>
                <SelectItem value="Restricted">{t("Restricted")}</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label={t("Manager")}>
            <Input value={draft.manager} onChange={(e) => patch("manager", e.target.value)} />
          </Field>
          <Field label={t("Assigned team")}>
            <Input
              value={draft.assignedTeam}
              onChange={(e) => patch("assignedTeam", e.target.value)}
            />
          </Field>
          <Field label={t("Assigned branch")}>
            <Input
              value={draft.assignedBranch}
              onChange={(e) => patch("assignedBranch", e.target.value)}
            />
          </Field>
          <Field label={t("Assigned customers")}>
            <Input
              value={draft.assignedCustomers}
              onChange={(e) => patch("assignedCustomers", e.target.value)}
              placeholder={t("Acme Manufacturing, Northwind")}
            />
          </Field>
          <Field label={t("Data access scope")} required>
            <Select
              value={draft.dataAccessScope}
              onValueChange={(value) =>
                patch("dataAccessScope", value as typeof draft.dataAccessScope)
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ACCESS_SCOPES.map((scope) => (
                  <SelectItem key={scope} value={scope}>
                    {scope}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </CardContent>
      </Card>

      <Card className="border-border/70 shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">{t("Account & security")}</CardTitle>
          <CardDescription>{t("Status, invite, and two-factor settings.")}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-3">
          <Field label={t("Account status")}>
            <Select
              value={draft.accountStatus}
              onValueChange={(value) => patch("accountStatus", value as typeof draft.accountStatus)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {USER_STATUSES.map((status) => (
                  <SelectItem key={status} value={status}>
                    {status}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label={t("Invite status")}>
            <Select
              value={draft.inviteStatus}
              onValueChange={(value) => patch("inviteStatus", value as typeof draft.inviteStatus)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {INVITE_STATUSES.map((status) => (
                  <SelectItem key={status} value={status}>
                    {status}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label={t("2FA status")}>
            <Select
              value={draft.twoFAStatus}
              onValueChange={(value) => patch("twoFAStatus", value as typeof draft.twoFAStatus)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TWO_FA_STATUSES.map((status) => (
                  <SelectItem key={status} value={status}>
                    {status}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </CardContent>
      </Card>

      <Card className="border-border/70 shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">{t("Module permissions")}</CardTitle>
          <CardDescription>{t("Per-module access levels for this user.")}</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="min-w-[160px]">{t("Module")}</TableHead>
                {PERMISSION_LEVELS.map((level) => (
                  <TableHead key={level} className="min-w-[88px] text-center text-xs">
                    {level}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {MODULES.map((moduleName) => (
                <TableRow key={moduleName}>
                  <TableCell className="font-medium">{moduleName}</TableCell>
                  {PERMISSION_LEVELS.map((level) => (
                    <TableCell key={level} className="text-center">
                      <Checkbox
                        checked={draft.modulePermissions[moduleName][level]}
                        onCheckedChange={(checked) =>
                          toggleModulePermission(moduleName, level, Boolean(checked))
                        }
                      />
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card className="border-border/70 shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">{t("Field-level permissions")}</CardTitle>
          <CardDescription>{t("Sensitive data and financial visibility.")}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-2 md:grid-cols-2">
          {FIELD_PERMISSIONS.map((permission) => (
            <label
              key={permission}
              className="flex items-center gap-2 rounded-md border border-border/70 px-3 py-2 text-sm"
            >
              <Checkbox
                checked={draft.fieldPermissions[permission]}
                onCheckedChange={(checked) => toggleFieldPermission(permission, Boolean(checked))}
              />
              <span>{permission}</span>
            </label>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
