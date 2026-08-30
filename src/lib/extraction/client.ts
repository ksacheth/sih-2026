import { ExtractedEntity, EntityType, SidecarStatus, GlinerRawEntity } from "./types";
import { normalizeEmail } from "../validators/email";
import { normalizePhone } from "../validators/phone";

export interface SidecarExtractionResponse {
  entities: ExtractedEntity[];
  status: SidecarStatus;
  latencyMs: number;
  errorMessage?: string;
  requestTruncated?: boolean;
  partial?: boolean;
  textTruncated?: boolean;
}

const DEFAULT_SIDECAR_URL = "http://127.0.0.1:8000";
const SIDECAR_TIMEOUT_MS = 15_000;
// Must match the sidecar's MAX_TEXT_CHARS (sidecar/schemas.py): the server truncates
// at the same limit, so pre-truncating here avoids oversized bodies and 422s.
const MAX_REQUEST_CHARS = 20_000;

const GLINER_LABEL_MAP: Record<string, EntityType> = {
  person: "PERSON",
  people: "PERSON",
  organization: "ORGANIZATION",
  org: "ORGANIZATION",
  company: "ORGANIZATION",
  location: "LOCATION",
  loc: "LOCATION",
  city: "LOCATION",
  state: "LOCATION",
  country: "LOCATION",
  address: "ADDRESS",
  street_address: "ADDRESS",
  email: "EMAIL",
  phone: "PHONE",
  phone_number: "PHONE",
};

/**
 * Normalizes entity value based on type for consistent matching.
 */
function normalizeEntityValue(type: EntityType, text: string): string {
  switch (type) {
    case "EMAIL":
      return normalizeEmail(text);
    case "PHONE":
      return normalizePhone(text) || text.trim();
    case "PAN":
      return text.trim().toUpperCase();
    case "AADHAAR":
      return text.replace(/\D/g, "");
    case "PERSON":
    case "ORGANIZATION":
    case "LOCATION":
    case "ADDRESS":
    default:
      return text.trim();
  }
}

/**
 * Builds a map from Unicode code-point index (Python offset) to JavaScript UTF-16 code unit offset.
 */
export function buildCodePointToUtf16Map(text: string): number[] {
  const map: number[] = [0];
  let utf16Index = 0;
  for (const char of text) {
    utf16Index += char.length; // 1 for BMP, 2 for astral/surrogate characters
    map.push(utf16Index);
  }
  return map;
}

/**
 * Calls the local FastAPI GLiNER sidecar at http://127.0.0.1:8000/extract.
 * Protects caller with a 15-second AbortController and returns graceful status on failure.
 */
