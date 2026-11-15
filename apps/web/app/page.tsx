"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { AuditEvent, FieldMapping, MappingSpec, RunReport, SourceProfile, Transform } from "@fieldkit/core";

type TargetFieldInfo = { name: string; description: string; required: boolean; type: string };
type SuggestResponse = { profile: SourceProfile; spec: MappingSpec; engine: "llm" | "heuristic"; fallbackReason?: string; targetFields: TargetFieldInfo[] };
type AuditResponse = { integrity: { ok: boolean; brokenAt?: number }; events: AuditEvent[] };

async function api<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, body === undefined ? undefined : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
  return data as T;
}

function transformLabel(t: Transform): string {
  switch (t.op) {
    case "splitName": return `splitName(${t.part})`;
    case "normalizePhone": return `normalizePhone(+${t.defaultCountryCode})`;
    case "default": return `default("${t.value}")`;
    case "enumMap": return `enumMap(${Object.keys(t.map).length})`;
    default: return t.op;
  }
}

const confColor = (c: number) => (c >= 0.8 ? "var(--accent)" : c >= 0.5 ? "var(--warn)" : "var(--bad)");

export default function Workbench() {
  const [csv, setCsv] = useState<string | null>(null);
  const [fileName, setFileName] = useState("");
  const [shareSamples, setShareSamples] = useState(false);
  const [suggest, setSuggest] = useState<SuggestResponse | null>(null);
  const [spec, setSpec] = useState<MappingSpec | null>(null);
  const [report, setReport] = useState<RunReport | null>(null);
  const [audit, setAudit] = useState<AuditResponse | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [over, setOver] = useState(false);

  const refreshAudit = useCallback(() => api<AuditResponse>("/api/audit").then(setAudit).catch(() => {}), []);
  useEffect(() => { refreshAudit(); }, [refreshAudit]);

  const run = async <T,>(label: string, fn: () => Promise<T>) => {
    setBusy(label); setError(null);
    try { return await fn(); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(null); refreshAudit(); }
  };

  const ingest = (text: string, name: string) =>
    run("Profiling & suggesting mappings…", async () => {
      setCsv(text); setFileName(name); setReport(null);
      const r = await api<SuggestResponse>("/api/suggest", { csv: text, target: "contact", shareSamples });
      setSuggest(r); setSpec(r.spec);
    });

  const onFile = async (f: File | undefined) => f && ingest(await f.text(), f.name);
  const loadSample = () => run("Loading sample…", async () => {
    const text = await (await fetch("/api/sample")).text();
    await ingest(text, "acme_legacy_contacts.csv");
  });

  const updateField = (target: string, patch: Partial<FieldMapping>) =>
    setSpec((s) => s && { ...s, fields: s.fields.map((f) => (f.target === target ? { ...f, ...patch } : f)) });

  const changeSource = (target: string, source: string | null) => {
    updateField(target, { source, suggestedBy: "human", confidence: source ? 1 : 0, approved: false, rationale: "set by human reviewer" });
    setReport(null);
  };

  const approveConfident = () =>
    setSpec((s) => s && { ...s, fields: s.fields.map((f) => (f.source && f.confidence >= 0.8 ? { ...f, approved: true } : f)) });

  const requiredPending = useMemo(() => {
    if (!spec || !suggest) return [];
    return suggest.targetFields.filter((t) => t.required).filter((t) => !spec.fields.find((f) => f.target === t.name)?.approved).map((t) => t.name);
  }, [spec, suggest]);

  const execute = (dryRun: boolean) => csv && spec &&
    run(dryRun ? "Running dry run…" : "Running import…", async () => {
      const r = await api<RunReport>("/api/run", { csv, spec, dryRun });
      setReport(r);
      if (!dryRun) {
        const blob = new Blob([r.output.map((o) => JSON.stringify(o)).join("\n") + "\n"], { type: "application/x-ndjson" });
        const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: `fieldkit-${r.runId.slice(0, 8)}.jsonl` });
        a.click();
      }
    });

  const columns = suggest?.profile.fields ?? [];

  return (
    <div className="shell">
      <header className="top">
        <h1>field<span>kit</span></h1>
        <p>Onboard a customer&apos;s messy export in minutes, not sprints. AI proposes · humans approve · schemas enforce.</p>
        <div className="spacer" />
        {suggest && <span className={`badge ${suggest.engine === "llm" ? "ok" : "warn"}`}>engine: {suggest.engine}</span>}
      </header>

      <main>
        {error && <div className="err" style={{ marginBottom: 18 }}>{error}</div>}

        <section className="panel">
          <h2><span className="n">1</span> Ingest source</h2>
          <p className="sub">CSV export from the customer&apos;s legacy system. Profiling runs server-side; nothing is persisted.</p>
          <label
            className={`drop ${over ? "over" : ""}`}
            style={{ display: "block" }}
            onDragOver={(e) => { e.preventDefault(); setOver(true); }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => { e.preventDefault(); setOver(false); onFile(e.dataTransfer.files[0]); }}
          >
            <input type="file" accept=".csv,text/csv" hidden onChange={(e) => onFile(e.target.files?.[0])} />
            {fileName ? <><strong>{fileName}</strong> · {suggest?.profile.recordCount ?? "…"} records · {columns.length} columns</> : <>Drop a CSV here or <strong>click to choose</strong></>}
          </label>
          <div className="row" style={{ marginTop: 12 }}>
            <button className="btn" onClick={loadSample} disabled={!!busy}>Load sample: Acme legacy CRM export</button>
            <label className="row" style={{ gap: 6, color: "var(--muted)" }}>
              <input type="checkbox" checked={shareSamples} onChange={(e) => setShareSamples(e.target.checked)} />
              Share raw sample values with the LLM <span className="desc">(off = masked shapes only, e.g. a***@a***.com)</span>
            </label>
            <div className="spacer" />
            {busy && <span className="badge">{busy}</span>}
          </div>
        </section>

        {suggest && spec && (
          <section className="panel">
            <div className="row">
              <h2><span className="n">2</span> Review mapping</h2>
              <div className="spacer" />
              <button className="btn" onClick={approveConfident}>Approve all ≥ 0.80</button>
            </div>
            <p className="sub">
              Suggestions are proposals, never auto-applied. Change a source to override; approve each field you&apos;ve checked.
              {suggest.fallbackReason && <span className="note"> ⚠ {suggest.fallbackReason}</span>}
            </p>
            <div className="scroll">
              <table>
                <thead><tr><th>Target field</th><th>Source column</th><th>Transforms</th><th>Confidence</th><th>Why</th><th>Approve</th></tr></thead>
                <tbody>
                  {suggest.targetFields.map((tf) => {
                    const m = spec.fields.find((f) => f.target === tf.name)!;
                    const col = columns.find((c) => c.name === m.source);
                    return (
                      <tr key={tf.name}>
                        <td><code>{tf.name}</code>{tf.required && <span className="req" title="required">*</span>}<div className="desc">{tf.description}</div></td>
                        <td>
                          <select value={m.source ?? ""} onChange={(e) => changeSource(tf.name, e.target.value || null)}>
                            <option value="">— unmapped —</option>
                            {columns.map((c) => <option key={c.name} value={c.name}>{c.name} ({c.inferredType})</option>)}
                          </select>
                          {col && <div className="desc mono" title={col.samples.join("\n")}>e.g. {col.samples.slice(0, 2).join(" · ")}</div>}
                        </td>
                        <td>
                          {m.transforms.map((t, i) => (
                            <span className="chip" key={i}>{transformLabel(t)}
                              <button aria-label="remove transform" onClick={() => updateField(tf.name, { transforms: m.transforms.filter((_, j) => j !== i), suggestedBy: "human", approved: false })}>×</button>
                            </span>
                          ))}
                          {m.transforms.filter((t): t is Extract<Transform, { op: "enumMap" }> => t.op === "enumMap").map((t, i) => (
                            <div className="enum" key={i}>{Object.entries(t.map).map(([k, v]) => `${k}→${v}`).join(", ")}</div>
                          ))}
                        </td>
                        <td className="conf">
                          <span className="mono" style={{ color: confColor(m.confidence) }}>{m.confidence.toFixed(2)}</span>
                          <div className="bar"><i style={{ width: `${m.confidence * 100}%`, background: confColor(m.confidence) }} /></div>
                          <div className="desc">{m.suggestedBy}</div>
                        </td>
                        <td className="desc" style={{ maxWidth: 260 }}>{m.rationale}</td>
                        <td><input type="checkbox" checked={m.approved} disabled={!m.source} onChange={(e) => updateField(tf.name, { approved: e.target.checked })} /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {spec && (
          <section className="panel">
            <div className="row">
              <h2><span className="n">3</span> Validate &amp; run</h2>
              <div className="spacer" />
              <button className="btn" onClick={() => execute(true)} disabled={!!busy}>Dry run</button>
              <button className="btn primary" onClick={() => execute(false)} disabled={!!busy || requiredPending.length > 0}
                title={requiredPending.length ? `Approve required fields first: ${requiredPending.join(", ")}` : "Run and download JSONL"}>
                Run import &amp; download
              </button>
            </div>
            <p className="sub">
              Every row is validated against the target schema. Dry runs use all suggestions; real runs only use approved fields.
              {requiredPending.length > 0 && <span className="note"> Awaiting approval: {requiredPending.join(", ")}</span>}
            </p>

            {report && (
              <>
                <div className="kpis">
                  <div className="kpi"><b>{report.total}</b><span>rows {report.dryRun ? "(dry run)" : "imported"}</span></div>
                  <div className="kpi"><b style={{ color: "var(--accent)" }}>{report.valid}</b><span>valid</span></div>
                  <div className="kpi"><b style={{ color: report.invalid ? "var(--bad)" : undefined }}>{report.invalid}</b><span>need customer fix</span></div>
                  <div className="kpi"><b>{((report.valid / Math.max(1, report.total)) * 100).toFixed(1)}%</b><span>clean · {report.durationMs}ms</span></div>
                </div>

                {report.invalid > 0 && (
                  <div className="row" style={{ alignItems: "flex-start", gap: 24, marginBottom: 16 }}>
                    <div style={{ flex: "0 0 300px" }}>
                      <div className="desc" style={{ marginBottom: 6 }}>Errors by field</div>
                      {Object.entries(report.errorsByField).sort((a, b) => b[1] - a[1]).map(([f, n]) => {
                        const max = Math.max(...Object.values(report.errorsByField));
                        return <div className="hbar" key={f}><code>{f}</code><div className="track"><i style={{ width: `${(n / max) * 100}%` }} /></div><span className="mono">{n}</span></div>;
                      })}
                    </div>
                    <div className="scroll" style={{ flex: 1 }}>
                      <table>
                        <thead><tr><th>Row</th><th>Field</th><th>Problem</th><th>Value</th></tr></thead>
                        <tbody>{report.errors.slice(0, 10).map((e, i) => (
                          <tr key={i}><td className="mono">{e.row}</td><td><code>{e.field}</code></td><td>{e.message}</td><td className="mono desc">{JSON.stringify(e.value) ?? "—"}</td></tr>
                        ))}</tbody>
                      </table>
                    </div>
                  </div>
                )}

                {report.preview.length > 0 && (
                  <div className="scroll">
                    <div className="desc" style={{ marginBottom: 6 }}>Preview of transformed records</div>
                    <table>
                      <thead><tr>{Object.keys(report.preview[0]!).map((k) => <th key={k}>{k}</th>)}</tr></thead>
                      <tbody>{report.preview.map((r, i) => (
                        <tr key={i}>{Object.keys(report.preview[0]!).map((k) => <td key={k} className="mono">{String(r[k] ?? "")}</td>)}</tr>
                      ))}</tbody>
                    </table>
                  </div>
                )}
              </>
            )}
          </section>
        )}
      </main>

      <aside>
        <section className="panel">
          <div className="row">
            <h2>Audit trail</h2>
            <div className="spacer" />
            {audit && <span className={`badge ${audit.integrity.ok ? "ok" : "bad"}`}>{audit.integrity.ok ? "✔ chain intact" : `✘ broken at #${audit.integrity.brokenAt}`}</span>}
          </div>
          <p className="sub">Append-only, SHA-256 hash-chained. Answers &ldquo;who approved this mapping, and when?&rdquo;</p>
          {audit?.events.length ? audit.events.map((e) => (
            <div className="event" key={e.seq}>
              <div><span className="a">{e.action}</span> <span className="t">#{e.seq} · {e.actor} · {new Date(e.ts).toLocaleTimeString()}</span></div>
              <code>{e.hash.slice(0, 12)}…</code>
            </div>
          )) : <p className="desc">No events yet.</p>}
        </section>
      </aside>
    </div>
  );
}
