# Working in this repo

A map for any agent or person picking up work here. Read
this first, then [`docs/plan/README.md`](./docs/plan/README.md) for where the work stands, then
[`docs/direction/README.md`](./docs/direction/README.md) for why.

## What this repo is

An experiment that rebuilds an agent pipeline ("fabrika") as plain state machines on
[`@demlik/tea`](https://github.com/kamp-us/demlik). Code holds the loop; an agent does one bounded job inside it. The
repo is as much a lab notebook as a codebase: what was tried, what happened on real tickets, and what was decided are
all kept here on purpose, so they can be analysed later.

## Two versions, side by side

`next/` is what we are building, on the decisions; its rules are in `next/AGENTS.md`. Everything else is what we use
today (`packages/`, `programs/`, `apps/`), and a map of which jobs exist. `next/` grows beside today's version
([0002](.kalfa/decisions/0002-next-grows-beside-today.md), [clean slate](./docs/direction/clean-slate.md)). How far it is:
[where we are](./docs/plan/README.md#where-we-are-now).

- **Know which version your work is in** before you read or change code. Your brief or ticket says so. If it does not,
  all new work is `next/`, and if you still cannot tell, ask.
- **A search finds both.** Check the path of every file you read before you trust it. A name that exists in both can
  mean different things: a `rev` or a `host` in today's code is not the same as in the decisions.
- **Say which version a claim is about,** in every write-up, note and report. "The host keeps X" is true of one version.
- **In `next/`:** read [`next/AGENTS.md`](./next/AGENTS.md) before you touch a file there.
- **Today's version is frozen**: it keeps running for daily use, and nothing builds on it.
  All new work goes into `next/`, the UX work the owner picks and a product foundation decided in a walk (tokens, focus,
  lint rules for the design, accessibility checks) included; a foundation's build plan is written the same day and comes
  to the owner as one yes. CI runs none of its tests and no guard blocks an edit there. A small visual tryout is allowed
  until `next/`'s Electron window is back; what it teaches goes into `next/` as a lesson, rethought and not copied,
  except an approved guideline, whose rules `next/` follows as written. Today's library is `@kampus/fabrika-old`
  and today's app is `@kampus/fabrika-app-old`; both are deleted when `next/` takes over.
- **The design package is shared by both versions,** the one exception to sharing no code
  ().

## Where to read, where to write

| You want to | Read | Write |
|---|---|---|
| Know what is next and who has the move | [`docs/plan/README.md`](./docs/plan/README.md), then [`tiers.md`](./docs/plan/tiers.md) and [`tier-1.md`](./docs/plan/tier-1.md) | The plan docs, in the same pull request as the work |
| Know what the owner decided | [`.kalfa/decisions/`](./.kalfa/decisions/); see [Decision discovery](#decision-discovery) | `.kalfa/decisions/NNNN-slug.md`, with [`/adr`](./.agents/skills/adr/SKILL.md), only for a hard-to-reverse choice |
| Know where this is going and why, or where `next/` follows a model (OTP, Elm, Kubernetes) and where it leaves it | [`docs/direction/`](./docs/direction/README.md), the long design notes, and [`docs/direction/follows/`](./docs/direction/follows/README.md) | No new note is written there: long reasoning a decision needs goes in the decision's own Context, or in the experiment that holds its evidence; a follows row changes in the pull request that changes that behavior; no folder keeps an index table |
| Know what a word means | [`.glossary/TERMS.md`](./.glossary/TERMS.md), the map of the contexts; each context's `GLOSSARY.md` is written when its words are decided | The term, with an `_Avoid_` line, in its context's `GLOSSARY.md`, in the pull request that coins or renames a word |
| Know how the code is shaped now | [`.patterns/README.md`](./.patterns/README.md) and `rg -n '^(where|when):' .patterns`, then the doc for your change. When a doc and the source disagree, the source wins | `.patterns/<name>.md`, with the [write-pattern skill](./.agents/skills/write-pattern/SKILL.md) |
| Know a design area's guidelines, or write them for one area | `docs/guidelines/<area>.md`, read whole; [the guidelines skill](./.claude/skills/guidelines/SKILL.md) to write them | An edit to the page, in a pull request the owner says yes to; what that skill lists, in its shape |
| Know what was tried and what came back | [`experiments/README.md`](./experiments/README.md) and `ls experiments`, then the write-up | `experiments/NN-short-title.md`, as [its README](./experiments/README.md) says. Raw results go to the private archive, never into git; a script stays on its own branch, named in the write-up |
| Know what happened on real tickets | [`field/README.md`](./field/README.md), then `field/notes/` and `field/runs/` | One file per agent run and one per thing that broke, cost too much, needed a person or worked well, the same day |
| Report something wrong that your task does not cover | [`field/README.md`](./field/README.md#a-finding) | One row file in `field/findings/`, with proof, then keep going; never a security hole |
| Understand a design that is still a draft | `docs/` (for example [`docs/review-machine.md`](./docs/review-machine.md)) | A draft there. When a draft settles a direction, record the decision with [`/adr`](./.agents/skills/adr/SKILL.md); its long reasoning goes in the decision's own Context |
| Build the new version, or change today's machines (`packages/fabrika`, `packages/pipeline`, `programs/*`) | [`next/AGENTS.md`](./next/AGENTS.md), then `docs/direction/`; today's machines are frozen, with the top-level [`README.md`](./README.md#what-is-in-this-repository) as their map and each part's own README | Code in `next/`, with its test beside it as `name.test.ts`: all new work goes there. Outside a package, import it by its name, never by a path; inside one, by relative path. Toy projects used by tests live in `fixtures/` |
| Do an operation by hand: a sev, a wipe of the dev and test homes | [`.runbooks/`](./.runbooks/), the one file for that operation | One file there, the first time the operation is done for real |
| Learn a package by doing it | [`docs/tutorials/`](./docs/tutorials/), one folder per tutorial | A folder there with a `package.json` whose `typecheck` covers the files. Run every step on a fresh clone before it lands |
| Run a real ticket through the pipeline | [the how-to](./docs/how-to/run-a-pipeline-ticket.md) and [its rules](./docs/how-to/run-a-pipeline-ticket.md#the-rules-for-a-live-run) | The run's rows in `field/`, the same day |
| Look at a live run's state and logs | `runs/` on your own machine | Nothing by hand. `runs/` is ignored by git and is never committed |

Tickets go in the app's own tracker, never a GitHub issue on this repo
([the lead skill](./.agents/skills/lead/SKILL.md#tickets-and-tracker-posts)).

**Rule of thumb:** if a piece of knowledge about this project lives only in a chat or in an agent's private memory, it
is in the wrong place: write it here.

## Decision discovery

Decisions live in `.kalfa/decisions/`, in Matt Pocock's ADR format
([`ADR-FORMAT.md`](./.agents/skills/domain-modeling/ADR-FORMAT.md), once that file lands): a title and a few
sentences, with no required frontmatter. Read the ones that apply when you change the choice they govern. An ADR is
written only when the decision is hard to reverse, surprising without context and a real trade-off. Record one with
`/adr` ([skill](./.agents/skills/adr/SKILL.md)).

## Finish your task

For every agent, whatever its step. A step's skill adds its own rules and its own answer format.

- **Finish the whole task.** Do not end your turn while you still owe work the task asked for. Do not end with a list of
  what is left, an offer to continue or a question about whether to go on: do the next part. An error, a timeout, a
  locked file, an empty result, a failing tool or a red check is an ordinary obstacle. Find its cause, then work through
  it with the access you have: wait and retry, fix the command, use another tool. An open question does not hold the
  parts that do not need its answer.
- **Stop only for a real blocker:** something a person decided on purpose (a file another step owns, access that was
  held back, a rule here that says never), a new design call, or work that cannot move without a person. Leave it alone,
  finish everything else, then say plainly what you found and exactly what you need. This loosens no rule here on
  pushes, merges, secrets or history.
- **These need no approval,** in your own worktree and on your own files: `pnpm format` and `pnpm lint`; a fix for a
  lint, format or type error your own change caused; your own narrow test, run again after a change; a command tried
  again after a timeout; an install with `--frozen-lockfile`; a commit of your own paths with the step-commit skill,
  which pushes for you (in a box, `drive.ts` commits and pushes instead); a finding row.
- **Report for a reader who saw none of the work.** Give the answer first, then what changed, what ran, and what could
  not run and why. Write full sentences in plain words, use no name you made up along the way, and give a path or a full
  URL for each thing you cite, so the report stands on its own.
- **A refusal, failure or problem seen a second time** gets its root cause found and a ticket filed, never another
  workaround or another ask.

## How a change lands

Product work goes plan, test writer, build, one review. A ticket with a fix command (lint autofix, codemod, rename) takes
the mechanical branch: run it over the whole repo, one pull request per rule, no plan, no test writer. No agent approves a pull request. The rest is in
[the lead skill](./.agents/skills/lead/SKILL.md#how-a-change-lands), [the plan](./docs/plan/README.md#how-a-change-lands) and
[the tests skill](./.agents/skills/tests/SKILL.md#new-and-changed-laws).

## Before you design anything

Read [the design reference](./.agents/skills/plan/references/design.md) before any plan, design, recommendation or
question to the owner, and when you walk a pull request. It holds how to check what is settled first, the checks a plan
picks, the rules for a design, and how a design document shows its machine in code.

## Checks

```sh
pnpm format     # first, so a diff holds only what was meant: formats and applies safe fixes, in place
pnpm typecheck  # tsc with Effect's own checks (@effect/tsgo): an Effect made and dropped fails it
pnpm lint       # oxlint, oxfmt and stylelint, changing nothing; a warning fails it too
pnpm test
```

Typecheck, lint and test must all pass before a change is offered. None needs a key or the network. A push does not wait
on a local `pnpm typecheck`. Run the narrowest check
that still covers the change, as [Effect's own repo](https://github.com/Effect-TS/effect/blob/main/.agents/AGENTS.md)
asks of its agents. This table adds no rule, and `pnpm format` comes first in every row. No push waits on a local run of
more than about five minutes that CI runs anyway.

| What changed | What to run here |
|---|---|
| Only Markdown that no program or skill reads, or field rows | `pnpm lint`, which checks the added rows too |
| Skill prose | `pnpm lint`, which runs `skillscheck.sh`, its one reader |
| A skill script, or Markdown that a program or skill reads | as code, below |
| Code, in `next/` or today's version | `pnpm lint`, a narrow vitest path while you work, `--changed origin/main` once at the end, then one `pnpm typecheck`. Never the full suite locally |
| A dependency's version | as code, but narrow paths in place of `--changed`, which a lockfile change makes the full suite |
| A script under `experiments/` | `pnpm lint`, and run the changed script once yourself: it is outside the typecheck |
| A tutorial's files | `pnpm typecheck`, and every step on a fresh clone |
| A program's window | as code, plus shots from the real built app at the five layouts ([Changing the product](./.agents/skills/guidelines/references/changing-the-product.md)) |

- **Never switch a lint rule off to pass, and an unused export fails lint**:
  [what to do with each finding](./.agents/skills/build/SKILL.md#lint-findings).
- **A flaky test is fixed the day it is seen**.
- **Which check a plan picks:** [the design reference](./.agents/skills/plan/references/design.md#checks-a-plan-picks).

### Go easy on the machine

These run on a laptop a person is using, so every agent brief carries these caps
([the lead skill](./.agents/skills/lead/SKILL.md#go-easy-on-the-machine) has the long form).

- **Tests:** `nice -n 15 pnpm exec vitest run --maxWorkers=3`, a narrow path while you work, then
  `--changed origin/main` once at the end. Never the full suite locally: the test config refuses it.
- **With two or more code agents running:** `nice -n 19`, `--maxWorkers=1`, one `pnpm typecheck` at the very end.
- **Shared resources stay capped:** one `pnpm typecheck` at a time, one Electron test app and one Docker box. A wait or poll loop runs in the background.
- Never run the sandbox runtime or a shimmed tool with `env -i` or `HOME` unset while a version-manager shim is on
  `PATH`: one run made about 7,000 processes. Set `ulimit -u` in a subshell first.

Tool facts that cost us time (`gh pr edit`, `claude -p` tools, `rg` and dot folders), money and `pnpm build`:
[the lead skill](./.agents/skills/lead/SKILL.md#tool-facts-that-cost-us-time) and
[its money rules](./.agents/skills/lead/SKILL.md#money).

## This repo is public

- No secrets, and never print or write a key.
- A list of open security holes stays out of this repo. Each fix lands as a normal pull request.
- No absolute paths from anyone's machine. Use repo-relative paths or `~`. No personal names or account names, except inside a license notice the law requires (an upstream LICENSE file).
- Never quote what a person typed in a chat session. Record the decision, not the conversation. Text a person posted
  publicly on an issue or pull request may be linked and summarised.

## How to write here

Write-ups are read by busy people, some of them not native English speakers.

- Plain everyday words and short sentences. Give the answer first.
- American English everywhere: color, behavior, canceled. Saved prompts, results and stored data values stay as they
  are.
- Size work in files, lines and agent hours, never human days. At most one simple table per section. No box drawings.
- Every recommendation says why, what it costs, and how sure you are. Under about 80% sure, name the doubt and what
  would settle it.
- A write-up ends with what it cannot tell us. A run that shows what breaks is as useful as a clean one; do not smooth a
  failure over. Guesses that turned out wrong stay in the record, marked as wrong.
- Code holds what must hold every time; a plain prompt holds judgment.

## Changing files

- Move files with `git mv`, so history follows.
- Stage your own paths by name. Another session may have work in the same checkout.
- Push every commit when you make it, and give its branch a draft pull request at the first commit.

## Changing the product

For a change to what a person sees or uses, read
[the rules for changing the product](./.agents/skills/guidelines/references/changing-the-product.md) first. Its bullets
that others cite by name: "The daily moment comes first", "No extra containers", "Linear as the builder", "Pick the look
before the PR", "Show it running" and "Shoot more than one layout".
