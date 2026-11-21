# Working in this repo

The map for any agent picking up work here. [`README.md`](./README.md) says what the repo holds. What is next lives on the
tracker: the app's own, through its `tracker_file`, `tracker_comment` and `tracker_close` tools. A ticket for this repo
goes there ([the lead skill](./.agents/skills/lead/SKILL.md#tickets-and-tracker-posts)). The two exceptions live in
GitHub issues, as [`.kalfa/issue-tracker.md`](./.kalfa/issue-tracker.md) says: a wayfinder map with its tickets, and the
kalfa package suite's build tickets.

## Two versions, side by side

`next/` is what we are building. Read [`next/AGENTS.md`](./next/AGENTS.md) before you touch a file there. Everything
else (`packages/`, `programs/`, `apps/`) is today's version: what we use every day, and a map of which jobs exist.
`next/` grows beside it ([0002](./.kalfa/decisions/0002-next-grows-beside-today.md)).

- **Know which version your work is in** before you read or change code. Your brief or ticket says so. If it does not,
  new work is `next/`, and if you still cannot tell, ask.
- **A search finds both.** Check the path of every file before you trust it: a name in both can mean different things,
  and a `rev` or a `host` in today's code is not the decisions' one. Say which version each claim in a write-up is
  about.
- **Today's version is frozen.** It keeps running for daily use, and nothing builds on it. All new work goes into
  `next/`, the UX work the owner picks and a product foundation decided in a walk (tokens, focus, lint rules for the
  design, accessibility checks) included; a foundation's build plan is written the same day and comes to the owner as
  one yes. CI runs none of today's tests, and no guard blocks an edit there.
- **A small visual tryout in today's app is allowed** until `next/`'s Electron window is back. What it teaches goes into
  `next/` as a lesson, rethought and not copied, except an approved guideline, whose rules `next/` follows as written.

## Where things live

- **Records:** where each kind of record lives and what goes in it is in [`.kalfa/kalfa.toml`](./.kalfa/kalfa.toml), so
  read it before you read or write any record.
- **Design notes:** a settled choice becomes a decision, and a design still in draft is a file in `docs/`. No folder
  keeps an index table.
- **A live run's state and logs:** `runs/`, local to your machine. Read it; never edit or commit it.
- **Knowledge that lives only in a chat or in an agent's private memory** is in the wrong place: write it here.

## Finish your task

For every agent, whatever its step. A step's skill adds its own rules and its own answer format.

- **Finish the whole task.** Your turn ends when everything the task asked for is done, so when a part is left, do it.
  An error, a timeout, a locked file, an empty result, a failing tool or a red check is an ordinary obstacle: find its
  cause, then work through it with the access you have (wait and retry, fix the command, use another tool). An open
  question holds only the parts that need its answer.
- **Stop only for a real blocker:** something a person decided on purpose (a file another step owns, access that was
  held back, a rule here that says never), a new design call, or work that cannot move without a person. Leave it alone,
  finish everything else, then say plainly what you found and exactly what you need. This loosens no rule here on
  pushes, merges, secrets or history.
- **These need no approval,** in your own worktree and on your own files: `pnpm format` and `pnpm lint`; a fix for a
  lint, format or type error your own change caused; your own narrow test, run again after a change; a command tried
  again after a timeout; an install with `--frozen-lockfile`; a commit of your own paths with the step-commit skill,
  which pushes for you (in a box, `drive.ts` commits and pushes instead).
- **Report for a reader who saw none of the work.** Give the answer first, then what changed, what ran, and what could
  not run and why. Write full sentences in plain words, use no name you made up along the way, and give a path or a full
  URL for each thing you cite, so the report stands on its own.
- **A refusal, failure or problem seen a second time** gets its root cause found and a ticket filed, in place of another
  workaround or another ask.

## How a change lands

Every pull request takes the steps [the lead skill](./.agents/skills/lead/SKILL.md#how-a-change-lands) gives it: plan,
test writer, build and one review for product code, and fewer for a fix command, a decision or lead tooling. No agent
approves a pull request, and no agent answers a question the machine put to a person.

## Before you design anything

Read [the design reference](./.agents/skills/plan/references/design.md) before any plan, design, recommendation or
question to the owner, and when you walk a pull request: how to check what is settled, the checks a plan picks, and the
rules for a design.

## Checks

```sh
pnpm format                                                            # first: formats and applies safe fixes, in place
pnpm lint                                                              # changes nothing; a warning fails it too
nice -n 15 pnpm exec vitest run --maxWorkers=3 <path>                  # a narrow path while you work
nice -n 15 pnpm exec vitest run --maxWorkers=3 --changed origin/main   # once at the end
pnpm typecheck                                                         # once, last: an Effect made and dropped fails it
```

Lint, typecheck and tests pass before a change is offered. Run the narrowest check that still covers the change, as
[Effect's own repo](https://github.com/Effect-TS/effect/blob/main/.agents/AGENTS.md) asks of its agents. A push waits on
no local `pnpm typecheck`, and on no local run of more than about five minutes that CI runs anyway.

| What changed | What to run here |
|---|---|
| Markdown that no program reads, or skill prose | `pnpm lint`, which runs `skillscheck.sh`, skill prose's one reader |
| Code, a skill script, or Markdown that a program or skill reads | the block above |
| A dependency's version | the block above, with narrow paths in place of `--changed`, which a lockfile change makes the full suite |

A lint finding is fixed in the code, never by switching its rule off:
[the build skill's Lint findings](./.agents/skills/build/SKILL.md#lint-findings) says what to do with each.

### Go easy on the machine

Everything here runs on a laptop a person is using. Before tests while other code agents run, a typecheck, an Electron
test app, a Docker box, a wide search or the sandbox runtime, read
[the lead skill's caps](./.agents/skills/lead/SKILL.md#go-easy-on-the-machine): each came from a laptop that froze.
Before `gh pr edit`, `claude -p`, a repo-wide `rg` or `pnpm build`, read
[the tool facts](./.agents/skills/lead/SKILL.md#tool-facts-that-cost-us-time), and before any paid model run,
[the money rules](./.agents/skills/lead/SKILL.md#money).

## This repo is public

- No secrets, and never print or write a key.
- A list of open security holes stays out of this repo. Each fix lands as a normal pull request.
- Paths are repo-relative or start with `~`, never an absolute path from anyone's machine. No personal names or account
  names, except inside a license notice the law requires (an upstream LICENSE file).
- Record the decision, not the conversation: never quote what a person typed in a chat session. Text a person posted
  publicly on an issue or pull request may be linked and summarized.

## How to write here

Write-ups are read by busy people, some of them not native English speakers.

- Plain everyday words and short sentences. Give the answer first.
- American English everywhere: color, behavior, canceled. Saved prompts, results and stored data values stay as they
  are.
- Size work in files, lines and agent hours, never human days. At most one simple table per section. No box drawings.
- Every recommendation says why, what it costs, and how sure you are. Under about 80% sure, name the doubt and what
  would settle it.
- A write-up ends with what it cannot tell us. A run that shows what breaks is as useful as a clean one, so a failure
  is told whole. Guesses that turned out wrong stay in the record, marked as wrong.

## Writing a skill

- Write it by `writing-for-agents`: how a skill, its description and its pointers are written.
- A skill may reference `.kalfa/kalfa.toml` and the `kalfa` command, never project content:
  no ADR numbers, no decision links, no paths outside the config layer.
- Reach for these skills instead of re-explaining their method:
  - naming words or recording a decision: `domain-modeling`
  - shaping a module or a seam: `codebase-design`
  - stress-testing a plan: `grilling`, or `grill-with-docs` to update the docs as you go
  - answering a question from sources: `research`
  - testing a design with throwaway code: `prototype`
  - a hard bug: `diagnosing-bugs`

## Changing files

- Move files with `git mv`, so history follows.
- Stage your own paths by name. Another session may have work in the same checkout.
- Push every commit when you make it, and give its branch a draft pull request at the first commit.

## Changing the product

For a change to what a person sees or uses, read
[the rules for changing the product](./.agents/skills/guidelines/references/changing-the-product.md) first.
