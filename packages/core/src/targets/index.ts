import type { TargetSchema } from "../types";
import { contactTarget } from "./contact";

const registry = new Map<string, TargetSchema>([[contactTarget.id, contactTarget]]);

export function getTarget(id: string): TargetSchema {
  const t = registry.get(id);
  if (!t) throw new Error(`Unknown target "${id}". Known: ${[...registry.keys()].join(", ")}`);
  return t;
}

export function listTargets(): TargetSchema[] {
  return [...registry.values()];
}

export function registerTarget(t: TargetSchema): void {
  registry.set(t.id, t);
}

export { contactTarget };
