export const RULE_VERSION = "v1.0.0";

export type ActionCode =
  | "CHANGE_PASSWORD"
  | "CHECK_PASSWORD_REUSE"
  | "ENABLE_MFA"
  | "REVOKE_SESSIONS"
  | "REQUEST_REMOVAL"
  | "REVIEW_VISIBILITY"
  | "CONTACT_PUBLISHER_REDACTION"
  | "OPT_OUT_BROKER"
  | "VERIFY_BEFORE_ACTION";

export interface RecommendationTask {
  actionCode: ActionCode;
  title: string;
  description: string;
  optOutUrl?: string;
  priorityOrder: number;
}

export interface RecommendationInput {
  exposureType: string;
  piiTypes: string[];
  threats: string[];
  matchLabel: "CONFIRMED" | "POTENTIAL";
  optOutUrl?: string;
}

export const ACTION_CATALOG: Record<
  ActionCode,
  Omit<RecommendationTask, "optOutUrl">
> = {
  CHANGE_PASSWORD: {
    actionCode: "CHANGE_PASSWORD",
    title: "Change Account Password",
    description:
      "Update password immediately on the impacted service to prevent account takeover.",
    priorityOrder: 1,
  },
  CHECK_PASSWORD_REUSE: {
    actionCode: "CHECK_PASSWORD_REUSE",
    title: "Audit Reused Passwords",
    description:
      "If this password was reused on other websites or services, change them immediately.",
    priorityOrder: 2,
  },
  ENABLE_MFA: {
    actionCode: "ENABLE_MFA",
    title: "Enable Multi-Factor Authentication (MFA)",
    description:
      "Add an extra layer of defense (authenticator app or hardware key) to secure your account.",
    priorityOrder: 3,
  },
  REVOKE_SESSIONS: {
    actionCode: "REVOKE_SESSIONS",
    title: "Revoke Active Sessions",
    description:
      "Log out of all existing active sessions on the impacted service.",
    priorityOrder: 4,
  },
  REQUEST_REMOVAL: {
    actionCode: "REQUEST_REMOVAL",
    title: "Request Data Removal",
    description:
      "Submit a formal request to the hosting website or platform to suppress your personal information.",
    priorityOrder: 5,
  },
  REVIEW_VISIBILITY: {
    actionCode: "REVIEW_VISIBILITY",
    title: "Review Profile Privacy Settings",
    description:
      "Adjust account visibility settings to restrict access to contact details.",
    priorityOrder: 6,
  },
  CONTACT_PUBLISHER_REDACTION: {
    actionCode: "CONTACT_PUBLISHER_REDACTION",
    title: "Request Document Redaction",
    description:
      "Contact the publisher or administrator of the document to redact your home address or private identifiers.",
    priorityOrder: 7,
  },
  OPT_OUT_BROKER: {
    actionCode: "OPT_OUT_BROKER",
    title: "Opt-Out of Data Broker Directory",
    description:
      "Use the broker's official opt-out form to remove your public directory listing.",
    priorityOrder: 1,
  },
  VERIFY_BEFORE_ACTION: {
    actionCode: "VERIFY_BEFORE_ACTION",
    title: "Verify Identity Match",
    description:
      "Confirm whether this finding belongs to you before initiating removal or opt-out requests.",
    priorityOrder: 1,
  },
};

/**
 * Derives concrete remediation action recommendations for an exposure (CONTEXT.md §8.3).
 *
 * @param input - RecommendationInput
 * @returns Array of RecommendationTask objects ordered by priority
 */
export function generateRecommendations(
  input: RecommendationInput,
): RecommendationTask[] {
  const actionsMap = new Map<ActionCode, RecommendationTask>();

  const isConfirmed = input.matchLabel === "CONFIRMED";
  const piiSet = new Set(input.piiTypes.map((p) => p.toUpperCase()));
  const exposureTypeUpper = input.exposureType.toUpperCase();
  const threatsSet = new Set(input.threats.map((t) => t.toUpperCase()));

  // 1. If match is unconfirmed (POTENTIAL), suggest verification first
  if (!isConfirmed) {
    actionsMap.set("VERIFY_BEFORE_ACTION", {
      ...ACTION_CATALOG.VERIFY_BEFORE_ACTION,
    });
  }

  // 2. Credential Exposure Actions
  if (
    threatsSet.has("CREDENTIAL_STUFFING") ||
    threatsSet.has("ACCOUNT_TAKEOVER") ||
    exposureTypeUpper.includes("CREDENTIAL")
  ) {
    actionsMap.set("CHANGE_PASSWORD", { ...ACTION_CATALOG.CHANGE_PASSWORD });
    actionsMap.set("CHECK_PASSWORD_REUSE", {
      ...ACTION_CATALOG.CHECK_PASSWORD_REUSE,
    });
    actionsMap.set("ENABLE_MFA", { ...ACTION_CATALOG.ENABLE_MFA });
    actionsMap.set("REVOKE_SESSIONS", { ...ACTION_CATALOG.REVOKE_SESSIONS });
  }

  // 3. Data Broker Opt-Out Actions
  if (exposureTypeUpper.includes("BROKER") || input.optOutUrl) {
    actionsMap.set("OPT_OUT_BROKER", {
      ...ACTION_CATALOG.OPT_OUT_BROKER,
      optOutUrl: input.optOutUrl,
    });
  }

  // 4. Physical Address / Document Redaction Actions
  if (
    piiSet.has("ADDRESS") ||
    piiSet.has("LOCATION") ||
    threatsSet.has("PHYSICAL_TARGETING")
  ) {
    actionsMap.set("CONTACT_PUBLISHER_REDACTION", {
      ...ACTION_CATALOG.CONTACT_PUBLISHER_REDACTION,
    });
  }

  // 5. Phone / Email Contact Exposure Actions
  if (
    piiSet.has("PHONE") ||
    piiSet.has("EMAIL") ||
    threatsSet.has("TARGETED_PHISHING")
  ) {
    actionsMap.set("REQUEST_REMOVAL", { ...ACTION_CATALOG.REQUEST_REMOVAL });
    actionsMap.set("REVIEW_VISIBILITY", {
      ...ACTION_CATALOG.REVIEW_VISIBILITY,
    });
  }

  // Fallback default action
  if (actionsMap.size === 0) {
    actionsMap.set("REVIEW_VISIBILITY", {
      ...ACTION_CATALOG.REVIEW_VISIBILITY,
    });
  }

  // Sort tasks by priorityOrder
  const resultList = Array.from(actionsMap.values()).sort(
    (a, b) => a.priorityOrder - b.priorityOrder,
  );

  return resultList;
}
