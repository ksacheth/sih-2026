/**
 * Monitoring persistence — applies the pure transition table
 * (stateMachine.ts) to the exposures collection for one re-scan.
 *
 * Every lifecycle decision goes through transitionExposure(); this module
 * only reads current state, applies transitions, and writes results:
 *   - exposures: one document per fingerprint (the lifecycle record)
 *   - monitoring: last-scan snapshot per identity (CONTEXT.md §10.1)
 */
import type {
  ExposureDocument,
  ExposureEvidence,
  MonitoringSnapshotDocument,
  RecommendationTask,
} from "@/lib/models";
import type { AppDb } from "@/lib/models/db";
import { exposureFingerprint } from "./fingerprint";
import { bumpSeverity, transitionExposure, type ExposureStatus } from "./stateMachine";

/** A current-scan sighting that may create or update an exposure. */
export interface ExposureCandidate {
  source: string;
  exposureType: string;
  /** Normalized entity (canonical URL, email, breach name…). */
  entity: string;
  entityMasked: string;
  severity: ExposureDocument["severity"];
  identityConfidence: number;
  evidenceConfidence: number;
  matchLabel: "CONFIRMED" | "POTENTIAL";
  threats: string[];
  recommendations: RecommendationTask[];
  ruleVersion: string;
  evidence: ExposureEvidence;
}

export interface MonitoringSummary {
  created: number;
  updated: number;
  reappeared: number;
  closed: number;
}

/**
 * Apply one scan's candidates to the monitoring state machine. Every stored
 * exposure for the identity that this scan did NOT re-find is read as absent
 * (NOT_FOUND counting → auto-close) — but only when the exposure's source
 * was actually evaluated this scan (`evaluatedSources`, §12.4: a source
 * outage must not erase previous findings). Sightings drive
 * FIRST_SEEN/ACTIVE/UNCHANGED/REAPPEARED transitions and severity bumps.
 */
