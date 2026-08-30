import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/require-user";
import { getDb } from "@/lib/models/db";
import { routeError } from "@/lib/http";
import type {
  Confidence,
  EvidenceTier,
  Finding,
  FindingStatus,
  Severity,
} from "@/components/dashboard/types";

export const runtime = "nodejs";

const SEVERITIES: ReadonlySet<string> = new Set(["CRITICAL", "HIGH", "MEDIUM", "LOW"]);

interface EvidenceDoc {
  url?: string;
  title?: string;
  snippet?: string;
}

interface ExposureDoc {
  _id: { toString(): string };
  source: string;
  exposureType: string;
  entity: string;
  entityMasked: string;
  status: string;
  severity?: string;
  matchLabel?: string;
  threats?: string[];
  recommendations?: Array<{ title?: string }>;
  evidence?: EvidenceDoc[];
  createdAt?: Date;
}

/** Monitoring states that should render as ACTIVE / REAPPEARED / REMEDIATED. */
function toFindingStatus(status: string): FindingStatus {
  if (status === "REMEDIATED" || status === "CLOSED") return "REMEDIATED";
  if (status === "REAPPEARED") return "REAPPEARED";
  return "ACTIVE";
}

function toSeverity(severity?: string): Severity {
  return severity && SEVERITIES.has(severity) ? (severity as Severity) : "LOW";
}

/**
 * Maps persisted exposures to the Finding shape the dashboard grid, evidence
 * drawer, and remediation center render.
 */
function toFinding(doc: ExposureDoc): Finding {
  const primary = doc.evidence?.[0];
  return {
    id: parseInt(doc._id.toString().slice(-6), 16),
    title: primary?.title ?? `${doc.entityMasked} (${doc.exposureType.replaceAll("_", " ").toLowerCase()})`,
    severity: toSeverity(doc.severity),
    confidence: doc.matchLabel === "CONFIRMED" ? "CONFIRMED" : "POTENTIAL",
    tier: primary?.url ? "Document" : "Snippet",
    source: doc.source,
    sourceUrl: primary?.url ?? "",
    discoveredAt: (doc.createdAt ?? new Date(0)).toISOString().slice(0, 10),
    snippet: primary?.snippet ?? "",
    status: toFindingStatus(doc.status),
    threats: doc.threats ?? [],
    actions: (doc.recommendations ?? [])
      .map((r) => r.title)
      .filter((t): t is string => typeof t === "string" && t.length > 0),
    explanation:
      `${doc.entityMasked} was found on ${doc.source} as a ${doc.exposureType
        .replaceAll("_", " ")
        .toLowerCase()} tied to one of your verified identifiers.`,
    aiGenerated: false,
  };
}

export async function GET() {
  try {
    const user = await requireUser();
    const db = await getDb();
    const docs = await db
      .collection("exposures")
      .find({ userId: user.id })
      .sort({ _id: -1 })
      .toArray();
    return NextResponse.json(docs.map((doc) => toFinding(doc as unknown as ExposureDoc)));
  } catch (e) {
    return routeError(e);
  }
}
