import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/require-user";
import { getDb, newId } from "@/lib/models/db";
import { routeError } from "@/lib/http";
import { scanCreateSchema } from "@/lib/validation";
import { enforceUserLimit } from "@/lib/security/rate-limit";
import { audit } from "@/lib/security/audit";

export const runtime = "nodejs";

export async function GET() {
  try {
    const user = await requireUser();
    const db = await getDb();
    const scans = await db.collection("scans").find({ userId: user.id })
      .sort({ createdAt: -1 }).limit(50).toArray();
    return NextResponse.json(scans);
  } catch (e) {
    return routeError(e);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const body = scanCreateSchema.parse(await request.json());
    const db = await getDb();

    await enforceUserLimit(user.id, "scan", {
      count: 5, windowMs: 24 * 60 * 60 * 1000,
    });

    const identity = await db.collection("identities").findOne({
      _id: body.identityId, userId: user.id,
    });
    if (!identity) return NextResponse.json({ error: "Identity not found" }, { status: 404 });

    const identifiers = await db.collection("identifiers")
      .find({ userId: user.id, identityId: body.identityId }).toArray();

    if (!identifiers.length || identifiers.some((x) => !["VERIFIED", "ATTESTED"].includes(x.status))) {
      return NextResponse.json({ error: "All identifiers must be VERIFIED or ATTESTED" }, { status: 403 });
    }

    const activeFilter = {
      userId: user.id, identityId: body.identityId,
      status: { $in: ["QUEUED", "RUNNING"] },
    };

    const active = await db.collection("scans").findOne(activeFilter);
    if (active) return NextResponse.json({ scan_id: active._id }, { status: 202 });

    const scanId = newId();
    try {
      await db.collection("scans").insertOne({
        _id: scanId,
        userId: user.id,
        identityId: body.identityId,
        status: "QUEUED",
        sourceStatus: { serper: "QUEUED", exposedornot: "QUEUED", brokers: "QUEUED" },
        createdAt: new Date(),
      });
    } catch (e) {
      // Unique partial index on (identityId, status) for QUEUED/RUNNING scans
      // closes the check-then-insert race; fold the loser into the winner.
      if ((e as { code?: number }).code !== 11000) throw e;
      const winner = await db.collection("scans").findOne(activeFilter);
      if (!winner) throw e;
      return NextResponse.json({ scan_id: winner._id }, { status: 202 });
    }

    await audit("SCAN_CREATED", user.id, { scanId, identityId: body.identityId });

    // Dev-2 owns the actual pipeline runner.
    // This endpoint deliberately imports only the agreed contract.
    try {
      const { runScanPipeline } = await import("@/lib/pipeline/orchestrator");
      void runScanPipeline(scanId);
    } catch {
      await db.collection("scans").updateOne(
        { _id: scanId, userId: user.id },
        { $set: { status: "PARTIAL", completedAt: new Date() } }
      );
    }

    return NextResponse.json({ scan_id: scanId }, { status: 202 });
  } catch (e) {
    return routeError(e);
  }
}
