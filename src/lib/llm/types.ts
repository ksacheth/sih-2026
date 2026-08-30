/**
 * Redacted Finding Input Schema for Groq LLM (CONTEXT.md §9.1 & TASKS.md §4.3).
 * HARD PRIVACY RULE: NEVER include raw PII, full names, emails, phones, Aadhaar/PAN values,
 * or raw document text in this schema.
 */
export interface RedactedFindingForLLM {
  riskLevel: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  exposureType: string; // e.g. "PUBLIC_PHONE", "BREACH_CREDENTIAL", "BROKER_LISTING"
  identityConfidence: number; // 0.00 to 0.98
  evidenceConfidence: number; // 0.00 to 1.00
  evidenceTier: "document" | "snippet";
  sourceDomains: string[]; // e.g. ["example.org", "pastebin.com"]
  threats: string[]; // e.g. ["TARGETED_PHISHING", "ACCOUNT_TAKEOVER"]
  recommendedActionCodes: string[]; // e.g. ["REQUEST_REMOVAL", "ENABLE_MFA"]
}

/**
 * Structured Output Schema returned by the Explanation Layer.
 */
export interface ExplanationOutput {
  /** Concise plain-language summary of the threat and why it matters */
  summary: string;
  /** Explanation of why the source domain is relevant */
  sourceRelevance: string;
  /** True if produced by Groq LLM model; false if generated via deterministic template fallback */
  isAiGenerated: boolean;
  /** Timestamp ISO string */
  generatedAt: string;
}
