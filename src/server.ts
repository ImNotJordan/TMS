import "./lib/error-capture";

import { consumeLastCapturedError } from "./lib/error-capture";
import { captureServerEnv } from "./lib/server-env";
import { renderErrorPage } from "./lib/error-page";
import {
  handleAiAssistantRequest,
  handleAiStatusRequest,
  isAiAssistantRequest,
  isAiStatusRequest,
} from "./lib/ai-assistant-proxy";
import {
  handleAiChatRequest,
  handleAiTestRequest,
  isAiChatRequest,
  isAiTestRequest,
} from "./lib/ai-proxy";
import {
  handleCommsAgentDraftRequest,
  handleCommsEmailSendRequest,
  handleCommsSmsInboundRequest,
  handleCommsSmsSendRequest,
  handleCommsSmsStatusCallbackRequest,
  handleCommsTranslateRequest,
  isCommsAgentDraftRequest,
  isCommsEmailSendRequest,
  isCommsSmsInboundRequest,
  isCommsSmsSendRequest,
  isCommsSmsStatusCallbackRequest,
  isCommsTranslateRequest,
} from "./lib/comms-proxy";
import {
  handleSettingsAiWriteRequest,
  handleSettingsStatusRequest,
  isSettingsAiWriteRequest,
  isSettingsStatusRequest,
} from "./lib/settings-proxy";
import {
  handleCompanyAssignmentRequest,
  isCompanyAssignmentRequest,
} from "./lib/admin-company-proxy";
import { handleLoadsApiRequest, isLoadsApiRequest } from "./lib/loads-api-proxy";
import { handleDriverLoadsRequest, isDriverLoadsRequest } from "./lib/driver-loads-proxy";
import { preflightResponse, withCors } from "./lib/api-cors";
import { handleResourceApiRequest, isResourceApiRequest } from "./lib/api/resource-proxy";
import {
  handleTrackingMessagesRequest,
  isTrackingMessagesRequest,
} from "./lib/tracking-messages-proxy";
import {
  handleBiddingWorkspaceRequest,
  isBiddingWorkspaceRequest,
} from "./lib/bidding-workspace-proxy";
import { handleAdminUsersRequest, isAdminUsersRequest } from "./lib/admin-users-proxy";
import { handleUserRoleRequest, isUserRoleRequest } from "./lib/admin-role-proxy";
import { handleProfileRequest, isProfileRequest } from "./lib/profile-proxy";
import { handleAdminAuditRequest, isAdminAuditRequest } from "./lib/admin-audit-proxy";
import {
  handleAdminCredentialsRequest,
  isAdminCredentialsRequest,
} from "./lib/admin-credentials-proxy";
import { handleGeocodeSearchRequest, isGeocodeSearchRequest } from "./lib/geocode-proxy";
import {
  handleGoogleDirectionsRequest,
  isGoogleDirectionsRequest,
} from "./lib/google-directions-proxy";

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

let serverEntryPromise: Promise<ServerEntry> | undefined;

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => (m as { default?: ServerEntry }).default ?? (m as unknown as ServerEntry),
    );
  }
  return serverEntryPromise;
}

function brandedErrorResponse(): Response {
  return new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function isCatastrophicSsrErrorBody(body: string, responseStatus: number): boolean {
  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    return false;
  }

  if (!payload || Array.isArray(payload) || typeof payload !== "object") {
    return false;
  }

  const fields = payload as Record<string, unknown>;
  const expectedKeys = new Set(["message", "status", "unhandled"]);
  if (!Object.keys(fields).every((key) => expectedKeys.has(key))) {
    return false;
  }

  return (
    fields.unhandled === true &&
    fields.message === "HTTPError" &&
    (fields.status === undefined || fields.status === responseStatus)
  );
}

