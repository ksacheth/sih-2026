# Intelligent Personal Data Exposure Monitor — Task Allocation & Execution Plan (TASKS.md)

**Project:** Intelligent Personal Data Exposure Monitor (SIH 2026)  
**Architecture:** Next.js App Router (Node runtime) + FastAPI GLiNER Sidecar + MongoDB  
**Team Composition (6 People):**
1. **ML Engineer 1 (ML-1)** — PII Extraction, Regex/Checksums, GLiNER Sidecar, & Fusion
2. **ML Engineer 2 (ML-2)** — Entity Resolution, Name Matcher, Threat & Severity Engine, & Gemini LLM Layer
3. **Fullstack Developer (Dev-1)** — Platform Core, Auth.js, Verification, Scoped APIs, DPDP Erasure & Frontend Dashboard
4. **Dev / DevOps Hybrid (Dev-2)** — Discovery Connectors, Fetch Guard/SSRF, Async Scan Pipeline Orchestrator & Monitoring State Machine
5. **DevOps Engineer (DevOps)** — Docker Compose, GLiNER Sidecar Containerization (Pre-baked weights), Mongo Init/TTL, Health Probes, CI/CD & Live Demo Failover Harness
6. **Fast-Sprint Specialist (4-Hour Contributor)** — Golden Evaluation Corpus, Synthetic Demo Decoys, `brokers.json` Curation & Offline Fixtures Dataset

---

## 1. Role Matrix & Ownership Overview

| Member | Primary Focus | Core Files / Modules Owned | Key Deliverables |
|---|---|---|---|
| **ML-1** | PII Extraction Pipeline | `sidecar/`, `lib/extraction/`, `lib/validators/` | FastAPI GLiNER service, Regex+Verhoeff/checksum rules, PII Fusion layer |
| **ML-2** | Correlation, Rules & LLM | `lib/correlation/`, `lib/rules/`, `lib/llm/` | Indian token-set name matcher, confidence formula, severity engine, Redacted Gemini explanation + fallback |
| **Dev-1** | Platform, Auth & UI | `app/`, `components/`, `lib/auth/`, `models/` | Magic link auth, 6-digit OTP verification, DPDP erasure, Rate limiting, Responsive Shadcn/Tailwind Dashboard |
| **Dev-2** | Discovery & Scan Pipeline | `lib/connectors/`, `lib/pipeline/`, `lib/monitoring/` | Serper, ExposedOrNot, Broker matcher, SSRF fetch guard, in-process async orchestrator, monitoring state machine |
| **DevOps** | Infra, Reliability & Demo Setup | `docker-compose.yml`, `sidecar/Dockerfile`, `scripts/` | Docker Compose stack, Sidecar image with pre-downloaded weights, MongoDB TTL indexes, Demo failover scripts |
| **4-Hour Sprint** | Golden Data & Fixtures (H0–H4) | `data/fixtures/`, `data/brokers.json`, `data/eval/` | 20 synthetic profile pages, 5 near-miss decoys, 30-50 broker directory entries, mock API response recordings |

---

## 2. Detailed Task Breakdown by Person

---

### Person 1: ML Engineer 1 (ML-1) — Extraction & PII Engineering

#### Objective
Build deterministic regex and checksum validators, set up the GLiNER-small FastAPI sidecar service, and implement the multi-detector fusion layer.

#### Tasks & Deliverables
1. **Deterministic Regex & Checksum Recognizers (`lib/validators/`)**
   - [ ] Email regex pattern with RFC-compliant validation and normalization.
   - [ ] Phone regex with Google `libphonenumber-js` or regex + E.164 normalization (+91 default country code).
   - [ ] Aadhaar pattern validator with Verhoeff checksum algorithm validation.
   - [ ] PAN (Permanent Account Number) regex matching and structure checksum.
   - [ ] Return candidate structured object: `{ type, rawValue, normalizedValue, confidence, detector: "regex_checksum" }`.
2. **GLiNER-small Sidecar Service (`sidecar/app.py`)**
   - [ ] Build FastAPI microservice listening on `127.0.0.1:8000`.
   - [ ] Initialize `urchade/gliner_small-v2.1` on startup with model caching.
   - [ ] Expose `GET /health` returning `{ status: "ok", model: "gliner_small-v2.1" }`.
   - [ ] Expose `POST /extract` accepting `{ text: string, threshold?: number }`.
   - [ ] Extract contextual entity types: `["person", "organization", "location", "address", "email", "phone_number"]`.
   - [ ] Set 15-second timeout on requests; return typed entity offsets and scores.
