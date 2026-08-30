// Agreed contract consumed by POST /api/scan (PR #9). Dev-2 owns the real
// scan pipeline runner; until that lands this placeholder keeps the app
// buildable and honestly reports the scan as PARTIAL instead of QUEUED
// forever.
export async function runScanPipeline(scanId: string): Promise<void> {
  const { getDb } = await import("@/lib/models/db");
  const db = await getDb();
  await db.collection("scans").updateOne(
    { _id: scanId },
    { $set: { status: "PARTIAL", completedAt: new Date() } }
  );
}
