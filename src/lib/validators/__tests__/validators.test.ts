import { describe, it, expect } from "vitest";
import { verhoeffValidate, verhoeffCheckDigit } from "../verhoeff";
import { detectAadhaars, maskAadhaar } from "../aadhaar";
import { detectPans, maskPan } from "../pan";
import { detectPhones, normalizePhone, maskPhone } from "../phone";
import { detectEmails, normalizeEmail, maskEmail } from "../email";
import { runDeterministicValidators, dedupeOverlaps } from "../index";
import type { PiiCandidate } from "../types";

/**
 * Seeded PRNG (mulberry32) so the Verhoeff property test is fully reproducible:
 * a failure can be replayed with the same seed.
 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Canonical Verhoeff regression vectors — every one verified valid, and its check
// digit reproducible from the 11-digit body via verhoeffCheckDigit.
const VERHOEFF_REGRESSION_VECTORS = [
  "987654321096",
  "456789123451",
  "765432109878",
  "300000000001",
  "827663941565",
  "234567890124",
  "218349275010",
];

describe("Verhoeff algorithm", () => {
  it.each(VERHOEFF_REGRESSION_VECTORS)("accepts canonical regression vector %s", (vec) => {
    expect(verhoeffValidate(vec)).toBe(true);
    expect(verhoeffCheckDigit(vec.slice(0, 11))).toBe(Number(vec[11]));
  });

  it("accepts the classic Verhoeff paper vector 2363", () => {
    expect(verhoeffValidate("2363")).toBe(true);
    expect(verhoeffCheckDigit("236")).toBe(3);
  });

  it("rejects single-digit corruptions of every regression vector", () => {
    for (const vec of VERHOEFF_REGRESSION_VECTORS) {
      const check = Number(vec[11]);
      for (let d = 0; d <= 9; d++) {
        if (d !== check) {
          expect(verhoeffValidate(vec.slice(0, 11) + d)).toBe(false);
        }
      }
    }
  });

  it("passes the 1,000-prefix property test: generated numbers validate, all corruptions fail", () => {
    const rng = mulberry32(0x5eed);
    for (let i = 0; i < 1000; i++) {
      const first = Math.floor(rng() * 8) + 2; // 2-9
      let rest = "";
      for (let j = 0; j < 10; j++) rest += Math.floor(rng() * 10).toString();
      const body = `${first}${rest}`;
      const check = verhoeffCheckDigit(body);
      const full = `${body}${check}`;

      expect(verhoeffValidate(full), `generated ${full}`).toBe(true);
      for (let d = 0; d <= 9; d++) {
        if (d !== check) {
          expect(verhoeffValidate(body + d), `corrupted ${body}${d}`).toBe(false);
        }
      }
    }
  });
});

describe("Aadhaar detector", () => {
  it("detects valid and invalid candidates with correct confidence tiers", () => {
    const sample = "Valid UID: 2345 6789 0124 and invalid UID: 2345 6789 0123";
    const candidates = detectAadhaars(sample);
    expect(candidates).toHaveLength(2);

    const valid = candidates.find((c) => c.normalizedValue === "234567890124");
    expect(valid?.confidence).toBe(0.98);
    expect(valid?.provenance).toEqual(["regex", "checksum"]);
    expect(valid?.meta?.checksumValid).toBe(true);
    expect(sample.slice(valid!.offsetStart, valid!.offsetEnd)).toBe(valid!.rawValue);

    const invalid = candidates.find((c) => c.normalizedValue === "234567890123");
    expect(invalid?.confidence).toBe(0.4);
    expect(invalid?.provenance).toEqual(["regex"]);
    expect(invalid?.meta?.checksumValid).toBe(false);
  });

  it.each(["2345 6789 0124", "2345-6789-0124", "234567890124"])(
    "normalizes format variant %s",
    (variant) => {
      const candidates = detectAadhaars(`UID ${variant} filed`);
      expect(candidates).toHaveLength(1);
      expect(candidates[0].normalizedValue).toBe("234567890124");
    }
  );

  it("drops all-identical digit strings via the junk guard", () => {
    expect(detectAadhaars("Fake: 2222 2222 2222 and 9999 9999 9999")).toHaveLength(0);
  });

  it("rejects first digits 0 and 1", () => {
    expect(detectAadhaars("UID 1345 6789 0124")).toHaveLength(0);
    expect(detectAadhaars("UID 0345 6789 0124")).toHaveLength(0);
  });

  it("does not match a 12-digit run embedded in a longer digit run", () => {
    // 234567890124 sits inside a 14-digit run — lookarounds must reject it.
    expect(detectAadhaars("Order 122345678901244 shipped")).toHaveLength(0);
  });

  it("does not match 11 or 13 digit inputs", () => {
    expect(detectAadhaars("UID 34567890124")).toHaveLength(0);
    expect(detectAadhaars("UID 2345678901234")).toHaveLength(0);
  });

  it("does not detect masked forms", () => {
    expect(detectAadhaars("Aadhaar: XXXX XXXX 1234")).toHaveLength(0);
  });

  it("masks to the last four digits only", () => {
    expect(maskAadhaar("234567890124")).toBe("•••• •••• 0124");
  });
});

describe("PAN detector", () => {
  it("accepts a valid person PAN at 0.95", () => {
    const candidates = detectPans("Individual PAN: ABCPD1234E");
    expect(candidates).toHaveLength(1);
    const pan = candidates[0];
    expect(pan.confidence).toBe(0.95);
    expect(pan.meta?.holderType).toBe("P");
    expect(pan.meta?.isIndividual).toBe(true);
  });

  it("never claims checksum provenance — PAN has no published checksum", () => {
    const candidates = detectPans("Person ABCPD1234E and company AAACE1234A and odd ABCDE1234F");
    expect(candidates).toHaveLength(3);
    for (const pan of candidates) {
      expect(pan.provenance).toEqual(["regex"]);
      expect(pan.provenance).not.toContain("checksum");
    }
  });

  it("scores an unusual holder-type char at 0.60", () => {
    // 4th char 'D' is not a valid holder type (ABCDE1234F is structurally invalid).
    const candidates = detectPans("Sample ABCDE1234F here");
    expect(candidates).toHaveLength(1);
    expect(candidates[0].confidence).toBe(0.6);
    expect(candidates[0].meta?.holderType).toBe("D");
  });

  it("normalizes lowercase input to uppercase", () => {
    const candidates = detectPans("pan abcde1234f low");
    expect(candidates).toHaveLength(1);
    expect(candidates[0].normalizedValue).toBe("ABCDE1234F");
    expect(candidates[0].rawValue).toBe("abcde1234f");
  });

  it("rejects digit-in-letter-section and reversed structures", () => {
    expect(detectPans("bad AB1DE1234F nope")).toHaveLength(0);
    expect(detectPans("bad 12345ABCDE nope")).toHaveLength(0);
  });

  it("masks to first three and last two characters", () => {
    expect(maskPan("ABCPD1234E")).toBe("ABC•••••4E");
  });
});

describe("Phone detector", () => {
  it("normalizes the Indian format matrix to E.164", () => {
    const sample = `
      Mobile 1: 9876543210
      Mobile 2: +91 98765-43210
      Mobile 3: 09876543210
      Landline Delhi: (011) 2345-6789
    `;
    const candidates = detectPhones(sample);
    expect(candidates.some((c) => c.normalizedValue === "+919876543210")).toBe(true);
    expect(candidates.some((c) => c.normalizedValue === "+911123456789")).toBe(true);
    for (const c of candidates) {
      expect(c.normalizedValue).toMatch(/^\+/);
      expect(sample.slice(c.offsetStart, c.offsetEnd)).toBe(c.rawValue);
    }
  });

  it("recovers each number from a multi-number span (sub-span retry)", () => {
    const sample = "Contacts: 98765 43210 91234 56789 call us";
    const candidates = detectPhones(sample);
    expect(candidates.map((c) => c.normalizedValue).sort()).toEqual([
      "+919123456789",
      "+919876543210",
    ]);
    for (const c of candidates) {
      expect(sample.slice(c.offsetStart, c.offsetEnd)).toBe(c.rawValue);
    }
  });

  it("assigns 0.80 to a bare 91-prefixed 12-digit run", () => {
    const candidates = detectPhones("Bare 91: 919876543210");
    expect(candidates).toHaveLength(1);
    expect(candidates[0].confidence).toBe(0.8);
    expect(candidates[0].normalizedValue).toBe("+919876543210");
  });

  it("preserves foreign country codes without coercing to +91", () => {
    const candidates = detectPhones("UK: +44 20 7946 0958");
    expect(candidates.some((c) => c.normalizedValue === "+442079460958")).toBe(true);
  });

  it("rejects 9-digit numbers", () => {
    expect(detectPhones("Short 987654321")).toHaveLength(0);
  });

  it("masks to +91 with last four digits", () => {
    expect(maskPhone("+919876543210")).toBe("+91 •••• 3210");
  });

  it("exposes normalizePhone for reuse", () => {
    expect(normalizePhone("+91 98765 43210")).toBe("+919876543210");
    expect(normalizePhone("12345")).toBeNull();
  });
});

describe("Email detector", () => {
  it("detects the positive matrix and normalizes case", () => {
    const sample = `
      Standard: user@example.com
      Subdomain: rahul.kumar@dept.company.co.in
      Uppercase: ADMIN@GOV.IN
      Wrapped: <security-lead@startup.io>
      Tagged: user.name+x@example.co.in
    `;
    const candidates = detectEmails(sample);
    expect(candidates.length).toBe(5);
    expect(candidates.some((c) => c.normalizedValue === "admin@gov.in")).toBe(true);
    expect(candidates.some((c) => c.normalizedValue === "user.name+x@example.co.in")).toBe(true);
    for (const c of candidates) {
      expect(sample.slice(c.offsetStart, c.offsetEnd)).toBe(c.rawValue);
    }
  });

  it("rejects structural negatives", () => {
    expect(detectEmails("no tld: user@localhost")).toHaveLength(0);
    expect(detectEmails("double @@: a@@b.com")).toHaveLength(0);
    expect(detectEmails("missing domain: user@.")).toHaveLength(0);
  });

  it("enforces RFC length limits", () => {
    const longLocal = "a".repeat(65);
    expect(detectEmails(`${longLocal}@example.com`)).toHaveLength(0);
    expect(detectEmails(`${"a".repeat(64)}@example.com`)).toHaveLength(1);
  });

  it("normalization is idempotent", () => {
    const once = normalizeEmail("  USER@Example.COM  ");
    expect(normalizeEmail(once)).toBe(once);
  });

  it("masks the local part keeping the first character", () => {
    expect(maskEmail("rahul@example.com")).toBe("r***@example.com");
    expect(maskEmail("a@b.co")).toBe("*@b.co");
  });
});

describe("Deterministic pipeline index", () => {
  it("checksum-valid Aadhaar outranks a phone candidate on the same span", () => {
    const result = runDeterministicValidators("User ID: 2345 6789 0124");
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("AADHAAR");
  });

  it("valid phone outranks a checksum-failing Aadhaar (validity-aware ranking)", () => {
    const invalidAadhaar: PiiCandidate = {
      type: "AADHAAR",
      rawValue: "987654321099",
      normalizedValue: "987654321099",
      confidence: 0.4,
      detector: "regex_checksum",
      provenance: ["regex"],
      offsetStart: 0,
      offsetEnd: 12,
    };
    const validPhone: PiiCandidate = {
      type: "PHONE",
      rawValue: "9876543210",
      normalizedValue: "+919876543210",
      confidence: 0.95,
      detector: "regex_checksum",
      provenance: ["regex"],
      offsetStart: 0,
      offsetEnd: 10,
    };
    const result = dedupeOverlaps([invalidAadhaar, validPhone]);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("PHONE");
  });

  it("enforces the offset slice invariant and byte-identical determinism", () => {
    const multiDoc = `
      Employee: Rahul Kumar
      Email: rahul.kumar@example.com
      Phone: +91 98765 43210
      PAN: ABCPD1234E
      UIDAI: 2345 6789 0124
    `;
    const run1 = runDeterministicValidators(multiDoc);
    const run2 = runDeterministicValidators(multiDoc);

    expect(run1.length).toBeGreaterThanOrEqual(4);
    for (const c of run1) {
      expect(multiDoc.slice(c.offsetStart, c.offsetEnd)).toBe(c.rawValue);
    }
    expect(JSON.stringify(run1)).toBe(JSON.stringify(run2));
  });
});
