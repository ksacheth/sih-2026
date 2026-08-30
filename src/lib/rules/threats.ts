export const RULE_VERSION = "v1.0.0";

export type ThreatCode =
  | "CREDENTIAL_STUFFING"
  | "ACCOUNT_TAKEOVER"
  | "TARGETED_PHISHING"
  | "SOCIAL_ENGINEERING"
  | "PHYSICAL_TARGETING"
  | "STALKING_RISK"
  | "IMPERSONATION"
  | "IDENTITY_FRAUD_ENABLEMENT"
  | "INFORMATIONAL";

export interface ThreatDefinition {
  code: ThreatCode;
  title: string;
  description: string;
  category: "CREDENTIAL" | "PHISHING" | "PHYSICAL" | "IDENTITY" | "INFO";
}

export const THREAT_CATALOG: Record<ThreatCode, ThreatDefinition> = {
  CREDENTIAL_STUFFING: {
    code: "CREDENTIAL_STUFFING",
    title: "Credential Stuffing Vulnerability",
    description:
      "Exposed breach credentials can be used in automated attacks against other accounts.",
    category: "CREDENTIAL",
  },
  ACCOUNT_TAKEOVER: {
    code: "ACCOUNT_TAKEOVER",
    title: "Account Takeover Risk",
    description:
      "Leaked credentials or passwords enable unauthorized access to user accounts.",
    category: "CREDENTIAL",
  },
  TARGETED_PHISHING: {
    code: "TARGETED_PHISHING",
    title: "Targeted Phishing (Spear Phishing)",
    description:
      "Exposed contact details combined with profile context enable convincing targeted phishing attempts.",
    category: "PHISHING",
  },
  SOCIAL_ENGINEERING: {
    code: "SOCIAL_ENGINEERING",
    title: "Social Engineering Risk",
    description:
      "Correlated personal information enables attackers to impersonate trusted entities or manipulate the target.",
    category: "PHISHING",
  },
  PHYSICAL_TARGETING: {
    code: "PHYSICAL_TARGETING",
    title: "Physical Location Exposure",
    description:
      "Public exposure of home address or location context increases physical security risks.",
    category: "PHYSICAL",
  },
  STALKING_RISK: {
    code: "STALKING_RISK",
    title: "Stalking & Harassment Risk",
    description:
      "Co-occurring address, workplace, and personal contact details enable unwanted tracking.",
    category: "PHYSICAL",
  },
  IMPERSONATION: {
    code: "IMPERSONATION",
    title: "Identity Impersonation",
    description:
      "Public identity indicators allow malicious actors to impersonate the individual online.",
    category: "IDENTITY",
  },
  IDENTITY_FRAUD_ENABLEMENT: {
    code: "IDENTITY_FRAUD_ENABLEMENT",
    title: "Identity Fraud Enablement",
    description:
      "Exposed government or financial identifiers enable fraudulent account opening or identity theft.",
    category: "IDENTITY",
  },
  INFORMATIONAL: {
    code: "INFORMATIONAL",
    title: "Informational Finding",
    description:
      "Low-confidence or non-sensitive public reference requiring verification before escalation.",
    category: "INFO",
  },
};

export interface ThreatInputSignals {
  /** Exposure category, e.g., CREDENTIAL_EXPOSURE, PUBLIC_PHONE, PUBLIC_EMAIL, AADHAAR, PAN, BROKER_LISTING */
  exposureType: string;
  /** List of extracted PII entity types, e.g., ["EMAIL", "PHONE", "ADDRESS", "AADHAAR", "PAN", "ORGANIZATION"] */
  piiTypes: string[];
  /** Flag indicating if breach record contains credential dumps */
  isBreachDump?: boolean;
  /** Match label from Entity Resolution Engine */
  matchLabel: "CONFIRMED" | "POTENTIAL";
  /** Number of independent sources where finding co-occurs */
  independentSourceCount?: number;
}

export interface ThreatEvaluationResult {
  ruleVersion: string;
  threats: ThreatCode[];
  threatDetails: ThreatDefinition[];
  reasons: string[];
}

