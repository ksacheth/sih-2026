export type Severity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
export type Confidence = "CONFIRMED" | "POTENTIAL";
export type EvidenceTier = "Document" | "Snippet";
export type FindingStatus = "ACTIVE" | "REAPPEARED" | "REMEDIATED";
export type ScanSource = "Serper" | "ExposedOrNot" | "Brokers" | "GLiNER";
export interface Finding { id: number; title: string; severity: Severity; confidence: Confidence; tier: EvidenceTier; source: string; sourceUrl: string; discoveredAt: string; snippet: string; status: FindingStatus; threats: string[]; actions: string[]; explanation: string; aiGenerated: boolean; }
export interface Identifier {
  id: string;
  identityId: string;
  type: "EMAIL" | "PHONE" | "USERNAME" | "NAME";
  value: string;
  status: "PENDING" | "VERIFIED" | "ATTESTED";
}
