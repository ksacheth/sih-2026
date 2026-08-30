import { getDb } from "@/lib/models/db";
import { sha256, randomCode } from "@/lib/security/crypto";

const TTL_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 5;

export async function issueVerificationCode(
  userId: string,
  identifierId: string,
  destination: string
) {
  const dev = process.env.NODE_ENV !== "production";
  const resendKey = process.env.AUTH_RESEND_KEY;
  const resendFrom = process.env.AUTH_RESEND_FROM;

  // Fail before any database write: a PENDING identifier whose code can
  // never be delivered is worse than a rejected request.
  if (!dev && (!resendKey || !resendFrom)) {
    throw new Error("VERIFICATION_DELIVERY_NOT_CONFIGURED");
  }

  const code = randomCode();
  const db = await getDb();

  await db.collection("verification_codes").insertOne({
    userId,
    identifierId,
    codeHash: sha256(code),
    attempts: 0,
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + TTL_MS),
  });

  if (dev) console.info(`[DEV VERIFICATION CODE] ${identifierId}: ${code}`);

  if (resendKey && resendFrom) {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: resendFrom,
        to: destination,
        subject: "Your exposure monitor verification code",
        text: `Your verification code is ${code}. It expires in 10 minutes.`,
      }),
    });
    if (!response.ok) throw new Error("VERIFICATION_DELIVERY_FAILED");
  }

  return dev ? code : undefined;
}

export async function verifyCode(userId: string, identifierId: string, code: string) {
  const db = await getDb();
  const now = new Date();
  const codes = db.collection("verification_codes");

  const record = await codes.findOne(
    { userId, identifierId },
    { sort: { createdAt: -1 } }
  );
  if (!record || record.expiresAt <= now) throw new Error("CODE_EXPIRED");
  if (record.attempts >= MAX_ATTEMPTS) throw new Error("TOO_MANY_ATTEMPTS");

  if (sha256(code) !== record.codeHash) {
    // Guarded increment: concurrent wrong-code requests cannot push attempts
    // past the cap; a null result means the cap was just reached.
    const consumed = await codes.findOneAndUpdate(
      { _id: record._id, attempts: { $lt: MAX_ATTEMPTS } },
      { $inc: { attempts: 1 } }
    );
    if (!consumed) throw new Error("TOO_MANY_ATTEMPTS");
    throw new Error("INVALID_CODE");
  }

  // Atomic claim-and-delete: exactly one concurrent request with the correct
  // code can consume the record; the loser re-classifies below.
  const claimed = await codes.findOneAndDelete({
    _id: record._id,
    codeHash: record.codeHash,
    attempts: { $lt: MAX_ATTEMPTS },
    expiresAt: { $gt: now },
  });
  if (!claimed) {
    const fresh = await codes.findOne({ _id: record._id });
    if (!fresh || fresh.expiresAt <= new Date()) throw new Error("CODE_EXPIRED");
    throw new Error("TOO_MANY_ATTEMPTS");
  }

  await db.collection("identifiers").updateOne(
    { _id: identifierId, userId },
    { $set: { status: "VERIFIED", verifiedAt: new Date() } }
  );

  try {
    await db.collection("consents").insertOne({
      userId,
      identifierId,
      purpose: "EXPOSURE_MONITORING",
      scope: "scan_verified_identifier",
      version: "v1",
      createdAt: new Date(),
    });
  } catch (e) {
    // Unique index on (userId, identifierId, purpose): a concurrent
    // verification already recorded the consent, which is fine.
    if ((e as { code?: number }).code !== 11000) throw e;
  }
}
