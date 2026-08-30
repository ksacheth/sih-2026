import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  buildHydratedDocument,
  scrapeUrlWithFirecrawl,
  hydrateUrlsWithFirecrawl,
  sha256Hex,
} from "./firecrawl";
import type { HydrateRequest } from "./types";

describe("Firecrawl v2 Scrape Connector", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  describe("buildHydratedDocument", () => {
    it("creates a valid HydratedDocument with hashes and metadata", () => {
      const req: HydrateRequest = {
        url: "https://example.com/profile",
        canonicalUrl: "https://example.com/profile",
      };
      const markdown = "# Test Profile\n\nName: Rahul Kumar\nEmail: rahul@example.com";
      const doc = buildHydratedDocument(req, markdown, {
        title: "Test Profile",
        contentType: "text/html",
        providerRequestId: "req-123",
      });

      expect(doc.source).toBe("firecrawl");
      expect(doc.sourceId).toBe(sha256Hex(req.canonicalUrl));
      expect(doc.url).toBe("https://example.com/profile");
      expect(doc.canonicalUrl).toBe("https://example.com/profile");
      expect(doc.domain).toBe("example.com");
      expect(doc.title).toBe("Test Profile");
      expect(doc.markdown).toBe(markdown);
      expect(doc.contentType).toBe("text/html");
      expect(doc.evidenceTier).toBe("document");
      expect(doc.contentHash).toBe(sha256Hex(markdown));
      expect(doc.providerRequestId).toBe("req-123");
      expect(doc.retrievedAt).toBeDefined();
    });

    it("auto-detects PDF content type for pdf URLs", () => {
      const req: HydrateRequest = {
        url: "https://example.com/docs/resume.pdf",
        canonicalUrl: "https://example.com/docs/resume.pdf",
      };
      const doc = buildHydratedDocument(req, "# Resume");
      expect(doc.contentType).toBe("application/pdf");
    });
  });

  describe("scrapeUrlWithFirecrawl in fixture mode", () => {
    it("resolves recorded documents when in fixture mode", async () => {
      process.env.FIXTURES = "1";
      const req: HydrateRequest = {
        url: "https://abc-tech.in/team/rahul-kumar",
        canonicalUrl: "https://abc-tech.in/team/rahul-kumar",
      };

      const res = await scrapeUrlWithFirecrawl(req);
      expect(res.status).toBe("completed");
      expect(res.document).toBeDefined();
      expect(res.document?.markdown).toContain("Rahul Kumar");
      expect(res.document?.markdown).toContain("rahul.kumar@abc-tech.in");
      expect(res.document?.evidenceTier).toBe("document");
    });

    it("returns unavailable for URLs not in the fixture dataset", async () => {
      process.env.FIXTURES = "1";
      const req: HydrateRequest = {
        url: "https://unknown-domain-not-in-fixtures.org/secret",
        canonicalUrl: "https://unknown-domain-not-in-fixtures.org/secret",
      };

      const res = await scrapeUrlWithFirecrawl(req);
      expect(res.status).toBe("unavailable");
      expect(res.error?.code).toBe("FIRECRAWL_NOT_IN_FIXTURES");
      expect(res.document).toBeUndefined();
    });
  });

  describe("scrapeUrlWithFirecrawl live API mock behavior", () => {
    it("successfully scrapes markdown and parses document", async () => {
      process.env.FIXTURES = "0";
      process.env.FIRECRAWL_API_KEY = "test-api-key";

      const mockResponse = {
        success: true,
        data: {
          title: "Public Page",
          markdown: "# Public Page\nContent goes here",
          metadata: {
            statusCode: 200,
          },
        },
        id: "fc-req-999",
      };

      const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValueOnce(
        new Response(JSON.stringify(mockResponse), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );

      const req: HydrateRequest = {
        url: "https://example.com/page",
        canonicalUrl: "https://example.com/page",
      };

      const res = await scrapeUrlWithFirecrawl(req);
      expect(res.status).toBe("completed");
      expect(res.document?.title).toBe("Public Page");
      expect(res.document?.markdown).toBe("# Public Page\nContent goes here");
      expect(res.document?.providerRequestId).toBe("fc-req-999");

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const callArgs = fetchSpy.mock.calls[0];
      expect(callArgs[0]).toBe("https://api.firecrawl.dev/v2/scrape");
      const requestBody = JSON.parse(callArgs[1]?.body as string);
      expect(requestBody.url).toBe("https://example.com/page");
      expect(requestBody.formats).toEqual(["markdown"]);
      expect(requestBody.onlyMainContent).toBe(true);
      expect(requestBody.removeBase64Images).toBe(true);
      expect(requestBody.storeInCache).toBe(false);
    });

    it("includes pdf parser when URL is a PDF", async () => {
      process.env.FIXTURES = "0";
      process.env.FIRECRAWL_API_KEY = "test-api-key";

      const mockResponse = {
        success: true,
        data: {
          title: "Document PDF",
          markdown: "# PDF Contents",
        },
      };

      const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValueOnce(
        new Response(JSON.stringify(mockResponse), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );

      const req: HydrateRequest = {
        url: "https://example.com/paper.pdf",
        canonicalUrl: "https://example.com/paper.pdf",
      };

      const res = await scrapeUrlWithFirecrawl(req);
      expect(res.status).toBe("completed");
      expect(res.document?.contentType).toBe("application/pdf");

      const requestBody = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string);
      expect(requestBody.parsers).toEqual(["pdf"]);
    });

    it("does not retry on 401 Unauthorized or 403 Forbidden", async () => {
      process.env.FIXTURES = "0";
      process.env.FIRECRAWL_API_KEY = "test-api-key";

      const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValueOnce(
        new Response("Unauthorized", { status: 401 }),
      );

      const req: HydrateRequest = {
        url: "https://example.com/page",
        canonicalUrl: "https://example.com/page",
      };

      const res = await scrapeUrlWithFirecrawl(req);
      expect(res.status).toBe("unavailable");
      expect(res.error?.code).toBe("FIRECRAWL_401");
      expect(res.error?.retryable).toBe(false);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it("does not retry on 400 Bad Request", async () => {
      process.env.FIXTURES = "0";
      process.env.FIRECRAWL_API_KEY = "test-api-key";

      const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValueOnce(
        new Response("Bad request payload", { status: 400 }),
      );

      const req: HydrateRequest = {
        url: "https://example.com/page",
        canonicalUrl: "https://example.com/page",
      };

      const res = await scrapeUrlWithFirecrawl(req);
      expect(res.status).toBe("invalid_response");
      expect(res.error?.code).toBe("FIRECRAWL_400");
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it("retries once on 429 Rate Limited and respects Retry-After", async () => {
      process.env.FIXTURES = "0";
      process.env.FIRECRAWL_API_KEY = "test-api-key";

      const mockSuccess = {
        success: true,
        data: { markdown: "# Recovered from rate limit" },
      };

      const fetchSpy = vi
        .spyOn(global, "fetch")
        .mockResolvedValueOnce(
          new Response("Rate limited", {
            status: 429,
            headers: { "Retry-After": "0" },
          }),
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify(mockSuccess), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        );

      const req: HydrateRequest = {
        url: "https://example.com/page",
        canonicalUrl: "https://example.com/page",
      };

      const res = await scrapeUrlWithFirecrawl(req);
      expect(res.status).toBe("completed");
      expect(res.document?.markdown).toBe("# Recovered from rate limit");
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });

    it("returns rate_limited status if retry on 429 also fails", async () => {
      process.env.FIXTURES = "0";
      process.env.FIRECRAWL_API_KEY = "test-api-key";

      const fetchSpy = vi
        .spyOn(global, "fetch")
        .mockResolvedValueOnce(
          new Response("Rate limited", {
            status: 429,
            headers: { "Retry-After": "0" },
          }),
        )
        .mockResolvedValueOnce(
          new Response("Still rate limited", {
            status: 429,
          }),
        );

      const req: HydrateRequest = {
        url: "https://example.com/page",
        canonicalUrl: "https://example.com/page",
      };

      const res = await scrapeUrlWithFirecrawl(req);
      expect(res.status).toBe("rate_limited");
      expect(res.error?.code).toBe("FIRECRAWL_429");
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });

    it("retries once on 500 server error", async () => {
      process.env.FIXTURES = "0";
      process.env.FIRECRAWL_API_KEY = "test-api-key";

      const fetchSpy = vi
        .spyOn(global, "fetch")
        .mockResolvedValueOnce(new Response("Server Error", { status: 500 }))
        .mockResolvedValueOnce(new Response("Server Error", { status: 500 }));

      const req: HydrateRequest = {
        url: "https://example.com/page",
        canonicalUrl: "https://example.com/page",
      };

      const res = await scrapeUrlWithFirecrawl(req);
      expect(res.status).toBe("unavailable");
      expect(res.error?.code).toBe("FIRECRAWL_500");
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });

    it("returns partial if response has empty markdown", async () => {
      process.env.FIXTURES = "0";
      process.env.FIRECRAWL_API_KEY = "test-api-key";

      vi.spyOn(global, "fetch").mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            success: true,
            data: { markdown: "   " },
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        ),
      );

      const req: HydrateRequest = {
        url: "https://example.com/page",
        canonicalUrl: "https://example.com/page",
      };

      const res = await scrapeUrlWithFirecrawl(req);
      expect(res.status).toBe("partial");
      expect(res.error?.code).toBe("FIRECRAWL_EMPTY_CONTENT");
    });
  });

  describe("hydrateUrlsWithFirecrawl", () => {
    it("hydrates multiple URLs concurrently respecting limits", async () => {
      process.env.FIXTURES = "1";
      const requests: HydrateRequest[] = [
        {
          url: "https://abc-tech.in/team/rahul-kumar",
          canonicalUrl: "https://abc-tech.in/team/rahul-kumar",
        },
        {
          url: "https://rahulkumar.dev",
          canonicalUrl: "https://rahulkumar.dev",
        },
        {
          url: "https://github.com/rahul_kumar_dev",
          canonicalUrl: "https://github.com/rahul_kumar_dev",
        },
      ];

      const results = await hydrateUrlsWithFirecrawl(requests, { concurrencyLimit: 2 });
      expect(results.size).toBe(3);
      for (const req of requests) {
        const item = results.get(req.url);
        expect(item).toBeDefined();
        expect(item?.status).toBe("completed");
        expect(item?.document?.markdown).toBeDefined();
      }
    });
  });
});
