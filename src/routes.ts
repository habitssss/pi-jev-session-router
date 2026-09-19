import { getSupportedThinkingLevels, type Api, type Model } from "@earendil-works/pi-ai";
import type { Candidate, Thinking } from "./config.ts";

export interface Route {
  id: string;
  model: Model<Api>;
  thinking: Thinking;
  description: string;
  preference: number;
}
export interface Scope { model: Model<Api>; thinkingLevel?: Thinking }
export function eligibleRoutes(candidates: Candidate[], available: Model<Api>[], scoped: readonly Scope[], hasImages: boolean): Route[] {
  const routes: Route[] = [];
  for (const [preference, candidate] of candidates.entries()) {
    const model = available.find((m) => m.provider === candidate.provider && m.id === candidate.model);
    if (!model || (hasImages && !model.input.includes("image"))) continue;
    const scope = scoped.find((s) => s.model.provider === model.provider && s.model.id === model.id);
    if (scoped.length && !scope) continue;
    const supported = getSupportedThinkingLevels(model);
    for (const thinking of candidate.thinking) {
      if (!supported.includes(thinking) || (scope?.thinkingLevel && scope.thinkingLevel !== thinking)) continue;
      routes.push({ id: `route_${routes.length}`, model, thinking, description: candidate.description, preference });
    }
  }
  return routes;
}
export const EFFORT: Record<Thinking, string> = {
  off: "No deliberate reasoning: direct answers or mechanical edits with fully specified steps.",
  minimal: "Very brief reasoning: simple localized tasks with obvious solutions.",
  low: "Light reasoning: routine implementation or explanation with a small number of decisions.",
  medium: "Moderate reasoning: multi-step changes, tests, or debugging with several interacting constraints.",
  high: "Deep reasoning: difficult debugging, architecture trade-offs, subtle correctness or security concerns.",
  xhigh: "Extra-deep reasoning: complex cross-module problems requiring extensive comparison and verification.",
  max: "Maximum reasoning: exceptionally difficult, high-stakes problems where extra latency is acceptable.",
};
