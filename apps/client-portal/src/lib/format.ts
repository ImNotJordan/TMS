const moneyFormatters = new Map<string, Intl.NumberFormat>();

export function formatMoney(amount: number, currency: string): string {
  const code = currency === "UNKNOWN" || !currency ? "USD" : currency;
  let fmt = moneyFormatters.get(code);
  if (!fmt) {
    try {
      fmt = new Intl.NumberFormat(undefined, {
        style: "currency",
        currency: code,
        maximumFractionDigits: 2,
      });
    } catch {
      fmt = new Intl.NumberFormat(undefined, {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 2,
      });
    }
    moneyFormatters.set(code, fmt);
  }
  return fmt.format(amount);
}

export function formatLane(load: {
  pickupCity?: string;
  pickupState?: string;
  deliveryCity?: string;
  deliveryState?: string;
}): string {
  const origin = [load.pickupCity, load.pickupState].filter(Boolean).join(", ") || "Origin TBD";
  const dest = [load.deliveryCity, load.deliveryState].filter(Boolean).join(", ") || "Destination TBD";
  return `${origin} → ${dest}`;
}

export function formatStatus(status: string): string {
  return status
    .split(/[-_]/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function formatWhen(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}
