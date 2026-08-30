/**
 * Monitoring & re-scan fingerprint engine (CONTEXT.md §12, Dev-2 task 4).
 *
 * The transition table is a pure function of (previous state, seen in
 * current scan) so every edge is unit-testable without Mongo. The DB
 * layer (applyReScan) only reads/writes; all decisions live here.
 *
 * Lifecycle (issue #4 user stories 20–24):
 *   (new)        → FIRST_SEEN                    newly discovered
 *   FIRST_SEEN   → ACTIVE                        confirmed on a later scan
 *   ACTIVE       → UNCHANGED                     seen again
 *   ACTIVE/…     → NOT_FOUND                     absent from a re-scan
 *   NOT_FOUND    → REAPPEARED                    seen again → severity bump
 *   NOT_FOUND ×3 → CLOSED                        auto-close stale findings
 *   ACTIVE/etc   → REMEDIATED                    user marked the action done
 *   REMEDIATED   → REMEDIATED                    sticky: stays until it
 *                 reappears (REMEDIATED → NOT_FOUND would misreport a user
 *                 action as an organic disappearance; deviation from
 *                 CONTEXT.md §12.2 noted in issue #4)
 *   CLOSED/REMEDIATED → REAPPEARED               the takedown didn't hold
 */

export type ExposureStatus =
  | "FIRST_SEEN"
  | "ACTIVE"
  | "UNCHANGED"
  | "NOT_FOUND"
  | "REMEDIATED"
  | "REAPPEARED"
  | "CLOSED";

export type SeverityLevel = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";

export const NOT_FOUND_SCANS_UNTIL_CLOSED = 3;

export interface TransitionInput {
  previousState: ExposureStatus | null;
  seenInCurrentScan: boolean;
  /** Consecutive NOT_FOUND scans so far (only meaningful when absent). */
  notFoundCount?: number;
  /** User marked the exposure remediated after the last scan. */
  markedRemediated?: boolean;
}

export interface TransitionResult {
  state: ExposureStatus;
  /** Consecutive-scan counter, persisted for the ×3 auto-close rule. */
  notFoundCount: number;
  /** REAPPEARED escalates one severity level ("the removal didn't hold"). */
  severityBump: boolean;
  becameClosed: boolean;
}

/**
 * Severity ladder for the REAPPEARED escalation (user story 23).
 * Exported for tests; LOW→MEDIUM→HIGH→CRITICAL, CRITICAL stays CRITICAL.
 */
export function bumpSeverity(severity: SeverityLevel): SeverityLevel {
  const order: SeverityLevel[] = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];
  const idx = Math.min(order.indexOf(severity) + 1, order.length - 1);
  return order[idx];
}

/**
 * One lifecycle step for a single exposure: previous stored state + whether
 * the current scan saw it (+ user intent) → next state. Pure.
 */
export function transitionExposure(input: TransitionInput): TransitionResult {
  const prev = input.previousState;
  const seen = input.seenInCurrentScan;
  const notFoundCount = input.notFoundCount ?? 0;

  // User action wins over scan absence: a remediation the user just performed
  // must not be overwritten by this scan's absence reading.
  if (input.markedRemediated && prev !== "REMEDIATED" && prev !== "CLOSED") {
    return { state: "REMEDIATED", notFoundCount: 0, severityBump: false, becameClosed: false };
  }

  if (prev === null) {
    // First detection ever.
    return { state: "FIRST_SEEN", notFoundCount: 0, severityBump: false, becameClosed: false };
  }

  if (seen) {
    if (prev === "REMEDIATED" || prev === "CLOSED" || prev === "NOT_FOUND") {
      // An opt-out/takedown didn't hold — escalate (§12.2, story 23).
      return { state: "REAPPEARED", notFoundCount: 0, severityBump: true, becameClosed: false };
    }
    // FIRST_SEEN → ACTIVE on confirmation; everything else stays present.
    return { state: prev === "FIRST_SEEN" ? "ACTIVE" : "UNCHANGED", notFoundCount: 0, severityBump: false, becameClosed: false };
  }

  // Not seen in the current scan.
  if (prev === "REMEDIATED" || prev === "CLOSED") {
    // Stays closed; only an exact reappearance escalates (handled above).
    return { state: prev, notFoundCount: 0, severityBump: false, becameClosed: false };
  }
  const nextCount = (notFoundCount ?? 0) + 1;
  if (nextCount >= NOT_FOUND_SCANS_UNTIL_CLOSED) {
    return { state: "CLOSED", notFoundCount: nextCount, severityBump: false, becameClosed: true };
  }
  return { state: "NOT_FOUND", notFoundCount: nextCount, severityBump: false, becameClosed: false };
}
