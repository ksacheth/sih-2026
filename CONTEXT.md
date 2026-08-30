# Intelligent Personal Data Exposure Monitor

**Technical Design Document | SIH 2026 — 24-hour build, team of 5**

> **Design goal:** A privacy-preserving exposure intelligence platform that finds relevant public/breach exposure, correlates evidence, explains the practical threat, and turns findings into concrete user actions.

> **Revision note:** This revision incorporates a security/design review and is scoped to a 24-hour hackathon with 5 builders. Every feature below is sized for that window; anything that does not fit is in the explicit cut list (§1.4). Features that survive scoping as non-negotiable: identifier-ownership verification, per-account authorization on every route, async scan execution with incremental persistence, the name-match hard rule, and a fixture-based demo that cannot die on stage.

## 0. Executive Summary

The platform lets a user enter identifiers such as an email address, phone number, username, name, and optional context — **but only after the account has proven control of them**. It searches supported external sources, extracts personal-data indicators, correlates related findings, classifies likely threats, prioritizes actions, and presents evidence in one dashboard.

- **Architecture:** modular monolith centered on Next.js App Router and TypeScript Route Handlers, **self-hosted as Node (not serverless)** so the scan pipeline can run in-process and the GLiNER sidecar can live on the same host.
- **Trust model:** magic-link email login; identifiers verified via 6-digit email codes; phone identifiers accepted by attestation from an email-verified account, marked lower-trust. Unverified identifiers can never be scanned.
- **Storage:** MongoDB (Atlas free tier, or local container for the demo) as the system of record; TTL collections provide cache/quota protection.
- **Discovery:** Serper.dev web search, ExposedOrNot breach lookup, and a curated broker list matched by domain. Pwned Passwords is **cut** from the pipeline — no password ever enters the system.
- **PII:** deterministic regex/checksum checks for structured identifiers plus GLiNER-small running locally as a FastAPI sidecar on 127.0.0.1.
- **Explanation:** one Gemini call per top finding over a redacted finding schema; the model never receives raw PII values; a deterministic template is the fallback.
- **Core principle:** evidence and deterministic rules remain the source of truth; AI is constrained to extraction support and explanation.

**Document focus:** implementation-relevant decisions, data contracts, security controls, an explicit 24-hour cut list, and an hour-by-hour build plan for 5 people.

## 1. Problem, Scope and Product Boundary

### 1.1 Problem

Personal information is exposed across public websites, searchable documents, profiles, breach datasets, and data-broker directories. The main security problem is correlation: several individually low-impact pieces of information can become materially more dangerous when linked.

```
Public email + phone + workplace + address + breach indicator
                     ↓
          Correlated exposure pattern
                     ↓
       Actionable threat + remediation
```

### 1.2 MVP scope

| Area | Included |
|---|---|
| Identifiers | Email, phone, username, name, optional organization/location context — **verified or attested only** |
| Trust & safety | Magic-link auth, identifier verification, per-user scan rate limits, one-click data erasure |
| Discovery | Web search, breach intelligence, public documents, broker-domain references |
| PII extraction | Regex + checksum rules; GLiNER-small for contextual entity extraction |
| Correlation | Link findings that plausibly describe the monitored identity, with a hard rule against name-only confirmation |
| Threat analysis | Rule-based mapping from exposure combinations to plausible threats |
| Prioritization | Deterministic severity/priority rules; evidence confidence shown separately |
| Actions | Concrete remediation guidance tied to finding type; remediation state tracked |
| Monitoring | Manual re-scan per identity with new/changed/disappeared/reappeared/remediated detection |
| Dashboard | Severity summary, evidence, source, confidence, threat, next action, per-source scan progress |

### 1.3 Non-goals

- Internet-wide crawling or unrestricted people-search.
- Accessing private accounts or bypassing CAPTCHAs/access controls.
- Storing a proprietary database of stolen passwords. No password ever enters the system.
- Automatic takedown of arbitrary sites; crawling of data-broker sites.
- A fully autonomous multi-agent security architecture.
- Treating an LLM as the final authority for identity, severity, or evidence.
- SMS/phone OTP verification; scheduled background scans (MVP monitoring is manual re-scan).

> **Product wording:** A clean result means "No exposure was detected in the sources currently monitored," not "your information does not exist online."

### 1.4 Explicit 24-hour cut list

