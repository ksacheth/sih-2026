import { describe, expect, it } from "vitest";
import { applyReScan, markRemediated, type ExposureCandidate } from "./store";
import type { AppDb } from "@/lib/models/db";

// Minimal in-memory Mongo stand-in: equality filters plus $in/$nin, $set,
// findOneAndUpdate(returnDocument:"after") — exactly the operations the
// monitoring store uses. Keeps the lifecycle tests fully offline.
type Doc = Record<string, unknown> & { _id: string };

function matches(doc: Doc, query: Record<string, unknown>): boolean {
  return Object.entries(query).every(([key, expected]) => {
    if (expected && typeof expected === "object" && !Array.isArray(expected)) {
      const ops = expected as Record<string, unknown>;
      if ("$nin" in ops) return !((ops.$nin as unknown[])).includes(doc[key]);
      if ("$in" in ops) return ((ops.$in as unknown[])).includes(doc[key]);
      return false;
    }
    return doc[key] === expected;
  });
}

function fakeDb(collections: Record<string, Doc[]>): AppDb {
  let idCounter = 0;
  const db = {
    collection(name: string) {
      const docs = collections[name] ?? (collections[name] = []);
      return {
        find(query: Record<string, unknown>) {
          return {
            toArray: async () => docs.filter((d) => matches(d, query)),
          };
        },
        async insertOne(doc: Doc) {
          docs.push({ ...doc, _id: `id-${idCounter++}` });
          return { insertedId: docs[docs.length - 1]._id };
        },
        async updateOne(
          query: Record<string, unknown>,
          update: { $set: Record<string, unknown> },
          opts?: { upsert?: boolean },
        ) {
          const target = docs.find((d) => matches(d, query));
          if (!target) {
            if (opts?.upsert) {
              const id = String(query._id ?? `id-${idCounter++}`);
              docs.push({ _id: id, ...update.$set });
              return { matchedCount: 0, upsertedId: id };
            }
            return { matchedCount: 0 };
          }
          Object.assign(target, update.$set);
          return { matchedCount: 1 };
        },
        async findOneAndUpdate(
          query: Record<string, unknown>,
          update: { $set: Record<string, unknown> },
          opts: { returnDocument?: string },
        ) {
          const target = docs.find((d) => matches(d, query));
          if (!target) return null;
          Object.assign(target, update.$set);
          return opts?.returnDocument === "after" ? target : null;
        },
      };
    },
  };
  return db as unknown as AppDb;
}

function candidate(overrides: Partial<ExposureCandidate> = {}): ExposureCandidate {
  return {
    source: "exposedornot",
    exposureType: "CREDENTIAL_EXPOSURE",
    entity: "LinkedInScrape2023",
    entityMasked: "LinkedInScrape2023",
    severity: "CRITICAL",
    identityConfidence: 0.9,
    evidenceConfidence: 1,
    matchLabel: "CONFIRMED",
    threats: ["CREDENTIAL_EXPOSURE"],
    recommendations: [{ action: "CHANGE_PASSWORD" }],
    ruleVersion: "v1.0.0",
    evidence: {
      source: "exposedornot",
      sourceId: "LinkedInScrape2023",
      url: "https://xposedornot.com",
      domain: "xposedornot.com",
      evidenceTier: "document",
      discoveredAt: "2026-08-30T00:00:00.000Z",
    },
    ...overrides,
  };
}

const input = {
  userId: "u1",
  identityId: "id-1",
  scanId: "scan-1",
};

