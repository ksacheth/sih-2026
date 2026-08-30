/**
 * Next.js instrumentation hook — runs once per server process start.
 *
 * Boot crash recovery (CONTEXT.md §3.1): any scan left QUEUED/RUNNING by a
 * dead process (>10 min) is marked PARTIAL so users never see a scan stuck
 * "in progress" and the one-active-scan index is unblocked.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  try {
    const { recoverStaleScans } = await import("@/lib/pipeline/orchestrator");
    const recovered = await recoverStaleScans();
    if (recovered > 0) {
      console.log(`[boot] scan recovery: marked ${recovered} stale scan(s) as PARTIAL`);
    }
  } catch (err) {
    // Recovery must never block boot (e.g. Mongo not up yet, DATABASE_URL
    // missing during builds).
    console.error("[boot] scan recovery failed:", err instanceof Error ? err.message : err);
  }
}