// h3 swallows in-handler throws into a normal 500 Response with body
// {"unhandled":true,"message":"HTTPError"} — try/catch alone never fires for those.
async function normalizeCatastrophicSsrResponse(response: Response): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!isCatastrophicSsrErrorBody(body, response.status)) {
    return response;
  }

  console.error(consumeLastCapturedError() ?? new Error(`h3 swallowed SSR error: ${body}`));
  return brandedErrorResponse();
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    // Workers deliver secrets through this binding, not process.env. Capture it
    // so `readServerEnv` can find TITAN_AWS_* from .dev.vars / wrangler secrets.
    captureServerEnv(env);
    try {
      const url = new URL(request.url);

      // The driver portal is a separate origin, so its API calls are
      // cross-origin and preflighted.
      const preflight = preflightResponse(request);
      if (preflight) return preflight;

      // Checked before /api/loads — the driver path is a distinct scope, not a
      // sub-resource of the company one.
      if (isDriverLoadsRequest(url)) {
        return withCors(request, await handleDriverLoadsRequest(request));
      }
      // Both apps talk to this one — the driver portal is cross-origin, hence
      // the CORS wrapper.
      if (isTrackingMessagesRequest(url)) {
        return withCors(request, await handleTrackingMessagesRequest(request));
      }
      if (isBiddingWorkspaceRequest(url)) {
        return handleBiddingWorkspaceRequest(request);
      }
      if (isGeocodeSearchRequest(url, request.method)) {
        return handleGeocodeSearchRequest(url, request);
      }
      if (isGoogleDirectionsRequest(url, request.method)) {
        return handleGoogleDirectionsRequest(url, request);
      }
      if (isProfileRequest(url, request.method)) {
        return handleProfileRequest(request);
      }
      if (isAdminAuditRequest(url, request.method)) {
        return handleAdminAuditRequest(request);
      }
      if (isAdminCredentialsRequest(url, request.method)) {
        return handleAdminCredentialsRequest(request);
      }
      if (isUserRoleRequest(url, request.method)) {
        return handleUserRoleRequest(request);
      }
      if (isAdminUsersRequest(url, request.method)) {
        return handleAdminUsersRequest(request);
      }
      if (isCompanyAssignmentRequest(url, request.method)) {
        return handleCompanyAssignmentRequest(request);
      }
      if (isLoadsApiRequest(url)) {
        return handleLoadsApiRequest(request);
      }
      // Every other tenant-scoped table, driven by the resource registry.
      if (isResourceApiRequest(url)) {
        return withCors(request, await handleResourceApiRequest(request));
      }
      if (isSettingsStatusRequest(url, request.method)) {
        return handleSettingsStatusRequest(request);
      }
      if (isSettingsAiWriteRequest(url, request.method)) {
        return handleSettingsAiWriteRequest(request);
      }
      if (isAiStatusRequest(url, request.method)) {
        return handleAiStatusRequest(request);
      }
      if (isAiAssistantRequest(url, request.method)) {
        return handleAiAssistantRequest(request);
      }
      if (isAiTestRequest(url, request.method)) {
        return handleAiTestRequest(request);
      }
      if (isAiChatRequest(url, request.method)) {
        return handleAiChatRequest(request);
      }

      if (isCommsSmsSendRequest(url, request.method)) {
        return handleCommsSmsSendRequest(request);
      }
      if (isCommsSmsStatusCallbackRequest(url, request.method)) {
        return handleCommsSmsStatusCallbackRequest(request);
      }
      if (isCommsSmsInboundRequest(url, request.method)) {
        return handleCommsSmsInboundRequest(request);
      }
      if (isCommsEmailSendRequest(url, request.method)) {
        return handleCommsEmailSendRequest(request);
      }
      if (isCommsTranslateRequest(url, request.method)) {
        return handleCommsTranslateRequest(request);
      }
      if (isCommsAgentDraftRequest(url, request.method)) {
        return handleCommsAgentDraftRequest(request);
      }

      const handler = await getServerEntry();
      const response = await handler.fetch(request, env, ctx);
      return await normalizeCatastrophicSsrResponse(response);
    } catch (error) {
      console.error(error);
      return brandedErrorResponse();
    }
  },
};
