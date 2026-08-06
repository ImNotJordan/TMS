import { fetchAuthSession } from "aws-amplify/auth";

/** Auth headers for Communications API routes (Cognito ID token). */
export async function getCommsAuthHeaders(): Promise<Record<string, string>> {
  try {
    const session = await fetchAuthSession();
    const token = session.tokens?.idToken?.toString();
    if (!token) return {};
    return { Authorization: `Bearer ${token}` };
  } catch {
    return {};
  }
}
