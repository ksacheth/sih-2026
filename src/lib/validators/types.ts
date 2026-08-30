export type PiiType = "EMAIL" | "PHONE" | "AADHAAR" | "PAN";

export type DetectorProvenance = "regex" | "checksum" | "gliner";

export interface PiiCandidate {
  type: PiiType;
  rawValue: string; // exactly as it appeared in the source text
  normalizedValue: string; // canonical form — feeds exposure fingerprint
  confidence: number; // 0–1, deterministic constants
  detector: "regex_checksum";
  provenance: ("regex" | "checksum")[];
  offsetStart: number; // char offsets in analyzed text (mandatory for fusion & evaluation)
  offsetEnd: number;
  meta?: Partial<{
    checksumValid: boolean; // Aadhaar: Verhoeff result
    holderType: string; // PAN: 4th char (P/C/H/F/A/T/B/L/J/G)
    isIndividual?: boolean; // PAN: true if holderType === "P"
    e164: string; // Phone: +91XXXXXXXXXX
    isIndianMobile?: boolean;
    masked?: string;
    obfuscated?: boolean;
  }>;
}
