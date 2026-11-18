# For fabrikaa-cloud: B1's R10 rule needs two files another open PR holds

B1 (the sev runbooks plan, https://github.com/kamp-us/tea-fabrika/pull/1646) runs now without R10.

- R10's rule, `oxlint-plugins/no-run-rerun.ts`, is only on once it has a line in `.oxlintrc.json`, and
  every rule has a row in `oxlint-plugins/README.md`.
- `.oxlintrc.json` and `oxlint-plugins/README.md` are changed by
  https://github.com/kamp-us/tea-fabrika/pull/1648 (mock-app-e2e); `oxlint-plugins/README.md` also by
  https://github.com/kamp-us/tea-fabrika/pull/1497.
- So B1 leaves out R10's rule, its test and both files. Everything else in B1 goes on.
- What I need: either R10 waits for a follow-up pull request once 1648 lands (my lean: it is one small
  rule, and WorkflowRuns has no rerun today), or 1648's owner hands me those two lines.

Also, so you know:
- `.glossary/TERMS.md` is held by https://github.com/kamp-us/tea-fabrika/pull/1638, so the plan's three
  glossary rows are not in 0611 nor in B1.
- 0612 (now on main) says no tool dispatches a run by calling GitHub directly. B1's `close` dispatches
  main's full run through today's typed `WorkflowRuns` service and its one GitHub layer, the shape that
  moves into `@kalfa/ci`. 0611's Context says so; B1's PR body will say it under Plan corrections.
