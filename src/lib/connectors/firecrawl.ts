/**
 * Firecrawl v2 Scrape Adapter (architecture.md §4.3, §6, §12).
 *
 * - Calls Firecrawl v2 POST /scrape with Bearer key.
 * - Options: formats: ["markdown"], onlyMainContent: true, removeBase64Images: true,
 *   blockAds: true, storeInCache: false, timeout: 30000.
 * - Enforces bounded retry: max 1 retry for 408, 429, 5xx, or network error.
 * - Never retries 400, 401, 403.
 * - Concurrency bounded (max 3 concurrent).
 * - Transparent fixture mode when FIXTURES=1 or FIRECRAWL_API_KEY is missing.
 * - Never throws unhandled errors into the caller; returns typed HydrateResponse.
 */

import { createHash } from "crypto";
import { pickFirecrawlFixture, shouldUseFixtures } from "./fixtures";
import type {
  HydrateRequest,
  HydrateResponse,
  HydratedDocument,
  ProviderError,
  ProviderStatus,
} from "./types";
import { extractDomain } from "./url";

const FIRECRAWL_DEFAULT_BASE_URL = "https://api.firecrawl.dev/v2";
const FIRECRAWL_API_KEY_ENV = "FIRECRAWL_API_KEY";
const FIRECRAWL_BASE_URL_ENV = "FIRECRAWL_BASE_URL";
const DEFAULT_SCRAPE_TIMEOUT_MS = 30_000;
const MAX_RETRY_DELAY_MS = 2_000;
export const FIRECRAWL_CONCURRENCY_LIMIT = 3;
export const MAX_HYDRATE_URLS_PER_SCAN = 10;

export function sha256Hex(data: string): string {
  return createHash("sha256").update(data, "utf8").digest("hex");
}

