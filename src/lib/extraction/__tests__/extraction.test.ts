import { describe, it, expect, afterEach, vi } from "vitest";
import {
  fuseExtractedEntities,
  extractAndFusePII,
  EXTRACTION_LIMITATIONS,
} from "../fusion";
import { callGlinerSidecar, buildCodePointToUtf16Map } from "../client";
import type { ExtractedEntity, GlinerRawEntity } from "../types";

function detEntity(partial: Partial<ExtractedEntity> & Pick<ExtractedEntity, "type" | "offsetStart" | "offsetEnd">): ExtractedEntity {
  return {
    rawValue: partial.rawValue ?? "value",
    normalizedValue: partial.normalizedValue ?? partial.rawValue ?? "value",
    detector: "regex_checksum",
    provenance: ["regex"],
    detectorConfidence: 0.95,
    ...partial,
  } as ExtractedEntity;
}

function glEntity(partial: Partial<ExtractedEntity> & Pick<ExtractedEntity, "type" | "offsetStart" | "offsetEnd">): ExtractedEntity {
  return {
    rawValue: partial.rawValue ?? "value",
    normalizedValue: partial.normalizedValue ?? partial.rawValue ?? "value",
    detector: "gliner",
    provenance: ["gliner"],
    detectorConfidence: 0.9,
    glinerScore: 0.9,
    ...partial,
  } as ExtractedEntity;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fuseExtractedEntities", () => {
  const email = detEntity({
    type: "EMAIL",
    rawValue: "rahul.kumar@example.com",
    normalizedValue: "rahul.kumar@example.com",
    offsetStart: 12,
    offsetEnd: 35,
  });
  const pan = detEntity({
    type: "PAN",
    rawValue: "ABCPD1234E",
    normalizedValue: "ABCPD1234E",
    provenance: ["regex"],
    offsetStart: 50,
    offsetEnd: 60,
  });

  it("fuses a same-type same-span GLiNER match and keeps deterministic confidence", () => {
    const gliner = [
      glEntity({
        type: "EMAIL",
        rawValue: "rahul.kumar@example.com",
        normalizedValue: "rahul.kumar@example.com",
        offsetStart: 12,
        offsetEnd: 35,
        glinerScore: 0.92,
      }),
    ];
    const fused = fuseExtractedEntities([email], gliner);

    expect(fused).toHaveLength(1);
    expect(fused[0].detector).toBe("fused");
    expect(fused[0].provenance).toEqual(["regex", "gliner"]);
    expect(fused[0].detectorConfidence).toBe(0.95);
    expect(fused[0].glinerScore).toBe(0.92);
    expect(fused[0].offsetStart).toBe(12);
    expect(fused[0].offsetEnd).toBe(35);
  });

  it("keeps deterministic offsets when the GLiNER span is wider (regression: no silent drop)", () => {
    // Deterministic email sits at [7, 30) in this text
    const text = "Email: rahul.kumar@example.com here";
    const emailDet = detEntity({
      type: "EMAIL",
      rawValue: "rahul.kumar@example.com",
      normalizedValue: "rahul.kumar@example.com",
      offsetStart: 7,
      offsetEnd: 30,
    });
    // GLiNER typically includes context words: "Email: rahul.kumar@example.com"
    const widerGliner = glEntity({
      type: "EMAIL",
      rawValue: "Email: rahul.kumar@example.com",
      normalizedValue: "rahul.kumar@example.com",
      offsetStart: 0,
      offsetEnd: 30,
      glinerScore: 0.9,
    });
    const fused = fuseExtractedEntities([emailDet], [widerGliner]);

    expect(fused).toHaveLength(1);
    expect(fused[0].detector).toBe("fused");
    // Deterministic span stays authoritative -> slice invariant must hold on the source text
    expect(text.slice(fused[0].offsetStart, fused[0].offsetEnd)).toBe(emailDet.rawValue);
    expect(fused[0].metadata?.glinerSpan).toEqual({ start: 0, end: 30 });
  });

  it("discards a GLiNER mislabel contained in a structured span", () => {
    const mislabel = glEntity({
      type: "ORGANIZATION",
      rawValue: "ABCPD1234E",
      normalizedValue: "ABCPD1234E",
      offsetStart: 50,
      offsetEnd: 60,
    });
    const fused = fuseExtractedEntities([pan], [mislabel]);

    expect(fused).toHaveLength(1);
    expect(fused[0].type).toBe("PAN");
    expect(fused[0].detector).toBe("regex_checksum");
  });

  it("preserves a neighboring contextual entity that partially overlaps a structured span", () => {
    // PERSON [0,20] overlaps EMAIL [12,35] but extends beyond it — not a contained
    // mislabel, so it must survive (plan.md §3.4).
    const person = glEntity({
      type: "PERSON",
      rawValue: "Contact Rahul Kumar",
      normalizedValue: "Contact Rahul Kumar",
      offsetStart: 0,
      offsetEnd: 19,
    });
    const emailDet = detEntity({
      type: "EMAIL",
      rawValue: "rahul@example.com",
      normalizedValue: "rahul@example.com",
      offsetStart: 12,
      offsetEnd: 29,
    });
    const fused = fuseExtractedEntities([emailDet], [person]);

    expect(fused.map((e) => e.type).sort()).toEqual(["EMAIL", "PERSON"]);
  });

  it("deduplicates only identical GLiNER records; overlapping distinct entities survive", () => {
    const org = glEntity({
      type: "ORGANIZATION",
      rawValue: "ABC Corp",
      normalizedValue: "ABC Corp",
      offsetStart: 30,
      offsetEnd: 38,
      glinerScore: 0.9,
    });
    const orgDuplicate = { ...org, offsetStart: 30, offsetEnd: 38 };
    const address = glEntity({
      type: "ADDRESS",
      rawValue: "ABC Corp, MG Road",
      normalizedValue: "ABC Corp, MG Road",
      offsetStart: 30,
      offsetEnd: 47,
    });
    const fused = fuseExtractedEntities([], [org, orgDuplicate, address]);

    expect(fused).toHaveLength(2);
    expect(fused.map((e) => e.type).sort()).toEqual(["ADDRESS", "ORGANIZATION"]);
  });

  it("keeps all non-overlapping entities from both detectors", () => {
    const gliner = [
      glEntity({ type: "PERSON", rawValue: "Rahul Kumar", offsetStart: 0, offsetEnd: 11 }),
      glEntity({ type: "LOCATION", rawValue: "Bengaluru", offsetStart: 70, offsetEnd: 79 }),
    ];
    const fused = fuseExtractedEntities([email, pan], gliner);
    expect(fused).toHaveLength(4);
  });
});

