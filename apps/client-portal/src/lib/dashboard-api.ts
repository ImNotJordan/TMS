import { fetchAuthSession } from "aws-amplify/auth";

import { apiUrl } from "./api-base";
import type { ClientDashboardResponse } from "./dashboard-types";

export class ClientDashboardApiError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "ClientDashboardApiError";
    this.status = status;
    this.code = code;
  }
}

async function authHeaders(): Promise<Record<string, string>> {
  try {
    const session = await fetchAuthSession();
    const token = session.tokens?.idToken?.toString();
    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch {
    return {};
  }
}

export async function apiGetClientDashboard(): Promise<ClientDashboardResponse> {
  const response = await fetch(apiUrl("/api/client/dashboard"), {
    headers: { Accept: "application/json", ...(await authHeaders()) },
  });
  const parsed = (await response.json().catch(() => null)) as
    | (ClientDashboardResponse & { error?: string; code?: string })
    | null;

  if (!response.ok) {
    throw new ClientDashboardApiError(
      parsed?.error ?? `Request failed (HTTP ${response.status}).`,
      response.status,
      parsed?.code,
    );
  }
  if (!parsed?.summary || !Array.isArray(parsed.loads)) {
    throw new ClientDashboardApiError("Dashboard returned an unexpected payload.", 502);
  }
  return parsed;
}
