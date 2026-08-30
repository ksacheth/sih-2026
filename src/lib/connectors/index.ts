/**
 * Discovery connector layer — public surface.
 *
 * The orchestrator (lib/pipeline, Dev-2 task 3) consumes:
 *   - buildTargetedQueries(ids)  → ≤6 sanitized, quoted queries
 *   - runConnector(connector, q) → ConnectorRunResult (never throws)
 *   - findBrokerResults(results) → broker-domain derived findings
 *
 * Fixture mode (FIXTURES=1 or missing API keys) is handled *inside* each
 * connector: the orchestrator never needs to know which mode it is in.
 */
import {
  ConnectorError,
  type ConnectorRunResult,
  type DiscoveryConnector,
} from "./types";
import { exposedOrNotConnector } from "./exposedOrNot";
import { serperConnector } from "./serper";

export * from "./types";
export * from "./url";
export {
  buildTargetedQueries,
  sanitizeQueryValue,
  serperConnector,
  MAX_QUERIES_PER_SCAN,
} from "./serper";
export { exposedOrNotConnector } from "./exposedOrNot";
export {
  brokerCatalog,
  findBrokerMatch,
  findBrokerResults,
  brokerOptOutUrl,
  type BrokerEntry,
} from "./brokers";
export {
  fixturesEnabled,
  shouldUseFixtures,
  pickSerperFixture,
  pickExposedOrNotFixture,
} from "./fixtures";
export { cacheGet, cacheSet, cacheKey, CACHE_TTL_HOURS } from "./cache";

/** §5.6 per-connector soft budget (30s). */
export const CONNECTOR_BUDGET_MS = 30_000;

/** All sources run by the orchestrator, in pipeline order. */
export const discoveryConnectors: DiscoveryConnector[] = [serperConnector, exposedOrNotConnector];

/**
 * Execute one connector call under the per-connector budget, converting any
 * failure into an "unavailable" ConnectorRunResult. This is the boundary the
 * pipeline uses so a source outage contributes to a PARTIAL scan instead of
 * crashing it or fabricating a clean result (§3.1, §12.4).
 */
export async function runConnector(
  connector: DiscoveryConnector,
  query: string,
  opts?: { timeoutMs?: number },
): Promise<ConnectorRunResult> {
  const timeoutMs = opts?.timeoutMs ?? CONNECTOR_BUDGET_MS;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const results = await Promise.race([
      connector.search(query),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new ConnectorError(
                "timeout",
                `${connector.source} exceeded ${timeoutMs}ms connector budget`,
              ),
            ),
          timeoutMs,
        );
      }),
    ]);
    return { source: connector.source, status: "ok", results };
  } catch (err) {
    const reason =
      err instanceof ConnectorError
        ? `${err.code}: ${err.message}`
        : err instanceof Error
          ? err.message
          : "unknown connector failure";
    return { source: connector.source, status: "unavailable", reason, results: [] };
  } finally {
    if (timer) clearTimeout(timer);
  }
}
