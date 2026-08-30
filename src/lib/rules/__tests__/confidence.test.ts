import { describe, it, expect } from "vitest";
import { compareNames } from "../../correlation/nameMatcher";
import { calculateIdentityConfidence } from "../confidence";

describe("Confidence & Hard Rule Evaluation", () => {
  it("labels an exact email match CONFIRMED at 0.90", () => {
    const conf1 = calculateIdentityConfidence({ exactEmailMatch: true });
    expect(conf1.matchLabel).toBe("CONFIRMED");
    expect(conf1.identityConfidence).toBe(0.9);
  });

  it("caps a name-only match (with initials expansion) at POTENTIAL / <= 0.50", () => {
    const nameRes1 = compareNames("R. Kumar", "Rahul Kumar");
    const conf2 = calculateIdentityConfidence({ nameMatchResult: nameRes1 });
    expect(conf2.matchLabel).toBe("POTENTIAL");
    expect(conf2.identityConfidence).toBeLessThanOrEqual(0.5);
    expect(conf2.penaltiesApplied).toBe(0.1);
  });

  it("caps a decoy name-only match at POTENTIAL / <= 0.50", () => {
    const nameResDecoy = compareNames("Rahul Kumar", "Rahul Kumar");
    const confDecoy = calculateIdentityConfidence({
      nameMatchResult: nameResDecoy,
    });
    expect(confDecoy.matchLabel).toBe("POTENTIAL");
    expect(confDecoy.identityConfidence).toBeLessThanOrEqual(0.5);
  });

  it("keeps POTENTIAL with only one corroborating signal (+0.05)", () => {
    const nameRes1 = compareNames("R. Kumar", "Rahul Kumar");
    const conf4 = calculateIdentityConfidence({
      nameMatchResult: nameRes1,
      orgMatch: true, // 1 corroboration
    });
    expect(conf4.matchLabel).toBe("POTENTIAL");
    expect(conf4.corroborationBonus).toBe(0.05);
  });

  it("upgrades name match + 2 corroborations to CONFIRMED (0.30 - 0.10 + 0.05 + 0.03 = 0.28)", () => {
    const nameRes1 = compareNames("R. Kumar", "Rahul Kumar");
    const conf5 = calculateIdentityConfidence({
      nameMatchResult: nameRes1,
      orgMatch: true, // Corroboration 1
      locationMatch: true, // Corroboration 2
    });
    expect(conf5.matchLabel).toBe("CONFIRMED");
    expect(conf5.identityConfidence).toBe(0.28);
  });

  it("bounds attested-phone-only matches at POTENTIAL / <= 0.75", () => {
    const conf6 = calculateIdentityConfidence({
      attestedPhoneMatch: true,
      orgMatch: true,
      locationMatch: true,
      independentSourceCount: 3,
    });
    expect(conf6.matchLabel).toBe("POTENTIAL");
    expect(conf6.identityConfidence).toBeLessThanOrEqual(0.75);
  });

  it("adds org corroboration to exact email (0.90 + 0.05 = 0.95)", () => {
    const conf7 = calculateIdentityConfidence({
      exactEmailMatch: true,
      orgMatch: true,
    });
    expect(conf7.matchLabel).toBe("CONFIRMED");
    expect(conf7.identityConfidence).toBe(0.95);
  });
});
