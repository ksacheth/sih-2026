import { describe, expect, it } from "vitest";
import {
  planTargetedQueries,
  sanitizeQueryValue,
  computeSerperCacheKey,
  MAX_QUERIES_PER_SCAN,
} from "./queryPlanner";
import {
  canonicalizeUrl,
  isAcceptablePublicUrl,
  isBlockedDomain,
  isPrivateOrLocalHost,
} from "./canonicalUrl";
import { selectUrlsForHydration, scoreDiscoveryResult } from "./selector";
import type { DiscoveryResult, SearchIdentifierSet } from "../connectors/types";

describe("Discovery Module", () => {
  describe("queryPlanner", () => {
    it("sanitizes search operators from input values", () => {
      expect(sanitizeQueryValue('user"name site:evil.com OR -bad')).toBe("user name evil.com bad");
      expect(sanitizeQueryValue("rahul.kumar@abc-tech.in")).toBe("rahul.kumar@abc-tech.in");
      expect(sanitizeQueryValue("test-user_123")).toBe("test-user_123");
    });

    it("generates ≤6 targeted queries deterministically", () => {
      const ids: SearchIdentifierSet = {
        email: "rahul.kumar@abc-tech.in",
        username: "rahul_kumar_dev",
        name: "Rahul Kumar",
        org: "ABC Technologies",
      };

      const queries = planTargetedQueries(ids);
      expect(queries.length).toBeLessThanOrEqual(MAX_QUERIES_PER_SCAN);
      expect(queries).toEqual([
        '"rahul.kumar@abc-tech.in"',
        '"rahul_kumar_dev"',
        '"Rahul Kumar" "rahul.kumar@abc-tech.in"',
        '"rahul.kumar@abc-tech.in" filetype:pdf',
        '"Rahul Kumar" "ABC Technologies"',
        '"rahul_kumar_dev" "ABC Technologies"',
      ]);
    });

    it("omits queries when identifier fields are missing", () => {
      const ids: SearchIdentifierSet = {
        email: "alone@example.com",
      };

      const queries = planTargetedQueries(ids);
      expect(queries).toEqual(['"alone@example.com"', '"alone@example.com" filetype:pdf']);
    });

    it("produces deterministic HMAC cache keys", () => {
      const key1 = computeSerperCacheKey('"rahul.kumar@abc-tech.in"', { secret: "test" });
      const key2 = computeSerperCacheKey('"rahul.kumar@abc-tech.in"', { secret: "test" });
      const key3 = computeSerperCacheKey('"other@abc-tech.in"', { secret: "test" });

      expect(key1).toBe(key2);
      expect(key1).not.toBe(key3);
    });
  });

  describe("canonicalUrl", () => {
    it("strips tracking parameters while preserving meaningful query params", () => {
      const url =
        "https://example.com/profile?id=123&utm_source=google&utm_medium=cpc&gclid=xyz&tab=overview";
      const canon = canonicalizeUrl(url);
      expect(canon).toBe("https://example.com/profile?id=123&tab=overview");
    });

    it("normalizes default ports, trailing slashes, and lowercase hosts", () => {
      const url = "HTTPS://WWW.Example.COM:443/team/rahul/";
      const canon = canonicalizeUrl(url);
      expect(canon).toBe("https://www.example.com/team/rahul");
    });

    it("identifies private and localhost targets for SSRF prevention", () => {
      expect(isPrivateOrLocalHost("localhost")).toBe(true);
      expect(isPrivateOrLocalHost("127.0.0.1")).toBe(true);
      expect(isPrivateOrLocalHost("10.0.0.5")).toBe(true);
      expect(isPrivateOrLocalHost("172.20.0.1")).toBe(true);
      expect(isPrivateOrLocalHost("192.168.1.1")).toBe(true);
      expect(isPrivateOrLocalHost("169.254.169.254")).toBe(true);
      expect(isPrivateOrLocalHost("::1")).toBe(true);
      expect(isPrivateOrLocalHost("example.com")).toBe(false);
      expect(isPrivateOrLocalHost("abc-tech.in")).toBe(false);
    });

    it("identifies blocked/login-walled domains", () => {
      expect(isBlockedDomain("https://www.linkedin.com/in/rahul")).toBe(true);
      expect(isBlockedDomain("https://facebook.com/user")).toBe(true);
      expect(isBlockedDomain("https://instagram.com/p/123")).toBe(true);
      expect(isBlockedDomain("https://twitter.com/dev")).toBe(true);
      expect(isBlockedDomain("https://x.com/dev")).toBe(true);
      expect(isBlockedDomain("https://abc-tech.in")).toBe(false);
    });

    it("enforces URL safety checks", () => {
      expect(isAcceptablePublicUrl("https://abc-tech.in/team").acceptable).toBe(true);
      expect(isAcceptablePublicUrl("file:///etc/passwd").acceptable).toBe(false);
      expect(isAcceptablePublicUrl("javascript:alert(1)").acceptable).toBe(false);
      expect(isAcceptablePublicUrl("http://127.0.0.1:8080/secret").acceptable).toBe(false);
      expect(isAcceptablePublicUrl("https://user:pass@example.com").acceptable).toBe(false);
      expect(isAcceptablePublicUrl("https://linkedin.com/in/rahul").acceptable).toBe(false);
    });
  });

  describe("selector", () => {
    const ids: SearchIdentifierSet = {
      email: "rahul.kumar@abc-tech.in",
      username: "rahul_kumar_dev",
      name: "Rahul Kumar",
      org: "ABC Technologies",
    };

    const mockResults: DiscoveryResult[] = [
      {
        source: "serper",
        sourceId: "1",
        url: "https://abc-tech.in/team/rahul-kumar",
        domain: "abc-tech.in",
        title: "Rahul Kumar | ABC Technologies",
        snippet: "Rahul Kumar, rahul.kumar@abc-tech.in at ABC Technologies",
        discoveredAt: new Date().toISOString(),
        evidenceTier: "snippet",
        contentType: "text/html",
        rawMetadata: { position: 1 },
      },
      {
        source: "serper",
        sourceId: "2",
        url: "https://linkedin.com/in/rahul-kumar",
        domain: "linkedin.com",
        title: "Rahul Kumar - LinkedIn",
        snippet: "Senior Engineer",
        discoveredAt: new Date().toISOString(),
        evidenceTier: "snippet",
        contentType: "text/html",
        rawMetadata: { position: 2 },
      },
      {
        source: "serper",
        sourceId: "3",
        url: "https://rahulkumar.dev/resume.pdf",
        domain: "rahulkumar.dev",
        title: "Resume",
        snippet: "Email: rahul.kumar@abc-tech.in",
        discoveredAt: new Date().toISOString(),
        evidenceTier: "snippet",
        contentType: "application/pdf",
        rawMetadata: { position: 3 },
      },
    ];

    it("ranks and separates acceptable URLs from blocked/snippet-only URLs", () => {
      const outcome = selectUrlsForHydration(mockResults, ids, 10);

      // linkedin.com should be rejected from hydration due to login-wall denylist, but kept in snippetOnly
      expect(outcome.selectedForHydration.map((r) => r.url)).toContain(
        "https://abc-tech.in/team/rahul-kumar",
      );
      expect(outcome.selectedForHydration.map((r) => r.url)).toContain(
        "https://rahulkumar.dev/resume.pdf",
      );
      expect(outcome.selectedForHydration.map((r) => r.url)).not.toContain(
        "https://linkedin.com/in/rahul-kumar",
      );
      expect(outcome.snippetOnlyResults.map((r) => r.url)).toContain(
        "https://linkedin.com/in/rahul-kumar",
      );
    });

    it("deduplicates results by canonical URL", () => {
      const duplicateResults: DiscoveryResult[] = [
        { ...mockResults[0], url: "https://abc-tech.in/team/rahul-kumar?utm_source=google" },
        { ...mockResults[0], url: "https://abc-tech.in/team/rahul-kumar?utm_source=newsletter" },
      ];

      const outcome = selectUrlsForHydration(duplicateResults, ids);
      expect(outcome.selectedForHydration.length).toBe(1);
    });
  });
});
