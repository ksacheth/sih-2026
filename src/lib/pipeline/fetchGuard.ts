/**
 * Fetch guard & two-tier evidence processor (CONTEXT.md §5.6, Dev-2 task 2).
 *
 * Every outbound URL the pipeline fetches passes through here:
 *   1. SSRF validation BEFORE any network I/O — protocol allowlist, IP-literal
 *      checks, then DNS resolution checked against the same private-range
 *      table (a public hostname resolving into the VPC is still SSRF).
 *   2. Denylist — login-walled domains are never fetched (user story 10).
 *   3. Budgets — 10 pages/scan, 512KB/page, 10s/page, ≤3 redirects.
 *
 * A blocked or failed fetch is a lower-confidence lead, not a dropped lead:
 * the caller keeps the search snippet at evidence_tier "snippet" (§5.6).
 *
 * fetchImpl and resolve are injectable so the SSRF table tests never touch
 * the network — a security test that depends on network availability is not
 * a security test (issue #4, testing decisions).
 */
import dns from "node:dns/promises";
import { createHash } from "node:crypto";

export const FETCH_LIMITS = {
  maxPagesPerScan: 10,
  maxPageBytes: 512 * 1024,
  pageTimeoutMs: 10_000,
  maxRedirects: 3,
} as const;

/** Login-walled domains: never fetched, results stay snippet-tier. */
const DENYLISTED_DOMAINS = [
  "linkedin.com",
  "facebook.com",
  "instagram.com",
  "twitter.com",
  "x.com",
];

export type FetchBlockReason =
  | "blocked_protocol"
  | "ssrf_private_address"
  | "denylisted_domain"
  | "page_budget_exhausted"
  | "page_too_large"
  | "timeout"
  | "unsupported_content_type"
  | "fetch_error";

export type FetchOutcome =
  | {
      status: "ok";
      /** URL actually fetched (post-redirect). */
      finalUrl: string;
      contentType: "text/html" | "application/pdf";
      bytes: number;
      /** Extracted page text (HTML→text; empty for PDFs — no parser in MVP). */
      text: string;
      /** SHA-256 of the raw body — content fingerprint (CONTEXT.md §4). */
      contentSha256: string;
    }
  | { status: "blocked"; reason: FetchBlockReason; detail?: string }
  | { status: "failed"; reason: FetchBlockReason; detail?: string };

// ---- Address screening (pure, table-tested) --------------------------------

interface IpRange {
  network: string;
  bits: number;
}

/** Never-fetch IPv4 CIDRs: this-host, RFC1918, CGNAT, loopback, link-local
 * (incl. cloud metadata 169.254.169.254), IETF, benchmarking. */
const BLOCKED_IPV4_RANGES: IpRange[] = [
  { network: "0.0.0.0", bits: 8 },
  { network: "10.0.0.0", bits: 8 },
  { network: "100.64.0.0", bits: 10 },
  { network: "127.0.0.0", bits: 8 },
  { network: "169.254.0.0", bits: 16 },
  { network: "172.16.0.0", bits: 12 },
  { network: "192.168.0.0", bits: 16 },
  { network: "192.0.0.0", bits: 24 },
  { network: "198.18.0.0", bits: 15 },
];

function parseIpv4(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let out = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const n = Number(part);
    if (n > 255) return null;
    out = out * 256 + n;
  }
  return out >>> 0;
}

function ipv4InCidr(ip: string, network: string, bits: number): boolean {
  const ipInt = parseIpv4(ip);
  const netInt = parseIpv4(network);
  if (ipInt === null || netInt === null) return false;
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (ipInt & mask) === (netInt & mask);
}

/**
 * True when `ip` must never be fetched: loopback, RFC1918, link-local
 * (incl. the cloud metadata address), CGNAT, unique-local, multicast,
 * and the unspecified address — in plain IPv4, IPv6, and IPv4-mapped
 * IPv6 forms. Unparseable input fails closed (blocked).
 */
export function isBlockedAddress(ip: string): boolean {
  const value = ip.trim().toLowerCase();

  const mapped = value.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (mapped) return isBlockedAddress(mapped[1]);

  if (value.includes(":")) {
    if (value === "::" || value === "::1") return true; // unspecified / loopback
    // IPv4-mapped forms: WHATWG serializes ::ffff:a.b.c.d as ::ffff:hex:hex,
    // so screen both the dotted and the hex-tail spellings.
    if (value.startsWith("::ffff:")) {
      const tail = value.slice("::ffff:".length);
      if (tail.includes(".")) return isBlockedAddress(tail);
      const [hi, lo] = tail.split(":").map((g) => Number.parseInt(g, 16));
      if ([hi, lo].every((n) => Number.isFinite(n))) {
        return isBlockedAddress(`${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`);
      }
      return true; // unparseable mapped form fails closed
    }
    if (value.startsWith("fe80:")) return true; // link-local
    if (/^f[cd][0-9a-f]{2}:/.test(value)) return true; // unique-local fc00::/7
    if (value.startsWith("ff")) return true; // multicast
    if (value.startsWith("64:ff9b:")) return true; // NAT64 — tunnels IPv4, may land in private space
    return false;
  }

  if (parseIpv4(value) === null) return true; // malformed → fail closed
  return BLOCKED_IPV4_RANGES.some((r) => ipv4InCidr(value, r.network, r.bits));
}

