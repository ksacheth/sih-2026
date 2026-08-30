export type EntityType =
  | "PERSON"
  | "ORGANIZATION"
  | "LOCATION"
  | "ADDRESS"
  | "EMAIL"
  | "PHONE"
  | "AADHAAR"
  | "PAN";

export type DetectorType = "regex_checksum" | "gliner" | "fused";
export type DetectorProvenance = "regex" | "checksum" | "gliner";

export type SidecarStatus = "online" | "skipped" | "sidecar_down" | "timeout" | "error";

export interface ExtractedEntity {
  type: EntityType;
  rawValue: string;
  normalizedValue: string;
  detector: DetectorType;
  provenance: DetectorProvenance[];
  detectorConfidence: number; // deterministic confidence remains authoritative for structured IDs
  glinerScore?: number; // retained separately; never upgrades a weak structured match
  offsetStart: number;
  offsetEnd: number;
  metadata?: Record<string, unknown>;
}

export interface ExtractionLimitations {
  noOcr: boolean;
  ocrNotice: string;
  languageScope: string;
}

export interface ExtractionResult {
  textLength: number;
  entities: ExtractedEntity[];
  sidecarStatus: SidecarStatus;
  partial: boolean;
  textTruncated: boolean;
  limitations: ExtractionLimitations;
  extractedAt: string;
}

export interface GlinerRawEntity {
  label: string;
  text: string;
  start: number;
  end: number;
  score: number;
}