| Feature | Decision | Rationale |
|---|---|---|
| SMS/phone OTP | CUT | Cost + telecom dependencies; attestation with lower trust covers the demo honestly |
| Pwned Passwords connector | CUT from pipeline | Inputs contain no passwords; stretch: optional client-side SHA-1 prefix check (server never sees the password) |
| HIBP connector | STRETCH | ExposedOrNot + fixtures cover the demo; HIBP free tier is heavily rate-limited |
| Scheduled/cron scans | CUT; manual re-scan only | No scheduler infra in 24h; state machine fully demoable via two consecutive manual scans |
| robots.txt parser | CUT; domain denylist instead | Login-walled/known-blocked domains are denylisted and never fetched; snippets used instead. robots.txt respect is a stated stretch goal |
| OCR / image PII | CUT, limitation stated | Text inside images/scanned PDFs is invisible to the pipeline; stated in UI and pitch |
| Push/email notifications | CUT; in-app only | No channel infra in 24h |
| In-flight scan cancellation | Downgraded | Cancel sets a flag checked between pipeline stages; no mid-fetch kill |
| Broker-site crawling | CUT; domain matching only | Broker sites block crawlers; exposure = discovered result whose domain matches `brokers.json` |
| Circuit breaker / token buckets | Downgraded | Per-scan budgets + per-source status + PARTIAL semantics cover 24h needs; fixtures cover demo reliability |
| Multi-user teams, mobile UI, i18n | CUT | Out of scope for the event |

## 2. Architecture at a Glance

The system is a single application with clear internal modules. External providers are isolated behind connector interfaces so a provider can be replaced without changing downstream processing.

```
LOGIN (magic link) → VERIFY IDENTIFIERS (email code / phone attestation)
   ↓
POST /api/scan  →  202 + scan_id  →  pipeline runs fire-and-forget (in-process)
   ↓
SCAN ORCHESTRATION (status in Mongo; findings persisted incrementally per source)
   ├── Serper.dev web search          (≤6 queries/scan)
   ├── ExposedOrNot breach lookup
   └── Broker references via brokers.json domain match
   ↓
CONTENT NORMALIZATION (HTML/text/PDF; snippet-tier fallback when fetch fails)
   ↓
PII EXTRACTION
   ├── Regex + checksum
   └── GLiNER-small → local FastAPI sidecar (127.0.0.1)
   ↓
ENTITY / EXPOSURE CORRELATION  →  THREAT + PRIORITY RULES  →  RECOMMENDATIONS
   ↓
MONGODB (scans, exposures, audit; TTL cache)
   ↓
DASHBOARD (polls scan status)  →  GEMINI EXPLANATION (redacted schema, top ≤5 findings)
   ↓
MONITORING → manual re-scan → fingerprint state machine
```

### 2.1 Core design principles

| Principle | Implementation |
|---|---|
| Verify before you scan | An identifier becomes scannable only after the account proves control of it |
| Privacy by design | Minimize external disclosure, hash identifiers where possible, mask UI output, avoid retaining raw content |
| Evidence before intelligence | Every finding keeps source, URL, timestamp, extracted type, and confidence before any threat narrative |
| Deterministic core | Structured PII uses regex/checksum; correlation, severity, and priority use explicit versioned rules |
| AI is constrained | GLiNER supports contextual extraction; Gemini only explains an already-structured, redacted finding |
| Provider isolation | Each external source implements the same connector contract |
| Graceful degradation | A failed provider or a dead sidecar yields a PARTIAL scan, never a false "nothing found" |
| Own your data | Every query is scoped by session user; identifiers are masked in all responses; one-click erasure |

### 2.2 Runtime decision

**Self-hosted Node 20 on the demo laptop or a VPS, orchestrated by docker-compose with three services: `app` (Next.js), `sidecar` (GLiNER FastAPI), `mongo`.** Rationale:

- The pipeline needs minutes, not milliseconds — no serverless 10s timeout.
- The GLiNER sidecar binds 127.0.0.1, which serverless cannot host.
- GLiNER weights are pre-downloaded into the sidecar image, so first run does not stall.
- One command (`docker compose up`) is the entire demo setup.

Vercel/serverless is explicitly rejected for the MVP build.

## 3. End-to-End Scan Workflow

### 3.1 Scan lifecycle (async)

1. `POST /api/scan` receives verified identifier IDs. The handler validates: session user owns every identifier, every identifier is VERIFIED (or ATTESTED for phone), the per-user daily rate limit allows it, and no other scan is active for the identity. It creates the scan record (QUEUED), records the consent references, and **returns `202 {scan_id}` immediately**.
2. The pipeline is kicked off fire-and-forget in-process (`void runScanPipeline(scanId)`). Status transitions live only in Mongo.
3. Connectors run in parallel under per-scan budgets. **Findings are persisted incrementally, per source, as each connector completes** — a 90s deadline or a crash still yields usable partial results.
4. Normalize and deduplicate results using canonical URLs and content fingerprints.
5. Fetch/analyze pages under strict limits; a blocked or failed fetch downgrades the result to snippet-tier evidence instead of dropping it (§5.6).
6. Run deterministic PII checks and local GLiNER extraction.
7. Correlate extracted entities with the verified identifier set (§7).
8. Create or update exposure findings with provenance, confidence, and `rule_version`.
9. Apply threat, severity, and recommendation rules.
10. Set final status COMPLETED / PARTIAL / FAILED with per-source status; the dashboard has been polling `GET /api/scan/:id` throughout (2s interval).
11. Generate explanations post-hoc for the top ≤5 findings; explanation generation never blocks scan completion.

