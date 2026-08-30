/**
 * Exposure fingerprint generator (CONTEXT.md §12.1, Dev-2 task 4).
 *
 *   fingerprint = SHA256(identity_id + normalized_source + exposure_type
 *                         + normalized_entity)
 *
 * The identity_id is inside the hash so two users monitoring the same
 * value never corrupt each other's monitoring state. Canonical URL
 * normalization (lib/pipeline/url) keeps dedup honest: the same page
 * reached via a tracking-param-laden variant must hash identically.
 */
import { sha256 } from "@/lib/security/crypto";
import { normalizeUrl } from "@/lib/pipeline/url";

/** Field separator that cannot appear in any normalized component. */
const SEPARATOR = "\u0000";

/**
 * Normalize an entity value for fingerprinting.
 * - URLs go through the canonical URL normalizer (UTM stripping, www,
 *   protocol unification) so the same page hashes identically however it
 *   was discovered.
 * - Other entities (emails, usernames, breach names) are trimmed and
 *   lowercased, matching identifier normalization elsewhere in the app.
 */
export function normalizeEntity(entity: string): string {
  const trimmed = entity.trim();
  const asUrl = normalizeUrl(trimmed);
  if (asUrl) return asUrl;
  return trimmed.trim().toLowerCase();
}

export interface FingerprintInput {
  identityId: string;
  source: string;
  exposureType: string;
  /** Canonical URL, email, username, or breach name — normalized internally. */
  entity: string;
}

export function exposureFingerprint(input: FingerprintInput): string {
  const parts = [
    input.identityId,
    input.source.trim().toLowerCase(),
    input.exposureType.trim().toUpperCase(),
    normalizeEntity(input.entity),
  ];
  // Plain SHA-256 (not keyed): fingerprints must be stable across
  // environments so re-scans after a deploy recognize prior exposures.
  return sha256(parts.join(SEPARATOR));
}
