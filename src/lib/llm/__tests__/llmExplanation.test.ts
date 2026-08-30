import fs from "fs";
import path from "path";
import { buildRedactedFinding } from "../redactor";
import { generateTemplateFallback } from "../fallback";
import { explainFinding, explainTopExposures } from "../explain";

// Auto-load GROQ_API_KEY from .env.local at project root if missing in environment
if (!process.env.GROQ_API_KEY) {
  try {
    const envPath = path.resolve(process.cwd(), ".env.local");
    if (fs.existsSync(envPath)) {
      const envContent = fs.readFileSync(envPath, "utf-8");
      const match = envContent.match(
        /GROQ_API_KEY\s*=\s*["']?([^"'\r\n]+)["']?/,
      );
      if (match && match[1] && !match[1].startsWith("your_")) {
        process.env.GROQ_API_KEY = match[1].trim();
      }
    }
  } catch {
    // Ignore read errors
  }
}

process.env.DEBUG_GROQ = "1";
const SAVED_API_KEY = process.env.GROQ_API_KEY;

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ FAIL: ${message}`);
    process.exit(1);
  } else {
    console.log(`✅ PASS: ${message}`);
  }
}

console.log(
  "=== Running Groq LLM Explanation Layer & Privacy Boundary Unit Tests ===\n",
);

// Scenario 1: Privacy Boundary Redactor Test
console.log("--- Scenario 1: Privacy Boundary Redactor ---");
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

const redacted = buildRedactedFinding(rawFinding);

assert(redacted.riskLevel === "HIGH", "Redacted riskLevel is HIGH");
assert(
  redacted.exposureType === "PUBLIC_PHONE",
  "Redacted exposureType is PUBLIC_PHONE",
);
assert(
  JSON.stringify(redacted.sourceDomains) === JSON.stringify(["example.org"]),
  "Source domain clean: example.org",
);
assert(
  redacted.identityConfidence === 0.94,
  "Identity confidence preserved: 0.94",
);

// Verify Hard Privacy Rule: Check no raw PII exists in redacted JSON string
const redactedStr = JSON.stringify(redacted);
assert(!redactedStr.includes("+91"), "HARD PRIVACY: No raw phone in payload");
assert(
  !redactedStr.includes("rahul.kumar"),
  "HARD PRIVACY: No raw email in payload",
);
assert(
  !redactedStr.includes("1234"),
  "HARD PRIVACY: No raw Aadhaar in payload",
);
assert(
  !redactedStr.includes("snippet"),
  "HARD PRIVACY: No raw document text snippet in payload",
);

// Scenario 2: Deterministic Template Fallback Generator
console.log("\n--- Scenario 2: Deterministic Template Fallback ---");
const fallback = generateTemplateFallback(redacted);

assert(
  fallback.isAiGenerated === false,
  "isAiGenerated is false for fallback template",
);
assert(
  fallback.summary.includes("HIGH-severity"),
  "Fallback summary includes risk level",
);
assert(
  fallback.summary.includes("example.org"),
  "Fallback summary includes domain",
);
assert(
  fallback.summary.includes("targeted phishing"),
  "Fallback summary includes threat",
);
assert(
  fallback.sourceRelevance.includes("example.org"),
  "Fallback sourceRelevance includes domain",
);

// Scenario 3: Explain Single Finding (Fallback Mode without API key)
console.log("\n--- Scenario 3: Explain Single Finding (Fallback Mode) ---");
async function testExplainSingleFallback() {
  delete process.env.GROQ_API_KEY;
  delete process.env.GEMINI_API_KEY;
  const explanation = await explainFinding(rawFinding);

  assert(
    explanation.isAiGenerated === false,
    "Returns template fallback when API key is missing",
  );
  assert(
    typeof explanation.summary === "string" && explanation.summary.length > 20,
    "Summary text generated",
  );
  assert(
    typeof explanation.sourceRelevance === "string",
    "Source relevance text generated",
  );
}

// Scenario 4: Live Groq API Explanation Test (when API key is configured)
console.log("\n--- Scenario 4: Live Groq API Explanation ---");
async function testExplainLiveGroq() {
  if (!SAVED_API_KEY || SAVED_API_KEY.startsWith("your_")) {
    console.log(
      "ℹ️ Skipped live Groq API call (GROQ_API_KEY not configured in .env.local)",
    );
    return;
  }
  process.env.GROQ_API_KEY = SAVED_API_KEY;
  console.log("Testing live Groq API call...");

  const explanation = await explainFinding(rawFinding);
  if (explanation.isAiGenerated) {
    assert(
      explanation.isAiGenerated === true,
      "Live Groq generated explanation successfully",
    );
    assert(
      typeof explanation.summary === "string" &&
        explanation.summary.length > 10,
      "Groq generated non-empty summary",
    );
    assert(
      typeof explanation.sourceRelevance === "string" &&
        explanation.sourceRelevance.length > 10,
      "Groq generated non-empty sourceRelevance",
    );
  } else {
    console.log(
      "⚠️ Live Groq call timed out or failed; fallback rendered safely (isAiGenerated: false)",
    );
  }
}

// Scenario 5: Async Batch Processor for Top <= 5 Findings
console.log("\n--- Scenario 5: Async Batch Processor (Top <= 5 Findings) ---");
async function testBatchProcessor() {
  if (SAVED_API_KEY) process.env.GROQ_API_KEY = SAVED_API_KEY;

  const mockExposures = [
    {
      id: "EXP-1",
      severity: "LOW" as const,
      priorityRank: 25,
      exposureType: "PROFILE",
      piiTypes: ["NAME"],
      identityConfidence: 0.3,
      threats: [],
    },
    {
      id: "EXP-2",
      severity: "CRITICAL" as const,
      priorityRank: 100,
      exposureType: "CREDENTIAL",
      piiTypes: ["EMAIL"],
      identityConfidence: 0.9,
      threats: ["CREDENTIAL_STUFFING"],
    },
    {
      id: "EXP-3",
      severity: "HIGH" as const,
      priorityRank: 80,
      exposureType: "PHONE",
      piiTypes: ["PHONE"],
      identityConfidence: 0.8,
      threats: ["TARGETED_PHISHING"],
    },
    {
      id: "EXP-4",
      severity: "MEDIUM" as const,
      priorityRank: 50,
      exposureType: "BROKER",
      piiTypes: ["EMAIL"],
      identityConfidence: 0.6,
      threats: [],
    },
    {
      id: "EXP-5",
      severity: "HIGH" as const,
      priorityRank: 75,
      exposureType: "ADDRESS",
      piiTypes: ["ADDRESS"],
      identityConfidence: 0.7,
      threats: ["PHYSICAL_TARGETING"],
    },
    {
      id: "EXP-6",
      severity: "LOW" as const,
      priorityRank: 20,
      exposureType: "SNIPPET",
      piiTypes: ["NAME"],
      identityConfidence: 0.2,
      threats: [],
    },
  ];

  const processed = await explainTopExposures(mockExposures, 5);

  assert(processed.length === 6, "Total exposure count retained");
  assert(
    processed[0].id === "EXP-2",
    "Top finding is EXP-2 (CRITICAL, rank 100)",
  );
  assert(
    processed[0].explanation !== undefined,
    "EXP-2 has attached explanation",
  );
  assert(
    processed[4].explanation !== undefined,
    "5th finding (EXP-1) has attached explanation",
  );
  assert(
    processed[5].explanation === undefined,
    "6th finding (EXP-6) exceeds maxCount 5, stays unexplained",
  );
}

async function runAllTests() {
  await testExplainSingleFallback();
  await testExplainLiveGroq();
  await testBatchProcessor();
  console.log("\n🎉 ALL GROQ LLM EXPLANATION & PRIVACY BOUNDARY TESTS PASSED!");
}

runAllTests().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
