/**
 * Async scan orchestrator (CONTEXT.md §3.1, Dev-2 task 3).
 *
 * POST /api/scan creates the QUEUED scan and returns 202 immediately; this
 * runner is invoked fire-and-forget (`void runScanPipeline(scanId)`). All
 * state lives in Mongo; the HTTP request is never held open.
 *
 * Guarantees:
 * - Incremental persistence: findings land in `discovery_results` per source
 *   as each connector completes (user story 16) — a crash mid-scan keeps
 *   usable partial results.
 * - A source failure contributes to PARTIAL; it never crashes the scan and
 *   never fabricates a clean result (§12.4).
 * - Cooperative cancellation: `cancelRequested` is checked between stages
 *   (§3.1; in-flight fetches are not killed).
 * - Boot recovery: recoverStaleScans() (wired in instrumentation.ts) marks
 *   scans stuck QUEUED/RUNNING >10min as PARTIAL.
 * - ML-1 hand-off: discovery results (with fetched-document metadata) are
 *   persisted to `discovery_results`/`documents` — the fixed boundary the
 *   extraction pipeline consumes. Until ML-1 lands, only structured sources
 *   (breach records, broker listings) become exposure candidates; web
 *   results stay discovery-tier leads.
 */
import {
  buildTargetedQueries,
  exposedOrNotConnector,
  findBrokerResults,
  hydrateUrlsWithFirecrawl,
  runConnector,
  serperConnector,
} from "@/lib/connectors";
import type { DiscoveryResult } from "@/lib/connectors";
import { getDb } from "@/lib/models/db";
import { audit } from "@/lib/security/audit";
import { applyReScan, type ExposureCandidate } from "@/lib/monitoring/store";
import { normalizeUrl } from "./url";
import {
  selectUrlsForHydration,
  canonicalizeUrl,
} from "@/lib/discovery";
import {
  normalizeHydratedDocument,
  createSnippetFallbackDocument,
  type NormalizedDocument,
} from "@/lib/content";
import { extractAndFusePII } from "@/lib/extraction";
import {
  correlateExtractedEntities,
  type MonitoredIdentity,
  type ExtractedEntity,
} from "@/lib/correlation";
import {
  aggregateScanStatus,
  breachCandidate,
  brokerCandidate,
  isStaleScan,
  SCAN_STUCK_THRESHOLD_MS,
} from "./scanState";


/** §5.6 soft scan deadline: stop starting new work, finish in-flight, persist. */
export const SCAN_SOFT_DEADLINE_MS = 90_000;

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * The scan pipeline. Contract: never throws (the fire-and-forget caller
 * cannot await it), always drives the scan to a terminal status, and
 * persists findings incrementally so a crash mid-scan keeps usable data.
 */
