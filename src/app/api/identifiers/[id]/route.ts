import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/require-user";
import { getDb } from "@/lib/models/db";
import { routeError } from "@/lib/http";
import { getOwnedIdentifier } from "@/lib/identifiers";
import { audit } from "@/lib/security/audit";

export const runtime = "nodejs";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const identifier = await getOwnedIdentifier(user.id, id);
    if (!identifier) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const db = await getDb();
    // One transaction: a partial cleanup (identifier gone, consents/codes
    // orphaned, retry 404ing) must not be possible.
    const session = db.client.startSession();
    try {
      await session.withTransaction(async () => {
        await db.collection("identifiers").deleteOne({ _id: id, userId: user.id }, { session });
        await db.collection("consents").deleteMany({ identifierId: id, userId: user.id }, { session });
        await db.collection("verification_codes").deleteMany({ identifierId: id, userId: user.id }, { session });
        await db.collection("identities").updateOne(
          { _id: identifier.identityId, userId: user.id },
          // Cast: the driver types $pull values as array-filter operators;
          // a plain id string removes the matching element.
          { $pull: { identifierIds: id as any } },
          { session }
        );
      });
    } finally {
      await session.endSession();
    }

    await audit("IDENTIFIER_DELETED", user.id, { identifierId: id });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return routeError(e);
  }
}
