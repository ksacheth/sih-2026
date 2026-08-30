/**
 * Data broker matcher (CONTEXT.md §5.5).
 *
 * Broker exposure = any discovered result whose domain matches a
 * data/brokers.json entry. No broker-site crawling: the broker listing is
 * derived from an ordinary search result, and the finding surfaces the
 * curated opt-out URL. The catalog is curated by the dataset owner and
 * treated as a fixed input; both the bare-array form and the
 * { brokers: [...] } wrapper are accepted.
 */
import brokerDataJson from "../../../data/brokers.json";
import type { DiscoveryResult } from "./types";
import { extractDomain } from "./url";

export interface BrokerEntry {
  name: string;
  domain: string;
  category?: string;
  optOutUrl?: string;
  instructions?: string;
  /** Optional extra domains (CDNs, regional mirrors) that map to the broker. */
  domains?: string[];
}

const catalogSource = brokerDataJson as unknown as BrokerEntry[] | { brokers?: BrokerEntry[] };

export const brokerCatalog: BrokerEntry[] = Array.isArray(catalogSource)
  ? catalogSource
  : (catalogSource.brokers ?? []);

function normalizeDomain(domain: string): string {
  return domain.trim().toLowerCase().replace(/^www\./, "");
}

/**
 * Match a URL or bare domain against the broker catalog.
 * Accepts either form so the orchestrator can pass DiscoveryResult.domain
 * or a full URL interchangeably.
 */
export function findBrokerMatch(urlOrDomain: string): BrokerEntry | null {
  const host = normalizeDomain(extractDomain(urlOrDomain) || urlOrDomain);
  if (!host) return null;
  for (const entry of brokerCatalog) {
    for (const d of [entry.domain, ...(entry.domains ?? [])]) {
      const normalized = normalizeDomain(d);
      if (host === normalized || host.endsWith(`.${normalized}`)) {
        return entry;
      }
    }
  }
  return null;
}

/** Convenience: curated opt-out URL for a domain, if it is a known broker. */
export function brokerOptOutUrl(urlOrDomain: string): string | null {
  return findBrokerMatch(urlOrDomain)?.optOutUrl ?? null;
}

/**
 * Derive broker-flavored DiscoveryResults from a set of discovered results.
 * One finding per broker; document-tier evidence is preferred when the same
 * broker was discovered multiple times. rawMetadata.broker carries the
 * opt-out URL that the recommendation engine turns into an OPT_OUT_BROKER
 * task (§8.3).
 */
export function findBrokerResults(results: DiscoveryResult[]): DiscoveryResult[] {
  const derived: DiscoveryResult[] = [];
  const seenBrokers = new Set<string>();

  // Prefer document-tier evidence when a broker was discovered more than once.
  const ordered = [...results].sort((a, b) =>
    a.evidenceTier === b.evidenceTier ? 0 : a.evidenceTier === "document" ? -1 : 1,
  );

  for (const result of ordered) {
    if (!result.domain) continue;
    const entry = findBrokerMatch(result.domain);
    if (!entry || seenBrokers.has(entry.name)) continue;
    seenBrokers.add(entry.name);
    derived.push({
      source: "brokers",
      sourceId: `brokers:${entry.domain}`,
      url: result.url,
      domain: result.domain,
      title: `${entry.name} listing: ${result.title}`,
      snippet: result.snippet,
      discoveredAt: result.discoveredAt,
      contentType: result.contentType === "application/pdf" ? "text/html" : result.contentType,
      evidenceTier: result.evidenceTier,
      rawMetadata: {
        broker: {
          name: entry.name,
          category: entry.category,
          optOutUrl: entry.optOutUrl,
          instructions: entry.instructions,
        },
        matchedDomain: entry.domain,
        derivedFrom: result.sourceId,
        derivedFromSource: result.source,
      },
    });
  }
  return derived;
}