export async function runScanPipeline(scanId: string): Promise<void> {
  try {
    const db = await getDb();
    const scans = db.collection("scans");

    // Claim the scan: only a QUEUED scan is picked up, so a double-fire (or a
    // race with boot recovery) is a no-op.
    const claimed = await scans.findOneAndUpdate(
      { _id: scanId, status: "QUEUED" },
      { $set: { status: "RUNNING", startedAt: new Date() } },
      { returnDocument: "after" },
    );
    if (!claimed) return;
    const scan = claimed as unknown as {
      _id: string;
      userId: string;
      identityId: string;
      sourceStatus: Record<string, string>;
    };
    await audit("SCAN_STARTED", scan.userId, { scanId: scan._id });

    const deadlineMs = Date.now() + SCAN_SOFT_DEADLINE_MS;

    // Per-source status is mirrored in memory for the final aggregation and
    // written through to the scan document so the polling dashboard sees
    // live progress (§3.1 step 10).
    const sourceStatus: Record<string, string> = { ...scan.sourceStatus };
    const setSource = async (source: string, status: string, error?: string) => {
      sourceStatus[source] = status;
      await scans.updateOne(
        { _id: scan._id },
        {
          $set: {
            [`sourceStatus.${source}`]: status,
            ...(error ? { [`sourceErrors.${source}`]: error } : {}),
          },
        },
      );
      if (status === "OK" || status === "UNAVAILABLE") {
        await audit("SOURCE_ACCESSED", scan.userId, { scanId: scan._id, source });
      }
    };

    /** Cooperative cancellation (§3.1): checked between stages, never mid-fetch. */
    const checkCancel = async (): Promise<boolean> => {
      const doc = await scans.findOne(
        { _id: scan._id },
        { projection: { cancelRequested: 1 } },
      );
      if (!doc?.cancelRequested) return false;
      await scans.updateOne(
        { _id: scan._id, status: { $in: ["QUEUED", "RUNNING"] } },
        { $set: { status: "CANCELLED", completedAt: new Date() } },
      );
      return true;
    };

    // ---- inputs --------------------------------------------------------------
    const identity = await db.collection("identities").findOne({ _id: scan.identityId });
    const identifiers = await db
      .collection("identifiers")
      .find({ userId: scan.userId, identityId: scan.identityId })
      .toArray();

    const first = (type: string): string | undefined =>
      identifiers.find((id) => id.type === type)?.normalizedValue;
    const emails = identifiers
      .filter((id) => id.type === "EMAIL")
      .map((id) => id.normalizedValue);

    const searchIds = {
      email: first("EMAIL"),
      username: first("USERNAME"),
      name: first("NAME"),
      org: (identity?.context as { organization?: string } | undefined)?.organization,
    };

    // ---- persistence helpers --------------------------------------------------
    const resultsCollection = db.collection("discovery_results");
    const seenCanonical = new Set<string>();

    /** Incremental per-source persistence (user story 16). */
    const persistResults = async (results: DiscoveryResult[]) => {
      if (results.length === 0) return;
      await resultsCollection.insertMany(
        results.map((r) => ({
          scanId: scan._id,
          userId: scan.userId,
          identityId: scan.identityId,
          canonicalUrl: normalizeUrl(r.url) ?? r.url,
          createdAt: new Date(),
          ...r,
        })),
      );
    };

    // ---- stage 1: web search (Serper), persisted per query -------------------
    const webResults: DiscoveryResult[] = [];
    await setSource("serper", "RUNNING");
    const queries = buildTargetedQueries(searchIds);
    if (queries.length === 0) {
      await setSource("serper", "SKIPPED", "no searchable identifiers");
    } else {
      let failures = 0;
      let lastError: string | undefined;
      for (const query of queries) {
        const run = await runConnector(serperConnector, query);
        if (run.status !== "ok") {
          failures += 1;
          lastError = run.reason ?? "unknown";
          continue;
        }
        const fresh = run.results.filter((r) => {
          const key = normalizeUrl(r.url) ?? r.sourceId;
          if (seenCanonical.has(key)) return false;
          seenCanonical.add(key);
          return true;
        });
        webResults.push(...fresh);
        if (fresh.length > 0) await persistResults(fresh);
      }
      await setSource(
        "serper",
        failures >= queries.length ? "UNAVAILABLE" : "OK",
        failures > 0
          ? `${failures}/${queries.length} queries failed${lastError ? `: ${lastError}` : ""}`
          : undefined,
      );
    }
    if (await checkCancel()) return;

    // ---- stage 2: Firecrawl URL hydration & local extraction (architecture.md §3, §4.3, §8) ----
    await setSource("firecrawl", "RUNNING");
    await setSource("extraction", "RUNNING");

    const selection = selectUrlsForHydration(webResults, searchIds);
    const selectedUrls = selection.selectedForHydration;
    const snippetOnlyUrls = selection.snippetOnlyResults;

    const webCandidates: ExposureCandidate[] = [];
    let firecrawlSuccessCount = 0;
    let extractionFailures = 0;

    const hydrateRequests = selectedUrls.map((r) => ({
      url: r.url,
      canonicalUrl: canonicalizeUrl(r.url) || r.url,
    }));

    const hydrationMap =
      selectedUrls.length > 0
        ? await hydrateUrlsWithFirecrawl(hydrateRequests, { concurrencyLimit: 3 })
        : new Map();

    const normalizedDocs: NormalizedDocument[] = [];

    for (const r of selectedUrls) {
      const res = hydrationMap.get(r.url);
      if (res && res.status === "completed" && res.document) {
        r.evidenceTier = "document";
        const doc = normalizeHydratedDocument(res.document);
        normalizedDocs.push(doc);
        firecrawlSuccessCount++;
        r.rawMetadata = {
          ...r.rawMetadata,
          fetched: {
            finalUrl: doc.sourceUrl,
            contentSha256: doc.contentHash,
            fetchedAt: doc.retrievedAt,
          },
        };
        await db.collection("documents").insertOne({
          scanId: scan._id,
          userId: scan.userId,
          identityId: scan.identityId,
          url: doc.sourceUrl,
          canonicalUrl: doc.canonicalUrl,
          contentType: doc.contentType,
          contentSha256: doc.contentHash,
          textPreview: doc.text.slice(0, 2000),
          retrievedAt: new Date(),
        });
      } else {
        r.evidenceTier = "snippet";
        const errCode = res?.error?.code || "FIRECRAWL_HYDRATION_FAILED";
        r.rawMetadata = {
          ...r.rawMetadata,
          fetchBlocked: { reason: errCode },
        };
        normalizedDocs.push(createSnippetFallbackDocument(r, errCode));
      }

      await resultsCollection.updateOne(
        { scanId: scan._id, sourceId: r.sourceId },
        { $set: { evidenceTier: r.evidenceTier, rawMetadata: r.rawMetadata } },
      );
    }

    for (const r of snippetOnlyUrls) {
      r.evidenceTier = "snippet";
      normalizedDocs.push(createSnippetFallbackDocument(r, "SNIPPET_TIER_UNSELECTED"));
    }

    await setSource(
      "firecrawl",
      selectedUrls.length === 0
        ? "SKIPPED"
        : firecrawlSuccessCount === selectedUrls.length
          ? "OK"
          : firecrawlSuccessCount > 0
            ? "PARTIAL"
            : "UNAVAILABLE",
    );

    // Run local extraction & correlation on normalized documents
    for (const doc of normalizedDocs) {
      const extraction = await extractAndFusePII(doc.text);
      if (
        extraction.partial ||
        (extraction.sidecarStatus !== "online" && extraction.sidecarStatus !== "skipped")
      ) {
        extractionFailures++;
      }

      if (extraction.entities.length > 0) {
        await db.collection("pii_entities").insertMany(
          extraction.entities.map((e) => ({
            scanId: scan._id,
            userId: scan.userId,
            identityId: scan.identityId,
            documentId: doc.documentId,
            sourceUrl: doc.sourceUrl,
            ...e,
            createdAt: new Date(),
          })),
        );

        if (identity) {
          const monitored: MonitoredIdentity = {
            id: scan.identityId,
            userId: scan.userId,
            email: searchIds.email,
            username: searchIds.username,
            name: searchIds.name,
            organization: searchIds.org,
          };
          const isDocTier = doc.evidenceTier === "document";
          const outcome = correlateExtractedEntities(
            extraction.entities as unknown as ExtractedEntity[],
            monitored,
            {
              sourceDomain: doc.domain,
              evidenceConfidence: isDocTier ? 0.98 : 0.70,
            },
          );

          if (outcome.matchLabel === "CONFIRMED" || outcome.matchLabel === "POTENTIAL") {
            webCandidates.push({
              source: "serper",
              exposureType: outcome.exposureType,
              entity: doc.canonicalUrl,
              entityMasked: doc.domain,
              severity: outcome.severity,
              identityConfidence: outcome.identityConfidence,
              evidenceConfidence: outcome.evidenceConfidence,
              matchLabel: outcome.matchLabel,
              threats: outcome.threats,
              recommendations: outcome.recommendations.map((t) => ({
                action: t.actionCode,
                title: t.title,
                optOutUrl: t.optOutUrl,
              })),
              ruleVersion: outcome.ruleVersion,
              evidence: {
                source: "serper",
                sourceId: doc.canonicalUrl,
                url: doc.sourceUrl,
                domain: doc.domain,
                title: doc.title,
                snippet: doc.text.slice(0, 300),
                evidenceTier: doc.evidenceTier,
                discoveredAt: doc.retrievedAt,
                contentSha256: doc.contentHash,
              },
            });
          }
        }
      }
    }

    await setSource(
      "extraction",
      normalizedDocs.length === 0
        ? "SKIPPED"
        : extractionFailures > 0
          ? "PARTIAL"
          : "OK",
    );

    if (await checkCancel()) return;

    // ---- stage 3: breach intelligence (per verified email) --------------------
    const breachResults: DiscoveryResult[] = [];
    await setSource("exposedornot", "RUNNING");
    if (emails.length === 0) {
      await setSource("exposedornot", "SKIPPED", "no verified email identifier");
    } else {
      let failures = 0;
      let lastError: string | undefined;
      for (const email of emails) {
        const run = await runConnector(exposedOrNotConnector, email);
        if (run.status === "ok") {
          breachResults.push(...run.results);
        } else {
          failures += 1;
          lastError = run.reason ?? "unknown";
        }
      }
      await persistResults(breachResults);
      await setSource(
        "exposedornot",
        failures >= emails.length ? "UNAVAILABLE" : "OK",
        failures > 0
          ? `${failures}/${emails.length} lookups failed${lastError ? `: ${lastError}` : ""}`
          : undefined,
      );
    }
    if (await checkCancel()) return;

    // ---- stage 4: data-broker matching (pure derivation, §5.5) ----------------
    await setSource("brokers", "RUNNING");
    const brokerResults = findBrokerResults(webResults);
    await persistResults(brokerResults);
    await setSource("brokers", "OK");

    // ---- finalize: monitoring state machine + terminal status -----------------
    const candidates: ExposureCandidate[] = [
      ...webCandidates,
      ...breachResults.map(breachCandidate),
      ...brokerResults.map(brokerCandidate),
    ];

    const monitoring = await applyReScan(db, {
      userId: scan.userId,
      identityId: scan.identityId,
      scanId: scan._id,
      candidates,
      // §12.4: only sources that actually completed can mark prior exposures
      // absent — a source outage must not erase previous findings.
      evaluatedSources: evaluatedSources(sourceStatus),
    });

    const finalStatus = aggregateScanStatus(sourceStatus);
    await scans.updateOne(
      { _id: scan._id },
      { $set: { status: finalStatus, completedAt: new Date(), monitoring } },
    );
    await audit("SCAN_COMPLETED", scan.userId, { scanId: scan._id, status: finalStatus });
  } catch (err) {
    // Never throw out of the pipeline (fire-and-forget); record the failure.
    console.error(`[pipeline] scan ${scanId} failed:`, describeError(err));
    try {
      const db = await getDb();
      await db.collection("scans").updateOne(
        { _id: scanId, status: { $in: ["QUEUED", "RUNNING"] } },
        { $set: { status: "FAILED", completedAt: new Date(), error: describeError(err) } },
      );
    } catch {
      /* Mongo unreachable — nothing more the pipeline can do */
    }
  }
}

