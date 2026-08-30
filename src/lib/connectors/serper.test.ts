import { describe, expect, it } from "vitest";
import { findBrokerResults } from "./brokers";
import { runConnector } from "./index";
import { buildTargetedQueries, sanitizeQueryValue, serperConnector } from "./serper";
import type { DiscoveryConnector } from "./types";

// Connector tests always run in fixture mode — never against live APIs (§14.4).
process.env.FIXTURES = "1";

// Canonical monitored identity: person_1 in data/eval/ground_truth.json.
const EMAIL = "rahul.kumar@abc-tech.in";

describe("sanitizeQueryValue", () => {
  it("strips search operators (site:, OR-combining quotes, exclusions)", () => {
    expect(sanitizeQueryValue('user@example.com" OR site:evil.com')).toBe(
      "user@example.com OR site evil.com",
    );
    expect(sanitizeQueryValue("-term")).toBe("term");
    expect(sanitizeQueryValue("inurl:admin")).toBe("inurl admin");
  });

  it("keeps characters legitimate identifiers contain", () => {
    expect(sanitizeQueryValue("test-rahul@example.com")).toBe("test-rahul@example.com");
    expect(sanitizeQueryValue("rahul_kumar_dev")).toBe("rahul_kumar_dev");
    expect(sanitizeQueryValue("+91 98765 43210")).toBe("+91 98765 43210");
  });

  it("collapses whitespace introduced by sanitization", () => {
    expect(sanitizeQueryValue("  Rahul\n\tKumar  ")).toBe("Rahul Kumar");
  });
});

describe("buildTargetedQueries", () => {
  // person_1 from data/eval/ground_truth.json
  const full = {
    email: "rahul.kumar@abc-tech.in",
    username: "rahul_kumar_dev",
    name: "Rahul Kumar",
    org: "ABC Technologies",
  };

  it("produces the five planned queries in §3.2 order", () => {
    const queries = buildTargetedQueries(full);
    expect(queries).toEqual([
      '"rahul.kumar@abc-tech.in"',
      '"rahul_kumar_dev"',
      '"Rahul Kumar" "rahul.kumar@abc-tech.in"',
      '"rahul.kumar@abc-tech.in" filetype:pdf',
      '"Rahul Kumar" "ABC Technologies"',
    ]);
  });

  it("never exceeds six queries per scan", () => {
    expect(buildTargetedQueries(full).length).toBeLessThanOrEqual(6);
  });

  it("sanitizes hostile identifier values before quoting", () => {
    const queries = buildTargetedQueries({
      email: '"victim@x.com" OR site:evil.com',
      name: "Row -Hammer",
    });
    // Name sanitizes to "Row Hammer"; every value is re-quoted by the planner
    // and no query contains user-controlled quoting or operators of its own.
    expect(queries).toEqual([
      '"victim@x.com OR site evil.com"',
      '"Row Hammer" "victim@x.com OR site evil.com"',
      '"victim@x.com OR site evil.com" filetype:pdf',
    ]);
    for (const q of queries) {
      expect(q).not.toContain('"victim@x.com"'); // no user-controlled quoting
      expect(q).not.toContain("site:");
    }
  });

  it("returns [] when no usable identifiers are present", () => {
    expect(buildTargetedQueries({})).toEqual([]);
    expect(buildTargetedQueries({ org: "Solo Org", phone: "+919876543210" })).toEqual([]);
  });

  it("deduplicates identical queries", () => {
    const queries = buildTargetedQueries({ email: "sam@x.com", username: "sam@x.com" });
    expect(queries).toEqual(['"sam@x.com"', '"sam@x.com" filetype:pdf']);
  });
});

describe("serperConnector (fixture mode)", () => {
  it("replays the recorded exact-email search as DiscoveryResults", async () => {
    const results = await serperConnector.search(`"${EMAIL}"`);
    expect(results.length).toBeGreaterThan(0);
    for (const r of results) {
      expect(r.source).toBe("serper");
      expect(r.evidenceTier).toBe("snippet");
      expect(r.domain).not.toContain("www.");
      // No raw query persisted into metadata (§11.4 logging rule); snippets
      // may legitimately contain the identifier — that is the evidence.
      expect(JSON.stringify(r.rawMetadata ?? {})).not.toContain(EMAIL);
    }
  });

  it("maps PDF links to the application/pdf content type", async () => {
    const results = await serperConnector.search(`"${EMAIL}" filetype:pdf`);
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((r) => r.contentType === "application/pdf")).toBe(true);
  });

  it("serves recorded provenance (source id, confidence) in rawMetadata", async () => {
    const results = await serperConnector.search(`"${EMAIL}"`);
    expect(results[0]?.rawMetadata?.fixtureSourceId).toEqual(expect.stringMatching(/^serper-/));
    expect(typeof results[0]?.rawMetadata?.fixtureConfidence).toBe("number");
  });

  it("serves an empty result for a query matching no recorded search", async () => {
    expect(await serperConnector.search('"clean@example.com"')).toEqual([]);
  });

  it("returns [] (not a throw) for a query that trims to nothing", async () => {
    expect(await serperConnector.search('""')).toEqual([]);
  });
});

describe("broker derivation from fixture results", () => {
  it("derives broker findings (Radaris + catalogued LinkedIn) with opt-out URL", async () => {
    const results = await serperConnector.search('"Rahul Kumar" "ABC Technologies"');
    const brokerFindings = findBrokerResults(results);
    expect(brokerFindings.length).toBeGreaterThanOrEqual(1);
    const radaris = brokerFindings.find((f) => f.domain === "radaris.com");
    expect(radaris).toBeDefined();
    expect(radaris?.source).toBe("brokers");
    expect((radaris?.rawMetadata?.broker as Record<string, unknown>).optOutUrl)
      .toEqual(expect.stringContaining("radaris.com"));
  });
});

describe("runConnector budget wrapper", () => {
  const failing: DiscoveryConnector = {
    source: "serper",
    search: async () => {
      throw new Error("ECONNREFUSED");
    },
  };

  it("wraps a failing connector as unavailable without throwing", async () => {
    const outcome = await runConnector(failing, "q");
    expect(outcome.status).toBe("unavailable");
    expect(outcome.results).toEqual([]);
    expect(outcome.reason).toContain("ECONNREFUSED");
  });

  it("enforces the per-connector time budget", async () => {
    const slow: DiscoveryConnector = {
      source: "exposedornot",
      search: () => new Promise(() => {}),
    };
    const result = await runConnector(slow, "q", { timeoutMs: 50 });
    expect(result.status).toBe("unavailable");
    expect(result.reason).toContain("timeout");
  });
});
