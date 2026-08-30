import { PiiCandidate } from "./types";

const EMAIL_RE =
  /(?<![A-Za-z0-9._%+-])[A-Za-z0-9._%+-]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)*\.[A-Za-z]{2,}(?![A-Za-z0-9._%+-])/g;

/**
 * Normalizes email address to lowercase and trimmed string.
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Masks email: e.g. "r***@example.com"
 */
export function maskEmail(email: string): string {
  const normalized = normalizeEmail(email);
  const parts = normalized.split("@");
  if (parts.length !== 2) return "••••@••••.com";

  const [local, domain] = parts;
  if (local.length <= 1) {
    return `*@${domain}`;
  }
  const maskedLocal = `${local[0]}${"*".repeat(Math.min(3, local.length - 1))}`;
  return `${maskedLocal}@${domain}`;
}

/**
 * Detect Email candidates in text.
 */
export function detectEmails(text: string): PiiCandidate[] {
  if (!text || typeof text !== "string") return [];

  const results: PiiCandidate[] = [];
  const matches = text.matchAll(EMAIL_RE);

  for (const match of matches) {
    const rawValue = match[0];
    const offsetStart = match.index ?? 0;
    const offsetEnd = offsetStart + rawValue.length;

    const normalizedValue = normalizeEmail(rawValue);
    const parts = normalizedValue.split("@");

    // RFC length checks
    if (parts.length === 2) {
      const [localPart] = parts;
      if (localPart.length <= 64 && normalizedValue.length <= 254) {
        results.push({
          type: "EMAIL",
          rawValue,
          normalizedValue,
          confidence: 0.95,
          detector: "regex_checksum",
          provenance: ["regex"],
          offsetStart,
          offsetEnd,
          meta: {
            masked: maskEmail(normalizedValue),
          },
        });
      }
    }
  }

  return results;
}
