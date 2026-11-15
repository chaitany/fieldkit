import { z } from "zod";

/** A raw record as it arrives from a customer system. Values are untrusted. */
export type RawRecord = Record<string, unknown>;

export type InferredType = "string" | "number" | "boolean" | "date" | "email" | "phone" | "empty";

export interface FieldProfile {
  name: string;
  inferredType: InferredType;
  /** Fraction of non-empty values, 0..1 */
  fillRate: number;
  distinctCount: number;
  samples: string[];
  /** All distinct values, only when cardinality is low (enum-like columns). */
  distinctValues?: string[];
}

export interface SourceProfile {
  recordCount: number;
  fields: FieldProfile[];
}

/** Transform operations are a closed, serialisable DSL — never arbitrary code. */
export const TransformSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("trim") }),
  z.object({ op: z.literal("lowercase") }),
  z.object({ op: z.literal("uppercase") }),
  z.object({ op: z.literal("toNumber") }),
  z.object({ op: z.literal("toBoolean") }),
  z.object({ op: z.literal("parseDate") }),
  z.object({ op: z.literal("normalizePhone"), defaultCountryCode: z.string().default("1") }),
  z.object({ op: z.literal("splitName"), part: z.enum(["first", "last"]) }),
  z.object({ op: z.literal("enumMap"), map: z.record(z.string()), fallback: z.string().optional() }),
  z.object({ op: z.literal("default"), value: z.string() }),
]);
export type Transform = z.infer<typeof TransformSchema>;

export const FieldMappingSchema = z.object({
  target: z.string(),
  /** One source column, or null when the target is filled only by a default transform. */
  source: z.string().nullable(),
  transforms: z.array(TransformSchema).default([]),
  confidence: z.number().min(0).max(1),
  rationale: z.string(),
  suggestedBy: z.enum(["heuristic", "llm", "human"]),
  approved: z.boolean().default(false),
});
export type FieldMapping = z.infer<typeof FieldMappingSchema>;

export const MappingSpecSchema = z.object({
  version: z.literal(1),
  target: z.string(),
  sourceFingerprint: z.string(),
  fields: z.array(FieldMappingSchema),
  createdAt: z.string(),
});
export type MappingSpec = z.infer<typeof MappingSpecSchema>;

export interface TargetField {
  name: string;
  description: string;
  required: boolean;
  type: InferredType;
  /** Alternate names seen in real customer exports. Feeds the heuristic mapper. */
  aliases: string[];
}

export interface TargetSchema {
  id: string;
  label: string;
  fields: TargetField[];
  /** Final authority on record validity. Mapping suggestions never bypass this. */
  validator: z.ZodTypeAny;
}

export interface RowError {
  row: number;
  field: string;
  message: string;
  value: unknown;
}

export interface RunReport {
  runId: string;
  dryRun: boolean;
  target: string;
  total: number;
  valid: number;
  invalid: number;
  errors: RowError[];
  /** Error counts by field — this is what you put in front of the customer. */
  errorsByField: Record<string, number>;
  preview: Record<string, unknown>[];
  output: Record<string, unknown>[];
  durationMs: number;
}
