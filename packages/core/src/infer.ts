import { createHash } from "node:crypto";
import type { FieldProfile, InferredType, RawRecord, SourceProfile } from "./types";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE = /^[+()\d\s.-]{7,20}$/;
const NUMBER = /^-?[\d,]*\.?\d+$/;
const BOOL = /^(true|false|yes|no|y|n|0|1)$/i;

export function isEmpty(v: unknown): boolean {
  return v === null || v === undefined || (typeof v === "string" && v.trim() === "");
}

export function looksLikeDate(s: string): boolean {
  if (!/\d/.test(s) || s.length < 6) return false;
  if (/^\d{1,2}[/-]\d{1,2}[/-]\d{2,4}$/.test(s)) return true;
  return /^\d{4}-\d{2}-\d{2}/.test(s) || !Number.isNaN(Date.parse(s)) && /[a-z]{3}/i.test(s);
}

export function classify(value: string): InferredType {
  const s = value.trim();
  if (s === "") return "empty";
  if (EMAIL.test(s)) return "email";
  if (BOOL.test(s) && !/^[01]$/.test(s)) return "boolean";
  if (looksLikeDate(s)) return "date";
  if (NUMBER.test(s) && s.replace(/\D/g, "").length < 7) return "number";
  if (PHONE.test(s) && s.replace(/\D/g, "").length >= 7) return "phone";
  if (NUMBER.test(s)) return "number";
  return "string";
}

/** Profiles a sample of records: per-column type vote, fill rate, cardinality, samples. */
export function profileRecords(records: RawRecord[], sampleSize = 500): SourceProfile {
  const sample = records.slice(0, sampleSize);
  const columns = new Set<string>();
  for (const r of sample) Object.keys(r).forEach((k) => columns.add(k));

  const fields: FieldProfile[] = [...columns].map((name) => {
    const values = sample.map((r) => r[name]).filter((v) => !isEmpty(v)).map(String);
    const votes = new Map<InferredType, number>();
    for (const v of values) {
      const t = classify(v);
      votes.set(t, (votes.get(t) ?? 0) + 1);
    }
    // Majority vote; ties and mixed columns degrade to "string" (the safe choice).
    const sorted = [...votes.entries()].sort((a, b) => b[1] - a[1]);
    const top = sorted[0];
    const inferredType: InferredType =
      !top ? "empty" : top[1] / values.length >= 0.8 ? top[0] : "string";

    const distinct = [...new Set(values.map((v) => v.trim()))];
    return {
      name,
      inferredType,
      fillRate: sample.length ? values.length / sample.length : 0,
      distinctCount: distinct.length,
      samples: distinct.slice(0, 5),
      ...(distinct.length <= 20 && distinct.length <= values.length * 0.75 ? { distinctValues: distinct } : {}),
    };
  });

  return { recordCount: records.length, fields };
}

/** Stable fingerprint of a source's shape. A mapping is only valid for the shape it was built for. */
export function fingerprint(profile: SourceProfile): string {
  const shape = profile.fields.map((f) => f.name).sort().join("|");
  return createHash("sha256").update(shape).digest("hex").slice(0, 16);
}
