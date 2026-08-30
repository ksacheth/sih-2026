/**
 * Pure scan-pipeline helpers (Dev-2 task 3).
 *
 * Everything here is a pure function so the pipeline's decision logic is
 * unit-testable without Mongo: status aggregation (§3.1 step 10), exposure
 * candidates for the structured sources (breach records, broker listings —
 * web findings stay discovery-tier until ML-1 extraction lands), the
 * identifier→query-plan mapping, and the boot-recovery staleness rule.
 */
import type { DiscoveryResult } from "@/lib/connectors";
import { CREDENTIAL_EXPOSURE_SIGNAL } from "@/lib/connectors";
import type { ExposureEvidence } from "@/lib/models";
import type { ExposureCandidate } from "@/lib/monitoring/store";
import { evaluateSeverity, evaluateThreats, generateRecommendations } from "@/lib/rules";
import { RULE_VERSION } from "@/lib/rules/confidence";
import type { RecommendationTask } from "@/lib/models";

/** Per-source terminal statuses recorded on the scan document. */
export type SourceStatus = "OK" | "UNAVAILABLE" | "SKIPPED";

/**
 * Fold per-source statuses into the final scan status (§3.1 step 10).
 * SKIPPED (source had nothing to query) is neutral. All evaluated sources
 * OK → COMPLETED; some usable → PARTIAL; none usable → FAILED.
 */
export function aggregateScanStatus(
  sourceStatus: Record<string, string>,
): "COMPLETED" | "PARTIAL" | "FAILED" {
  const evaluated = Object.values(sourceStatus).filter((v) => v !== "SKIPPED");
  if (evaluated.length === 0) return "FAILED";
  const ok = evaluated.filter((v) => v === "OK").length;
  if (ok === evaluated.length) return "COMPLETED";
  return ok > 0 ? "PARTIAL" : "FAILED";
}

/** Boot-recovery threshold (§3.1): a scan stuck past this was left by a dead process. */
export const SCAN_STUCK_THRESHOLD_MS = 10 * 60 * 1000;

/**
 * Boot-recovery rule (§3.1): a QUEUED/RUNNING scan whose anchor time
 * (startedAt, falling back to createdAt) is older than the threshold was
 * orphaned by a dead process. QUEUED counts too — the one-active-scan index
 * would otherwise block every future scan for that identity.
 */
export function isStaleScan(
  scan: { status: string; startedAt?: Date | null; createdAt?: Date | null },
  now: number,
  thresholdMs: number = SCAN_STUCK_THRESHOLD_MS,
): boolean {
  if (scan.status !== "RUNNING" && scan.status !== "QUEUED") return false;
  const anchor = scan.startedAt ?? scan.createdAt ?? null;
  if (!anchor) return false;
  return anchor.getTime() <= now - thresholdMs;
}

/** Map the rules engine's recommendation tasks onto the stored shape. */
function toStoredRecommendations(
  tasks: Array<{ actionCode: string; title: string; optOutUrl?: string }>,
): RecommendationTask[] {
  return tasks.map((task) => ({
    action: task.actionCode,
    title: task.title,
    optOutUrl: task.optOutUrl,
  }));
}

function toEvidence(result: DiscoveryResult): ExposureEvidence {
  const fetchMeta = result.rawMetadata?.fetched as
    | { contentSha256?: string; fetchedAt?: string }
    | undefined;
  return {
    source: result.source,
    sourceId: result.sourceId,
    url: result.url,
    domain: result.domain,
    title: result.title,
    snippet: result.snippet,
    evidenceTier: result.evidenceTier,
    discoveredAt: result.discoveredAt,
    contentSha256: fetchMeta?.contentSha256,
  };
}

function signalsIncludeCredential(result: DiscoveryResult): boolean {
  const signals = result.rawMetadata?.signals;
  return Array.isArray(signals) && signals.includes(CREDENTIAL_EXPOSURE_SIGNAL);
}

/**
 * Exposure candidate from a breach record (exposedornot). Confirmed by
 * construction — the lookup ran against a VERIFIED email owned by the
 * scanning user. The entity is the breach record itself so each breach is
 * independently trackable across re-scans; severity/threats/recommendations
 * come from the versioned rules engine (ML-2), not ad-hoc constants.
 */
export function breachCandidate(result: DiscoveryResult): ExposureCandidate {
  const credential = signalsIncludeCredential(result);
  const exposureType = credential ? "CREDENTIAL_EXPOSURE" : "BREACH_RECORD";
  const piiTypes = ["EMAIL"];
  const matchLabel = "CONFIRMED" as const;

  return {
    source: result.source,
    exposureType,
    entity: result.sourceId,
    entityMasked: result.sourceId, // breach names are public metadata, not PII
    severity: evaluateSeverity({
      exposureType,
      piiTypes,
      isBreachDump: true,
      matchLabel,
      identityConfidence: 0.9, // exact verified-email match by construction
      evidenceConfidence: 1, // structured API data, not scraped prose
    }).severity,
    identityConfidence: 0.9,
    evidenceConfidence: 1, // structured API data, not scraped prose
    matchLabel,
    threats: evaluateThreats({
      exposureType,
      piiTypes,
      isBreachDump: true,
      matchLabel,
      independentSourceCount: 1,
    }).threats,
    recommendations: toStoredRecommendations(
      generateRecommendations({ exposureType, piiTypes, threats: [], matchLabel }),
    ),
    ruleVersion: RULE_VERSION,
    evidence: toEvidence(result),
  };
}

/**
 * Exposure candidate from a derived broker listing (§5.5). The entity is the
 * broker domain (stable across the pages that surfaced it); the finding is
 * POTENTIAL — a domain match, not an exact-identifier confirmation — and
 * carries the curated opt-out URL for the recommendation engine (§8.3).
 */
export function brokerCandidate(result: DiscoveryResult): ExposureCandidate {
  const broker = (result.rawMetadata?.broker ?? {}) as {
    name?: string;
    optOutUrl?: string;
  };
  const exposureType = "DATA_BROKER_LISTING";
  const matchLabel = "POTENTIAL" as const;

  return {
    source: result.source,
    exposureType,
    entity: (result.rawMetadata?.matchedDomain as string | undefined) ?? result.domain,
    entityMasked: broker.name ?? result.domain,
    severity: evaluateSeverity({
      exposureType,
      piiTypes: ["EMAIL"],
      matchLabel,
      identityConfidence: 0.5, // domain-listing match, not an exact identifier
      evidenceConfidence: result.evidenceTier === "document" ? 0.9 : 0.5,
    }).severity,
    identityConfidence: 0.5,
    evidenceConfidence: result.evidenceTier === "document" ? 0.9 : 0.5,
    matchLabel,
    threats: ["PRIVACY_COMMERCIALIZATION"],
    recommendations: toStoredRecommendations(
      generateRecommendations({
        exposureType,
        piiTypes: [],
        threats: ["PRIVACY_COMMERCIALIZATION"],
        matchLabel,
        optOutUrl: broker.optOutUrl,
        sourceDomain: result.domain,
      }),
    ),
    ruleVersion: RULE_VERSION,
    evidence: toEvidence(result),
  };
}
