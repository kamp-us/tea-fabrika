# `@kalfa/github` checks its routes against Octokit's types and sends the date they describe

`@kalfa/github` checks each route a caller declares against the types of `@octokit/openapi-types`, pinned to the exact
version 29.0.1, and sends the REST API date `2022-11-28` in `X-GitHub-Api-Version`. This replaces the acceptance
criterion of https://github.com/kamp-us/tea-fabrika/issues/1944 that named a types-only map for `2026-03-10`, and ruling 7
of https://github.com/kamp-us/tea-fabrika/issues/1753, whose default for the setting was `2026-03-10`. We chose this
because the types and the date must describe the same API: the compile-time checks say what GitHub answers, and GitHub
answers in the date the request names. The package records no date, but the plan found that 29.0.1 was built from
GitHub's undated description, which equals the `2022-11-28` file once the notes about `2026-03-10` are removed
(`.kalfa/quests/kalfa-github-operation-PLAN.md`, "Doubts, at the top"). The owner answered yes to sending
`2022-11-28` at the plan's signing on 2026-11-22 (the plan's last section).

## Considered Options

- Send `2026-03-10` and make the types from GitHub's own `2026-03-10` description: rejected, because this repo runs no
  type generator, and one would be new code to keep for a date that no Octokit release describes yet.
- Send `2026-03-10` over Octokit's `2022-11-28` types: rejected, because the checks would describe answers GitHub no
  longer sends. A workflow dispatch would answer 200 with the run's id where the types say 204, and a pull request
  would lose `merge_commit_sha`.
- Let a setting pick the date: rejected, for the same reason. The date is typed by the types, so the setting cannot
  move alone.

## Consequences

- A later date needs a newer `@octokit/openapi-types` and a law run. The date law (V1) goes red when the types describe
  another date, and then `GitHub.apiVersion` changes with the pin. Nothing says when Octokit will publish types for
  `2026-03-10`, so we wait for it.
- We stay on `2022-11-28`'s older answers until then: a workflow dispatch answers 204 unless `return_run_details` is
  sent, and a pull request keeps `merge_commit_sha`. GitHub supports `2022-11-28` until 2028-03-10.
- The types lag GitHub's description by days to months. A route added after the pinned release does not compile until
  the pin moves.
- How a bump goes is in the "How a bump goes" section of `kalfa/github/README.md`, on main.
