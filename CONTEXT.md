# Intelligent Personal Data Exposure Monitor

**Technical Design Document | SIH 2026**

> **Design goal:** A privacy-preserving exposure intelligence platform that finds relevant public/breach exposure, correlates evidence, explains the practical threat, and turns findings into concrete user actions.

## 0. Executive Summary

The platform lets a user enter authorized identifiers such as an email address, phone number, username, name, and optional context. It searches supported external sources, extracts personal-data indicators, correlates related findings, classifies likely threats, prioritizes actions, and presents evidence in one dashboard.

- **Architecture:** modular monolith centered on Next.js App Router and TypeScript Route Handlers.
- **Storage:** MongoDB Atlas as the system of record; MongoDB TTL collections also provide cache/quota protection.
- **Discovery:** Serper.dev web search, ExposedOrNot breach lookup, optional HIBP, Pwned Passwords range API, and a curated broker list.
- **PII:** deterministic regex/checksum checks for structured identifiers plus GLiNER-small running locally as a FastAPI sidecar on 127.0.0.1.
- **Explanation:** one Gemini call over a redacted finding schema; the model never receives raw PII values.
- **Core principle:** evidence and deterministic rules remain the source of truth; AI is constrained to extraction support and explanation.

**Document focus:** This version deliberately compresses the earlier 85-page draft into the implementation-relevant decisions, flows, data contracts, security controls, and SIH MVP plan. It avoids detailed deployment, microservice, and weighted risk-model discussions that are not part of the current stack.

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
| Identifiers | Email, phone, username, name, optional organization/location context |
| Discovery | Web search, breach intelligence, public documents, broker directory references |
| PII extraction | Regex + checksum rules; GLiNER-small for contextual entity extraction |
| Correlation | Link findings that likely describe the same monitored identity |
| Threat analysis | Rule-based mapping from exposure combinations to plausible threats |
| Prioritization | Deterministic severity/priority rules; evidence confidence shown separately |
| Actions | Concrete remediation guidance tied to finding type |
| Monitoring | Repeated scans and new/changed/disappeared finding detection |
| Dashboard | Severity summary, evidence, source, confidence, threat, next action |

### 1.3 Non-goals

- Internet-wide crawling or unrestricted people-search.
- Accessing private accounts or bypassing CAPTCHAs/access controls.
- Storing a proprietary database of stolen passwords.
- Automatic takedown of arbitrary sites.
- A fully autonomous multi-agent security architecture.
- Treating an LLM as the final authority for identity, severity, or evidence.

> **Product wording:** A clean result means "No exposure was detected in the sources currently monitored," not "your information does not exist online."

## 2. Architecture at a Glance

The system is a single application with clear internal modules. External providers are isolated behind connector interfaces so a provider can be replaced without changing downstream processing.

```
USER INPUT
   ↓
NEXT.JS APP ROUTER + TYPESCRIPT ROUTE HANDLERS
   ↓
SCAN ORCHESTRATION
   ├── Serper.dev web search
   ├── ExposedOrNot / optional HIBP
   ├── Pwned Passwords range API
   └── Broker directory references (brokers.json)
   ↓
CONTENT NORMALIZATION
   ├── HTML / text extraction
   └── PDF / document extraction
   ↓
PII EXTRACTION
   ├── Regex + checksum
   └── GLiNER-small → local FastAPI sidecar (127.0.0.1)
   ↓
ENTITY / EXPOSURE CORRELATION
   ↓
THREAT CLASSIFICATION + PRIORITY RULES
   ↓
MONGODB ATLAS
   ↓
DASHBOARD → EXPLANATION (GEMINI, REDACTED SCHEMA ONLY)
   ↓
MONITORING → NEXT SCAN
```

### 2.1 Core design principles

| Principle | Implementation |
|---|---|
| Privacy by design | Minimize external disclosure, hash identifiers where possible, mask UI output, avoid retaining raw content unnecessarily. |
| Evidence before intelligence | Every finding keeps source, URL, timestamp, extracted type, and confidence before any threat narrative is generated. |
| Deterministic core | Structured PII uses regex/checksum; threat and priority decisions use explicit rules. |
| AI is constrained | GLiNER supports contextual extraction; Gemini only explains an already-structured, redacted finding. |
| Provider isolation | Each external source implements the same connector contract. |
| Graceful degradation | A failed provider yields a partial scan, not a false "nothing found" result. |

## 3. End-to-End Scan Workflow

### 3.1 Scan lifecycle

