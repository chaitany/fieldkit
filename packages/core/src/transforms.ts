import { isEmpty } from "./infer";
import type { Transform } from "./types";

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** Parses the date formats we actually see in customer exports. Returns ISO 8601 or the input unchanged. */
export function parseDate(input: string): string {
  const s = input.trim();
  let m: RegExpMatchArray | null;
  // US style: 03/14/2021, 3-14-21
  if ((m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/))) {
    const [, mm, dd, yy] = m as unknown as [string, string, string, string];
    const year = yy.length === 2 ? 2000 + Number(yy) : Number(yy);
    return iso(year, Number(mm), Number(dd)) ?? input;
  }
  // ISO date or datetime
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    const d = new Date(s.length === 10 ? `${s}T00:00:00Z` : s);
    return Number.isNaN(d.getTime()) ? input : d.toISOString();
  }
  // "Mar 3, 2021" / "3 March 2021"
  if ((m = s.match(/^([a-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})$/i))) {
    return iso(Number(m[3]), MONTHS.indexOf(m[1]!.toLowerCase()) + 1, Number(m[2])) ?? input;
  }
  if ((m = s.match(/^(\d{1,2})\s+([a-z]{3})[a-z]*\.?,?\s+(\d{4})$/i))) {
    return iso(Number(m[3]), MONTHS.indexOf(m[2]!.toLowerCase()) + 1, Number(m[1])) ?? input;
  }
  return input;
}

function iso(y: number, m: number, d: number): string | undefined {
  if (m < 1 || m > 12 || d < 1 || d > 31) return undefined;
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCDate() === d ? date.toISOString() : undefined;
}

export function normalizePhone(input: string, defaultCountryCode = "1"): string {
  const hasPlus = input.trim().startsWith("+");
  const withoutExt = input.split(/\s*(?:x|ext\.?)\s*\d+$/i)[0] ?? input;
  let digits = withoutExt.replace(/\D/g, "");
  if (!hasPlus && digits.startsWith("00")) digits = digits.slice(2);
  else if (!hasPlus && digits.length === 10) digits = defaultCountryCode + digits;
  return digits ? `+${digits}` : input;
}

export function splitName(full: string, part: "first" | "last"): string {
  const s = full.trim();
  // "Doe, Jane" → Jane / Doe
  if (s.includes(",")) {
    const [last, first] = s.split(",").map((p) => p.trim());
    return (part === "first" ? first : last) ?? "";
  }
  const tokens = s.split(/\s+/);
  if (tokens.length === 1) return part === "first" ? tokens[0]! : "";
  return part === "first" ? tokens[0]! : tokens.slice(1).join(" ");
}

/** Applies a transform chain. Pure and deterministic — the same input always yields the same output. */
export function applyTransforms(value: unknown, transforms: Transform[]): unknown {
  let v: unknown = value;
  for (const t of transforms) {
    if (t.op === "default") {
      if (isEmpty(v)) v = t.value;
      continue;
    }
    if (isEmpty(v)) return undefined;
    const s = String(v);
    switch (t.op) {
      case "trim": v = s.trim(); break;
      case "lowercase": v = s.toLowerCase(); break;
      case "uppercase": v = s.toUpperCase(); break;
      case "toNumber": {
        const cleaned = s.replace(/[$€£₹,\s]/g, "");
        const multiplier = /k$/i.test(cleaned) ? 1_000 : /m$/i.test(cleaned) ? 1_000_000 : 1;
        const n = Number(cleaned.replace(/[km]$/i, "")) * multiplier;
        v = Number.isFinite(n) ? n : s; // leave invalid values for the validator to report
        break;
      }
      case "toBoolean": v = /^(true|yes|y|1)$/i.test(s.trim()); break;
      case "parseDate": v = parseDate(s); break;
      case "normalizePhone": v = normalizePhone(s, t.defaultCountryCode); break;
      case "splitName": v = splitName(s, t.part); break;
      case "enumMap": {
        const key = s.trim().toLowerCase();
        const hit = Object.entries(t.map).find(([k]) => k.toLowerCase() === key);
        v = hit ? hit[1] : t.fallback ?? s;
        break;
      }
    }
  }
  return v;
}
