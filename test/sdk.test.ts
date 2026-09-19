import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createAssistantMessageEventStream, InMemoryCredentialStore, type AssistantMessage, type Api, type Model, type Context, type SimpleStreamOptions } from "@earendil-works/pi-ai";
import { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager, type AgentSession } from "@earendil-works/pi-coding-agent";
import { answer, configuration } from "./helpers.ts";
import { ENDPOINT } from "../src/typesafe.ts";
import { ENTRY } from "../src/state.ts";

test("real Pi SDK: load TS extension, route before generation, persist and resume without reclassification", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "ts-router-sdk-"));
  const previousDir = process.env.PI_CODING_AGENT_DIR;
  const previousKey = process.env.TYPESAFE_API_KEY;
  process.env.PI_CODING_AGENT_DIR = dir;
  process.env.TYPESAFE_API_KEY = "test-only-key";
  const sessions: AgentSession[] = [];
  t.after(() => {
    for (const session of sessions) session.dispose();
    if (previousDir === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previousDir;
    if (previousKey === undefined) delete process.env.TYPESAFE_API_KEY; else process.env.TYPESAFE_API_KEY = previousKey;
    rmSync(dir, { recursive: true, force: true });
  });
  writeFileSync(join(dir, "pi-typesafe-router.json"), JSON.stringify(configuration));
  writeFileSync(join(dir, "models.json"), JSON.stringify({ providers: { test: {
    api: "openai-completions", baseUrl: "http://127.0.0.1:1/v1", apiKey: "test-only-key",
    models: ["small", "large"].map((id) => ({ id, reasoning: true, input: ["text", "image"] })),
  } } }));
  let classifications = 0;
  t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    assert.equal(url, ENDPOINT, "no real network or generation request is permitted");
    classifications++;
    return Response.json(answer(String(init.body)));
  });
  const runtime = await ModelRuntime.create({
    credentials: new InMemoryCredentialStore(),
    modelsPath: join(dir, "models.json"),
    modelsStorePath: join(dir, "models-store.json"),
    allowModelNetwork: false,
  });
  const generated: string[] = [];
  const streamSimple = (selected: Model<Api>, _context: Context, options?: SimpleStreamOptions) => {
    generated.push(`${selected.provider}/${selected.id}:${options?.reasoning ?? "off"}`);
    const stream = createAssistantMessageEventStream();
    const message: AssistantMessage = {
      role: "assistant", content: [{ type: "text", text: "mock completion" }],
      api: selected.api, provider: selected.provider, model: selected.id, timestamp: Date.now(), stopReason: "stop",
      usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    };
    stream.push({ type: "done", reason: "stop", message });
    stream.end();
    return stream;
  };
  async function create(sm: SessionManager, first: boolean) {
    const settings = SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } });
    const loader = new DefaultResourceLoader({
      cwd: dir, agentDir: dir, settingsManager: settings,
      additionalExtensionPaths: [resolve("src/index.ts")],
      extensionFactories: [(pi) => pi.registerProvider("test", {
        api: "openai-completions", baseUrl: "http://127.0.0.1:1/v1", apiKey: "test-only-key",
        models: ["small", "large"].map((id) => ({ id, name: id, reasoning: true, input: ["text", "image"], contextWindow: 128000, maxTokens: 16000, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } })),
        streamSimple,
      })],
      noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
    });
    await loader.reload();
    assert.deepEqual(loader.getExtensions().errors, []);
    const { session } = await createAgentSession({
      cwd: dir, agentDir: dir, resourceLoader: loader, modelRuntime: runtime,
      sessionManager: sm, settingsManager: settings,
      ...(first ? { model: runtime.getModel("test", "small"), thinkingLevel: "low" as const } : {}),
      noTools: "all",
    });
    sessions.push(session);
    const errors: string[] = [];
    await session.bindExtensions({ mode: "print", onError: (error) => errors.push(error.error) });
    return { session, errors };
  }
  const sm = SessionManager.create(dir, join(dir, "sessions"));
  const first = await create(sm, true);
  await first.session.prompt("设计一个有并发约束的调度器");
  await first.session.prompt("接下来只修改标题");
  assert.deepEqual(first.errors, []);
  assert.equal(classifications, 1);
  assert.deepEqual(generated, ["test/large:high", "test/large:high"]);
  assert.equal(first.session.model?.id, "large");
  assert.equal(first.session.thinkingLevel, "high");
  assert.ok(sm.getBranch().some((entry) => entry.type === "custom" && entry.customType === ENTRY));
  const file = sm.getSessionFile();
  assert.ok(file);
  first.session.dispose();
  const resumed = await create(SessionManager.open(file), false);
  await resumed.session.prompt("继续");
  assert.equal(classifications, 1);
  assert.equal(generated.at(-1), "test/large:high");
  assert.deepEqual(resumed.errors, []);
  await resumed.session.setModel(runtime.getModel("test", "small")!);
  resumed.session.setThinkingLevel("medium");
  await resumed.session.prompt("手动选择优先");
  assert.equal(classifications, 1);
  assert.equal(generated.at(-1), "test/small:medium");
});
