"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { AuditEvent, FieldMapping, MappingSpec, RunReport, SourceProfile } from "@fieldkit/core";
import { AuditRail } from "@/components/AuditRail";
import { EnginePicker, type Engine } from "@/components/EnginePicker";
import { Inspector } from "@/components/Inspector";
import { EmptyCanvas, MappingCanvas } from "@/components/MappingCanvas";
import { Results } from "@/components/Results";
import type { TargetFieldInfo } from "@/lib/ui";

type SuggestResponse = {
  profile: SourceProfile; spec: MappingSpec; engine: "llm" | "heuristic"; fallbackReason?: string; targetFields: TargetFieldInfo[];
  keySource: "none" | "hosted" | "byok"; cached: boolean; quota?: { remainingToday: number };
};
type DeployConfig = {
  demoMode: boolean; hostedAi: boolean; hostedSampleOnly: boolean; remainingToday: number | null;
  perVisitorDaily: number | null; maxCsvMb: number; auditIsEphemeral: boolean;
};
type AuditResponse = { integrity: { ok: boolean; brokenAt?: number }; events: AuditEvent[] };
type Busy = null | "suggest" | "dry" | "run";

async function api<T>(path: string, body?: unknown, headers: Record<string, string> = {}): Promise<T> {
  const res = await fetch(path, body === undefined ? undefined : { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
  return data as T;
}

export default function Workbench() {
  const [csv, setCsv] = useState<string | null>(null);
  const [fileName, setFileName] = useState("");
  const [shareSamples, setShareSamples] = useState(false);
  const [suggest, setSuggest] = useState<SuggestResponse | null>(null);
  const [spec, setSpec] = useState<MappingSpec | null>(null);
  const [report, setReport] = useState<RunReport | null>(null);
  const [audit, setAudit] = useState<AuditResponse | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const [deploy, setDeploy] = useState<DeployConfig | null>(null);
  const [engine, setEngine] = useState<Engine>("offline");
  // The visitor's key lives only in React state: never persisted, sent only as a request header.
  const [byokKey, setByokKey] = useState("");
  const [selected, setSelected] = useState<string | null>(null);

  const refreshAudit = useCallback(() => api<AuditResponse>("/api/audit").then(setAudit).catch(() => {}), []);
  const refreshConfig = useCallback(() => api<DeployConfig>("/api/config").then(setDeploy).catch(() => {}), []);
  useEffect(() => {
    refreshAudit();
    api<DeployConfig>("/api/config").then((c) => { setDeploy(c); if (c.hostedAi) setEngine("hosted"); }).catch(() => {});
  }, [refreshAudit]);

  const run = async (kind: Exclude<Busy, null>, fn: () => Promise<void>) => {
    setBusy(kind); setError(null);
    try { await fn(); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(null); refreshAudit(); refreshConfig(); }
  };

  const ingest = (text: string, name: string) => {
    if (engine === "byok" && !byokKey.trim()) return setError("Paste your Anthropic API key first, or switch to the offline engine.");
    return run("suggest", async () => {
      setCsv(text); setFileName(name); setReport(null); setSelected(null);
      const useByok = engine === "byok";
      const r = await api<SuggestResponse>(
        "/api/suggest",
        { csv: text, target: "contact", shareSamples, useLlm: engine !== "offline" },
        useByok ? { "x-anthropic-key": byokKey.trim() } : {},
      );
      setSuggest(r); setSpec(r.spec);
    });
  };

  const onFile = async (f: File | undefined) => f && ingest(await f.text(), f.name);
  const loadSample = async () => {
    try { ingest(await (await fetch("/api/sample")).text(), "acme_legacy_contacts.csv"); }
    catch { setError("Couldn't load the sample file. Refresh and try again."); }
  };

  const patchField = (target: string, patch: Partial<FieldMapping>) => {
    setSpec((s) => s && { ...s, fields: s.fields.map((f) => (f.target === target ? { ...f, ...patch } : f)) });
    if (!("approved" in patch && Object.keys(patch).length === 1)) setReport(null);
  };
  const toggleApprove = (target: string) => {
    const f = spec?.fields.find((x) => x.target === target);
    if (f?.source) patchField(target, { approved: !f.approved });
  };
  const approveConfident = () =>
    setSpec((s) => s && { ...s, fields: s.fields.map((f) => (f.source && f.confidence >= 0.8 ? { ...f, approved: true } : f)) });

  const requiredPending = useMemo(() => {
    if (!spec || !suggest) return [];
    return suggest.targetFields.filter((t) => t.required && !spec.fields.find((f) => f.target === t.name)?.approved).map((t) => t.name);
  }, [spec, suggest]);

  const execute = (dryRun: boolean) => csv && spec &&
    run(dryRun ? "dry" : "run", async () => {
      const r = await api<RunReport>("/api/run", { csv, spec, dryRun });
      setReport(r);
      if (!dryRun) {
        const blob = new Blob([r.output.map((o) => JSON.stringify(o)).join("\n") + "\n"], { type: "application/x-ndjson" });
        const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: `fieldkit-${r.runId.slice(0, 8)}.jsonl` });
        a.click();
      }
    });

  const steps = [
    { label: "Ingest", state: suggest ? "done" : "active" },
    { label: "Map", state: !suggest ? "todo" : requiredPending.length ? "active" : "done" },
    { label: "Validate", state: report && !report.dryRun ? "done" : suggest && !requiredPending.length ? "active" : "todo" },
  ];

  const hostedNote = !deploy?.demoMode ? "Uses this server's configured key."
    : `${deploy.hostedSampleOnly ? "Sample only. " : ""}${deploy.remainingToday ?? 0} of ${deploy.perVisitorDaily} runs left today.`;

  const columns = suggest?.profile.fields ?? [];
  const selField = selected && spec?.fields.find((f) => f.target === selected);
  const selInfo = selected && suggest?.targetFields.find((t) => t.name === selected);
  const engineSummary = suggest && (suggest.engine === "llm"
    ? `Matched by AI${suggest.keySource === "byok" ? " with your key" : ""}${suggest.cached ? " (cached)" : ""}`
    : "Matched by the offline engine");

  return (
    <div className="app">
      <header className="bar">
        <div className="wordmark">fieldkit<i aria-hidden="true" /></div>
        <p className="purpose">Map a customer&apos;s messy export to your schema, review every field, and import clean records.</p>
        <div className="spacer" />
        <nav className="stepper" aria-label="Progress">
          {steps.map((s, i) => (
            <span key={s.label} style={{ display: "contents" }}>
              {i > 0 && <span className="step-link" data-done={steps[i - 1]!.state === "done"} aria-hidden="true" />}
              <span className="step" data-state={s.state} aria-current={s.state === "active" ? "step" : undefined}>
                <b>{s.state === "done" ? "✓" : i + 1}</b><span>{s.label}</span>
              </span>
            </span>
          ))}
        </nav>
      </header>

      {deploy?.demoMode && (
        <div className="notice">
          <strong>Public demo.</strong>
          <span>
            Files are processed in memory and never stored.{" "}
            {deploy.hostedAi ? "AI on the server key is rate-limited; use your own key for your files." : "The offline engine is free. To try AI matching, use your own Anthropic key."}
          </span>
        </div>
      )}

      <div className="layout">
        <main>
          {error && (
            <div className="error" role="alert">
              <span>{error}</span>
              <button onClick={() => setError(null)} aria-label="Dismiss">×</button>
            </div>
          )}

          <section className="sheet">
            <div className="ingest">
              <div
                className={`drop ${over ? "over" : ""}`}
                onDragOver={(e) => { e.preventDefault(); setOver(true); }}
                onDragLeave={() => setOver(false)}
                onDrop={(e) => { e.preventDefault(); setOver(false); onFile(e.dataTransfer.files[0]); }}
              >
                {/* The label is stretched over the whole zone, so clicking anywhere opens the file picker. */}
                <label className="drop-hit">
                  <input type="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = ""; }} />
                  {fileName ? (
                    <span className="drop-file">
                      <span className="doc" aria-hidden="true" />
                      <span>
                        <span className="drop-title">{fileName}</span>
                        <span className="muted drop-sub">
                          {suggest ? `${suggest.profile.recordCount} rows and ${columns.length} columns. Drop another file to replace it.` : "Reading…"}
                        </span>
                      </span>
                    </span>
                  ) : (
                    <>
                      <span className="drop-title">Drop a customer CSV export</span>
                      <span className="muted drop-sub">or click to choose a file, up to {deploy?.maxCsvMb ?? 10} MB</span>
                    </>
                  )}
                </label>
                <div className="actions">
                  <button type="button" className="btn" onClick={loadSample} disabled={!!busy}>
                    {busy === "suggest" && !csv ? <span className="spinner" /> : null}Load the sample export
                  </button>
                  {csv && (
                    <button type="button" className="btn ghost" onClick={() => ingest(csv, fileName)} disabled={!!busy}>
                      {busy === "suggest" ? <span className="spinner" /> : null}Match again
                    </button>
                  )}
                </div>
              </div>

              <EnginePicker
                engine={engine} onChange={setEngine} hostedAi={!!deploy?.hostedAi} hostedNote={hostedNote}
                byokKey={byokKey} onKeyChange={setByokKey} shareSamples={shareSamples} onShareSamples={setShareSamples}
              />
            </div>
          </section>

          <section className="sheet">
            <div className="sheet-head">
              <div>
                <h2>Review the mapping</h2>
                <p>
                  {suggest
                    ? <>{engineSummary}. Click a field to see why, change its source, or edit cleanup steps. Tick each one you have checked.{suggest.fallbackReason && <span style={{ color: "var(--mid)" }}> {suggest.fallbackReason}.</span>}</>
                    : "Each line connects one of their columns to one of your fields."}
                </p>
              </div>
            </div>
            {suggest && (
              <div className="toolbar">
                <div className="legend" aria-hidden="true">
                  <span><i style={{ background: "var(--high)" }} />Likely right</span>
                  <span><i style={{ background: "var(--mid)" }} />Check closely</span>
                  <span><i style={{ background: "var(--ink)", height: 4 }} />Approved</span>
                </div>
                <button className="btn" onClick={approveConfident}>Approve all likely matches</button>
              </div>
            )}
            {suggest && spec ? (
              <MappingCanvas
                columns={columns} targetFields={suggest.targetFields} fields={spec.fields}
                selected={selected} drawKey={spec.createdAt} onSelect={setSelected} onToggleApprove={toggleApprove}
              />
            ) : <EmptyCanvas />}
          </section>

          {spec && (
            <section className="sheet">
              <div className="sheet-head">
                <div>
                  <h2>Validate and import</h2>
                  <p>Every row is checked against your schema. A dry run uses all suggestions; an import only uses fields you approved.</p>
                </div>
                <div className="spacer" />
                <button className="btn" onClick={() => execute(true)} disabled={!!busy}>
                  {busy === "dry" && <span className="spinner" />}Dry run
                </button>
                <button className="btn primary" onClick={() => execute(false)} disabled={!!busy || requiredPending.length > 0}>
                  {busy === "run" && <span className="spinner" />}Import and download
                </button>
              </div>
              {requiredPending.length > 0 && (
                <p className="run-hint">Approve {requiredPending.length === 1 ? "this required field" : "these required fields"} to import: <span className="data">{requiredPending.join(", ")}</span></p>
              )}
              {report && <Results key={report.runId} report={report} fileName={fileName} />}
            </section>
          )}
        </main>

        <AuditRail events={audit?.events ?? []} ok={audit?.integrity.ok ?? true} brokenAt={audit?.integrity.brokenAt} ephemeral={!!deploy?.auditIsEphemeral} />
      </div>

      {selField && selInfo && (
        <Inspector
          target={selInfo} mapping={selField} columns={columns}
          onChangeSource={(source) => patchField(selInfo.name, { source, suggestedBy: "human", confidence: source ? 1 : 0, approved: false, rationale: "Chosen by a reviewer." })}
          onRemoveOp={(i) => patchField(selInfo.name, { transforms: selField.transforms.filter((_, j) => j !== i), suggestedBy: "human", approved: false })}
          onToggleApprove={() => toggleApprove(selInfo.name)}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}