describe("applyReScan — the full lifecycle across consecutive scans", () => {
  it("scan 1 creates FIRST_SEEN exposures; scan 2 re-finding them confirms ACTIVE", async () => {
    const collections: Record<string, Doc[]> = {};
    const db = fakeDb(collections);

    const first = await applyReScan(db, {
      ...input,
      candidates: [candidate(), candidate({ entity: "AdobeBreach", exposureType: "BREACH_RECORD" })],
    });
    expect(first).toMatchObject({ created: 2, updated: 0 });
    let docs = await collections.exposures;
    expect(docs.map((d) => d.status).sort()).toEqual(["FIRST_SEEN", "FIRST_SEEN"]);

    const second = await applyReScan(db, {
      ...input,
      scanId: "scan-2",
      candidates: [candidate(), candidate({ entity: "AdobeBreach", exposureType: "BREACH_RECORD" })],
      evaluatedSources: ["exposedornot"],
    });
    expect(second).toMatchObject({ created: 0, updated: 2 });
    docs = await collections.exposures;
    expect(docs.map((d) => d.status).sort()).toEqual(["ACTIVE", "ACTIVE"]);
  });

  it("§12.4: an unevaluated source outage never marks its exposures absent", async () => {
    const collections: Record<string, Doc[]> = {};
    const db = fakeDb(collections);
    await applyReScan(db, {
      ...input,
      candidates: [candidate({ source: "brokers", exposureType: "DATA_BROKER_LISTING", entity: "radaris.com", entityMasked: "Radaris", severity: "MEDIUM", threats: ["PRIVACY_COMMERCIALIZATION"] })],
    });

    // scan-2 re-finds it → ACTIVE
    await applyReScan(db, {
      ...input,
      scanId: "scan-2",
      candidates: [candidate({ source: "brokers", exposureType: "DATA_BROKER_LISTING", entity: "radaris.com", entityMasked: "Radaris", severity: "MEDIUM", threats: ["PRIVACY_COMMERCIALIZATION"] })],
      evaluatedSources: ["brokers"],
    });
    expect((await Promise.resolve(collections.exposures))[0].status).toBe("ACTIVE");

    // scan-3: web search down, brokers not really evaluated → exposure untouched
    await applyReScan(db, {
      ...input,
      scanId: "scan-3",
      candidates: [],
      evaluatedSources: ["serper"],
    });
    expect(collections.exposures[0].status).toBe("ACTIVE");

    // scan-4: brokers completes with zero findings → NOT_FOUND (count 1)
    const summary = await applyReScan(db, {
      ...input,
      scanId: "scan-4",
      candidates: [],
      evaluatedSources: ["brokers"],
    });
    expect(collections.exposures[0].status).toBe("NOT_FOUND");
    expect(collections.exposures[0].notFoundCount).toBe(1);
    expect(summary.updated).toBe(1);
  });

  it("NOT_FOUND → CLOSED after 3 consecutive misses, REAPPEARED (severity bump) if it returns", async () => {
    const collections: Record<string, Doc[]> = {};
    const db = fakeDb(collections);
    await applyReScan(db, { ...input, candidates: [candidate({ severity: "HIGH", source: "brokers", exposureType: "DATA_BROKER_LISTING", entity: "radaris.com", entityMasked: "Radaris", threats: ["PRIVACY_COMMERCIALIZATION"] })] });

    for (let i = 2; i <= 3; i++) {
      await applyReScan(db, {
        ...input,
        scanId: `scan-${i}`,
        candidates: [],
        evaluatedSources: ["brokers"],
      });
    }
    let doc = (await collections.exposures)[0];
    expect(doc.status).toBe("NOT_FOUND");
    expect(doc.notFoundCount).toBe(2);

    const fourth = await applyReScan(db, {
      ...input,
      scanId: "scan-4",
      candidates: [],
      evaluatedSources: ["brokers"],
    });
    doc = (await collections.exposures)[0];
    expect(doc.status).toBe("CLOSED");
    expect(fourth).toMatchObject({ closed: 1 });

    const fifth = await applyReScan(db, {
      ...input,
      scanId: "scan-5",
      candidates: [candidate({ severity: "HIGH", source: "brokers", exposureType: "DATA_BROKER_LISTING", entity: "radaris.com", entityMasked: "Radaris", threats: ["PRIVACY_COMMERCIALIZATION"] })],
      evaluatedSources: ["brokers"],
    });
    doc = (await collections.exposures)[0];
    expect(doc.status).toBe("REAPPEARED");
    expect(doc.severity).toBe("CRITICAL"); // bumped one level
    expect(fifth).toMatchObject({ reappeared: 1 });
    expect(doc.reappearedAt).toBeInstanceOf(Date);
  });

  it("REMEDIATED is sticky while absent but escalates when the removal did not hold", async () => {
    const collections: Record<string, Doc[]> = {};
    const db = fakeDb(collections);
    await applyReScan(db, {
      ...input,
      candidates: [candidate({ source: "brokers", exposureType: "DATA_BROKER_LISTING", entity: "radaris.com", entityMasked: "Radaris", severity: "MEDIUM", threats: ["PRIVACY_COMMERCIALIZATION"] })],
    });
    const exposureId = (await collections.exposures)[0]._id as string;

    const marked = await markRemediated(db, { userId: "u1", exposureId });
    expect(marked).toMatchObject({ status: "REMEDIATED" });

    await applyReScan(db, {
      ...input,
      scanId: "scan-2",
      candidates: [],
      evaluatedSources: ["brokers"],
    });
    expect((await collections.exposures)[0].status).toBe("REMEDIATED");

    const summary = await applyReScan(db, {
      ...input,
      scanId: "scan-3",
      candidates: [candidate({ source: "brokers", exposureType: "DATA_BROKER_LISTING", entity: "radaris.com", entityMasked: "Radaris", severity: "MEDIUM", threats: ["PRIVACY_COMMERCIALIZATION"] })],
      evaluatedSources: ["brokers"],
    });
    const doc = (await collections.exposures)[0];
    expect(doc.status).toBe("REAPPEARED");
    expect(doc.severity).toBe("HIGH"); // bumped from MEDIUM
    expect(summary).toMatchObject({ reappeared: 1 });
  });

  it("writes the per-identity monitoring snapshot (§10.1)", async () => {
    const collections: Record<string, Doc[]> = {};
    const db = fakeDb(collections);
    await applyReScan(db, { ...input, candidates: [candidate()] });
    const snapshot = collections.monitoring[0];
    expect(snapshot).toMatchObject({ _id: "mon:id-1", userId: "u1", identityId: "id-1" });
    expect(Object.keys(snapshot.states as Record<string, unknown>)).toHaveLength(1);
  });
});
