/**
 * ExposedOrNot (xposedornot.com) breach intelligence connector (CONTEXT.md §5.3).
 *
 * Free/keyless primary breach source. Endpoints used:
 *   - GET {base}/check-email/<email>          → breach names ([[ "A", "B", ... ]])
 *   - GET {base}/breach-analytics?email=...   → BreachMetrics (risk, passwords_strength,
 *                                               per-breach details when populated)
 *
 * Behavior contract (§5.3 / user stories 5–6):
 * - "Not found" is a genuine clean result → [] (status ok, not PARTIAL).
 * - Network/HTTP failures throw ConnectorError; the pipeline's runConnector()
 *   converts that into an "unavailable" outcome contributing to a PARTIAL
 *   scan — never a fabricated clean result, never a crash.
 * - Dumps that include password material are tagged CREDENTIAL_EXPOSURE via
 *   rawMetadata.signals. The indicator comes from breach metadata only.
 * - No raw email is ever written into a result field (§11.4).
 */
import {
  fixturesEnabled,
  pickExposedOrNotFixture,
  type EonBreachAnalyticsResponse,
  type EonCheckEmailResponse,
} from "./fixtures";
import {
  CREDENTIAL_EXPOSURE_SIGNAL,
  ConnectorError,
  type DiscoveryConnector,
  type DiscoveryResult,
} from "./types";

const API_BASE = process.env.EXPOSEDORNOT_API_URL ?? "https://api.xposedornot.com/v1";
const SITE_URL = "https://xposedornot.com";
const EON_DOMAIN = "xposedornot.com";
const EON_TIMEOUT_MS = 15_000;
/** Per-scan budget: cap breach records emitted per email (§5.6 spirit). */
export const MAX_BREACH_RESULTS = 25;

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PASSWORDISH = /password/i;

export const exposedOrNotConnector: DiscoveryConnector = {
  source: "exposedornot",
  async search(query: string): Promise<DiscoveryResult[]> {
    const email = query.trim();
    if (!EMAIL_SHAPE.test(email)) {
      throw new ConnectorError("bad_request", "exposedornot connector requires an email query");
    }

    if (fixturesEnabled()) {
      const fixture = pickExposedOrNotFixture(email);
      const parsed = parseCheckEmail(fixture.checkEmail);
      if (!parsed.found) return [];
      const metrics = parseBreachMetrics(fixture.breachAnalytics ?? null);
      return buildBreachResults(parsed.names, metrics);
    }

    const checkEmail = await fetchCheckEmail(email);
    const parsed = parseCheckEmail(checkEmail);
    if (!parsed.found) return []; // API answered: genuinely no breach records

    // Aggregate metrics are best-effort enrichment; a failure here must not
    // drop the breach names we already have.
    let metrics: ParsedBreachMetrics | null = null;
    try {
      metrics = parseBreachMetrics(await fetchBreachAnalytics(email));
    } catch {
      metrics = null;
    }
    return buildBreachResults(parsed.names, metrics);
  },
};

// ---- Raw API access (fixture-or-live branches live here, not in parsing) --

export async function fetchCheckEmail(email: string): Promise<EonCheckEmailResponse> {
  const url = `${API_BASE}/check-email/${encodeURIComponent(email)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(EON_TIMEOUT_MS) });
  if (!res.ok) {
    throw new ConnectorError("bad_response", `exposedornot check-email responded ${res.status}`);
  }
  return (await res.json()) as EonCheckEmailResponse;
}

export async function fetchBreachAnalytics(email: string): Promise<EonBreachAnalyticsResponse> {
  const url = `${API_BASE}/breach-analytics?email=${encodeURIComponent(email)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(EON_TIMEOUT_MS) });
  if (!res.ok) {
    throw new ConnectorError("bad_response", `exposedornot analytics responded ${res.status}`);
  }
  return (await res.json()) as EonBreachAnalyticsResponse;
}

