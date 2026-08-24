/**
 * Recipients for the driver-location digest.
 *
 * The Automation tab is the place an ops admin types "who gets this". The
 * Resend key is not — that is a credential. Splitting them is what stops a
 * pasted API key from doubling as an address book.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i;

export function parseDigestEmails(...raw: Array<string | undefined | null>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const chunk of raw) {
    if (!chunk) continue;
    for (const token of chunk.split(/[,;\n]+/)) {
      const email = token.trim();
      if (!EMAIL_RE.test(email)) continue;
      const key = email.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(email);
    }
  }
  return out;
}

export function looksLikeEmailList(value: string | undefined | null): boolean {
  return parseDigestEmails(value).length > 0;
}
