import { randomUUID } from "node:crypto";
import { fingerprint, profileRecords } from "./infer";
import { applyTransforms } from "./transforms";
import type { FieldMapping, MappingSpec, RawRecord, RowError, RunReport, TargetSchema } from "./types";

export function createSpec(target: TargetSchema, records: RawRecord[], fields: FieldMapping[]): MappingSpec {
  return {
    version: 1,
    target: target.id,
    sourceFingerprint: fingerprint(profileRecords(records)),
    fields,
    createdAt: new Date().toISOString(),
  };
}

export function mapRecord(record: RawRecord, fields: FieldMapping[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    if (f.source === null && f.transforms.length === 0) continue;
    const raw = f.source === null ? undefined : record[f.source];
    const value = applyTransforms(raw, f.transforms);
    if (value !== undefined && value !== "") out[f.target] = value;
  }
  return out;
}

export class SpecValidationError extends Error {
  constructor(public readonly problems: string[]) {
    super(`Mapping spec is not runnable:\n- ${problems.join("\n- ")}`);
  }
}

/** Preflight checks that turn "it failed on row 40,000" into "it won't start, here's why". */
export function preflight(spec: MappingSpec, target: TargetSchema, records: RawRecord[], dryRun: boolean): string[] {
  const problems: string[] = [];
  if (spec.target !== target.id) problems.push(`spec is for target "${spec.target}", not "${target.id}"`);
  const fp = fingerprint(profileRecords(records));
  if (fp !== spec.sourceFingerprint) {
    problems.push(`source shape changed since the mapping was approved (fingerprint ${fp} ≠ ${spec.sourceFingerprint}) — customer added/renamed columns?`);
  }
  for (const tf of target.fields.filter((f) => f.required)) {
    const m = spec.fields.find((f) => f.target === tf.name);
    if (!m || (m.source === null && !m.transforms.some((t) => t.op === "default"))) {
      problems.push(`required field "${tf.name}" is unmapped`);
    } else if (!dryRun && !m.approved) {
      problems.push(`required field "${tf.name}" has not been approved by a human`);
    }
  }
  return problems;
}

export interface RunOptions {
  dryRun?: boolean;
  previewSize?: number;
  /** Field used to dedupe within a run, so re-runs and duplicate source rows are idempotent. */
  idempotencyKey?: string;
}

export function runPipeline(records: RawRecord[], spec: MappingSpec, target: TargetSchema, opts: RunOptions = {}): RunReport {
  const started = performance.now();
  const dryRun = opts.dryRun ?? true;
  const problems = preflight(spec, target, records, dryRun);
  // Shape drift is a warning in dry-run (that's how you discover it) but fatal for real runs.
  const fatal = dryRun ? problems.filter((p) => !p.startsWith("source shape changed")) : problems;
  if (fatal.length) throw new SpecValidationError(fatal);

  const fields = dryRun ? spec.fields : spec.fields.filter((f) => f.approved);
  const key = opts.idempotencyKey ?? "external_id";
  const seen = new Set<unknown>();
  const errors: RowError[] = [];
  const errorsByField: Record<string, number> = {};
  const output: Record<string, unknown>[] = [];
  let invalid = 0;

  records.forEach((record, i) => {
    const row = i + 2; // +1 for header, +1 for 1-based — matches what the customer sees in Excel
    const mapped = mapRecord(record, fields);
    const result = target.validator.safeParse(mapped);
    if (!result.success) {
      invalid++;
      for (const issue of result.error.issues) {
        const field = issue.path.join(".") || "(record)";
        errors.push({ row, field, message: issue.message, value: mapped[field] ?? record[field] });
        errorsByField[field] = (errorsByField[field] ?? 0) + 1;
      }
      return;
    }
    const k = (result.data as Record<string, unknown>)[key];
    if (k !== undefined && seen.has(k)) {
      invalid++;
      errors.push({ row, field: key, message: `Duplicate ${key} in this file`, value: k });
      errorsByField[key] = (errorsByField[key] ?? 0) + 1;
      return;
    }
    seen.add(k);
    output.push(result.data as Record<string, unknown>);
  });

  return {
    runId: randomUUID(),
    dryRun,
    target: target.id,
    total: records.length,
    valid: output.length,
    invalid,
    errors,
    errorsByField,
    preview: output.slice(0, opts.previewSize ?? 10),
    output,
    durationMs: Math.round(performance.now() - started),
  };
}
