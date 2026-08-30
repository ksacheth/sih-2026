import { PiiCandidate } from "./types";
import { detectAadhaars } from "./aadhaar";
import { detectPans } from "./pan";
import { detectEmails } from "./email";
import { detectPhones } from "./phone";

export * from "./types";
export * from "./verhoeff";
export * from "./aadhaar";
export * from "./pan";
export * from "./phone";
export * from "./email";

/**
 * Checks if two candidates have overlapping character offsets.
 */
export function isCandidateOverlapping(a: PiiCandidate, b: PiiCandidate): boolean {
  return Math.max(a.offsetStart, b.offsetStart) < Math.min(a.offsetEnd, b.offsetEnd);
}

/**
 * Deduplicates overlapping candidates using confidence- and validity-aware ranking:
 * - Checksum-valid Aadhaar (0.98) suppresses a phone candidate on the same span.
 * - Checksum-failing Aadhaar (0.40) does NOT suppress a valid phone candidate (0.95).
 */
export function dedupeOverlaps(candidates: PiiCandidate[]): PiiCandidate[] {
  // Sort by confidence descending, then by span length descending
  const sorted = [...candidates].sort((a, b) => {
    if (b.confidence !== a.confidence) {
      return b.confidence - a.confidence;
    }
    const lenA = a.offsetEnd - a.offsetStart;
    const lenB = b.offsetEnd - b.offsetStart;
    return lenB - lenA;
  });

  const deduped: PiiCandidate[] = [];

  for (const cand of sorted) {
    const hasConflict = deduped.some((existing) => isCandidateOverlapping(existing, cand));
    if (!hasConflict) {
      deduped.push(cand);
    }
  }

  // Return in document order (offsetStart ascending)
  return deduped.sort((a, b) => a.offsetStart - b.offsetStart);
}

/**
 * Main deterministic extraction runner: executes all 4 recognizers and resolves span collisions.
 */
export function runDeterministicValidators(text: string): PiiCandidate[] {
  if (!text || typeof text !== "string") return [];

  const rawCandidates: PiiCandidate[] = [
    ...detectAadhaars(text),
    ...detectPans(text),
    ...detectEmails(text),
    ...detectPhones(text),
  ];

  // Verify slice invariant for every candidate
  const validCandidates = rawCandidates.filter(
    (c) => text.slice(c.offsetStart, c.offsetEnd) === c.rawValue
  );

  return dedupeOverlaps(validCandidates);
}
