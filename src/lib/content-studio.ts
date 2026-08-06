/**
 * Content Studio drafts — templates + OpenAI via Settings → Integrations.
 * Implementation lives in workspace-ai.ts so all product AI shares one path.
 */
export {
  draftCampaignContent,
  draftCampaignContentAsync,
  draftCampaignContentTemplate,
} from "./workspace-ai";
