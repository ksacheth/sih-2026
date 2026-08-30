# Intelligent Personal Data Exposure Monitor

A privacy-preserving exposure intelligence platform that finds relevant public/breach exposure, correlates evidence, explains the practical threat, and turns findings into concrete user actions.

The full technical design — architecture, data contracts, security controls, and the SIH MVP plan — lives in **[CONTEXT.md](./CONTEXT.md)**.

## Stack

| Layer | Technology |
|---|---|
| Application | Next.js App Router, TypeScript, Route Handlers |
| Interface | Tailwind CSS, shadcn/ui, Recharts |
| Data store | MongoDB Atlas (+ TTL collections for cache/quota guard) |
| External APIs | Serper.dev, ExposedOrNot, optional HIBP, Pwned Passwords range API, brokers.json |
| PII extraction | Regex/checksum rules + GLiNER-small FastAPI sidecar (127.0.0.1) |
| Explanation | One Gemini call over a redacted finding schema |

## Status: base scaffold only

Per the build order in CONTEXT.md §14.1 — no implementation yet, structure only.

```
src/
├── app/
│   ├── api/
│   │   ├── scan/            # POST / GET, [id]/ GET / POST (cancel)
│   │   ├── exposures/       # GET, [id]/ GET
│   │   ├── recommendations/ # GET / PATCH
│   │   ├── monitoring/      # GET / POST / PATCH
│   │   ├── sources/         # GET
│   │   └── health/          # GET
│   ├── globals.css
│   ├── layout.tsx
│   └── page.tsx             # dashboard shell (default page for now)
├── components/ui/           # shadcn/ui primitives (button, card, badge, table, tabs…)
├── data/                    # brokers.json will live here
└── lib/
    ├── connectors/          # DiscoveryConnector contract + Serper/EON/HIBP/Pwned/brokers
    ├── llm/                 # Gemini explanation client (redacted schema only)
    ├── models/              # 15 MongoDB collections (CONTEXT.md §10.1)
    ├── pii/                 # regex/checksum validators, GLiNER client, fusion
    ├── pipeline/            # scan orchestration, correlation, severity, fingerprints
    └── utils.ts
sidecar/                     # GLiNER-small FastAPI sidecar (127.0.0.1)
```

## Getting started

```bash
# 1. Install dependencies
npm install

# 2. Configure environment
cp .env.example .env.local   # fill in MONGODB_URI, APP_SECRET, API keys

# 3. Run the dev server
npm run dev
```

The GLiNER sidecar (later phase) will run separately on loopback:

```bash
cd sidecar && uvicorn main:app --host 127.0.0.1 --port 8000
```

## Non-goals (CONTEXT.md §1.3)

No internet-wide crawling, no private-account access, no stolen-password storage, no automated takedowns, and the LLM is never the final authority for identity, severity, or evidence.
