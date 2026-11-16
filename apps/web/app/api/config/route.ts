import { visitorKey } from "@/lib/demo";
import { auditIsEphemeral, config, limits } from "@/lib/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Public, non-secret deployment capabilities so the UI can explain itself. Never exposes the key. */
export function GET(req: Request) {
  const visitor = visitorKey(req.headers);
  return Response.json({
    demoMode: config.demoMode,
    hostedAi: Boolean(config.hostedKey),
    hostedSampleOnly: config.demoMode && config.sampleOnly,
    remainingToday: config.demoMode ? limits.aiPerVisitor.peek(visitor).remaining : null,
    perVisitorDaily: config.demoMode ? config.perVisitorDaily : null,
    maxCsvMb: Math.round(config.maxCsvBytes / 1024 / 1024),
    auditIsEphemeral,
  });
}
