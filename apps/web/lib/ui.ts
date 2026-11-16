import { useEffect, useRef, useState } from "react";
import type { Transform } from "@fieldkit/core";

export type TargetFieldInfo = { name: string; description: string; required: boolean; type: string };

export function confTone(c: number): "high" | "mid" | "low" {
  return c >= 0.8 ? "high" : c >= 0.5 ? "mid" : "low";
}
export const toneVar = (c: number) => `var(--${confTone(c)})`;

export function opLabel(t: Transform): string {
  switch (t.op) {
    case "splitName": return `splitName(${t.part})`;
    case "normalizePhone": return `normalizePhone(+${t.defaultCountryCode})`;
    case "default": return `default("${t.value}")`;
    case "enumMap": return `enumMap(${Object.keys(t.map).length} values)`;
    default: return t.op;
  }
}

export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Animates a number toward its target. Restarts from the previous value when the target changes. */
export function useCountUp(target: number, duration = 900): number {
  const [value, setValue] = useState(target);
  const from = useRef(target);
  useEffect(() => {
    if (prefersReducedMotion()) { setValue(target); from.current = target; return; }
    const start = performance.now();
    const origin = from.current;
    let raf = 0;
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setValue(Math.round(origin + (target - origin) * eased));
      if (t < 1) raf = requestAnimationFrame(step);
      else from.current = target;
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);
  return value;
}
