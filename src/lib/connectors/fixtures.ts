/**
 * Fixture player (§14.4 failure protocol).
 *
 * When FIXTURES=1 (or a connector's API key is missing), connectors route to
 * the team's recorded JSON datasets in data/fixtures/ instead of live APIs.
 * Replay is transparent: connectors parse recorded payloads through the
 * exact same mapping code used for live responses.
 *
 * Canonical dataset shapes (owned by the dataset contributor, v2):
 *   - serper_response.json:       { searches: [{ person_id, person_name, query, results: [...] }] }
 *   - exposedornot_response.json: { breaches: [per-person breach records], summary }
 *
 * This player adapts those shapes to the raw API payloads each connector
 * parses, so live and replayed data share one parsing path.
 */
import serperFixtureJson from "../../../data/fixtures/serper_response.json";
import exposedOrNotFixtureJson from "../../../data/fixtures/exposedornot_response.json";

export function fixturesEnabled(): boolean {
  return process.env.FIXTURES === "1";
}

/**
 * True when the connector should serve fixtures instead of live calls:
 * explicitly via FIXTURES=1, or automatically when the connector's API key
 * is missing/empty. Pass the key VALUE (e.g. process.env.SERPER_API_KEY);
 * keyless connectors call fixturesEnabled() directly.
 */
export function shouldUseFixtures(apiKey?: string | undefined): boolean {
  return fixturesEnabled() || !apiKey;
}

// ---- recorded dataset envelopes (data/fixtures/*) ---------------------------

/** One recorded Serper search: the planned query and its organic results. */
interface SerperFixtureSearch {
  person_id?: string;
  person_name?: string;
  query: string;
  results: SerperRecordResult[];
}

interface SerperRecordResult {
  title?: string;
  url?: string;
  snippet?: string;
  source?: string;
  source_id?: string;
  discovered_at?: string;
  confidence?: number;
  evidence_tier?: string;
  position?: number;
}

/** Per-person breach record as recorded by the dataset generator. */
export interface EonBreachRecord {
  person_id?: string;
  person_name?: string;
  email?: string;
  breach_name?: string;
  exposure_type?: string;
  severity?: string;
  passwords_included?: boolean;
  confidence?: number;
  occurred_at?: string;
  record_count?: number;
  status?: string;
}

interface ExposedOrNotFixtureFile {
  breaches?: EonBreachRecord[];
  summary?: Record<string, unknown>;
}

const serperFixture = serperFixtureJson as unknown as { searches?: SerperFixtureSearch[] };
const exposedOrNotFixture = exposedOrNotFixtureJson as unknown as ExposedOrNotFixtureFile;

// ---- raw API response shapes (live and replayed share these) ----------------

export interface SerperOrganicItem {
  title?: string;
  link?: string;
  snippet?: string;
  date?: string;
  position?: number;
  /** Recorded-only provenance, surfaced through rawMetadata. */
  sourceId?: string;
  confidence?: number;
  evidence_tier?: string;
}

/** Shape the serper connector's mapSerperResponse() consumes. */
export interface SerperFixtureResponse {
  organic?: SerperOrganicItem[];
}

export interface SerperSearchResponse {
  organic?: SerperOrganicItem[];
}

export interface EonCheckEmailResponse {
  breaches?: string[][];
  Error?: string;
  email?: string | null;
}

export interface EonBreachAnalyticsResponse {
  BreachMetrics?: {
    get_details?: Array<Record<string, unknown>>;
    passwords_strength?: Record<string, number>;
    risk?: { risk_label?: string; risk_score?: number }[];
  };
  breach_metrics?: EonBreachAnalyticsResponse["BreachMetrics"];
}

export interface ExposedOrNotFixtureResponse {
  checkEmail: EonCheckEmailResponse;
  breachAnalytics?: EonBreachAnalyticsResponse | null;
}

// ---- serper player ----------------------------------------------------------

