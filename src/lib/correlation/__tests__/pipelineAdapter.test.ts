import { describe, it, expect } from "vitest";
import {
  correlateExtractedEntities,
  ExtractedEntity,
  MonitoredIdentity,
} from "../pipelineAdapter";

// Monitored Target Identity
const targetIdentity: MonitoredIdentity = {
  id: "identity_rahul",
  userId: "user_001",
  name: "Rahul Kumar",
  email: "rahul.kumar@abc-tech.in",
  phone: "+91 98765 43210",
  isPhoneVerified: true,
  username: "rahul_kumar_dev",
  organization: "ABC Technologies",
  location: "Delhi",
};

describe("Pipeline Adapter (ML-1 ExtractedEntities → ML-2 Engine)", () => {
  it("confirms exact email & phone extracted from a paste site as CRITICAL", () => {
    const ml1Entities1: ExtractedEntity[] = [
      { type: "PERSON", rawValue: "Rahul Kumar", normalizedValue: "rahul kumar", detector: "gliner", detectorConfidence: 0.96 },
      { type: "ORGANIZATION", rawValue: "ABC Technologies", normalizedValue: "abc technologies", detector: "gliner", detectorConfidence: 0.92 },
      { type: "EMAIL", rawValue: "rahul.kumar@abc-tech.in", normalizedValue: "rahul.kumar@abc-tech.in", detector: "regex", detectorConfidence: 0.99 },
      { type: "PHONE", rawValue: "+91 98765 43210", normalizedValue: "+919876543210", detector: "regex", detectorConfidence: 0.98 },
    ];

    const outcome1 = correlateExtractedEntities(ml1Entities1, targetIdentity, {
      sourceDomain: "pastebin.com",
      exposureType: "CREDENTIAL_EXPOSURE",
      isBreachDump: true,
      independentSourceCount: 2,
    });

    expect(outcome1.matchLabel).toBe("CONFIRMED");
    expect(outcome1.identityConfidence).toBe(0.90);
    expect(outcome1.severity).toBe("CRITICAL");
    expect(outcome1.threats).toContain("CREDENTIAL_STUFFING");
    expect(
      outcome1.recommendations.some((r) => r.actionCode === "CHANGE_PASSWORD"),
    ).toBe(true);
  });

  it("confirms a verified phone on a broker listing and auto-resolves the Truecaller opt-out URL", () => {
    const ml1Entities2: ExtractedEntity[] = [
      { type: "PERSON", rawValue: "Rahul Kumar", normalizedValue: "rahul kumar", detector: "gliner", detectorConfidence: 0.95 },
      { type: "PHONE", rawValue: "+91 98765 43210", normalizedValue: "+919876543210", detector: "regex", detectorConfidence: 0.98 },
    ];

    const outcome2 = correlateExtractedEntities(ml1Entities2, targetIdentity, {
      sourceDomain: "truecaller.com",
      exposureType: "BROKER_LISTING",
    });

    expect(outcome2.matchLabel).toBe("CONFIRMED");
    expect(outcome2.severity).toBe("MEDIUM");
    const optOutTask = outcome2.recommendations.find(
      (r) => r.actionCode === "OPT_OUT_BROKER",
    );
    expect(optOutTask).toBeDefined();
    expect(optOutTask?.optOutUrl).toBe("https://www.truecaller.com/unlisting");
  });

  it("keeps a near-miss decoy name without exact identifiers at POTENTIAL/LOW", () => {
    const ml1EntitiesDecoy: ExtractedEntity[] = [
      { type: "PERSON", rawValue: "R. Kumar", normalizedValue: "r kumar", detector: "gliner", detectorConfidence: 0.90 },
      { type: "ORGANIZATION", rawValue: "Other Company", normalizedValue: "other company", detector: "gliner", detectorConfidence: 0.85 },
    ];

    const outcomeDecoy = correlateExtractedEntities(
      ml1EntitiesDecoy,
      targetIdentity,
      {
        sourceDomain: "example-forum.org",
      },
    );

    expect(outcomeDecoy.matchLabel).toBe("POTENTIAL");
    expect(outcomeDecoy.severity).toBe("LOW");
    expect(
      outcomeDecoy.recommendations.some(
        (r) => r.actionCode === "VERIFY_BEFORE_ACTION",
      ),
    ).toBe(true);
  });
});
