const dbName = process.env.MONGO_INITDB_DATABASE || "exposure_monitor";
const db = db.getSiblingDB(dbName);

const collections = [
  "users", "identities", "identifiers", "consents", "verification_codes",
  "scans", "scan_jobs", "sources", "discovery_results", "documents",
  "pii_entities", "identity_matches", "exposures", "recommendations",
  "monitoring", "audit_events", "cache"
];

for (const name of collections) {
  if (!db.getCollectionNames().includes(name)) db.createCollection(name);
}

db.verification_codes.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
db.audit_events.createIndex({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 30 });
db.cache.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });

db.identifiers.createIndex({ userId: 1, valueHmac: 1 }, { unique: true });
db.identifiers.createIndex({ userId: 1, identityId: 1 });
db.identities.createIndex({ userId: 1 });
db.scans.createIndex({ userId: 1, createdAt: -1 });
db.scans.createIndex(
  { identityId: 1, status: 1 },
  { partialFilterExpression: { status: { $in: ["QUEUED", "RUNNING"] } } }
);
db.exposures.createIndex({ userId: 1, identityId: 1, fingerprint: 1 }, { unique: true });
db.recommendations.createIndex({ userId: 1, status: 1 });