function isPdfUrl(url: string): boolean {
  return /\.pdf(\?|#|$)/i.test(url);
}

function parseRetryAfterMs(headerValue: string | null): number | undefined {
  if (!headerValue) return undefined;
  const sec = Number(headerValue);
  if (!Number.isNaN(sec) && sec >= 0) {
    return Math.min(sec * 1000, MAX_RETRY_DELAY_MS);
  }
  const date = Date.parse(headerValue);
  if (!Number.isNaN(date)) {
    const delay = date - Date.now();
    return delay > 0 ? Math.min(delay, MAX_RETRY_DELAY_MS) : 0;
  }
  return undefined;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Builds a HydratedDocument from scraped markdown data.
 */
export function buildHydratedDocument(
  req: HydrateRequest,
  markdown: string,
  options?: {
    title?: string;
    contentType?: "text/html" | "application/pdf" | "text/plain";
    providerRequestId?: string;
  },
): HydratedDocument {
  const domain = extractDomain(req.url);
  const sourceId = sha256Hex(req.canonicalUrl || req.url);
  const contentHash = sha256Hex(markdown);
  const isPdf = isPdfUrl(req.url);

  return {
    source: "firecrawl",
    sourceId,
    url: req.url,
    canonicalUrl: req.canonicalUrl || req.url,
    domain,
    title: options?.title,
    markdown,
    contentType: options?.contentType ?? (isPdf ? "application/pdf" : "text/html"),
    retrievedAt: new Date().toISOString(),
    evidenceTier: "document",
    contentHash,
    providerRequestId: options?.providerRequestId,
  };
}

/**
 * Scrapes a single URL via Firecrawl v2 /scrape endpoint.
 */
export async function scrapeUrlWithFirecrawl(
  req: HydrateRequest,
  options?: {
    apiKey?: string;
    baseUrl?: string;
    timeoutMs?: number;
  },
): Promise<HydrateResponse> {
  const apiKey = options?.apiKey || process.env[FIRECRAWL_API_KEY_ENV];
  const baseUrl = (
    options?.baseUrl ||
    process.env[FIRECRAWL_BASE_URL_ENV] ||
    FIRECRAWL_DEFAULT_BASE_URL
  ).replace(/\/+$/, "");
  const timeoutMs = options?.timeoutMs ?? DEFAULT_SCRAPE_TIMEOUT_MS;

  // 1. Check fixture mode
  if (shouldUseFixtures(apiKey)) {
    const fixture = pickFirecrawlFixture(req.url);
    if (!fixture || !fixture.success || !fixture.data?.markdown) {
      if (fixture && fixture.error) {
        return {
          status: "unavailable",
          error: {
            code: "FIRECRAWL_FIXTURE_ERROR",
            retryable: false,
          },
        };
      }
      return {
        status: "unavailable",
        error: {
          code: "FIRECRAWL_NOT_IN_FIXTURES",
          retryable: false,
        },
      };
    }

    const doc = buildHydratedDocument(req, fixture.data.markdown, {
      title: fixture.data.title || fixture.data.metadata?.title,
      contentType:
        (fixture.data.metadata?.contentType as
          | "text/html"
          | "application/pdf"
          | "text/plain") ?? (isPdfUrl(req.url) ? "application/pdf" : "text/html"),
      providerRequestId: "fixture-req-id",
    });

    return {
      status: "completed",
      document: doc,
    };
  }

  if (!apiKey) {
    return {
      status: "unavailable",
      error: {
        code: "FIRECRAWL_API_KEY_MISSING",
        retryable: false,
      },
    };
  }

  const endpoint = `${baseUrl}/scrape`;
  const isPdf = isPdfUrl(req.url);
  const payload: Record<string, unknown> = {
    url: req.url,
    formats: ["markdown"],
    onlyMainContent: true,
    removeBase64Images: true,
    blockAds: true,
    storeInCache: false,
    timeout: timeoutMs,
  };
  if (isPdf) {
    payload.parsers = ["pdf"];
  }

  // Helper to execute single HTTP attempt
  const executeAttempt = async (): Promise<{
    ok: boolean;
    status: number;
    data?: unknown;
    retryAfterMs?: number;
    errorType?: string;
  }> => {
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(timeoutMs),
      });

      const retryAfterMs = parseRetryAfterMs(res.headers.get("Retry-After"));

      if (!res.ok) {
        return {
          ok: false,
          status: res.status,
          retryAfterMs,
        };
      }

      let parsed: unknown;
      try {
        parsed = await res.json();
      } catch {
        return {
          ok: false,
          status: res.status,
          errorType: "invalid_json",
        };
      }

      return {
        ok: true,
        status: res.status,
        data: parsed,
      };
    } catch (err) {
      const isTimeout =
        err instanceof Error &&
        (err.name === "AbortError" || err.name === "TimeoutError" || err.message.includes("timeout"));
      return {
        ok: false,
        status: isTimeout ? 408 : 0,
        errorType: isTimeout ? "timeout" : "network",
      };
    }
  };

  // Attempt 1
  let attemptResult = await executeAttempt();

  // Retry logic for 408, 429, 5xx, or network error (status 0)
  const isRetryable =
    attemptResult.status === 408 ||
    attemptResult.status === 429 ||
    attemptResult.status >= 500 ||
    attemptResult.status === 0;

  if (!attemptResult.ok && isRetryable) {
    const delay = Math.min(attemptResult.retryAfterMs ?? 1000, MAX_RETRY_DELAY_MS);
    await sleep(delay);
    attemptResult = await executeAttempt();
  }

  // Handle final failure
  if (!attemptResult.ok) {
    if (attemptResult.status === 429) {
      return {
        status: "rate_limited",
        error: {
          code: "FIRECRAWL_429",
          retryable: false,
          statusCode: 429,
        },
      };
    }
    if (attemptResult.status === 408 || attemptResult.errorType === "timeout") {
      return {
        status: "unavailable",
        error: {
          code: "FIRECRAWL_TIMEOUT",
          retryable: false,
          statusCode: 408,
        },
      };
    }
    if (attemptResult.status === 401 || attemptResult.status === 403) {
      return {
        status: "unavailable",
        error: {
          code: attemptResult.status === 401 ? "FIRECRAWL_401" : "FIRECRAWL_403",
          retryable: false,
          statusCode: attemptResult.status,
        },
      };
    }
    if (attemptResult.status === 400) {
      return {
        status: "invalid_response",
        error: {
          code: "FIRECRAWL_400",
          retryable: false,
          statusCode: 400,
        },
      };
    }

    return {
      status: "unavailable",
      error: {
        code: attemptResult.status >= 500 ? `FIRECRAWL_${attemptResult.status}` : "FIRECRAWL_UNAVAILABLE",
        retryable: false,
        statusCode: attemptResult.status || undefined,
      },
    };
  }

  // Validate successful payload structure
  const rawData = attemptResult.data as {
    success?: boolean;
    data?: {
      markdown?: string;
      title?: string;
      metadata?: Record<string, unknown>;
    };
    id?: string;
  };

  if (!rawData || typeof rawData !== "object" || rawData.success === false) {
    return {
      status: "invalid_response",
      error: {
        code: "FIRECRAWL_INVALID_RESPONSE",
        retryable: false,
      },
    };
  }

  const markdown = rawData.data?.markdown;
  if (typeof markdown !== "string" || markdown.trim().length === 0) {
    return {
      status: "partial",
      error: {
        code: "FIRECRAWL_EMPTY_CONTENT",
        retryable: false,
      },
    };
  }

  const doc = buildHydratedDocument(req, markdown, {
    title: rawData.data?.title || (rawData.data?.metadata?.title as string | undefined),
    contentType: isPdf ? "application/pdf" : "text/html",
    providerRequestId: rawData.id,
  });

  return {
    status: "completed",
    document: doc,
  };
}

/**
 * Hydrates multiple URLs with bounded concurrency (architecture.md §6.3).
 */
export async function hydrateUrlsWithFirecrawl(
  requests: HydrateRequest[],
  options?: {
    concurrencyLimit?: number;
    apiKey?: string;
    baseUrl?: string;
  },
): Promise<Map<string, HydrateResponse>> {
  const limit = options?.concurrencyLimit ?? FIRECRAWL_CONCURRENCY_LIMIT;
  const results = new Map<string, HydrateResponse>();
  const queue = [...requests];

  const workers = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    while (queue.length > 0) {
      const item = queue.shift();
      if (!item) break;
      const resp = await scrapeUrlWithFirecrawl(item, options);
      results.set(item.url, resp);
    }
  });

  await Promise.all(workers);
  return results;
}
