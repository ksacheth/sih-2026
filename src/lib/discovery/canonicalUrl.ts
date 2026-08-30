/**
 * Canonical URL Normalization and URL Acceptance Safety Gate (architecture.md §6.1).
 *
 * - Normalizes scheme, hostname, default ports, trailing slashes, and fragments.
 * - Strips marketing and analytics tracking parameters while preserving meaningful query parameters.
 * - Enforces SSRF and safety boundaries: accepts only public http/https targets;
 *   rejects loopback, private IP literals, link-local, cloud metadata, and credential-bearing URLs.
 * - Checks against login-walled / blocked domains.
 */

const TRACKING_PARAM_PREFIXES = ["utm_", "mc_"];
const TRACKING_PARAM_NAMES = new Set([
  "gclid",
  "fbclid",
  "msclkid",
  "mc_eid",
  "_ga",
  "_gl",
  "ref",
  "ref_src",
  "trk",
  "igshid",
  "si",
  "feature",
]);

const BLOCKED_DOMAINS = new Set([
  "facebook.com",
  "www.facebook.com",
  "m.facebook.com",
  "instagram.com",
  "www.instagram.com",
  "linkedin.com",
  "www.linkedin.com",
  "twitter.com",
  "www.twitter.com",
  "x.com",
  "www.x.com",
  "tiktok.com",
  "www.tiktok.com",
  "pinterest.com",
  "www.pinterest.com",
  "snapchat.com",
  "www.snapchat.com",
]);

/**
 * Checks if a hostname or IP is a private/local/metadata non-public target.
 */
export function isPrivateOrLocalHost(hostname: string): boolean {
  const host = hostname.toLowerCase().trim();

  // Basic hostnames
  if (
    host === "localhost" ||
    host.endsWith(".local") ||
    host.endsWith(".localhost") ||
    host.endsWith(".internal")
  ) {
    return true;
  }

  // IPv4 checks
  // 127.0.0.0/8 (Loopback)
  if (/^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
  // 10.0.0.0/8 (Private)
  if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
  // 172.16.0.0/12 (Private: 172.16 - 172.31)
  const match172 = host.match(/^172\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/);
  if (match172) {
    const octet = Number(match172[1]);
    if (octet >= 16 && octet <= 31) return true;
  }
  // 192.168.0.0/16 (Private)
  if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
  // 169.254.0.0/16 (Link-local & AWS/GCP/Azure metadata 169.254.169.254)
  if (/^169\.254\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
  // 0.0.0.0
  if (host === "0.0.0.0" || /^0\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)) return true;

  // IPv6 checks
  if (
    host === "::1" ||
    host === "[::1]" ||
    host === "::" ||
    host === "[::]" ||
    host.startsWith("fe80:") ||
    host.startsWith("[fe80:") ||
    host.startsWith("fc00:") ||
    host.startsWith("[fc00:") ||
    host.startsWith("fd00:") ||
    host.startsWith("[fd00:")
  ) {
    return true;
  }

  return false;
}

/**
 * Checks if a domain is in the blocked / login-walled denylist.
 */
export function isBlockedDomain(hostnameOrUrl: string): boolean {
  try {
    let hostname = hostnameOrUrl.toLowerCase().trim();
    if (hostname.includes("://")) {
      hostname = new URL(hostnameOrUrl).hostname.toLowerCase();
    }
    const cleanHost = hostname.replace(/^www\./, "");
    for (const blocked of BLOCKED_DOMAINS) {
      const cleanBlocked = blocked.replace(/^www\./, "");
      if (cleanHost === cleanBlocked || cleanHost.endsWith(`.${cleanBlocked}`)) {
        return true;
      }
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Validates whether a URL meets the safety requirements for scraping.
 */
export function isAcceptablePublicUrl(rawUrl: string): {
  acceptable: boolean;
  reason?: string;
} {
  if (!rawUrl || typeof rawUrl !== "string" || rawUrl.length > 2048) {
    return { acceptable: false, reason: "URL missing or exceeds maximum length" };
  }

  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { acceptable: false, reason: "Malformed URL" };
  }

  // Scheme check
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { acceptable: false, reason: `Disallowed scheme: ${parsed.protocol}` };
  }

  // Credential check
  if (parsed.username || parsed.password) {
    return { acceptable: false, reason: "URL contains embedded credentials" };
  }

  // Host presence
  if (!parsed.hostname || parsed.hostname.trim().length === 0) {
    return { acceptable: false, reason: "URL missing hostname" };
  }

  // SSRF / Private network check
  if (isPrivateOrLocalHost(parsed.hostname)) {
    return { acceptable: false, reason: "Target is a private/local/metadata network address" };
  }

  // Blocked / login-walled domain check
  if (isBlockedDomain(parsed.hostname)) {
    return { acceptable: false, reason: "Domain is on login-walled/blocked denylist" };
  }

  return { acceptable: true };
}

/**
 * Canonicalizes a URL:
 * - Normalizes scheme (http/https) and host (lowercase).
 * - Strips default ports (80/443).
 * - Strips tracking and analytics parameters.
 * - Sorts remaining query parameters.
 * - Strips trailing slashes from path (except root /).
 * - Drops hash fragments.
 */
export function canonicalizeUrl(rawUrl: string): string | null {
  if (!rawUrl || typeof rawUrl !== "string") return null;

  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    return null;
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return null;
  }

  // Lowercase hostname
  parsed.hostname = parsed.hostname.toLowerCase();

  // Remove default ports
  if (
    (parsed.protocol === "http:" && parsed.port === "80") ||
    (parsed.protocol === "https:" && parsed.port === "443")
  ) {
    parsed.port = "";
  }

  // Remove tracking query parameters
  const entries = Array.from(parsed.searchParams.entries());
  const keptParams: [string, string][] = [];

  for (const [key, value] of entries) {
    const lowerKey = key.toLowerCase();
    const isTracking =
      TRACKING_PARAM_NAMES.has(lowerKey) ||
      TRACKING_PARAM_PREFIXES.some((prefix) => lowerKey.startsWith(prefix));

    if (!isTracking) {
      keptParams.push([key, value]);
    }
  }

  // Sort remaining parameters for deterministic canonicalization
  keptParams.sort(([a], [b]) => a.localeCompare(b));

  parsed.search = "";
  for (const [k, v] of keptParams) {
    parsed.searchParams.append(k, v);
  }

  // Remove hash fragment
  parsed.hash = "";

  // Normalize pathname: strip trailing slash if not root
  if (parsed.pathname.length > 1 && parsed.pathname.endsWith("/")) {
    parsed.pathname = parsed.pathname.slice(0, -1);
  }

  return parsed.toString();
}