3. **Extraction Client & Fusion Engine (`lib/extraction/fusion.ts`)**
   - [ ] Node.js client calling sidecar at `http://127.0.0.1:8000/extract` with 15s abort controller.
   - [ ] Graceful fallback: If sidecar is offline/times out, mark scan source as `sidecar_down` (PARTIAL scan) and proceed with deterministic regex outputs only.
   - [ ] Fusion layer: Merge overlapping regex and GLiNER entity candidates, preserving detector provenance and preferring deterministic matches for structured IDs.
   - [ ] Stated limitations metadata: Add flags for English-centricity and no-OCR limitations.

---

### Person 2: ML Engineer 2 (ML-2) — Entity Resolution, Rules Engine & LLM Layer

#### Objective
Build the false-positive-resistant entity correlation engine, deterministic confidence scoring, threat/severity categorization, and privacy-preserving Gemini LLM explanations.

#### Tasks & Deliverables
1. **Name Matching & Normalization Engine (`lib/correlation/nameMatcher.ts`)**
   - [ ] Token-set name normalization: lowercase, remove diacritics/punctuation, split tokens.
   - [ ] Initials expansion: Match single letter initials against full first/last names (e.g., "R. Kumar" ↔ "Rahul Kumar").
   - [ ] Top-100 Indian common name penalty dictionary (`lib/correlation/indianNames.ts`) — apply penalty if both first and last names are ultra-common (e.g., Rahul, Kumar, Sharma, Singh).
   - [ ] **HARD RULE:** Name similarity alone caps at `POTENTIAL` (never `CONFIRMED`). `CONFIRMED` requires exact identifier (email/phone/username) OR name + ≥2 corroborating signals (org, location, co-occurrence).
2. **Deterministic Confidence & Threat Scoring (`lib/rules/confidence.ts`, `lib/rules/threats.ts`)**
   - [ ] Implement versioned confidence derivation:
     - Base scores: exact email (`0.90`), exact phone (`0.90`), exact username (`0.70-0.85`), attested phone (`0.60`), name-only (`0.30`).
     - Corroborations: org match (`+0.05`), location match (`+0.03`), ≥2 independent sources (`+0.05`).
     - Penalties: common-name penalty (`-0.10`).
     - Caps: overall `0.98`, name-only `0.50`, attested-phone-only `0.75`.
   - [ ] Rule-based threat classification:
     - `CREDENTIAL_EXPOSURE` (breach dump) -> High/Critical urgency.
     - Public phone + email -> `TARGETED_PHISHING` / `SOCIAL_ENGINEERING`.
     - Name + address + location -> `PHYSICAL_TARGETING` / `STALKING_RISK`.
     - Multi-source public fields -> `IDENTITY_FRAUD_ENABLEMENT`.
   - [ ] Recommendation mapper: map exposure/threat types to concrete actionable remediation templates (`REQUEST_REMOVAL`, `ENABLE_MFA`, `OPT_OUT_BROKER`, etc.).
   - [ ] Stamp all outputs with `rule_version` (e.g. `v1.0.0`).
3. **LLM Explanation Layer with Redacted Schema (`lib/llm/explain.ts`)**
   - [ ] Gemini API integration using `@google/genai` or `@google/generative-ai`.
   - [ ] **Hard Privacy Boundary:** Input schema strictly redacted (pass only risk level, exposure type, domain, threats, confidence; **NEVER** pass raw PII, full names, emails, phones, or document text).
   - [ ] Post-scan asynchronous trigger for top ≤5 findings by severity.
   - [ ] Deterministic template fallback generator: If Gemini is slow, rate-limited, or unavailable, seamlessly render structured templates without failing the scan or blocking UI.

---

### Person 3: Fullstack Developer (Dev-1) — Platform, Trust, API & UI Dashboard

#### Objective
Build the Next.js application core, Auth.js magic-link authentication, identifier verification subsystem, rate limiting, DPDP erasure API, and the full reactive frontend dashboard.