Supporting rules:

- **One active scan per identity:** partial unique index on `{identity_id}` where `status ∈ {QUEUED, RUNNING}` — users cannot stack concurrent scans.
- **Crash recovery:** on app boot, any scan stuck in RUNNING for >10 minutes is marked PARTIAL with a "resumed system" note.
- **Cancellation:** `POST /api/scan/:id` sets `cancelRequested`; the pipeline checks the flag between stages. In-flight fetches are not killed.

### 3.2 Example query planner

```
Input:
  email = user@example.com
  name  = Rahul Kumar
  org   = ABC Technologies
  username = rkumar_dev

Targeted queries:
  "user@example.com"
  "rkumar_dev"
  "Rahul Kumar" "user@example.com"
  "user@example.com" filetype:pdf
  "Rahul Kumar" "ABC Technologies"

Rules:
  prefer a small, high-value query set over bulk query generation
  identifiers are quoted and stripped of search operators (site:, OR, -)
    before interpolation — a crafted input must not skew or waste queries
```

### 3.3 Failure states

| State | Meaning | User-visible result |
|---|---|---|
| QUEUED | Scan created, pipeline not picked up yet | "Starting…" |
| RUNNING | At least one source is processing | Per-source progress |
| PARTIAL | One or more connectors failed or deadline hit | Available findings + failed sources named; never a clean result |
| COMPLETED | All planned work finished | Complete result set |
| FAILED | Scan could not produce usable output | Actionable error, never a false clean result |
| CANCELLED | User requested stop between stages | Partial work retained |

## 4. Technology Stack

| Layer | Technology | Why it is used |
|---|---|---|
| Application | Next.js App Router, TypeScript, Route Handlers, **self-hosted Node** | Single repository and API surface; in-process async pipeline; no serverless limits |
| Auth | Auth.js magic-link email login; dev fallback prints the login link to the server console | Real sessions in minutes; no password storage |
| Interface | Tailwind CSS, shadcn/ui, Recharts | Fast dashboard cards, severity views, evidence lists, charts |
| Data store | MongoDB Atlas free tier (or local container in docker-compose) | One primary store for users, identifiers, scans, findings, monitoring, audit |
| Verification | 6-digit codes sent via Resend free tier; dev mode prints the code to the server console and API response | Proves identifier ownership without SMS cost |
| Cache / quota guard | MongoDB collection + TTL index; HMAC(source + query) keys | No separate Redis; controls repeat provider requests without plaintext query identifiers |
| External APIs | Serper.dev; ExposedOrNot; brokers.json | Web discovery, breach intelligence, broker-domain discovery. No password inputs exist, so no password-checking API |
| PII extraction | Regex + checksum for structured IDs; GLiNER-small via local FastAPI sidecar at 127.0.0.1 | Deterministic checks for high-value structured PII; local contextual NER without cloud text |
| Explanation | One Gemini call per top finding over a redacted finding schema + deterministic template fallback | Plain-language explanations without raw PII; never blocks the scan |

### 4.1 Explicit updates from the earlier draft

| Earlier draft | Current decision |
|---|---|
| Identity verification subsystem "not part of the stack" | **Restored, minimal:** email-code verification + phone attestation; scans gated on verified identifiers |
| No auth/session mechanism | Auth.js magic-link sessions; every route user-scoped |
| Pwned Passwords range API | Cut — the pipeline never receives a password (stretch: client-side SHA-1 prefix check only) |
| Scheduled monitoring cadences | Manual re-scan in MVP; state machine demonstrated via consecutive scans |
| Redis / Celery / Redis Streams | Fire-and-forget in-process pipeline; scan status in Mongo; no external queue |
| PostgreSQL → MongoDB Atlas | Unchanged |
| Brave → Serper.dev; HIBP → ExposedOrNot primary | Unchanged |
| Presidio + spaCy → regex/checksum + GLiNER-small sidecar | Unchanged |
| Weighted risk-score model | Deterministic severity/priority rules + a deterministic confidence table (§7.4) |

## 5. Discovery Connectors

### 5.1 Connector contract

```ts
interface DiscoveryConnector {
  source: string
  search(query: string): Promise<DiscoveryResult[]>
}

DiscoveryResult = {
  source, source_id, url, title, snippet, discovered_at,
  content_type?, confidence?,
  evidence_tier: "document" | "snippet"   // set at fetch time, §5.6
}
```

### 5.2 Web search: Serper.dev

Search is targeted rather than exhaustive. The application builds a small set of high-value queries from exact identifiers plus optional name/context, then deduplicates returned URLs.

