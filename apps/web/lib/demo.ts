/**
 * Demo-mode cost controls. Pure module (no Next.js imports) so it is unit-testable.
 *
 * Threat model: a public portfolio link gets shared, scraped, or hit by bots. The host's
 * Anthropic key must never become an open wallet. Layers, cheapest first:
 *   1. Hosted AI is opt-in per request and (by default) only runs on the built-in sample.
 *   2. Sample results are cached, so repeat clicks cost nothing.
 *   3. Per-visitor and global daily quotas.
 *   4. Bring-your-own-key: visitors who want AI on their own data pay for it themselves.
 *   5. Backstop outside the app: a low spend cap on a dedicated Anthropic workspace.
 */
import { createHash } from "node:crypto";

export interface DemoConfig {
  demoMode: boolean;
  hostedKey?: string;
  /** In demo mode, only spend the hosted key on the built-in sample dataset. */
  sampleOnly: boolean;
  perVisitorDaily: number;
  globalDaily: number;
  requestsPerMinute: number;
  maxCsvBytes: number;
}

const int = (v: string | undefined, d: number) => (v && Number.isFinite(Number(v)) ? Math.max(0, Math.floor(Number(v))) : d);
const bool = (v: string | undefined, d: boolean) => (v === undefined ? d : /^(1|true|yes|on)$/i.test(v));

export function loadConfig(env: Record<string, string | undefined> = process.env): DemoConfig {
  const demoMode = bool(env.FIELDKIT_DEMO_MODE, false);
  return {
    demoMode,
    hostedKey: env.ANTHROPIC_API_KEY || undefined,
    sampleOnly: bool(env.FIELDKIT_HOSTED_SAMPLE_ONLY, true),
    perVisitorDaily: int(env.FIELDKIT_AI_PER_VISITOR_DAILY, 5),
    globalDaily: int(env.FIELDKIT_AI_GLOBAL_DAILY, 100),
    requestsPerMinute: int(env.FIELDKIT_REQUESTS_PER_MINUTE, demoMode ? 30 : 600),
    maxCsvBytes: int(env.FIELDKIT_MAX_CSV_BYTES, demoMode ? 2 * 1024 * 1024 : 10 * 1024 * 1024),
  };
}

export interface LimitResult {
  ok: boolean;
  remaining: number;
  resetAt: number;
}

/**
 * Quota store contract. The in-memory implementation below is per-process: on serverless
 * platforms each warm instance has its own counters, so treat limits as approximate and keep the
 * Anthropic workspace spend cap as the hard ceiling. For strict global limits, implement this
 * interface over Redis/Upstash (INCR + EXPIRE) without touching any call sites.
 */
export interface Limiter {
  peek(key: string): LimitResult;
  consume(key: string): LimitResult;
}

export class FixedWindowLimiter implements Limiter {
  private readonly windows = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  private window(key: string) {
    const t = this.now();
    let w = this.windows.get(key);
    if (!w || t >= w.resetAt) {
      w = { count: 0, resetAt: t + this.windowMs };
      this.windows.set(key, w);
      if (this.windows.size > 10_000) this.sweep(t);
    }
    return w;
  }

  private sweep(t: number) {
    for (const [k, w] of this.windows) if (t >= w.resetAt) this.windows.delete(k);
  }

  peek(key: string): LimitResult {
    const w = this.window(key);
    return { ok: w.count < this.limit, remaining: Math.max(0, this.limit - w.count), resetAt: w.resetAt };
  }

  consume(key: string): LimitResult {
    const w = this.window(key);
    if (w.count >= this.limit) return { ok: false, remaining: 0, resetAt: w.resetAt };
    w.count++;
    return { ok: true, remaining: this.limit - w.count, resetAt: w.resetAt };
  }
}

export class TtlCache<T> {
  private readonly items = new Map<string, { value: T; expires: number }>();
  constructor(private readonly ttlMs: number, private readonly max = 100, private readonly now: () => number = Date.now) {}

  get(key: string): T | undefined {
    const hit = this.items.get(key);
    if (!hit) return undefined;
    if (this.now() >= hit.expires) {
      this.items.delete(key);
      return undefined;
    }
    return hit.value;
  }

  set(key: string, value: T): void {
    if (this.items.size >= this.max) this.items.delete(this.items.keys().next().value as string);
    this.items.set(key, { value, expires: this.now() + this.ttlMs });
  }
}

export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

/** Identify a visitor without storing their IP: salted hash of the first forwarded address. */
export function visitorKey(headers: Headers, salt = process.env.FIELDKIT_VISITOR_SALT ?? "fieldkit"): string {
  const ip = headers.get("x-forwarded-for")?.split(",")[0]?.trim() || headers.get("x-real-ip") || "local";
  return sha256(`${salt}:${ip}`).slice(0, 24);
}

export const BYOK_PATTERN = /^sk-ant-[A-Za-z0-9_-]{20,}$/;

export type EngineDecision =
  | { kind: "byok"; apiKey: string }
  | { kind: "hosted"; apiKey: string; metered: boolean }
  | { kind: "heuristic"; reason: string };

export interface DecideInput {
  config: DemoConfig;
  wantsLlm: boolean;
  byokKey?: string;
  isSample: boolean;
}

/** Decides which engine (and whose money) serves a request. Quotas are applied by the caller after cache lookup. */
export function decideEngine({ config, wantsLlm, byokKey, isSample }: DecideInput): EngineDecision {
  if (!wantsLlm) return { kind: "heuristic", reason: "Offline engine selected" };
  if (byokKey) return { kind: "byok", apiKey: byokKey };
  if (!config.hostedKey) return { kind: "heuristic", reason: "No hosted AI key on this deployment. Add your own key to try AI mapping." };
  if (!config.demoMode) return { kind: "hosted", apiKey: config.hostedKey, metered: false };
  if (config.sampleOnly && !isSample) {
    return { kind: "heuristic", reason: "Hosted AI runs on the sample dataset only in this public demo. Use your own key for uploads." };
  }
  return { kind: "hosted", apiKey: config.hostedKey, metered: true };
}
