import { SAMPLE_CSV } from "@/lib/sample.generated";

export const runtime = "nodejs";

export function GET() {
  return new Response(SAMPLE_CSV, { headers: { "content-type": "text/csv; charset=utf-8", "cache-control": "public, max-age=3600" } });
}
