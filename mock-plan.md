> **Owner ruling, overrides anything below:** open NO pull request; push to your branch only. Your
> report goes in your field row and RESULT. See `step-rules.md`, "Pull request".

# Plan step for one folder of the mock sweep

The Recorder landed (PR 1401). `docs/plan/quests/recorder-PLAN.md` on main, "Size", lists the
later slices: one quest per folder, each starting with its own plan. You write that plan, for the
folder your brief names, read-only apart from the plan file and its field row. Use the plan skill
(`.agents/skills/plan/SKILL.md`) and its open questions test. Read decisions 0555 and 0579 and
`.patterns/a-law-watches-calls-with-a-recorder.md`, and the Recorder in `next/packages/vitest/src/Recorder.ts`.

- **What the plan must say:** each `vi.fn`, `toHaveBeenCalled*` and `vi.spyOn` in the folder (count
  them again on main), what it watches, and what replaces it: the Recorder, an in-memory Layer, or
  Effect's own test service (`TestConsole`, `FetchHttpClient.Fetch`, `ChildProcessSpawner`) where
  the recorder plan says so. Where a product change must come first (a plain function argument
  becomes a service, `fetch` or `process.kill` or `console` or `crypto` moves behind one), the plan
  says it, with its types in code blocks.
- **The lock:** the lint rule that refuses `vi` mocks in tests, on for the folder when it reaches
  zero (find the rule on main; if none exists, the plan says how the first slice adds it, as a
  lint rule with laws and plants).
- **Laws are not loosened:** a test that only passed because of a mock is rewritten to watch the
  real call through the Recorder, never deleted. Each law's plant is named.
- The plan names its steps (tests, build, review) and its files table by owner.
- Any new design call goes under "Open questions" for the owner; settle everything decided notes
  already settle. Check `records.ts find` first.

Write `docs/plan/quests/mock-<folder>-PLAN.md` on your branch, commit it (`stepcommit.sh
--commit-only lead 1067 ...`, or plain `git commit` if stepcommit refuses), leakgrep, and push to
your branch. Open NO pull request: an integrator puts every folder's plan into one plan PR on
`fabrikalfa/mock-plans`. RESULT gives the plan file, its head and each open question in one line.
