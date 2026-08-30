import { PiiCandidate } from "./types";
import { verhoeffValidate, verhoeffCheckDigit } from "./verhoeff";

export { verhoeffValidate, verhoeffCheckDigit };

/**
 * 12 digits, first digit 2–9, groups separated by a single space/hyphen or none,
 * never spanning a newline and bounded by non-digits.
 */
const AADHAAR_RE = /(?<!\d)[2-9]\d{3}[ -]?\d{4}[ -]?\d{4}(?!\d)/g;

/**
 * Mask Aadhaar number: e.g. "•••• •••• 1234"
 */
export function maskAadhaar(aadhaar: string): string {
  const digits = aadhaar.replace(/\D/g, "");
  if (digits.length !== 12) return "•••• •••• ••••";
  return `•••• •••• ${digits.slice(8)}`;
}

/**
 * Detect Aadhaar candidates in text.
 * Checksum-valid -> confidence 0.98, provenance: ["regex", "checksum"]
 * Checksum-fail -> confidence 0.40, provenance: ["regex"] (supporting lead only)
 */
export function detectAadhaars(text: string): PiiCandidate[] {
  if (!text || typeof text !== "string") return [];

  const results: PiiCandidate[] = [];
  const matches = text.matchAll(AADHAAR_RE);

  for (const match of matches) {
    const rawValue = match[0];
    const offsetStart = match.index ?? 0;
    const offsetEnd = offsetStart + rawValue.length;
    const normalizedValue = rawValue.replace(/\D/g, "");

    // Junk guard: all identical digits (e.g. 222222222222)
    if (/^(\d)\1{11}$/.test(normalizedValue)) {
      continue;
    }

    const isValid = verhoeffValidate(normalizedValue);

    results.push({
      type: "AADHAAR",
      rawValue,
      normalizedValue,
      confidence: isValid ? 0.98 : 0.40,
      detector: "regex_checksum",
      provenance: isValid ? ["regex", "checksum"] : ["regex"],
      offsetStart,
      offsetEnd,
      meta: {
        checksumValid: isValid,
        masked: maskAadhaar(normalizedValue),
      },
    });
  }

  return results;
}
