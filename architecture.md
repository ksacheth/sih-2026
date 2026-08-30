# Architecture: Serper → Firecrawl → Local Extraction

**Project:** Intelligent Personal Data Exposure Monitor
**Branch:** `client_fusion_engine`
**Scope:** Web discovery with Serper, URL hydration with Firecrawl, and local deterministic/GLiNER extraction
**Status:** Implementation architecture
**Explicit exclusion:** TinyFish is not part of this design, dependency graph, configuration, or fallback path.

---

## 1. Decision Summary

The web pipeline has exactly three stages:

```text
Verified identifier set
        │
        ▼
Serper.dev search                         Discovery only
        │  URLs, titles, snippets
        ▼
URL validation + canonicalization          App-owned safety gate
        │
        ▼
Firecrawl v2 scrape                        Hydrated Markdown/content
        │
        ▼
Local extraction                          Regex/checksum + local GLiNER
        │
        ▼
Fusion → correlation → threat rules       Existing downstream pipeline
```

Responsibilities are intentionally narrow:

| Component | Responsibility | Must not do |
|---|---|---|
| Serper | Find relevant public URLs and return search evidence | Fetch or interpret page bodies |
| Firecrawl | Fetch/render/parse selected public URLs into Markdown | Identify the monitored person or assign risk |
| Local extraction | Detect structured IDs, contextual entities, spans, and provenance | Search the web or call a cloud LLM |
| Fusion/rules | Resolve identity evidence and produce deterministic findings | Treat a provider response as proof by itself |

