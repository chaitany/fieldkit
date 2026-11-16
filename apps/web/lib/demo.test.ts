import { describe, expect, it } from "vitest";
import { BYOK_PATTERN, FixedWindowLimiter, TtlCache, decideEngine, loadConfig, visitorKey } from "./demo";

describe("loadConfig", () => {
  it("defaults to non-demo with generous limits", () => {
    const c = loadConfig({});
    expect(c).toMatchObject({ demoMode: false, sampleOnly: true, perVisitorDaily: 5, globalDaily: 100, requestsPerMinute: 600 });
    expect(c.hostedKey).toBeUndefined();
  });

  it("tightens limits in demo mode", () => {
    const c = loadConfig({ FIELDKIT_DEMO_MODE: "1", FIELDKIT_AI_GLOBAL_DAILY: "20" });
    expect(c).toMatchObject({ demoMode: true, globalDaily: 20, requestsPerMinute: 30, maxCsvBytes: 2 * 1024 * 1024 });
  });
});

describe("FixedWindowLimiter", () => {
  it("allows up to the limit, then blocks until the window resets", () => {
    let t = 0;
    const l = new FixedWindowLimiter(2, 1000, () => t);
    expect(l.consume("a").ok).toBe(true);
    expect(l.consume("a").ok).toBe(true);
    expect(l.consume("a")).toMatchObject({ ok: false, remaining: 0 });
    expect(l.consume("b").ok).toBe(true); // keys are independent
    t = 1000;
    expect(l.consume("a")).toMatchObject({ ok: true, remaining: 1 });
  });

  it("peek does not consume", () => {
    const l = new FixedWindowLimiter(1, 1000, () => 0);
    l.peek("a");
    l.peek("a");
    expect(l.consume("a").ok).toBe(true);
  });
});

describe("TtlCache", () => {
  it("expires entries and evicts the oldest at capacity", () => {
    let t = 0;
    const c = new TtlCache<number>(100, 2, () => t);
    c.set("a", 1);
    c.set("b", 2);
    c.set("c", 3);
    expect(c.get("a")).toBeUndefined();
    expect(c.get("c")).toBe(3);
    t = 100;
    expect(c.get("c")).toBeUndefined();
  });
});

describe("decideEngine", () => {
  const demo = loadConfig({ FIELDKIT_DEMO_MODE: "1", ANTHROPIC_API_KEY: "host-key" });

  it("never spends anything when the visitor picks offline", () => {
    expect(decideEngine({ config: demo, wantsLlm: false, isSample: true }).kind).toBe("heuristic");
  });

  it("prefers the visitor's own key over the hosted key", () => {
    expect(decideEngine({ config: demo, wantsLlm: true, byokKey: "sk-ant-visitor", isSample: false })).toEqual({ kind: "byok", apiKey: "sk-ant-visitor" });
  });

  it("only spends the hosted key on the sample in demo mode", () => {
    expect(decideEngine({ config: demo, wantsLlm: true, isSample: true })).toEqual({ kind: "hosted", apiKey: "host-key", metered: true });
    const upload = decideEngine({ config: demo, wantsLlm: true, isSample: false });
    expect(upload.kind).toBe("heuristic");
  });

  it("is unmetered outside demo mode (local / private deployments)", () => {
    const priv = loadConfig({ ANTHROPIC_API_KEY: "k" });
    expect(decideEngine({ config: priv, wantsLlm: true, isSample: false })).toEqual({ kind: "hosted", apiKey: "k", metered: false });
  });

  it("explains itself when no hosted key exists", () => {
    const d = decideEngine({ config: loadConfig({ FIELDKIT_DEMO_MODE: "1" }), wantsLlm: true, isSample: true });
    expect(d).toMatchObject({ kind: "heuristic", reason: expect.stringMatching(/own key/) });
  });
});

describe("visitorKey", () => {
  it("hashes the client IP rather than storing it", () => {
    const k = visitorKey(new Headers({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" }), "salt");
    expect(k).toHaveLength(24);
    expect(k).not.toContain("203");
    expect(k).toBe(visitorKey(new Headers({ "x-forwarded-for": "203.0.113.7" }), "salt"));
  });
});

describe("BYOK_PATTERN", () => {
  it("accepts Anthropic-shaped keys only", () => {
    expect(BYOK_PATTERN.test("sk-ant-api03-abcdefghijklmnopqrstuvwxyz")).toBe(true);
    expect(BYOK_PATTERN.test("sk-proj-abc")).toBe(false);
  });
});
