"use client";

import { useCallback, useLayoutEffect, useRef, useState } from "react";
import type { FieldMapping, FieldProfile } from "@fieldkit/core";
import { toneVar, type TargetFieldInfo } from "@/lib/ui";

type Geo = { w: number; h: number; x1: number; x2: number; src: Record<string, number>; tgt: Record<string, number> };
type Hover = { kind: "src" | "tgt"; name: string } | null;

interface Props {
  columns: FieldProfile[];
  targetFields: TargetFieldInfo[];
  fields: FieldMapping[];
  selected: string | null;
  /** Changes whenever a fresh suggestion arrives; remounts the wires so they draw in again. */
  drawKey: string;
  onSelect: (target: string) => void;
  onToggleApprove: (target: string) => void;
}

const TYPE_LABEL: Record<string, string> = { string: "text", number: "number", boolean: "yes/no", date: "date", email: "email", phone: "phone", empty: "empty" };

export function MappingCanvas({ columns, targetFields, fields, selected, drawKey, onSelect, onToggleApprove }: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const srcEls = useRef(new Map<string, HTMLElement>());
  const tgtEls = useRef(new Map<string, HTMLElement>());
  const [geo, setGeo] = useState<Geo | null>(null);
  const [hover, setHover] = useState<Hover>(null);

  const measure = useCallback(() => {
    const el = wrap.current;
    if (!el) return;
    const box = el.getBoundingClientRect();
    const g: Geo = { w: box.width, h: box.height, x1: 0, x2: box.width, src: {}, tgt: {} };
    srcEls.current.forEach((node, key) => {
      const r = node.getBoundingClientRect();
      g.src[key] = r.top - box.top + r.height / 2;
      g.x1 = r.right - box.left;
    });
    tgtEls.current.forEach((node, key) => {
      const r = node.getBoundingClientRect();
      g.tgt[key] = r.top - box.top + r.height / 2;
      g.x2 = r.left - box.left;
    });
    setGeo(g);
  }, []);

  useLayoutEffect(() => {
    measure();
    const ro = new ResizeObserver(measure);
    if (wrap.current) ro.observe(wrap.current);
    return () => ro.disconnect();
  }, [measure, columns, targetFields]);

  const byTarget = new Map(fields.map((f) => [f.target, f]));
  const usedSources = new Set(fields.map((f) => f.source).filter(Boolean) as string[]);
  const focus: Hover = hover ?? (selected ? { kind: "tgt", name: selected } : null);
  const isHotField = (f: FieldMapping) => !!focus && (focus.kind === "tgt" ? f.target === focus.name : f.source === focus.name);
  const hotSources = new Set(fields.filter(isHotField).map((f) => f.source));
  const hotTargets = new Set(fields.filter(isHotField).map((f) => f.target));
  if (focus?.kind === "src") hotSources.add(focus.name);
  if (focus?.kind === "tgt") hotTargets.add(focus.name);

  const wires = geo
    ? fields
        .filter((f) => f.source && geo.src[f.source] !== undefined && geo.tgt[f.target] !== undefined)
        .map((f) => {
          const y1 = geo.src[f.source!]!;
          const y2 = geo.tgt[f.target]!;
          const mid = (geo.x1 + geo.x2) / 2;
          return { f, y1, y2, d: `M ${geo.x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${geo.x2} ${y2}` };
        })
    : [];

  return (
    <div className="canvas" ref={wrap} data-focus={focus ? "" : undefined} onPointerLeave={() => setHover(null)}>
      {geo && (
        <svg className="wires" width={geo.w} height={geo.h} viewBox={`0 0 ${geo.w} ${geo.h}`} aria-hidden="true">
          <g key={drawKey}>
            {wires.map(({ f, y1, y2, d }, i) => {
              const hot = isHotField(f) ? "" : undefined;
              const color = f.approved ? "var(--ink)" : toneVar(f.confidence);
              const delay = { animationDelay: `${120 + i * 70}ms` };
              return (
                <g key={`${f.target}:${f.source}`}>
                  <path className="wire draw" d={d} pathLength={1} stroke={color} data-approved={f.approved} data-hot={hot} style={delay} />
                  <circle className="node draw" cx={geo.x1} cy={y1} r={3.5} fill={color} data-hot={hot} style={delay} />
                  <circle className="node draw" cx={geo.x2} cy={y2} r={3.5} fill={color} data-hot={hot} style={{ animationDelay: `${520 + i * 70}ms` }} />
                </g>
              );
            })}
          </g>
        </svg>
      )}

      <div className="canvas-col sources">
        <div className="col-head"><span>Their columns</span><span>{columns.length}</span></div>
        {columns.map((c) => (
          <div
            key={c.name}
            className="src"
            ref={(el) => { if (el) srcEls.current.set(c.name, el); else srcEls.current.delete(c.name); }}
            data-idle={!usedSources.has(c.name)}
            data-hot={hotSources.has(c.name) ? "" : undefined}
            onPointerEnter={(e) => e.pointerType === "mouse" && setHover({ kind: "src", name: c.name })}
            title={usedSources.has(c.name) ? undefined : "Not used by any field"}
          >
            <span className="name">{c.name}</span>
            <span className="type">{TYPE_LABEL[c.inferredType] ?? c.inferredType}</span>
            <span className="sample">{c.samples[0] ?? "no values"}</span>
            {c.fillRate < 0.995 && <span className="gaps">{Math.round((1 - c.fillRate) * 100)}% blank</span>}
          </div>
        ))}
      </div>

      <div className="canvas-gutter" aria-hidden="true" />

      <div className="canvas-col">
        <div className="col-head"><span>Your schema</span><span>{fields.filter((f) => f.approved).length} of {targetFields.length} approved</span></div>
        {targetFields.map((t) => {
          const m = byTarget.get(t.name)!;
          const ops = m.transforms.map((x) => x.op).join(", ");
          return (
            <div
              key={t.name}
              role="button"
              tabIndex={0}
              className="tgt"
              aria-pressed={selected === t.name}
              aria-label={`${t.name}${t.required ? ", required" : ""}: ${m.source ? `from ${m.source}` : "unmapped"}. Open details.`}
              ref={(el) => { if (el) tgtEls.current.set(t.name, el); else tgtEls.current.delete(t.name); }}
              data-unmapped={!m.source}
              data-hot={hotTargets.has(t.name) ? "" : undefined}
              onPointerEnter={(e) => e.pointerType === "mouse" && setHover({ kind: "tgt", name: t.name })}
              onClick={() => onSelect(t.name)}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(t.name); } }}
            >
              <span className="name">{t.name}{t.required && <span className="req" title="Required">*</span>}</span>
              <span className="conf" style={{ color: m.source ? toneVar(m.confidence) : "var(--ink-3)" }}>{m.source ? `${Math.round(m.confidence * 100)}%` : "–"}</span>
              <button
                type="button"
                role="checkbox"
                className="approve"
                aria-checked={m.approved}
                aria-label={`Approve ${t.name}`}
                disabled={!m.source}
                onClick={(e) => { e.stopPropagation(); onToggleApprove(t.name); }}
                onKeyDown={(e) => e.stopPropagation()}
              >
                <svg viewBox="0 0 16 16"><path d="M3.5 8.5l3 3 6-7" /></svg>
              </button>
              <span className="from">{m.source ? `from ${m.source}` : ""}</span>
              <span className="ops">{m.source ? ops || "no cleanup" : "Needs a source column"}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function EmptyCanvas() {
  const ys = [30, 70, 110, 150];
  return (
    <div className="empty-canvas">
      <svg viewBox="0 0 420 180" aria-hidden="true">
        {ys.map((y, i) => (
          <g key={y}>
            <rect x="8" y={y - 13} width="120" height="26" rx="7" fill="var(--paper)" />
            <rect x="292" y={ys[(i + 1) % 4]! - 13} width="120" height="26" rx="7" fill="none" stroke="var(--rule)" />
            <path className="ghost-wire" d={`M 128 ${y} C 210 ${y}, 210 ${ys[(i + 1) % 4]}, 292 ${ys[(i + 1) % 4]}`} />
          </g>
        ))}
      </svg>
      <h3>Nothing to map yet</h3>
      <p>Drop a CSV or load the sample export. Suggested connections appear here for you to review.</p>
    </div>
  );
}