- Exact identifier search first; identifier + name/context second; `filetype:pdf` when useful; username queries for distinctive handles.
- **Budget: ≤6 search queries per scan.** Serper free tier is ~2,500 queries total (~400 scans ever) — this number drives the cache TTL (6h) and the fixture-mode rehearsal policy: **all rehearsals run against fixtures, never live Serper.**
- Identifiers are quoted and stripped of search operators before interpolation.
- Cache permitted repeat queries using HMAC-derived keys.

### 5.3 Breach intelligence

ExposedOrNot is the free/keyless primary. Because a keyless free API is fragile, the connector is wrapped with the fixture fallback: if the live call fails, the scan records the source as unavailable (PARTIAL) — it does not fake data. HIBP remains a stretch connector. The system records breach metadata and exposure indicators, not stolen passwords. Breach records whose names map to known credential-dump breaches produce a `CREDENTIAL_EXPOSURE` signal — the credential-exposure indicator comes from breach metadata, not from any password check.

### 5.4 Pwned Passwords — cut

The scan inputs are email, phone, username, name, org — there is no password anywhere in the pipeline, so a password-checking API has nothing to hash. The connector is removed. Stretch only: a purely client-side check that computes the SHA-1 in the browser and sends a 5-character prefix, so the server never sees the password.

### 5.5 Data brokers

`brokers.json` holds ~30–50 relevant entries (name, domains, opt-out URL). **Mechanism: broker exposure = any discovered result whose domain matches a `brokers.json` entry;** the finding surfaces the matching opt-out link. No broker-site crawling.

### 5.6 Fetch guard and two-tier evidence

- **Budgets:** ≤10 pages fetched per scan, ≤512KB per page, 10s per page fetch, 30s per connector, 90s soft scan deadline (stop starting new work; finish in-flight work; persist).
- **SSRF:** validate URLs before fetching; reject local/private network targets and `file://`; cap redirects.
- **Denylist:** known login-walled domains (linkedin.com, facebook.com, …) are never fetched.
- **Two-tier evidence:** if a fetch fails, is denied, or hits the denylist, the search snippet is recorded as `evidence_tier: "snippet"` with lower `evidence_confidence`; a fetched and parsed page is `evidence_tier: "document"` with higher confidence. **A blocked page is a lower-confidence lead, not a dropped lead.**

## 6. Content Processing and PII Extraction

### 6.1 Normalization

External results are converted to one internal representation so downstream logic is independent of source format.

```json
{
  "document_id": "...", "source_url": "...", "content_type": "...",
  "title": "...", "text": "...", "content_hash": "...", "retrieved_at": "..."
}
```

- **Canonical URL normalization before hashing:** strip UTM and tracking params, strip `www.`, drop trailing slashes, unify http/https — otherwise dedup misses obvious duplicates.
- **Phones are E.164-normalized with +91 as the default country** before matching.

### 6.2 Structured PII: regex + checksum

| Type | Detection approach | Output |
|---|---|---|
| Email | Regex + normalization | Type + normalized match + confidence |
| Phone | Regex + E.164 normalization (+91 default) | Country-aware candidate + confidence |
| Aadhaar | Pattern + Verhoeff checksum | Validated candidate; never shown raw in UI |
| PAN | Pattern + checksum | Validated candidate; masked in UI |
| Other structured IDs | Custom deterministic recognizers as needed | Typed candidate + detector provenance |

### 6.3 Contextual entities: GLiNER-small

GLiNER-small runs locally as a FastAPI sidecar on 127.0.0.1, loaded once at startup, weights pre-downloaded into the image. It receives normalized page/document text and extracts PERSON, ORGANIZATION, LOCATION, ADDRESS, EMAIL, PHONE.

- **Timeout: 15s per extraction call.** On timeout or sidecar failure the regex pipeline still runs and the scan is PARTIAL (source status: `sidecar_down`), never FAILED.
- `/api/health` probes Mongo and the sidecar `/health` endpoint.

> **Privacy boundary:** Raw page text does not leave the local machine for PII extraction. The cloud LLM is not part of the extraction path.

### 6.4 Fusion

When multiple detectors identify the same entity, the system keeps detector provenance and combines the result into a single candidate. Deterministic matches are preferred for structured identifiers; model output remains supporting evidence.

### 6.5 Known limitations (stated, not silent)

- **No OCR:** exposures inside images or scanned PDFs will not be found.
- **GLiNER-small is English-centric:** Indic-script pages and some transliterated names under-extract; regex rules carry the structured-ID load regardless of language.
- Both limitations are stated on the dashboard sources panel and in the pitch.

## 7. Entity Resolution and Exposure Correlation

### 7.1 Purpose

PII extraction answers "what data appears in the content?" Exposure correlation answers "does this finding plausibly describe the monitored identity?" The distinction is essential to reduce false alarms. Only verified/attested identifier sets reach this stage.

