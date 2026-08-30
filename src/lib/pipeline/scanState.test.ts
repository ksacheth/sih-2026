import { describe, expect, it } from "vitest";
import {
  aggregateScanStatus,
  breachCandidate,
  brokerCandidate,
  isStaleScan,
  SCAN_STUCK_THRESHOLD_MS,
} from "./scanState";
import type { DiscoveryResult } from "@/lib/connectors";

function breachResult(overrides: Partial<DiscoveryResult> = {}): DiscoveryResult {
  return {
    source: "exposedornot",
    sourceId: "LinkedInScrape2023",
    url: "https://xposedornot.com",
    domain: "xposedornot.com",
    title: "Breach record: LinkedInScrape2023",
    snippet: "Email address appears in the breach record.",
    discoveredAt: "2026-08-30T00:00:00.000Z",
    contentType: "breach_record",
    evidenceTier: "document",
    rawMetadata: {},
    ...overrides,
  };
}

describe("aggregateScanStatus (§3.1 step 10)", () => {
  it("COMPLETED when every evaluated source is OK", () => {
    expect(aggregateScanStatus({ serper: "OK", exposedornot: "OK", brokers: "OK" })).toBe("COMPLETED");
  });

  it("SKIPPED is neutral — one real source OK is still COMPLETED", () => {
    expect(aggregateScanStatus({ serper: "OK", exposedornot: "SKIPPED", brokers: "OK" })).toBe("COMPLETED");
  });

  it("PARTIAL when some sources failed, FAILED when none are usable", () => {
    expect(aggregateScanStatus({ serper: "OK", exposedornot: "UNAVAILABLE" })).toBe("PARTIAL");
    expect(aggregateScanStatus({ serper: "UNAVAILABLE", exposedornot: "UNAVAILABLE" })).toBe("FAILED");
    expect(aggregateScanStatus({})).toBe("FAILED");
  });
});

describe("isStaleScan (boot crash recovery, §3.1)", () => {
  const now = Date.now();
  const old = (ms: number) => new Date(now - ms);

  it("marks RUNNING scans older than 10 minutes as stale", () => {
    expect(
      isStaleScan({ status: "RUNNING", startedAt: old(SCAN_STUCK_THRESHOLD_MS + 1000), createdAt: old(SCAN_STUCK_THRESHOLD_MS + 1000) }, now),
    ).toBe(true);
    expect(isStaleScan({ status: "RUNNING", startedAt: old(1000), createdAt: old(1000) }, now)).toBe(false);
  });

  it("marks orphaned QUEUED scans stale via createdAt (one-active-scan unblock)", () => {
    expect(isStaleScan({ status: "QUEUED", createdAt: old(SCAN_STUCK_THRESHOLD_MS + 1000) }, now)).toBe(true);
    expect(isStaleScan({ status: "QUEUED", createdAt: old(1000) }, now)).toBe(false);
  });

  it("ignores terminal scans and scans without an anchor", () => {
    expect(isStaleScan({ status: "COMPLETED", createdAt: old(999_999_999) }, now)).toBe(false);
    expect(isStaleScan({ status: "RUNNING" }, now)).toBe(false);
  });
});

describe("breachCandidate — structured source → exposure candidate", () => {
  it("tags credential-bearing dumps CREDENTIAL_EXPOSURE with rules-engine severity", () => {
    const candidate = breachCandidate(
      breachResult({ rawMetadata: { signals: ["CREDENTIAL_EXPOSURE"], credentialExposure: true } }),
    );
    expect(candidate.exposureType).toBe("CREDENTIAL_EXPOSURE");
    expect(candidate.matchLabel).toBe("CONFIRMED");
    expect(candidate.severity).toBe("CRITICAL");
    expect(candidate.entity).toBe("LinkedInScrape2023");
    expect(candidate.ruleVersion).toBeTruthy();
    expect(candidate.recommendations.length).toBeGreaterThan(0);
    expect(candidate.recommendations[0]).toHaveProperty("action");
  });

  it("keeps a breach without passwords as a BREACH_RECORD exposure", () => {
    const candidate = breachCandidate(breachResult());
    expect(candidate.exposureType).toBe("BREACH_RECORD");
    expect(candidate.evidence.sourceId).toBe("LinkedInScrape2023");
  });
});

describe("brokerCandidate — derived listing → POTENTIAL exposure", () => {
  it("carries the broker domain, curated opt-out URL, and POTENTIAL label", () => {
    const candidate = brokerCandidate(
      breachResult({
        source: "brokers",
        sourceId: "brokers:radaris.com",
        domain: "radaris.com",
        evidenceTier: "snippet",
        rawMetadata: {
          broker: { name: "Radaris", optOutUrl: "https://radaris.com/optout" },
          matchedDomain: "radaris.com",
        },
      }),
    );
    expect(candidate.exposureType).toBe("DATA_BROKER_LISTING");
    expect(candidate.entity).toBe("radaris.com");
    expect(candidate.matchLabel).toBe("POTENTIAL");
    expect(candidate.severity).toBe("MEDIUM");
    const withOptOut = candidate.recommendations.find((r) => r.optOutUrl);
    expect(withOptOut?.optOutUrl).toBe("https://radaris.com/optout");
  });

  it("grades document-tier evidence higher than snippet-tier", () => {
    const document = brokerCandidate(
      breachResult({ source: "brokers", domain: "radaris.com", evidenceTier: "document", rawMetadata: { matchedDomain: "radaris.com" } }),
    );
    const snippet = brokerCandidate(
      breachResult({ source: "brokers", domain: "radaris.com", evidenceTier: "snippet", rawMetadata: { matchedDomain: "radaris.com" } }),
    );
    expect(document.evidenceConfidence).toBeGreaterThan(snippet.evidenceConfidence);
  });
});
