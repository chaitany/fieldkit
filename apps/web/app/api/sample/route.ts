import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const runtime = "nodejs";

export async function GET() {
  const csv = await readFile(join(process.cwd(), "../../examples/acme_legacy_contacts.csv"), "utf8");
  return new Response(csv, { headers: { "content-type": "text/csv; charset=utf-8" } });
}
