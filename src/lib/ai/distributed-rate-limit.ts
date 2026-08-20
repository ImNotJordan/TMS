import { UpdateCommand } from "@aws-sdk/lib-dynamodb";

import {
  ASSISTANT_CHAT_LIMIT,
  ASSISTANT_STATUS_LIMIT,
  ASSISTANT_WINDOW_MS,
} from "@/lib/ai/assistant-limits";
import {
  checkRateLimit as checkMemoryRateLimit,
  clientIpFromRequest,
  releaseInFlight,
  tryAcquireInFlight,
  type RateLimitResult,
} from "@/lib/ai/http-rate-limit";
import { tryVerifiedIdClaims } from "@/lib/ai/cognito-request-credentials";
import { getAiDynamoClient, getWorkspaceSettingsTable } from "@/lib/ai/server-aws";

export { clientIpFromRequest, releaseInFlight, tryAcquireInFlight };

/**
 * Rate-limit bucket identity. The `sub` must be *verified*: an unverified one
 * lets a caller mint a fresh bucket per forged token and sidestep the limit
 * entirely. Unauthenticated callers fall back to IP.
 */
async function subjectKey(request: Request): Promise<string> {
  const sub = (await tryVerifiedIdClaims(request))?.sub;
  const ip = clientIpFromRequest(request);
  return sub || `ip:${ip}`;
}

export async function aiRateLimitKey(
  request: Request,
  kind: "status" | "chat" | "workspace",
): Promise<string> {
  return `ai:${kind}:${await subjectKey(request)}`;
}

/**
 * Dual-layer rate limit: fast in-memory gate + Dynamo atomic counter for
 * multi-instance consistency. If Dynamo is unavailable, memory limit still applies.
 */
export async function enforceDistributedRateLimit(
  request: Request,
  kind: "status" | "chat" | "workspace",
): Promise<RateLimitResult & { source: "memory" | "dynamo" | "memory+dynamo" }> {
  const limit =
    kind === "status" ? ASSISTANT_STATUS_LIMIT : kind === "chat" ? ASSISTANT_CHAT_LIMIT : 30;
  const memoryKey = await aiRateLimitKey(request, kind);
  const memory = checkMemoryRateLimit({
    key: memoryKey,
    limit,
    windowMs: ASSISTANT_WINDOW_MS,
  });
  if (!memory.ok) {
    return { ...memory, source: "memory" };
  }

  try {
    const client = await getAiDynamoClient(request);
    const table = getWorkspaceSettingsTable();
    const subject = await subjectKey(request);
    const windowId = Math.floor(Date.now() / ASSISTANT_WINDOW_MS);
    const section = `${kind}:${subject}:${windowId}`.slice(0, 200);

    await client.send(
      new UpdateCommand({
        TableName: table,
        Key: { scope: "ai-rl", section },
        UpdateExpression:
          "ADD #count :one SET updatedAt = :now, windowId = :windowId, kind = :kind",
        ConditionExpression: "attribute_not_exists(#count) OR #count < :limit",
        ExpressionAttributeNames: { "#count": "count" },
        ExpressionAttributeValues: {
          ":one": 1,
          ":limit": limit,
          ":now": new Date().toISOString(),
          ":windowId": windowId,
          ":kind": kind,
        },
      }) as never,
    );

    return { ok: true, remaining: memory.remaining, source: "memory+dynamo" };
  } catch (err) {
    const name = err && typeof err === "object" ? (err as { name?: string }).name : undefined;
    if (name === "ConditionalCheckFailedException") {
      return {
        ok: false,
        remaining: 0,
        retryAfterSec: Math.max(1, Math.ceil(ASSISTANT_WINDOW_MS / 1000)),
        source: "dynamo",
      };
    }
    // Fail open to memory-only if Dynamo is misconfigured — still protected per node.
    console.warn(
      "[ai] distributed rate limit Dynamo unavailable; using memory only",
      err instanceof Error ? err.message : err,
    );
    return { ...memory, source: "memory" };
  }
}