### 7.2 Matching signals

| Signal | Strength | Use |
|---|---|---|
| Exact email/phone match | High | Strongest direct linkage |
| Exact username match | High (distinctive) / Medium (generic) | Direct linkage when distinctive |
| Name similarity | Medium | Supporting evidence only — hard rule below |
| Organization similarity | Medium | Strengthens context |
| Location similarity | Low-Medium | Contextual support; never sufficient alone |
| Independent-source co-occurrence | Medium-High | Raises confidence when several independent signals agree |

### 7.3 Name matching spec (the false-positive engine, tamed)

- **Normalize:** lowercase, strip diacritics and punctuation; compare as **token sets, not edit distance**.
- **Initials expand:** "r" matches any token starting with R ("R. Kumar" ↔ "Rahul Kumar").
- **Common-name penalty:** if both name tokens appear in a hardcoded top-100 Indian first-name/surname list ("rahul", "kumar", "sharma", …), the match is weak evidence on its own.
- **HARD RULE: name similarity alone can never produce a confirmed match.** It caps at POTENTIAL. Confirmed/high requires an exact identifier (email/phone/username) OR name + ≥2 corroborating signals (org, location, co-occurrence across independent sources).
- This rule is what makes the demo criterion "a deliberately unrelated person with a similar name is not a confirmed match" pass by construction.

### 7.4 Confidence derivation (deterministic, versioned)

```
identity_confidence = base(strongest signal) + corroborations − penalties, capped

Base:        exact email 0.90 | exact phone 0.90 | exact username 0.70–0.85
             attested-phone-only match 0.60 (lower trust) | name-only 0.30
Corroborate: +0.05 org match | +0.03 location | +0.05 co-occurrence across ≥2 independent sources
Penalize:    −0.10 common-name penalty
Caps:        overall 0.98; name-only 0.50; attested-phone-only 0.75
             any name-only or attested-phone-only match is labeled POTENTIAL, never CONFIRMED
```

The table ships as data (`rules/confidence.ts` + `rule_version`), so scores are auditable and reproducible.

### 7.5 Exposure record

```json
{
  "exposure_id": "...", "identity_id": "...", "source_id": "...",
  "exposure_type": "...", "pii_type": "...", "rule_version": "...",
  "identity_confidence": 0.0, "evidence_confidence": 0.0,
  "evidence_tier": "document | snippet",
  "first_seen": "...", "last_seen": "...", "status": "...", "evidence": []
}
```

## 8. Threat Analysis, Severity and Prioritization

### 8.1 Threat ontology

| Exposure pattern | Likely threat |
|---|---|
| Email + phone + public profile | Targeted phishing / social engineering |
| Email + breach indicator (credential-dump breach) | Credential stuffing / account takeover |
| Name + address + family/location context | Physical targeting / stalking risk |
| Public identity fields across several sources | Impersonation / identity-fraud enablement |
| Single weak, low-confidence match | Informational; verify before taking action |

### 8.2 Severity model

Deterministic rules over exposure type, corroboration, persistence, and confidence. Every exposure is stamped with the `rule_version` that produced it, so changing rules during development never silently rewrites history.

| Rule example | Severity / priority behavior |
|---|---|
| CREDENTIAL_EXPOSURE signal from breach metadata | Highest urgency; password change, reuse check, MFA |
| Government/financial identifier publicly exposed | High urgency; removal/redaction |
| Phone + name + address strongly correlated | High urgency; visibility review and removal path |
| Old workplace/profile exposure, limited sensitivity | Medium priority |
| Low-confidence match (incl. all POTENTIAL labels) | Verify before escalation |

### 8.3 Recommendation engine

- Credential exposure → change password, change reused variants, enable MFA, review active sessions.
- Public phone → request removal/suppression from the source; reduce profile visibility.
- Public address in a document → contact the publisher for redaction/removal.
- Broker listing → open the opt-out link from `brokers.json`; record the remediation task.
- Uncertain identity match → request user verification before disruptive action.

## 9. LLM Explanation Layer

The LLM is not the discovery engine, evidence store, identity resolver, or severity authority. It is a presentation layer over structured findings.

- **Granularity:** one call per finding, for the **top ≤5 findings by severity per scan**; generated after the scan completes; never blocks it.
- **Fallback:** output is schema-validated; on failure or junk, a deterministic template renders instead ("High-severity phone exposure from example.org — request removal…"). The dashboard never blocks on the LLM and says "AI explanation unavailable" at worst.

### 9.1 Redacted finding schema

```json
{
  "risk_level": "HIGH",
  "exposure_type": "PUBLIC_PHONE",
  "identity_confidence": 0.94,
  "evidence_confidence": 0.98,
  "sources": ["example.org"],
  "threats": ["TARGETED_PHISHING", "SOCIAL_ENGINEERING"],
  "recommended_actions": ["REQUEST_REMOVAL", "REVIEW_VISIBILITY"]
}
```

