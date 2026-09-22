# pi-jev-session-router

> **Completed experiment — not production-ready.** Active development is paused. Source and tests are retained for reference, not as a validated recommendation for automatic model selection. Small-sample evaluations did not establish better task outcomes or overall cost savings. See [experiment conclusions and limitations](docs/experiment-conclusion.md).

An opt-in Pi extension that calls TypeSafe Jev once for the first task in a session, jointly selects a configured **model and thinking level**, and keeps that selection pinned for the rest of the session.

## Intended behavior

- The router offers Jev only the explicit `candidates` allowlist, expanded into model/thinking-level pairs. It never discovers or adds providers or models.
- Model and thinking level are selected together. One model may expose several allowed thinking levels.
- Candidate order expresses preference. Within a model, Jev is instructed to prefer the lowest sufficient effort. Model capabilities come only from each candidate's `description`.
- A route is eligible only when Pi reports that the model is available. The extension also respects `/scoped-models`, a scope's fixed thinking level, the model's supported thinking levels, and image-input requirements.
- `/resume`, `/reload`, and compaction preserve the selection. `/new`, `/fork`, and `/clone` route the next task in the new session. `/tree` restores the selected branch's state.
- Manual `/model` or thinking-level changes take priority and permanently stop automatic routing in that session.
- The extension does not reclassify each prompt, monitor later task changes, retry automatically, or replay a generation.
- Missing configuration, no eligible route, missing credentials, low confidence, `stay`, HTTP failures, timeouts, or an unavailable target all retain the current selection. Use `/ts-router on` explicitly to try a later task.
- Routing is disabled by default. The extension does not approve tools, load skills, edit files, schedule subagents, or proxy generation requests.

## Reproduction environment

- The experiment and SDK integration test used Pi (`@earendil-works/pi-coding-agent`) **0.85.1**. Compatibility with other versions has not been established by this evaluation.
- Node.js **22.19 or later**.
- A TypeSafe API key for the routing decision.
- Existing Pi credentials for every generation model in the candidate list. TypeSafe credentials do not authenticate those models.

## Reproduce from source

For further experimentation only; this is not a recommendation to enable the router for daily use.

```sh
git clone https://github.com/habitssss/pi-jev-session-router.git
cd pi-jev-session-router
npm ci --include=dev --ignore-scripts
pi install "$PWD"
```

The extension itself never reads or modifies Pi's global settings. The `pi install` command is a separate, user-initiated Pi operation.

## Configuration

Copy [`examples/pi-typesafe-router.json`](examples/pi-typesafe-router.json) to:

```text
~/.pi/agent/pi-typesafe-router.json
```

If `PI_CODING_AGENT_DIR` is set, place the file in that directory instead. The extension deliberately does **not** load project-local configuration, so opening a repository cannot enable a paid routing call or expand the candidate allowlist. Do not overwrite an existing configuration file without reviewing it.

Use `pi --list-models` to find the exact provider and model IDs that are already available to Pi, then replace the placeholders in the example. A single model may list multiple thinking levels.

| Field | Default | Meaning |
| --- | --- | --- |
| `enabled` | `false` | When `true`, a new session may send its first task to TypeSafe and incur TypeSafe usage. |
| `model` | `jev-latest` | The TypeSafe decision model, not a Pi generation model. |
| `timeoutMs` | `5000` | Whole TypeSafe HTTP request timeout, from 100 to 30,000 ms. No retry follows. |
| `minConfidence` | `0.3` | Retain the current selection below this value. Valid range: 0–1. |
| `candidates` | `[]` | Up to 20 explicit models, each with `provider`, `model`, `description`, and a non-empty `thinking` list. |

Supported configured levels are `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, and `max`. The extension filters out levels that the selected Pi model does not support; it never substitutes a different level. A scoped thinking level restricts the offered routes to that level.

The default `minConfidence` is an initial policy value, not a calibrated success threshold. Confidence describes how concentrated the returned choice distribution is; it does not measure task success.

### Routing evidence and escalation

Descriptions should explain when to select a candidate, when not to select it, and what evidence justifies a more capable option. Shared instructions tell Jev to use these descriptions rather than assumptions about model names or versions. File counts, step counts, code-related keywords, and emphatic wording do not establish difficulty. A known method can remain on an execution-oriented candidate even across many files.

Previous failures count only when explicitly reported in the task. Permissions, network failures, missing dependencies, and missing context are not reasons to upgrade by themselves. Evidence of a reasoning limitation can justify a more capable candidate; clearly difficult work does not need to fail on another model first. Model capability and thinking effort remain separate choices.

These are routing instructions, not a deterministic guarantee or an automatic retry/escalation mechanism. To reconsider a failed task, use `/ts-router on` and include the relevant evidence in a new, self-contained prompt. The router does not fetch prior execution feedback.

### Environment variables

`TYPESAFE_API_KEY` is the only TypeSafe credential used. Inject it into the environment that launches Pi, preferably through a password manager or another secret-management mechanism:

```sh
TYPESAFE_API_KEY="..." pi
```

Do not put a real key in this repository, a prompt, the JSON configuration, or an example file. The extension does not load project `.env` files and does not write credentials to disk. `TYPESAFE_BASE_URL` is not supported: requests use the fixed HTTPS endpoint `https://api.typesafe.ai/v1/systemone` and reject redirects.

`PI_CODING_AGENT_DIR` changes where Pi—and therefore this extension—looks for its agent directory and router configuration. Tests set it to a temporary directory so they never inspect or modify a user's Pi settings or sessions.

