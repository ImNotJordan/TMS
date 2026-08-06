import { z } from "zod";

const messageLinkSchema = z.union([
  z.object({ loadId: z.string().min(1), contactId: z.string().min(1) }),
  z.object({ loadId: z.string().min(1), contactId: z.undefined().optional() }),
  z.object({ loadId: z.undefined().optional(), contactId: z.string().min(1) }),
]).refine(
  (v) => Boolean(("loadId" in v && v.loadId) || ("contactId" in v && v.contactId)),
  { message: "Message must link to a load and/or contact." },
);

export const smsSendSchema = z.object({
  to: z.string().min(7).max(32),
  body: z.string().min(1).max(1600),
  link: messageLinkSchema,
  contactId: z.string().optional(),
});

export const emailSendSchema = z.object({
  to: z.string().email().max(320),
  subject: z.string().min(1).max(200),
  body: z.string().min(1).max(50_000),
  link: messageLinkSchema,
});

export const translateSchema = z.object({
  text: z.string().min(1).max(12_000),
  sourceLang: z.string().min(2).max(16).optional(),
  targetLang: z.string().min(2).max(16),
  translatedBy: z.enum(["auto", "agent"]).default("agent"),
});

export const agentDraftSchema = z.object({
  persona: z.enum(["dispatcher", "broker", "customer-service", "sales"]),
  tone: z.enum(["formal", "neutral", "friendly", "urgent"]),
  threadSummary: z.string().max(8_000),
  latestInbound: z.string().max(4_000),
  channel: z.enum(["email", "sms", "voice", "chat"]),
});

export type SmsSendBody = z.infer<typeof smsSendSchema>;
export type EmailSendBody = z.infer<typeof emailSendSchema>;
export type TranslateBody = z.infer<typeof translateSchema>;
export type AgentDraftBody = z.infer<typeof agentDraftSchema>;
