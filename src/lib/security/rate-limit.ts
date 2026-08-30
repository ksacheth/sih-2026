import { getDb } from "@/lib/models/db";

type Limit = { count: number; windowMs: number };

export async function enforceUserLimit(
  userId: string,
  kind: "scan" | "verification",
  limit: Limit
) {
  const db = await getDb();
  const now = new Date();
  const since = new Date(now.getTime() - limit.windowMs);

  const count = await db.collection(kind === "scan" ? "scans" : "verification_codes")
    .countDocuments({ userId, createdAt: { $gte: since } });

  if (count >= limit.count) {
    const error = new Error("RATE_LIMITED");
    (error as Error & { retryAfter?: number }).retryAfter =
      Math.ceil((since.getTime() + limit.windowMs - now.getTime()) / 1000);
    throw error;
  }
}
