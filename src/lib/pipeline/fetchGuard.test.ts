import { describe, expect, it } from "vitest";
import {
  FETCH_LIMITS,
  FetchBudget,
  guardedFetch,
  htmlToText,
  isBlockedAddress,
  validateFetchTarget,
} from "./fetchGuard";

const PUBLIC_IP = "93.184.216.34";

function okResolve() {
  return async () => [{ address: PUBLIC_IP, family: 4 }];
}

function privateResolve() {
  return async () => [{ address: "192.168.0.10", family: 4 }];
}

function htmlResponse(body: string, headers: Record<string, string> = {}) {
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/html", ...headers },
  });
}

/** §11.3 address table: everything here must be unfetchable. */
describe("isBlockedAddress", () => {
  const blocked = [
    "127.0.0.1", // loopback
    "10.1.2.3", // RFC1918 10/8
    "172.16.0.9", // RFC1918 172.16/12
    "192.168.1.1", // RFC1918 192.168/16
    "169.254.169.254", // cloud metadata
    "0.0.0.0",
    "100.64.0.1", // CGNAT
    "198.18.0.1", // benchmark
    "::1", // IPv6 loopback
    "fe80::1", // IPv6 link-local
    "fd00::1", // IPv6 unique-local
    "::ffff:10.0.0.1", // IPv4-mapped
    "not-an-ip", // unparseable fails closed
  ];
  it.each(blocked)("blocks %s", (ip) => {
    expect(isBlockedAddress(ip)).toBe(true);
  });

  it.each(["8.8.8.8", "1.1.1.1", "93.184.216.34"])("allows public %s", (ip) => {
    expect(isBlockedAddress(ip)).toBe(false);
  });
});

describe("validateFetchTarget — the SSRF gate (no network for literals)", () => {
  const rejected = [
    ["http://127.0.0.1/x", "ssrf_private_address"],
    ["http://169.254.169.254/latest/meta-data/", "ssrf_private_address"],
    ["http://10.0.0.5/admin", "ssrf_private_address"],
    ["http://192.168.0.1/router", "ssrf_private_address"],
    ["http://[::1]/x", "ssrf_private_address"],
    ["http://[fd00::1]/x", "ssrf_private_address"],
    ["http://[::ffff:10.0.0.1]/x", "ssrf_private_address"],
    ["http://localhost/x", "ssrf_private_address"],
    ["http://metadata.google.internal/computeMetadata/", "ssrf_private_address"],
    ["http://api.local/x", "ssrf_private_address"],
    ["file:///etc/passwd", "blocked_protocol"],
    ["ftp://example.com/file", "blocked_protocol"],
    ["http://user:pass@example.com/", "blocked_protocol"],
    ["http://linkedin.com/in/someone", "denylisted_domain"],
    ["https://www.facebook.com/profile", "denylisted_domain"],
    ["https://x.com/user", "denylisted_domain"],
  ] as const;

  it.each(rejected)("rejects %s (%s)", async (url, reason) => {
    const decision = await validateFetchTarget(url, { resolve: okResolve() });
    expect(decision).toMatchObject({ allowed: false, reason });
  });

  it("canonicalizes obfuscated IPv4 hosts via WHATWG parsing", async () => {
    // Node's URL parser normalizes decimal/hex IPv4 to the dotted form the
    // range checks see (2130706433 === 127.0.0.1).
    const decimal = await validateFetchTarget("http://2130706433/x");
    expect(decimal).toMatchObject({ allowed: false, reason: "ssrf_private_address" });
    const hex = await validateFetchTarget("http://0x7f000001/x");
    expect(hex).toMatchObject({ allowed: false, reason: "ssrf_private_address" });
  });

  it("blocks hostnames whose DNS resolves into a private range (SSRF bypass)", async () => {
    const decision = await validateFetchTarget("https://internal.example.com/", {
      resolve: privateResolve(),
    });
    expect(decision).toMatchObject({ allowed: false, reason: "ssrf_private_address" });
  });

  it("allows public https targets", async () => {
    const decision = await validateFetchTarget("https://example.com/page", {
      resolve: okResolve(),
    });
    expect(decision).toMatchObject({ allowed: true });
  });
});

describe("guardedFetch — budgets and two-tier outcomes", () => {
  it("rejects denylisted domains before any network call", async () => {
    let calls = 0;
    const outcome = await guardedFetch("https://linkedin.com/in/someone", {
      budget: new FetchBudget(),
      fetchImpl: async () => {
        calls += 1;
        return htmlResponse("<p>x</p>");
      },
    });
    expect(outcome).toMatchObject({ status: "blocked", reason: "denylisted_domain" });
    expect(calls).toBe(0);
  });

  it("does not start a page past the per-scan budget", async () => {
    const budget = new FetchBudget(0);
    const outcome = await guardedFetch("https://example.com/", {
      budget,
      fetchImpl: async () => htmlResponse("<p>x</p>"),
    });
    expect(outcome).toMatchObject({ status: "blocked", reason: "page_budget_exhausted" });
  });

  it("fetches and parses a page into a document outcome", async () => {
    const outcome = await guardedFetch("https://example.com/profile", {
      budget: new FetchBudget(),
      resolve: okResolve(),
      fetchImpl: async () => htmlResponse("<html><body><p>Hello world</p></body></html>"),
    });
    expect(outcome).toMatchObject({
      status: "ok",
      contentType: "text/html",
      text: "Hello world",
    });
    if (outcome.status === "ok") {
      expect(outcome.contentSha256).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it("aborts an oversized page mid-download (512KB cap)", async () => {
    const big = "x".repeat(FETCH_LIMITS.maxPageBytes + 1);
    const outcome = await guardedFetch("https://example.com/huge", {
      budget: new FetchBudget(),
      resolve: okResolve(),
      fetchImpl: async () => htmlResponse(big),
    });
    expect(outcome).toMatchObject({ status: "failed", reason: "page_too_large" });
  });

  it("re-validates each redirect hop (302 into private space is blocked)", async () => {
    const outcome = await guardedFetch("https://example.com/redirect", {
      budget: new FetchBudget(),
      resolve: okResolve(),
      fetchImpl: async () =>
        new Response(null, { status: 302, headers: { location: "http://169.254.169.254/x" } }),
    });
    expect(outcome).toMatchObject({ status: "blocked", reason: "ssrf_private_address" });
  });

  it("fetches PDFs structurally but without parsed text (no parser in MVP)", async () => {
    const outcome = await guardedFetch("https://example.com/resume.pdf", {
      budget: new FetchBudget(),
      resolve: okResolve(),
      fetchImpl: async () =>
        new Response("%PDF-1.4", {
          status: 200,
          headers: { "content-type": "application/pdf" },
        }),
    });
    expect(outcome).toMatchObject({ status: "ok", contentType: "application/pdf", text: "" });
  });

  it("maps fetch timeouts to the timeout reason", async () => {
    const outcome = await guardedFetch("https://example.com/slow", {
      budget: new FetchBudget(),
      resolve: okResolve(),
      fetchImpl: async () => {
        const err = new DOMException("The operation was aborted", "TimeoutError");
        throw err;
      },
    });
    expect(outcome).toMatchObject({ status: "failed", reason: "timeout" });
  });
});

describe("htmlToText", () => {
  it("drops scripts and styles, decodes entities, collapses whitespace", () => {
    expect(
      htmlToText("<style>.x{}</style><script>evil()</script><p>A&nbsp;&amp;&nbsp;B</p>"),
    ).toBe("A & B");
  });
});
