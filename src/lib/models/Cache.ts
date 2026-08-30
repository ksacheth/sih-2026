import mongoose from "mongoose";

/**
 * TTL-backed provider/query cache (CONTEXT.md §11.2).
 *
 * Keys are HMAC(source + query) digests — no plaintext identifiers are ever
 * cached. The TTL index (6h) bounds retention and protects external API
 * quotas without a separate cache service.
 *
 * Ownership note: infra-level TTL index provisioning belongs to Dev-1's
 * mongo init script; mongoose's autoIndex covers dev/docker-compose runs.
 */
const cacheSchema = new mongoose.Schema({
  // Hex HMAC-SHA256 of `${source}:${query}` — never the plaintext query.
  key: { type: String, required: true, unique: true },
  source: { type: String, required: true },
  payload: { type: mongoose.Schema.Types.Mixed, required: true },
  createdAt: { type: Date, default: Date.now, expires: "6h" },
});

// `unique` on key provides the lookup index; `expires` on createdAt is the TTL.
const CacheModel =
  (mongoose.models.Cache as mongoose.Model<CacheDoc> | undefined) ??
  mongoose.model<CacheDoc>("Cache", cacheSchema);

export interface CacheDoc {
  key: string;
  source: string;
  payload: unknown;
  createdAt: Date;
}

export default CacheModel;