## Usage

With `enabled: false`, start Pi and opt in for the current session:

```text
/ts-router status
/ts-router on
```

In interactive mode, `on` asks for confirmation before data is sent and billing can occur. Then enter a complete, self-contained task rather than a greeting or “continue.” The extension reports the selected provider/model, thinking level, and confidence, and updates the status line.

To opt in automatically for each new session, set `enabled` to `true`, then restart Pi or use `/reload`. A session that was explicitly turned off remains off; use `/ts-router on` to rearm it. Installing the extension into an existing conversation does not classify a continuation message automatically.

| Command | Behavior |
| --- | --- |
| `/ts-router` or `/ts-router status` | Show the config path, state, current selection, whether a key exists, and the latest decision token counts. Makes no network request. |
| `/ts-router on` | Reload configuration and arm the next complete task. Requires an idle session and can be used for an explicit later selection. |
| `/ts-router off` | Disable routing for the session and cancel a pending classification without changing the current model. |

`on` and `off` append extension state to the current Pi session; they do not edit configuration files. A cancelled or concurrently rejected prompt is not replayed—submit it again manually. Do not enable another automatic model router in the same session.

## Session pinning and manual overrides

Before network I/O, the extension records that the session has attempted routing. A successful decision is stored as a Pi custom session entry and restored with that session or branch. The prompt and API key are not stored in that entry. If Pi restores a different actual model or thinking level, the extension treats it as a manual override and follows Pi's state.

After a route is pinned, later prompts never trigger another decision. If a user or another extension changes the model or thinking level before or after routing, that actual selection wins and automatic routing stops. The extension never replays a prompt after cancellation, switching failure, or concurrent input.

## Privacy, billing, and failure behavior

The TypeSafe request contains:

- the raw task text from Pi's `input` event, before skill or template expansion;
- a boolean indicating whether images are present; and
- configured candidate descriptions and eligible thinking levels.

The extension does not proactively read or send files, system prompts, conversation history, image contents, or hidden reasoning. Text that you paste into the task is sent as-is; there is no redaction layer. A first input from an extension or slash template is not sent and ends automatic routing for that session, preventing a later mid-task switch.

Forking or explicitly rearming still sends only the new task, not prior history. A context-dependent instruction may therefore result in `stay`. Request JSON larger than **28,000 UTF-8 bytes** is rejected locally without truncation or splitting. The limit includes shared instructions, JSON escaping, and candidate descriptions, which currently repeat for each eligible thinking level; it is not a task-text-only budget.

TypeSafe usage may be billed independently of the selected generation model. A request that times out or is cancelled after transmission may still incur TypeSafe charges. The extension records token counts but does not estimate currency costs, and TypeSafe usage is not included in Pi's default footer cost. Check TypeSafe's current pricing and terms before enabling routing.

There are no automatic retries for timeouts, cancellation, HTTP 401/429/529, malformed responses, or other failures. A process crash before Pi flushes a brand-new session to disk can lose the pre-request attempt marker, but normal reload and resume preserve it. The timeout covers TypeSafe HTTP I/O only; Pi's own `setModel()` authentication flow cannot be cancelled by this extension. If routing is disabled during model application, inspect the current model before continuing.

This project makes no claim about routing accuracy, latency improvement, cache behavior, or cost savings. The [experiment conclusion](docs/experiment-conclusion.md) covers the TiDB evaluation, description-language comparison, and their limitations. The earlier [five-case boundary spot check](docs/routing-boundary-check.md) is a separate synthetic observation, not a representative benchmark. Candidate descriptions should also account for context-window needs; a less expensive model may not fit the active Pi context.

## Development and validation

The package has no production dependencies beyond its Pi peer dependencies. Development dependencies provide TypeScript and the Pi SDK used by tests.

```sh
npm ci --include=dev --ignore-scripts
npm run check
```

All automated tests are offline. They use synthetic credentials, temporary Pi directories and sessions, mocked TypeSafe responses, and fake generation models. The SDK test loads the TypeScript extension through the real Pi SDK and verifies pre-generation switching, persistence, resume behavior, and manual-override priority without making external requests.

[`test/fixtures/routing-boundaries.ts`](test/fixtures/routing-boundaries.ts) defines five synthetic cases: a known-method bulk edit, a permission-only failure, missing context, an unknown-cause investigation, and interacting high-stakes constraints with failure evidence. Expected roles and effort ranges are evaluation labels, never sent to Jev. Offline tests check evidence preservation, shared instructions, and the exact UTF-8 request boundary; they do **not** establish whether Jev selects the expected role. A live evaluation should report the raw choice, confidence-gated outcome, token usage, and errors separately. Retaining the current model because of low confidence is not a successful classification.

A **live API validation** is separate, optional, potentially billable, and not part of `npm run check`. It must use a real `TYPESAFE_API_KEY` and should only be run with explicit authorization.

## Implementation map

- `src/config.ts`: strict configuration validation; disabled and empty by default.
- `src/routes.ts`: eligible model/thinking-level pair construction.
- `src/typesafe.ts`: one Choice request, HTTP timeout, and response validation.
- `src/state.ts`: branch- and session-bound state restoration.
- `src/index.ts`: Pi events, decision application, manual overrides, and commands.

API references: [TypeSafe HTTP API](https://docs.typesafe.ai/api), [Choice](https://docs.typesafe.ai/primitives/choice), and [Confidence](https://docs.typesafe.ai/confidence).

## License

[MIT](LICENSE).
