import {
  ExtractedEntity,
  ExtractionLimitations,
  ExtractionResult,
  DetectorProvenance,
} from "./types";
import { runDeterministicValidators, PiiCandidate } from "../validators";
import { callGlinerSidecar } from "./client";

export const EXTRACTION_LIMITATIONS: ExtractionLimitations = {
  noOcr: true,
  ocrNotice: "Exposures inside images or scanned PDFs are not detected.",
  languageScope:
    "English-centric (Indic scripts under-extracted by NER; structured IDs handled via deterministic regex)",
};

const STRUCTURED_TYPES = new Set(["EMAIL", "PHONE", "AADHAAR", "PAN"]);

/**
 * Checks if two entities overlap in character offsets.
 */
export function isSpanOverlapping(
  a: { offsetStart: number; offsetEnd: number },
  b: { offsetStart: number; offsetEnd: number }
): boolean {
  return Math.max(a.offsetStart, b.offsetStart) < Math.min(a.offsetEnd, b.offsetEnd);
}

/**
 * Maps a PiiCandidate from deterministic validators to an ExtractedEntity.
 */
export function mapCandidateToEntity(candidate: PiiCandidate): ExtractedEntity {
  return {
    type: candidate.type,
    rawValue: candidate.rawValue,
    normalizedValue: candidate.normalizedValue,
    detector: "regex_checksum",
    provenance: [...candidate.provenance],
    detectorConfidence: candidate.confidence,
    offsetStart: candidate.offsetStart,
    offsetEnd: candidate.offsetEnd,
    metadata: candidate.meta ? { ...candidate.meta } : undefined,
  };
}

/**
 * Merges and resolves conflicts between deterministic regex/checksum candidates
 * and GLiNER NER model candidates.
 *
 * Rules (plan.md §3.4):
 * 1. Structured IDs (EMAIL, PHONE, AADHAAR, PAN): Deterministic regex/checksum is authoritative.
 *    - If GLiNER detected the same type over the span, fuse into `detector: "fused"`; combine provenances;
 *      keep the deterministic confidence AND span authoritative, storing GLiNER's span separately in metadata.
 *    - If GLiNER mislabeled the same or contained span as a different type (e.g. called a PAN "ORGANIZATION"),
 *      that GLiNER classification is discarded.
 *    - A contextual GLiNER entity that merely overlaps/partially covers a structured ID survives —
 *      a neighboring contextual entity is not discarded for touching a structured span.
 * 2. Contextual entities (PERSON, ORGANIZATION, LOCATION, ADDRESS): GLiNER is primary.
 * 3. GLiNER records are deduplicated only when identical (type + normalizedValue + span);
 *    repeated occurrences at different spans remain separate evidence.
 */
