export type IdentifierType = "EMAIL" | "PHONE" | "USERNAME" | "NAME";
export type IdentifierStatus = "PENDING" | "VERIFIED" | "ATTESTED";

export interface IdentifierDocument {
  _id?: string;
  userId: string;
  identityId: string;
  type: IdentifierType;
  valueEncrypted?: string;
  valueHmac: string;
  normalizedValue: string;
  maskedValue: string;
  status: IdentifierStatus;
  createdAt: Date;
  verifiedAt?: Date;
}

export interface IdentityDocument {
  _id?: string;
  userId: string;
  context?: { organization?: string; location?: string };
  identifierIds: string[];
  createdAt: Date;
}

export interface ConsentDocument {
  _id?: string;
  userId: string;
  identifierId: string;
  purpose: "EXPOSURE_MONITORING";
  scope: string;
  version: string;
  createdAt: Date;
  revokedAt?: Date;
}

export interface VerificationCodeDocument {
  _id?: string;
  userId: string;
  identifierId: string;
  codeHash: string;
  attempts: number;
  createdAt: Date;
  expiresAt: Date;
}

export type ScanStatus =
  | "QUEUED" | "RUNNING" | "COMPLETED" | "PARTIAL" | "FAILED" | "CANCELLED";

export interface ScanDocument {
  _id?: string;
  userId: string;
  identityId: string;
  status: ScanStatus;
  sourceStatus: Record<string, string>;
  /** Per-source failure detail (keyed like sourceStatus); never contains PII. */
  sourceErrors?: Record<string, string>;
  cancelRequested?: boolean;
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
}

/** One evidence item attached to an exposure (from a DiscoveryResult). */
export interface ExposureEvidence {
  source: string;
  sourceId: string;
  url: string;
  domain: string;
  title?: string;
  snippet?: string;
  evidenceTier: "document" | "snippet";
  discoveredAt: string;
  fetchedAt?: Date;
  contentSha256?: string;
}

export interface RecommendationTask {
  action: string;
  title?: string;
  [key: string]: unknown;
}

export type ExposureSeverity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";

/**
 * A tracked exposure — the monitoring state machine's unit of record.
 * `fingerprint` is unique per (identity, source, exposure type, entity);
 * `entity` is the user's own data and is masked at the API boundary.
 */
export interface ExposureDocument {
  _id?: string;
  userId: string;
  identityId: string;
  fingerprint: string;
  source: string;
  exposureType: string;
  entity: string;
  entityMasked: string;
  status: string;
  severity: ExposureSeverity;
  identityConfidence: number;
  evidenceConfidence: number;
  matchLabel: "CONFIRMED" | "POTENTIAL";
  threats: string[];
  recommendations: RecommendationTask[];
  ruleVersion: string;
  evidence: ExposureEvidence[];
  firstSeenScanId?: string;
  lastSeenScanId?: string;
  firstSeenAt?: Date;
  lastSeenAt?: Date;
  reappearedAt?: Date;
  remediatedAt?: Date;
  closedAt?: Date;
  notFoundCount: number;
  createdAt: Date;
  updatedAt: Date;
}

/** Last-scan snapshot per identity (CONTEXT.md §10.1 "monitoring"). */
export interface MonitoringSnapshotDocument {
  _id?: string;
  userId: string;
  identityId: string;
  lastScanId: string;
  /** Fingerprints seen in the latest scan, with their candidate summaries. */
  states: Record<string, { source: string; exposureType: string; entity: string }>;
  updatedAt: Date;
}