import { compareNames, NameMatchResult } from "./nameMatcher";
import {
  calculateIdentityConfidence,
  evaluateThreats,
  evaluateSeverity,
  generateRecommendations,
  ConfidenceEvaluationResult,
  ThreatEvaluationResult,
  SeverityEvaluationResult,
  RecommendationTask,
} from "../rules";

/**
 * Extracted Entity Interface produced by ML-1 PII Extraction & Fusion Pipeline (TASKS.md §4.2).
 */
export interface ExtractedEntity {
  type:
    | "PERSON"
    | "ORGANIZATION"
    | "LOCATION"
    | "ADDRESS"
    | "EMAIL"
    | "PHONE"
    | "AADHAAR"
    | "PAN";
  rawValue: string;
  normalizedValue: string;
  detector: "regex" | "checksum" | "gliner" | "fused";
  detectorConfidence: number;
  offsetStart?: number;
  offsetEnd?: number;
}

/**
 * Monitored User Identity profile.
 */
export interface MonitoredIdentity {
  id: string;
  userId: string;
  email?: string;
  phone?: string;
  isPhoneVerified?: boolean; // true if OTP verified; false if attested only
  name?: string;
  username?: string;
  organization?: string;
  location?: string;
}

/**
 * Enriched Correlated Exposure Outcome produced by ML-2 Intelligence Engine.
 */
export interface CorrelatedExposureOutcome {
  identityId: string;
  userId: string;
  exposureType: string;
  piiTypes: string[];
  ruleVersion: string;
  identityConfidence: number;
  evidenceConfidence: number;
  matchLabel: "CONFIRMED" | "POTENTIAL";
  severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  priorityRank: number;
  threats: string[];
  recommendations: RecommendationTask[];
  evaluationDetails: {
    confidence: ConfidenceEvaluationResult;
    threats: ThreatEvaluationResult;
    severity: SeverityEvaluationResult;
    nameMatch?: NameMatchResult;
  };
}

/**
 * Adapter function connecting ML-1's ExtractedEntity outputs to ML-2's Correlation & Rules Engine.
 *
 * @param entities - Array of ExtractedEntity objects from ML-1 extraction/fusion
 * @param identity - User's monitored identity profile
 * @param discoverySource - Source metadata (e.g. domain, url, isBreachDump, independentSourceCount)
 * @returns CorrelatedExposureOutcome
 */
export function correlateExtractedEntities(
  entities: ExtractedEntity[],
  identity: MonitoredIdentity,
  discoverySource: {
    sourceDomain: string;
    exposureType?: string;
    isBreachDump?: boolean;
    evidenceConfidence?: number;
    independentSourceCount?: number;
  },
): CorrelatedExposureOutcome {
  let exactEmailMatch = false;
  let exactPhoneMatch = false;
  let attestedPhoneMatch = false;
  let exactUsernameMatch = false;
  let bestNameMatch: NameMatchResult | undefined = undefined;
  let orgMatch = false;
  let locationMatch = false;

  const piiTypesSet = new Set<string>();

  for (const entity of entities) {
    piiTypesSet.add(entity.type);
    const normValue = (entity.normalizedValue || entity.rawValue || "")
      .trim()
      .toLowerCase();

    // 1. Email Matching
    if (entity.type === "EMAIL" && identity.email) {
      if (normValue === identity.email.trim().toLowerCase()) {
        exactEmailMatch = true;
      }
    }

    // 2. Phone Matching
    if (entity.type === "PHONE" && identity.phone) {
      const cleanEntityPhone = normValue.replace(/\D/g, "");
      const cleanIdentityPhone = identity.phone.replace(/\D/g, "");
      if (
        cleanEntityPhone.length > 0 &&
        cleanEntityPhone === cleanIdentityPhone
      ) {
        if (identity.isPhoneVerified) {
          exactPhoneMatch = true;
        } else {
          attestedPhoneMatch = true;
        }
      }
    }

    // 3. Username Matching
    if (
      identity.username &&
      normValue === identity.username.trim().toLowerCase()
    ) {
      exactUsernameMatch = true;
    }

    // 4. Person Name Matching
    if (entity.type === "PERSON" && identity.name) {
      const matchRes = compareNames(identity.name, entity.rawValue);
      if (matchRes.isMatch) {
        if (
          !bestNameMatch ||
          matchRes.similarityScore > bestNameMatch.similarityScore
        ) {
          bestNameMatch = matchRes;
        }
      }
    }

    // 5. Organization Matching
    if (entity.type === "ORGANIZATION" && identity.organization) {
      if (
        normValue.includes(identity.organization.trim().toLowerCase()) ||
        identity.organization.trim().toLowerCase().includes(normValue)
      ) {
        orgMatch = true;
      }
    }

    // 6. Location / Address Matching
    if (
      (entity.type === "LOCATION" || entity.type === "ADDRESS") &&
      identity.location
    ) {
      if (
        normValue.includes(identity.location.trim().toLowerCase()) ||
        identity.location.trim().toLowerCase().includes(normValue)
      ) {
        locationMatch = true;
      }
    }
  }

  // Calculate Identity Confidence & Hard Rule Match Label
  const confidenceEval = calculateIdentityConfidence({
    exactEmailMatch,
    exactPhoneMatch,
    attestedPhoneMatch,
    exactUsernameMatch,
    nameMatchResult: bestNameMatch,
    orgMatch,
    locationMatch,
    independentSourceCount: discoverySource.independentSourceCount ?? 1,
  });

  const piiTypes = Array.from(piiTypesSet);
  const primaryExposureType =
    discoverySource.exposureType ||
    (piiTypes.includes("AADHAAR") || piiTypes.includes("PAN")
      ? "GOVT_ID_EXPOSURE"
      : piiTypes.includes("PHONE")
        ? "PUBLIC_PHONE"
        : piiTypes.includes("EMAIL")
          ? "PUBLIC_EMAIL"
          : "PUBLIC_EXPOSURE");

  // Evaluate Threat Ontology
  const threatEval = evaluateThreats({
    exposureType: primaryExposureType,
    piiTypes,
    isBreachDump: discoverySource.isBreachDump,
    matchLabel: confidenceEval.matchLabel,
    independentSourceCount: discoverySource.independentSourceCount ?? 1,
  });

  // Evaluate Severity & Priority Rank
  const severityEval = evaluateSeverity({
    exposureType: primaryExposureType,
    piiTypes,
    isBreachDump: discoverySource.isBreachDump,
    matchLabel: confidenceEval.matchLabel,
    identityConfidence: confidenceEval.identityConfidence,
    evidenceConfidence: discoverySource.evidenceConfidence ?? 0.95,
  });

  // Generate Priority Recommendations
  const recommendations = generateRecommendations({
    exposureType: primaryExposureType,
    piiTypes,
    threats: threatEval.threats,
    matchLabel: confidenceEval.matchLabel,
    sourceDomain: discoverySource.sourceDomain,
  });

  return {
    identityId: identity.id,
    userId: identity.userId,
    exposureType: primaryExposureType,
    piiTypes,
    ruleVersion: confidenceEval.ruleVersion,
    identityConfidence: confidenceEval.identityConfidence,
    evidenceConfidence: discoverySource.evidenceConfidence ?? 0.95,
    matchLabel: confidenceEval.matchLabel,
    severity: severityEval.severity,
    priorityRank: severityEval.priorityRank,
    threats: threatEval.threats,
    recommendations,
    evaluationDetails: {
      confidence: confidenceEval,
      threats: threatEval,
      severity: severityEval,
      nameMatch: bestNameMatch,
    },
  };
}
