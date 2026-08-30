import { NameMatchResult } from "../correlation/nameMatcher";

export const RULE_VERSION = "v1.0.0";

export interface IdentityMatchSignals {
  /** Exact match on verified user email */
  exactEmailMatch?: boolean;
  /** Exact match on verified user phone (OTP verified) */
  exactPhoneMatch?: boolean;
  /** Match on attested phone (unverified OTP, lower trust) */
  attestedPhoneMatch?: boolean;
  /** Exact match on user handle / username */
  exactUsernameMatch?: boolean;
  /** Evaluated name match result from compareNames() */
  nameMatchResult?: NameMatchResult;
  /** Match on workplace / organization */
  orgMatch?: boolean;
  /** Match on city / location */
  locationMatch?: boolean;
  /** Number of independent discovery sources co-occurring for this finding */
  independentSourceCount?: number;
}

export interface ConfidenceEvaluationResult {
  ruleVersion: string;
  identityConfidence: number;
  matchLabel: "CONFIRMED" | "POTENTIAL";
  baseScore: number;
  corroborationBonus: number;
  penaltiesApplied: number;
  appliedCaps: string[];
  reasons: string[];
}

/**
 * Calculates deterministic identity confidence score and derives the match label (CONFIRMED vs POTENTIAL)
 * by enforcing the Hard Rule (CONTEXT.md §7.3 & §7.4).
 *
 * HARD RULE: Name similarity alone can NEVER produce a CONFIRMED match.
 * It caps at POTENTIAL (max 0.50 confidence).
 * CONFIRMED requires:
 * 1) Exact identifier (Email / Verified Phone / Username), OR
 * 2) Name match + >=2 corroborating signals (Org, Location, Multi-source co-occurrence).
 *
 * @param signals - Collected matching signals from entity correlation
 * @returns Detailed ConfidenceEvaluationResult
 */
export function calculateIdentityConfidence(
  signals: IdentityMatchSignals,
): ConfidenceEvaluationResult {
  const reasons: string[] = [];
  const appliedCaps: string[] = [];

  let baseScore = 0;
  let hasExactIdentifier = false;
  let hasAttestedPhoneOnly = false;

  // 1. Determine Base Score from strongest direct signal
  if (signals.exactEmailMatch) {
    baseScore = 0.9;
    hasExactIdentifier = true;
    reasons.push("Base score 0.90 from exact email match.");
  } else if (signals.exactPhoneMatch) {
    baseScore = 0.9;
    hasExactIdentifier = true;
    reasons.push("Base score 0.90 from exact verified phone match.");
  } else if (signals.exactUsernameMatch) {
    baseScore = 0.8;
    hasExactIdentifier = true;
    reasons.push("Base score 0.80 from exact username match.");
  } else if (signals.attestedPhoneMatch) {
    baseScore = 0.6;
    hasAttestedPhoneOnly = true;
    reasons.push("Base score 0.60 from attested phone match (lower trust).");
  } else if (signals.nameMatchResult && signals.nameMatchResult.isMatch) {
    baseScore = 0.3;
    const matchType = signals.nameMatchResult.matchType;
    reasons.push(`Base score 0.30 from name match (${matchType}).`);
  } else {
    reasons.push("No matching identity signal found. Base score 0.00.");
  }

  // 2. Calculate Corroborations
  let corroborationBonus = 0;
  let corroborationCount = 0;

  if (signals.orgMatch) {
    corroborationBonus += 0.05;
    corroborationCount += 1;
    reasons.push("Corroboration +0.05 from organization match.");
  }

  if (signals.locationMatch) {
    corroborationBonus += 0.03;
    corroborationCount += 1;
    reasons.push("Corroboration +0.03 from location match.");
  }

  if (signals.independentSourceCount && signals.independentSourceCount >= 2) {
    corroborationBonus += 0.05;
    corroborationCount += 1;
    reasons.push(
      `Corroboration +0.05 from co-occurrence across ${signals.independentSourceCount} independent sources.`,
    );
  }

  // 3. Calculate Penalties
  let penaltiesApplied = 0;
  if (signals.nameMatchResult && signals.nameMatchResult.isCommonName) {
    penaltiesApplied += 0.1;
    reasons.push("Penalty -0.10 applied for top-100 common Indian name.");
  }

  // Raw score before caps
  const rawScore = baseScore + corroborationBonus - penaltiesApplied;
  let finalScore = rawScore;

  // 4. Enforce Hard Caps (CONTEXT.md §7.4)
  if (
    !hasExactIdentifier &&
    signals.nameMatchResult &&
    signals.nameMatchResult.isMatch
  ) {
    if (finalScore > 0.5) {
      finalScore = 0.5;
      appliedCaps.push("NAME_ONLY_CAP_0.50");
      reasons.push("Confidence capped at 0.50 for name-only match.");
    }
  }

  if (hasAttestedPhoneOnly && !hasExactIdentifier) {
    if (finalScore > 0.75) {
      finalScore = 0.75;
      appliedCaps.push("ATTESTED_PHONE_CAP_0.75");
      reasons.push("Confidence capped at 0.75 for attested-phone-only match.");
    }
  }

  // Overall system ceiling cap
  if (finalScore > 0.98) {
    finalScore = 0.98;
    appliedCaps.push("OVERALL_Ceiling_CAP_0.98");
  }

  // Ensure score is bounded between 0.00 and 0.98
  finalScore = Math.max(0, Math.min(0.98, Math.round(finalScore * 100) / 100));

  // 5. Enforce THE HARD RULE for Match Label (CONFIRMED vs POTENTIAL)
  // Hard Rule: CONFIRMED requires:
  // - Exact identifier (email, verified phone, username), OR
  // - Name match + >= 2 corroborating signals.
  let matchLabel: "CONFIRMED" | "POTENTIAL" = "POTENTIAL";

  if (hasExactIdentifier) {
    matchLabel = "CONFIRMED";
    reasons.push("Labeled CONFIRMED due to exact identifier match.");
  } else if (signals.nameMatchResult?.isMatch && corroborationCount >= 2) {
    matchLabel = "CONFIRMED";
    reasons.push(
      `Labeled CONFIRMED due to name match with ${corroborationCount} corroborating signals.`,
    );
  } else {
    matchLabel = "POTENTIAL";
    if (signals.nameMatchResult?.isMatch) {
      reasons.push(
        "HARD RULE: Labeled POTENTIAL (name match without exact identifier or >=2 corroborations).",
      );
    } else if (hasAttestedPhoneOnly) {
      reasons.push(
        "HARD RULE: Labeled POTENTIAL (attested phone match without verified identifier).",
      );
    }
  }

  return {
    ruleVersion: RULE_VERSION,
    identityConfidence: finalScore,
    matchLabel,
    baseScore,
    corroborationBonus: Math.round(corroborationBonus * 100) / 100,
    penaltiesApplied: Math.round(penaltiesApplied * 100) / 100,
    appliedCaps,
    reasons,
  };
}
