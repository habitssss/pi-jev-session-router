import { join } from "node:path";
import { getAgentDir, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { isObject, loadConfig, parseConfig, type Config } from "./config.ts";
import { eligibleRoutes } from "./routes.ts";
import { classify, RoutingError } from "./typesafe.ts";
import { ENTRY, restoreState, sameSelection, type Selection, type State } from "./state.ts";

const COMMAND = "ts-router";
const DATA_NOTICE = "The first routing decision sends your task text and candidate descriptions to api.typesafe.ai using TYPESAFE_API_KEY and may incur charges. It does not send system prompts, conversation history, files, or image contents. Automatic routing runs once per session; manual changes take priority.";

export default function typesafeRouter(pi: ExtensionAPI): void {
  const configPath = join(getAgentDir(), "pi-typesafe-router.json");
  let config: Config = parseConfig({});
  let configError: string | undefined;
  let state: State | undefined;
  let pending: AbortController | undefined;
  let applying = false;
  let closed = false;

  function selection(ctx: ExtensionContext): Selection | undefined {
    return ctx.model ? { provider: ctx.model.provider, model: ctx.model.id, thinking: pi.getThinkingLevel() } : undefined;
  }
  function report(ctx: ExtensionContext, text: string, level: "info" | "warning" | "error" = "info"): void {
    if (ctx.hasUI) ctx.ui.notify(`[${COMMAND}] ${text}`, level);
    else process.stderr.write(`[${COMMAND}] ${text}\n`);
  }
  function status(ctx: ExtensionContext): void {
    if (ctx.hasUI) ctx.ui.setStatus(COMMAND, pending ? "Jev: routing…" : state ? `Jev: ${state.phase}${state.selection ? ` · ${state.selection.model} / ${state.selection.thinking}` : ""}` : undefined);
  }
  function save(ctx: ExtensionContext, next: Omit<State, "version" | "sessionId">): void {
    state = { ...next, version: 1, sessionId: ctx.sessionManager.getSessionId() };
    pi.appendEntry(ENTRY, state);
    status(ctx);
  }
  function cancel(): void {
    pending?.abort();
    pending = undefined;
  }
  function readConfig(): void {
    try {
      config = loadConfig(configPath);
      configError = undefined;
    } catch (error) {
      config = parseConfig({});
      configError = error instanceof Error ? error.message : "Invalid router config";
    }
  }
  function restore(ctx: ExtensionContext, fresh: boolean): void {
    cancel();
    closed = false;
    readConfig();
    const branch = ctx.sessionManager.getBranch();
    state = fresh ? undefined : restoreState(branch, ctx.sessionManager.getSessionId());
    if (!state) {
      const existing = !fresh && branch.some((e) => e.type === "message" || e.type === "compaction");
      save(ctx, {
        phase: config.enabled ? (existing ? "retained" : "ready") : "off",
        selection: existing ? selection(ctx) : undefined,
        note: existing ? "An existing conversation was detected, so routing will not start mid-session. Use /ts-router on to rearm explicitly." : "Waiting for the first task.",
      });
    } else if (state.selection && !sameSelection(state.selection, selection(ctx))) {
      // Pi restores actual model/thinking history, including CLI/manual overrides.
      save(ctx, { phase: state.phase === "off" ? "off" : "manual", selection: selection(ctx), note: "Using the model and thinking level restored by Pi." });
    }
    status(ctx);
    if (configError) report(ctx, `Configuration unavailable: ${configError}. Keeping the current model.`, "warning");
  }

  pi.on("session_start", (event, ctx) => restore(ctx, event.reason === "new" || event.reason === "fork"));
  pi.on("session_tree", (_event, ctx) => restore(ctx, false));
  pi.on("session_shutdown", () => { closed = true; cancel(); });

  function manual(ctx: ExtensionContext): void {
    if (closed || applying || !state || state.phase === "off") return;
    const wasPending = Boolean(pending);
    cancel();
    save(ctx, { phase: "manual", selection: selection(ctx), note: "The model or thinking level was changed manually or by another extension; automatic switching is now disabled." });
    if (wasPending) report(ctx, "Cancelled the pending routed task and kept your model settings. Resubmit the task manually.", "warning");
  }
  pi.on("model_select", (event, ctx) => { if (event.source !== "restore") manual(ctx); });
  pi.on("thinking_level_select", (_event, ctx) => manual(ctx));

  pi.on("input", async (event, ctx) => {
    if (closed) return { action: "continue" };
    // A concurrent prompt must not start another classification or run on a half-selected model.
    if (pending || applying) {
      report(ctx, "The first routing decision is still in progress. Resubmit this message after it finishes.", "warning");
      return { action: "handled" };
    }
    if (!state || state.phase !== "ready" || event.streamingBehavior || !event.text.trim()) return { action: "continue" };
    const keep = (note: string) => {
      save(ctx, { phase: "retained", selection: selection(ctx), note });
      report(ctx, `${note} Keeping the current selection for this session; use /ts-router on to rearm.`, "warning");
    };
    if (event.source === "extension" || event.text.trimStart().startsWith("/")) {
      keep("The first input came from an extension or slash template, so its contents were not sent for automatic routing.");
      return { action: "continue" };
    }
    if (configError) { keep(`Configuration unavailable: ${configError}.`); return { action: "continue" }; }
    const containsImage = (message: unknown) => isObject(message) && Array.isArray(message.content) &&
      message.content.some((part: unknown) => isObject(part) && part.type === "image");
    const hasImages = Boolean(event.images?.length) || ctx.sessionManager.buildContextEntries().some((entry) =>
      entry.type === "message" ? containsImage(entry.message) :
        entry.type === "compaction" && "retainedTail" in entry && Array.isArray(entry.retainedTail) && entry.retainedTail.some(containsImage));
    const routes = eligibleRoutes(config.candidates, ctx.modelRegistry.getAvailable(), ctx.scopedModels, hasImages);
    if (!routes.length) { keep("No configured model/thinking-level pair is currently eligible."); return { action: "continue" }; }
    const key = process.env.TYPESAFE_API_KEY?.trim();
    if (!key) { keep("TYPESAFE_API_KEY is not set."); return { action: "continue" }; }
    const controller = new AbortController();
    pending = controller;
    const sessionId = ctx.sessionManager.getSessionId();
    const initial = selection(ctx);
    const signal = ctx.signal ? AbortSignal.any([controller.signal, ctx.signal]) : controller.signal;
    const current = () => !closed && !signal.aborted && pending === controller && ctx.sessionManager.getSessionId() === sessionId;
    try {
      // Persist the attempt before I/O so a reload after an interrupted request does not bill again.
      save(ctx, { phase: "retained", selection: initial, note: "The first routing decision was attempted. If interrupted, keep the current model and do not retry automatically." });
      const decision = await classify(event.text, routes, config, key, hasImages, signal);
      if (!current()) return { action: "handled" };
      if (!sameSelection(initial, selection(ctx))) {
        manual(ctx);
        return { action: "continue" };
      }
      const route = routes.find((r) => r.id === decision.choice);
      if (!route || decision.confidence < config.minConfidence) {
        save(ctx, { phase: "retained", selection: initial, decision, note: !route ? "Jev recommended keeping the current selection." : "Routing confidence was below the configured threshold." });
        report(ctx, state!.note, "warning");
        return { action: "continue" };
      }
      // Recheck eligibility after network I/O. Never invent or substitute a target.
      const stillEligible = eligibleRoutes(config.candidates, ctx.modelRegistry.getAvailable(), ctx.scopedModels, hasImages)
        .find((r) => r.model.provider === route.model.provider && r.model.id === route.model.id && r.thinking === route.thinking);
      if (!stillEligible) { keep("The selected model is no longer available."); return { action: "continue" }; }
      applying = true;
      if (initial?.provider !== route.model.provider || initial?.model !== route.model.id) {
        if (!await pi.setModel(stillEligible.model)) { keep("Could not switch models because authentication is unavailable."); return { action: "continue" }; }
      }
      if (!current()) return { action: "handled" };
      if (ctx.model?.provider !== route.model.provider || ctx.model.id !== route.model.id) {
        save(ctx, { phase: "manual", selection: selection(ctx), note: "Another operation changed the model during switching. Keeping the actual selection without applying the routed thinking level." });
        report(ctx, state!.note, "warning");
        return { action: "continue" };
      }
      pi.setThinkingLevel(route.thinking);
      const actual = selection(ctx);
      save(ctx, { phase: "pinned", selection: actual, decision, note: "The model and thinking level were selected together; this session will not be classified again automatically." });
      report(ctx, `${actual?.provider}/${actual?.model} · ${actual?.thinking} pinned (confidence ${decision.confidence.toFixed(2)}).`);
    } catch (error) {
      if (!current()) return { action: "handled" };
      keep(error instanceof RoutingError ? error.message : "Failed to apply the route.");
    } finally {
      applying = false;
      if (pending === controller) pending = undefined;
      if (!closed) status(ctx);
    }
    return { action: "continue" };
  });

  pi.registerCommand(COMMAND, {
    description: "TypeSafe session routing: status | on | off (on rearms the next task)",
    getArgumentCompletions: (prefix) => ["status", "on", "off"].filter((s) => s.startsWith(prefix)).map((s) => ({ value: s, label: s })),
    handler: async (args, ctx) => {
      const action = args.trim() || "status";
      if (action === "status") {
        const currentSelection = selection(ctx);
        const decision = state?.decision;
        report(ctx, [
          `Config: ${configPath}${configError ? ` (${configError})` : ""}`,
          `State: ${state?.phase ?? "not initialized"}; ${state?.note ?? ""}`,
          `Current: ${currentSelection ? `${currentSelection.provider}/${currentSelection.model} / ${currentSelection.thinking}` : "no model selected"}`,
          `Candidates: ${config.candidates.length}; TypeSafe key: ${process.env.TYPESAFE_API_KEY?.trim() ? "set" : "not set"}`,
          decision ? `Latest decision: ${decision.choice}, confidence ${decision.confidence}; input ${decision.inputTokens} / output ${decision.outputTokens} tokens (not included in Pi footer cost).` : "No classification result yet.",
        ].join("\n"));
        return;
      }
      if (action === "off") {
        cancel();
        save(ctx, { phase: "off", note: "Automatic routing is disabled; the current model is unchanged." });
        report(ctx, "Disabled. If a pending routed message was cancelled, resubmit it manually.");
        return;
      }
      if (action !== "on") { report(ctx, "Usage: /ts-router [status|on|off]", "warning"); return; }
      if (!ctx.isIdle() || pending || applying) { report(ctx, "Wait for the current task or routing decision to finish.", "warning"); return; }
      readConfig();
      if (configError || !config.candidates.length) { report(ctx, configError ?? `Configure candidates in ${configPath} first.`, "warning"); return; }
      if (!process.env.TYPESAFE_API_KEY?.trim()) { report(ctx, "Set TYPESAFE_API_KEY in the environment that launches Pi first.", "warning"); return; }
      if (ctx.hasUI && !await ctx.ui.confirm("Enable TypeSafe routing?", DATA_NOTICE)) return;
      if (closed) return;
      save(ctx, { phase: "ready", note: "The next complete task will select a model and thinking level again." });
      report(ctx, `Enabled. ${DATA_NOTICE}`);
    },
  });
}
