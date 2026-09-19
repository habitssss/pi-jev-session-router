import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { answer, configuration, harness, large, small } from "./helpers.ts";

function setup(t: TestContext, config: unknown = configuration) {
  const dir = mkdtempSync(join(tmpdir(), "ts-router-lifecycle-"));
  const previousDir = process.env.PI_CODING_AGENT_DIR;
  const previousKey = process.env.TYPESAFE_API_KEY;
  process.env.PI_CODING_AGENT_DIR = dir;
  process.env.TYPESAFE_API_KEY = "test-only-key";
  const path = join(dir, "pi-typesafe-router.json");
  writeFileSync(path, JSON.stringify(config));
  t.after(() => {
    if (previousDir === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previousDir;
    if (previousKey === undefined) delete process.env.TYPESAFE_API_KEY; else process.env.TYPESAFE_API_KEY = previousKey;
    rmSync(dir, { recursive: true, force: true });
  });
  let calls = 0;
  const http = t.mock.method(globalThis, "fetch", async (_url: string, init: RequestInit) => {
    calls++;
    return Response.json(answer(String(init.body)));
  });
  return { path, http, calls: () => calls };
}
function fixture(t: TestContext, config: unknown = configuration) {
  const support = setup(t, config);
  return { ...support, h: harness() };
}

test("first prompt sets model and effort; later prompts and tool turns never reroute", async (t) => {
  const { h, calls } = fixture(t);
  await h.start();
  assert.equal(h.state.phase, "ready");
  assert.equal((await h.input()).action, "continue");
  assert.equal(h.current.id, "large");
  assert.equal(h.thinking, "high");
  assert.equal(h.state.phase, "pinned");
  await h.input("接着改一下文案");
  await h.emit("turn_start");
  await h.emit("session_compact");
  await h.input("再做一个更难的任务");
  assert.equal(calls(), 1);
  assert.deepEqual(h.changes, ["model:large", "thinking:high"]);
  assert.ok(!JSON.stringify(h.entries).includes("排查复杂"));
  assert.ok(!JSON.stringify(h.entries).includes("test-only-key"));
});

test("can select a different effort without switching models", async (t) => {
  const { h, http } = fixture(t);
  http.mock.mockImplementation(async (_url: string, init: RequestInit) => Response.json(answer(String(init.body), "route_1")));
  await h.start();
  await h.input();
  assert.equal(h.current.id, "small");
  assert.equal(h.thinking, "high");
  assert.deepEqual(h.changes, ["thinking:high"]);
});

test("reload/resume preserves pin; new session and fork discard inherited router state", async (t) => {
  const { h, calls } = fixture(t);
  await h.start(); await h.input();
  await h.start("reload"); await h.input();
  await h.start("resume"); await h.input();
  assert.equal(calls(), 1);
  h.setSessionId("child");
  await h.start("fork");
  assert.equal(h.state.phase, "ready");
  await h.start("reload");
  assert.equal(h.state.phase, "ready");
  await h.input("新任务");
  assert.equal(calls(), 2);
  h.setSessionId("new");
  await h.start("new"); await h.input();
  assert.equal(calls(), 3);
});

test("manual model and thinking changes win and survive reload", async (t) => {
  const { h, calls } = fixture(t);
  await h.start(); await h.input();
  await h.api.setModel(small);
  h.api.setThinkingLevel("medium");
  assert.equal(h.state.phase, "manual");
  await h.start("reload"); await h.input();
  assert.equal(h.current.id, "small");
  assert.equal(h.thinking, "medium");
  assert.equal(calls(), 1);
});

test("manual selection before first prompt suppresses automatic routing", async (t) => {
  const { h, calls } = fixture(t);
  await h.start();
  await h.api.setModel(large);
  await h.input();
  assert.equal(h.state.phase, "manual");
  assert.equal(calls(), 0);
});

test("existing conversations are not reclassified on installation/resume", async (t) => {
  const { h, calls } = fixture(t);
  h.entries.push({ type: "message", id: "u", parentId: null, timestamp: "now", message: { role: "user", content: "已有任务", timestamp: 0 } });
  await h.start("resume"); await h.input("继续");
  assert.equal(h.state.phase, "retained");
  assert.equal(calls(), 0);
});

for (const cause of ["missing-key", "no-candidates", "unavailable", "invalid-config", "disabled"]) {
  test(`${cause} sends no prompt and leaves the model alone`, async (t) => {
    const { h, calls, path } = fixture(t, cause === "no-candidates" ? { enabled: true } : cause === "disabled" ? {} : configuration);
    if (cause === "missing-key") delete process.env.TYPESAFE_API_KEY;
    if (cause === "unavailable") h.setAvailable([]);
    if (cause === "invalid-config") writeFileSync(path, "invalid");
    await h.start(); await h.input(); await h.input();
    assert.equal(calls(), 0);
    assert.equal(h.current.id, "small");
    assert.deepEqual(h.changes, []);
  });
}

for (const failure of ["http", "low-confidence", "stay", "switch-failed", "removed-target"]) {
  test(`${failure} retains current selection and never automatically retries`, async (t) => {
    const { h, http } = fixture(t);
    let attempts = 0;
    http.mock.mockImplementation(async (_url: string, init: RequestInit) => {
      attempts++;
      if (failure === "removed-target") h.setAvailable([small]);
      if (failure === "http") return new Response("private prompt", { status: 401 });
      return Response.json(answer(String(init.body), failure === "stay" ? "stay" : "route_3", failure === "low-confidence" ? 0.1 : 0.9));
    });
    if (failure === "switch-failed") h.failSwitch();
    await h.start(); await h.input(); await h.input();
    assert.equal(attempts, 1);
    assert.equal(h.current.id, "small");
    assert.equal(h.state.phase, "retained");
    assert.ok(!h.messages.join(" ").includes("private prompt"));
  });
}

test("model override during setModel does not receive the stale route's thinking level", async (t) => {
  const { h } = fixture(t);
  const original = h.api.setModel;
  t.mock.method(h.api, "setModel", async (selected: Parameters<typeof h.api.setModel>[0]) => {
    await original(selected);
    await original(small);
    return true;
  });
  await h.start(); await h.input();
  assert.equal(h.state.phase, "manual");
  assert.equal(h.current.id, "small");
  assert.equal(h.thinking, "low");
});

test("off is durable; on explicitly rearms after failures/config updates", async (t) => {
  const { h, calls } = fixture(t);
  await h.start();
  await h.command("off"); await h.start("reload"); await h.input();
  assert.equal(calls(), 0);
  await h.command("on"); await h.input();
  assert.equal(calls(), 1);
  await h.command("status");
  assert.ok(h.messages.at(-1)?.includes("123"));
  assert.ok(!h.messages.join(" ").includes("test-only-key"));
});

test("slash templates and extension-injected first prompts do not leak or trigger later mid-session routing", async (t) => {
  const { h, calls } = fixture(t);
  await h.start(); await h.input("/skill:private confidential-args"); await h.input();
  assert.equal(calls(), 0);
  await h.start("new"); await h.input("internal task", { source: "extension" }); await h.input();
  assert.equal(calls(), 0);
});

test("queued/steering input and empty input do not consume a routing attempt", async (t) => {
  const { h, calls } = fixture(t);
  await h.start(); await h.input(" "); await h.input("continue", { streamingBehavior: "steer" });
  assert.equal(calls(), 0);
  assert.equal(h.state.phase, "ready");
});

test("cancellation prevents stale decisions and suppresses the cancelled prompt", async (t) => {
  const { h, http } = fixture(t);
  let resolve!: (response: Response) => void;
  let body = "";
  http.mock.mockImplementation((_url: string, init: RequestInit) => {
    body = String(init.body);
    return new Promise<Response>((r) => { resolve = r; });
  });
  await h.start();
  const request = h.input();
  await h.command("off");
  resolve(Response.json(answer(body)));
  assert.equal((await request).action, "handled");
  assert.equal(h.state.phase, "off");
  assert.deepEqual(h.changes, []);
});

test("reload during a pending attempt retains the durable marker instead of rebilling", async (t) => {
  const { h, http } = fixture(t);
  let resolve!: (response: Response) => void;
  let body = "";
  let attempts = 0;
  http.mock.mockImplementation((_url: string, init: RequestInit) => {
    attempts++;
    body = String(init.body);
    return new Promise<Response>((r) => { resolve = r; });
  });
  await h.start();
  const request = h.input();
  assert.equal(h.state.phase, "retained");
  await h.start("reload");
  resolve(Response.json(answer(body)));
  assert.equal((await request).action, "handled");
  await h.input();
  assert.equal(attempts, 1);
  assert.equal(h.state.phase, "retained");
});

test("manual override during classification wins", async (t) => {
  const { h, http } = fixture(t);
  let resolve!: (response: Response) => void;
  let body = "";
  http.mock.mockImplementation((_url: string, init: RequestInit) => {
    body = String(init.body);
    return new Promise<Response>((r) => { resolve = r; });
  });
  await h.start();
  const request = h.input();
  h.api.setThinkingLevel("medium");
  resolve(Response.json(answer(body)));
  assert.equal((await request).action, "handled");
  assert.equal(h.thinking, "medium");
  assert.equal(h.state.phase, "manual");
});

test("only one first-prompt classification may run concurrently", async (t) => {
  const { h, http } = fixture(t);
  let resolve!: (response: Response) => void;
  let body = "";
  http.mock.mockImplementation((_url: string, init: RequestInit) => {
    body = String(init.body);
    return new Promise<Response>((r) => { resolve = r; });
  });
  await h.start();
  const first = h.input();
  assert.equal((await h.input("second")).action, "handled");
  resolve(Response.json(answer(body)));
  assert.equal((await first).action, "continue");
  assert.equal(h.state.phase, "pinned");
});
