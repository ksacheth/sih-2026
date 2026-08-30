import { describe, expect, it } from "vitest";
import { maskEmail, maskPhone } from "./masking";

describe("masking", () => {
  it("masks email", () => expect(maskEmail("rahul@example.com")).toBe("r***@example.com"));
  it("masks phone", () => expect(maskPhone("+919876543210")).toBe("+91 •••• 3210"));
});