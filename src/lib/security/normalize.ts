import type { IdentifierType } from "@/lib/models";

export function normalizeIdentifier(type: IdentifierType, value: string): string {
  const trimmed = value.trim();
  if (type === "EMAIL") return trimmed.toLowerCase();
  if (type === "PHONE") return trimmed.replace(/[^\d+]/g, "");
  if (type === "USERNAME") return trimmed.toLowerCase().replace(/^@/, "");
  return trimmed.toLowerCase().replace(/\s+/g, " ");
}
