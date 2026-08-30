import Groq from "groq-sdk";
import { RedactedFindingForLLM, ExplanationOutput } from "./types";
import { buildRedactedFinding, RawExposureInput } from "./redactor";
import { generateTemplateFallback } from "./fallback";

export const RULE_VERSION = "v1.0.0";
const GROQ_TIMEOUT_MS = 5000;

/**
 * System prompt enforcing strict privacy and structured JSON output rules for Groq LLM.
 */
const SYSTEM_PROMPT = `
You are a security intelligence assistant for a privacy exposure monitor.
Your task is to explain a structured finding to a user in clear, professional natural language.

CRITICAL INSTRUCTIONS:
1. You MUST respond with ONLY valid JSON matching this schema:
   {
     "summary": "2-3 sentences explaining the threat and why it matters in plain language.",
     "sourceRelevance": "1-2 sentences explaining why the source domain is relevant."
   }
2. Do NOT invent raw PII values (names, emails, phones, addresses, passwords).
3. Be objective and concise. State uncertainty if confidence is not high.
4. Do NOT output markdown code fences (\`\`\`json), output raw JSON string only.
`;

/**
 * Active Groq production models for ultra-fast privacy threat explanations.
 */
const GROQ_MODELS = [
  "qwen/qwen3.8-27b",
  "openai/gpt-oss-20b",
  "groq/compound-mini",
  "groq/compound",
];

/**
 * Generates an explanation for a single finding using Groq LLM over a redacted schema (CONTEXT.md §9).
 * Automatically falls back to deterministic template if Groq API key is missing, network fails, or times out.
 *
 * @param input - Raw exposure object or pre-redacted schema
 * @returns Promise<ExplanationOutput>
 */
export async function explainFinding(
  input: RawExposureInput | RedactedFindingForLLM,
): Promise<ExplanationOutput> {
  // Ensure input is in redacted format (Hard Privacy Boundary)
  const redacted: RedactedFindingForLLM =
    "riskLevel" in input && "sourceDomains" in input
      ? (input as RedactedFindingForLLM)
      : buildRedactedFinding(input as RawExposureInput);

  const apiKey = process.env.GROQ_API_KEY || process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey.startsWith("your_")) {
    return generateTemplateFallback(redacted);
  }

  try {
    const groq = new Groq({ apiKey });
    const userPrompt = `Redacted Exposure Finding Schema:\n${JSON.stringify(redacted, null, 2)}`;

    for (const modelName of GROQ_MODELS) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), GROQ_TIMEOUT_MS);

      try {
        const response = await groq.chat.completions.create(
          {
            model: modelName,
            messages: [
              { role: "system", content: SYSTEM_PROMPT },
              { role: "user", content: userPrompt },
            ],
            response_format: { type: "json_object" },
            temperature: 0.2,
            max_tokens: 300,
          },
          { signal: controller.signal },
        );

        clearTimeout(timeoutId);

        const rawText = response.choices[0]?.message?.content?.trim() || "";
        if (!rawText) continue;

        // Clean markdown fenced code block delimiters if present
        const cleanJson = rawText
          .replace(/^```json\s*/i, "")
          .replace(/^```\s*/, "")
          .replace(/\s*```$/, "");
        const parsed = JSON.parse(cleanJson);

        if (parsed.summary && parsed.sourceRelevance) {
          return {
            summary: String(parsed.summary),
            sourceRelevance: String(parsed.sourceRelevance),
            isAiGenerated: true,
            generatedAt: new Date().toISOString(),
          };
        }
      } catch (err: any) {
        clearTimeout(timeoutId);
        if (process.env.DEBUG_GROQ) {
          console.error(
            `Groq API error on model ${modelName}:`,
            err?.message || err,
          );
        }
        // Try next model in loop
      }
    }
  } catch (err: any) {
    if (process.env.DEBUG_GROQ) {
      console.error("Groq SDK initialization error:", err?.message || err);
    }
  }

  return generateTemplateFallback(redacted);
}

export interface ExposureWithPriority extends RawExposureInput {
  _id?: string;
  id?: string;
  priorityRank?: number;
  explanation?: ExplanationOutput;
}

/**
 * Asynchronously processes explanations for top <= 5 findings by severity (CONTEXT.md §9.0).
 * Runs post-hoc without blocking scan completion.
 *
 * @param exposures - List of findings produced by pipeline
 * @param maxCount - Max findings to explain (default 5)
 * @returns Updated array of exposures with attached explanations
 */
export async function explainTopExposures<T extends ExposureWithPriority>(
  exposures: T[],
  maxCount = 5,
): Promise<T[]> {
  if (!Array.isArray(exposures) || exposures.length === 0) {
    return [];
  }

  // Sort exposures by severity / priority rank descending
  const severityWeights: Record<string, number> = {
    CRITICAL: 100,
    HIGH: 75,
    MEDIUM: 50,
    LOW: 25,
  };

  const sorted = [...exposures].sort((a, b) => {
    const rankA = a.priorityRank ?? severityWeights[a.severity] ?? 50;
    const rankB = b.priorityRank ?? severityWeights[b.severity] ?? 50;
    return rankB - rankA;
  });

  // Top <= 5 findings get LLM explanations
  const topFindings = sorted.slice(0, maxCount);

  // Generate explanations in parallel
  const explanationPromises = topFindings.map((exp) => explainFinding(exp));
  const explanations = await Promise.all(explanationPromises);

  // Map explanations back to items
  const explanationMap = new Map<string | number, ExplanationOutput>();
  topFindings.forEach((exp, idx) => {
    const key = exp._id || exp.id || idx;
    explanationMap.set(key, explanations[idx]);
  });

  return sorted.map((exp, idx) => {
    const key = exp._id || exp.id || idx;
    const explanation = explanationMap.get(key);
    if (explanation) {
      return { ...exp, explanation };
    }
    return exp;
  });
}
