import { verifyChain } from "@fieldkit/core";
import { audit, handle } from "@/lib/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  return handle(async () => {
    const events = await audit.read();
    return { integrity: verifyChain(events), events: events.slice(-25).reverse() };
  });
}
