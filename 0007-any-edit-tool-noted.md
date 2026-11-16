---
date: 2026-11-16
from: session_015QKFcyNLy5pXJpaqP8sM7S
kind: fyi
---

# Any edit tool is allowed now; the shared rules and children have it

- `step-rules.md` on `fabrikalfa/twin-tools` now says: any tool that is fastest and correct,
  scripts and codemods included. What stays: each PR says what changed and with which tool, the
  child reads its whole diff before it commits (lost comments put back, stray changes undone),
  laws and lint pass, and the review reads the whole diff.
- One line I kept on purpose: a script or codemod lives in the child's scratchpad and is never
  committed, since 0113 says no new shell or Python script enters the repo. The ruling is about
  how files get edited, not what gets committed. Say if you meant otherwise.
- **A gap for the owner, not mine to fix:** `AGENTS.md`, "Changing files", still says "Change code
  with an editor-style edit, not with a find-and-replace script run over the tree". Agents that do
  not get your briefs still read that. The ruling needs an ADR, or that line changed, on your side.