Serper's search API is used for real-time web discovery. Firecrawl's v2 `scrape` endpoint is used for one selected URL at a time and returns page content in Markdown; the application does not use Firecrawl Search, Crawl, Extract, Agent, Browser, or Interact for this MVP. See the [Firecrawl v2 API introduction](https://docs.firecrawl.dev/api-reference/v2-introduction) and [Scrape endpoint](https://docs.firecrawl.dev/api-reference/endpoint/scrape).

---

## 2. Scope and Non-Goals

### Included

- Serper Google web search with a maximum of six targeted queries per scan.
- Search-result normalization, URL canonicalization, deduplication, ranking, and per-scan budgets.
- Firecrawl v2 synchronous scraping for the highest-value selected URLs.
- Markdown-first content normalization, including Firecrawl PDF parsing where the response is usable.
- Snippet-tier evidence fallback when Firecrawl cannot hydrate a URL.
- Local deterministic extraction from the complete available text.
- Local GLiNER sidecar extraction and fusion using the current `src/lib/extraction` design.
- Fixture mode for deterministic rehearsals and tests.

### Excluded

- TinyFish, TinyFish SDKs, TinyFish MCP tools, or a TinyFish fallback.
- Firecrawl Search or Crawl as a second discovery engine.
- Internet-wide crawling, unrestricted people-search, or private-account access.
- CAPTCHA bypass, authenticated scraping, browser interaction, screenshots, or form submission.
- Sending raw page text to Gemini or another cloud LLM for extraction.
- Storing full scraped documents indefinitely.
- ExposedOrNot, HIBP, Pwned Passwords, broker crawling, or any other discovery provider in this implementation slice.

The broader product may add breach intelligence later, but this connector boundary remains limited to `serper` and `firecrawl` for this implementation.

---

## 3. Runtime Flow

### 3.1 Scan sequence

1. The authenticated scan handler receives only identifier IDs belonging to the current user and verifies that every identifier is `VERIFIED` or allowed phone `ATTESTED`.
2. The query planner creates a small, deterministic set of Serper queries from the verified identifier set and optional context.
3. Serper requests run under the per-scan query budget. Organic results are normalized into `DiscoveryResult` records and persisted incrementally.
4. URLs are canonicalized, validated as public `http`/`https` URLs, deduplicated, and ranked. Login-walled or unsupported domains are not sent to Firecrawl.
5. The pipeline selects at most ten URLs for hydration. Firecrawl requests run with bounded concurrency and per-request deadlines.
6. A successful Firecrawl response becomes document-tier evidence. A denied, failed, timed-out, rate-limited, or malformed response preserves the Serper title/snippet as snippet-tier evidence.
7. Local deterministic validators run over the complete available Markdown/snippet text. The local GLiNER sidecar receives only the bounded text passed to the extraction client.
8. Fusion merges deterministic and GLiNER candidates. Deterministic confidence remains authoritative for structured identifiers.
9. Downstream correlation, severity, recommendations, monitoring, and redacted explanations consume only the normalized internal records.
10. Any provider or extraction degradation is visible in per-stage status and makes the scan `PARTIAL`; it can never become a clean result merely because a provider returned zero records.

### 3.2 Sequence diagram

```text
Client        Scan API       Serper        Firecrawl       Local extraction      Mongo
  │              │              │              │                  │                │
  │ POST /scan   │              │              │                  │                │
  │─────────────>│              │              │                  │                │
  │ 202 scan_id  │              │              │                  │                │
  │<─────────────│              │              │                  │                │
  │              │ search(q)   │              │                  │                │
  │              │─────────────>│              │                  │                │
  │              │ results      │              │                  │                │
  │              │<─────────────│              │                  │                │
  │              │ persist discovery results  │                  │                │
  │              │───────────────────────────────────────────────────────────────>│
  │              │ scrape(url)                 │                  │                │
  │              │─────────────────────────────>│                  │                │
  │              │ Markdown / error             │                  │                │
  │              │<─────────────────────────────│                  │                │
  │              │ extract(text)                                  │                │
  │              │───────────────────────────────────────────────>│                │
  │              │ fused entities                               │                │
  │              │<───────────────────────────────────────────────│                │
  │              │ persist evidence/findings                    │                │
  │              │───────────────────────────────────────────────────────────────>│
  │ poll status  │              │              │                  │                │
  │─────────────>│              │              │                  │                │
```

---

## 4. Provider Contracts

### 4.1 Common provider result

Provider adapters return internal records, not provider-shaped objects. The rest of the pipeline never imports a Serper or Firecrawl SDK type.

```ts
export type ProviderStatus =
  | "completed"
  | "partial"
  | "rate_limited"
  | "unavailable"
  | "invalid_response";

export interface ProviderError {
  code: string;             // safe code, never raw response body
  retryable: boolean;
  statusCode?: number;
}
```

### 4.2 Serper discovery contract

```ts
export interface SearchRequest {
  query: string;
  page?: number;
  country?: string;         // default: "in"
  language?: string;        // default: "en"
}

export interface DiscoveryResult {
  source: "serper";
  sourceId: string;         // stable hash of canonical URL + query position
  queryHash: string;        // HMAC, never the raw query
  url: string;
  canonicalUrl: string;
  domain: string;
  title: string;
  snippet: string;
  rank: number;
  discoveredAt: string;
  evidenceTier: "snippet";
}

export interface SearchResponse {
  status: ProviderStatus;
  results: DiscoveryResult[];
  error?: ProviderError;
}
```

The adapter should parse Serper's organic result shape (`title`, `link`, `snippet`, `position`) and ignore unrelated SERP sections. The API key is sent only server-side using the provider's documented authentication mechanism. Keep the adapter behind `src/lib/connectors/serper.ts`; no page-fetch logic belongs in it.

Reference: [Serper](https://serper.dev/).

### 4.3 Firecrawl hydration contract

```ts
export interface HydrateRequest {
  url: string;
  canonicalUrl: string;
}

export interface HydratedDocument {
  source: "firecrawl";
  sourceId: string;         // hash of canonical URL
  url: string;
  canonicalUrl: string;
  domain: string;
  title?: string;
  markdown: string;
  contentType?: "text/html" | "application/pdf" | "text/plain";
  retrievedAt: string;
  evidenceTier: "document";
  contentHash: string;
  providerRequestId?: string;
}

export interface HydrateResponse {
  status: ProviderStatus;
  document?: HydratedDocument;
  error?: ProviderError;
}
```

The adapter calls Firecrawl v2 `POST https://api.firecrawl.dev/v2/scrape` with a server-side Bearer key. The MVP request should be Markdown-first and avoid unnecessary data collection:

```json
{
  "url": "https://public.example/profile",
  "formats": ["markdown"],
  "onlyMainContent": true,
  "removeBase64Images": true,
  "blockAds": true,
  "storeInCache": false,
  "timeout": 30000
}
```

Operational notes:

- Do not enable screenshots, actions, browser interaction, or JSON extraction for this slice.
- Use `parsers: ["pdf"]` only when PDF parsing is needed and the response is within the page/content budget.
- `storeInCache: false` is the default privacy posture for user-triggered scans. `zeroDataRetention` may be enabled only if the configured Firecrawl account supports it; it is not assumed by the application.
- Validate `success`, `data`, `data.markdown`, and response size before constructing `HydratedDocument`.
- Preserve the original Serper result even when Firecrawl fails; the fallback is not fabricated content.

---

## 5. Query Planning and Search Safety

### 5.1 Query inputs

Only verified/attested identifiers and user-provided context already accepted by the scan API may enter the planner:

- Email: exact quoted search.
- Username: exact quoted search.
- Phone: normalized form and, only when policy allows, a masked/alternate representation suitable for discovery.
- Name: only with a corroborating verified identifier or explicit organization/location context.
- Organization/location: context terms, never a standalone people-search query.

The planner must not add arbitrary user text directly as a SERP operator. Strip or escape `site:`, `filetype:`, `OR`, `-`, quotes, and other query-control syntax from identifier values before interpolation. The planner owns the allowed operators.

### 5.2 Maximum query set

Use at most six queries per scan, deduplicated after normalization. A baseline plan is:

```text
1. "exact email"
2. "exact username"
3. "exact name" "exact email"
4. "exact email" filetype:pdf
5. "exact name" "organization"
6. "exact username" "organization"
```

Omit queries whose inputs are unavailable. Never generate an unbounded Cartesian product of identifiers and context.

### 5.3 Search caching and accounting

- Cache key: `HMAC-SHA256(cacheSecret, "serper:" + normalizedQuery + country + language)`.
- TTL: six hours for discovery results.
- Store query hashes, result metadata, and canonical URLs; do not store raw identifiers in cache keys or logs.
- Count every provider request against the per-scan budget even if a retry is attempted.
- In fixture mode, no network request is allowed and the fixture response must be labeled as synthetic.

---

## 6. URL Selection and Firecrawl Safety Gate

Firecrawl fetches the URL remotely, but the application still validates every URL before sending it.

### 6.1 URL acceptance rules

Accept only:

- `http:` or `https:` URLs.
- URLs with a public hostname and no embedded username/password.
- URLs whose canonicalized host is not on the login-walled/blocked-domain denylist.

Reject:

- `file:`, `data:`, `javascript:`, `about:`, and other non-web schemes.
- `localhost`, `.local`, loopback, link-local, private, multicast, and metadata-service IP literals.
- URLs with invalid ports, control characters, or excessive length.
- Known login-walled domains when the result is not useful as public snippet evidence.

The canonicalizer should strip tracking parameters (`utm_*`, `gclid`, `fbclid`), normalize the hostname, remove a default port, normalize the trailing slash, and preserve meaningful path/query parameters. Do not drop all query parameters blindly because some public documents use them for identity or content selection.

### 6.2 Ranking and selection

Rank normalized results using:

1. Exact verified identifier in title/snippet.
2. Exact verified identifier in URL.
3. Serper rank.
4. Independent query agreement.
5. Document-friendly content type (`text/html`, PDF).

Select at most ten unique canonical URLs per scan. Keep all unselected results as discovery evidence if storage allows, but never hydrate them automatically.

### 6.3 Concurrency and budgets

| Budget | Value | Behavior |
|---|---:|---|
| Serper queries/scan | 6 | Stop creating queries after the limit |
| URLs hydrated/scan | 10 | Remaining results stay snippet-tier |
| Firecrawl concurrency | 3 | Queue excess URLs |
| Firecrawl request timeout | 30s | Abort locally; retain snippet fallback |
| Firecrawl retry | 1 | Only bounded retry for 408/429/5xx |
| Retry delay | ≤2s | Respect `Retry-After` only within the scan deadline |
| Total scan soft deadline | 90s | Stop starting new work; persist completed work |

The pipeline must never retry a failed page indefinitely or turn a provider outage into an empty clean result.

---

## 7. Content Normalization and Evidence Tiers

### 7.1 Firecrawl document normalization

Convert a successful Firecrawl response into the existing normalized document shape:

```ts
export interface NormalizedDocument {
  documentId: string;
  sourceUrl: string;
  canonicalUrl: string;
  domain: string;
  contentType: string;
  title: string;
  text: string;             // Markdown converted to bounded plain text if needed
  contentHash: string;
  retrievedAt: string;
  evidenceTier: "document" | "snippet";
}
```

Normalization rules:

- Prefer `data.markdown`; remove navigation boilerplate only if this does not change offsets needed by the extractor.
- Preserve the exact text passed to local extraction so offsets can be verified with `text.slice(start, end) === rawValue`.
- Cap retained text before extraction. Deterministic validators may inspect the full bounded page; GLiNER receives its own documented cap and reports truncation/partial state.
- Remove base64 image payloads and binary data. OCR is not part of this architecture.
- Hash content with SHA-256 for deduplication and monitoring. Do not use raw content as a cache key.
- Store minimal metadata plus a justified evidence excerpt; do not persist entire Markdown indefinitely.

### 7.2 Snippet fallback

When Firecrawl cannot hydrate a URL, construct a snippet-tier normalized document from the Serper title and snippet:

```text
title + "\n" + snippet
```

The record must include:

- `evidenceTier: "snippet"`;
- the original Serper URL and discovery timestamp;
- `evidenceConfidence` lower than document-tier evidence;
- a safe provider error code such as `FIRECRAWL_TIMEOUT`, `FIRECRAWL_429`, or `FIRECRAWL_INVALID_RESPONSE`.

Never replace a failed Firecrawl result with invented page text. A snippet can produce a lead, but a snippet-only match must not receive document-level confidence.

### 7.3 Provider status semantics

| Event | Evidence retained | Scan status |
|---|---|---|
| Serper success + Firecrawl success | Document + discovery metadata | May complete |
| Serper success + Firecrawl failure | Snippet + failure code | `PARTIAL` |
| Serper rate-limited/unavailable | No new URLs; previous data retained | `PARTIAL` |
| Firecrawl returns empty usable content | Snippet fallback | `PARTIAL` |
| Local GLiNER unavailable | Deterministic entities | `PARTIAL` |
| All planned stages fail | Actionable error, no clean result | `FAILED` |

---

## 8. Local Extraction Integration

The local extraction implementation is the only extraction authority after content hydration. Firecrawl does not receive extraction labels or identity-resolution instructions.

### 8.1 Invocation contract

```ts
export interface LocalExtractionInput {
  text: string;
  sourceUrl: string;
  evidenceTier: "document" | "snippet";
}

export interface LocalExtractionOutput {
  entities: ExtractedEntity[];
  sidecarStatus: "online" | "sidecar_down" | "timeout" | "error";
  partial: boolean;
  textTruncated: boolean;
  limitations: {
    noOcr: true;
    languageScope: string;
  };
}
```

Use the existing implementation seam:

```text
src/lib/validators/                  deterministic email/phone/Aadhaar/PAN
src/lib/extraction/client.ts         local GLiNER HTTP client
src/lib/extraction/fusion.ts         detector fusion and confidence authority
src/lib/extraction/index.ts          public extraction entry point
sidecar/                             FastAPI GLiNER service
```

Required behavior:

- Run deterministic validators before the sidecar call.
- Keep deterministic confidence authoritative for structured IDs.
- Preserve provenance, normalized values, and offsets.
- Convert sidecar Unicode code-point offsets to JavaScript UTF-16 offsets and enforce the slice invariant.
- If Firecrawl content or the sidecar is partial/truncated, retain available findings but mark the extraction and scan partial.
- Do not send raw content, raw identifiers, or full names to Gemini. The later explanation layer receives only the redacted finding schema.

### 8.2 Evidence-aware confidence

The extraction layer reports detector confidence. The pipeline applies evidence confidence separately:

```text
document-tier evidence: normal evidence-confidence ceiling
snippet-tier evidence: lower evidence-confidence ceiling
partial/truncated extraction: partial-status flag; never silently complete
```

Do not compensate for a failed Firecrawl fetch by increasing detector confidence. Discovery relevance, extraction confidence, evidence confidence, and identity confidence are separate fields.

---

## 9. Module Layout

```text
src/lib/
├── connectors/
│   ├── types.ts                  # ProviderStatus and shared provider records
│   ├── serper.ts                 # Serper search adapter only
│   └── firecrawl.ts              # Firecrawl v2 scrape adapter only
├── discovery/
│   ├── queryPlanner.ts           # ≤6 safe targeted queries
│   ├── canonicalUrl.ts           # URL normalization and public-host checks
│   └── selector.ts               # ranking, deduplication, ≤10 URL selection
├── content/
│   └── normalize.ts              # Firecrawl response → NormalizedDocument
├── extraction/
│   ├── client.ts                 # local GLiNER client
│   ├── fusion.ts                 # deterministic/GLiNER fusion
│   ├── index.ts                  # extraction entry point
│   └── types.ts                  # extraction contracts
├── validators/                   # deterministic validators
├── pipeline/
│   └── discoverAndExtract.ts     # Serper → Firecrawl → local extraction
└── utils.ts

data/
└── fixtures/
    ├── serper_response.json
    ├── firecrawl_response.json
    └── README.md
```

No file in this tree may import TinyFish or contain a TinyFish URL, key, feature flag, adapter, or fallback.

---

## 10. Configuration and Secrets

```text
SERPER_API_KEY=server-only
FIRECRAWL_API_KEY=server-only
SERPER_BASE_URL=https://google.serper.dev
FIRECRAWL_BASE_URL=https://api.firecrawl.dev/v2
FIXTURES=0|1
```

Rules:

- Read keys only in server-side Route Handlers or pipeline modules. Never expose them through `NEXT_PUBLIC_*` variables.
- Fail closed when a key is missing: use fixtures only when `FIXTURES=1`; otherwise mark the provider unavailable and the scan partial.
- Keep provider URLs configurable for test doubles, but production defaults must be the documented endpoints.
- Do not log request bodies, API keys, raw search queries, raw snippets, page Markdown, or raw extracted values.
- Log only scan ID, provider, safe status code, latency, item count, retry count, and bounded error code.

---

## 11. Caching and Data Retention

### Serper

- Cache normalized result metadata by HMAC query key for six hours.
- Store raw snippets only when needed for snippet-tier evidence and retention policy permits it.

### Firecrawl

- Request `storeInCache: false` by default for user-triggered scans.
- Do not use Firecrawl's cache as the system of record.
- Store content hash, URL/domain, timestamps, evidence tier, and a minimal justified excerpt locally.
- Apply the existing account-erasure path to discovery results, hydrated-document metadata, extraction candidates, and findings.

### Cache correctness

- Cache hits must preserve the original provider timestamp and identify the result as cached metadata.
- A provider cache hit does not change evidence tier.
- A stale or malformed cached record is discarded and retried within the same bounded budget.

---

## 12. Failure Handling

Every provider adapter returns a typed result and never throws an unhandled provider error into the scan runner.

### Retry matrix

| Response | Retry | Result |
|---|---|---|
| 2xx with valid schema | No | Use response |
| 400/401/403 | No | `invalid_response` or `unavailable`; configuration/action required |
| 408 | Once | Retry within deadline |
| 429 | Once | Honor bounded `Retry-After`; then `rate_limited` |
| 5xx | Once | Then `unavailable` |
| Network failure | Once | Then `unavailable` |
| Invalid JSON/schema | No | `invalid_response` |
| Local extraction timeout | No provider retry | Keep deterministic results; `PARTIAL` |

### Clean-result rule

The dashboard may show “no matching evidence found” only when all planned Serper requests, selected Firecrawl requests, and local extraction stages completed without degradation. Zero results from an unavailable provider is not a clean result.

---

## 13. Testing Strategy

### 13.1 Unit tests

- Query planner never exceeds six queries and strips injected search operators.
- Query generation is deterministic for the same verified identifier set.
- Canonical URL normalization removes tracking parameters but preserves meaningful content parameters.
- Private, loopback, metadata, non-HTTP, credential-bearing, and malformed URLs are rejected.
- Serper parser accepts valid organic results and rejects malformed links without throwing.
- Firecrawl parser accepts valid v2 `success/data/markdown` responses and rejects malformed envelopes.
- Retry policy handles 408/429/5xx exactly once and never retries 401/403.
- Response size and timeout limits are enforced.
- Snippet fallback creates snippet-tier evidence with lower evidence confidence.
- Firecrawl failure never deletes the original Serper discovery result.
- Local extraction receives both document-tier Markdown and snippet-tier fallback text.
- Sidecar timeout/down/partial/truncated states preserve deterministic entities and mark partial.
- No provider key, raw query, raw snippet, page text, or raw identifier appears in logs.

### 13.2 Integration tests with fixtures

Use `FIXTURES=1` and replace network adapters with recorded responses:

1. Six Serper queries produce normalized, deduplicated URLs.
2. The top ten URLs are selected for Firecrawl; additional URLs remain snippet-only.
3. Firecrawl Markdown is normalized and passed to local extraction.
4. A Firecrawl timeout keeps the Serper snippet and creates a `PARTIAL` scan.
5. A malformed Firecrawl response does not crash the pipeline.
6. A partial local sidecar result keeps deterministic findings and remains `PARTIAL`.
7. A full failure produces `FAILED`, never a false clean result.
8. A replay is byte-stable except for explicitly time-based timestamps.

### 13.3 Live smoke test

Run only after fixture tests pass and only with a dedicated test identifier:

- one Serper request;
- one public, non-sensitive URL selected;
- one Firecrawl scrape;
- local extraction and offset invariant check;
- confirm no raw provider key or page content appears in logs.

Do not use a real person's unconsented identifier in live testing.

---

## 14. Implementation Checklist

### Foundation

- [ ] Add shared provider types and safe error codes.
- [ ] Add server-only environment validation for `SERPER_API_KEY` and `FIRECRAWL_API_KEY`.
- [ ] Add fixture mode and recorded Serper/Firecrawl response fixtures.
- [ ] Add provider request timeout, retry, response-size, and JSON-schema helpers.

### Serper

- [ ] Implement `src/lib/connectors/serper.ts` with the six-query budget.
- [ ] Implement safe query planning and HMAC cache keys.
- [ ] Parse only organic results into `DiscoveryResult`.
- [ ] Add canonical URL normalization and result deduplication.

### Firecrawl

- [ ] Implement `src/lib/connectors/firecrawl.ts` against Firecrawl v2 `/scrape`.
- [ ] Send Markdown-first options with `onlyMainContent`, `removeBase64Images`, `blockAds`, and `storeInCache: false`.
- [ ] Validate public URLs before sending them to Firecrawl.
- [ ] Enforce ten-URL, three-concurrent, 30-second request, one-retry budgets.
- [ ] Map successful content to document-tier evidence.
- [ ] Preserve Serper snippets as snippet-tier fallback on every hydration failure.

### Local extraction

- [ ] Connect Firecrawl Markdown and snippet fallback text to the existing local extraction entry point.
- [ ] Preserve deterministic validator precedence, provenance, confidence, and UTF-16 offsets.
- [ ] Propagate sidecar timeout, unavailable, partial, and truncation state to scan status.
- [ ] Ensure raw page text is never sent to Gemini and never written to logs.

### Verification

- [ ] Unit and fixture integration tests pass.
- [ ] Forced Firecrawl failure produces usable snippet findings and `PARTIAL`.
- [ ] Forced Serper failure produces `PARTIAL` without a clean result.
- [ ] No TinyFish reference exists in source, package manifests, environment examples, fixtures, or runtime configuration.
- [ ] One live smoke test succeeds with a dedicated test identifier and safe logs.

---

## 15. Definition of Done

- Serper is the only search/discovery provider.
- Firecrawl v2 is the only remote URL hydration provider.
- TinyFish is absent from the implementation and configuration.
- A verified scan can run end-to-end as:

  ```text
  verified identifiers → ≤6 Serper queries → ≤10 selected URLs → Firecrawl scrape → local extraction → fused findings
  ```

- Firecrawl failures preserve Serper snippets and produce `PARTIAL`, not an empty clean result.
- Local extraction handles both document-tier and snippet-tier text.
- Deterministic validators remain authoritative for structured identifiers.
- Partial/truncated sidecar output is surfaced to the scan and dashboard.
- All provider responses are schema-validated, bounded, and safe to log.
- Fixture mode can replay the complete pipeline without network access.
- Unit, integration, and local extraction tests are green.