export function fuseExtractedEntities(
  deterministicEntities: ExtractedEntity[],
  glinerEntities: ExtractedEntity[]
): ExtractedEntity[] {
  const result: ExtractedEntity[] = [];
  const handledGlinerIndices = new Set<number>();

  const isContainedIn = (
    inner: { offsetStart: number; offsetEnd: number },
    outer: { offsetStart: number; offsetEnd: number }
  ): boolean =>
    inner.offsetStart >= outer.offsetStart && inner.offsetEnd <= outer.offsetEnd;

  // 1. Process all deterministic entities
  for (const det of deterministicEntities) {
    const overlapping = glinerEntities
      .map((gl, idx) => ({ gl, idx }))
      .filter(({ gl, idx }) => !handledGlinerIndices.has(idx) && isSpanOverlapping(det, gl));

    // Same-type overlapping GLiNER entities corroborate the deterministic match -> fuse.
    const sameTypeMatches = overlapping.filter(({ gl }) => gl.type === det.type);
    const bestSameType =
      sameTypeMatches.length > 0
        ? sameTypeMatches.reduce((best, cur) =>
            (cur.gl.glinerScore ?? cur.gl.detectorConfidence) >
            (best.gl.glinerScore ?? best.gl.detectorConfidence)
              ? cur
              : best
          )
        : undefined;

    if (bestSameType) {
      const glMatch = bestSameType.gl;
      const mergedProvenance: DetectorProvenance[] = Array.from(
        new Set<DetectorProvenance>([...det.provenance, "gliner"])
      );
      const glinerScore = glMatch.glinerScore ?? glMatch.detectorConfidence;

      result.push({
        type: det.type,
        rawValue: det.rawValue,
        normalizedValue: det.normalizedValue,
        detector: "fused",
        provenance: mergedProvenance,
        // Deterministic confidence AND span remain authoritative; GLiNER's span is
        // preserved separately so the offset slice invariant is never broken.
        detectorConfidence: det.detectorConfidence,
        glinerScore,
        offsetStart: det.offsetStart,
        offsetEnd: det.offsetEnd,
        metadata: {
          ...det.metadata,
          ...glMatch.metadata,
          fusedWith: "gliner",
          originalRegexValue: det.rawValue,
          glinerScore,
          glinerSpan: { start: glMatch.offsetStart, end: glMatch.offsetEnd },
          glinerText: glMatch.rawValue,
        },
      });

      for (const { idx } of sameTypeMatches) {
        handledGlinerIndices.add(idx);
      }
    } else {
      // No GLiNER corroboration: keep the deterministic entity as-is
      result.push(det);
    }

    // GLiNER entities fully contained in a structured span with a different type are
    // mislabels of that structured ID -> discard. Partial overlaps survive as context.
    for (const { gl, idx } of overlapping) {
      if (gl.type !== det.type && isContainedIn(gl, det)) {
        handledGlinerIndices.add(idx);
      }
    }
  }

  // 2. Process remaining unhandled GLiNER entities (contextual entities only: PERSON, ORGANIZATION, LOCATION, ADDRESS)
  const remainingGliner = glinerEntities.filter(
    (gl, idx) => !handledGlinerIndices.has(idx) && !STRUCTURED_TYPES.has(gl.type)
  );

  //    Deduplicate ONLY identical records (type + normalizedValue + span) — overlapping
  //    but distinct entities (e.g. ORGANIZATION inside an ADDRESS) are separate evidence.
  const seen = new Set<string>();
  for (const gl of remainingGliner) {
    const key = `${gl.type}|${gl.normalizedValue}|${gl.offsetStart}|${gl.offsetEnd}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(gl);
  }

  // Sort by offset start ascending
  return result.sort((a, b) => a.offsetStart - b.offsetStart);
}

export interface ExtractAndFuseOptions {
  sidecarUrl?: string;
  sidecarTimeoutMs?: number;
  glinerThreshold?: number;
  skipSidecar?: boolean;
}

/**
 * Main entrypoint: Extracts deterministic structured PII and contextual GLiNER entities,
 * fuses them with conflict resolution, and returns the unified ExtractionResult.
 *
 * Graceful fallback: If the sidecar is offline or times out, returns deterministic entities
 * with sidecarStatus marked as 'sidecar_down' or 'timeout' (supporting PARTIAL scan semantics).
 */
export async function extractAndFusePII(
  text: string,
  options?: ExtractAndFuseOptions
): Promise<ExtractionResult> {
  const extractedAt = new Date().toISOString();

  if (!text || typeof text !== "string" || text.trim().length === 0) {
    return {
      textLength: 0,
      entities: [],
      sidecarStatus: "skipped",
      partial: false,
      textTruncated: false,
      limitations: EXTRACTION_LIMITATIONS,
      extractedAt,
    };
  }

  // 1. Run deterministic regex & checksum validators
  const rawCandidates = runDeterministicValidators(text);
  const deterministicEntities = rawCandidates.map(mapCandidateToEntity);

  // If sidecar is explicitly skipped (e.g. testing or regex-only mode)
  if (options?.skipSidecar) {
    return {
      textLength: text.length,
      entities: deterministicEntities,
      sidecarStatus: "skipped",
      partial: false,
      textTruncated: false,
      limitations: EXTRACTION_LIMITATIONS,
      extractedAt,
    };
  }

  // 2. Call GLiNER sidecar
  const sidecarResponse = await callGlinerSidecar(text, {
    sidecarUrl: options?.sidecarUrl,
    timeoutMs: options?.sidecarTimeoutMs,
    threshold: options?.glinerThreshold,
  });

  // 3. If sidecar failed (down, timeout, error), return deterministic results with failure status
  if (sidecarResponse.status !== "online") {
    return {
      textLength: text.length,
      entities: deterministicEntities,
      sidecarStatus: sidecarResponse.status,
      partial: true,
      textTruncated: false,
      limitations: EXTRACTION_LIMITATIONS,
      extractedAt,
    };
  }

  // 4. Fuse deterministic and GLiNER entities
  const fusedEntities = fuseExtractedEntities(deterministicEntities, sidecarResponse.entities);

  // 5. Final invariant check: verify offsets slice correctly
  const verifiedEntities = fusedEntities.filter(
    (e) => text.slice(e.offsetStart, e.offsetEnd) === e.rawValue
  );

  return {
    textLength: text.length,
    entities: verifiedEntities,
    sidecarStatus: "online",
    partial: sidecarResponse.partial === true || sidecarResponse.textTruncated === true,
    textTruncated: sidecarResponse.textTruncated === true,
    limitations: EXTRACTION_LIMITATIONS,
    extractedAt,
  };
}
