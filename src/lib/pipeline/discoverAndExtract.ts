/**
 * Complete Web Pipeline: Serper -> Firecrawl -> Local Extraction (architecture.md §1, §3, §8).
 *
 * Flow:
 * 1. Verified identifier set -> Serper.dev search (≤6 queries) [Discovery]
 * 2. URL validation, canonicalization & ranking -> Select top ≤10 URLs [Safety Gate]
 * 3. Firecrawl v2 scrape (concurrency 3) -> Hydrated Markdown / PDF [Hydration]
 *    (Snippet fallback on Firecrawl failure/denylist preserves Serper snippet)
 * 4. Local extraction -> Deterministic regex/checksum + local GLiNER [Extraction]
 * 5. Correlation & findings synthesis -> Evidence tiers & partial scan semantics
 */

import {
  runConnector,
  serperConnector,
  hydrateUrlsWithFirecrawl,
  type DiscoveryResult,
  type SearchIdentifierSet,
  type ProviderStatus,
} from "../connectors";
import {
  planTargetedQueries,
  selectUrlsForHydration,
  canonicalizeUrl,
} from "../discovery";
import {
  normalizeHydratedDocument,
  createSnippetFallbackDocument,
  type NormalizedDocument,
} from "../content";
import {
  extractAndFusePII,
  type ExtractionResult,
  type ExtractedEntity,
} from "../extraction";
import {
  correlateExtractedEntities,
  type MonitoredIdentity,
  type CorrelatedExposureOutcome,
} from "../correlation";

export interface DocumentExtractionOutcome {
  document: NormalizedDocument;
  extraction: ExtractionResult;
  correlation?: CorrelatedExposureOutcome;
}

export interface DiscoverAndExtractOutput {
  status: ProviderStatus;
  queriesRun: string[];
  discoveryResults: DiscoveryResult[];
  documents: NormalizedDocument[];
  extractedOutcomes: DocumentExtractionOutcome[];
  stageStatus: {
    serper: ProviderStatus;
    firecrawl: ProviderStatus;
    extraction: ProviderStatus;
  };
  metrics: {
    totalDiscovered: number;
    selectedForHydration: number;
    successfullyHydrated: number;
    snippetFallbacks: number;
    totalExtractedEntities: number;
  };
}

export interface DiscoverAndExtractOptions {
  concurrencyLimit?: number;
  skipSidecar?: boolean;
  monitoredIdentity?: MonitoredIdentity;
}

/**
 * Runs the end-to-end Serper -> Firecrawl -> Local Extraction pipeline.
 */
