import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/require-user";
import { routeError } from "@/lib/http";
import { getOwnedIdentifier } from "@/lib/identifiers";
import { verifyCode } from "@/lib/verification";
import { verifyCodeSchema } from "@/lib/validation";
import { audit } from "@/lib/security/audit";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const identifier = await getOwnedIdentifier(user.id, id);
    if (!identifier) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const { code } = verifyCodeSchema.parse(await request.json());
    await verifyCode(user.id, id, code);
    await audit("IDENTIFIER_VERIFIED", user.id, { identifierId: id });
    return NextResponse.json({ status: "VERIFIED" });
  } catch (e) {
    const message = (e as Error).message;
    if (message === "UNAUTHORIZED") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (message === "INVALID_CODE") return NextResponse.json({ error: "Invalid code" }, { status: 400 });
    if (message === "CODE_EXPIRED") return NextResponse.json({ error: "Code expired" }, { status: 400 });
    if (message === "TOO_MANY_ATTEMPTS") return NextResponse.json({ error: "Too many attempts" }, { status: 429 });
    return routeError(e);
  }
}