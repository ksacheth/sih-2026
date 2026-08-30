export const RULE_VERSION = "v1.0.0";

export type SeverityLevel = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";

export interface SeverityInput {
  exposureType: string;
  piiTypes: string[];
  isBreachDump?: boolean;
  matchLabel: "CONFIRMED" | "POTENTIAL";
  identityConfidence: number;
  evidenceConfidence?: number;
}

export interface SeverityEvaluationResult {
  ruleVersion: string;
  severity: SeverityLevel;
  /** Numerical score (1-100) used for sorting exposures by urgency on the dashboard */
  priorityRank: number;
  reasons: string[];
}

/**
 * Deterministically evaluates exposure severity and priority rank based on exposure rules (CONTEXT.md §8.2).
 *
 * Rules:
 * - CRITICAL (Priority 95-100): Credential dump breach indicator OR confirmed Aadhaar/PAN exposure.
 * - HIGH (Priority 75-80): Potential Aadhaar/PAN, confirmed correlated phone + address, or confirmed multi-field exposure.
 * - MEDIUM (Priority 50-60): Data broker directory listing, confirmed public email or phone.
 * - LOW (Priority 20-30): Low-confidence match (POTENTIAL) or standalone low-sensitivity reference.
 *
 * @param input - SeverityInput
 * @returns SeverityEvaluationResult
 */
export function evaluateSeverity(
  input: SeverityInput,
): SeverityEvaluationResult {
  const reasons: string[] = [];
  const piiSet = new Set(input.piiTypes.map((p) => p.toUpperCase()));
  const isConfirmed = input.matchLabel === "CONFIRMED";
  const exposureTypeUpper = input.exposureType.toUpperCase();

  const isBreach =
    input.isBreachDump || exposureTypeUpper.includes("CREDENTIAL");
  const hasGovtId =
    piiSet.has("AADHAAR") ||
    piiSet.has("PAN") ||
    exposureTypeUpper.includes("GOVT_ID");
  const hasPhone = piiSet.has("PHONE") || exposureTypeUpper.includes("PHONE");
  const hasEmail = piiSet.has("EMAIL") || exposureTypeUpper.includes("EMAIL");
  const hasAddress = piiSet.has("ADDRESS") || piiSet.has("LOCATION");

  let severity: SeverityLevel = "LOW";
  let priorityRank = 25;

  // 1. CRITICAL Rules (Priority 95-100)
  if (isBreach) {
    severity = "CRITICAL";
    priorityRank = 100;
    reasons.push("CRITICAL: Credential dump exposure from breach metadata.");
  } else if (hasGovtId && isConfirmed) {
    severity = "CRITICAL";
    priorityRank = 95;
    reasons.push(
      "CRITICAL: Confirmed government/financial identifier (Aadhaar/PAN) exposure.",
    );
  }

  // 2. HIGH Rules (Priority 75-80)
  else if (hasGovtId && !isConfirmed) {
    severity = "HIGH";
    priorityRank = 80;
    reasons.push("HIGH: Potential government/financial identifier exposure.");
  } else if (isConfirmed && hasPhone && hasAddress) {
    severity = "HIGH";
    priorityRank = 78;
    reasons.push(
      "HIGH: Confirmed correlated phone and physical address exposure.",
    );
  } else if (isConfirmed && hasPhone && hasEmail && piiSet.size >= 3) {
    severity = "HIGH";
    priorityRank = 75;
    reasons.push(
      "HIGH: Confirmed multi-field exposure (email, phone, profile context).",
    );
  }

  // 3. MEDIUM Rules (Priority 50-60)
  else if (exposureTypeUpper.includes("BROKER")) {
    severity = "MEDIUM";
    priorityRank = 60;
    reasons.push("MEDIUM: Data broker directory listing.");
  } else if (isConfirmed && (hasPhone || hasEmail)) {
    severity = "MEDIUM";
    priorityRank = 50;
    reasons.push("MEDIUM: Confirmed public contact exposure.");
  }

  // 4. LOW Rules (Priority 20-30)
  else {
    severity = "LOW";
    priorityRank = input.identityConfidence < 0.5 ? 20 : 30;
    if (!isConfirmed) {
      reasons.push(
        "LOW: Unconfirmed potential identity match (requires user verification).",
      );
    } else {
      reasons.push("LOW: Single low-sensitivity public profile reference.");
    }
  }

  return {
    ruleVersion: RULE_VERSION,
    severity,
    priorityRank,
    reasons,
  };
}
