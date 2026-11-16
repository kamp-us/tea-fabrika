# Coordinate one slice: its steps run as subagents in your box

Owner ruling (2026-11-16): one child session per slice or job, acting as that slice's
coordinator. You run the slice's steps yourself as subagents, each step a FRESH subagent (decision
0064: one fresh agent per step), and you do no step's work yourself. Your brief names the slice,
its plan and its steps.

## How to run a step

- Use the Agent tool with the repo's step agent types: `step-tests`, `step-build`, `step-review`
  (and `step-plan` if your brief has a plan step). Model: **Sonnet** (`model: "sonnet"`) for the
  tests and build steps of a mechanical slice; **Opus** (`model: "opus"`) for every step of a
  judgment slice and for every review.
- Run them in order, one at a time, foreground: tests, then build (only if the tests step says
  product hits or red laws remain for it), then review. A fix round after a send-back is one fresh
  build (or tests) subagent with the review's faults, then the SAME review subagent rechecks it
  (0177: continue it with SendMessage). A second send-back stops the slice: report it.
- **Start every code step with the Agent tool's `isolation: "worktree"`,** so its working
  directory is its own worktree root. Never hand a step a worktree you made in a scratchpad: its
  shell resets to the main checkout, and the step-rules' plain-git rule then cannot be met
  (seen five times on 2026-11-16). A read-only review may share the worktree of the step it reads.
- **Each step's prompt** must stand alone: the slice, the plan path and row, the branch, that the
  step reads `step-rules.md` and its step brief from `fabrikalfa/twin-tools`
  (`git fetch -q origin fabrikalfa/twin-tools; git show FETCH_HEAD:<file>`), and these two lines:
  "You start no subagents of your own." and "End with the RESULT block from step-rules.md."
- Step briefs on `fabrikalfa/twin-tools`: Effect judgment slices use `effect-judgment-tests.md`,
  `effect-judgment-build.md`; Effect mechanical slices `effect-fix.md`; Reflect slices
  `reflect-tests.md`, `reflect-build.md`; every review `review.md`.

## What you do between steps

- Read each step's RESULT. Check its branch head was pushed (`git ls-remote`), and run
  `sh .agents/skills/lead/scripts/leakgrep.sh --commits origin/main..origin/<branch>` yourself.
- Decide the next step from the RESULT, not from your own reading of the code.
- A step that says `blocked` (a design call, a law it thinks is wrong) stops the slice: you report
  it, with the step's proof, and start nothing more.

## Your own RESULT

End with the RESULT block from `step-rules.md`, with `step: coordinator`, the PR link if your brief names one (slices have none), the last
pushed head, each step you ran with its outcome, and what is left or blocked. Never merge, mark
ready, approve or close.
