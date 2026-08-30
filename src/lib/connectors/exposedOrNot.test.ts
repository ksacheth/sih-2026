import { describe, expect, it } from "vitest";
import {
  buildBreachResults,
  exposedOrNotConnector,
  parseCheckEmail,
  parseBreachMetrics,
} from "./exposedOrNot";
import { pickExposedOrNotFixture, shouldUseFixtures } from "./fixtures";
import { CREDENTIAL_EXPOSURE_SIGNAL, ConnectorError } from "./types";

// Connector tests always run in fixture mode — never against live APIs (§14.4).
process.env.FIXTURES = "1";

// Canonical monitored identity (person_1 in the team dataset).
const EMAIL = "rahul.kumar@abc-tech.in";

describe("fixture player (v2 dataset shape)", () => {
  it("finds the recorded breach records for the monitored identity", () => {
    const fixture = pickExposedOrNotFixture(EMAIL);
    const names = fixture.checkEmail.breaches?.flat() ?? [];
    expect(names).toContain("CodeDump-2024");
    expect(names).toContain("TechDB-2023");
  });

  it("maps unknown emails to a genuine not-found response", () => {
    expect(pickExposedOrNotFixture("clean@example.com").checkEmail.Error).toBe("Not found");
  });

  it("treats FIXTURES=1 as fixture mode regardless of keys", () => {
    const previous = process.env.FIXTURES;
    process.env.FIXTURES = "1";
    try {
      expect(shouldUseFixtures("anything")).toBe(true);
      expect(shouldUseFixtures(undefined)).toBe(true);
    } finally {
      if (previous === undefined) delete process.env.FIXTURES;
      else process.env.FIXTURES = previous;
    }
  });

  it("treats a missing API key as fixture mode", () => {
    const previous = process.env.FIXTURES;
    delete process.env.FIXTURES;
    expect(shouldUseFixtures(undefined)).toBe(true); // key missing → fixtures
    expect(shouldUseFixtures("sk-live-key")).toBe(false); // key present → live
    if (previous === undefined) delete process.env.FIXTURES;
    else process.env.FIXTURES = previous;
  });
});

describe("ExposedOrNot parsing (recorded person_1 data)", () => {
  const fixture = pickExposedOrNotFixture(EMAIL);

  it("flattens the recorded breach names", () => {
    const parsed = parseCheckEmail(fixture.checkEmail);
    expect(parsed.found).toBe(true);
    expect(parsed.names).toEqual(["CodeDump-2024", "TechDB-2023"]);
  });

  it("parses synthesized breach-analytics metrics", () => {
    const metrics = parseBreachMetrics(fixture.breachAnalytics ?? null);
    expect(metrics.aggregateCredentialExposure).toBe(true); // CodeDump-2024 has passwords
    expect(metrics.riskLabel).toBe("High");
    expect(metrics.details.get("codedump-2024")?.dataClasses).toContain("Passwords");
  });

  it("keeps non-credential breaches precise when details exist", () => {
    const metrics = parseBreachMetrics(fixture.breachAnalytics ?? null);
    expect(metrics.details.get("techdb-2023")?.dataClasses).toEqual(["Email addresses"]);
  });

  it("treats an API error response as a genuine clean result", () => {
    const parsed = parseCheckEmail({ Error: "Not found", email: null });
    expect(parsed.found).toBe(false);
    expect(parsed.names).toEqual([]);
  });
});

describe("exposedOrNotConnector (fixture mode)", () => {
  it("returns one breach record result per recorded breach with document tier", async () => {
    const results = await exposedOrNotConnector.search(EMAIL);
    expect(results.length).toBe(2);
    for (const r of results) {
      expect(r.source).toBe("exposedornot");
      expect(r.contentType).toBe("breach_record");
      expect(r.evidenceTier).toBe("document");
      // Raw email must never appear in stored fields (§11.4).
      expect(JSON.stringify(r)).not.toContain(EMAIL);
    }
  });

  it("tags credential-bearing dumps with CREDENTIAL_EXPOSURE", async () => {
    const results = await exposedOrNotConnector.search(EMAIL);
    const dump = results.find((r) => r.sourceId === "CodeDump-2024");
    expect(dump).toBeDefined();
    expect((dump?.rawMetadata?.signals as string[] | undefined) ?? []).toContain(
      CREDENTIAL_EXPOSURE_SIGNAL,
    );
    expect(dump?.rawMetadata?.credentialExposure).toBe(true);
    // The email-only breach must NOT inherit the credential signal.
    const emailOnly = results.find((r) => r.sourceId === "TechDB-2023");
    expect(emailOnly?.rawMetadata?.credentialExposure).toBe(false);
  });

  it("maps an unknown email to an OK empty result, never a failure", async () => {
    expect(await exposedOrNotConnector.search("clean@example.com")).toEqual([]);
  });

  it("rejects non-email queries with a bad_request ConnectorError", async () => {
    try {
      await exposedOrNotConnector.search("not-an-email");
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(ConnectorError);
      expect((err as ConnectorError).code).toBe("bad_request");
    }
  });
});

describe("buildBreachResults (pure mapper)", () => {
  it("applies the aggregate password signal when per-breach details are absent", () => {
    const results = buildBreachResults(["BreachA", "BreachB"], {
      details: new Map(),
      aggregateCredentialExposure: true,
      riskLabel: "High",
    });
    expect(results).toHaveLength(2);
    expect(results.every((r) => r.rawMetadata?.credentialExposure === true)).toBe(true);
    expect(
      results.every((r) =>
        (r.rawMetadata?.signals as string[]).includes(CREDENTIAL_EXPOSURE_SIGNAL),
      ),
    ).toBe(true);
  });

  it("caps results at MAX_BREACH_RESULTS while preserving the true total", () => {
    const results = buildBreachResults(breachNames(), null);
    expect(results).toHaveLength(25);
    expect(results[0]?.rawMetadata?.totalBreaches).toBe(40);
  });
});

function breachNames(): string[] {
  return Array.from({ length: 40 }, (_, i) => `Breach-${i}`);
}
