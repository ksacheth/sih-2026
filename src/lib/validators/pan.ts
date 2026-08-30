import { PiiCandidate } from "./types";

const VALID_PAN_HOLDERS = new Set([
  "P", // Person / Individual
  "C", // Company
  "H", // Hindu Undivided Family (HUF)
  "F", // Firm / LLP
  "A", // Association of Persons (AOP)
  "T", // Trust
  "B", // Body of Individuals (BOI)
  "L", // Local Authority
  "J", // Artificial Juridical Person
  "G", // Government Agency
]);

const PAN_RE = /(?<![A-Za-z0-9])[A-Za-z]{5}\d{4}[A-Za-z](?![A-Za-z0-9])/g;

/**
 * Mask PAN: e.g. "ABC•••••4F"
 */
export function maskPan(pan: string): string {
  const clean = pan.trim().toUpperCase();
  if (clean.length !== 10) return "••••••••••";
  return `${clean.slice(0, 3)}•••••${clean.slice(8)}`;
}

/**
 * Detect Indian Permanent Account Number (PAN) candidates.
 */
export function detectPans(text: string): PiiCandidate[] {
  if (!text || typeof text !== "string") return [];

  const results: PiiCandidate[] = [];
  const matches = text.matchAll(PAN_RE);

  for (const match of matches) {
    const rawValue = match[0];
    const offsetStart = match.index ?? 0;
    const offsetEnd = offsetStart + rawValue.length;
    const normalizedValue = rawValue.toUpperCase();

    const holderType = normalizedValue[3];
    const hasValidHolder = VALID_PAN_HOLDERS.has(holderType);

    results.push({
      type: "PAN",
      rawValue,
      normalizedValue,
      // PAN has no published checksum — provenance is always ["regex"], never "checksum",
      // so downstream consumers never mistake structural validation for a checksum pass.
      confidence: hasValidHolder ? 0.95 : 0.60,
      detector: "regex_checksum",
      provenance: ["regex"],
      offsetStart,
      offsetEnd,
      meta: {
        holderType,
        isIndividual: holderType === "P",
        masked: maskPan(normalizedValue),
      },
    });
  }

  return results;
}
