/**
 * WorkspaceSettings partition keys.
 *
 * Split deliberately: DynamoDB IAM conditions (`dynamodb:LeadingKeys`) match the
 * **partition key** only, so anything that must be denied to the browser needs
 * its own partition rather than a separate sort key under `global`.
 *
 * - `global`  — non-secret config the browser legitimately reads (Google Maps
 *               key, which the Maps JS SDK loads in the page and therefore
 *               cannot be secret; feature flags; test timestamps).
 * - `secrets` — server-only. Denied to the browser's Identity Pool role.
 *
 * Own module so the settings endpoints and the key reader can share them
 * without importing each other.
 */
export const SECRETS_SCOPE = "secrets";
export const OPENAI_SECRET_SECTION = "openai";
