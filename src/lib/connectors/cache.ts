import { createHmac } from "node:crypto";

/**
 * Mongo-backed query cache / quota guard (CONTEXT.md §11.2).
 *
 * - Keys are HMAC-SHA256(source + query): no plaintext identifiers cached.
 * - TTL (6h) is enforced by the TTL index on `createdAt` in models/Cache.ts.
 * - Best-effort by design: if Mongo is unreachable the cache silently misses
 *   and never breaks a scan.
 * - mongoose is imported lazily (dynamic import) so connector unit tests and
 *   fixture-mode runs never pay the driver load; the model itself lives in
 *   models/Cache.ts and is registered lazily on first real use.
 */

export const CACHE_TTL_HOURS = 6;

export function cacheKey(source: string, query: string): string {
  // Platform env template name is HMAC_SECRET (distinct from AUTH_SECRET).
  const secret = process.env.HMAC_SECRET ?? process.env.CACHE_HMAC_SECRET ?? "dev-only-insecure-hmac";
  return createHmac("sha256", secret).update(`${source}:${query}`).digest("hex");
}

let mongooseModulePromise: Promise<typeof import("mongoose")> | null = null;

/** Returns the mongoose module only when a connection is already open. */
async function mongooseIfConnected(): Promise<typeof import("mongoose") | null> {
  if (!mongooseModulePromise) {
    mongooseModulePromise = import("mongoose");
  }
  try {
    const mongoose = await mongooseModulePromise;
    return mongoose.connection.readyState === 1 ? mongoose : null;
  } catch {
    return null;
  }
}

/** Returns the cached payload or null on miss / Mongo unavailability. */
export async function cacheGet<T>(source: string, query: string): Promise<T | null> {
  const mongoose = await mongooseIfConnected();
  if (!mongoose) return null;
  try {
    const { default: CacheModel } = await import("../models/Cache");
    const doc = await CacheModel.findOne({ key: cacheKey(source, query) }).lean();
    return doc ? ((doc.payload as T) ?? null) : null;
  } catch {
    return null; // cache miss on any storage error
  }
}

/** Best-effort write; failures are swallowed — a cache must never fail a scan. */
export async function cacheSet(source: string, query: string, payload: unknown): Promise<void> {
  const mongoose = await mongooseIfConnected();
  if (!mongoose) return;
  try {
    const { default: CacheModel } = await import("../models/Cache");
    await CacheModel.updateOne(
      { key: cacheKey(source, query) },
      {
        $set: { payload },
        $setOnInsert: { source, createdAt: new Date() },
      },
      { upsert: true },
    );
  } catch {
    // Swallow: cache writes must never break a scan.
  }
}
