import { createSpec, profileRecords, suggestMappings } from "@fieldkit/core";
import { z } from "zod";
import { actorFrom, audit, handle, loadCsv, target } from "@/lib/server";

export const runtime = "nodejs";

const Body = z.object({ csv: z.string(), target: z.string().default("contact"), shareSamples: z.boolean().default(false) });

export function POST(req: Request) {
  return handle(async () => {
    const body = Body.parse(await req.json());
    const t = target(body.target);
    const records = await loadCsv(body.csv);
    const profile = profileRecords(records);
    const result = await suggestMappings(profile, t, { shareSamples: body.shareSamples });
    const spec = createSpec(t, records, result.fields);
    await audit.append(actorFrom(req), "suggest", { engine: result.engine, fallbackReason: result.fallbackReason, records: records.length, usage: result.usage });
    return {
      profile,
      spec,
      engine: result.engine,
      fallbackReason: result.fallbackReason,
      targetFields: t.fields.map(({ name, description, required, type }) => ({ name, description, required, type })),
    };
  });
}
