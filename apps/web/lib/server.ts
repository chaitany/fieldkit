import "server-only";
import { join } from "node:path";
import { AuditLog, CsvConnector, SpecValidationError, collect, getTarget } from "@fieldkit/core";
import { z } from "zod";
import { FixedWindowLimiter, TtlCache, loadConfig, sha256, visitorKey, type LimitResult } from "./demo";
import type { SuggestResult } from "@fieldkit/core";
import { SAMPLE_CSV } from "./sample.generated";

export const config = loadConfig();

const DAY = 24 * 60 * 60 * 1000;

// Module-level singletons survive across requests within one warm instance.
export const limits = {
  requests: new FixedWindowLimiter(config.requestsPerMinute, 60 * 1000),
  aiPerVisitor: new FixedWindowLimiter(config.perVisitorDaily, DAY),
  aiGlobal: new FixedWindowLimiter(config.globalDaily, DAY),
};
export const suggestCache = new TtlCache<SuggestResult>(DAY, 50);
export const SAMPLE_HASH = sha256(SAMPLE_CSV);

/**
 * Serverless hosts (Vercel) have a read-only filesystem except /tmp. The audit log is then
 * per-instance and ephemeral, which is fine for a demo and called out in the UI. Production → Postgres.
 */
function auditPath(): string {
  if (process.env.FIELDKIT_AUDIT) return process.env.FIELDKIT_AUDIT;
  if (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME) return "/tmp/fieldkit/audit.jsonl";
  return join(process.cwd(), ".fieldkit/audit.jsonl");
}
export const audit = new AuditLog(auditPath());
export const auditIsEphemeral = auditPath().startsWith("/tmp/");

export const actorFrom = (req: Request) => req.headers.get("x-fieldkit-actor")?.slice(0, 64) || "web-user";

export class HttpError extends Error {
  constructor(public status: number, message: string, public headers: Record<string, string> = {}) {
    super(message);
  }
}

/** General abuse guard for every mutating route: cheap, per visitor, per minute. */
export function guard(req: Request): string {
  const visitor = visitorKey(req.headers);
  const r = limits.requests.consume(visitor);
  if (!r.ok) throw rateLimited("Too many requests. Slow down and try again in a minute.", r);
  return visitor;
}

export function rateLimited(message: string, r: LimitResult) {
  return new HttpError(429, message, { "retry-after": String(Math.ceil((r.resetAt - Date.now()) / 1000)) });
}

export async function loadCsv(csv: string) {
  if (csv.length > config.maxCsvBytes) {
    const mb = (config.maxCsvBytes / 1024 / 1024).toFixed(0);
    throw new HttpError(413, `CSV exceeds ${mb}MB${config.demoMode ? " on this public demo" : ""}. Use the CLI for large files.`);
  }
  const records = await collect(new CsvConnector(csv));
  if (!records.length) throw new HttpError(400, "CSV has no data rows");
  return records;
}

export function target(id: string) {
  try {
    return getTarget(id);
  } catch (e) {
    throw new HttpError(400, (e as Error).message);
  }
}

/** Uniform error envelope so the UI can always show something actionable. */
export function handle<T>(fn: () => Promise<T>) {
  return fn()
    .then((data) => Response.json(data))
    .catch((err: unknown) => {
      if (err instanceof HttpError) return Response.json({ error: err.message }, { status: err.status, headers: err.headers });
      if (err instanceof z.ZodError) return Response.json({ error: "Invalid request", issues: err.issues }, { status: 400 });
      if (err instanceof SpecValidationError) return Response.json({ error: err.message }, { status: 422 });
      // Never log request bodies or headers here: they can contain customer data or a visitor's API key.
      console.error(err instanceof Error ? `${err.name}: ${err.message}` : "unknown error");
      return Response.json({ error: "Internal error" }, { status: 500 });
    });
}
