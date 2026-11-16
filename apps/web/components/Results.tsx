"use client";

import { useState } from "react";
import type { RunReport } from "@fieldkit/core";
import { useCountUp } from "@/lib/ui";

export function Results({ report, fileName }: { report: RunReport; fileName: string }) {
  const valid = useCountUp(report.valid);
  const invalid = useCountUp(report.invalid);
  const [copied, setCopied] = useState(false);
  const pct = report.total ? (report.valid / report.total) * 100 : 0;
  const byField = Object.entries(report.errorsByField).sort((a, b) => b[1] - a[1]);
  const max = Math.max(1, ...byField.map(([, n]) => n));
  const cols = report.preview[0] ? Object.keys(report.preview[0]) : [];

  const copyFixList = async () => {
    const lines = report.errors.map((e) => `- Row ${e.row}, ${e.field}: ${e.message}${e.value !== undefined ? ` (${JSON.stringify(e.value)})` : ""}`);
    const text = `Rows in ${fileName} that need a fix before import:\n${lines.join("\n")}`;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard blocked: nothing useful to do */ }
  };

  return (
    <div aria-live="polite">
      <div className="verdict">
        <div>
          <h3>{valid} <span className="of">of {report.total}</span> rows {report.dryRun ? "are ready" : "imported"}</h3>
          <p>
            {report.invalid
              ? `${invalid} ${report.invalid === 1 ? "row needs" : "rows need"} a fix from the customer.`
              : "Every row passed validation."}{" "}
            {report.dryRun ? "Dry run: nothing was imported." : "Clean records were downloaded as JSONL."}
          </p>
        </div>
        <div className="ratio" aria-hidden="true">
          <div className="track"><i style={{ width: `${pct}%` }} /></div>
          <div className="cap"><span>{pct.toFixed(1)}% clean</span><span>{report.durationMs} ms</span></div>
        </div>
      </div>

      {report.invalid > 0 ? (
        <div className="fixes">
          <div>
            <h4>Problems by field</h4>
            {byField.map(([f, n], i) => (
              <div className="bar-row" key={f}>
                <span className="data">{f}</span>
                <span className="track"><i style={{ width: `${(n / max) * 100}%`, animationDelay: `${i * 60}ms` }} /></span>
                <span className="n">{n}</span>
              </div>
            ))}
          </div>
          <div>
            <h4>
              Rows to send back
              <button className="btn ghost" onClick={copyFixList} style={{ marginLeft: "auto" }}>{copied ? "Copied" : "Copy fix list"}</button>
            </h4>
            <ul className="fix-list">
              {report.errors.slice(0, 12).map((e, i) => (
                <li key={`${e.row}-${e.field}`} style={{ animationDelay: `${i * 40}ms` }}>
                  <span className="row-no">Row {e.row}</span>
                  <span className="data">{e.field}</span>
                  <span className="msg">{e.message}{e.value !== undefined && e.value !== "" && <span className="val">{JSON.stringify(e.value)}</span>}</span>
                </li>
              ))}
            </ul>
            {report.errors.length > 12 && <p className="faint" style={{ fontSize: 13 }}>{report.errors.length - 12} more in the copied list.</p>}
          </div>
        </div>
      ) : (
        <div className="all-clean">Every row matches the schema.</div>
      )}

      {report.preview.length > 0 && (
        <div className="preview">
          <h4>Clean records, first {report.preview.length}</h4>
          <table>
            <thead><tr>{cols.map((k) => <th key={k}>{k}</th>)}</tr></thead>
            <tbody>
              {report.preview.map((r, i) => (
                <tr key={i} style={{ animationDelay: `${i * 35}ms` }}>{cols.map((k) => <td key={k}>{String(r[k] ?? "")}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