1. Create a scan record with a unique scan_id and the identifiers to be checked.
2. Generate a small set of targeted search queries from the supplied identifiers and context.
3. Run discovery connectors in parallel where practical.
4. Normalize and deduplicate results using canonical URLs and content fingerprints.
5. Fetch/analyze relevant public pages or documents under strict limits.
6. Run deterministic PII checks and local GLiNER extraction.
7. Correlate extracted entities with the monitored identifier set.
8. Create or update exposure findings with provenance and confidence.
9. Apply threat and priority rules.
10. Persist findings in MongoDB and render the dashboard.
11. Optionally generate a short user-facing explanation from the redacted finding schema.

### 3.2 Example query planner

```
Input:
  email = user@example.com
  name  = Rahul Kumar
  org   = ABC Technologies

Targeted queries:
  "user@example.com"
  "Rahul Kumar" "user@example.com"
  "user@example.com" filetype:pdf
  "Rahul Kumar" "ABC Technologies"

Rule: prefer a small, high-value query set over bulk query generation.
```

### 3.3 Failure states

| State | Meaning | User-visible result |
|---|---|---|
| QUEUED | Scan created, not started | Waiting to start |
| RUNNING | At least one source is processing | Progress shown |
| PARTIAL | One or more connectors failed | Show available findings + failed source |
| COMPLETED | All planned work finished | Complete result set |
| FAILED | Scan could not produce usable output | Actionable error, never a false clean result |
| CANCELLED | User/system stopped the scan | Partial work retained where safe |

## 4. Updated Technology Stack

The following is the current stack and supersedes the corresponding technology choices in the earlier draft.

| Layer | Technology | Why it is used |
|---|---|---|
| Application | Next.js App Router, TypeScript, Route Handlers | Single repository and API surface; avoids a separate backend server. |
| Interface | Tailwind CSS, shadcn/ui, Recharts | Fast construction of dashboard cards, severity views, evidence lists, and charts. |
| Data store | MongoDB Atlas free tier | One primary store for scans, findings, identifiers, monitoring state, and application data. |
| Cache / quota guard | MongoDB collection + TTL index; HMAC(source + query) keys | No separate Redis dependency; controls repeated provider requests without storing plaintext query identifiers. |
| External APIs | Serper.dev; ExposedOrNot; optional HIBP; Pwned Passwords range API; broker directory list | Covers web discovery, breach intelligence, password-exposure indication, and broker-source discovery. |
| PII extraction | Regex + checksum for structured IDs; GLiNER-small via local FastAPI sidecar at 127.0.0.1 | Deterministic checks for high-value structured PII; local contextual NER without sending page text to a cloud model. |
| Explanation | One Gemini call over a redacted finding schema | Produces plain-language explanations without exposing raw PII values to the model. |

### 4.1 Explicit updates from the earlier draft

| Earlier draft | Current decision |
|---|---|
| Python/FastAPI main backend | Next.js Route Handlers + TypeScript as the application/API layer |
| PostgreSQL | MongoDB Atlas |
| Redis / Celery / Redis Streams | MongoDB TTL-backed cache/quota guard; asynchronous behavior stays inside the application flow unless later needed |
| Brave as primary search | Serper.dev as the current web-search connector |
| HIBP as primary breach source | ExposedOrNot as current primary; HIBP remains optional |
| Presidio + spaCy | Regex/checksum + GLiNER-small local sidecar |
| Weighted risk-score model | Current MVP uses deterministic severity/priority rules instead of a numeric risk-scoring subsystem |
| Identity verification subsystem | Not part of the current stack; the scan operates on user-supplied identifiers |

## 5. Discovery Connectors

### 5.1 Connector contract

```ts
interface DiscoveryConnector {
  source: string
  search(query: string): Promise<DiscoveryResult[]>
}

DiscoveryResult = {
  source, source_id, url, title, snippet, discovered_at,
  content_type?, confidence?
}
```

### 5.2 Web search: Serper.dev

Serper.dev is the current web-search connector. Search is targeted rather than exhaustive. The application builds a small set of high-value queries from exact identifiers plus optional name/context, then deduplicates returned URLs.

- Exact identifier search first.
- Identifier + name/context second.
- Document-specific queries such as `filetype:pdf` when useful.
- Apply per-scan query limits to control cost, latency, and privacy exposure.
- Cache permitted repeat queries using HMAC-derived keys.

### 5.3 Breach intelligence

The current breach connector uses ExposedOrNot as the free/keyless path. HIBP can remain an optional connector where the project has access to it. The system records breach metadata and exposure indicators, not stolen passwords.

