import { describe, expect, it } from "vitest";
import { normalizeUrl } from "./url";

describe("normalizeUrl (§6.1 canonical identity key)", () => {
  it("strips tracking params, www, fragments and trailing slashes", () => {
    expect(
      normalizeUrl(
        "https://www.Example.com/people/rahul/?utm_source=google&fbclid=abc&id=7#section",
      ),
    ).toBe("https://example.com/people/rahul?id=7");
  });

  it("unifies http and https to one identity", () => {
    expect(normalizeUrl("http://example.com/page")).toBe(
      normalizeUrl("https://example.com/page"),
    );
  });

  it("drops default ports and sorts remaining params for a stable key", () => {
    expect(normalizeUrl("http://example.com:80/x?b=2&a=1")).toBe(
      "https://example.com/x?a=1&b=2",
    );
    expect(normalizeUrl("https://example.com:443/x?a=1")).toBe("https://example.com/x?a=1");
  });

  it("keeps the root slash and functional params", () => {
    expect(normalizeUrl("https://example.com/")).toBe("https://example.com/");
  });

  it("returns null for non-http(s) and unparseable input", () => {
    expect(normalizeUrl("file:///etc/passwd")).toBeNull();
    expect(normalizeUrl("javascript:alert(1)")).toBeNull();
    expect(normalizeUrl("not a url")).toBeNull();
    expect(normalizeUrl("")).toBeNull();
  });

  it("gives differently-spelled same pages one identity (dedup, §12.1)", () => {
    const a = normalizeUrl("https://www.broker.example/listing/123?utm_campaign=x");
    const b = normalizeUrl("http://broker.example/listing/123");
    expect(a).toBe(b);
  });
});
