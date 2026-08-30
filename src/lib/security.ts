import { createHash, createHmac, randomBytes, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";

const secret = process.env.AUTH_SECRET ?? "local-development-secret-change-me";
const isProduction = process.env.NODE_ENV === "production";

export const hash = (value: string) => createHash("sha256").update(value).digest("hex");
export const randomToken = (bytes = 32) => randomBytes(bytes).toString("hex");

export function maskIdentifier(type: "email" | "phone" | "username", value: string) {
  if (type === "email") { const [name, domain] = value.split("@"); return `${name?.[0] ?? "*"}***@${domain ?? "hidden"}`; }
  if (type === "phone") return `+91 •••• ${value.replace(/\D/g, "").slice(-4)}`;
  return `${value.slice(0, 1)}****`;
}

export function signSession(userId: string) {
  const payload = `${userId}.${Date.now() + 1000 * 60 * 60 * 24 * 7}`;
  return `${payload}.${createHmac("sha256", secret).update(payload).digest("hex")}`;
}

export async function getSessionUserId() {
  const token = (await cookies()).get("privacy_lens_session")?.value;
  if (!token) return null;
  const [userId, expiresAt, signature] = token.split(".");
  if (!userId || !expiresAt || !signature || Date.now() > Number(expiresAt)) return null;
  const payload = `${userId}.${expiresAt}`;
  const expected = createHmac("sha256", secret).update(payload).digest("hex");
  if (signature.length !== expected.length || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  return userId;
}

export const sessionCookie = () => ({ httpOnly: true, sameSite: "lax" as const, secure: isProduction, path: "/", maxAge: 60 * 60 * 24 * 7 });
