import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/require-user";
import { getDb } from "@/lib/models/db";
import { enforceUserLimit } from "@/lib/security/rate-limit";
import { issueVerificationCode } from "@/lib/verification";
import { sha256 } from "@/lib/security/crypto";

export const runtime = "nodejs";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await requireUser();
  const { id } = await params;
  const db = await getDb();

  await enforceUserLimit(user.id, "verification", {
    count: 20, windowMs: 24 * 60 * 60 * 1000,
  });

  const identifier = await db.collection("identifiers").findOne({
    _id: id, userId: user.id, type: "EMAIL",
  });
  if (!identifier) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Raw email is not stored in the identifier document by this implementation.
  // Reconstructing the delivery address therefore requires an encrypted value store.
  // UNKNOWN / NEEDS CONFIRMATION: production delivery requires an encrypted destination field.
  if (!identifier.normalizedValue) {
    return NextResponse.json({ error: "Verification destination unavailable" }, { status: 500 });
  }

  const devCode = await issueVerificationCode(user.id, id, identifier.normalizedValue);
  return NextResponse.json({ ok: true, ...(devCode ? { devVerificationCode: devCode } : {}) });
}