import type { FieldMapping, FieldProfile, InferredType, SourceProfile, TargetField, TargetSchema, Transform } from "../types";

export function normalizeName(s: string): string {
  return s
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .replace(/[_\-.#/]+/g, " ")
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function levenshtein(a: string, b: string): number {
  const dp = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0]!;
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j]!;
      dp[j] = Math.min(dp[j]! + 1, dp[j - 1]! + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[b.length]!;
}

function similarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const ta = new Set(a.split(" "));
  const tb = new Set(b.split(" "));
  const jaccard = [...ta].filter((t) => tb.has(t)).length / new Set([...ta, ...tb]).size;
  const edit = 1 - levenshtein(a, b) / Math.max(a.length, b.length);
  return Math.max(jaccard, edit);
}

const TYPE_COMPAT: Partial<Record<InferredType, InferredType[]>> = {
  string: ["string", "email", "phone", "number", "date", "boolean"],
  email: ["email"],
  phone: ["phone", "number", "string"],
  number: ["number", "string"],
  date: ["date", "string"],
  boolean: ["boolean"],
};

function nameScore(target: TargetField, source: FieldProfile): number {
  const s = normalizeName(source.name);
  const candidates = [normalizeName(target.name), ...target.aliases.map(normalizeName)];
  if (candidates.includes(s)) return 1;
  return Math.max(...candidates.map((c) => similarity(c, s)));
}

function typeScore(target: TargetField, source: FieldProfile): number {
  if (source.inferredType === "empty") return 0.3;
  if (source.inferredType === target.type) return 1;
  return TYPE_COMPAT[target.type]?.includes(source.inferredType) ? 0.6 : 0.1;
}

/** Default transform chain for a target type. These are the cleanups you'd write by hand every time. */
export function defaultTransforms(target: TargetField, source?: FieldProfile): Transform[] {
  switch (target.type) {
    case "email": return [{ op: "trim" }, { op: "lowercase" }];
    case "phone": return [{ op: "normalizePhone", defaultCountryCode: "1" }];
    case "date": return [{ op: "parseDate" }];
    case "number": return [{ op: "toNumber" }];
    case "boolean": return [{ op: "toBoolean" }];
    default: {
      const t: Transform[] = [{ op: "trim" }];
      const enumMap = source && inferEnumMap(target, source);
      if (enumMap) t.push(enumMap);
      return t;
    }
  }
}

/** For enum-like targets, map observed source values onto allowed values via keyword rules. */
function inferEnumMap(target: TargetField, source: FieldProfile): Transform | undefined {
  const allowed = target.description.match(/one of:\s*(.+)$/i)?.[1]?.split(/,\s*/);
  if (!allowed || !source.distinctValues) return undefined;
  const KEYWORDS: Record<string, string[]> = {
    lead: ["lead", "new", "cold", "inbound", "mql"],
    prospect: ["prospect", "trial", "opportunity", "sql", "eval", "pipeline"],
    customer: ["customer", "active", "paying", "won", "client", "subscriber"],
    churned: ["churn", "cancel", "lost", "inactive", "former", "closed"],
  };
  const map: Record<string, string> = {};
  for (const raw of source.distinctValues) {
    const v = raw.toLowerCase();
    // Longest keyword wins, so "inactive" → churned beats the "active" substring → customer.
    let match = allowed.find((a) => v === a);
    if (!match) {
      let best = 0;
      for (const a of allowed) {
        for (const k of KEYWORDS[a] ?? [a]) {
          if (v.includes(k) && k.length > best) { best = k.length; match = a; }
        }
      }
    }
    if (match) map[raw] = match;
  }
  return Object.keys(map).length ? { op: "enumMap", map } : undefined;
}

const FULL_NAME = ["name", "full name", "contact name", "customer name", "contact"];

/**
 * Deterministic baseline mapper. Runs offline with zero dependencies, so it works in air-gapped
 * customer environments and is the fallback whenever the LLM is unavailable or wrong.
 */
export function suggestHeuristic(profile: SourceProfile, target: TargetSchema, threshold = 0.5): FieldMapping[] {
  type Cand = { target: TargetField; source: FieldProfile; score: number; n: number; t: number };
  const hasNameTargets = target.fields.some((f) => f.name === "first_name" || f.name === "last_name");
  const isFullName = (f: FieldProfile) => FULL_NAME.includes(normalizeName(f.name));
  const cands: Cand[] = [];
  for (const tf of target.fields) {
    for (const sf of profile.fields) {
      // Full-name columns are reserved for the split rule below; fuzzy-matching "Full Name" → last_name is wrong.
      if (hasNameTargets && isFullName(sf)) continue;
      const n = nameScore(tf, sf);
      const t = typeScore(tf, sf);
      cands.push({ target: tf, source: sf, score: n * 0.75 + t * 0.25, n, t });
    }
  }
  cands.sort((a, b) => b.score - a.score);

  const usedSources = new Set<string>();
  const result = new Map<string, FieldMapping>();
  for (const c of cands) {
    if (result.has(c.target.name) || usedSources.has(c.source.name) || c.score < threshold) continue;
    usedSources.add(c.source.name);
    result.set(c.target.name, {
      target: c.target.name,
      source: c.source.name,
      transforms: defaultTransforms(c.target, c.source),
      confidence: Number(c.score.toFixed(2)),
      rationale: `The column name is a ${(c.n * 100).toFixed(0)}% match for ${c.target.name}, and its values look like ${c.source.inferredType === c.target.type ? `${c.target.type}, as expected` : `${c.source.inferredType} rather than ${c.target.type}, so cleanup is applied`}.`,
      suggestedBy: "heuristic",
      approved: false,
    });
  }

  // A single "Full Name" column feeding first_name + last_name is the #1 shape mismatch in practice.
  const fullName = hasNameTargets ? profile.fields.find(isFullName) : undefined;
  if (fullName) {
    for (const part of ["first", "last"] as const) {
      const key = `${part}_name`;
      if (!result.has(key) && target.fields.some((f) => f.name === key)) {
        result.set(key, {
          target: key,
          source: fullName.name,
          transforms: [{ op: "trim" }, { op: "splitName", part }],
          confidence: 0.7,
          rationale: `"${fullName.name}" holds full names, so it is split to get the ${part} name. Check a few rows with middle names.`,
          suggestedBy: "heuristic",
          approved: false,
        });
      }
    }
  }

  return target.fields.map(
    (tf) =>
      result.get(tf.name) ?? {
        target: tf.name,
        source: null,
        transforms: [],
        confidence: 0,
        rationale: "No column was a confident match. Pick a source column or leave it empty.",
        suggestedBy: "heuristic",
        approved: false,
      },
  );
}