// ---- Target validation (pre-fetch, no network for literals) -----------------

function hostIsDenied(host: string): boolean {
  const normalized = host.toLowerCase().replace(/^www\./, "").replace(/\.$/, "");
  return DENYLISTED_DOMAINS.some(
    (d) => normalized === d || normalized.endsWith(`.${d}`),
  );
}

function isIpLiteral(host: string): boolean {
  return host.includes(":") || /^\d+(\.\d+)*$/.test(host);
}

export interface FetchGuardDeps {
  /** Injectable resolver (default: node:dns lookup, {all: true}). */
  resolve?: (host: string) => Promise<Array<{ address: string; family: number }>>;
  fetchImpl?: typeof fetch;
}

export type GuardDecision =
  | { allowed: true; url: URL }
  | { allowed: false; reason: FetchBlockReason; detail?: string };

async function defaultResolve(host: string) {
  return dns.lookup(host, { all: true });
}

/**
 * Validate a fetch target. Protocol/host checks are synchronous; a real
 * hostname is resolved and EVERY resolved address is screened, so a public
 * domain pointing at internal infrastructure is rejected before any fetch.
 */
export async function validateFetchTarget(
  rawUrl: string,
  deps: FetchGuardDeps = {},
): Promise<GuardDecision> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { allowed: false, reason: "blocked_protocol", detail: "unparseable URL" };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { allowed: false, reason: "blocked_protocol", detail: parsed.protocol || "no protocol" };
  }
  if (parsed.username || parsed.password) {
    return { allowed: false, reason: "blocked_protocol", detail: "credentials in URL" };
  }

  // WHATWG URLs keep IPv6 literals bracketed ("[::1]") — strip them before
  // screening, or "[::1]" would dodge the literal-address check entirely.
  const host = parsed.hostname.toLowerCase();
  const bareHost = host.replace(/^\[/, "").replace(/\]$/, "");
  if (
    !host || host === "localhost" || host.endsWith(".localhost") ||
    host.endsWith(".local") || host.endsWith(".localdomain") ||
    host.endsWith(".internal") || host === "metadata.google.internal"
  ) {
    return { allowed: false, reason: "ssrf_private_address", detail: host || "empty host" };
  }
  if (hostIsDenied(host)) {
    return { allowed: false, reason: "denylisted_domain", detail: host };
  }

  if (isIpLiteral(host)) {
    return isBlockedAddress(bareHost)
      ? { allowed: false, reason: "ssrf_private_address", detail: bareHost }
      : { allowed: true, url: parsed };
  }

  const resolve = deps.resolve ?? defaultResolve;
  let addresses: Array<{ address: string; family: number }>;
  try {
    addresses = await resolve(host);
  } catch (e) {
    return {
      allowed: false,
      reason: "ssrf_private_address",
      detail: `dns failed: ${(e as Error).message}`,
    };
  }
  if (!addresses || addresses.length === 0) {
    return { allowed: false, reason: "ssrf_private_address", detail: "no addresses" };
  }
  for (const { address } of addresses) {
    if (isBlockedAddress(address)) {
      return { allowed: false, reason: "ssrf_private_address", detail: address };
    }
  }
  return { allowed: true, url: parsed };
}

// ---- Guarded page fetch -----------------------------------------------------

/** Per-scan page budget; the orchestrator creates one per scan. */
export class FetchBudget {
  pagesUsed = 0;
  constructor(public readonly maxPages: number = FETCH_LIMITS.maxPagesPerScan) {}
  get exhausted(): boolean {
    return this.pagesUsed >= this.maxPages;
  }
}

export interface GuardedFetchOptions extends FetchGuardDeps {
  budget: FetchBudget;
  timeoutMs?: number;
  maxBytes?: number;
}

/**
 * Fetch one page under the full guard. Redirects are followed manually and
 * every hop is re-validated (a 302 into internal space must not pass just
 * because the entry URL was clean). The body is streamed with a hard byte
 * cap; an oversized page aborts mid-download into a "failed" outcome.
 */
