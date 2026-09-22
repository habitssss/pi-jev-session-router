# Routing boundary spot check — 2026-09-19

This is a small, explicitly authorized live check of the shared routing instructions, not an accuracy benchmark or proof of improvement over the old instructions. Expected roles and effort ranges were fixed in `test/fixtures/routing-boundaries.ts` before the calls. No pre-change live baseline was collected.

## Setup

- Five synthetic Chinese tasks; one TypeSafe `jev-latest` request per task, no retries.
- Used the real `requestBody`, `eligibleRoutes`, `classify`, and response validation code.
- Used the operator's configured role descriptions and cached Pi model metadata. Candidate roles, in preference order: `deepseek/deepseek-flash` (execution), `openai-codex/gpt-5.6-sol` (analysis), and `openai-codex/gpt-6-astra` (deep analysis).
- Offered 15 model/effort pairs plus `stay`. Confidence threshold: 0.3; timeout: 5,000 ms.
- Sent only synthetic tasks and configured candidate descriptions. Expected labels and rationales were not sent. No history, files, or image contents were submitted.
- No generation calls, model switches, config changes, or automatic routing activation. The actions below are what the confidence gate **would** allow, not actions executed by the test.

## Results

| Case | Raw choice | Confidence | Confidence-gated action | Within preset role/effort range? |
| --- | --- | --- | --- | --- |
| Known-method edit across 80 files, with emphatic wording | DeepSeek Flash / off | 0.89 | Select route | Yes |
| Retry a mechanical edit after a permission-only failure was resolved | DeepSeek Flash / off | 0.89 | Select route | Yes |
| Continuation without task context | stay | 0.91 | Retain current selection | Yes |
| Investigate an unknown cache-invalidation race; no previous attempts | GPT-5.6 Sol / high | 0.42 | Select route | Yes |
| Payment-ledger migration with interacting constraints and concrete failed alternatives | GPT-6 Astra / max | 0.32 | Select route | Yes |

No inappropriate escalation was observed in these five cases. All four model choices passed the threshold; the `stay` case intentionally retained the current selection. No transport errors or low-confidence fallbacks occurred.

The hardest case was close to the threshold: Astra/max had probability 0.37, Astra/high 0.34, and Astra/xhigh 0.18. The unknown-cause case split mainly between Sol/high (0.46) and Sol/medium (0.36). Different effort levels can reduce confidence even when most probability mass favors one model. Neither the threshold nor the descriptions were retuned to these results.

## Request size and usage

- Current local configuration, 15 eligible pairs: empty-task request grew from 15,514 to 16,639 UTF-8 bytes after adding the shared rules.
- The five complete requests ranged from 16,666 to 17,137 bytes, below the 28,000-byte limit; the largest left 10,863 bytes of headroom.
- No payload deduplication or description expansion was needed for this configuration. Descriptions still repeat per eligible effort level; larger configurations or tasks can reach the limit.
- Total reported TypeSafe usage: 26,837 input tokens and 829 output tokens. No currency cost was inferred.
- Observed request durations: 479–1,034 ms. These five observations are not a latency guarantee.

Offline regression tests also cover shared-policy inclusion, unchanged task evidence, exclusion of expected labels, an exact 28,000-byte UTF-8 payload including JSON escaping, and rejection before network I/O when that limit is exceeded. Those tests validate the implementation, not Jev's semantic decisions.

Results may change with model aliases, descriptions, candidate lists, task wording, or confidence thresholds. Generation-model availability and task execution quality were not tested.
