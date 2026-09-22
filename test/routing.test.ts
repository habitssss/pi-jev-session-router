import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig, parseConfig } from "../src/config.ts";
import { eligibleRoutes } from "../src/routes.ts";
import { classify, ENDPOINT, MAX_REQUEST_BYTES, parseDecision, requestBody } from "../src/typesafe.ts";
import { restoreState } from "../src/state.ts";
import { answer, configuration, large, model, small } from "./helpers.ts";
import { routingBoundaries } from "./fixtures/routing-boundaries.ts";

const config = parseConfig(configuration);
const routes = eligibleRoutes(config.candidates, [small, large], [], false);

test("config is opt-in with no implicit model candidates", () => {
  assert.equal(parseConfig({}).enabled, false);
  assert.deepEqual(parseConfig({}).candidates, []);
  for (const value of [null, { enabled: "true" }, { apiKey: "secret" }, { baseUrl: "https://evil.invalid" }, { minConfidence: NaN }, { timeoutMs: 0 }, { candidates: [{}] }]) {
    assert.throws(() => parseConfig(value));
  }
  assert.throws(() => parseConfig({ candidates: [configuration.candidates[0], configuration.candidates[0]] }));
  assert.throws(() => parseConfig({ candidates: [{ ...configuration.candidates[0], thinking: ["ultra"] }] }));
});

test("file errors are sanitized and missing config is inert", () => {
  const dir = mkdtempSync(join(tmpdir(), "ts-router-config-"));
  try {
    const file = join(dir, "config.json");
    assert.equal(loadConfig(file).enabled, false);
    writeFileSync(file, "secret-token invalid-json");
    assert.throws(() => loadConfig(file), { message: "Router config is not valid JSON" });
    writeFileSync(file, JSON.stringify(configuration));
    assert.deepEqual(loadConfig(file), config);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("joint options include multiple effort levels on the same model", () => {
  assert.deepEqual(routes.map((r) => `${r.model.id}:${r.thinking}`), ["small:low", "small:high", "large:medium", "large:high"]);
  const req = JSON.parse(requestBody("只修复这个拼写错误", routes, "jev-latest", false));
  assert.equal(req.questions.route.type, "choice");
  assert.equal(Object.keys(req.questions).length, 1);
  assert.equal(Object.keys(req.questions.route.criteria).length, 5);
  assert.deepEqual(req.state, { task: "只修复这个拼写错误", hasImages: false });
});

test("eligibility respects auth snapshot, scoped models, scoped thinking, images and map holes", () => {
  assert.equal(eligibleRoutes(config.candidates, [], [], false).length, 0);
  assert.deepEqual(eligibleRoutes(config.candidates, [small, large], [{ model: large, thinkingLevel: "high" }], false).map((r) => r.thinking), ["high"]);
  assert.equal(eligibleRoutes(config.candidates, [model("small", false)], [], false).length, 0);
  assert.equal(eligibleRoutes(config.candidates, [model("small", true, false)], [], true).length, 0);
  const hole = { ...small, thinkingLevelMap: { low: null } };
  assert.deepEqual(eligibleRoutes(config.candidates, [hole], [], false).map((r) => r.thinking), ["high"]);
  const basic = parseConfig({ candidates: [{ ...configuration.candidates[0], thinking: ["off"] }] });
  assert.equal(eligibleRoutes(basic.candidates, [model("small", false)], [], false).length, 1);
});

test("shared policy uses supplied evidence instead of model names or escalation shortcuts", () => {
  const instructions = JSON.parse(requestBody("task", routes, "jev-latest", false)).questions.route.instructions;
  for (const rule of [
    /context or execution feedback explicitly included/,
    /supplied descriptions, not prior beliefs about model names or versions/,
    /Do not assume previous attempts or failures unless explicitly reported/,
    /Missing permissions, network failures, missing dependencies or insufficient context/,
    /not code-related keywords, prompt length, file or step counts/,
    /more capable model does not automatically require higher effort/,
    /difficult task may select a more capable candidate directly/,
    /Return only an offered model\/effort option or stay/,
  ]) assert.match(instructions, rule);
});

for (const boundary of routingBoundaries) {
  test(`boundary request preserves evidence without leaking expected labels: ${boundary.id}`, () => {
    // This checks transport, not Jev's semantic accuracy; there is no mocked verdict.
    const body = requestBody(boundary.prompt, routes, "jev-latest", false);
    const req = JSON.parse(body);
    assert.deepEqual(req.state, { task: boundary.prompt, hasImages: false });
    assert.deepEqual(req.questions, JSON.parse(requestBody("unrelated task", routes, "jev-latest", false)).questions);
    assert.equal(body.includes(boundary.rationale), false);
    assert.equal(body.includes("acceptableRoles"), false);
    assert.equal(body.includes("acceptableThinking"), false);
    assert.ok(Buffer.byteLength(body) < MAX_REQUEST_BYTES);
  });
}

test("the exact UTF-8 request limit includes JSON escaping and all routing overhead", () => {
  const prefix = "中文 \"quoted\" \\ path\n";
  const budget = MAX_REQUEST_BYTES - Buffer.byteLength(requestBody(prefix, routes, "jev-latest", false));
  const prompt = prefix + "界".repeat(Math.floor(budget / 3)) + "a".repeat(budget % 3);
  const body = requestBody(prompt, routes, "jev-latest", false);
  assert.equal(Buffer.byteLength(body), MAX_REQUEST_BYTES);
  assert.equal(JSON.parse(body).state.task, prompt);
  assert.throws(() => requestBody(prompt + "a", routes, "jev-latest", false), /28 KB/);
});

test("oversized prompts fail before any network request and are not silently truncated", async (t) => {
  const fetch = t.mock.method(globalThis, "fetch", async () => { throw new Error("Unexpected network call"); });
  await assert.rejects(classify("中".repeat(10000), routes, config, "test-only-key", false, new AbortController().signal), /28 KB/);
  assert.equal(fetch.mock.callCount(), 0);
});

test("validates closed-set choice, confidence, full probability distribution and usage", () => {
  const body = requestBody("任务", routes, "jev-latest", false);
  const valid = answer(body);
  assert.equal(parseDecision(valid, routes).choice, "route_3");
  for (const change of [
    { choice: "injected_model" }, { confidence: 2 }, { type: "score" },
    { probabilities: { route_3: 1 } },
    { probabilities: { stay: 0, route_0: 0, route_1: 0, route_2: 0, route_3: -1 } },
    { choice: "route_0" },
  ]) {
    assert.throws(() => parseDecision({ ...valid, answers: { route: { ...valid.answers.route, ...change } } }, routes));
  }
  assert.throws(() => parseDecision({ ...valid, usage: {} }, routes));
});

test("direct TypeSafe HTTP contract, secret only in header, no redirects", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    calls++;
    assert.equal(url, ENDPOINT);
    assert.equal(init.redirect, "error");
    assert.equal(new Headers(init.headers).get("authorization"), "Bearer test-only-key");
    assert.ok(!String(init.body).includes("test-only-key"));
    return Response.json(answer(String(init.body)));
  });
  const result = await classify("复杂任务", routes, config, "test-only-key", false, new AbortController().signal);
  assert.equal(result.inputTokens, 123);
  assert.equal(calls, 1);
});

