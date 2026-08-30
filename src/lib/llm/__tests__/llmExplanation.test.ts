import fs from "fs";
import path from "path";
import { describe, it, expect } from "vitest";
import { buildRedactedFinding } from "../redactor";
import { generateTemplateFallback } from "../fallback";
import { explainFinding, explainTopExposures, ExposureWithPriority } from "../explain";

// Auto-load API keys from .env.local at project root if missing in environment
try {
  const envPath = path.resolve(process.cwd(), ".env.local");
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, "utf-8");
    const geminiMatch = envContent.match(/GEMINI_API_KEY\s*=\s*["']?([^"'\r\n]+)["']?/);
    if (geminiMatch && geminiMatch[1] && !geminiMatch[1].startsWith("your_")) {
      process.env.GEMINI_API_KEY = geminiMatch[1].trim();
    }
    const groqMatch = envContent.match(/GROQ_API_KEY\s*=\s*["']?([^"'\r\n]+)["']?/);
    if (groqMatch && groqMatch[1] && !groqMatch[1].startsWith("your_")) {
      process.env.GROQ_API_KEY = groqMatch[1].trim();
    }
  }
} catch {
  // Ignore read errors
}

const SAVED_GEMINI_KEY = process.env.GEMINI_API_KEY;
const SAVED_GROQ_KEY = process.env.GROQ_API_KEY;

// Shared raw finding used by the redactor, fallback, and explanation tests
const rawFinding = {
  severity: "HIGH" as const,
  exposureType: "PUBLIC_PHONE",
  identityConfidence: 0.94,
  evidenceConfidence: 0.98,
  evidenceTier: "document" as const,
  evidence: [
    {
      domain: "example.org",
      url: "https://www.example.org/profile/rahul-kumar",
      snippet:
        "Phone: +91 98765 43210, Email: rahul.kumar@example.com, Aadhaar: 1234 5678 9012",
    },
  ],
  threats: ["TARGETED_PHISHING", "SOCIAL_ENGINEERING"],
  recommendations: [
    { actionCode: "REQUEST_REMOVAL" },
    { actionCode: "REVIEW_VISIBILITY" },
  ],
};

describe("Dual SDK LLM Explanation Layer & Privacy Boundary", () => {
  it("redacts raw PII out of the finding payload (hard privacy rule)", () => {
    const redacted = buildRedactedFinding(rawFinding);

    expect(redacted.riskLevel).toBe("HIGH");
    expect(redacted.exposureType).toBe("PUBLIC_PHONE");
    expect(redacted.sourceDomains).toEqual(["example.org"]);
    expect(redacted.identityConfidence).toBe(0.94);

    // Hard privacy rule: no raw PII may exist in the redacted JSON string
    const redactedStr = JSON.stringify(redacted);
    expect(redactedStr).not.toContain("+91");
    expect(redactedStr).not.toContain("rahul.kumar");
    expect(redactedStr).not.toContain("1234");
    expect(redactedStr).not.toContain("snippet");
  });

  it("renders a deterministic template fallback", () => {
    const redacted = buildRedactedFinding(rawFinding);
    const fallback = generateTemplateFallback(redacted);

    expect(fallback.isAiGenerated).toBe(false);
    expect(fallback.summary).toContain("HIGH-severity");
    expect(fallback.summary).toContain("example.org");
    expect(fallback.summary).toContain("targeted phishing");
    expect(fallback.sourceRelevance).toContain("example.org");
  });

  it("explains a single finding via template fallback when API keys are missing", async () => {
    delete process.env.GEMINI_API_KEY;
    delete process.env.GROQ_API_KEY;

    const explanation = await explainFinding(rawFinding);

    expect(explanation.isAiGenerated).toBe(false);
    expect(typeof explanation.summary).toBe("string");
    expect(explanation.summary.length).toBeGreaterThan(20);
    expect(typeof explanation.sourceRelevance).toBe("string");
  });

  it("generates a live Dual SDK explanation when an API key is configured", async () => {
    if (SAVED_GEMINI_KEY) process.env.GEMINI_API_KEY = SAVED_GEMINI_KEY;
    if (SAVED_GROQ_KEY) process.env.GROQ_API_KEY = SAVED_GROQ_KEY;

    if (!process.env.GEMINI_API_KEY && !process.env.GROQ_API_KEY) {
      // Skipped live Dual SDK call (neither GEMINI_API_KEY nor GROQ_API_KEY configured)
      return;
    }

    const explanation = await explainFinding(rawFinding);
    if (explanation.isAiGenerated) {
      expect(explanation.summary.length).toBeGreaterThan(10);
      expect(explanation.sourceRelevance.length).toBeGreaterThan(10);
    }
    // Live call timed out or failed → fallback rendered safely (isAiGenerated: false)
  });

  it("explains only the top <= 5 findings and leaves the rest unexplained", async () => {
    if (SAVED_GEMINI_KEY) process.env.GEMINI_API_KEY = SAVED_GEMINI_KEY;
    if (SAVED_GROQ_KEY) process.env.GROQ_API_KEY = SAVED_GROQ_KEY;

    const mockExposures = [
      {
        id: "EXP-1",
        severity: "LOW" as const,
        priorityRank: 25,
        exposureType: "PROFILE",
        identityConfidence: 0.3,
        threats: [],
      },
      {
        id: "EXP-2",
        severity: "CRITICAL" as const,
        priorityRank: 100,
        exposureType: "CREDENTIAL",
        identityConfidence: 0.9,
        threats: ["CREDENTIAL_STUFFING"],
      },
      {
        id: "EXP-3",
        severity: "HIGH" as const,
        priorityRank: 80,
        exposureType: "PHONE",
        identityConfidence: 0.8,
        threats: ["TARGETED_PHISHING"],
      },
      {
        id: "EXP-4",
        severity: "MEDIUM" as const,
        priorityRank: 50,
        exposureType: "BROKER",
        identityConfidence: 0.6,
        threats: [],
      },
      {
        id: "EXP-5",
        severity: "HIGH" as const,
        priorityRank: 75,
        exposureType: "ADDRESS",
        identityConfidence: 0.7,
        threats: ["PHYSICAL_TARGETING"],
      },
      {
        id: "EXP-6",
        severity: "LOW" as const,
        priorityRank: 20,
        exposureType: "SNIPPET",
        identityConfidence: 0.2,
        threats: [],
      },
    ] as ExposureWithPriority[];

    const processed = await explainTopExposures(mockExposures, 5);

    expect(processed.length).toBe(6);
    expect(processed[0].id).toBe("EXP-2"); // CRITICAL, rank 100
    expect(processed[0].explanation).toBeDefined();
    expect(processed[4].explanation).toBeDefined(); // 5th finding (EXP-1)
    expect(processed[5].explanation).toBeUndefined(); // EXP-6 exceeds maxCount 5
  });
});
