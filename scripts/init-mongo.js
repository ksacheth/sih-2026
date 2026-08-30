// Idempotent schema bootstrap for the exposure monitor. Executed by the
// mongo-init compose service once the mongo healthcheck reports a writable
// primary — the single-node replica set (required for the multi-document
// transactions in account erasure and identifier deletion) is initiated by
// the mongo service's own healthcheck. Safe to re-run.
const dbName = process.env.MONGO_DB_NAME || "exposure_monitor";

function awaitPrimary() {
  for (let i = 0; i < 120; i++) {
    try {
      if (db.getSiblingDB("admin").runCommand({ hello: 1 }).isWritablePrimary) return;
    } catch (e) {}
    sleep(500);
  }
  throw new Error("mongo has no writable primary; aborting schema bootstrap");
}
awaitPrimary();

const database = db.getSiblingDB(dbName);

const collections = [
  "users", "accounts", "sessions", "verification_tokens",
  "identities", "identifiers", "consents", "verification_codes",
  "scans", "scan_jobs", "sources", "discovery_results", "documents",
  "pii_entities", "identity_matches", "exposures", "recommendations",
  "monitoring", "audit_events", "cache", "rate_limits"
];

for (const name of collections) {
  if (!database.getCollectionNames().includes(name)) database.createCollection(name);
}

database.verification_codes.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
database.audit_events.createIndex({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 30 });
database.cache.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
database.rate_limits.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });

database.identifiers.createIndex({ userId: 1, valueHmac: 1 }, { unique: true });
database.identifiers.createIndex({ userId: 1, identityId: 1 });
database.identities.createIndex({ userId: 1 });
database.scans.createIndex({ userId: 1, createdAt: -1 });
// Unique partial index: at most one QUEUED/RUNNING scan per identity, even
// under concurrent POST /api/scan requests.
database.scans.createIndex(
  { identityId: 1, status: 1 },
  { unique: true, partialFilterExpression: { status: { $in: ["QUEUED", "RUNNING"] } } }
);
// One consent per identifier and purpose keeps concurrent verifications from
// inserting duplicates.
database.consents.createIndex(
  { userId: 1, identifierId: 1, purpose: 1 },
  { unique: true }
);
database.exposures.createIndex({ userId: 1, identityId: 1, fingerprint: 1 }, { unique: true });
database.recommendations.createIndex({ userId: 1, status: 1 });