### 9.2 Hard privacy rule

> **LLM input:** Pass types, domains, severity, confidence, evidence summaries, and action codes. Do **not** pass raw email addresses, phone numbers, Aadhaar/PAN values, document text, or credentials.

### 9.3 Output requirements

- Explain why the finding matters in plain language; why the source is relevant.
- State uncertainty explicitly when confidence is not high.
- Present top actions in priority order; never invent evidence.

## 10. Data Model and API Surface

### 10.1 MongoDB collections

| Collection | Purpose / key fields |
|---|---|
| users | Auth.js user record only |
| identifiers | Individually verified values: type, value (restricted), valueHmac, masked, status PENDING/VERIFIED/ATTESTED, verifiedAt |
| identities | Named set of verified identifier IDs belonging to one user (the monitored identity) |
| consents | One per identifier verification: purpose, scope, version, created/revoked; referenced by scans |
| scans | userId, identityId, status, per-source status, cancelRequested, timestamps, consentRefs |
| scan_jobs | Per-source/per-stage execution records |
| sources | Connector/source metadata |
| discovery_results | Normalized results with evidence_tier |
| documents | Minimal document metadata + content fingerprints |
| pii_entities | Extracted candidates + detector provenance |
| identity_matches | Correlation evidence + confidence |
| exposures | Findings: identity_id, fingerprint, rule_version, status, evidence |
| recommendations | Action templates + user task state (linked to exposures; feeds REMEDIATED) |
| monitoring | Last-scan snapshot per identity: fingerprints, last-seen state |
| verification_codes | Hashed 6-digit codes, TTL 10 min |
| audit_events | Security events without raw sensitive values |
| cache | TTL-backed provider/query cache |

### 10.2 Indexes (written into the schema definitions)

```
identifiers         unique {userId, type, valueHmac}
scans               partial unique {identityId}  where status ∈ {QUEUED, RUNNING}   // one active scan
scans               {userId, createdAt desc}
exposures           unique {fingerprint}
exposures           {identityId, status}
cache               TTL {createdAt}   6h
verification_codes  TTL {expiresAt}   10m
audit_events        TTL {createdAt}   30d (optional)
```

### 10.3 Route Handler API

| Endpoint | Methods | Notes |
|---|---|---|
| `/api/auth/[...nextauth]` | POST/GET | Magic-link login |
| `/api/identifiers` | POST / GET | Create (triggers code) / list own, masked only |
| `/api/identifiers/:id/verify` | POST | Submit 6-digit code |
| `/api/identifiers/:id/resend` | POST | Rate-limited resend |
| `/api/identifiers/:id` | DELETE | Remove identifier |
| `/api/scan` | POST / GET | 202 + scan_id / list own scans |
| `/api/scan/:id` | GET / POST | Poll status / cancel (stage-flag) |
| `/api/exposures` | GET | Own exposures only |
| `/api/exposures/:id` | GET | Ownership enforced |
| `/api/exposures/:id/remediate` | PATCH | Mark REMEDIATED |
| `/api/recommendations` | GET / PATCH | Own tasks only |
| `/api/account` | DELETE | Full erasure (§11.6) |
| `/api/health` | GET | Probes Mongo + GLiNER sidecar |

**Authorization rules:** every route resolves the session user; every query is scoped by `userId`; object IDs are opaque and non-enumerable; identifiers are returned masked only (`r***@example.com`, `+91 •••• 4321`); there is no unauthenticated list endpoint of anything.

### 10.4 Example exposure response

```json
{
  "id": "EXP-123",
  "type": "PHONE_NUMBER",
  "source": { "domain": "example.org", "url": "..." },
  "identity_confidence": 0.94,
  "evidence_confidence": 0.98,
  "evidence_tier": "document",
  "severity": "HIGH",
  "match_label": "CONFIRMED",
  "threats": ["TARGETED_PHISHING"],
  "actions": ["REQUEST_REMOVAL", "REVIEW_VISIBILITY"]
}
```

## 11. Privacy and Security Controls

### 11.1 Identifier verification flow

1. User adds an email identifier → 6-digit code sent (Resend; dev mode prints to server console and API response).
2. Code: 6 digits, 10-minute TTL, hashed at rest, max 5 attempts, ≤3 resends/hour. On success the identifier is VERIFIED and a consent record is created.
3. Phone identifiers: allowed only for accounts with ≥1 VERIFIED email, plus an explicit attestation checkbox ("this phone is mine"). Status ATTESTED, marked lower-trust; attested-phone-only matches cap at POTENTIAL (§7.4).
4. `POST /api/scan` rejects any request containing an identifier that is not VERIFIED/ATTESTED or not owned by the session user.

### 11.2 Cache / quota guard