### 5.4 Pwned Passwords

The Pwned Passwords range API is used only to establish whether a password-derived signal appears in the service. The application must not store or display actual compromised passwords.

### 5.5 Data brokers

Broker discovery is represented by a maintained `brokers.json` file containing roughly 30–50 relevant entries with source links and opt-out links. The MVP identifies likely broker exposure and points the user to the removal/suppression process; it does not automate takedowns.

## 6. Content Processing and PII Extraction

### 6.1 Normalization

External results are converted to one internal representation so downstream logic is independent of source format.

```json
{
  "document_id": "...", "source_url": "...", "content_type": "...",
  "title": "...", "text": "...", "content_hash": "...", "retrieved_at": "..."
}
```

### 6.2 Structured PII: regex + checksum

| Type | Detection approach | Output |
|---|---|---|
| Email | Regex + normalization | Type + normalized match + confidence |
| Phone | Regex + normalization | Country-aware candidate + confidence |
| Aadhaar | Pattern + checksum/validation rules | Validated candidate; never shown raw in UI |
| PAN | Pattern + checksum/validation rules where applicable | Validated candidate; masked in UI |
| Other structured IDs | Custom deterministic recognizers as needed | Typed candidate + detector provenance |

### 6.3 Contextual entities: GLiNER-small

GLiNER-small runs locally as a FastAPI sidecar on 127.0.0.1. It is loaded once at startup and receives normalized page/document text for contextual entity extraction such as PERSON, ORGANIZATION, LOCATION, ADDRESS, EMAIL, and PHONE.

> **Privacy boundary:** Raw page text does not need to leave the local machine for PII extraction. The cloud LLM is not part of the extraction path.

### 6.4 Fusion

When multiple detectors identify the same entity, the system keeps detector provenance and combines the result into a single candidate. Deterministic matches are preferred for structured identifiers; model output remains supporting evidence rather than unquestioned truth.

## 7. Entity Resolution and Exposure Correlation

### 7.1 Purpose

PII extraction answers "what data appears in the content?" Exposure correlation answers "does this finding plausibly describe the monitored identity?" The distinction is essential to reduce false alarms.

### 7.2 Matching signals

| Signal | Strength | Use |
|---|---|---|
| Exact email/phone match | High | Strongest direct linkage to supplied identifiers |
| Exact username / identifier match | High | Useful when the identifier is distinctive |
| Name similarity | Medium | Supporting evidence only |
| Organization similarity | Medium | Strengthens context |
| Location similarity | Low-Medium | Contextual support; never sufficient alone |
| Source relationship / repeated co-occurrence | Medium-High | Can raise confidence when several independent signals agree |

### 7.3 Finding confidence

```
identity_confidence: 0.00 - 1.00
evidence_confidence: 0.00 - 1.00

Example:
  identity_confidence = 0.94
  evidence_confidence = 0.98
  result = present as a strong, corroborated exposure
```

A low-confidence match should be labeled as *potential* exposure rather than *confirmed* exposure. The UI should always show confidence alongside severity so a serious-but-uncertain finding is not misrepresented as established fact.

### 7.4 Exposure record

```json
{
  "exposure_id": "...", "source_id": "...", "exposure_type": "...", "pii_type": "...",
  "identity_confidence": 0.0, "evidence_confidence": 0.0, "first_seen": "...",
  "last_seen": "...", "status": "...", "evidence": []
}
```

## 8. Threat Analysis, Severity and Prioritization

### 8.1 Threat ontology

| Exposure pattern | Likely threat |
|---|---|
| Email + phone + public profile | Targeted phishing / social engineering |
| Email + breach indicator + reused credential signal | Credential stuffing / account takeover |
| Name + address + family/location context | Physical targeting / stalking risk |
| Public identity fields across several sources | Impersonation / identity-fraud enablement |
| Single weak, low-confidence match | Usually informational; verify before taking action |

### 8.2 Current MVP severity model

The current stack does not introduce a separate numeric risk-scoring subsystem. Instead, severity and action priority are determined by explicit rules over exposure type, corroboration, persistence, and confidence.

| Rule example | Severity / priority behavior |
|---|---|
| Credential/password exposure indicator | Highest urgency; recommend password change, reuse check, MFA |
| Government/financial identifier publicly exposed | High urgency; prioritize removal/redaction |
| Phone + name + address strongly correlated | High urgency; review source visibility and removal path |
| Old workplace/profile exposure with limited sensitivity | Medium priority |
| Low-confidence match | Verify before escalation |

### 8.3 Recommendation engine

