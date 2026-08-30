import { getDb } from "@/lib/models/db";
import { sha256 } from "./crypto";

export async function audit(
  event: string,
  userId: string | null,
  metadata: Record<string, unknown> = {}
) {
  const db = await getDb();
  const safe = Object.fromEntries(
    Object.entries(metadata).filter(([key]) =>
      !/(email|phone|aadhaar|pan|password|document|raw)/i.test(key)
    )
  );

  await db.collection("audit_events").insertOne({
    event,
    userId: userId ? sha256(userId) : null,
    metadata: safe,
    createdAt: new Date(),
  });
}
