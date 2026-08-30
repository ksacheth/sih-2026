import { isCommonIndianName } from "./indianNames";

/**
 * Common honorifics and titles to strip during name normalization.
 */
const HONORIFICS = new Set<string>([
  "mr",
  "mrs",
  "ms",
  "miss",
  "dr",
  "prof",
  "er",
  "eng",
  "shri",
  "shrimati",
  "smt",
  "sir",
  "madam",
]);

/**
 * Normalizes a raw name string into clean token sets.
 *
 * Steps:
 * 1. Lowercase and decompose unicode diacritics (e.g., "É" -> "e")
 * 2. Convert dots, hyphens, and punctuation to spaces so initials & compound names split cleanly
 * 3. Strip non-alphanumeric characters
 * 4. Filter out standard honorifics and empty strings
 *
 * @param name - Raw input name string
 * @returns Array of normalized name tokens
 *
 * @example
 * normalizeNameTokens("Dr. R. K. Sharma-Patel") // ["r", "k", "sharma", "patel"]
 */
export function normalizeNameTokens(name: string): string[] {
  if (!name || typeof name !== "string") return [];

  // 1. Lowercase & strip diacritics
  const normalizedStr = name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

  // 2. Replace dots, hyphens, underscores, slashes, and punctuation with spaces
  const cleanedStr = normalizedStr.replace(/[.\-_/\\,;:()@#[\]{}]/g, " ");

  // 3. Remove non-alphanumeric characters except spaces
  const alphaStr = cleanedStr.replace(/[^a-z0-9\s]/g, "");

  // 4. Split by whitespace and filter out honorifics & empty tokens
  const rawTokens = alphaStr.split(/\s+/).filter(Boolean);

  // If stripping honorifics leaves no tokens, keep the raw tokens (e.g. if name is literally "Dr")
  const filteredTokens = rawTokens.filter((t) => !HONORIFICS.has(t));
  return filteredTokens.length > 0 ? filteredTokens : rawTokens;
}

export type TokenPairMatchType = "EXACT" | "INITIAL";

export interface TokenPairMatch {
  tokenA: string;
  tokenB: string;
  matchType: TokenPairMatchType;
  weight: number;
}

export interface NameMatchResult {
  isMatch: boolean;
  similarityScore: number;
  matchType: "EXACT" | "INITIALS_EXPANSION" | "PARTIAL" | "NO_MATCH";
  matchedPairs: TokenPairMatch[];
  unmatchedTokensA: string[];
  unmatchedTokensB: string[];
  isCommonName: boolean;
  hasInitialsMatch: boolean;
  /**
   * HARD RULE (CONTEXT.md §7.3): Name similarity alone can NEVER produce a CONFIRMED match.
   * This flag is always set to true for name matching results to enforce POTENTIAL caps.
   */
  isNameMatchOnlyCap: true;
}

/**
 * Checks whether two individual tokens match (either exactly or via initials expansion).
 *
 * @param tokenA - First token
 * @param tokenB - Second token
 * @returns TokenPairMatchType or null if no match
 */
export function matchSingleTokens(
  tokenA: string,
  tokenB: string,
): TokenPairMatchType | null {
  if (!tokenA || !tokenB) return null;
  if (tokenA === tokenB) return "EXACT";

  const lenA = tokenA.length;
  const lenB = tokenB.length;

  // Initials expansion rule: single letter token matches any token starting with that letter
  if (lenA === 1 && lenB > 1 && tokenB.startsWith(tokenA)) {
    return "INITIAL";
  }
  if (lenB === 1 && lenA > 1 && tokenA.startsWith(tokenB)) {
    return "INITIAL";
  }

  return null;
}

/**
 * Performs token-set matching and initials expansion logic between two names.
 * Compares two names as token sets, resolving initials (e.g., "R. Kumar" ↔ "Rahul Kumar").
 *
 * @param nameA - First name (e.g., monitored user name or candidate extracted name)
 * @param nameB - Second name to compare against
 * @returns Detailed NameMatchResult containing similarity score and breakdown
 */
export function compareNames(nameA: string, nameB: string): NameMatchResult {
  const tokensA = normalizeNameTokens(nameA);
  const tokensB = normalizeNameTokens(nameB);

  if (tokensA.length === 0 || tokensB.length === 0) {
    return {
      isMatch: false,
      similarityScore: 0,
      matchType: "NO_MATCH",
      matchedPairs: [],
      unmatchedTokensA: tokensA,
      unmatchedTokensB: tokensB,
      isCommonName: false,
      hasInitialsMatch: false,
      isNameMatchOnlyCap: true,
    };
  }

  // 1. Perform optimal token bipartite matching
  // Priority 1: EXACT matches
  // Priority 2: INITIAL matches
  const usedA = new Set<number>();
  const usedB = new Set<number>();
  const matchedPairs: TokenPairMatch[] = [];

  // Pass 1: Find all EXACT matches
  for (let i = 0; i < tokensA.length; i++) {
    for (let j = 0; j < tokensB.length; j++) {
      if (usedA.has(i) || usedB.has(j)) continue;
      if (matchSingleTokens(tokensA[i], tokensB[j]) === "EXACT") {
        usedA.add(i);
        usedB.add(j);
        matchedPairs.push({
          tokenA: tokensA[i],
          tokenB: tokensB[j],
          matchType: "EXACT",
          weight: 1.0,
        });
      }
    }
  }

  // Pass 2: Find all INITIAL matches for remaining unmatched tokens
  for (let i = 0; i < tokensA.length; i++) {
    if (usedA.has(i)) continue;
    for (let j = 0; j < tokensB.length; j++) {
      if (usedB.has(j)) continue;
      if (matchSingleTokens(tokensA[i], tokensB[j]) === "INITIAL") {
        usedA.add(i);
        usedB.add(j);
        matchedPairs.push({
          tokenA: tokensA[i],
          tokenB: tokensB[j],
          matchType: "INITIAL",
          weight: 0.85,
        });
      }
    }
  }

  const unmatchedTokensA = tokensA.filter((_, i) => !usedA.has(i));
  const unmatchedTokensB = tokensB.filter((_, j) => !usedB.has(j));

  // 2. Calculate similarity score
  const totalWeight = matchedPairs.reduce((sum, p) => sum + p.weight, 0);
  const maxTokenCount = Math.max(tokensA.length, tokensB.length);
  const minTokenCount = Math.min(tokensA.length, tokensB.length);

  // Score normalized against the max token count
  let similarityScore = maxTokenCount > 0 ? totalWeight / maxTokenCount : 0;

  const hasInitialsMatch = matchedPairs.some((p) => p.matchType === "INITIAL");
  const isAllExact = matchedPairs.length === maxTokenCount && !hasInitialsMatch;

  // A shorter set match is valid if:
  // - All tokens in shorter set matched AND (shorter set has >1 tokens OR the single token is not just an initial matching a multi-word name)
  const isSingleInitialMatchingMultiWord =
    minTokenCount === 1 &&
    maxTokenCount > 1 &&
    matchedPairs.length === 1 &&
    matchedPairs[0].matchType === "INITIAL";

  const shorterSetMatched =
    matchedPairs.length >= minTokenCount &&
    minTokenCount > 0 &&
    !isSingleInitialMatchingMultiWord;

  const isMatch = shorterSetMatched || similarityScore >= 0.7;

  // Determine overall match type
  let matchType: "EXACT" | "INITIALS_EXPANSION" | "PARTIAL" | "NO_MATCH" =
    "NO_MATCH";
  if (isMatch) {
    if (isAllExact) {
      matchType = "EXACT";
    } else if (hasInitialsMatch) {
      matchType = "INITIALS_EXPANSION";
    } else {
      matchType = "PARTIAL";
    }
  }

  // 3. Evaluate Common Indian Name penalty status
  const isCommon = isCommonIndianName(tokensA) || isCommonIndianName(tokensB);

  // Round similarity score to 2 decimal places
  similarityScore = Math.round(similarityScore * 100) / 100;

  return {
    isMatch,
    similarityScore,
    matchType,
    matchedPairs,
    unmatchedTokensA,
    unmatchedTokensB,
    isCommonName: isCommon,
    hasInitialsMatch,
    isNameMatchOnlyCap: true,
  };
}
