import { describe, it, expect } from "vitest";
import { compareNames } from "../../correlation/nameMatcher";
import {
  calculateIdentityConfidence,
  evaluateThreats,
  evaluateSeverity,
  generateRecommendations,
} from "../index";

describe("Rules Engine & Severity Framework", () => {
  it("classifies a credential dump breach as CRITICAL with credential actions", () => {
    const confA = calculateIdentityConfidence({ exactEmailMatch: true });
    const threatA = evaluateThreats({
      exposureType: "CREDENTIAL_EXPOSURE",
      piiTypes: ["EMAIL"],
      isBreachDump: true,
      matchLabel: confA.matchLabel,
    });
    const sevA = evaluateSeverity({
      exposureType: "CREDENTIAL_EXPOSURE",
      piiTypes: ["EMAIL"],
      isBreachDump: true,
      matchLabel: confA.matchLabel,
      identityConfidence: confA.identityConfidence,
    });
    const recsA = generateRecommendations({
      exposureType: "CREDENTIAL_EXPOSURE",
      piiTypes: ["EMAIL"],
      threats: threatA.threats,
      matchLabel: confA.matchLabel,
    });

    expect(sevA.severity).toBe("CRITICAL");
    expect(sevA.priorityRank).toBe(100);
    expect(threatA.threats).toContain("CREDENTIAL_STUFFING");
    expect(threatA.threats).toContain("ACCOUNT_TAKEOVER");
    expect(recsA.some((r) => r.actionCode === "CHANGE_PASSWORD")).toBe(true);
    expect(recsA.some((r) => r.actionCode === "ENABLE_MFA")).toBe(true);
  });

  it("classifies confirmed Aadhaar/PAN exposure as CRITICAL (rank 95)", () => {
    const confB = calculateIdentityConfidence({
      exactEmailMatch: true,
      orgMatch: true,
    });
    const threatB = evaluateThreats({
      exposureType: "GOVT_ID_EXPOSURE",
      piiTypes: ["AADHAAR", "PAN", "EMAIL"],
      matchLabel: confB.matchLabel,
    });
    const sevB = evaluateSeverity({
      exposureType: "GOVT_ID_EXPOSURE",
      piiTypes: ["AADHAAR", "PAN", "EMAIL"],
      matchLabel: confB.matchLabel,
      identityConfidence: confB.identityConfidence,
    });

    expect(sevB.severity).toBe("CRITICAL");
    expect(sevB.priorityRank).toBe(95);
    expect(threatB.threats).toContain("IDENTITY_FRAUD_ENABLEMENT");
  });

  it("classifies a broker listing as MEDIUM and auto-resolves the opt-out URL", () => {
    const confC = calculateIdentityConfidence({
      exactPhoneMatch: true,
    });
    const threatC = evaluateThreats({
      exposureType: "BROKER_LISTING",
      piiTypes: ["PHONE", "EMAIL"],
      matchLabel: confC.matchLabel,
    });
    const sevC = evaluateSeverity({
      exposureType: "BROKER_LISTING",
      piiTypes: ["PHONE", "EMAIL"],
      matchLabel: confC.matchLabel,
      identityConfidence: confC.identityConfidence,
    });
    const recsC = generateRecommendations({
      exposureType: "BROKER_LISTING",
      piiTypes: ["PHONE", "EMAIL"],
      threats: threatC.threats,
      matchLabel: confC.matchLabel,
      optOutUrl: "https://example-broker.org/optout",
    });

    expect(sevC.severity).toBe("MEDIUM");
    expect(recsC.some((r) => r.actionCode === "OPT_OUT_BROKER")).toBe(true);
    expect(
      recsC.find((r) => r.actionCode === "OPT_OUT_BROKER")?.optOutUrl,
    ).toBe("https://example-broker.org/optout");
  });

  it("keeps a name-only decoy LOW severity and recommends VERIFY_BEFORE_ACTION", () => {
    const nameResDecoy = compareNames("Rahul Kumar", "Rahul Kumar");
    const confD = calculateIdentityConfidence({
      nameMatchResult: nameResDecoy,
    });
    const sevD = evaluateSeverity({
      exposureType: "PUBLIC_PROFILE",
      piiTypes: ["PERSON"],
      matchLabel: confD.matchLabel,
      identityConfidence: confD.identityConfidence,
    });
    const recsD = generateRecommendations({
      exposureType: "PUBLIC_PROFILE",
      piiTypes: ["PERSON"],
      threats: ["INFORMATIONAL"],
      matchLabel: confD.matchLabel,
    });

    expect(confD.matchLabel).toBe("POTENTIAL");
    expect(sevD.severity).toBe("LOW");
    expect(recsD.some((r) => r.actionCode === "VERIFY_BEFORE_ACTION")).toBe(
      true,
    );
  });
});
