# Experiment conclusion

## Status

**Experimental, not production-ready.** The initial experiment is complete; active development is paused and the local Pi installation has been retired. The source, tests, and prior uncommitted work are retained for reference. This is not a claim that the GitHub repository has been archived or that any published package has been withdrawn.

The project explored whether Jev could choose a model and thinking level from the first task, then keep that choice for the session. It did not establish that this approach improves task outcomes or total costs for interactive coding. It is not a benchmark of Jev's general capabilities or of the generation models.

Source reproduction instructions in the README describe how to repeat the experiment, not a recommendation to enable the extension for unattended daily use. Resuming development, reinstalling dependencies, enabling routing, and making paid calls remain explicit user decisions.

## Evaluation scope

The TiDB evaluation used commit `5e0c63080383b1f59ede88ecf529e0d792b8bda0`, Pi SDK 0.85.1, and 15 explicitly configured model/thinking pairs. These were controlled SDK sessions, **not** an interactive TUI evaluation with all global extensions loaded.

- Four automatic-routing tasks, each with one Jev classification.
- One follow-up to the first task, plus reload, session reopen, and manual-thinking checks without additional classifications.
- Two fixed Sol/high generation controls for the test-editing and code-analysis tasks.
- Sixteen additional classification-only requests comparing Chinese and English candidate descriptions: four tasks × two languages × two rounds.
- Twenty TypeSafe requests in total, with no retries. The service reported `jev-1.13.0` for all requests.

The configured generation model IDs were `deepseek/deepseek-flash`, `openai-codex/gpt-5.6-sol`, and `openai-codex/gpt-6-astra`. These identify this local evaluation's candidates, not a claim about general provider availability or relative capabilities.

## End-to-end observations

Every automatic session began with Sol/high. Keeping that initial selection is not evidence that Jev selected it.

| Task | Raw decision / confidence | Actual outcome |
| --- | --- | --- |
| T1: extract facts from README | Flash/off / .47 | Applied; extraction was faithful to the source |
| T2: add two precisely specified subtests | Flash/low / .45 | Applied; patch matched the requested change, but validation prerequisites were not satisfied |
| T3: investigate parameter checks and callers | `stay` / .30 | Retained initial Sol/high; analysis identified the NaN validation gap |
| T4: analyze DDL concurrency, recovery, and rollback | Astra/high / .20 | Below the .30 threshold; retained initial Sol/high; output was static analysis, not a dynamic correctness proof |

T1 retained Flash/off across its follow-up, SDK reload, and reopening the session, with one classification in total. A subsequent manual thinking change produced the manual state without another classification or generation. This supports the tested lifecycle behavior, not complete coverage of interactive model changes, compaction, forks, or every failure mode.

The two more analytical tasks depended on the initial model. The experiment therefore does not establish reliable automatic escalation from a weaker initial selection.

## Description-language comparison

Only the three candidate descriptions were translated into English. Task text, shared instructions, candidate order, thinking levels, threshold, and request model were unchanged. Each task ran in zh→en order in round one and en→zh order in round two. All 16 requests succeeded.

| Task | Chinese description, both rounds | English description, both rounds |
| --- | --- | --- |
| T1 | Flash/off, applied | Flash/off, applied |
| T2 | Flash/low, applied | Flash/off, applied |
| T3 | `stay`, retained | `stay`, retained |
| T4 | `stay`, retained | Sol/high, but confidence .22/.23; retained |

Here, “applied” and “retained” are calculated outcomes under the existing policy. **No generation model was invoked or switched in this language comparison.**

| Metric | Chinese | English |
| --- | ---: | ---: |
| Requests | 8 | 8 |
| Decisions passing the application policy | 4 | 4 |
| Retained initial selection | 4 | 4 |
| Input tokens | 43,480 | 35,088 |
| Output tokens | 1,320 | 1,324 |
| Largest UTF-8 request body | 17,186 bytes | 21,090 bytes |

English used 1,049 fewer input tokens per request, a 19.30% reduction across this sample, but added 3,904 UTF-8 bytes per request. This does not imply better routing, generation quality, lower whole-task cost, or lower billed subscription cost. Neither language resolved the fallback on analytical tasks. Two repetitions per task do not establish broad stability or statistical significance.

T3 assigned about .58 combined probability to the Sol family, but its individual thinking-level options each lost to `stay`. This is an observed distribution, not proof of a general defect or a validated reason to aggregate model probabilities. Candidate granularity may warrant a separate experiment; lowering the confidence threshold alone cannot change a raw `stay` decision.

The original end-to-end T4 classification selected Astra/high at .20, while the two later Chinese classifications selected `stay`. Even within the same reported service version, not every difference across runs can be attributed to language.

## Evaluation failures and limitations

These prevent treating the run as a clean end-to-end performance or cost comparison:

- Both test-editing groups omitted the new-workspace `make bazel_prepare` prerequisite. The harness did not explicitly communicate that the worktrees were newly created. A later controller check failed because Bazel was unavailable; it did not retroactively satisfy the prerequisite.
- The fixed Sol/high control ran `make lint`, which indirectly installed `revive` despite the no-install constraint. The tool was written inside the experimental worktree. Shared Go-cache changes were observed in the same time window, but there was no before-snapshot and other processes could not be excluded.
- The harness blocked direct installation commands but failed to prevent the indirect installation. A long synchronous call also delayed processing a stop instruction until the second control had already completed. These are evaluation-control limitations, not evidence that the router itself installs tools.
- Both editing groups produced the requested patch, but a correct patch or successful lint output does not erase execution-boundary violations or missing prerequisites.
- Go caches were shared, not reset or isolated. The tasks performed different validation work. Runtime and token totals cannot support a fair model-performance winner or cold-build comparison.
- The DDL analysis was read-only and was not followed by cluster or fault-injection validation. Identified test gaps are not demonstrated implementation defects.
- Jev received task text and descriptions, not repository contents or subsequent execution feedback. The descriptions expressed intended roles rather than empirically calibrated model success rates.

The earlier [five-case boundary spot check](routing-boundary-check.md) remains a separate, synthetic observation. It does not override these limitations.

## Closeout decision

Stop using this implementation as the default local router. For now, use a reliable initial model and choose a lower-cost model explicitly for clearly mechanical tasks. Do not tune descriptions or lower thresholds merely to increase the number of applied decisions.

A future routing experiment would need representative repeated tasks, measured generation outcomes, comparable execution conditions, and a clear cost/quality objective. This closeout does not authorize that work or any further paid calls.

Local cleanup removes the Pi package registration, the dedicated router configuration, and rebuildable project dependencies. It preserves source, lockfile, tests, existing uncommitted changes, and this conclusion. The two experimental TiDB worktrees and their locally installed tool have already been removed after their diffs were preserved. Shared caches, credentials, and unrelated worktrees are left untouched.

This is a local closeout. No Git commit, push, npm publication or deprecation, or remote repository archival is part of it.