#### Tasks & Deliverables
1. **Data Models & Database Layer (`models/`, `lib/db.ts`)**
   - [ ] MongoDB connection helper with connection pooling.
   - [ ] Schemas & indexes: `User`, `Identifier`, `Identity`, `Consent`, `Scan`, `Exposure`, `Recommendation`, `VerificationCode`, `AuditEvent`.
   - [ ] Enforce unique index `{ userId, type, valueHmac }` on identifiers, and partial unique index on active scans `{ identityId }` where status is `QUEUED` or `RUNNING`.
2. **Auth & Identifier Verification APIs (`app/api/auth/`, `app/api/identifiers/`)**
   - [ ] Auth.js magic-link email login with dev mode server-console fallback.
   - [ ] `POST /api/identifiers`: Add email/phone/username. Generate 6-digit code with 10-min TTL (hashed at rest).
   - [ ] Dev mode fallback: Print 6-digit code to server console and API response for instant testing.
   - [ ] `POST /api/identifiers/:id/verify`: Verify 6-digit code, create `Consent` record, mark status `VERIFIED`.
   - [ ] Phone attestation support: Mark phone as `ATTESTED` only if user has ≥1 verified email.
   - [ ] `DELETE /api/identifiers/:id`: Delete identifier and revoke consent.
3. **DPDP Erasure & Security Controls (`app/api/account/`, `lib/security/`)**
   - [ ] `DELETE /api/account`: Atomic erasure of user's identifiers, scans, exposures, recommendations, and consent.
   - [ ] Response masking utility: Ensure all API responses return masked PII only (`r***@example.com`, `+91 •••• 4321`).
   - [ ] User rate-limiting middleware: Max 5 scans/day and 20 OTP codes/day.
4. **Interactive UI Dashboard (`app/`, `components/`)**
   - [ ] Setup Tailwind CSS, shadcn/ui components (Cards, Badges, Tables, Dialogs, Accordions, Tabs, Tooltips).
   - [ ] **Auth & Identifier Management View:** Magic link input, identifier verification modal with 6-digit input, attestation checkbox.
   - [ ] **Scan Launch & Live Progress Bar:** Start scan button, live polling (`GET /api/scan/:id` every 2s) with per-source status spinners (Serper, ExposedOrNot, Brokers, GLiNER).
   - [ ] **Exposures & Findings Grid:** Filter by severity (Critical, High, Medium, Low), confidence badges (`CONFIRMED` vs `POTENTIAL`), evidence tier tags (`Document` vs `Snippet`).
   - [ ] **Evidence & Detail Drawer:** Display source domain, date, matched snippet, threats, AI explanation card (or deterministic fallback), and action checklist.
   - [ ] **Remediation & Re-Scan Action Center:** Button to mark finding as `REMEDIATED`, trigger manual re-scan, and visualize state transitions (`REAPPEARED` alert).
   - [ ] **Account Settings & DPDP Erasure Modal:** One-click data deletion with confirmation dialog.

---

### Person 4: Dev / DevOps Hybrid (Dev-2) — Discovery Connectors & Async Pipeline

#### Objective
Build the external discovery connectors, fetch guard/SSRF protector, in-process async scan pipeline orchestrator with incremental persistence, and the monitoring state machine.

#### Tasks & Deliverables
1. **Discovery Connectors (`lib/connectors/`)**
   - [ ] `DiscoveryConnector` interface definition.
   - [ ] **Serper.dev Web Search Connector (`lib/connectors/serper.ts`):**
     - Targeted query generator (≤6 queries per scan: `"email"`, `"username"`, `"name" "email"`, `"email" filetype:pdf`, `"name" "org"`).
     - Quote values and sanitize search operators (`site:`, `OR`, `-`).
     - Query cache layer backed by Mongo TTL collection using `HMAC(source + query)`.
   - [ ] **ExposedOrNot Breach Connector (`lib/connectors/exposedOrNot.ts`):**
     - Query ExposedOrNot API for breached email domains and leak records.
     - Extract breach metadata and tag `CREDENTIAL_EXPOSURE` if dump includes passwords.
     - Graceful PARTIAL scan handling if API is unreachable.
   - [ ] **Data Broker Matcher (`lib/connectors/brokers.ts`):**
     - Load `data/brokers.json` (30-50 domains).
     - Match discovered result domains against broker list; surface direct opt-out URL.
   - [ ] **Fixture Mode Switch:** If `FIXTURES=1` or API key missing, seamlessly route connector calls to recorded JSON files in `data/fixtures/`.
