import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/require-user";
import { getDb } from "@/lib/models/db";
import { getOwnedIdentifier } from "@/lib/identifiers";
import { audit } from "@/lib/security/audit";

export const runtime = "nodejs";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await requireUser();
  const { id } = await params;
  const identifier = await getOwnedIdentifier(user.id, id);
  if (!identifier) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const db = await getDb();
  await db.collection("identifiers").deleteOne({ _id: id, userId: user.id });
  await db.collection("consents").deleteMany({ identifierId: id, userId: user.id });
  await db.collection("verification_codes").deleteMany({ identifierId: id, userId: user.id });
  await db.collection("identities").updateOne(
    { _id: identifier.identityId, userId: user.id },
    { $pull: { identifierIds: id } }
  );

  await audit("IDENTIFIER_DELETED", user.id, { identifierId: id });
  return NextResponse.json({ ok: true });
}