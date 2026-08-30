import { Schema, model, models } from "mongoose";

const userSchema = new Schema({ email: { type: String, required: true, unique: true }, createdAt: { type: Date, default: Date.now } });
const identifierSchema = new Schema({ userId: { type: Schema.Types.ObjectId, required: true, index: true }, type: { type: String, enum: ["email", "phone", "username"], required: true }, valueHmac: { type: String, required: true }, maskedValue: { type: String, required: true }, status: { type: String, enum: ["PENDING", "VERIFIED", "ATTESTED"], required: true }, createdAt: { type: Date, default: Date.now } });
identifierSchema.index({ userId: 1, type: 1, valueHmac: 1 }, { unique: true });
const codeSchema = new Schema({ identifierId: { type: Schema.Types.ObjectId, required: true, index: true }, codeHash: { type: String, required: true }, expiresAt: { type: Date, required: true, index: { expires: 0 } } });
const magicLinkSchema = new Schema({ email: { type: String, required: true, index: true }, tokenHash: { type: String, required: true, unique: true }, expiresAt: { type: Date, required: true, index: { expires: 0 } } });

export const User = models.User ?? model("User", userSchema);
export const IdentifierModel = models.Identifier ?? model("Identifier", identifierSchema);
export const VerificationCode = models.VerificationCode ?? model("VerificationCode", codeSchema);
export const MagicLink = models.MagicLink ?? model("MagicLink", magicLinkSchema);
