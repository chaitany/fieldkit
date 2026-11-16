"use client";

import type { AuditEvent } from "@fieldkit/core";

const WHAT: Record<AuditEvent["action"], string> = {
  profile: "Profiled source",
  suggest: "Suggested mapping",
  approve: "Approved mapping",
  edit: "Edited mapping",
  dry_run: "Dry run",
  run: "Imported records",
  export: "Exported",
};

function detail(e: AuditEvent): string | null {
  const d = e.details as Record<string, unknown>;
  if (e.action === "suggest") return d.keySource === "byok" ? "AI, visitor's key" : d.engine === "llm" ? "AI" : "Offline engine";
  if (e.action === "dry_run" || e.action === "run") return `${d.valid} of ${d.total} rows valid`;
  if (e.action === "approve" && Array.isArray(d.approved)) return `${d.approved.length} fields`;
  return null;
}

export function AuditRail({ events, ok, brokenAt, ephemeral }: { events: AuditEvent[]; ok: boolean; brokenAt?: number; ephemeral: boolean }) {
  return (
    <aside className="rail">
      <section className="sheet">
        <div className="rail-head">
          <h2>Audit trail</h2>
          <span className="seal" data-ok={ok}>
            <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              {ok ? <path d="M2.5 6.5l2.2 2.2L9.5 3.5" /> : <path d="M3 3l6 6M9 3l-6 6" />}
            </svg>
            {ok ? "Untampered" : `Broken at #${brokenAt}`}
          </span>
        </div>
        <p className="sub">
          Every step is chained with SHA-256, so editing any past entry breaks the seal.
          {ephemeral && " On this demo host the trail resets when the server restarts."}
        </p>
        {events.length ? (
          <ol className="timeline">
            {events.map((e) => (
              <li key={e.seq} data-action={e.action}>
                <div className="what">{WHAT[e.action]}</div>
                <div className="when">{new Date(e.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}{detail(e) ? `, ${detail(e)}` : ""}</div>
                <div className="hash" title={e.hash}>#{e.seq} {e.hash.slice(0, 10)}</div>
              </li>
            ))}
          </ol>
        ) : <p className="faint" style={{ fontSize: 13.5, margin: "0 0 12px" }}>Actions you take will be recorded here.</p>}
      </section>
    </aside>
  );
}
