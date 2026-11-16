"use client";

export type Engine = "offline" | "hosted" | "byok";

interface Props {
  engine: Engine;
  onChange: (e: Engine) => void;
  hostedAi: boolean;
  hostedNote: string;
  byokKey: string;
  onKeyChange: (k: string) => void;
  shareSamples: boolean;
  onShareSamples: (v: boolean) => void;
}

export function EnginePicker({ engine, onChange, hostedAi, hostedNote, byokKey, onKeyChange, shareSamples, onShareSamples }: Props) {
  const options: { id: Engine; title: string; sub: string }[] = [
    { id: "offline", title: "Offline", sub: "Free and private. No network calls." },
    ...(hostedAi ? [{ id: "hosted" as const, title: "AI, server key", sub: hostedNote }] : []),
    { id: "byok", title: "AI, your key", sub: "Any file. Billed to your Anthropic account." },
  ];
  const index = Math.max(0, options.findIndex((o) => o.id === engine));
  const n = options.length;

  return (
    <div>
      <div className="engine-label" id="engine-label">How should columns be matched?</div>
      <div className="segmented" role="radiogroup" aria-labelledby="engine-label">
        <span className="thumb" style={{ left: `calc(4px + (100% - 8px) * ${index} / ${n})`, width: `calc((100% - 8px) / ${n})` }} aria-hidden="true" />
        {options.map((o) => (
          <label key={o.id}>
            <input type="radio" name="engine" value={o.id} checked={engine === o.id} onChange={() => onChange(o.id)} />
            <span className="seg-title">{o.title}</span>
            <span className="seg-sub">{o.sub}</span>
          </label>
        ))}
      </div>

      <div className="reveal" data-open={engine === "byok"}>
        <div>
          <div className="key-row">
            <label className="sr-only" htmlFor="byok">Your Anthropic API key</label>
            <input id="byok" type="password" className="key-input" placeholder="sk-ant-…" autoComplete="off" spellCheck={false}
              value={byokKey} onChange={(e) => onKeyChange(e.target.value)} tabIndex={engine === "byok" ? 0 : -1} />
            <small>Kept in this tab only and sent with each AI request. Never saved or logged.</small>
          </div>
        </div>
      </div>

      {engine !== "offline" && (
        <label className="check">
          <input type="checkbox" checked={shareSamples} onChange={(e) => onShareSamples(e.target.checked)} />
          <span>Send real sample values to the AI. When off, it only sees their shape, like a***@a***.com.</span>
        </label>
      )}
    </div>
  );
}