- Password exposure → change password, change reused variants, enable MFA, review active sessions.
- Public phone number → request removal/suppression from the source and reduce unnecessary profile visibility.
- Public address in a document → contact the publisher for redaction/removal.
- Broker listing → open the relevant opt-out page and record the remediation task.
- Uncertain identity match → request user verification before recommending disruptive action.

## 9. LLM Explanation Layer

The LLM is not the discovery engine, evidence store, identity resolver, or severity authority. It is a presentation layer that converts a structured finding into a short explanation the user can understand.

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

> **LLM input:** Pass types, domains, severity, confidence, evidence summaries, and action codes. Do **not** pass raw email addresses, phone numbers, Aadhaar/PAN values, document text, or stolen credentials.

### 9.3 Output requirements

- Explain why the finding matters in plain language.
- Explain why the source is relevant.
- State uncertainty explicitly when confidence is not high.
- Present the top actions in priority order.
- Never invent evidence that is not present in the structured finding.

### 9.4 Why one Gemini call

A single constrained explanation call keeps cost, latency, and nondeterminism low while preventing the model from becoming a hidden orchestration layer. The deterministic pipeline produces the facts; Gemini verbalizes them.

## 10. Data Model and API Surface

### 10.1 MongoDB collections

| Collection | Purpose |
|---|---|
| users | Application user/session metadata kept separate from monitored identifiers where practical |
| identities | Normalized monitored identifier sets and masked display values |
| consents | Purpose, scope, created/revoked timestamps, version |
| scans | Scan lifecycle, source status, timestamps |
| scan_jobs | Per-source or per-stage execution records |
| sources | Connector/source metadata |
| discovery_results | Normalized search/breach/document results |
| documents | Minimal retained document metadata and content fingerprints |
| pii_entities | Extracted entity candidates and detector provenance |
| identity_matches | Correlation evidence and confidence |
| exposures | User-facing exposure findings and status |
| recommendations | Action templates and user task state |
| monitoring | Schedules, fingerprints, last-seen state |
| audit_events | Security-relevant events without raw sensitive values |
| cache | TTL-backed provider/query cache and quota guard |

### 10.2 Route Handler API

| Endpoint | Methods |
|---|---|
| `/api/scan` | POST / GET |
| `/api/scan/:id` | GET / POST (cancel) |
| `/api/exposures` | GET |
| `/api/exposures/:id` | GET |
| `/api/recommendations` | GET / PATCH |
| `/api/monitoring` | GET / POST / PATCH |
| `/api/sources` | GET |
| `/api/health` | GET |

### 10.3 Example exposure response

```json
{
  "id": "EXP-123",
  "type": "PHONE_NUMBER",
  "source": { "domain": "example.org", "url": "..." },
  "identity_confidence": 0.94,
  "evidence_confidence": 0.98,
  "severity": "HIGH",
  "threats": ["TARGETED_PHISHING"],
  "actions": ["REQUEST_REMOVAL", "REVIEW_VISIBILITY"]
}
```

## 11. Privacy and Security Controls

### 11.1 Identifier protection

```
Raw identifier
   ├── restricted storage (only when needed)
   ├── normalized form
   ├── HMAC for deterministic internal correlation
   └── masked form for UI
```

Use HMAC-derived representations for deterministic internal correlation and cache keys. Do not use plain unsalted hashes when the identifier space is small enough for offline guessing.

### 11.2 Cache / quota guard

The cache is a MongoDB collection with a TTL index. Keys are derived from HMAC(source + query), so the cache does not need plaintext identifiers. TTL expiry limits retention and protects external API quotas.

### 11.3 External content is untrusted

- Validate URLs before fetching; reject local/private network targets and `file://` URLs.
- Limit redirects, response size, content types, and request time.
- Process documents as untrusted input; do not execute embedded code, macros, or arbitrary binaries.
- Treat page instructions as data, not as agent/system instructions.

### 11.4 Logs and audit

| Event | Record |
|---|---|
| SCAN_STARTED / COMPLETED | scan_id, timestamp, status |
| SOURCE_ACCESSED | source id, scan id, timestamp |
| EXPOSURE_CREATED / UPDATED | exposure id, reason code, timestamp |
| RECOMMENDATION_CREATED | recommendation id, exposure id |
| USER/CONSENT events | internal ids and metadata only |

> **Logging rule:** Never write raw email addresses, phone numbers, government identifiers, document text, or passwords into application logs.

### 11.5 Data retention

