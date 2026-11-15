import { createHash } from "node:crypto";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";

export interface AuditEvent {
  seq: number;
  ts: string;
  actor: string;
  action: "profile" | "suggest" | "approve" | "edit" | "dry_run" | "run" | "export";
  details: Record<string, unknown>;
  prevHash: string;
  hash: string;
}

const GENESIS = "0".repeat(64);

function hashEvent(e: Omit<AuditEvent, "hash">): string {
  return createHash("sha256").update(JSON.stringify(e)).digest("hex");
}

/**
 * Append-only, hash-chained audit log (JSONL). Enterprise customers ask "who changed this mapping
 * and when?" — this answers it, and tampering with any past line breaks the chain.
 */
export class AuditLog {
  constructor(private readonly path: string) {}

  async read(): Promise<AuditEvent[]> {
    try {
      const text = await readFile(this.path, "utf8");
      return text.split("\n").filter(Boolean).map((l) => JSON.parse(l) as AuditEvent);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw e;
    }
  }

  async append(actor: string, action: AuditEvent["action"], details: Record<string, unknown>): Promise<AuditEvent> {
    const events = await this.read();
    const last = events.at(-1);
    const base = { seq: (last?.seq ?? 0) + 1, ts: new Date().toISOString(), actor, action, details, prevHash: last?.hash ?? GENESIS };
    const event: AuditEvent = { ...base, hash: hashEvent(base) };
    await mkdir(dirname(this.path), { recursive: true });
    await appendFile(this.path, JSON.stringify(event) + "\n");
    return event;
  }

  async verify(): Promise<{ ok: boolean; brokenAt?: number }> {
    return verifyChain(await this.read());
  }
}

export function verifyChain(events: AuditEvent[]): { ok: boolean; brokenAt?: number } {
  let prev = GENESIS;
  for (const e of events) {
    const { hash, ...rest } = e;
    if (e.prevHash !== prev || hashEvent(rest) !== hash) return { ok: false, brokenAt: e.seq };
    prev = hash;
  }
  return { ok: true };
}