2. **Fetch Guard & Two-Tier Evidence Processor (`lib/pipeline/fetcher.ts`)**
   - [ ] SSRF protector: Validate URLs before fetching, block local/private IP ranges (`127.0.0.1`, `10.0.0.0/8`, `192.168.0.0/16`, `169.254.169.254`), block `file://`.
   - [ ] Denylist filter: Skip fetching known login-walled domains (LinkedIn, Facebook, Instagram, Twitter/X).
   - [ ] Enforce fetch limits: Max 10 pages/scan, max 512KB/page, 10s timeout/page.
   - [ ] Two-Tier Evidence Assignment:
     - Fetched & parsed page -> `evidence_tier: "document"`.
     - Blocked / failed / denylisted fetch -> fallback to search snippet as `evidence_tier: "snippet"`.
   - [ ] Canonical URL normalizer: Strip UTM parameters, tracking query params, remove `www.`, normalize protocols.
3. **Async Scan Orchestrator (`lib/pipeline/orchestrator.ts`)**
   - [ ] `POST /api/scan` handler: Verify caller owns identifiers, check all are `VERIFIED`/`ATTESTED`, enforce daily rate limit, create scan record (`QUEUED`), return `202 { scan_id }` immediately.
   - [ ] In-process fire-and-forget runner (`void runScanPipeline(scanId)`).
   - [ ] **Incremental Persistence:** Persist findings to MongoDB per source as each connector completes.
   - [ ] Scan state machine: `QUEUED` -> `RUNNING` -> (`COMPLETED` | `PARTIAL` | `FAILED`).
   - [ ] Graceful cancellation: Handle `POST /api/scan/:id` cancel flag between pipeline stages.
   - [ ] Boot crash recovery: On app startup, auto-mark any scan stuck in `RUNNING` for >10 minutes as `PARTIAL`.
4. **Monitoring & Re-Scan Fingerprint Engine (`lib/monitoring/stateMachine.ts`)**
   - [ ] Fingerprint generator: `SHA256(identity_id + normalized_source + exposure_type + normalized_entity)`.
   - [ ] Re-scan state machine transitions:
     - `FIRST_SEEN` -> `ACTIVE`
     - `ACTIVE` -> `UNCHANGED` or `NOT_FOUND`
     - `NOT_FOUND` -> `REAPPEARED` (trigger severity bump alert)
     - `ACTIVE` -> `REMEDIATED` (on user mark)
     - `REMEDIATED` -> `REAPPEARED` (if seen again on re-scan)
     - `NOT_FOUND` for 3 consecutive scans -> `CLOSED`.

---

### Person 5: DevOps Engineer (DevOps) — Infrastructure, Containers & Demo Reliability

#### Objective
Containerize the entire stack with Docker Compose, build the GLiNER sidecar image with pre-downloaded weights, configure Mongo TTL & health checks, and build automated failure demo harnesses.

#### Tasks & Deliverables
1. **GLiNER Sidecar Dockerization (`sidecar/Dockerfile`)**
   - [ ] Multi-stage Python 3.11 slim Dockerfile.
   - [ ] **Bake weights in build:** Pre-download `urchade/gliner_small-v2.1` into the Docker image so first run requires 0 network calls.
   - [ ] Expose port `8000`, configure Uvicorn with worker timeouts.
2. **Next.js App Dockerfile & Compose Stack (`Dockerfile`, `docker-compose.yml`)**
   - [ ] Next.js standalone Node production build Dockerfile.
   - [ ] `docker-compose.yml` orchestrating 3 services:
     - `app`: Next.js frontend/backend (port 3000)
     - `sidecar`: FastAPI GLiNER (port 8000, 127.0.0.1 binding)
     - `mongo`: MongoDB 7.0 (port 27017 with persistent volume)
   - [ ] Configure container restart policies, environment variables (`FIXTURES`, `DATABASE_URL`, `SIDECAR_URL`, `GEMINI_API_KEY`, `SERPER_API_KEY`).
3. **MongoDB Initialization & Health Checks (`scripts/init-mongo.js`, `app/api/health/`)**
   - [ ] Mongo startup script to create collections and ensure TTL indexes (`cache` 6h, `verification_codes` 10m, `audit_events` 30d).
   - [ ] System Health Endpoint `/api/health`: Probe MongoDB ping + Sidecar `/health` endpoint; return comprehensive status JSON.
