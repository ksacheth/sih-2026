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
  cancelRequested?: boolean;
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
}