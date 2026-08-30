import { getDb } from "@/lib/models/db";

type Limit = { count: number; windowMs: number };

// Atomic quota reservation. The previous count-then-insert check let
// concurrent requests all observe the same count and exceed the limit; the
// guarded findOneAndUpdate below reserves a slot in one atomic step.
export async function enforceUserLimit(
  userId: string,
  kind: "scan" | "verification",
  limit: Limit
) {
  const db = await getDb();
  const now = Date.now();
  const windowStart = Math.floor(now / limit.windowMs) * limit.windowMs;
  const windowEnd = windowStart + limit.windowMs;

  const filter = { _id: `${userId}:${kind}:${windowStart}`, count: { $lt: limit.count } };
  const update = {
    $inc: { count: 1 },
    $setOnInsert: {
      userId,
      kind,
      windowStart: new Date(windowStart),
      expiresAt: new Date(windowEnd),
    },
  };

  const rateLimited = () => {
    const error = new Error("RATE_LIMITED");
    (error as Error & { retryAfter?: number }).retryAfter =
      Math.ceil((windowEnd - now) / 1000);
    throw error;
  };

  try {
    const reserved = await db.collection("rate_limits").findOneAndUpdate(
      filter,
      update,
      { upsert: true, returnDocument: "after" }
    );
    if (!reserved) rateLimited();
  } catch (e) {
    // At the limit the upsert filter matches nothing, so Mongo attempts the
    // insert and throws DuplicateKey on the existing window document instead
    // of returning null. Retry without upsert: the document exists, so an
    // exhausted quota resolves to null (RATE_LIMITED) and a lost race to a
    // fresh reservation.
    if ((e as { code?: number }).code !== 11000) throw e;
    const reserved = await db.collection("rate_limits").findOneAndUpdate(
      filter,
      update,
      { returnDocument: "after" }
    );
    if (!reserved) rateLimited();
  }
}
