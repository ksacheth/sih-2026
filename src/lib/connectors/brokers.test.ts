import { describe, expect, it } from "bun:test";
import {
  brokerCatalog,
  brokerOptOutUrl,
  findBrokerMatch,
  findBrokerResults,
} from "./brokers";
import { cacheKey, CACHE_TTL_HOURS } from "./cache";
import type { DiscoveryResult } from "./types";
import { extractDomain } from "./url";

function makeResult(overrides: Partial<DiscoveryResult> = {}): DiscoveryResult {
  return {
    source: "serper",
    sourceId: "https://example.org/listing",
    url: "https://example.org/listing",
    domain: "example.org",
    title: "Listing",
    snippet: "snippet text",
    discoveredAt: "2026-01-01T00:00:00.000Z",
    contentType: "text/html",
    evidenceTier: "snippet",
    rawMetadata: {},
    ...overrides,
  };
}

describe("broker catalog", () => {
  it("contains 30-50 curated entries with the fixed input shape", () => {
    // Union of the curated catalog (origin/main, 36) + connector-seeded extras.
    expect(brokerCatalog.length).toBeGreaterThanOrEqual(30);
    expect(brokerCatalog.length).toBeLessThanOrEqual(100);
    for (const entry of brokerCatalog) {
      expect(entry.name.length).toBeGreaterThan(0);
      expect(entry.domain).toContain(".");
      expect(entry.optOutUrl ?? "").toMatch(/^https?:\/\//);
    }
  });
});

describe("findBrokerMatch", () => {
  it("matches known broker domains, stripping www.", () => {
    expect(findBrokerMatch("truecaller.com")?.name).toBe("Truecaller");
    expect(findBrokerMatch("www.radaris.com")?.name).toBe("Radaris");
    expect(
      findBrokerMatch("https://www.fastpeoplesearch.com/name/rahul-kumar")?.name,
    ).toBe("FastPeopleSearch");
  });

  it("matches extra CDN domains listed under a broker entry", () => {
    expect(findBrokerMatch("listing.jdmagicbox.com")?.name).toBe("Justdial");
  });

  it("does not match non-broker domains", () => {
    expect(findBrokerMatch("github.com")).toBeNull();
    expect(findBrokerMatch("")).toBeNull();
  });

  it("returns the curated opt-out URL for a match", () => {
    expect(brokerOptOutUrl("truecaller.com")).toContain("truecaller.com/unlisting");
    expect(brokerOptOutUrl("example-portfolio.dev")).toBeNull();
  });
});

describe("findBrokerResults", () => {
  it("derives one broker finding per matched broker with opt-out metadata", () => {
    const radarisHit = makeResult({ domain: "radaris.com", url: "https://radaris.com/p/x" });
    const githubHit = makeResult({ domain: "github.com", url: "https://github.com/rkumar_dev" });
    const derived = findBrokerResults([radarisHit, githubHit]);
    expect(derived).toHaveLength(1);
    expect(derived[0]?.source).toBe("brokers");
    expect(derived[0]?.domain).toBe("radaris.com");
    expect(derived[0]?.rawMetadata?.broker).toMatchObject({
      name: "Radaris",
      optOutUrl: expect.stringContaining("radaris.com"),
    });
    expect(derived[0]?.rawMetadata?.derivedFromSource).toBe("serper");
  });

  it("prefers document-tier evidence and dedupes per broker", () => {
    const snippetHit = makeResult({ domain: "radaris.com", evidenceTier: "snippet" });
    const documentHit = makeResult({
      sourceId: "doc",
      domain: "radaris.com",
      evidenceTier: "document",
    });
    const derived = findBrokerResults([snippetHit, snippetHit, documentHit]);
    expect(derived).toHaveLength(1);
    expect(derived[0]?.evidenceTier).toBe("document");
    expect(derived[0]?.rawMetadata?.derivedFrom).toBe("doc");
  });

  it("returns [] when nothing matches a broker", () => {
    expect(findBrokerResults([makeResult({ domain: "github.com" })])).toEqual([]);
  });

  it("skips results without a domain", () => {
    expect(findBrokerResults([makeResult({ domain: "" })])).toEqual([]);
  });
});

describe("cacheKey (HMAC of source + query)", () => {
  it("is deterministic for the same source and query", () => {
    expect(cacheKey("serper", '"user@example.com"')).toBe(
      cacheKey("serper", '"user@example.com"'),
    );
  });

  it("differs per source and per query", () => {
    const base = cacheKey("serper", '"user@example.com"');
    expect(cacheKey("exposedornot", '"user@example.com"')).not.toBe(base);
    expect(cacheKey("serper", '"other@example.com"')).not.toBe(base);
  });

  it("never embeds the plaintext query (§11.2)", () => {
    expect(cacheKey("serper", "test-rahul@example.com")).not.toContain("test-rahul");
  });

  it("uses the 6-hour TTL window", () => {
    expect(CACHE_TTL_HOURS).toBe(6);
  });
});

describe("extractDomain", () => {
  it("lowercases and strips a leading www.", () => {
    expect(extractDomain("https://WWW.Example.com/path?x=1")).toBe("example.com");
  });

  it("returns '' for invalid URLs", () => {
    expect(extractDomain("not a url")).toBe("");
  });
});