describe("callGlinerSidecar", () => {
  it("maps GLiNER labels and converts code-point offsets to UTF-16 offsets", async () => {
    // "a🚀bकc": code points a=0, 🚀=1, b=2, क=3, c=4; UTF-16: b sits at 3, क at 4, c at 5.
    const text = "a🚀bकc Rahul";
    const raw: GlinerRawEntity = { label: "person", text: "Rahul", start: 6, end: 11, score: 0.93 };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ entities: [raw] }),
      }))
    );

    const res = await callGlinerSidecar(text, { sidecarUrl: "http://127.0.0.1:59998" });
    expect(res.status).toBe("online");
    expect(res.entities).toHaveLength(1);
    const entity = res.entities[0];
    expect(entity.type).toBe("PERSON");
    expect(text.slice(entity.offsetStart, entity.offsetEnd)).toBe("Rahul");
    // "Rahul" starts after 6 code points, but 🚀 occupies 2 UTF-16 units
    expect(entity.offsetStart).toBe(7);
  });

  it("drops malformed sidecar candidates: non-finite scores, out-of-range offsets, invalid labels", async () => {
    const text = "Rahul Kumar";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          entities: [
            { label: "person", text: "Rahul", start: 0, end: 5, score: Number.NaN },
            { label: "person", text: "Rahul", start: 0, end: 5, score: Number.POSITIVE_INFINITY },
            { label: "person", text: "Rahul", start: 0, end: 99, score: 0.9 },
            { label: "person", text: "Rahul", start: 4, end: 2, score: 0.9 },
            { label: "classified_project", text: "Rahul", start: 0, end: 5, score: 0.9 },
            { label: "person", text: "Rahul", start: 0, end: 5, score: 0.9 },
          ],
        }),
      }))
    );

    const res = await callGlinerSidecar(text, { sidecarUrl: "http://127.0.0.1:59998" });
    expect(res.entities).toHaveLength(1);
    expect(res.entities[0].detectorConfidence).toBe(0.9);
  });

  it("rejects a malformed response envelope instead of treating it as a clean result", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ partial: false }),
      }))
    );

    const res = await callGlinerSidecar("Some text", { sidecarUrl: "http://127.0.0.1:59998" });
    expect(res.status).toBe("error");
    expect(res.entities).toEqual([]);
  });

  it("propagates sidecar partial and client truncation metadata", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ entities: [], partial: true, textTruncated: false }),
      }))
    );

    const longText = "A".repeat(30_000);
    const res = await callGlinerSidecar(longText, { sidecarUrl: "http://127.0.0.1:59998" });
    expect(res.status).toBe("online");
    expect(res.partial).toBe(true);
    expect(res.textTruncated).toBe(true);
    expect(res.requestTruncated).toBe(true);
  });

  it("truncates the request body to the sidecar's 20k cap", async () => {
    let capturedBody = "";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: { body?: string }) => {
        capturedBody = init?.body ?? "";
        return {
          ok: true,
          status: 200,
          json: async () => ({ entities: [] }),
        };
      })
    );

    const longText = "A".repeat(30_000);
    const res = await callGlinerSidecar(longText, { sidecarUrl: "http://127.0.0.1:59998" });
    const sent = JSON.parse(capturedBody).text as string;
    expect(sent).toHaveLength(20_000);
    expect(res.requestTruncated).toBe(true);
  });

  it("maps network failure to sidecar_down and never throws", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("ECONNREFUSED");
      })
    );
    const res = await callGlinerSidecar("Some text", { sidecarUrl: "http://127.0.0.1:59997" });
    expect(res.status).toBe("sidecar_down");
    expect(res.entities).toEqual([]);
  });
});

