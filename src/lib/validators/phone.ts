import { parsePhoneNumberFromString } from "libphonenumber-js/min";
import { PiiCandidate } from "./types";

/**
 * Deliberately permissive candidate span matcher for phone numbers. The generous
 * length bound lets one span cover multi-number listings (e.g. paste dumps);
 * detectPhones retries sub-spans when the whole span fails to parse.
 */
const PHONE_CANDIDATE_RE =
  /(?<!\d)(?:\+?\d{1,3}[\s-]?)?(?:\(\d{1,4}\)[\s-]?)?\d[\d\s\-().]{6,28}\d(?!\d)/g;

/**
 * Mask E.164 phone: e.g. "+91 •••• 4321"
 */
export function maskPhone(e164Phone: string): string {
  const clean = e164Phone.replace(/\s+/g, "");
  if (clean.length <= 4) return "••••";
  const suffix = clean.slice(-4);
  const prefix = clean.startsWith("+91") ? "+91 " : clean.slice(0, 3) + " ";
  return `${prefix}•••• ${suffix}`;
}

/**
 * Normalizes phone number to E.164 format.
 */
export function normalizePhone(raw: string, defaultCountry: "IN" = "IN"): string | null {
  const parsed = parsePhoneNumberFromString(raw, defaultCountry);
  if (parsed && parsed.isValid()) {
    return parsed.format("E.164");
  }
  return null;
}

/**
 * Parses a raw span with default country IN; returns the E.164 form when valid.
 */
function parseValidE164(raw: string): string | null {
  const parsed = parsePhoneNumberFromString(raw, "IN");
  return parsed && parsed.isValid() ? parsed.format("E.164") : null;
}

/**
 * Bare 12-digit run starting with 91 (no "+"): plausibly "91" + a 10-digit mobile.
 */
function isBare91Run(raw: string): boolean {
  const digitsOnly = raw.replace(/\D/g, "");
  return (
    digitsOnly.length === 12 && digitsOnly.startsWith("91") && !raw.trim().startsWith("+")
  );
}

/**
 * Detect Phone candidates using libphonenumber-js with default country IN.
 * When a candidate span fails to parse (the permissive pre-regex can swallow several
 * whitespace-separated numbers, e.g. "98765 43210 91234 56789"), every contiguous
 * token combination is retried longest-first so each real number is recovered.
 */
export function detectPhones(text: string): PiiCandidate[] {
  if (!text || typeof text !== "string") return [];

  const results: PiiCandidate[] = [];

  const pushCandidate = (rawValue: string, offsetStart: number, offsetEnd: number) => {
    const e164 = parseValidE164(rawValue);
    if (!e164) return;
    const isIndianMobile = e164.startsWith("+91") && e164.length === 13;
    results.push({
      type: "PHONE",
      rawValue,
      normalizedValue: e164,
      confidence: isBare91Run(rawValue) ? 0.8 : 0.95,
      detector: "regex_checksum",
      provenance: ["regex"],
      offsetStart,
      offsetEnd,
      meta: {
        e164,
        isIndianMobile,
        masked: maskPhone(e164),
      },
    });
  };

  const matches = text.matchAll(PHONE_CANDIDATE_RE);

  for (const match of matches) {
    const rawValue = match[0];
    const spanStart = match.index ?? 0;
    const spanEnd = spanStart + rawValue.length;

    // Fast path: the whole span parses as one number.
    if (parseValidE164(rawValue)) {
      pushCandidate(rawValue, spanStart, spanEnd);
      continue;
    }

    // Retry: split the span into whitespace-separated tokens and try every contiguous
    // combination, longest first, accepting non-overlapping valid sub-spans.
    const tokens = [...rawValue.matchAll(/\S+/g)].map((t) => {
      const start = t.index ?? 0;
      return { start, end: start + t[0].length };
    });
    if (tokens.length < 2 || tokens.length > 12) continue;

    const combos: Array<{ start: number; end: number }> = [];
    for (let i = 0; i < tokens.length; i++) {
      for (let j = i; j < tokens.length; j++) {
        combos.push({ start: tokens[i].start, end: tokens[j].end });
      }
    }
    combos.sort((a, b) => b.end - b.start - (a.end - a.start));

    const occupied: Array<[number, number]> = [];
    for (const combo of combos) {
      if (occupied.some(([s, e]) => combo.start < e && combo.end > s)) continue;
      const sub = rawValue.slice(combo.start, combo.end);
      if (!parseValidE164(sub)) continue;
      occupied.push([combo.start, combo.end]);
      pushCandidate(sub, spanStart + combo.start, spanStart + combo.end);
    }
  }

  return results;
}