for (const code of [401, 422, 429, 529]) {
  test(`HTTP ${code} never retries or leaks upstream body`, async (t) => {
    let calls = 0;
    t.mock.method(globalThis, "fetch", async () => { calls++; return new Response("secret prompt", { status: code }); });
    await assert.rejects(classify("private task", routes, config, "key", false, new AbortController().signal), new RegExp(`HTTP ${code}`));
    assert.equal(calls, 1);
  });
}

test("malformed or oversized responses are rejected", async (t) => {
  const mock = t.mock.method(globalThis, "fetch", async () => new Response("private not-json"));
  await assert.rejects(classify("x", routes, config, "key", false, new AbortController().signal), /invalid response/);
  mock.mock.mockImplementation(async () => new Response("x".repeat(65000)));
  await assert.rejects(classify("x", routes, config, "key", false, new AbortController().signal), /too large/);
});

test("timeout and caller cancellation terminate the HTTP request", async (t) => {
  t.mock.method(globalThis, "fetch", (_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
    init.signal!.addEventListener("abort", () => reject(init.signal!.reason), { once: true });
  }));
  // Keep Node alive while AbortSignal.timeout's unref'ed timer runs.
  const timer = setTimeout(() => {}, 1000);
  try {
    await assert.rejects(classify("x", routes, { ...config, timeoutMs: 100 }, "key", false, new AbortController().signal), /timed out/);
    const controller = new AbortController();
    const promise = classify("x", routes, config, "key", false, controller.signal);
    controller.abort();
    await assert.rejects(promise, /cancelled/);
  } finally { clearTimeout(timer); }
});

test("foreign or corrupt session state is not restored", () => {
  const entry = { type: "custom", customType: "pi-typesafe-router/state", id: "1", parentId: null, timestamp: "now", data: { version: 1, sessionId: "parent", phase: "pinned", note: "test" } } as const;
  assert.equal(restoreState([entry], "child"), undefined);
  assert.equal(restoreState([entry], "parent")?.phase, "pinned");
  assert.equal(restoreState([{ ...entry, data: { ...entry.data, phase: "invalid" } }], "parent"), undefined);
});