export async function guardedFetch(
  rawUrl: string,
  opts: GuardedFetchOptions,
): Promise<FetchOutcome> {
  const {
    budget,
    timeoutMs = FETCH_LIMITS.pageTimeoutMs,
    maxBytes = FETCH_LIMITS.maxPageBytes,
  } = opts;
  // §5.6: 10s per PAGE (not per hop) — the deadline spans redirect hops.
  const deadline = Date.now() + timeoutMs;

  if (budget.exhausted) {
    return { status: "blocked", reason: "page_budget_exhausted" };
  }

  let current: URL;
  try {
    current = new URL(rawUrl);
  } catch {
    return { status: "blocked", reason: "blocked_protocol", detail: "unparseable URL" };
  }

  for (let hop = 0; hop <= FETCH_LIMITS.maxRedirects; hop++) {
    const decision = await validateFetchTarget(current.toString(), { resolve: opts.resolve });
    if (!decision.allowed) {
      return { status: "blocked", reason: decision.reason, detail: decision.detail };
    }

    let res: Response;
    try {
      res = await (opts.fetchImpl ?? fetch)(current, {
        redirect: "manual",
        signal: AbortSignal.timeout(Math.max(deadline - Date.now(), 1)),
      });
    } catch (e) {
      const err = e as Error;
      const reason: FetchBlockReason =
        err.name === "AbortError" || err.name === "TimeoutError" ? "timeout" : "fetch_error";
      return { status: "failed", reason, detail: err.message };
    }

    if (300 <= res.status && res.status < 400) {
      const location = res.headers.get("location");
      if (!location) {
        return { status: "failed", reason: "fetch_error", detail: `redirect ${res.status} without Location` };
      }
      if (hop === FETCH_LIMITS.maxRedirects) {
        return { status: "failed", reason: "fetch_error", detail: "too many redirects" };
      }
      try {
        current = new URL(location, current);
      } catch {
        return { status: "blocked", reason: "blocked_protocol", detail: "invalid redirect target" };
      }
      continue;
    }

    budget.pagesUsed += 1;

    if (!res.ok) {
      return { status: "failed", reason: "fetch_error", detail: `HTTP ${res.status}` };
    }

    const contentType = res.headers.get("content-type") ?? "";
    const isHtml = contentType.includes("text/html");
    const isPdf = contentType.includes("application/pdf");
    if (!isHtml && !isPdf) {
      return { status: "failed", reason: "unsupported_content_type", detail: contentType };
    }

    const declared = Number(res.headers.get("content-length") ?? "");
    if (Number.isFinite(declared) && declared > maxBytes) {
      return { status: "failed", reason: "page_too_large", detail: `content-length ${declared}` };
    }

    let body: Buffer;
    try {
      body = await readCapped(res, maxBytes);
    } catch (e) {
      const err = e as Error;
      return {
        status: "failed",
        reason: err.message === "page_too_large" ? "page_too_large" : "fetch_error",
        detail: err.message,
      };
    }
    if (body.length > maxBytes) {
      return { status: "failed", reason: "page_too_large", detail: `${body.length} bytes` };
    }

    return {
      status: "ok",
      finalUrl: current.toString(),
      contentType: isPdf ? "application/pdf" : "text/html",
      bytes: body.length,
      text: isHtml ? htmlToText(body.toString("utf8")) : "",
      contentSha256: createHash("sha256").update(body).digest("hex"),
    };
  }
  return { status: "failed", reason: "fetch_error", detail: "redirect limit exceeded" };
}

/** Read a response body with a hard byte cap; throws Error("page_too_large"). */
async function readCapped(res: Response, max: number): Promise<Buffer> {
  const reader = res.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > max) throw new Error("page_too_large");
      chunks.push(Buffer.from(value));
    }
  } finally {
    try {
      await reader.cancel();
    } catch {
      // stream already closed
    }
  }
  return Buffer.concat(chunks);
}

// ---- HTML → text ------------------------------------------------------------

/**
 * Minimal HTML→text extraction for evidence capture. Regex-based by design:
 * the text is correlation input, never re-rendered, so partial entity
 * unescaping is acceptable and keeps the pipeline dependency-free.
 */
export function htmlToText(html: string): string {
  return html
    .replace(SCRIPT_STYLE_BLOCKS, " ")
    .replace(TAGS, " ")
    .replace(/&#(\d+);/g, (m, code: string) => {
      const n = Number(code);
      return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
    })
    .replace(/&#x([0-9a-f]+);/gi, (m, code: string) => {
      const n = Number.parseInt(code, 16);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
    })
    .replace(/&(amp|lt|gt|quot|apos|nbsp);/g, (m, name: string) => NAMED_ENTITIES[name] ?? m)
    .replace(/\s+/g, " ")
    .trim();
}

const SCRIPT_STYLE_BLOCKS = /<(script|style)\b[\s\S]*?<\/\1>/gi;
const TAGS = /<[^>]+>/g;
const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};