4. **Demo Reliability & Failover Harness (`scripts/demo-harness.sh`)**
   - [ ] Seed script: Populate Mongo with demo user and sample scan history for instant cold-start rehearsal.
   - [ ] Rehearsal mode toggler: One-line script to toggle between `FIXTURES=1` and live external APIs.
   - [ ] Stage Chaos Script: One-click script to kill sidecar container (`docker compose stop sidecar`) during live pitch to demonstrate graceful degradation to `PARTIAL` scan with regex-only findings.
   - [ ] Automated end-to-end smoke test script validating scan lifecycle on fixtures.

---

### Person 6: Fast-Sprint Specialist (4-Hour Contributor) — Golden Corpus & Demo Assets

#### Time Window: Hours H0 to H4 (First 4 Hours)
#### Objective
Deliver the complete evaluation ground-truth dataset, synthetic profile pages, near-miss decoys for Indian name testing, data-broker catalog, and fixture mocks.

#### Tasks & Deliverables (All completed by Hour 4)
1. **Curated Data Brokers Catalog (`data/brokers.json`)**
   - [ ] Compile 30–50 top data broker and public directory domains (e.g., Truecaller, Radaris, Whitepages, FastPeopleSearch, PeekYou, Spokeo, AnyWho, Indian public directories).
   - [ ] For each entry, provide: `{ name, domain, category, optOutUrl, instructions }`.
2. **Golden Evaluation Corpus & Decoy Pages (`data/eval/corpus/`)**
   - [ ] Create 20 synthetic public HTML/text pages with seeded PII:
     - 8 public resume/portfolio pages (with emails, phones, education, organization).
     - 6 paste-site dumps (with emails, usernames, leak references, Aadhaar/PAN mock structures).
     - 3 conference/event attendee lists.
     - 3 data broker listing pages.
   - [ ] Create **5 Near-Miss Indian Decoy Profiles** (crucial for evaluating name matcher):
     - Example: Monitored target is `"Rahul Kumar" (ABC Tech, Delhi)`.
     - Decoy 1: `"Rahul Kumar"` (XYZ Corp, Mumbai — different person).
     - Decoy 2: `"R. Kumar"` (Government College, Pune — different person).
     - Decoy 3: `"Rahul Sharma"` (ABC Tech — same company, different name).
     - Decoy 4: `"A. Rahul Kumar"` (Freelancer — different person).
     - Decoy 5: `"Rahul K."` (Student — different person).
   - [ ] Ground truth annotations file `data/eval/ground_truth.json` tagging expected entities and correct match status (`CONFIRMED` vs `POTENTIAL` vs `NO_MATCH`).
3. **Connector Recorded Fixture Dataset (`data/fixtures/`)**
   - [ ] `serper_response.json`: Mock Serper responses for exact email, phone, name+org, and PDF search queries.
   - [ ] `exposedornot_response.json`: Mock breach records for breached email scenario (with `CREDENTIAL_EXPOSURE`) and clean email scenario.
   - [ ] `gliner_extracted.json`: Pre-computed entity extraction for corpus pages.
4. **Handoff Document (`data/README.md`)**
   - [ ] Document corpus structure, test identities (e.g. `test-rahul@example.com`), and verify all mock files match TypeScript connector interfaces before exit at H4.

---

## 3. Hour-by-Hour Synchronized 24-Hour Timeline

```
[H0-H4] Rapid Foundation & Golden Assets  --->  (4-Hour Contributor completes & exits)
[H4-H8] Walking Skeleton & Connectors     --->  Checkpoint 1: Full pipeline on fixtures
[H8-H14] Real Pipeline & Correlation      --->  Checkpoint 2: Live APIs + GLiNER sidecar
[H14-H18] Hardening, UI Polish & Security --->  SSRF, Masking, Partial scan tests
[H18-H21] Rehearsals & Backup Recording   --->  Checkpoint 3: 3x dry runs + demo video
[H21-H24] Freeze & Pitch Polish          --->  Final presentation ready
```

