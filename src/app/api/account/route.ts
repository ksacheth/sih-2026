import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/require-user";
import { getDb } from "@/lib/models/db";
import { audit } from "@/lib/security/audit";
import { sha256 } from "@/lib/security/crypto";

export const runtime = "nodejs";

export async function DELETE() {
  const user = await requireUser();
  const db = await getDb();

  // MongoDB multi-document transactions require a replica set/Atlas.
  const client = db.client;
  const session = client.startSession();

  try {
    await session.withTransaction(async () => {
      const collections = [
        "recommendations", "exposures", "identity_matches", "pii_entities",
        "documents", "discovery_results", "scan_jobs", "scans",
        "monitoring", "consents", "verification_codes", "identifiers", "identities",
      ];

      for (const name of collections) {
        await db.collection(name).deleteMany({ userId: user.id }, { session });
      }

      // Security audit remains, hashed-only, per the specification.
      await db.collection("audit_events").updateMany(
        { userId: sha256(user.id) },
        { $set: { userId: sha256(user.id), metadata: { erased: true } } },
        { session }
      );
    });
  } finally {
    await session.endSession();
  }

  await audit("ACCOUNT_ERASED", null, { erasedUser: sha256(user.id) });
  return NextResponse.json({ ok: true });
}
