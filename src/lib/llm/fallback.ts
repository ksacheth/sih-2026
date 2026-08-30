import { RedactedFindingForLLM, ExplanationOutput } from "./types";

/**
 * Generates a deterministic, natural language template fallback explanation (CONTEXT.md §9.0).
 * Used when Gemini API is offline, rate-limited, unavailable, or times out.
 *
 * @param redacted - Redacted finding schema
 * @returns ExplanationOutput with isAiGenerated set to false
 */
export function generateTemplateFallback(
  redacted: RedactedFindingForLLM,
): ExplanationOutput {
  const domainsStr = redacted.sourceDomains.join(", ");
  const risk = redacted.riskLevel;
  const isHighRisk = risk === "CRITICAL" || risk === "HIGH";

  let summary = "";
  let sourceRelevance = "";

  const threatsText =
    redacted.threats.length > 0
      ? redacted.threats
          .map((t) => t.toLowerCase().replace(/_/g, " "))
          .join(" and ")
      : "potential exposure risks";

  const actionText =
    redacted.recommendedActionCodes.length > 0
      ? redacted.recommendedActionCodes
          .map((a) => a.toLowerCase().replace(/_/g, " "))
          .join(", ")
      : "reviewing profile settings";

  if (
    redacted.exposureType.toUpperCase().includes("CREDENTIAL") ||
    redacted.threats.includes("CREDENTIAL_STUFFING")
  ) {
    summary = `${risk}-severity credential exposure detected associated with ${domainsStr}. This indicator suggests compromised authentication data that poses ${threatsText}.`;
    sourceRelevance = `${domainsStr} is identified in breach intelligence feeds containing exposed credential sets.`;
  } else if (redacted.exposureType.toUpperCase().includes("BROKER")) {
    summary = `Data broker listing identified on ${domainsStr}. Public directories on this domain surface personal profile details, enabling ${threatsText}.`;
    sourceRelevance = `${domainsStr} functions as a public data aggregator index.`;
  } else if (
    redacted.exposureType.toUpperCase().includes("GOVT_ID") ||
    redacted.threats.includes("IDENTITY_FRAUD_ENABLEMENT")
  ) {
    summary = `${risk}-severity government or financial identifier exposure detected on ${domainsStr}. Exposing official identity numbers increases vulnerability to ${threatsText}.`;
    sourceRelevance = `${domainsStr} hosts publicly accessible documents containing structured identity records.`;
  } else {
    summary = `${risk}-severity personal data exposure detected on ${domainsStr}. The finding exhibits an identity confidence score of ${Math.round(redacted.identityConfidence * 100)}% and presents risk related to ${threatsText}.`;
    sourceRelevance = `${domainsStr} is a public web source where personal data indicators were discovered.`;
  }

  if (!isHighRisk && redacted.identityConfidence < 0.6) {
    summary +=
      " Note: Confidence is low; verify ownership before taking disruptive actions.";
  }

  return {
    summary: `${summary} Recommended priority actions include ${actionText}.`,
    sourceRelevance,
    isAiGenerated: false,
    generatedAt: new Date().toISOString(),
  };
}