| Time Window | Milestone | ML-1 (Extraction) | ML-2 (Rules & LLM) | Dev-1 (Platform & UI) | Dev-2 (Discovery & Pipe) | DevOps (Infra) | 4-Hr Contributor (Data) |
|---|---|---|---|---|---|---|---|
| **H0–H2** | **Project Scaffold & Data Kickoff** | Write regex validators (email, phone, Aadhaar, PAN) | Stub token-set name matcher & test cases | Setup Next.js, Mongo schemas & indexes | Scaffold connector interfaces & query builder | Dockerfile for GLiNER (bake weights), docker-compose | Curate `brokers.json` & first 10 synthetic corpus pages |
| **H2–H4** | **Walking Subsystems & Data Handoff** | FastAPI GLiNER sidecar `/extract` endpoint | Implement Indian common name penalty & initials rule | Auth.js magic-link & 6-digit OTP endpoints + dev console | Serper & ExposedOrNot connectors + fixture loader | Compose stack up with Mongo & Sidecar, verify `/health` | Finish 20 corpus pages, 5 near-miss decoys & recorded fixtures. **Exit & Handoff** |
| **H4–H8** | **Checkpoint 1: Fake Pipeline E2E** | Multi-detector fusion (Regex + GLiNER) | Confidence scoring formula & threat categorizer | Identifier verification UI + Scan start button & polling | Async orchestrator (`POST /api/scan` 202, fire-and-forget) + fetch guard | Automated smoke test script on fixture pipeline | *(Completed)* |
| **H8–H12** | **Full Feature Integration** | GLiNER client error handling & `sidecar_down` PARTIAL state | Recommendation mapper & Redacted Gemini LLM prompt | Exposures list, severity badges & evidence drawer UI | Incremental Mongo persistence per source + SSRF guard | Mongo TTL index verification & container health monitors | *(Completed)* |
| **H12–H16** | **State Machine & Hardening** | Golden dataset precision/recall eval (Target: F1 ≥ 0.80) | Fallback deterministic explanation generator | Remediation toggle UI, re-scan trigger & DPDP erasure button | Re-scan state machine (`REMEDIATED` -> `REAPPEARED` escalation) | Chaos test script: Sidecar kill test (`docker compose stop sidecar`) | *(Completed)* |
| **H16–H18** | **Checkpoint 2: Real Pipeline E2E** | Fix extraction false positives on Indian names | Validate name-only decoy rule (0 false CONFIRMED) | End-to-end UI polish, error states & empty states | Crash recovery on boot + scan cancel flag support | Rehearsal environment toggles (`FIXTURES=1` vs LIVE) | *(Completed)* |
| **H18–H21** | **Checkpoint 3: Rehearsals & Dry Runs** | Support demo rehearsal triage | Support demo rehearsal triage | Dry run with UI, fix layout glitches | Dry run pipeline timings under 90s budget | Record backup demo video, verify cold start on clean machine | *(Completed)* |
| **H21–H24** | **Code Freeze & Pitch Preparation** | Code freeze; prepare extraction architecture slides | Code freeze; prepare correlation & LLM boundary slides | Code freeze; assist with live demo UI flow | Code freeze; assist with connector resilience slides | Code freeze; lock compose environment & stand by | *(Completed)* |

---

## 4. Interface Contracts & Shared Data Schemas

To prevent integration mismatch, all 6 team members will adhere strictly to these TypeScript definitions:

### 4.1 Discovery Result (`lib/connectors/types.ts`)
```ts
export interface DiscoveryResult {
  source: "serper" | "exposedornot" | "brokers";
  sourceId: string;
  url: string;
  domain: string;
  title: string;
  snippet: string;
  discoveredAt: string;
  contentType?: "text/html" | "application/pdf" | "breach_record";
  evidenceTier: "document" | "snippet";
  rawMetadata?: Record<string, any>;
}
```

### 4.2 Extracted Entity (`lib/extraction/types.ts`)
```ts
export interface ExtractedEntity {
  type: "PERSON" | "ORGANIZATION" | "LOCATION" | "ADDRESS" | "EMAIL" | "PHONE" | "AADHAAR" | "PAN";
  rawValue: string;
  normalizedValue: string;
  detector: "regex" | "checksum" | "gliner" | "fused";
  detectorConfidence: number;
  offsetStart?: number;
  offsetEnd?: number;
}
```