/**
 * Maps exposure patterns to threat classifications using deterministic rules (CONTEXT.md §8.1).
 *
 * @param input - ThreatInputSignals
 * @returns ThreatEvaluationResult containing list of identified threats
 */
export function evaluateThreats(
  input: ThreatInputSignals,
): ThreatEvaluationResult {
  const threatsSet = new Set<ThreatCode>();
  const reasons: string[] = [];

  const piiSet = new Set(input.piiTypes.map((p) => p.toUpperCase()));
  const isConfirmed = input.matchLabel === "CONFIRMED";

  // 1. Credential Exposure Threat Rules
  if (
    input.isBreachDump ||
    input.exposureType.toUpperCase().includes("CREDENTIAL")
  ) {
    threatsSet.add("CREDENTIAL_STUFFING");
    threatsSet.add("ACCOUNT_TAKEOVER");
    reasons.push(
      "Breach indicator includes credential dump -> CREDENTIAL_STUFFING & ACCOUNT_TAKEOVER threats.",
    );
  }

  // 2. Government / Financial ID Exposure Rules
  if (
    piiSet.has("AADHAAR") ||
    piiSet.has("PAN") ||
    input.exposureType.includes("GOVT_ID")
  ) {
    threatsSet.add("IDENTITY_FRAUD_ENABLEMENT");
    threatsSet.add("IMPERSONATION");
    reasons.push(
      "Government/financial identifier exposed -> IDENTITY_FRAUD_ENABLEMENT & IMPERSONATION threats.",
    );
  }

  // 3. Phishing & Social Engineering Rules
  const hasEmail = piiSet.has("EMAIL") || input.exposureType.includes("EMAIL");
  const hasPhone = piiSet.has("PHONE") || input.exposureType.includes("PHONE");
  const hasOrg = piiSet.has("ORGANIZATION") || piiSet.has("ORG");

  if ((hasEmail && hasPhone) || (hasEmail && hasOrg) || (hasPhone && hasOrg)) {
    threatsSet.add("TARGETED_PHISHING");
    threatsSet.add("SOCIAL_ENGINEERING");
    reasons.push(
      "Correlated contact details + profile context -> TARGETED_PHISHING & SOCIAL_ENGINEERING threats.",
    );
  } else if (hasEmail || hasPhone) {
    if (isConfirmed) {
      threatsSet.add("TARGETED_PHISHING");
      reasons.push("Confirmed contact exposure -> TARGETED_PHISHING threat.");
    }
  }

  // 4. Physical Security & Stalking Rules
  const hasAddress = piiSet.has("ADDRESS") || piiSet.has("LOCATION");
  if (hasAddress && (hasPhone || hasOrg)) {
    threatsSet.add("PHYSICAL_TARGETING");
    threatsSet.add("STALKING_RISK");
    reasons.push(
      "Address correlated with phone or workplace -> PHYSICAL_TARGETING & STALKING_RISK threats.",
    );
  } else if (hasAddress) {
    threatsSet.add("PHYSICAL_TARGETING");
    reasons.push("Public address exposure -> PHYSICAL_TARGETING threat.");
  }

  // 5. Multi-Source Public Identity Field Rules
  if ((input.independentSourceCount ?? 1) >= 2 && piiSet.size >= 2) {
    threatsSet.add("IMPERSONATION");
    reasons.push(
      "Co-occurrence across multiple independent sources -> IMPERSONATION threat.",
    );
  }

  // 6. Fallback for single weak / potential matches
  if (threatsSet.size === 0 || !isConfirmed) {
    if (threatsSet.size === 0) {
      threatsSet.add("INFORMATIONAL");
      reasons.push(
        "No high-urgency threat pattern matched -> INFORMATIONAL threat.",
      );
    }
  }

  const threats = Array.from(threatsSet);
  const threatDetails = threats.map((code) => THREAT_CATALOG[code]);

  return {
    ruleVersion: RULE_VERSION,
    threats,
    threatDetails,
    reasons,
  };
}