export async function applyReScan(
  db: AppDb,
  input: {
    userId: string;
    identityId: string;
    scanId: string;
    candidates: ExposureCandidate[];
    /** Sources that completed OK this scan; absent-marking is limited to these. */
    evaluatedSources?: string[];
  },
): Promise<MonitoringSummary> {
  const now = new Date();
  const exposures = db.collection<ExposureDocument>("exposures");

  // Dedupe within the scan: several queries can surface the same exposure;
  // keep the strongest evidence (document tier wins).
  const seenByFingerprint = new Map<string, ExposureCandidate>();
  for (const candidate of input.candidates) {
    const fingerprint = exposureFingerprint({
      identityId: input.identityId,
      source: candidate.source,
      exposureType: candidate.exposureType,
      entity: candidate.entity,
    });
    const existing = seenByFingerprint.get(fingerprint);
    if (
      !existing ||
      (candidate.evidence.evidenceTier === "document" &&
        existing.evidence.evidenceTier !== "document")
    ) {
      seenByFingerprint.set(fingerprint, candidate);
    }
  }

  const storedDocs = await exposures
    .find({ identityId: input.identityId })
    .toArray();
  const storedByFingerprint = new Map(
    storedDocs.map((doc) => [doc.fingerprint, doc]),
  );

  const summary: MonitoringSummary = { created: 0, updated: 0, reappeared: 0, closed: 0 };

  for (const [fingerprint, candidate] of seenByFingerprint) {
    const stored = storedByFingerprint.get(fingerprint);
    const result = transitionExposure({
      previousState: (stored?.status as ExposureStatus) ?? null,
      seenInCurrentScan: true,
      notFoundCount: stored?.notFoundCount ?? 0,
    });

    if (!stored) {
      await exposures.insertOne({
        userId: input.userId,
        identityId: input.identityId,
        fingerprint,
        source: candidate.source,
        exposureType: candidate.exposureType,
        entity: candidate.entity,
        entityMasked: candidate.entityMasked,
        status: result.state,
        severity: candidate.severity,
        identityConfidence: candidate.identityConfidence,
        evidenceConfidence: candidate.evidenceConfidence,
        matchLabel: candidate.matchLabel,
        threats: candidate.threats,
        recommendations: candidate.recommendations,
        ruleVersion: candidate.ruleVersion,
        evidence: [candidate.evidence],
        firstSeenScanId: input.scanId,
        lastSeenScanId: input.scanId,
        firstSeenAt: now,
        lastSeenAt: now,
        reappearedAt: result.severityBump ? now : undefined,
        notFoundCount: 0,
        createdAt: now,
        updatedAt: now,
      });
      summary.created += 1;
      continue;
    }

    const escalated = result.severityBump
      ? bumpSeverity(stored.severity)
      : stored.severity;
    await exposures.updateOne(
      { _id: stored._id },
      {
        $set: {
          status: result.state,
          severity: escalated,
          notFoundCount: result.notFoundCount,
          lastSeenAt: now,
          lastSeenScanId: input.scanId,
          ...(result.severityBump ? { reappearedAt: now } : {}),
          ...(result.becameClosed ? { closedAt: now } : {}),
          updatedAt: now,
        },
      },
    );
    summary.updated += 1;
    if (result.severityBump) summary.reappeared += 1;
    if (result.becameClosed) summary.closed += 1;
  }

  // Absent this scan: advance every stored exposure the scan didn't see —
  // but only for sources that were actually evaluated (§12.4).
  const evaluated = input.evaluatedSources
    ? new Set(input.evaluatedSources)
    : null;
  for (const [fingerprint, stored] of storedByFingerprint) {
    if (seenByFingerprint.has(fingerprint)) continue;
    if (evaluated && !evaluated.has(stored.source)) continue;
    const result = transitionExposure({
      previousState: stored.status as ExposureStatus,
      seenInCurrentScan: false,
      notFoundCount: stored.notFoundCount ?? 0,
    });
    if (
      result.state === stored.status &&
      result.notFoundCount === stored.notFoundCount
    ) {
      continue; // sticky state (REMEDIATED/CLOSED) — nothing to write
    }
    await exposures.updateOne(
      { _id: stored._id },
      {
        $set: {
          status: result.state,
          notFoundCount: result.notFoundCount,
          ...(result.becameClosed ? { closedAt: now } : {}),
          updatedAt: now,
        },
      },
    );
    summary.updated += 1;
    if (result.becameClosed) summary.closed += 1;
  }

  await db
    .collection<MonitoringSnapshotDocument>("monitoring")
    .updateOne(
      { _id: `mon:${input.identityId}` },
      {
        $set: {
          userId: input.userId,
          identityId: input.identityId,
          lastScanId: input.scanId,
          states: Object.fromEntries(
            [...seenByFingerprint.entries()].map(([fingerprint, candidate]) => [
              fingerprint,
              {
                source: candidate.source,
                exposureType: candidate.exposureType,
                entity: candidate.entity,
              },
            ]),
          ),
          updatedAt: now,
        },
      },
      { upsert: true },
    );

  return summary;
}

/**
 * User-initiated remediation (dashboard "Mark as remediated"). Stored on the
 * exposure immediately; the next re-scan either confirms it held (stays
 * REMEDIATED) or escalates to REAPPEARED with a severity bump.
 */
export async function markRemediated(
  db: AppDb,
  input: { userId: string; exposureId: string },
): Promise<ExposureDocument | null> {
  const exposures = db.collection<ExposureDocument>("exposures");
  const now = new Date();
  const result = await exposures.findOneAndUpdate(
    {
      _id: input.exposureId,
      userId: input.userId,
      status: { $nin: ["REMEDIATED", "CLOSED"] },
    },
    {
      $set: { status: "REMEDIATED", remediatedAt: now, notFoundCount: 0, updatedAt: now },
    },
    { returnDocument: "after" },
  );
  return result ?? null;
}
