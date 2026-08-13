import type { AdminUserDirectoryEntry } from "@/lib/admin-users-store";

export type AdminDirectoryListResult = {
  users: AdminUserDirectoryEntry[];
  source: "server" | "dynamodb" | "cognito";
  warning?: string;
  scope?: "platform" | "company";
  companyCount?: number;
  canViewAllCompanies?: boolean;
};

type AdminDirectoryCacheEntry = AdminDirectoryListResult & {
  fetchedAt: string;
  fingerprint: string;
};

const STORAGE_PREFIX = "titan-freight:admin-directory:";

const memory = new Map<string, AdminDirectoryCacheEntry>();
const inflight = new Map<string, Promise<AdminDirectoryListResult>>();

function canUseSessionStorage() {
  return typeof window !== "undefined" && typeof sessionStorage !== "undefined";
}

function storageKey(scope: string) {
  return `${STORAGE_PREFIX}${scope}`;
}

function readSession(scope: string): AdminDirectoryCacheEntry | null {
  if (!canUseSessionStorage()) return null;
  try {
    const raw = sessionStorage.getItem(storageKey(scope));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AdminDirectoryCacheEntry;
    if (!parsed?.users || !Array.isArray(parsed.users)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeSession(scope: string, entry: AdminDirectoryCacheEntry) {
  if (!canUseSessionStorage()) return;
  try {
    sessionStorage.setItem(storageKey(scope), JSON.stringify(entry));
  } catch {
    // ignore quota errors
  }
}

export function directoryFingerprint(users: AdminUserDirectoryEntry[]): string {
  if (users.length === 0) return "0";
  return users
    .map((user) =>
      [user.id, user.email ?? "", user.status ?? "", user.role ?? "", user.inviteStatus ?? ""].join(
        ":",
      ),
    )
    .sort()
    .join("|");
}

export function readAdminDirectoryCache(scope: string): AdminDirectoryCacheEntry | undefined {
  const fromMemory = memory.get(scope);
  if (fromMemory) return fromMemory;

  const fromSession = readSession(scope);
  if (fromSession) {
    memory.set(scope, fromSession);
    return fromSession;
  }
  return undefined;
}

export function writeAdminDirectoryCache(scope: string, result: AdminDirectoryListResult) {
  const entry: AdminDirectoryCacheEntry = {
    ...result,
    users: [...result.users],
    fetchedAt: new Date().toISOString(),
    fingerprint: directoryFingerprint(result.users),
  };
  memory.set(scope, entry);
  writeSession(scope, entry);
}

export function prependAdminDirectoryCacheUser(scope: string, user: AdminUserDirectoryEntry) {
  const cached = readAdminDirectoryCache(scope);
  const users = [user, ...(cached?.users.filter((row) => row.id !== user.id) ?? [])];
  writeAdminDirectoryCache(scope, {
    ...cached,
    users,
    source: cached?.source ?? "server",
  });
}

export function clearAdminDirectoryCache(scope?: string) {
  const clearScope = (target: string) => {
    memory.delete(target);
    if (!canUseSessionStorage()) return;
    try {
      sessionStorage.removeItem(storageKey(target));
    } catch {
      // ignore
    }
  };

  if (scope) {
    clearScope(scope);
    inflight.delete(scope);
    return;
  }

  memory.clear();
  inflight.clear();
  if (!canUseSessionStorage()) return;
  try {
    for (let i = sessionStorage.length - 1; i >= 0; i -= 1) {
      const key = sessionStorage.key(i);
      if (key?.startsWith(STORAGE_PREFIX)) sessionStorage.removeItem(key);
    }
  } catch {
    // ignore
  }
}

export async function fetchAdminDirectoryCached(options: {
  scope: string;
  force?: boolean;
  fetchRemote: () => Promise<AdminDirectoryListResult>;
}): Promise<AdminDirectoryListResult> {
  const cached = readAdminDirectoryCache(options.scope);

  if (cached && !options.force) {
    return { ...cached, users: [...cached.users] };
  }

  const pending = inflight.get(options.scope);
  if (pending) return pending;

  const promise = (async () => {
    const remote = await options.fetchRemote();
    const remoteFp = directoryFingerprint(remote.users);

    if (cached && options.force && cached.fingerprint === remoteFp) {
      // Unchanged data, but the *scope* may have moved (a group change, or a
      // company assignment). Take the fresh metadata, keep the cached rows.
      return { ...cached, ...remote, users: [...cached.users] };
    }

    writeAdminDirectoryCache(options.scope, remote);
    return { ...remote, users: [...remote.users] };
  })();

  inflight.set(options.scope, promise);
  try {
    return await promise;
  } finally {
    if (inflight.get(options.scope) === promise) inflight.delete(options.scope);
  }
}
