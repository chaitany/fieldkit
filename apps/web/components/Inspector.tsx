"use client";

import { useEffect, useRef } from "react";
import type { FieldMapping, FieldProfile, Transform } from "@fieldkit/core";
import { confTone, opLabel, toneVar, type TargetFieldInfo } from "@/lib/ui";

interface Props {
  target: TargetFieldInfo;
  mapping: FieldMapping;
  columns: FieldProfile[];
  onChangeSource: (source: string | null) => void;
  onRemoveOp: (index: number) => void;
  onToggleApprove: () => void;
  onClose: () => void;
}

const TONE_COPY = { high: "High confidence", mid: "Worth a closer look", low: "Low confidence: check carefully" };
const BY = { heuristic: "offline engine", llm: "AI", human: "you" };

export function Inspector({ target, mapping, columns, onChangeSource, onRemoveOp, onToggleApprove, onClose }: Props) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const col = columns.find((c) => c.name === mapping.source);
  const enumMaps = mapping.transforms.filter((t): t is Extract<Transform, { op: "enumMap" }> => t.op === "enumMap");

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-modal="true" aria-labelledby="inspector-title">
        <header>
          <div>
            <h3 id="inspector-title">{target.name}{target.required && <span style={{ color: "var(--low)" }}> *</span>}</h3>
            <p>{target.description}</p>
          </div>
          <button ref={closeRef} className="close" onClick={onClose} aria-label="Close details">×</button>
        </header>

        <div className="body">
          <div>
            <label className="field-label" htmlFor="source-select">Source column</label>
            <select id="source-select" className="select" value={mapping.source ?? ""} onChange={(e) => onChangeSource(e.target.value || null)}>
              <option value="">Not mapped</option>
              {columns.map((c) => <option key={c.name} value={c.name}>{c.name} ({c.inferredType})</option>)}
            </select>
            {col && <div className="samples">{col.samples.map((s) => <span key={s}>{s}</span>)}</div>}
          </div>

          {mapping.source && (
            <div>
              <span className="field-label">Cleanup steps, in order</span>
              {mapping.transforms.length ? (
                <div className="pipeline">
                  {mapping.transforms.map((t, i) => (
                    <span key={`${i}-${t.op}`} style={{ display: "contents" }}>
                      {i > 0 && <span className="pipe-arrow" aria-hidden="true">›</span>}
                      <span className="op">{opLabel(t)}<button onClick={() => onRemoveOp(i)} aria-label={`Remove ${t.op}`}>×</button></span>
                    </span>
                  ))}
                </div>
              ) : <span className="muted" style={{ fontSize: 14 }}>Values are copied as they are.</span>}
              {enumMaps.map((t, i) => (
                <table className="enum-table" key={i}>
                  <tbody>{Object.entries(t.map).map(([k, v]) => <tr key={k}><td>{k}</td><td>{v}</td></tr>)}</tbody>
                </table>
              ))}
            </div>
          )}

          {mapping.source && (
            <div>
              <span className="field-label">Why this was suggested</span>
              <div className="rationale">
                {mapping.rationale}
                <div style={{ display: "flex", justifyContent: "space-between", marginTop: 10, fontSize: 13 }}>
                  <span style={{ color: toneVar(mapping.confidence), fontWeight: 600 }}>{TONE_COPY[confTone(mapping.confidence)]}</span>
                  <span>Suggested by {BY[mapping.suggestedBy]}</span>
                </div>
                <div className="meter"><i style={{ width: `${mapping.confidence * 100}%`, background: toneVar(mapping.confidence) }} /></div>
              </div>
            </div>
          )}
        </div>

        <footer>
          <button className={`btn ${mapping.approved ? "" : "primary"}`} onClick={onToggleApprove} disabled={!mapping.source}>
            {mapping.approved ? "Remove approval" : "Approve mapping"}
          </button>
          {mapping.approved && <span style={{ color: "var(--high)", fontWeight: 600, fontSize: 14 }}>Approved</span>}
        </footer>
      </aside>
    </>
  );
}
