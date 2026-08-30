/**
 * Serper.dev web search connector (CONTEXT.md §5.2).
 *
 * - Targeted, not exhaustive: the planner emits ≤6 high-value queries per
 *   scan (exact email, username, name+email, email filetype:pdf, name+org).
 * - Values are sanitized (search operators neutralized) and quoted before
 *   interpolation — a crafted identifier must not skew or waste queries.
 * - Responses are cached in the Mongo TTL collection keyed by
 *   HMAC(source + query) to protect the ~2,500-query free tier (§5.2).
 * - FIXTURES=1 or a missing SERPER_API_KEY transparently serves recorded
 *   responses from data/fixtures/serper_response.json.
 */
import { cacheGet, cacheSet } from "./cache";
import { pickSerperFixture, shouldUseFixtures, type SerperOrganicItem, type SerperSearchResponse } from "./fixtures";
import { ConnectorError, type DiscoveryConnector, type DiscoveryResult, type SearchIdentifierSet } from "./types";
import { extractDomain } from "./url";

const SERPER_ENDPOINT = "https://google.serper.dev/search";
const SERPER_API_KEY_ENV = "SERPER_API_KEY";
const RESULTS_PER_QUERY = 10;
const SERPER_TIMEOUT_MS = 15_000;
export const MAX_QUERIES_PER_SCAN = 6;

// Sanitization strategy: identifier values are always wrapped in our own
// quotes (operators inside quotes are literal terms), user-supplied quotes
// and control characters are stripped, special chars (`:` of site:/inurl:,
// `|`, parens, …) become spaces, and token-leading +/-/~ operators are
// stripped. Interior hyphens survive — they are legitimate in emails and
// usernames (e.g. test-rahul@example.com).
const OPERATOR_CHARS = /[^A-Za-z0-9@._+\s-]/g;
const LEADING_OPERATOR = /(^|\s)[-~]+(?=\S)/g;

export function sanitizeQueryValue(raw: string): string {
  return raw
    .replace(OPERATOR_CHARS, " ")
    .replace(LEADING_OPERATOR, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function quote(value: string): string {
  return `"${value}"`;
}

/**
 * §3.2 targeted query planner. Order matters: exact identifier queries
 * first, then identifier + context compounds. Empty after sanitization
 * means the identifier contributes no query.
 */
export function buildTargetedQueries(ids: SearchIdentifierSet): string[] {
  const email = ids.email ? sanitizeQueryValue(ids.email) : "";
  const username = ids.username ? sanitizeQueryValue(ids.username) : "";
  const name = ids.name ? sanitizeQueryValue(ids.name) : "";
  const org = ids.org ? sanitizeQueryValue(ids.org) : "";

  const candidates: string[] = [];
  if (email) candidates.push(quote(email));
  if (username) candidates.push(quote(username));
  if (name && email) candidates.push(`${quote(name)} ${quote(email)}`);
  if (email) candidates.push(`${quote(email)} filetype:pdf`);
  if (name && org) candidates.push(`${quote(name)} ${quote(org)}`);

  return [...new Set(candidates)].slice(0, MAX_QUERIES_PER_SCAN);
}

function isPdfUrl(url: string): boolean {
  return /\.pdf(\?|#|$)/i.test(url);
}

/** Map a raw (live or recorded) Serper response into DiscoveryResults. */
export function mapSerperResponse(response: SerperSearchResponse): DiscoveryResult[] {
  const discoveredAt = new Date().toISOString();
  return (response.organic ?? [])
    .filter((item): item is SerperOrganicItem & { link: string } => Boolean(item.link))
    .map((item) => {
      const url = item.link;
      return {
        source: "serper" as const,
        sourceId: url,
        url,
        domain: extractDomain(url),
        title: item.title ?? url,
        snippet: item.snippet ?? "",
        discoveredAt,
        contentType: (isPdfUrl(url) ? "application/pdf" : "text/html") as
          | "application/pdf"
          | "text/html",
        evidenceTier: "snippet" as const,
        rawMetadata: {
          position: item.position,
          serperDate: item.date,
          // Recorded-fixture provenance (absent on live responses).
          fixtureSourceId: item.sourceId,
          fixtureConfidence: item.confidence,
          fixtureEvidenceTier: item.evidence_tier,
          // Deliberately no raw query here: queries contain raw identifiers
          // and must never be persisted into evidence metadata (§11.4).
        },
      } satisfies DiscoveryResult;
    });
}

export const serperConnector: DiscoveryConnector = {
  source: "serper",
  async search(query: string): Promise<DiscoveryResult[]> {
    // Contract: search() executes an already-PLANNED query (see
    // buildTargetedQueries) — identifier values are sanitized and quoted
    // there. Only trim here; re-sanitizing would mangle the filetype:pdf
    // operator the planner legitimately appends.
    const planned = query.trim();
    if (!planned) return [];

    if (shouldUseFixtures(process.env[SERPER_API_KEY_ENV])) {
      return mapSerperResponse(pickSerperFixture(planned));
    }

    const apiKey = process.env[SERPER_API_KEY_ENV];
    if (!apiKey) {
      // Unreachable when shouldUseFixtures covers missing keys; kept as an
      // explicit guard for unusual env setups.
      throw new ConnectorError("bad_request", "SERPER_API_KEY missing");
    }

    const cached = await cacheGet<DiscoveryResult[]>("serper", planned);
    if (cached) return cached;

    const res = await fetch(SERPER_ENDPOINT, {
      method: "POST",
      headers: { "X-API-KEY": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ q: planned, num: RESULTS_PER_QUERY }),
      signal: AbortSignal.timeout(SERPER_TIMEOUT_MS),
    });
    if (!res.ok) {
      throw new ConnectorError("bad_response", `serper responded ${res.status}`);
    }
    const data = (await res.json()) as SerperSearchResponse;
    const results = mapSerperResponse(data);
    await cacheSet("serper", planned, results);
    return results;
  },
};
