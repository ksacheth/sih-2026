import { z } from "zod";

export const identifierCreateSchema = z.object({
  type: z.enum(["EMAIL", "PHONE", "USERNAME", "NAME"]),
  value: z.string().trim().min(1).max(320),
  context: z.object({
    organization: z.string().trim().max(200).optional(),
    location: z.string().trim().max(200).optional(),
  }).optional(),
  attestPhoneOwnership: z.boolean().optional(),
});

export const verifyCodeSchema = z.object({
  code: z.string().regex(/^\d{6}$/, "Code must be 6 digits"),
});

export const scanCreateSchema = z.object({
  identityId: z.string().min(8).max(128),
});

export const remediationSchema = z.object({
  status: z.literal("REMEDIATED"),
});