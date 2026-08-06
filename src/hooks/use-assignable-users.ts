import * as React from "react";
import { Building2, Truck, User, Users } from "lucide-react";

import type { FancySelectOption } from "@/components/loads/fancy-select";
import {
  listAssignableUsersByKind,
  type AdminUserDirectoryEntry,
} from "@/lib/admin-users-store";
import {
  listAllCrmAccountsCached,
  type CrmAccountRecord,
} from "@/lib/crm-store";
import {
  listAllCarriersCached,
  type CarrierRecord,
} from "@/lib/carriers-store";

function userToOption(entry: AdminUserDirectoryEntry, icon = User): FancySelectOption {
  const label = entry.name?.trim() || entry.email?.trim() || entry.id;
  const description = [entry.email, entry.department || entry.team, entry.role]
    .filter(Boolean)
    .filter((part, index, arr) => arr.indexOf(part) === index)
    .join(" · ");

  return {
    value: entry.id,
    label,
    description: description || undefined,
    icon,
  };
}

function isCustomerAccount(account: CrmAccountRecord): boolean {
  const type = (account.accountType ?? "Shipper").trim().toLowerCase();
  // Shippers (and untyped / Other) are customers; exclude Carrier & Broker orgs.
  if (type === "carrier" || type === "broker") return false;
  const status = (account.status ?? "Active").trim().toLowerCase();
  if (status === "inactive") return false;
  return Boolean(account.name?.trim());
}

function accountToCustomerOption(account: CrmAccountRecord): FancySelectOption {
  const location = [account.city, account.state].filter(Boolean).join(", ");
  const description = [account.industry, location, account.email || account.phone]
    .filter(Boolean)
    .join(" · ");
  const status = (account.status ?? "Active").trim();
  const isProspect = status.toLowerCase() === "prospect";

  return {
    value: account.accountId,
    label: account.name.trim(),
    description: description || undefined,
    icon: Building2,
    badge: isProspect ? "Prospect" : account.accountType || "Shipper",
    group: isProspect ? "Prospects" : "Active customers",
  };
}

function isAssignableCarrier(carrier: CarrierRecord): boolean {
  if (carrier.blacklisted) return false;
  return Boolean(carrier.companyName?.trim() && carrier.carrierId?.trim());
}

function carrierToOption(carrier: CarrierRecord): FancySelectOption {
  const kind = carrier.carrierKind === "broker" ? "Broker" : "Carrier";
  const mc = carrier.mcNumber?.trim() ? `MC ${carrier.mcNumber.trim()}` : null;
  const location = [carrier.hqCity, carrier.hqState].filter(Boolean).join(", ");
  const fleet = carrier.fleetSize?.trim() ? `${carrier.fleetSize.trim()} units` : null;
  const safety = carrier.safetyRating?.trim() ? `Safety ${carrier.safetyRating.trim()}` : null;
  const description = [mc, safety, fleet, location].filter(Boolean).join(" · ");

  const tier = (carrier.tier ?? "none").toLowerCase();
  const badge =
    tier === "preferred" || tier === "strategic" || tier === "core"
      ? tier.charAt(0).toUpperCase() + tier.slice(1)
      : kind;

  const group =
    tier === "preferred" || tier === "strategic"
      ? "Preferred"
      : carrier.carrierKind === "broker"
        ? "Brokers"
        : "Carriers";

  return {
    value: carrier.carrierId,
    label: carrier.companyName.trim(),
    description: description || undefined,
    icon: Truck,
    badge,
    group,
  };
}

export type LoadOwnershipOptions = {
  customerOptions: FancySelectOption[];
  brokerOptions: FancySelectOption[];
  dispatcherOptions: FancySelectOption[];
  driverOptions: FancySelectOption[];
  carrierOptions: FancySelectOption[];
  loading: boolean;
  error: string | null;
};

/**
 * Real ownership / assignment pickers for Create Load:
 * - Customer / Shipper → CRM accounts (Shipper)
 * - Broker → Admin users with Broker role
 * - Dispatcher / Driver → Admin users with those roles
 * - Assigned Carrier → Carriers table (non-blacklisted)
 */
export function useLoadOwnershipOptions(enabled = true): LoadOwnershipOptions {
  const [customerOptions, setCustomerOptions] = React.useState<FancySelectOption[]>([]);
  const [brokerOptions, setBrokerOptions] = React.useState<FancySelectOption[]>([]);
  const [dispatcherOptions, setDispatcherOptions] = React.useState<FancySelectOption[]>([]);
  const [driverOptions, setDriverOptions] = React.useState<FancySelectOption[]>([]);
  const [carrierOptions, setCarrierOptions] = React.useState<FancySelectOption[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!enabled) return;

    let cancelled = false;
    setLoading(true);
    setError(null);

    void (async () => {
      try {
        const [users, accounts, carriers] = await Promise.all([
          listAssignableUsersByKind(),
          listAllCrmAccountsCached({ force: true }).catch(() => [] as CrmAccountRecord[]),
          listAllCarriersCached({ force: true }).catch(() => [] as CarrierRecord[]),
        ]);
        if (cancelled) return;

        const customers = accounts
          .filter(isCustomerAccount)
          .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }))
          .map(accountToCustomerOption);

        const carrierOpts = carriers
          .filter(isAssignableCarrier)
          .sort((a, b) =>
            a.companyName.localeCompare(b.companyName, undefined, { sensitivity: "base" }),
          )
          .map(carrierToOption);

        setCustomerOptions(customers);
        setBrokerOptions(users.brokers.map((u) => userToOption(u, Users)));
        setDispatcherOptions(users.dispatchers.map((u) => userToOption(u, User)));
        setDriverOptions(users.drivers.map((u) => userToOption(u, User)));
        setCarrierOptions(carrierOpts);
      } catch (err) {
        if (cancelled) return;
        setCustomerOptions([]);
        setBrokerOptions([]);
        setDispatcherOptions([]);
        setDriverOptions([]);
        setCarrierOptions([]);
        setError(err instanceof Error ? err.message : "Could not load ownership options");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return {
    customerOptions,
    brokerOptions,
    dispatcherOptions,
    driverOptions,
    carrierOptions,
    loading,
    error,
  };
}

/** @deprecated Prefer useLoadOwnershipOptions — kept for any remaining callers. */
export function useAssignableUserOptions(enabled = true) {
  const { dispatcherOptions, driverOptions, loading, error } = useLoadOwnershipOptions(enabled);
  return { dispatcherOptions, driverOptions, loading, error };
}
