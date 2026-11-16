import { MappingSpecSchema, runPipeline } from "@fieldkit/core";
import { z } from "zod";
import { actorFrom, audit, guard, handle, loadCsv, target } from "@/lib/server";

export const runtime = "nodejs";

const Body = z.object({ csv: z.string(), spec: MappingSpecSchema, dryRun: z.boolean().default(true) });

export function POST(req: Request) {
  return handle(async () => {
    guard(req);
    const body = Body.parse(await req.json());
    const records = await loadCsv(body.csv);
    const report = runPipeline(records, body.spec, target(body.spec.target), { dryRun: body.dryRun, previewSize: 8 });
    const actor = actorFrom(req);
    if (!body.dryRun) {
      // Record exactly what was approved and by whom — this is the artefact a customer's auditor asks for.
      await audit.append(actor, "approve", { approved: body.spec.fields.filter((f) => f.approved).map((f) => ({ target: f.target, source: f.source, transforms: f.transforms })) });
    }
    await audit.append(actor, body.dryRun ? "dry_run" : "run", { runId: report.runId, total: report.total, valid: report.valid, invalid: report.invalid, errorsByField: report.errorsByField });
    // Dry runs return a preview only; real runs return the full output for download.
    return { ...report, output: body.dryRun ? [] : report.output, errors: report.errors.slice(0, 200) };
  });
}
