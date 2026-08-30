import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { runDiscoverAndExtract } from "./discoverAndExtract";
import type { SearchIdentifierSet } from "../connectors/types";
import type { MonitoredIdentity } from "../correlation";

describe("DiscoverAndExtract Pipeline Integration", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  it("runs end-to-end on fixture data with document-tier and snippet-tier evidence", async () => {
    process.env.FIXTURES = "1";

    const searchIds: SearchIdentifierSet = {
      email: "rahul.kumar@abc-tech.in",
      username: "rahul_kumar_dev",
      name: "Rahul Kumar",
      org: "ABC Technologies",
    };

    const monitoredIdentity: MonitoredIdentity = {
      id: "identity-1",
      userId: "user-1",
      email: "rahul.kumar@abc-tech.in",
      name: "Rahul Kumar",
      username: "rahul_kumar_dev",
      organization: "ABC Technologies",
    };

    const output = await runDiscoverAndExtract(searchIds, {
      monitoredIdentity,
      skipSidecar: true, // test regex/checksum extraction deterministically
    });

    expect(output.status).toBe("completed");
    expect(output.discoveryResults.length).toBeGreaterThan(0);
    expect(output.documents.length).toBeGreaterThan(0);
    expect(output.metrics.successfullyHydrated).toBeGreaterThan(0);

    // Verify document-tier document exists
    const docTier = output.documents.find((d) => d.evidenceTier === "document");
    expect(docTier).toBeDefined();
    expect(docTier?.text).toContain("Rahul Kumar");

    // Verify extraction and correlation outcomes
    const outcomesWithEntities = output.extractedOutcomes.filter(
      (o) => o.extraction.entities.length > 0,
    );
    expect(outcomesWithEntities.length).toBeGreaterThan(0);

    for (const outcome of output.extractedOutcomes) {
      // Invariant check on each entity
      for (const entity of outcome.extraction.entities) {
        const slice = outcome.document.text.slice(entity.offsetStart, entity.offsetEnd);
        expect(slice).toBe(entity.rawValue);
      }
    }
  });

  it("creates snippet-tier fallback and marks partial when Firecrawl fails", async () => {
    process.env.FIXTURES = "0";
    process.env.SERPER_API_KEY = "test-serper";
    process.env.FIRECRAWL_API_KEY = "test-firecrawl";

    // Mock Serper returning 1 result
    const serperMock = {
      organic: [
        {
          title: "Public Page",
          link: "https://example.com/failed-scrape",
          snippet: "Contact: test@example.com",
          position: 1,
        },
      ],
    };

    vi.spyOn(global, "fetch").mockImplementation(async (url) => {
      const urlStr = String(url);
      if (urlStr.includes("serper.dev")) {
        return new Response(JSON.stringify(serperMock), { status: 200 });
      }
      if (urlStr.includes("firecrawl.dev")) {
        // Force 403 error on Firecrawl (immediate non-retryable failure)
        return new Response("Forbidden", { status: 403 });
      }
      return new Response("Not found", { status: 404 });
    });

    const searchIds: SearchIdentifierSet = {
      email: "test@example.com",
    };

    const output = await runDiscoverAndExtract(searchIds, { skipSidecar: true });

    // Should degrade to PARTIAL
    expect(output.status).toBe("partial");
    expect(output.stageStatus.firecrawl).toBe("unavailable");

    // The document should be snippet-tier fallback
    expect(output.documents.length).toBe(1);
    expect(output.documents[0].evidenceTier).toBe("snippet");
    expect(output.documents[0].text).toContain("Public Page\nContact: test@example.com");
    expect(output.documents[0].providerErrorCode).toBe("FIRECRAWL_403");

    // Extracted entity from snippet
    expect(output.extractedOutcomes[0].extraction.entities.length).toBe(1);
    expect(output.extractedOutcomes[0].extraction.entities[0].type).toBe("EMAIL");
    expect(output.extractedOutcomes[0].extraction.entities[0].rawValue).toBe("test@example.com");

  });

  it("handles empty queries gracefully", async () => {
    const output = await runDiscoverAndExtract({}, { skipSidecar: true });
    expect(output.status).toBe("completed");
    expect(output.discoveryResults).toEqual([]);
    expect(output.documents).toEqual([]);
  });
});
