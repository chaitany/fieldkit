import "server-only";
import { join } from "node:path";
import { AuditLog, CsvConnector, collect, getTarget } from "@fieldkit/core";
import { z } from "zod";

export const MAX_CSV_BYTES = 10 * 1024 * 1024;

export const audit = new AuditLog(process.env.FIELDKIT_AUDIT ?? join(process.cwd(), ".fieldkit/audit.jsonl"));

export const actorFrom = (req: Request) => req.headers.get("x-fieldkit-actor")?.slice(0, 64) || "web-user";

export async function loadCsv(csv: string) {
  if (csv.length > MAX_CSV_BYTES) throw new HttpError(413, "CSV exceeds 10MB. Use the CLI for large files.");
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

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** Uniform error envelope so the UI can always show something actionable. */
export function handle<T>(fn: () => Promise<T>) {
  return fn()
    .then((data) => Response.json(data))
    .catch((err: unknown) => {
      if (err instanceof HttpError) return Response.json({ error: err.message }, { status: err.status });
      if (err instanceof z.ZodError) return Response.json({ error: "Invalid request", issues: err.issues }, { status: 400 });
      if (err instanceof Error && err.name === "SpecValidationError") return Response.json({ error: err.message }, { status: 422 });
      console.error(err);
      return Response.json({ error: "Internal error" }, { status: 500 });
    });
}
