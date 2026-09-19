import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { isObject, isThinking, type Thinking } from "./config.ts";
import type { Decision } from "./typesafe.ts";

export const ENTRY = "pi-typesafe-router/state";
export interface Selection { provider: string; model: string; thinking: Thinking }
export interface State {
  version: 1;
  sessionId: string;
  phase: "off" | "ready" | "pinned" | "retained" | "manual";
  selection?: Selection;
  note: string;
  decision?: Decision;
}
export function restoreState(entries: SessionEntry[], sessionId: string): State | undefined {
  for (const entry of [...entries].reverse()) {
    if (entry.type !== "custom" || entry.customType !== ENTRY || !isObject(entry.data)) continue;
    const d = entry.data;
    if (d.version !== 1 || d.sessionId !== sessionId || !["off", "ready", "pinned", "retained", "manual"].includes(String(d.phase)) || typeof d.note !== "string") continue;
    const selection = d.selection;
    if (selection !== undefined && (!isObject(selection) || typeof selection.provider !== "string" || typeof selection.model !== "string" || !isThinking(selection.thinking))) continue;
    return d as unknown as State;
  }
  return undefined;
}
export function sameSelection(a: Selection | undefined, b: Selection | undefined): boolean {
  return a?.provider === b?.provider && a?.model === b?.model && a?.thinking === b?.thinking;
}
