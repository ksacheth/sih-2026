/**
 * Content Normalization and Evidence Tier Management (architecture.md §7).
 *
 * - Converts HydratedDocument (from Firecrawl) to NormalizedDocument.
 * - Removes base64 images and binary noise while preserving exact text offsets for extraction.
 * - Computes SHA-256 content hashes.
 * - Provides snippet-tier fallback construction when Firecrawl hydration fails, times out,
 *   or is blocked by the safety gate.
 */

import { createHash } from "crypto";
import type { DiscoveryResult, HydratedDocument } from "../connectors/types";
import { canonicalizeUrl } from "../discovery/canonicalUrl";
import { extractDomain } from "../connectors/url";

export interface NormalizedDocument {
  documentId: string;
  sourceUrl: string;
  canonicalUrl: string;
  domain: string;
  contentType: string;
  title: string;
  text: string; // Markdown or snippet text passed to local extraction
  contentHash: string;
  retrievedAt: string;
  evidenceTier: "document" | "snippet";
  providerErrorCode?: string;
  providerRequestId?: string;
}

export function sha256(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

/**
 * Strips base64 image data URIs from markdown if present.
 */
export function cleanMarkdownText(rawMarkdown: string): string {
  if (!rawMarkdown) return "";
  // Strip data:image/... URIs from markdown images or links
  return rawMarkdown.replace(/data:image\/[^)]+/g, "");
}


/**
 * Normalizes a successfully hydrated Firecrawl document into a NormalizedDocument (document tier).
 */
export function normalizeHydratedDocument(doc: HydratedDocument): NormalizedDocument {
  const cleanedText = cleanMarkdownText(doc.markdown);
  const contentHash = sha256(cleanedText);
  const canonical = doc.canonicalUrl || canonicalizeUrl(doc.url) || doc.url;
  const documentId = sha256(`${canonical}:${contentHash}`);

  return {
    documentId,
    sourceUrl: doc.url,
    canonicalUrl: canonical,
    domain: doc.domain || extractDomain(doc.url),
    contentType: doc.contentType || "text/html",
    title: doc.title || doc.url,
    text: cleanedText,
    contentHash,
    retrievedAt: doc.retrievedAt || new Date().toISOString(),
    evidenceTier: "document",
    providerRequestId: doc.providerRequestId,
  };
}

/**
 * Constructs a snippet-tier NormalizedDocument from a Serper DiscoveryResult (snippet fallback).
 * architecture.md §7.2: title + "\n" + snippet
 */
export function createSnippetFallbackDocument(
  result: DiscoveryResult,
  errorCode?: string,
): NormalizedDocument {
  const title = result.title?.trim() || "";
  const snippet = result.snippet?.trim() || "";
  const text = title && snippet ? `${title}\n${snippet}` : title || snippet || result.url;
  const canonical = canonicalizeUrl(result.url) || result.url;
  const contentHash = sha256(text);
  const documentId = sha256(`${canonical}:snippet:${contentHash}`);

  return {
    documentId,
    sourceUrl: result.url,
    canonicalUrl: canonical,
    domain: result.domain || extractDomain(result.url),
    contentType: result.contentType || "text/html",
    title: result.title || result.url,
    text,
    contentHash,
    retrievedAt: result.discoveredAt || new Date().toISOString(),
    evidenceTier: "snippet",
    providerErrorCode: errorCode,
  };
}
