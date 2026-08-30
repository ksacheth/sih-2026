/**
 * Canonical URL normalizer (CONTEXT.md §6.1, Dev-2 task 2).
 *
 * Canonical URLs are identity keys: the same page discovered via two
 * slightly different URLs (tracking params, www, http/https, trailing
 * slash) must collapse to one exposure, not two. The normalizer is pure —
 * no network, safe to unit-test and to use from the monitoring
 * fingerprint (lib/monitoring).
 *
 * Non-goals (documented): this is syntactic canonicalization only. It does
 * not follow redirects or resolve DNS — the fetch guard (fetchGuard.ts)
 * owns that, and both sides run before a URL is used as an identity key.
 */

/**
 * Query parameters that never change what a page *is* — analytics and
 * click-tracking IDs. `utm_*` covers the UTM family; the rest are the
 * common cross-site trackers. Conservative by design: a param that could
 * be functional (`id`, `p`, `q`) is kept.
 */
const TRACKING_PARAM_EXACT = new Set([
  "fbclid",
  "gclid",
  "dclid",
  "msclkid",
  "twclid",
  "igshid",
  "mc_cid",
  "mc_eid",
  "yclid",
  "vero_id",
  "wickedid",
  "hsa_cam",
  "hsa_grp",
  "hsa_ad",
  "hsa_src",
  "hsa_tgt",
  "hsa_kw",
  "hsa_mt",
  "hsa_net",
  "hsa_ver",
  "_ga",
  "_gl",
]);

function isTrackingParam(key: string): boolean {
  const lower = key.toLowerCase();
  return lower.startsWith("utm_") || TRACKING_PARAM_EXACT.has(lower);
}

/**
 * Canonical form of `raw`, or null when it is not a parseable http(s) URL.
 *
 * - protocol normalized to https (http is treated as the same page)
 * - `www.` host prefix stripped, host lowercased
 * - tracking params removed, remaining params sorted for a stable key
 * - fragment dropped, default ports dropped, trailing slash removed
 */
export function normalizeUrl(raw: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(raw.trim());
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;

  parsed.protocol = "https:";
  parsed.hash = "";
  parsed.hostname = parsed.hostname.toLowerCase().replace(/^www\./, "");

  const kept = [...parsed.searchParams.entries()].filter(
    ([key]) => !isTrackingParam(key),
  );
  parsed.search = "";
  if (kept.length > 0) {
    kept.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    const params = new URLSearchParams();
    for (const [key, value] of kept) params.append(key, value);
    parsed.search = params.toString();
  }

  if (parsed.pathname.length > 1 && parsed.pathname.endsWith("/")) {
    parsed.pathname = parsed.pathname.replace(/\/+$/, "");
  }
  return parsed.toString();
}