export async function callGlinerSidecar(
  text: string,
  options?: {
    sidecarUrl?: string;
    timeoutMs?: number;
    threshold?: number;
  }
): Promise<SidecarExtractionResponse> {
  const startTime = Date.now();
  const rawUrl = options?.sidecarUrl || process.env.SIDECAR_URL || DEFAULT_SIDECAR_URL;
  const sidecarUrl = rawUrl.replace(/\/+$/, "");
  const timeoutMs = options?.timeoutMs ?? SIDECAR_TIMEOUT_MS;
  const threshold = options?.threshold ?? 0.40;

  if (!text || typeof text !== "string" || text.trim().length === 0) {
    return {
      entities: [],
      status: "online",
      latencyMs: Date.now() - startTime,
    };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${sidecarUrl}/extract`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text: text.slice(0, MAX_REQUEST_CHARS),
        threshold,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      return {
        entities: [],
        status: "error",
        latencyMs: Date.now() - startTime,
        errorMessage: `Sidecar returned HTTP ${response.status}: ${response.statusText}`,
      };
    }

    let data: unknown;
    try {
      data = await response.json();
    } catch {
      return {
        entities: [],
        status: "error",
        latencyMs: Date.now() - startTime,
        errorMessage: "Sidecar returned invalid JSON",
      };
    }

    if (data === null || typeof data !== "object" || Array.isArray(data)) {
      return {
        entities: [],
        status: "error",
        latencyMs: Date.now() - startTime,
        errorMessage: "Sidecar returned an invalid response envelope",
      };
    }

    const payload = data as {
      entities?: unknown;
      partial?: unknown;
      textTruncated?: unknown;
    };

    if (!Array.isArray(payload.entities)) {
      return {
        entities: [],
        status: "error",
        latencyMs: Date.now() - startTime,
        errorMessage: "Sidecar response is missing an entities array",
      };
    }

    if (
      (payload.partial !== undefined && typeof payload.partial !== "boolean") ||
      (payload.textTruncated !== undefined && typeof payload.textTruncated !== "boolean")
    ) {
      return {
        entities: [],
        status: "error",
        latencyMs: Date.now() - startTime,
        errorMessage: "Sidecar response contains invalid status metadata",
      };
    }

    const rawEntities = payload.entities as GlinerRawEntity[];
    const requestTruncated = text.length > MAX_REQUEST_CHARS;

    const codePointMap = buildCodePointToUtf16Map(text);
    const codePointCount = codePointMap.length - 1; // map has codePointCount + 1 entries
    const mappedEntities: ExtractedEntity[] = [];

    for (const raw of rawEntities) {
      if (typeof raw.label !== "string" || typeof raw.start !== "number" || typeof raw.end !== "number") {
        continue;
      }

      // Strict validation: malformed sidecar candidates are discarded, not clamped
      // (plan.md §3.3 — invalid labels, non-finite scores, and out-of-range offsets
      // are protocol errors). Server truncates at a prefix cut, so offsets from the
      // truncated prefix remain valid against the full text.
      if (!Number.isInteger(raw.start) || !Number.isInteger(raw.end)) {
        continue;
      }
      if (raw.start < 0 || raw.end > codePointCount || raw.start >= raw.end) {
        continue;
      }
      if (typeof raw.score !== "number" || !Number.isFinite(raw.score) || raw.score < 0 || raw.score > 1) {
        continue;
      }

      const normalizedLabel = raw.label.toLowerCase();
      const mappedType = GLINER_LABEL_MAP[normalizedLabel];

      if (mappedType) {
        // Convert code-point indices to UTF-16 indices
        const startUtf16 = codePointMap[raw.start];
        const endUtf16 = codePointMap[raw.end];
        const rawText = raw.text || text.slice(startUtf16, endUtf16);

        // Verify slice invariant
        if (text.slice(startUtf16, endUtf16) === rawText) {
          mappedEntities.push({
            type: mappedType,
            rawValue: rawText,
            normalizedValue: normalizeEntityValue(mappedType, rawText),
            detector: "gliner",
            provenance: ["gliner"],
            detectorConfidence: raw.score,
            glinerScore: raw.score,
            offsetStart: startUtf16,
            offsetEnd: endUtf16,
            metadata: {
              glinerLabel: raw.label,
              glinerScore: raw.score,
            },
          });
        }
      }
    }

    return {
      entities: mappedEntities,
      status: "online",
      latencyMs: Date.now() - startTime,
      requestTruncated,
      partial: payload.partial === true,
      textTruncated: requestTruncated || payload.textTruncated === true,
    };
  } catch (err: unknown) {
    clearTimeout(timeoutId);
    const latencyMs = Date.now() - startTime;

    if (err instanceof Error) {
      if (err.name === "AbortError" || err.message.toLowerCase().includes("abort")) {
        return {
          entities: [],
          status: "timeout",
          latencyMs,
          errorMessage: `GLiNER sidecar extraction timed out after ${timeoutMs}ms`,
        };
      }
    }

    return {
      entities: [],
      status: "sidecar_down",
      latencyMs,
      errorMessage: err instanceof Error ? err.message : "GLiNER sidecar is unreachable",
    };
  }
}