export async function runDiscoverAndExtract(
  searchIds: SearchIdentifierSet,
  options?: DiscoverAndExtractOptions,
): Promise<DiscoverAndExtractOutput> {
  const queries = planTargetedQueries(searchIds);
  const discoveryResults: DiscoveryResult[] = [];
  const seenCanonical = new Set<string>();

  let serperFailures = 0;
  const queriesRun: string[] = [];

  // --- Stage 1: Serper Discovery ---
  if (queries.length === 0) {
    return {
      status: "completed",
      queriesRun: [],
      discoveryResults: [],
      documents: [],
      extractedOutcomes: [],
      stageStatus: {
        serper: "completed",
        firecrawl: "completed",
        extraction: "completed",
      },
      metrics: {
        totalDiscovered: 0,
        selectedForHydration: 0,
        successfullyHydrated: 0,
        snippetFallbacks: 0,
        totalExtractedEntities: 0,
      },
    };
  }

  for (const q of queries) {
    queriesRun.push(q);
    const run = await runConnector(serperConnector, q);
    if (run.status !== "ok") {
      serperFailures++;
      continue;
    }

    for (const r of run.results) {
      const canon = canonicalizeUrl(r.url) || r.url;
      if (!seenCanonical.has(canon)) {
        seenCanonical.add(canon);
        discoveryResults.push(r);
      }
    }
  }

  const serperStatus: ProviderStatus =
    serperFailures === 0
      ? "completed"
      : serperFailures >= queries.length
        ? "unavailable"
        : "partial";

  // --- Stage 2: URL Selection & Safety Gate ---
  const selection = selectUrlsForHydration(discoveryResults, searchIds);
  const selectedUrls = selection.selectedForHydration;
  const snippetOnlyUrls = selection.snippetOnlyResults;

  // --- Stage 3: Firecrawl Hydration ---
  let firecrawlSuccessCount = 0;
  let firecrawlFallbackCount = 0;
  const normalizedDocs: NormalizedDocument[] = [];

  if (selectedUrls.length > 0) {
    const hydrateRequests = selectedUrls.map((r) => ({
      url: r.url,
      canonicalUrl: canonicalizeUrl(r.url) || r.url,
    }));

    const hydrationMap = await hydrateUrlsWithFirecrawl(hydrateRequests, {
      concurrencyLimit: options?.concurrencyLimit ?? 3,
    });

    for (const r of selectedUrls) {
      const res = hydrationMap.get(r.url);
      if (res && res.status === "completed" && res.document) {
        normalizedDocs.push(normalizeHydratedDocument(res.document));
        firecrawlSuccessCount++;
      } else {
        // Snippet fallback on failed/denied/timed-out Firecrawl scrape
        const errorCode = res?.error?.code || "FIRECRAWL_HYDRATION_FAILED";
        normalizedDocs.push(createSnippetFallbackDocument(r, errorCode));
        firecrawlFallbackCount++;
      }
    }
  }

  // Add non-selected (e.g. >10 budget or safety-filtered) URLs as snippet-tier
  for (const r of snippetOnlyUrls) {
    normalizedDocs.push(createSnippetFallbackDocument(r, "SNIPPET_TIER_UNSELECTED"));
    firecrawlFallbackCount++;
  }

  let firecrawlStatus: ProviderStatus = "completed";
  if (selectedUrls.length > 0) {
    if (firecrawlSuccessCount === selectedUrls.length) {
      firecrawlStatus = "completed";
    } else if (firecrawlSuccessCount > 0) {
      firecrawlStatus = "partial";
    } else {
      firecrawlStatus = "unavailable";
    }
  }

  // --- Stage 4: Local Extraction & Correlation ---
  const extractedOutcomes: DocumentExtractionOutcome[] = [];
  let extractionPartialCount = 0;
  let totalExtractedEntities = 0;

  for (const doc of normalizedDocs) {
    const extraction = await extractAndFusePII(doc.text, {
      skipSidecar: options?.skipSidecar,
    });

    if (
      extraction.partial ||
      (extraction.sidecarStatus !== "online" && extraction.sidecarStatus !== "skipped")
    ) {
      extractionPartialCount++;
    }

    totalExtractedEntities += extraction.entities.length;


    let correlation: CorrelatedExposureOutcome | undefined;
    if (options?.monitoredIdentity) {
      const isDocumentTier = doc.evidenceTier === "document";
      correlation = correlateExtractedEntities(
        extraction.entities as unknown as ExtractedEntity[],
        options.monitoredIdentity,
        {
          sourceDomain: doc.domain,
          evidenceConfidence: isDocumentTier ? 0.98 : 0.70,
        },
      );
    }

    extractedOutcomes.push({
      document: doc,
      extraction,
      correlation,
    });
  }

  const extractionStatus: ProviderStatus =
    extractionPartialCount > 0 ? "partial" : "completed";

  // --- Stage 5: Overall Status Synthesis ---
  let overallStatus: ProviderStatus = "completed";
  if (serperStatus === "unavailable" && normalizedDocs.length === 0) {
    overallStatus = "unavailable";
  } else if (
    serperStatus === "partial" ||
    serperStatus === "unavailable" ||
    firecrawlStatus === "partial" ||
    firecrawlStatus === "unavailable" ||
    extractionStatus === "partial"
  ) {
    overallStatus = "partial";
  }

  return {
    status: overallStatus,
    queriesRun,
    discoveryResults,
    documents: normalizedDocs,
    extractedOutcomes,
    stageStatus: {
      serper: serperStatus,
      firecrawl: firecrawlStatus,
      extraction: extractionStatus,
    },
    metrics: {
      totalDiscovered: discoveryResults.length,
      selectedForHydration: selectedUrls.length,
      successfullyHydrated: firecrawlSuccessCount,
      snippetFallbacks: firecrawlFallbackCount,
      totalExtractedEntities,
    },
  };
}