/** Sources whose data was actually gathered this scan (for §12.4 semantics). */
function evaluatedSources(sourceStatus: Record<string, string>): string[] {
  return Object.entries(sourceStatus)
    .filter(([, status]) => status === "OK")
    .map(([source]) => source);
}

/**
 * Boot crash recovery (§3.1): mark scans stuck in QUEUED/RUNNING past the
 * 10-minute threshold as PARTIAL ("resumed system") so users never see a
 * scan stuck in progress and the one-active-scan index is unblocked. Wired
 * into instrumentation.ts (Next.js boot hook).
 */
export async function recoverStaleScans(): Promise<number> {
  const db = await getDb();
  const candidates = (await db
    .collection("scans")
    .find({ status: { $in: ["QUEUED", "RUNNING"] } })
    .toArray()) as unknown as Array<{
    _id: string;
    status: string;
    startedAt?: Date;
    createdAt?: Date;
    sourceErrors?: Record<string, string>;
  }>;
  const stale = candidates.filter((doc) =>
    isStaleScan(doc, Date.now(), SCAN_STUCK_THRESHOLD_MS),
  );
  for (const doc of stale) {
    await db.collection("scans").updateOne(
      { _id: doc._id, status: { $in: ["QUEUED", "RUNNING"] } },
      {
        $set: {
          status: "PARTIAL",
          completedAt: new Date(),
          sourceErrors: { ...doc.sourceErrors, recovery: "resumed system: scan interrupted by restart" },
        },
      },
    );
  }
  return stale.length;
}
