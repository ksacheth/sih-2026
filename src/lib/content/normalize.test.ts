import { describe, expect, it } from "vitest";
import {
  normalizeHydratedDocument,
  createSnippetFallbackDocument,
  cleanMarkdownText,
  sha256,
} from "./normalize";
import type { DiscoveryResult, HydratedDocument } from "../connectors/types";

describe("Content Normalization", () => {
  it("cleans base64 image strings from markdown", () => {
    const raw =
      "# Profile\n![img](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAUA...)\nSome text";
    const cleaned = cleanMarkdownText(raw);
    expect(cleaned).toBe("# Profile\n![img]()\nSome text");
  });

  it("normalizes a HydratedDocument into a document-tier NormalizedDocument", () => {
    const hydrated: HydratedDocument = {
      source: "firecrawl",
      sourceId: "source-1",
      url: "https://example.com/profile",
      canonicalUrl: "https://example.com/profile",
      domain: "example.com",
      title: "Rahul Profile",
      markdown: "# Rahul Kumar\nEmail: rahul@example.com",
      contentType: "text/html",
      retrievedAt: new Date().toISOString(),
      evidenceTier: "document",
      contentHash: "hash-123",
      providerRequestId: "fc-123",
    };

    const doc = normalizeHydratedDocument(hydrated);
    expect(doc.evidenceTier).toBe("document");
    expect(doc.text).toBe("# Rahul Kumar\nEmail: rahul@example.com");
    expect(doc.contentHash).toBe(sha256(doc.text));
    expect(doc.domain).toBe("example.com");
    expect(doc.providerRequestId).toBe("fc-123");
  });

  it("creates a snippet-tier NormalizedDocument on snippet fallback", () => {
    const discovery: DiscoveryResult = {
      source: "serper",
      sourceId: "serper-1",
      url: "https://example.com/blocked",
      domain: "example.com",
      title: "Blocked Page Title",
      snippet: "This is a search snippet containing rahul@example.com",
      discoveredAt: new Date().toISOString(),
      evidenceTier: "snippet",
      contentType: "text/html",
    };

    const doc = createSnippetFallbackDocument(discovery, "FIRECRAWL_TIMEOUT");
    expect(doc.evidenceTier).toBe("snippet");
    expect(doc.text).toBe("Blocked Page Title\nThis is a search snippet containing rahul@example.com");
    expect(doc.providerErrorCode).toBe("FIRECRAWL_TIMEOUT");
    expect(doc.contentHash).toBe(sha256(doc.text));
  });
});
