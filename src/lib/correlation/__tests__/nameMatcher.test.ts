import { describe, it, expect } from "vitest";
import {
  normalizeNameTokens,
  compareNames,
  matchSingleTokens,
} from "../nameMatcher";
import { isCommonIndianName } from "../indianNames";

describe("Name Matcher & Token Normalization", () => {
  it("normalizes diacritics, punctuation, and honorifics", () => {
    expect(normalizeNameTokens("Dr. R. K. Sharma-Patel")).toEqual([
      "r",
      "k",
      "sharma",
      "patel",
    ]);
    expect(normalizeNameTokens("Prof. Rahul Kumar (Delhi)")).toEqual([
      "rahul",
      "kumar",
      "delhi",
    ]);
    expect(normalizeNameTokens("Élodie Mr. Renée")).toEqual([
      "elodie",
      "renee",
    ]);
  });

  it("matches single tokens exactly, by initial, or not at all", () => {
    expect(matchSingleTokens("rahul", "rahul")).toBe("EXACT");
    expect(matchSingleTokens("r", "rahul")).toBe("INITIAL");
    expect(matchSingleTokens("kumar", "k")).toBe("INITIAL");
    expect(matchSingleTokens("rahul", "amit")).toBeNull();
  });

  it("expands initials ('R. Kumar' ↔ 'Rahul Kumar')", () => {
    const res1 = compareNames("R. Kumar", "Rahul Kumar");
    expect(res1.isMatch).toBe(true);
    expect(res1.matchType).toBe("INITIALS_EXPANSION");
    expect(res1.hasInitialsMatch).toBe(true);

    const res2 = compareNames("Rahul K. Sharma", "R. Kumar Sharma");
    expect(res2.isMatch).toBe(true);
    expect(res2.hasInitialsMatch).toBe(true);
  });

  it("matches reordered tokens as EXACT with similarity 1.0", () => {
    const res3 = compareNames("Kumar, Rahul", "Rahul Kumar");
    expect(res3.isMatch).toBe(true);
    expect(res3.matchType).toBe("EXACT");
    expect(res3.similarityScore).toBe(1.0);
  });

  it("flags ultra-common Indian name pairs", () => {
    expect(isCommonIndianName(["rahul", "kumar"])).toBe(true);
    expect(isCommonIndianName(["rahul", "sharma"])).toBe(true);
    expect(isCommonIndianName(["nithin", "teja"])).toBe(false);
  });

  it("sets hard-rule flags on name-only matches of common names", () => {
    const res4 = compareNames("Rahul Kumar", "Rahul Kumar");
    expect(res4.isCommonName).toBe(true);
    expect(res4.isNameMatchOnlyCap).toBe(true);
  });

  it("rejects non-matching decoy names", () => {
    const res5 = compareNames("Rahul Kumar", "Amit Sharma");
    expect(res5.isMatch).toBe(false);
    expect(res5.matchType).toBe("NO_MATCH");
  });
});
