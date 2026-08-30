import { NextResponse } from "next/server";

// Shared error-to-response mapping for route handlers. Known domain errors
// return a response; anything unknown is rethrown so Next.js logs it as 500.
export function routeError(e: unknown): NextResponse {
  const err = e as Error & { retryAfter?: number; name?: string };

  if (err?.name === "ZodError") {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }
  if (err?.message === "UNAUTHORIZED") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (err?.message === "RATE_LIMITED") {
    const headers = err.retryAfter
      ? { "Retry-After": String(err.retryAfter) }
      : undefined;
    return NextResponse.json(
      { error: "Rate limit exceeded" },
      { status: 429, headers }
    );
  }
  if (err?.message === "VERIFICATION_DELIVERY_NOT_CONFIGURED") {
    return NextResponse.json(
      { error: "Email delivery is not configured" },
      { status: 503 }
    );
  }
  if (err?.message === "VERIFICATION_DELIVERY_FAILED") {
    return NextResponse.json(
      { error: "Verification email could not be delivered" },
      { status: 502 }
    );
  }
  throw e;
}