Retain the minimum evidence required to reproduce and explain a finding: source URL/domain, timestamps, content fingerprint, relevant snippet where justified, PII type, confidence, and remediation state. Avoid indefinite retention of whole external documents.

## 12. Monitoring, Deduplication and Change Detection

### 12.1 Finding fingerprint

```
fingerprint = SHA256(
  normalized_source + exposure_type + normalized_entity
)
```

A stable fingerprint lets later scans determine whether a finding is unchanged, new, missing, or reappeared.

### 12.2 State transitions

```
FIRST SEEN → ACTIVE
ACTIVE     → UNCHANGED
ACTIVE     → NOT_FOUND
NOT_FOUND  → REAPPEARED
NEW FINDING → ACTIVE
```

### 12.3 Monitoring schedules

| Source type | Suggested cadence |
|---|---|
| Web/public sources | Daily or weekly depending on quota and sensitivity |
| Breach intelligence | Weekly/monthly or on-demand; provider-dependent |
| Broker directories | Weekly/monthly, with source-specific refresh |
| Manual scan | Any time the user starts a fresh scan |

### 12.4 Partial result semantics

A source outage must not erase previous findings or produce a clean result. Example: "Web search unavailable; breach and broker sources completed." The scan is PARTIAL and the unavailable source is recorded for the next retry.

## 13. Evaluation and Testing

### 13.1 What to measure

| Component | Metrics |
|---|---|
| PII extraction | Precision, recall, F1 by entity type |
| Entity resolution | True/false positive and false negative match rates |
| Discovery | Relevant-result rate, duplicate rate, source coverage |
| Threat/severity rules | Expert agreement and false-alarm rate |
| Monitoring | Correct new/removed/reappeared detection rate |
| System | Scan completion rate, connector failure handling, latency |

### 13.2 Controlled evaluation dataset

Use synthetic identities, synthetic public pages/documents, known unrelated identities, partial matches, and injected exposure patterns. This enables repeatable testing without using real people's sensitive data.

### 13.3 Testing priorities

- Unit tests for identifier validators, normalization, fingerprints, TTL/cache keys, and severity rules.
- Integration tests for each external connector and graceful failure behavior.
- Golden tests for GLiNER extraction on representative documents.
- End-to-end tests from scan creation to dashboard finding.
- Security tests for SSRF, malicious documents, prompt-injection content, and sensitive-data leakage in logs.

### 13.4 Acceptance criteria for the SIH demo

- A scan can discover web, breach, and broker-related exposure from one user input set.
- At least one finding includes source evidence, confidence, threat, and recommended action.
- A deliberately unrelated person with a similar name is not presented as a confirmed match.
- The local GLiNER sidecar extracts contextual PII without sending page text to Gemini.
- Gemini produces a useful explanation from the redacted schema only.
- A failed external provider results in a partial scan, not a misleading clean result.

## 14. Implementation Plan and Final MVP Architecture

### 14.1 Build order

| Phase | Deliverables |
|---|---|
| 1. Foundation | Next.js App Router, TypeScript Route Handlers, MongoDB schemas, dashboard shell |
| 2. Discovery | Serper.dev connector, ExposedOrNot connector, broker directory, result normalization |
| 3. PII | Regex/checksum validators, GLiNER-small local FastAPI sidecar, detector fusion |
| 4. Correlation | Identity match logic, exposure records, confidence and provenance |
| 5. Threat + action | Severity/priority rules, recommendation templates, evidence view |
| 6. Explanation | Redacted finding schema + one Gemini explanation call |
| 7. Monitoring | Fingerprints, state changes, repeated scans, notifications/status |
| 8. Hardening | SSRF protections, retention cleanup, logging checks, failure tests |

### 14.2 Final architecture

```
User input
   ↓
Next.js App Router + Route Handlers
   ↓
Scan orchestration
   ├─ Serper.dev / ExposedOrNot / Pwned Passwords / brokers.json
   ├─ Normalize + deduplicate
   └─ Extract PII: regex/checksum + local GLiNER-small sidecar
   ↓
Exposure correlation + threat/severity rules
   ↓
MongoDB Atlas + TTL cache
   ↓
Dashboard / monitoring
   ↓
Gemini explanation (redacted finding schema only)
```

### 14.3 Central engineering position

The implementation should remain small, testable, and defensible: one Next.js application, one MongoDB data store, connector-based discovery, local PII extraction, deterministic severity/action rules, and a tightly constrained explanation model. The strongest SIH demonstration is not the number of technologies used; it is the complete path from discovery to evidence to a useful remediation action.

---

*End of concise technical design*
