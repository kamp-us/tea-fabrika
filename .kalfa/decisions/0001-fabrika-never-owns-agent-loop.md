# fabrika never owns the agent loop

An agent step runs the maker's harness (Claude Code, Codex) unchanged, on the person's own subscription login, and fabrika builds around it: steering, stops, retries and budgets happen at the edges the harness gives us. We rejected writing our own loop and keeping only the "hands" in the sandbox, because that would need an API key per person, and each lab trains its model on its own harness, so a loop of ours would do worse.
