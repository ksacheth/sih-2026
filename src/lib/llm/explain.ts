import { GoogleGenAI } from "@google/genai";
import Groq from "groq-sdk";
import { RedactedFindingForLLM, ExplanationOutput } from "./types";
import { buildRedactedFinding, RawExposureInput } from "./redactor";
import { generateTemplateFallback } from "./fallback";

export const RULE_VERSION = "v1.0.0";
const LLM_TIMEOUT_MS = 5000;

/**
 * System prompt enforcing strict privacy and structured JSON output rules for LLM providers.
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

const GEMINI_MODELS = ["gemini-2.5-flash", "gemini-2.0-flash"];
const GROQ_MODELS = [
  "groq/compound-mini",
  "groq/compound",
  "openai/gpt-oss-20b",
  "qwen/qwen3.8-27b",
];

/**
 * Attempts Gemini API explanation via @google/genai SDK (CONTEXT.md §9.0).
 */
async function explainWithGemini(
  apiKey: string,
  userPrompt: string,
): Promise<{ summary: string; sourceRelevance: string } | null> {
  const ai = new GoogleGenAI({ apiKey });

  for (const modelName of GEMINI_MODELS) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);

    try {
      const response = await ai.models.generateContent({
        model: modelName,
        contents: [
          { role: "user", parts: [{ text: `${SYSTEM_PROMPT}\n\n${userPrompt}` }] },
        ],
        config: {
          responseMimeType: "application/json",
          temperature: 0.2,
          maxOutputTokens: 300,
        },
      });

      clearTimeout(timeoutId);
      const rawText = response.text ? response.text.trim() : "";
      if (!rawText) continue;

      const cleanJson = rawText
        .replace(/^```json\s*/i, "")
        .replace(/^```\s*/, "")
        .replace(/\s*```$/, "");
      const parsed = JSON.parse(cleanJson);

      if (parsed.summary && parsed.sourceRelevance) {
        return {
          summary: String(parsed.summary),
          sourceRelevance: String(parsed.sourceRelevance),
        };
      }
    } catch (err: any) {
      clearTimeout(timeoutId);
      if (process.env.DEBUG_LLM) {
        console.error(`Gemini API error on model ${modelName}:`, err?.message || err);
      }
    }
  }

  return null;
}

/**
 * Attempts Groq API explanation via groq-sdk.
 */
async function explainWithGroq(
  apiKey: string,
  userPrompt: string,
): Promise<{ summary: string; sourceRelevance: string } | null> {
  const groq = new Groq({ apiKey });

  for (const modelName of GROQ_MODELS) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);

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
        { signal: controller.signal }
      );

      clearTimeout(timeoutId);
      const rawText = response.choices[0]?.message?.content?.trim() || "";
      if (!rawText) continue;

      const cleanJson = rawText
        .replace(/^```json\s*/i, "")
        .replace(/^```\s*/, "")
        .replace(/\s*```$/, "");
      const parsed = JSON.parse(cleanJson);

      if (parsed.summary && parsed.sourceRelevance) {
        return {
          summary: String(parsed.summary),
          sourceRelevance: String(parsed.sourceRelevance),
        };
      }
    } catch (err: any) {
      clearTimeout(timeoutId);
      if (process.env.DEBUG_LLM) {
        console.error(`Groq API error on model ${modelName}:`, err?.message || err);
      }
    }
  }

  return null;
}

/**
 * Generates an explanation for a single finding using Dual SDK support (Gemini / Groq LLM)
 * over a redacted schema (CONTEXT.md §9).
 * Automatically falls back to deterministic template if API keys are missing, network fails, or times out.
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

  const geminiKey = process.env.GEMINI_API_KEY;
  const groqKey = process.env.GROQ_API_KEY;

  const userPrompt = `Redacted Exposure Finding Schema:\n${JSON.stringify(redacted, null, 2)}`;

  // Priority 1: Gemini API
  if (geminiKey && !geminiKey.startsWith("your_")) {
    const result = await explainWithGemini(geminiKey, userPrompt);
    if (result) {
      return {
        ...result,
        isAiGenerated: true,
        generatedAt: new Date().toISOString(),
      };
    }
  }

  // Priority 2: Groq API
  if (groqKey && !groqKey.startsWith("your_")) {
    const result = await explainWithGroq(groqKey, userPrompt);
    if (result) {
      return {
        ...result,
        isAiGenerated: true,
        generatedAt: new Date().toISOString(),
      };
    }
  }

  // Fallback: Deterministic Template
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

  // Generate explanations sequentially to respect API rate limits
  const explanations: ExplanationOutput[] = [];
  for (const exp of topFindings) {
    const res = await explainFinding(exp);
    explanations.push(res);
  }

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
