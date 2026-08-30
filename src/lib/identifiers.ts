import { getDb, type AppDocument } from "@/lib/models/db";
import { hmac } from "@/lib/security/crypto";
import { maskIdentifier } from "@/lib/security/masking";
import type { IdentifierType } from "@/lib/models";

export function normalizeIdentifier(type: IdentifierType, value: string): string {
  const v = value.trim();
  if (type === "EMAIL") return v.toLowerCase();
  if (type === "PHONE") return v.replace(/[^\d+]/g, "");
  if (type === "USERNAME") return v.toLowerCase().replace(/^@/, "");
  return v.toLowerCase().replace(/\s+/g, " ");
}

export async function getOwnedIdentifier(userId: string, id: string) {
  const db = await getDb();
  return db.collection("identifiers").findOne({ _id: id, userId });
}

export async function getOwnedIdentity(userId: string, id: string) {
  const db = await getDb();
  return db.collection("identities").findOne({ _id: id, userId });
}

export async function hasVerifiedEmail(userId: string) {
  const db = await getDb();
  return Boolean(await db.collection("identifiers").findOne({
    userId, type: "EMAIL", status: "VERIFIED",
  }));
}

// Accepts AppDocument so loosely-typed driver results and locally built
// docs both fit without per-call casts; field reads stay permissive.
export function publicIdentifier(doc: AppDocument) {
  return {
    id: doc._id,
    identityId: doc.identityId,
    type: doc.type,
    value: doc.maskedValue,
    status: doc.status,
    createdAt: doc.createdAt,
  };
}

export function identifierHmac(normalized: string) {
  return hmac(normalized);
}

export { maskIdentifier };