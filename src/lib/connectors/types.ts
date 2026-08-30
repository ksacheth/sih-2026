/**
 * Discovery connector contracts — the fixed hand-off boundary to the
 * extraction pipeline (ML-1) and the scan orchestrator (Dev-2 task 3).
 *
 * Field naming follows TASKS.md §4.1 (camelCase), which is the authoritative
 * TypeScript contract. CONTEXT.md §5.1 is the same shape in snake_case.
 */

export type DiscoverySource = "serper" | "exposedornot" | "brokers" | "firecrawl";

export type EvidenceTier = "document" | "snippet";

export type ContentType = "text/html" | "application/pdf" | "breach_record" | "text/plain";

/**
 * Common provider status per architecture.md §4.1
 */
export type ProviderStatus =
  | "completed"
  | "partial"
  | "rate_limited"
  | "unavailable"
  | "invalid_response";

export interface ProviderError {
  code: string; // safe code, never raw response body
  retryable: boolean;
  statusCode?: number;
}

export interface HydrateRequest {
  url: string;
  canonicalUrl: string;
}

export interface HydratedDocument {
  source: "firecrawl";
  sourceId: string; // hash of canonical URL
  url: string;
  canonicalUrl: string;
  domain: string;
  title?: string;
  markdown: string;
  contentType?: "text/html" | "application/pdf" | "text/plain";
  retrievedAt: string;
  evidenceTier: "document";
  contentHash: string;
  providerRequestId?: string;
}

export interface HydrateResponse {
  status: ProviderStatus;
  document?: HydratedDocument;
  error?: ProviderError;
}

export interface DiscoveryResult {
  source: DiscoverySource;
  /** Stable id within the source (URL, breach name, broker domain…). */
  sourceId: string;
  url: string;
  domain: string;
  title: string;
  snippet: string;
  /** ISO 8601 timestamp of when this result was discovered. */
  discoveredAt: string;
  contentType?: ContentType;
  /**
   * Always "snippet" at discovery time; the fetch guard or Firecrawl
   * upgrades to "document" after a successful fetch/scrape + parse.
   * Breach records are structured API data and are "document" tier by origin.
   */
  evidenceTier: EvidenceTier;
  rawMetadata?: Record<string, unknown>;
}

export interface DiscoveryConnector {
  readonly source: DiscoverySource;
  /**
   * Execute a single discovery query. Implementations may throw; callers in
   * the pipeline must use runConnector() which converts failures into
   * "unavailable" outcomes (a source outage contributes to PARTIAL, it never
   * crashes the scan or fabricates a clean result).
   */
  search(query: string): Promise<DiscoveryResult[]>;
}

export interface ConnectorRunResult {
  source: DiscoverySource;
  status: "ok" | "unavailable";
  /** Machine-readable failure reason when status === "unavailable". */
  reason?: string;
  results: DiscoveryResult[];
  /** True when the result set came from the TTL cache, not a live call. */
  fromCache?: boolean;
  /** True when the connector served recorded fixtures instead of live data. */
  fixtureMode?: boolean;
}

/**
 * Identifier set handed to the query planner by the orchestrator.
 * Only VERIFIED (or ATTESTED for phone) identifiers ever reach this point.
 * Note: phone is deliberately excluded from web search query plans
 * (CONTEXT.md §3.2) — low signal, high privacy cost.
 */
export interface SearchIdentifierSet {
  email?: string;
  phone?: string;
  username?: string;
  name?: string;
  org?: string;
}

/** Signal tag set by the breach connector when a dump includes passwords. */
export const CREDENTIAL_EXPOSURE_SIGNAL = "CREDENTIAL_EXPOSURE";

/** Failure codes a connector can surface to the pipeline. */
export type ConnectorFailureCode =
  | "unreachable"
  | "bad_response"
  | "timeout"
  | "bad_request"
  | "rate_limited"
  | "invalid_response";

export class ConnectorError extends Error {
  constructor(
    public readonly code: ConnectorFailureCode,
    message: string,
  ) {
    super(message);
    this.name = "ConnectorError";
  }
}

