import { describe, expect, it } from "vitest";
import { exposureFingerprint } from "./fingerprint";

const base = {
  identityId: "id-1",
  source: "exposedornot",
  exposureType: "CREDENTIAL_EXPOSURE",
  entity: "LinkedInScrape2023",
};

describe("exposureFingerprint (§12.1)", () => {
  it("is deterministic for identical input", () => {
    expect(exposureFingerprint(base)).toBe(exposureFingerprint({ ...base }));
  });

  it("normalizes URL entities so one page hashes identically however discovered", () => {
    const withTracking = exposureFingerprint({
      ...base,
      entity: "https://www.Broker.example/listing/7?utm_source=google",
    });
    const plain = exposureFingerprint({ ...base, entity: "http://broker.example/listing/7" });
    expect(withTracking).toBe(plain);
  });

  it("normalizes casing/whitespace of non-URL entities", () => {
    expect(exposureFingerprint({ ...base, entity: "  LinkedInScrape2023 " })).toBe(
      exposureFingerprint(base),
    );
    expect(exposureFingerprint({ ...base, source: " ExposedOrNot " })).toBe(
      exposureFingerprint(base),
    );
  });

  it("separates users monitoring the same value (identity_id in the hash)", () => {
    expect(exposureFingerprint(base)).not.toBe(exposureFingerprint({ ...base, identityId: "id-2" }));
  });

  it("separates source, exposure type, and entity", () => {
    expect(exposureFingerprint({ ...base, source: "serper" })).not.toBe(exposureFingerprint(base));
    expect(exposureFingerprint({ ...base, exposureType: "BREACH_RECORD" })).not.toBe(
      exposureFingerprint(base),
    );
    expect(exposureFingerprint({ ...base, entity: "OtherBreach" })).not.toBe(
      exposureFingerprint(base),
    );
  });
});
