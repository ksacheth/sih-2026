import { NextResponse } from "next/server";
import { getDb } from "@/lib/models/db";

export const runtime = "nodejs";

export async function GET() {
  let mongo = false;
  let sidecar = false;

  try {
    const db = await getDb();
    await db.command({ ping: 1 });
    mongo = true;
  } catch {}

  try {
    const base = process.env.SIDECAR_URL ?? "http://127.0.0.1:8000";
    const response = await fetch(`${base}/health`, {
      cache: "no-store",
      signal: AbortSignal.timeout(3000),
    });
    sidecar = response.ok;
  } catch {}

  const healthy = mongo && sidecar;
  return NextResponse.json(
    { status: healthy ? "ok" : "degraded", mongo, sidecar },
    { status: healthy ? 200 : 503 }
  );
}
