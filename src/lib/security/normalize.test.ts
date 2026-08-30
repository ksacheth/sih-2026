import { describe, expect, it } from "vitest";
import { normalizeIdentifier } from "./normalize";

describe("normalizeIdentifier", () => {
  it("normalizes email", () => {
    expect(normalizeIdentifier("EMAIL", " Test.User@Example.COM ")).toBe("test.user@example.com");
  });
  it("normalizes username", () => {
    expect(normalizeIdentifier("USERNAME", "@Rahul_Kumar")).toBe("rahul_kumar");
  });
  it("normalizes name whitespace", () => {
    expect(normalizeIdentifier("NAME", "Rahul    Kumar")).toBe("rahul kumar");
  });
});