function normalizeQuery(q: string): string {
  return q.replace(/["']/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * Resolves the recorded search for a planned query — exact match first,
 * then containment fallback — and returns the results in the raw Serper
 * organic shape the connector maps (title/link/snippet/date/position).
 */
export function pickSerperFixture(query: string): SerperFixtureResponse {
  const key = normalizeQuery(query);
  if (!key) return { organic: [] };
  const searches = serperFixture.searches ?? [];
  const exact = searches.find((s) => normalizeQuery(s.query) === key);
  const partial = searches.find((s) => {
    const q = normalizeQuery(s.query);
    return q.length > 0 && (q.includes(key) || key.includes(q));
  });
  const results = (exact ?? partial)?.results ?? [];
  return {
    organic: results.map((r, i) => ({
      title: r.title,
      link: r.url,
      snippet: r.snippet,
      date: r.discovered_at,
      position: r.position ?? i + 1,
      sourceId: r.source_id,
      confidence: r.confidence,
      evidence_tier: r.evidence_tier,
    })),
  };
}

// ---- exposedornot player ----------------------------------------------------

/**
 * Synthesizes the two raw API payloads the connector parses (check-email +
 * breach-analytics) from the recorded per-person breach records. This keeps
 * exposedOrNot.ts's parsing as the single source of truth for live and
 * replayed data.
 */
export function pickExposedOrNotFixture(email: string): ExposedOrNotFixtureResponse {
  const records = (exposedOrNotFixture.breaches ?? []).filter(
    (b) => (b.email ?? "").toLowerCase() === email.trim().toLowerCase(),
  );
  if (records.length === 0) {
    return { checkEmail: { Error: "Not found", email: null } };
  }
  return {
    checkEmail: { breaches: [uniqueBreachNames(records)] },
    breachAnalytics: synthesizeAnalytics(records),
  };
}

function uniqueBreachNames(records: EonBreachRecord[]): string[] {
  return [
    ...new Set(
      records
        .map((r) => r.breach_name)
        .filter((n): n is string => typeof n === "string" && n.trim().length > 0),
    ),
  ];
}

/** Exposure classification → exposed data classes for breach analytics. */
function dataClassesFor(record: EonBreachRecord): string[] {
  const classes = ["Email addresses"];
  if (record.passwords_included || record.exposure_type === "CREDENTIAL_EXPOSURE") {
    classes.push("Passwords");
  }
  if (record.exposure_type === "API_KEY_EXPOSURE") {
    classes.push("API keys");
  }
  return classes;
}

function synthesizeAnalytics(records: EonBreachRecord[]): EonBreachAnalyticsResponse {
  const passwordCount = records.filter((r) => r.passwords_included === true).length;
  return {
    BreachMetrics: {
      get_details: records.map((r) => ({
        name: r.breach_name,
        xposed_date: r.occurred_at,
        xposed_records: r.record_count,
        xposed_data: dataClassesFor(r),
      })),
      passwords_strength: {
        PlainText: passwordCount,
        EasyToCrack: 0,
        StrongHash: 0,
        Unknown: Math.max(records.length - passwordCount, 0),
      },
      risk: [
        {
          risk_label: riskLabelFor(records),
          risk_score: Math.round((records[0]?.confidence ?? 0) * 100),
        },
      ],
    },
  };
}

function severityRank(severity?: string): number {
  const s = severity?.toLowerCase();
  return s === "critical" ? 3 : s === "high" ? 2 : s === "medium" ? 1 : 0;
}

function riskLabelFor(records: EonBreachRecord[]): string | undefined {
  const worst = [...records].sort(
    (a, b) => severityRank(b.severity) - severityRank(a.severity),
  )[0];
  const label = worst?.severity?.toLowerCase();
  return label ? label.charAt(0).toUpperCase() + label.slice(1) : undefined;
}

// ---- connector-facing fixture response types -------------------------------

export interface EonFixtureResponse {
  checkEmail: EonCheckEmailResponse;
  breachAnalytics?: EonBreachAnalyticsResponse | null;
}

// ---- firecrawl player -------------------------------------------------------

import firecrawlFixtureJson from "../../../data/fixtures/firecrawl_response.json";

export interface FirecrawlScrapeResponse {
  success?: boolean;
  data?: {
    markdown?: string;
    title?: string;
    metadata?: {
      title?: string;
      description?: string;
      language?: string;
      statusCode?: number;
      contentType?: string;
      [key: string]: unknown;
    };
    [key: string]: unknown;
  };
  error?: string;
}

interface FirecrawlFixtureDocument {
  url: string;
  success?: boolean;
  data?: {
    markdown?: string;
    title?: string;
    metadata?: Record<string, unknown>;
  };
  error?: string;
}

const firecrawlFixture = firecrawlFixtureJson as unknown as {
  documents?: FirecrawlFixtureDocument[];
};

/**
 * Resolves the recorded Firecrawl response for a given target URL.
 */
export function pickFirecrawlFixture(url: string): FirecrawlScrapeResponse | null {
  const norm = url.trim().toLowerCase().replace(/\/+$/, "");
  if (!norm) return null;
  const docs = firecrawlFixture.documents ?? [];
  const exact = docs.find((d) => d.url.trim().toLowerCase().replace(/\/+$/, "") === norm);
  if (exact) {
    return {
      success: exact.success !== false,
      data: exact.data,
      error: exact.error,
    };
  }
  const partial = docs.find((d) => {
    const docNorm = d.url.trim().toLowerCase().replace(/\/+$/, "");
    return docNorm.length > 0 && (norm.includes(docNorm) || docNorm.includes(norm));
  });
  if (partial) {
    return {
      success: partial.success !== false,
      data: partial.data,
      error: partial.error,
    };
  }
  return null;
}

