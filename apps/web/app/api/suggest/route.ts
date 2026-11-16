import { createSpec, profileRecords, suggestHeuristic, suggestMappings, type SuggestResult } from "@fieldkit/core";
import { z } from "zod";
import { BYOK_PATTERN, decideEngine, sha256 } from "@/lib/demo";
import { HttpError, SAMPLE_HASH, actorFrom, audit, config, guard, handle, limits, loadCsv, rateLimited, suggestCache, target } from "@/lib/server";

export const runtime = "nodejs";

const Body = z.object({
  csv: z.string(),
  target: z.string().default("contact"),
  shareSamples: z.boolean().default(false),
  useLlm: z.boolean().default(false),
});

type KeySource = "none" | "hosted" | "byok";

export function POST(req: Request) {
  return handle(async () => {
    const visitor = guard(req);
    const body = Body.parse(await req.json());
    const byokKey = req.headers.get("x-anthropic-key")?.trim() || undefined;
    if (byokKey && !BYOK_PATTERN.test(byokKey)) throw new HttpError(400, "That doesn't look like an Anthropic API key (expected sk-ant-…).");

    const t = target(body.target);
    const records = await loadCsv(body.csv);
    const profile = profileRecords(records);
    const isSample = sha256(body.csv) === SAMPLE_HASH;
    const decision = decideEngine({ config, wantsLlm: body.useLlm, byokKey, isSample });

    let result: SuggestResult;
    let keySource: KeySource = "none";
    let cached = false;

    if (decision.kind === "heuristic") {
      // Choosing offline is not a fallback, so there is nothing to explain.
      result = { fields: suggestHeuristic(profile, t), engine: "heuristic", ...(body.useLlm ? { fallbackReason: decision.reason } : {}) };
    } else if (decision.kind === "byok") {
      keySource = "byok";
      result = await suggestMappings(profile, t, { apiKey: decision.apiKey, shareSamples: body.shareSamples });
      if (result.fallbackReason?.includes("401")) result.fallbackReason = "Your API key was rejected (401). Fell back to the offline engine.";
    } else {
      keySource = "hosted";
      const cacheKey = sha256(`${t.id}:${body.shareSamples}:${body.csv}`);
      const hit = decision.metered ? suggestCache.get(cacheKey) : undefined;
      if (hit) {
        result = hit;
        cached = true;
      } else {
        if (decision.metered) {
          // Check both quotas before consuming either, so a global block doesn't burn the visitor's allowance.
          const mine = limits.aiPerVisitor.peek(visitor);
          const all = limits.aiGlobal.peek("global");
          if (!mine.ok) throw rateLimited("You've used today's hosted AI demo runs. Try the offline engine or add your own key.", mine);
          if (!all.ok) throw rateLimited("The hosted AI demo budget for today is used up. Try the offline engine or add your own key.", all);
          limits.aiPerVisitor.consume(visitor);
          limits.aiGlobal.consume("global");
        }
        result = await suggestMappings(profile, t, { apiKey: decision.apiKey, shareSamples: body.shareSamples });
        if (decision.metered && result.engine === "llm") suggestCache.set(cacheKey, result);
      }
    }

    const spec = createSpec(t, records, result.fields);
    await audit.append(actorFrom(req), "suggest", {
      engine: result.engine,
      keySource, // which wallet paid — never the key itself
      cached,
      fallbackReason: result.fallbackReason,
      records: records.length,
      usage: cached ? undefined : result.usage,
    });

    return {
      profile,
      spec,
      engine: result.engine,
      fallbackReason: result.fallbackReason,
      keySource,
      cached,
      quota: config.demoMode ? { remainingToday: limits.aiPerVisitor.peek(visitor).remaining } : undefined,
      targetFields: t.fields.map(({ name, description, required, type }) => ({ name, description, required, type })),
    };
  });
}
