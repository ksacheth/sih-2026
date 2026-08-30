import { RedactedFindingForLLM } from "./types";

export interface RawExposureInput {
  severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  exposureType: string;
  identityConfidence: number;
  evidenceConfidence?: number;
  evidenceTier?: "document" | "snippet";
  evidence?: Array<{ domain?: string; url?: string; snippet?: string }>;
  sourceDomains?: string[];
  threats: string[];
  recommendations?: Array<{ actionCode: string }>;
  recommendedActionCodes?: string[];
}

/**
 * Extracts and redacts exposure finding data into a privacy-preserving schema (CONTEXT.md §9.2).
 * Strictly strips raw email addresses, phone numbers, names, government IDs, and raw page snippets.
 *
 * @param input - Raw exposure object from pipeline
 * @returns RedactedFindingForLLM guaranteed to contain ZERO raw PII
 */
export function buildRedactedFinding(
  input: RawExposureInput,
): RedactedFindingForLLM {
  // Extract unique domains from evidence or sourceDomains list
  const domainSet = new Set<string>();

  if (Array.isArray(input.sourceDomains)) {
    input.sourceDomains.forEach((d) => d && domainSet.add(cleanDomain(d)));
  }

  if (Array.isArray(input.evidence)) {
    input.evidence.forEach((item) => {
      if (item.domain) {
        domainSet.add(cleanDomain(item.domain));
      } else if (item.url) {
        try {
          const parsed = new URL(item.url);
          domainSet.add(parsed.hostname.replace(/^www\./, ""));
        } catch {
          // ignore malformed URLs
        }
      }
    });
  }

  const sourceDomains = Array.from(domainSet);
  if (sourceDomains.length === 0) {
    sourceDomains.push("external-source.org");
  }

  // Extract action codes
  let actionCodes: string[] = [];
  if (Array.isArray(input.recommendedActionCodes)) {
    actionCodes = input.recommendedActionCodes;
  } else if (Array.isArray(input.recommendations)) {
    actionCodes = input.recommendations.map((r) => r.actionCode);
  }

  return {
    riskLevel: input.severity || "MEDIUM",
    exposureType: input.exposureType || "PUBLIC_EXPOSURE",
    identityConfidence:
      Math.round((input.identityConfidence || 0.5) * 100) / 100,
    evidenceConfidence:
      Math.round((input.evidenceConfidence ?? 0.9) * 100) / 100,
    evidenceTier: input.evidenceTier || "document",
    sourceDomains,
    threats: Array.isArray(input.threats) ? input.threats : [],
    recommendedActionCodes: actionCodes,
  };
}

function cleanDomain(domain: string): string {
  return domain
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split("/")[0];
}
