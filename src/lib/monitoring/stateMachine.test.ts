import { describe, expect, it } from "vitest";
import {
  bumpSeverity,
  NOT_FOUND_SCANS_UNTIL_CLOSED,
  transitionExposure,
  type SeverityLevel,
} from "./stateMachine";

function run(
  prev: Parameters<typeof transitionExposure>[0]["previousState"],
  seen: boolean,
  notFoundCount = 0,
  markedRemediated = false,
) {
  return transitionExposure({ previousState: prev, seenInCurrentScan: seen, notFoundCount, markedRemediated });
}

/** CONTEXT.md §12.2 transition table, edge by edge. */
describe("transitionExposure", () => {
  it("creates FIRST_SEEN for a new detection", () => {
    expect(run(null, true)).toMatchObject({ state: "FIRST_SEEN", notFoundCount: 0 });
  });

  it("confirms FIRST_SEEN → ACTIVE on a later scan", () => {
    expect(run("FIRST_SEEN", true)).toMatchObject({ state: "ACTIVE", notFoundCount: 0 });
  });

  it("keeps ACTIVE exposures unchanged while still present", () => {
    expect(run("ACTIVE", true)).toMatchObject({ state: "UNCHANGED", notFoundCount: 0 });
  });

  it("moves ACTIVE → NOT_FOUND when a re-scan misses it", () => {
    expect(run("ACTIVE", false)).toMatchObject({ state: "NOT_FOUND", notFoundCount: 1 });
  });

  it("moves FIRST_SEEN → NOT_FOUND when the next scan misses it", () => {
    expect(run("FIRST_SEEN", false)).toMatchObject({ state: "NOT_FOUND", notFoundCount: 1 });
  });

  it("escalates NOT_FOUND → REAPPEARED with a severity bump (story 23)", () => {
    expect(run("NOT_FOUND", true, 1)).toMatchObject({
      state: "REAPPEARED",
      severityBump: true,
      notFoundCount: 0,
    });
  });

  it(`auto-closes after ${NOT_FOUND_SCANS_UNTIL_CLOSED} consecutive NOT_FOUND scans (story 24)`, () => {
    expect(run("NOT_FOUND", false, NOT_FOUND_SCANS_UNTIL_CLOSED - 1)).toMatchObject({
      state: "CLOSED",
      becameClosed: true,
    });
    expect(run("NOT_FOUND", false, 1)).toMatchObject({ state: "NOT_FOUND", notFoundCount: 2 });
  });

  it("escalates REMEDIATED → REAPPEARED when the takedown did not hold", () => {
    expect(run("REMEDIATED", true)).toMatchObject({ state: "REAPPEARED", severityBump: true });
  });

  it("keeps REMEDIATED sticky while absent (a user action is not an organic disappearance)", () => {
    expect(run("REMEDIATED", false)).toMatchObject({ state: "REMEDIATED", notFoundCount: 0 });
  });

  it("escalates CLOSED → REAPPEARED when a closed exposure comes back", () => {
    expect(run("CLOSED", true)).toMatchObject({ state: "REAPPEARED", severityBump: true });
  });

  it("leaves CLOSED untouched while absent", () => {
    expect(run("CLOSED", false)).toMatchObject({ state: "CLOSED" });
  });

  it("applies a user remediation immediately, even against this scan's absence", () => {
    expect(run("ACTIVE", false, 0, true)).toMatchObject({ state: "REMEDIATED" });
    expect(run("FIRST_SEEN", true, 0, true)).toMatchObject({ state: "REMEDIATED" });
  });

  it("never escalates away from CLOSED via the remediation path", () => {
    expect(run("CLOSED", false, 0, true)).toMatchObject({ state: "CLOSED" });
  });
});

describe("bumpSeverity — REAPPEARED escalation ladder", () => {
  const ladder: Array<[SeverityLevel, SeverityLevel]> = [
    ["LOW", "MEDIUM"],
    ["MEDIUM", "HIGH"],
    ["HIGH", "CRITICAL"],
    ["CRITICAL", "CRITICAL"], // capped
  ];
  it.each(ladder)("bumps %s → %s", (from, to) => {
    expect(bumpSeverity(from)).toBe(to);
  });
});
