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

  const reserved = await db.collection("rate_limits").findOneAndUpdate(
    { _id: `${userId}:${kind}:${windowStart}`, count: { $lt: limit.count } },
    {
      $inc: { count: 1 },
      $setOnInsert: {
        userId,
        kind,
        windowStart: new Date(windowStart),
        expiresAt: new Date(windowEnd),
      },
    },
    { upsert: true, returnDocument: "after" }
  );

  if (!reserved) {
    const error = new Error("RATE_LIMITED");
    (error as Error & { retryAfter?: number }).retryAfter =
      Math.ceil((windowEnd - now) / 1000);
    throw error;
  }
}