// ---- Parsing (pure, unit-testable) ----------------------------------------

export interface ParsedBreachMetrics {
  /** Per-breach metadata keyed by lowercase breach name, when provided. */
  details: Map<string, { date?: string; dataClasses: string[] }>;
  /** Aggregate: at least one dump for this email included password material. */
  aggregateCredentialExposure: boolean;
  riskLabel?: string;
}

export function parseCheckEmail(raw: EonCheckEmailResponse): {
  found: boolean;
  names: string[];
} {
  if (raw.Error || !Array.isArray(raw.breaches)) return { found: false, names: [] };
  const names = raw.breaches
    .flat()
    .filter((n): n is string => typeof n === "string" && n.trim().length > 0);
  return { found: names.length > 0, names };
}

export function parseBreachMetrics(raw: EonBreachAnalyticsResponse | null): ParsedBreachMetrics {
  const metrics = raw?.BreachMetrics ?? raw?.breach_metrics ?? null;

  const details = new Map<string, { date?: string; dataClasses: string[] }>();
  for (const entry of metrics?.get_details ?? []) {
    const name = pickString(entry, "name", "breach", "title");
    if (!name) continue;
    details.set(name.toLowerCase(), {
      date: pickString(entry, "xposed_date", "breach_date", "date") ?? undefined,
      dataClasses: pickStringArray(entry, "xposed_data", "data_classes", "dataClasses") ?? [],
    });
  }

  const passwords = metrics?.passwords_strength ?? {};
  const aggregateCredentialExposure =
    (passwords["PlainText"] ?? 0) > 0 || (passwords["EasyToCrack"] ?? 0) > 0;

  return {
    details,
    aggregateCredentialExposure,
    riskLabel: metrics?.risk?.[0]?.risk_label,
  };
}

export function buildBreachResults(
  names: string[],
  metrics: ParsedBreachMetrics | null,
): DiscoveryResult[] {
  const discoveredAt = new Date().toISOString();
  const aggregateCredential = metrics?.aggregateCredentialExposure ?? false;
  const riskLabel = metrics?.riskLabel;

  return names.slice(0, MAX_BREACH_RESULTS).map((name) => {
    const detail = metrics?.details.get(name.toLowerCase());
    const dataClasses = detail?.dataClasses ?? [];
    // Per-breach metadata is authoritative when the provider supplies it;
    // the aggregate only covers name-only provider data.
    const credentialExposure = detail
      ? dataClasses.some((c) => PASSWORDISH.test(c))
      : aggregateCredential;
    return {
      source: "exposedornot" as const,
      sourceId: name,
      url: SITE_URL,
      domain: EON_DOMAIN,
      title: `Breach record: ${name}`,
      snippet:
        `Email address appears in the "${name}" breach record.` +
        (dataClasses.length > 0 ? ` Exposed data: ${dataClasses.join(", ")}.` : ""),
      discoveredAt,
      contentType: "breach_record" as const,
      evidenceTier: "document" as const,
      rawMetadata: {
        breachName: name,
        breachDate: detail?.date,
        dataClasses,
        credentialExposure,
        signals: credentialExposure ? [CREDENTIAL_EXPOSURE_SIGNAL] : [],
        totalBreaches: names.length,
        riskLabel,
        provider: "xposedornot",
      },
    } satisfies DiscoveryResult;
  });
}

// ---- helpers over loosely-typed API payloads ------------------------------

function pickString(obj: Record<string, unknown>, ...keys: string[]): string | null {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v.trim()) return v;
  }
  return null;
}

function pickStringArray(obj: Record<string, unknown>, ...keys: string[]): string[] | null {
  for (const k of keys) {
    const v = obj[k];
    if (Array.isArray(v)) {
      const strings = v.filter((x): x is string => typeof x === "string" && x.trim().length > 0);
      if (strings.length > 0) return strings;
    }
  }
  return null;
}
