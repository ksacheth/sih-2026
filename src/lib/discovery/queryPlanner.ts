/**
 * Query Planner for Serper Discovery (architecture.md §5).
 *
 * - Generates ≤6 safe, targeted queries from verified identifiers and context.
 * - Strips and neutralizes search operators from user input before interpolation.
 * - Produces deterministic HMAC cache keys for caching query responses.
 */

import { createHmac } from "crypto";
import type { SearchIdentifierSet } from "../connectors/types";

export const MAX_QUERIES_PER_SCAN = 6;
const DEFAULT_CACHE_SECRET = "exposure_monitor_serper_cache_secret";

// Characters that could manipulate search operators or inject unwanted SERP grammar
const OPERATOR_KEYWORDS = /\b(site|filetype|inurl|intext|intitle|or|and|not):/gi;
const BOOLEAN_KEYWORDS = /\b(OR|AND|NOT)\b/g;
const OPERATOR_CHARS = /[^A-Za-z0-9@._+\s-]/g;
const LEADING_OPERATOR = /(^|\s)[-~+]+(?=\S)/g;

/**
 * Sanitizes an identifier value by removing query-control operators and characters.
 * Quotes and control operators (site:, OR, -, etc.) are neutralized.
 */
export function sanitizeQueryValue(raw: string): string {
  return raw
    .replace(OPERATOR_KEYWORDS, " ")
    .replace(BOOLEAN_KEYWORDS, " ")
    .replace(OPERATOR_CHARS, " ")
    .replace(LEADING_OPERATOR, "$1")
    .replace(/\s+/g, " ")
    .trim();
}


function quote(value: string): string {
  return `"${value}"`;
}

/**
 * Plans a deterministic, high-value query set (architecture.md §5.2).
 * Priority order:
 * 1. "exact email"
 * 2. "exact username"
 * 3. "exact name" "exact email"
 * 4. "exact email" filetype:pdf
 * 5. "exact name" "organization"
 * 6. "exact username" "organization"
 */
export function planTargetedQueries(ids: SearchIdentifierSet): string[] {
  const email = ids.email ? sanitizeQueryValue(ids.email) : "";
  const username = ids.username ? sanitizeQueryValue(ids.username) : "";
  const name = ids.name ? sanitizeQueryValue(ids.name) : "";
  const org = ids.org ? sanitizeQueryValue(ids.org) : "";

  const candidates: string[] = [];

  if (email) {
    candidates.push(quote(email));
  }
  if (username) {
    candidates.push(quote(username));
  }
  if (name && email) {
    candidates.push(`${quote(name)} ${quote(email)}`);
  }
  if (email) {
    candidates.push(`${quote(email)} filetype:pdf`);
  }
  if (name && org) {
    candidates.push(`${quote(name)} ${quote(org)}`);
  }
  if (username && org) {
    candidates.push(`${quote(username)} ${quote(org)}`);
  }

  // Deduplicate and enforce the strict maximum budget of 6 queries
  return Array.from(new Set(candidates)).slice(0, MAX_QUERIES_PER_SCAN);
}

/**
 * Computes an HMAC-SHA256 cache key for a Serper query (architecture.md §5.3).
 */
export function computeSerperCacheKey(
  query: string,
  options?: {
    country?: string;
    language?: string;
    secret?: string;
  },
): string {
  const normalizedQuery = query.trim().toLowerCase();
  const country = options?.country || "in";
  const language = options?.language || "en";
  const secret = options?.secret || process.env.CACHE_SECRET || DEFAULT_CACHE_SECRET;

  const payload = `serper:${normalizedQuery}:${country}:${language}`;
  return createHmac("sha256", secret).update(payload).digest("hex");
}
