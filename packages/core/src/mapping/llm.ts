import { z } from "zod";
import type { FieldMapping, SourceProfile, TargetSchema } from "../types";
import { TransformSchema } from "../types";
import { suggestHeuristic } from "./heuristic";

export interface LlmOptions {
  apiKey?: string;
  model?: string;
  /** Override for corporate LLM gateways/proxies (customers often require one). Defaults to $ANTHROPIC_BASE_URL. */
  baseUrl?: string;
  /** Send real sample values to the model. Off by default: only column names + masked shapes leave the box. */
  shareSamples?: boolean;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export interface SuggestResult {
  fields: FieldMapping[];
  engine: "llm" | "heuristic";
  /** Why we fell back, if we did. Surfaced in the UI — silent fallbacks erode trust. */
  fallbackReason?: string;
  usage?: { inputTokens: number; outputTokens: number };
}

/** Masks a value to its shape: "jane@acme.com" → "a***@a***.com", "415-555-0101" → "999-999-9999". */
export function maskValue(v: string): string {
  if (v.includes("@")) return v.replace(/[^@.]+/g, (p) => `${p[0] ? "a" : ""}***`);
  return v.replace(/[A-Za-z]/g, "a").replace(/\d/g, "9");
}

const LlmResponseSchema = z.object({
  mappings: z.array(
    z.object({
      target: z.string(),
      source: z.string().nullable(),
      transforms: z.array(TransformSchema).default([]),
      confidence: z.number().min(0).max(1),
      rationale: z.string(),
    }),
  ),
});

export function buildPrompt(profile: SourceProfile, target: TargetSchema, shareSamples: boolean): string {
  const sourceDesc = profile.fields.map((f) => ({
    column: f.name,
    inferredType: f.inferredType,
    fillRate: Number(f.fillRate.toFixed(2)),
    samples: shareSamples ? f.samples : f.samples.map(maskValue),
    ...(f.distinctValues ? { distinctValues: f.distinctValues } : {}),
  }));
  return [
    "You map columns from a customer's data export onto a product's target schema.",
    "Return ONLY a JSON object: {\"mappings\": [{target, source, transforms, confidence, rationale}]}.",
    "Rules:",
    "- Emit exactly one entry per target field.",
    "- `source` MUST be one of the given column names verbatim, or null if nothing fits. Never invent columns.",
    "- A source column may feed two targets only via splitName (full name → first/last).",
    "- `transforms` uses only these ops: trim, lowercase, uppercase, toNumber, toBoolean, parseDate,",
    "  normalizePhone{defaultCountryCode}, splitName{part:first|last}, enumMap{map,fallback?}, default{value}.",
    "- For enum targets, build an enumMap covering every observed distinct value you can map confidently.",
    "- confidence is 0..1. Be calibrated: below 0.6 means a human should look closely.",
    "",
    `TARGET SCHEMA (${target.label}):`,
    JSON.stringify(target.fields.map(({ name, description, required, type }) => ({ name, description, required, type })), null, 2),
    "",
    `SOURCE COLUMNS (${profile.recordCount} records):`,
    JSON.stringify(sourceDesc, null, 2),
  ].join("\n");
}

/**
 * LLM-assisted mapping with strict guardrails:
 *  1. Output is schema-validated (zod) — malformed output → fallback.
 *  2. Hallucinated source columns are rejected per-field and replaced with the heuristic answer.
 *  3. Nothing is auto-approved. The LLM proposes; a human disposes; zod validates every row.
 */
export async function suggestMappings(
  profile: SourceProfile,
  target: TargetSchema,
  opts: LlmOptions = {},
): Promise<SuggestResult> {
  const heuristic = suggestHeuristic(profile, target);
  const apiKey = opts.apiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { fields: heuristic, engine: "heuristic", fallbackReason: "No ANTHROPIC_API_KEY configured" };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 30_000);
  try {
    const baseUrl = (opts.baseUrl ?? process.env.ANTHROPIC_BASE_URL ?? "https://api.anthropic.com").replace(/\/+$/, "");
    const res = await (opts.fetchImpl ?? fetch)(`${baseUrl}/v1/messages`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: opts.model ?? process.env.FIELDKIT_MODEL ?? "claude-sonnet-5-5",
        max_tokens: 4096,
        temperature: 0,
        messages: [{ role: "user", content: buildPrompt(profile, target, opts.shareSamples ?? false) }],
      }),
    });
    if (!res.ok) throw new Error(`LLM API returned ${res.status}`);
    const body = (await res.json()) as {
      content: { type: string; text?: string }[];
      usage?: { input_tokens: number; output_tokens: number };
    };
    const text = body.content.find((c) => c.type === "text")?.text ?? "";
    const json = text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
    const parsed = LlmResponseSchema.parse(JSON.parse(json));

    const columns = new Set(profile.fields.map((f) => f.name));
    const byTarget = new Map(parsed.mappings.map((m) => [m.target, m]));
    let rejected = 0;
    const fields = heuristic.map((h): FieldMapping => {
      const m = byTarget.get(h.target);
      if (!m) return h;
      if (m.source !== null && !columns.has(m.source)) {
        rejected++;
        return { ...h, rationale: `${h.rationale} (LLM proposed unknown column "${m.source}" — rejected)` };
      }
      return { ...m, target: h.target, suggestedBy: "llm", approved: false };
    });

    return {
      fields,
      engine: "llm",
      ...(rejected ? { fallbackReason: `${rejected} hallucinated column(s) replaced with heuristic suggestions` } : {}),
      ...(body.usage ? { usage: { inputTokens: body.usage.input_tokens, outputTokens: body.usage.output_tokens } } : {}),
    };
  } catch (err) {
    const reason = err instanceof Error ? (err.name === "AbortError" ? "LLM request timed out" : err.message) : String(err);
    return { fields: heuristic, engine: "heuristic", fallbackReason: `LLM failed: ${reason}` };
  } finally {
    clearTimeout(timer);
  }
}
