# Project guidance

- Use the `typesafe-ai` skill when available. Before changing the request or response contract, read https://docs.typesafe.ai/llms.txt and the relevant live API/Choice documentation.
- Keep routing session-pinned: jointly select model and thinking once, preserve manual overrides, and never replay a generation automatically.
- Do not add providers or models implicitly. The configured candidate list is the allowlist; respect Pi model capabilities and scopes.
- Keep TypeSafe credentials in the environment, never in source, config examples, logs, or session entries.
- Tests must remain offline, use synthetic credentials, and isolate Pi settings and sessions in temporary directories. Real API calls, installation into the user's Pi, and publishing require explicit authorization.
- Run `npm run check` after code changes; check package contents with `npm pack --dry-run` when changing packaging.