### 4.3 Redacted Finding Schema for Gemini (`lib/llm/types.ts`)
```ts
export interface RedactedFindingForLLM {
  riskLevel: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  exposureType: string; // e.g. "PUBLIC_PHONE_AND_EMAIL", "BREACH_CREDENTIAL"
  identityConfidence: number;
  evidenceConfidence: number;
  evidenceTier: "document" | "snippet";
  sourceDomains: string[];
  threats: string[]; // e.g. ["TARGETED_PHISHING", "ACCOUNT_TAKEOVER"]
  recommendedActionCodes: string[]; // e.g. ["REQUEST_REMOVAL", "ENABLE_MFA"]
}
```

### 4.4 Exposure Document in MongoDB (`models/Exposure.ts`)
```ts
export interface ExposureDocument {
  _id?: string;
  identityId: string;
  userId: string;
  fingerprint: string; // SHA256(identity_id + normalized_source + exposure_type + normalized_entity)
  exposureType: string;
  piiType: string;
  ruleVersion: string;
  identityConfidence: number;
  evidenceConfidence: number;
  evidenceTier: "document" | "snippet";
  matchLabel: "CONFIRMED" | "POTENTIAL";
  severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  threats: string[];
  recommendations: {
    actionCode: string;
    title: string;
    description: string;
    optOutUrl?: string;
    status: "PENDING" | "REMEDIATED";
  }[];
  explanation?: {
    summary: string;
    sourceRelevance: string;
    isAiGenerated: boolean;
  };
  evidence: {
    domain: string;
    url: string;
    snippet: string;
    discoveredAt: Date;
  }[];
  status: "FIRST_SEEN" | "ACTIVE" | "UNCHANGED" | "NOT_FOUND" | "REAPPEARED" | "REMEDIATED" | "CLOSED";
  consecutiveNotFoundCount: number;
  firstSeenAt: Date;
  lastSeenAt: Date;
}
```

---

## 5. Live Demo Script & Failover Checklist (6 Minutes)

All team members must align their components to support the following exact demo flow:

| Step | Time | Action / Feature Shown | Responsible Owner | Failover Safety Net |
|---|---|---|---|---|
| 1 | 0:00–0:45 | **Magic-link Login & Verification Gate:** Log in; enter email; input 6-digit OTP. Attempt to scan unverified phone -> Rejected with validation error. Attest phone -> Approved. | Dev-1 | If email service is slow, OTP is printed directly in the server console and API debug response. |
| 2 | 0:45–1:45 | **Trigger Async Scan & Live Progress:** Click "Scan Exposure". Show `202 Accepted` and per-source progress indicators updating live via 2s polling. | Dev-2 & Dev-1 | If APIs rate-limit, `FIXTURES=1` ensures instant deterministic responses. |
| 3 | 1:45–3:00 | **Correlated Findings & Name Matcher Test:** Show high-severity findings with document/snippet evidence tiers. Show that decoy identical name is tagged `POTENTIAL` (never `CONFIRMED`). | ML-2 | Hardcoded Indian common-name rule ensures decoy passes test deterministically. |
| 4 | 3:00–3:45 | **Gemini Explanation & Redacted Privacy Boundary:** Inspect finding explanation. Highlight that Gemini received zero raw PII (only redacted schema). Show deterministic fallback. | ML-2 | Deterministic template renders automatically if Gemini API times out. |
| 5 | 3:45–4:30 | **Remediation & Re-Scan Escalation:** Click "Mark as Remediated" on an exposure. Trigger manual re-scan. Show `REAPPEARED` status trigger with escalated warning. | Dev-2 & Dev-1 | State machine runs locally in Mongo; 100% reproducible. |
| 6 | 4:30–5:15 | **Graceful Degradation (Chaos Test):** Stop sidecar container (`docker compose stop sidecar`). Trigger scan -> System finishes with `PARTIAL` status and regex findings intact. | DevOps & ML-1 | Pipeline catches timeout and flags source as `sidecar_down` without crashing. |
| 7 | 5:15–6:00 | **DPDP Account Erasure & Pitch Conclusion:** Click "Delete Account & Data". Show instant full purge of all identifiers, scans, and findings. | Dev-1 | Atomic MongoDB delete query leaves only hashed security audit logs. |

---

## 6. Definition of Done (DoD)

- [x] Zero feature cuts from the technical specification (`CONTEXT.md`).
- [x] Every API endpoint strictly enforces session user scoping.
- [x] All raw identifiers are masked in API responses and logs.
- [x] Full offline testing enabled via `FIXTURES=1`.
- [x] Docker compose runs on any clean machine with `docker compose up`.
