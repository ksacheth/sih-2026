import fs from "fs";
import path from "path";

export interface BrokerEntry {
  name: string;
  domain: string;
  category: string;
  optOutUrl: string;
  instructions: string;
}

let cachedBrokersMap: Map<string, BrokerEntry> | null = null;

function loadBrokersMap(): Map<string, BrokerEntry> {
  if (cachedBrokersMap) return cachedBrokersMap;

  const map = new Map<string, BrokerEntry>();
  try {
    const filePath = path.resolve(process.cwd(), "data/brokers.json");
    if (fs.existsSync(filePath)) {
      const rawData = fs.readFileSync(filePath, "utf-8");
      const list: BrokerEntry[] = JSON.parse(rawData);
      for (const entry of list) {
        if (entry.domain) {
          const cleanDom = cleanDomain(entry.domain);
          map.set(cleanDom, entry);
        }
      }
    }
  } catch (err) {
    console.error("Failed to load data/brokers.json:", err);
  }

  cachedBrokersMap = map;
  return map;
}

function cleanDomain(input: string): string {
  let domain = input
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "");
  return domain.split("/")[0].split(":")[0]; // strip path and port
}

/**
 * Searches data/brokers.json for a matching domain (CONTEXT.md §5.5).
 * Matches parent domain and subdomains against broker directory list.
 *
 * @param domainOrUrl - Input domain or URL (e.g. "https://www.truecaller.com/search", "fastpeoplesearch.com")
 * @returns Matching BrokerEntry or null if not found
 */
export function lookupBrokerByDomain(domainOrUrl: string): BrokerEntry | null {
  if (!domainOrUrl) return null;
  const target = cleanDomain(domainOrUrl);
  const map = loadBrokersMap();

  // 1. Direct exact domain match
  if (map.has(target)) {
    return map.get(target)!;
  }

  // 2. Check if target ends with any broker domain (e.g. "sub.whitepages.com" -> "whitepages.com")
  for (const [brokerDomain, entry] of map.entries()) {
    if (target.endsWith("." + brokerDomain) || target === brokerDomain) {
      return entry;
    }
  }

  return null;
}