describe("buildCodePointToUtf16Map", () => {
  it("maps every code-point index to its UTF-16 offset", () => {
    const text = "a🚀bकc";
    const map = buildCodePointToUtf16Map(text);
    // code points: a(0) 🚀(1) b(2) क(3) c(4)
    expect(map).toEqual([0, 1, 3, 4, 5, 6]);
    for (let cp = 0; cp <= [...text].length; cp++) {
      // slicing by UTF-16 offsets must round-trip the code-point prefix
      expect(text.slice(0, map[cp])).toBe([...text].slice(0, cp).join(""));
    }
  });
});

describe("extractAndFusePII", () => {
  it("returns deterministic entities with sidecar_down when the sidecar is unreachable", async () => {
    const sampleDoc = "Contact Rahul at rahul.test@example.com with phone 9876543210";
    const result = await extractAndFusePII(sampleDoc, {
      sidecarUrl: "http://127.0.0.1:59999", // dead port
      sidecarTimeoutMs: 500,
    });

    expect(result.sidecarStatus).toBe("sidecar_down");
    expect(result.entities.map((e) => e.type)).toEqual(["EMAIL", "PHONE"]);
    expect(result.limitations.noOcr).toBe(true);
    for (const ent of result.entities) {
      expect(sampleDoc.slice(ent.offsetStart, ent.offsetEnd)).toBe(ent.rawValue);
    }
  });

  it("skipSidecar returns regex-only entities for testing", async () => {
    const result = await extractAndFusePII("Mail me at a.b@c.in now", { skipSidecar: true });
    expect(result.entities.map((e) => e.type)).toEqual(["EMAIL"]);
  });

  it("returns limitations metadata on every result", async () => {
    const result = await extractAndFusePII("nothing here", { skipSidecar: true });
    expect(result.limitations).toEqual(EXTRACTION_LIMITATIONS);
    expect(result.limitations.languageScope).toContain("English-centric");
    expect(result.partial).toBe(false);
    expect(result.textTruncated).toBe(false);
  });

  it("marks sidecar partial results without dropping the available entities", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ entities: [], partial: true, textTruncated: false }),
      }))
    );

    const result = await extractAndFusePII("Contact rahul@example.com", {
      sidecarUrl: "http://127.0.0.1:59998",
    });
    expect(result.partial).toBe(true);
    expect(result.textTruncated).toBe(false);
    expect(result.entities.map((entity) => entity.type)).toEqual(["EMAIL"]);
  });
});
