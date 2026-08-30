/**
 * URL Selection and Ranking (architecture.md §6.2).
 *
 * - Ranks discovered URLs based on:
 *   1. Exact verified identifier in title/snippet
 *   2. Exact verified identifier in URL
 *   3. Serper rank / position
 *   4. Independent query agreement (multi-query co-occurrence)
 *   5. Document-friendly content type (PDF / HTML)
 * - Deduplicates by canonical URL.
 * - Selects top ≤10 URLs for hydration.
 * - Non-selected and non-acceptable URLs remain as snippet-tier discovery results.
 */

import type { DiscoveryResult, SearchIdentifierSet } from "../connectors/types";
import { canonicalizeUrl, isAcceptablePublicUrl } from "./canonicalUrl";

export const MAX_SELECTED_URLS_FOR_HYDRATION = 10;

export interface ScoredDiscoveryResult {
  result: DiscoveryResult;
  canonicalUrl: string;
  score: number;
  isAcceptableForHydration: boolean;
  rejectionReason?: string;
}

export interface SelectionOutcome {
  selectedForHydration: DiscoveryResult[];
  snippetOnlyResults: DiscoveryResult[];
  scoredResults: ScoredDiscoveryResult[];
}

/**
 * Calculates a relevance score for a discovery result.
 */
export function scoreDiscoveryResult(
  result: DiscoveryResult,
  identifiers: SearchIdentifierSet,
  occurrencesInQueries = 1,
): number {
  let score = 0;

  const email = identifiers.email?.toLowerCase().trim();
  const phone = identifiers.phone?.replace(/\D/g, "");
  const username = identifiers.username?.toLowerCase().trim();
  const name = identifiers.name?.toLowerCase().trim();

  const titleAndSnippet = `${result.title} ${result.snippet}`.toLowerCase();
  const urlLower = result.url.toLowerCase();

  // 1. Exact verified identifier in title/snippet
  if (email && titleAndSnippet.includes(email)) score += 100;
  if (phone && phone.length >= 7 && titleAndSnippet.replace(/\D/g, "").includes(phone)) score += 80;
  if (username && titleAndSnippet.includes(username)) score += 60;
  if (name && titleAndSnippet.includes(name)) score += 40;

  // 2. Exact verified identifier in URL
  if (email && urlLower.includes(email)) score += 50;
  if (username && urlLower.includes(username)) score += 50;
  if (name && urlLower.includes(name.replace(/\s+/g, "-"))) score += 30;

  // 3. Serper position bonus (earlier rank = higher score)
  const position = (result.rawMetadata?.position as number) ?? 10;
  score += Math.max(0, 10 - position);

  // 4. Independent query agreement bonus
  if (occurrencesInQueries > 1) {
    score += (occurrencesInQueries - 1) * 20;
  }

  // 5. Content type preference
  if (result.contentType === "application/pdf") {
    score += 15;
  } else if (result.contentType === "text/html") {
    score += 10;
  }

  return score;
}

/**
 * Deduplicates, scores, and selects URLs for hydration.
 */
export function selectUrlsForHydration(
  rawResults: DiscoveryResult[],
  identifiers: SearchIdentifierSet,
  maxSelected = MAX_SELECTED_URLS_FOR_HYDRATION,
): SelectionOutcome {
  // Count frequency across queries
  const urlCounts = new Map<string, number>();
  for (const r of rawResults) {
    const canon = canonicalizeUrl(r.url) ?? r.url;
    urlCounts.set(canon, (urlCounts.get(canon) ?? 0) + 1);
  }

  // Deduplicate by canonical URL
  const uniqueMap = new Map<string, DiscoveryResult>();
  for (const r of rawResults) {
    const canon = canonicalizeUrl(r.url) ?? r.url;
    if (!uniqueMap.has(canon)) {
      uniqueMap.set(canon, r);
    }
  }

  const scored: ScoredDiscoveryResult[] = [];

  for (const [canon, result] of uniqueMap.entries()) {
    const occurrenceCount = urlCounts.get(canon) ?? 1;
    const score = scoreDiscoveryResult(result, identifiers, occurrenceCount);
    const safetyCheck = isAcceptablePublicUrl(result.url);

    scored.push({
      result,
      canonicalUrl: canon,
      score,
      isAcceptableForHydration: safetyCheck.acceptable,
      rejectionReason: safetyCheck.reason,
    });
  }

  // Sort descending by score
  scored.sort((a, b) => b.score - a.score);

  const selectedForHydration: DiscoveryResult[] = [];
  const snippetOnlyResults: DiscoveryResult[] = [];

  for (const item of scored) {
    if (item.isAcceptableForHydration && selectedForHydration.length < maxSelected) {
      selectedForHydration.push(item.result);
    } else {
      snippetOnlyResults.push(item.result);
    }
  }

  return {
    selectedForHydration,
    snippetOnlyResults,
    scoredResults: scored,
  };
}
