export type ResendSendInput = {
  apiKey: string;
  from: string;
  to: string[];
  subject: string;
  html: string;
  text: string;
};

export type ResendSendResult =
  | { ok: true; id: string }
  | { ok: false; error: string };

/**
 * One email through Resend's HTTP API.
 *
 * The key stays in the Authorization header. Failures return a message, never
 * throw — a single bad recipient must not take the rest of the cron down.
 */
export async function sendResendEmail(input: ResendSendInput): Promise<ResendSendResult> {
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: input.from,
        to: input.to,
        subject: input.subject,
        html: input.html,
        text: input.text,
      }),
    });
    const body = (await response.json().catch(() => null)) as
      | { id?: string; message?: string; error?: { message?: string } }
      | null;
    if (!response.ok) {
      return {
        ok: false,
        error: body?.error?.message ?? body?.message ?? `Resend HTTP ${response.status}`,
      };
    }
    return { ok: true, id: body?.id?.trim() || "sent" };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Resend request failed" };
  }
}
