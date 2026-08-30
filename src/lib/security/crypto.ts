import crypto from "node:crypto";

export function sha256(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function hmac(value: string): string {
  const secret = process.env.HMAC_SECRET;
  if (!secret) throw new Error("HMAC_SECRET is required");
  return crypto.createHmac("sha256", secret).update(value).digest("hex");
}

export function randomCode(): string {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
}
