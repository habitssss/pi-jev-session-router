import { readFileSync } from "node:fs";
import type { ModelThinkingLevel } from "@earendil-works/pi-ai";

export const LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
export type Thinking = ModelThinkingLevel;
export interface Candidate {
  provider: string;
  model: string;
  description: string;
  thinking: Thinking[];
}
export interface Config {
  enabled: boolean;
  model: string;
  timeoutMs: number;
  minConfidence: number;
  candidates: Candidate[];
}
export function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
export function isThinking(value: unknown): value is Thinking {
  return typeof value === "string" && LEVELS.includes(value as Thinking);
}
function text(value: unknown, name: string, max = 200): string {
  if (typeof value !== "string" || !value.trim() || value.length > max || /[\x00-\x1f\x7f]/.test(value)) {
    throw new Error(`Invalid ${name}`);
  }
  return value.trim();
}
function keys(value: Record<string, unknown>, allowed: string[], name: string): void {
  if (Object.keys(value).some((key) => !allowed.includes(key))) throw new Error(`Unknown field in ${name}`);
}
export function parseConfig(value: unknown): Config {
  if (!isObject(value)) throw new Error("Config must be an object");
  keys(value, ["enabled", "model", "timeoutMs", "minConfidence", "candidates"], "config");
  const enabled = value.enabled ?? false;
  const timeoutMs = value.timeoutMs ?? 5000;
  const minConfidence = value.minConfidence ?? 0.3;
  const rawCandidates = value.candidates ?? [];
  if (typeof enabled !== "boolean") throw new Error("enabled must be a boolean");
  if (typeof timeoutMs !== "number" || !Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 30000) {
    throw new Error("timeoutMs must be an integer from 100 to 30000");
  }
  if (typeof minConfidence !== "number" || !Number.isFinite(minConfidence) || minConfidence < 0 || minConfidence > 1) {
    throw new Error("minConfidence must be between 0 and 1");
  }
  if (!Array.isArray(rawCandidates) || rawCandidates.length > 20) throw new Error("candidates must be an array of at most 20 models");
  const seen = new Set<string>();
  const candidates = rawCandidates.map((item): Candidate => {
    if (!isObject(item)) throw new Error("Invalid candidate");
    keys(item, ["provider", "model", "description", "thinking"], "candidate");
    const provider = text(item.provider, "provider");
    const model = text(item.model, "model");
    const description = text(item.description, "description", 1500);
    const id = `${provider}\0${model}`;
    if (seen.has(id)) throw new Error("Duplicate candidate model; put its thinking levels in one entry");
    seen.add(id);
    if (!Array.isArray(item.thinking) || item.thinking.length === 0 || !item.thinking.every(isThinking) || new Set(item.thinking).size !== item.thinking.length) {
      throw new Error("thinking must be a non-empty list of distinct Pi thinking levels");
    }
    return { provider, model, description, thinking: item.thinking };
  });
  return { enabled, model: text(value.model ?? "jev-latest", "TypeSafe model"), timeoutMs, minConfidence, candidates };
}
export function loadConfig(path: string): Config {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return parseConfig({});
    throw new Error("Cannot read router config");
  }
  if (Buffer.byteLength(raw) > 64000) throw new Error("Router config is too large");
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { throw new Error("Router config is not valid JSON"); }
  return parseConfig(parsed);
}