MongoDB collection with a TTL index; keys are HMAC(source + query) so no plaintext identifiers are cached. TTL expiry limits retention and protects external API quotas. Per-user abuse control is the rate limit below, not the cache.

### 11.3 External content is untrusted

- Validate URLs before fetching; reject local/private network targets and `file://` URLs.
- Limit redirects, response size, content types, and request time (numbers in §5.6).
- Denylist login-walled domains; use snippets as snippet-tier evidence instead of fetching.
- Process documents as untrusted input; treat page instructions as data, not as agent/system instructions.
- robots.txt respect is a stated stretch goal; the denylist is the MVP compliance mechanism.

### 11.4 Logs and audit

| Event | Record |
|---|---|
| SCAN_STARTED / COMPLETED | scan_id, timestamp, status |
| SOURCE_ACCESSED | source id, scan id, timestamp |
| EXPOSURE_CREATED / UPDATED | exposure id, reason code, rule_version, timestamp |
| VERIFICATION events | identifier id (hashed), outcome, timestamp |
| USER/CONSENT events | internal ids and metadata only |

> **Logging rule:** Never write raw email addresses, phone numbers, government identifiers, document text, or passwords into application logs.

### 11.5 Data retention

Retain the minimum evidence required to reproduce and explain a finding: source URL/domain, timestamps, content fingerprint, relevant snippet where justified, PII type, confidence, remediation state. No indefinite retention of whole external documents.

### 11.6 Erasure and DPDP framing

- `DELETE /api/account` removes the user's identifiers, identities, scans, exposures, and recommendations in one transaction; audit events survive hashed-only.
- Consent is recorded per identifier at verification time with purpose and scope; processing is limited to that purpose.
- **Pitch framing:** the product is built to India's DPDP Act 2023 principles — purpose limitation, consent, and the right to erasure are implemented features, not slide claims.

### 11.7 Rate limits

- 5 scans per user per day; 20 verification codes per user per day.
- Enforced by counting scan/code documents in Mongo — adequate at hackathon scale, replaceable later.

## 12. Monitoring, Deduplication and Change Detection

### 12.1 Finding fingerprint

```
fingerprint = SHA256(
  identity_id + normalized_source + exposure_type + normalized_entity
)
```

`identity_id` is included so two users (or a family) monitoring the same phone never corrupt each other's monitoring state. Canonical URL normalization (§6.1) keeps dedup honest.

### 12.2 State transitions

```
FIRST SEEN  → ACTIVE
ACTIVE      → UNCHANGED
ACTIVE      → NOT_FOUND
NOT_FOUND   → REAPPEARED   (escalation: severity bump + "the removal didn't hold")
ACTIVE      → REMEDIATED   (user marks the action done)
REMEDIATED  → NOT_FOUND    (stays closed unless an exact identifier match reappears → escalate)
NOT_FOUND for 3 consecutive scans → CLOSED (auto-close; findings do not accumulate forever)
```

### 12.3 Monitoring schedules

MVP monitoring is a manual "Re-scan now" button per identity; the state machine is demonstrated with consecutive scans. Cadence automation (daily/weekly per source type) is post-hackathon work — it requires a scheduler the 24-hour build deliberately does not include (§1.4).

### 12.4 Partial result semantics

A source outage must not erase previous findings or produce a clean result. "Web search unavailable; breach and broker sources completed" → PARTIAL, unavailable source recorded for the next re-scan.

## 13. Evaluation and Testing

### 13.1 What to measure (with targets)

| Component | Metric | Target for demo |
|---|---|---|
| PII extraction | Precision/recall/F1 on golden corpus | F1 ≥ 0.80 per entity type |
| Entity resolution | Name-only decoy confirmed as match | **0 occurrences (hard rule)** |
| Correlation | True/false positive match rates | No false CONFIRMED on corpus |
| Monitoring | Correct new/removed/reappeared detection | All state transitions demonstrated |
| System | Scan completion, PARTIAL behavior | Forced-failure demo produces PARTIAL |

### 13.2 Golden evaluation corpus (built early — it doubles as demo data)

~20 synthetic pages (profiles, résumé-style documents, paste-site entries) with seeded PII, **5 near-miss decoys** (similar-name, different person), and 3 broker-domain pages. Built in the first 6 hours, served locally, reused as (a) the fixture/replay corpus for connector development, (b) the live-demo safety net, and (c) the offline evaluation set. Confidence thresholds cannot be tuned without it, and every downstream phase inherits its quality.

### 13.3 Testing priorities

- Unit: identifier validators, normalization, fingerprints, confidence table, severity rules, name matcher.
- Integration: each connector against fixtures; graceful failure per source.
- Golden tests: GLiNER extraction on the corpus.
- E2E: scan creation → dashboard finding on fixtures.
- Security: SSRF rejects, identifier masking in responses, no PII in logs, unverified-identifier scan rejection.

