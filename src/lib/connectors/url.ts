/**
 * Minimal URL helpers shared by connectors.
 *
 * NOTE: full canonical-URL normalization (UTM stripping, protocol
 * unification, fingerprint hashing) lands with the fetch guard in
 * lib/pipeline (Dev-2 task 2). This module only does domain extraction,
 * which connectors need to populate DiscoveryResult.domain.
 */
export function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}
