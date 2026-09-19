import type { Api, Model } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext, SessionEntry } from "@earendil-works/pi-coding-agent";
import extension from "../src/index.ts";
import { ENTRY, type State } from "../src/state.ts";
import type { Thinking } from "../src/config.ts";

export function model(id: string, reasoning = true, image = true): Model<Api> {
  return {
    id, name: id, provider: "test", api: "openai-completions", baseUrl: "http://127.0.0.1:1/v1", reasoning,
    input: image ? ["text", "image"] : ["text"], contextWindow: 128000, maxTokens: 16000,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  };
}
export const small = model("small");
export const large = model("large");
export const configuration = {
  enabled: true,
  candidates: [
    { provider: "test", model: "small", description: "Routine edits", thinking: ["low", "high"] },
    { provider: "test", model: "large", description: "Complex reasoning", thinking: ["medium", "high"] },
  ],
};
export function answer(body: string, choice = "route_3", confidence = 0.9) {
  const keys = Object.keys(JSON.parse(body).questions.route.criteria);
  return {
    model: "jev-latest",
    answers: { route: { type: "choice", choice, confidence, probabilities: Object.fromEntries(keys.map((k) => [k, k === choice ? 1 : 0])) } },
    usage: { input_tokens: 123, output_tokens: 12 },
  };
}
// Event plumbing is mocked here; sdk.test.ts separately exercises real Pi loading and prompting.
export function harness() {
  const handlers = new Map<string, (event: any, ctx: any) => any>();
  const commands = new Map<string, any>();
  const entries: SessionEntry[] = [];
  const messages: string[] = [];
  const changes: string[] = [];
  let currentModel = small;
  let thinking: Thinking = "low";
  let sessionId = "session-a";
  let available = [small, large];
  let failSwitch = false;
  let nextId = 0;
  const ctx = {
    hasUI: true, mode: "tui", cwd: "/tmp",
    get model() { return currentModel; },
    get thinkingLevel() { return thinking; },
    scopedModels: [],
    isIdle: () => true,
    modelRegistry: { getAvailable: () => available },
    sessionManager: {
      getSessionId: () => sessionId,
      getBranch: () => [...entries],
      buildContextEntries: () => [...entries],
    },
    ui: { notify: (text: string) => messages.push(text), setStatus: () => {}, confirm: async () => true },
  } as unknown as ExtensionContext;
  const api = {
    on: (name: string, handler: (event: any, ctx: any) => any) => handlers.set(name, handler),
    registerCommand: (name: string, command: any) => commands.set(name, command),
    getThinkingLevel: () => thinking,
    appendEntry: (customType: string, data: State) => entries.push({ type: "custom", customType, data: structuredClone(data), id: String(++nextId), parentId: entries.at(-1)?.id ?? null, timestamp: new Date().toISOString() }),
    setModel: async (value: Model<Api>) => {
      if (failSwitch) return false;
      const previousModel = currentModel;
      currentModel = value;
      changes.push(`model:${value.id}`);
      await handlers.get("model_select")?.({ model: value, previousModel, source: "set" }, ctx);
      return true;
    },
    setThinkingLevel: (value: Thinking) => {
      const previousLevel = thinking;
      thinking = value;
      changes.push(`thinking:${value}`);
      handlers.get("thinking_level_select")?.({ level: value, previousLevel }, ctx);
    },
  } as unknown as ExtensionAPI;
  extension(api);
  return {
    api, ctx, entries, messages, changes,
    emit: async (name: string, event: any = {}) => handlers.get(name)?.(event, ctx),
    start: async (reason = "startup") => handlers.get("session_start")?.({ reason }, ctx),
    input: async (text = "排查复杂的并发问题", extra: object = {}) => handlers.get("input")?.({ text, source: "interactive", ...extra }, ctx),
    command: async (args: string) => commands.get("ts-router").handler(args, ctx),
    setAvailable: (models: Model<Api>[]) => { available = models; },
    failSwitch: () => { failSwitch = true; },
    setSessionId: (id: string) => { sessionId = id; },
    get current() { return currentModel; },
    get thinking() { return thinking; },
    get state(): State { return (entries.filter((e) => e.type === "custom" && e.customType === ENTRY).at(-1) as any)?.data; },
  };
}
