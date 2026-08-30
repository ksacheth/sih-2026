import { ObjectId } from "mongodb";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/models/db";
import { requireUser } from "@/lib/auth/require-user";
import { identifierCreateSchema } from "@/lib/validation";
import { enforceUserLimit } from "@/lib/security/rate-limit";
import { audit } from "@/lib/security/audit";
import {
  normalizeIdentifier, identifierHmac, publicIdentifier, hasVerifiedEmail,
} from "@/lib/identifiers";
import { issueVerificationCode } from "@/lib/verification";

export const runtime = "nodejs";

export async function GET() {
  try {
    const user = await requireUser();
    const db = await getDb();
    const docs = await db.collection("identifiers")
      .find({ userId: user.id }).project({ valueEncrypted: 0, normalizedValue: 0, valueHmac: 0 }).toArray();
    return NextResponse.json(docs.map(publicIdentifier));
  } catch (e) {
    if ((e as Error).message === "UNAUTHORIZED")
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    throw e;
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const body = identifierCreateSchema.parse(await request.json());

    if (body.type === "PHONE") {
      if (!body.attestPhoneOwnership) {
        return NextResponse.json({ error: "Phone attestation is required" }, { status: 400 });
      }
      if (!(await hasVerifiedEmail(user.id))) {
        return NextResponse.json({ error: "Verify an email before attesting a phone" }, { status: 403 });
      }
    }

    const db = await getDb();
    const normalized = normalizeIdentifier(body.type, body.value);
    const valueHmac = identifierHmac(normalized);

    const existing = await db.collection("identifiers").findOne({ userId: user.id, valueHmac });
    if (existing) return NextResponse.json(publicIdentifier(existing), { status: 200 });

    let identity = await db.collection("identities").findOne({
      userId: user.id,
      ...(body.context ? { context: body.context } : {}),
    });

    const identityId = identity?._id?.toString() ?? new ObjectId().toHexString();

    if (!identity) {
      await db.collection("identities").insertOne({
        _id: identityId,
        userId: user.id,
        context: body.context,
        identifierIds: [],
        createdAt: new Date(),
      });
    }

    const status = body.type === "PHONE" ? "ATTESTED" : "PENDING";
    const doc = {
      _id: new ObjectId().toHexString(),
      userId: user.id,
      identityId,
      type: body.type,
      valueHmac,
      normalizedValue: normalized,
      maskedValue: body.type === "PHONE"
        ? `+${normalized.replace(/\D/g, "").slice(0, 2)} •••• ${normalized.replace(/\D/g, "").slice(-4)}`
        : body.type === "EMAIL"
          ? `${normalized.slice(0, 1)}***@${normalized.split("@")[1] ?? ""}`
          : `${normalized.slice(0, 1)}••••${normalized.slice(-2)}`,
      status,
      createdAt: new Date(),
    };

    await db.collection("identifiers").insertOne(doc);
    await db.collection("identities").updateOne(
      { _id: identityId, userId: user.id },
      { $addToSet: { identifierIds: doc._id } }
    );

    let devCode: string | undefined;
    if (body.type === "EMAIL") {
      devCode = await issueVerificationCode(user.id, doc._id, normalized);
    }

    await audit("IDENTIFIER_CREATED", user.id, { identifierId: doc._id, type: body.type });
    return NextResponse.json({
      identifier: publicIdentifier(doc),
      ...(devCode ? { devVerificationCode: devCode } : {}),
    }, { status: 201 });
  } catch (e) {
    if ((e as Error).message === "UNAUTHORIZED")
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (e instanceof Error && e.name === "ZodError")
      return NextResponse.json({ error: "Invalid input" }, { status: 400 });
    throw e;
  }
}