### 13.4 Acceptance criteria for the SIH demo

- A scan discovers web, breach, and broker-related exposure from one verified identifier set.
- An unverified identifier is rejected from scanning (shown live).
- At least one finding includes source evidence, tier, confidence, threat, and recommended action.
- A deliberately unrelated person with a similar name appears as POTENTIAL, never CONFIRMED.
- The local GLiNER sidecar extracts contextual PII without sending page text to Gemini; killing the sidecar mid-demo yields PARTIAL, not FAILED.
- Gemini produces a useful explanation from the redacted schema only; the template fallback is shown when it is disabled.
- A failed external provider results in a partial scan, not a misleading clean result.
- Re-scan after remediation demonstrates REMEDIATED → REAPPEARED escalation.
- Account erasure removes all user data (DPDP).

## 14. 24-Hour Build Plan (team of 5)

### 14.1 Roles

| Person | Workstream | Owns |
|---|---|---|
| A — Platform & trust | Scaffold, schemas/indexes, Auth.js magic link, identifier verification + rate limits, erasure, health | §10, §11.1, §11.6, §11.7 |
| B — Discovery | Serper + ExposedOrNot + brokers connectors, cache, budgets, SSRF guard, fixture recorder/player, two-tier evidence | §5 |
| C — Extraction | Regex/checksum validators, GLiNER sidecar + Dockerfile (pre-downloaded weights), fusion, URL/phone normalization, compose file | §6 |
| D — Correlation & rules | Name matcher, confidence table, severity rules, recommendations, fingerprints + state machine, rule_version | §7, §8, §12 |
| E — Frontend & LLM | Dashboard, polling, evidence views, Gemini call + template fallback, demo polish, pitch | §9, UI |

### 14.2 Hour-by-hour

| Hours | Milestone | Per-person focus |
|---|---|---|
| H0–H2 | Skeleton runs | All: repo scaffold; A: schemas + indexes; C: compose (app+sidecar+mongo); B: Serper/EoN keys probed, fixture format fixed; E: corpus pages seeded; D: rule modules stubbed |
| H2–H6 | Walking skeleton | B: connectors + orchestrator (202 + fire-and-forget + incremental persist); C: regex PII + sidecar hello-world; A: magic-link auth + verification codes; D: fingerprint + name matcher; E: dashboard shell on fixtures |
| H6–H10 | **Checkpoint 1: full fake pipeline E2E on fixtures** | A: rate limits + erasure; B: two-tier evidence + fetch guard; C: GLiNER integration + fusion; D: severity + recommendations; E: live polling UI |
| H10–H14 | Real pipeline end-to-end | E: Gemini + fallback; D: REMEDIATED/reappear/auto-close; A: verification gating into scan; all: golden-corpus eval run #1, fix top precision bugs |
| H14–H18 | Hardening | Masking audit, SSRF tests, PARTIAL behavior tests, empty/error states, UI polish |
| H18–H21 | **Checkpoint 2: full dry run ×3** (fixtures + one live) | Demo video recorded as backup; per-beat timing; bug triage — only P0/P1 fixes |
| H21–H24 | Freeze | Code freeze; pitch + screenshots; buffer |

Rule: after every checkpoint the system is demoable end-to-end, even if features are thin.

### 14.3 Demo script (6 minutes)

1. Magic-link login (console fallback ready if Resend is slow).
2. Add email identifier → 6-digit code → verified. Then attempt a scan with an unverified identifier → rejected. **"We verify you control the identifier before we look for it anywhere."**
3. Start scan → live per-source progress.
4. Findings with evidence, tier, confidence; the similar-name decoy shows POTENTIAL, never CONFIRMED.
5. Mark the recommendation done (REMEDIATED) → re-scan → REAPPEARED escalation: "the opt-out didn't hold."
6. Kill the sidecar container live → scan goes PARTIAL, regex findings still flow. Graceful degradation on stage.
7. Erase the account → DPDP erasure beat. Close on the DPDP framing.

### 14.4 Failure protocol

- `FIXTURES=1` env flag switches every connector to recorded responses; all rehearsals and the backup run in this mode.
- Backup demo video recorded at H18–H21.
- Verification codes print to the server console in dev mode — no external email dependency on stage.
- GLiNER weights are baked into the image; no first-run download.

### 14.5 Central engineering position

The implementation stays small, testable, and defensible: one Next.js application, one MongoDB store, connector-based discovery, local PII extraction, deterministic severity/action rules, and a tightly constrained explanation model — plus the trust spine (verification, authorization, erasure) that makes it a responsible product rather than a doxxing tool. The strongest SIH demonstration is the complete path from verified input, to discovery, to evidence, to a useful remediation action — and the honesty of its failure states.

---

*End of concise technical design — revision 2, scoped for a 24-hour build.*
