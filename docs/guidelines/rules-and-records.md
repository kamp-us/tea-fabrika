**Approved 2026-11-18.** By [0604](../../.decisions/0604-rules-and-records-guidelines-approved.md), from [experiment 298](../../experiments/298-rules-and-records-guidelines.md).
This area has no screen, so it has no Design canvas.

Where a rule lives, for code and for agents: decisions, skills, `AGENTS.md`, pattern docs, the
glossary, checks and settings. It covers today's tooling and the records both versions read. The
aim: a stale, repeated or contradictory rule cannot grow back, because the shape and the checks
stop it, not a cleanup.

```text
a ruling   -> .decisions/NNNN-slug.md   why the owner ruled, about a page, links the home
           -> one edit to the rule's home, in the same pull request
the home   -> a check or a config file, if code can hold the rule
           -> else the instruction read for that job: a skill, a folder's AGENTS.md,
              a pattern doc, a guideline page, a runbook
           -> else the record itself, edited in place until code or an instruction takes it
a reader   -> reads the home; git log is its history; the record says why
```

## R1: one home per rule, picked by what holds it

- **Kind:** taste.
- **Means:** A rule lives in exactly one place. If a check, a type or a config file can hold it,
  that is its home. Else it lives in the instruction already read for that job. Else it stays in
  its own decision record until one of those can take it. A record that is not a rule's home holds
  no copy of it, only why and a link.
- **Why:** the Rust RFC process says "once accepted, RFCs should not be substantially changed",
  and a feature lands only with "a complete PR to the Reference describing the feature"
  ([RFCs](https://github.com/rust-lang/rfcs/blob/master/README.md),
  [stabilization](https://rustc-dev-guide.rust-lang.org/stabilization-guide.html)): the proposal is
  history, the Reference is the rule.
- **Example:** which jobs run where lives in `.github/ci/changes.mjs`, `.github/workflows/scheduled.yaml`
  and `.github/ci/workflow-lint/issues.ts`; [0534](../../.decisions/0534-the-merge-line-runs-changed-tests-a-schedule-runs-all.md)
  keeps why the merge line never runs the full suite.
- **Held by:** the review. No check can tell a rule's best home.
- **Breaks today:** `.decisions/0023-next-follows-effects-code-style.md:90-91` type the indent as
  "tabs" and the width as "100"; `.oxfmtrc.json:7` and `:9` hold `"useTabs": false` and
  `"printWidth": 120`.

## R2: a rule changes where it lives, and no record patches another

- **Kind:** lint.
- **Means:** A change to a rule edits its home, in the same pull request as the short record of
  why. A record gets no `## Amendments` section, no "the rest still holds" line and no "carried
  forward" copy. A record whose why was reversed is superseded whole.
- **Why:** consolidated law keeps "The latest available revised version of the legislation
  incorporating changes", and the amending act stays as enacted
  ([legislation.gov.uk](https://www.legislation.gov.uk/help)).
- **Example:** [0581](../../.decisions/0581-main-full-run-starts-on-push-and-hourly.md) changed when
  the full run starts by editing `.github/workflows/scheduled.yaml` (`cron: "17 * * * *"`).
- **Held by:** [0605](../../.decisions/0605-no-record-patches-another.md): a records check in
  `pnpm lint`, in `@kalfa/records`, that fails those headings and lines in `.decisions/`. Built by
  [the build plan](../plan/quests/rules-and-records-build-PLAN.md).
- **Breaks today:** `.decisions/0534-the-merge-line-runs-changed-tests-a-schedule-runs-all.md:89`,
  an `## Amendments` section, while its title at `:3` still says "every 3 hours";
  `.decisions/0023-next-follows-effects-code-style.md:40`, "the rest of this file still holds".

## R3: code holds what it can, and prose points at it

- **Kind:** taste.
- **Means:** Prose keeps only judgment ([0408](../../.decisions/0408-skills-keep-only-judgment.md)).
  A fact a config file or the lockfile owns (a version, an interval, a cap, a width, a list of
  paths) is named by file and key, never typed. A check's own message teaches its rule. An example
  an agent copies is code that runs or typechecks.
- **Why:** Claude Code treats instruction files "as context, not enforced configuration"
  ([memory docs](https://code.claude.com/docs/en/memory)); Effect's repo says "Do not edit
  generated output directly" and generates `LLMS.md` from compiled examples in `ai-docs/src`
  ([Effect's AGENTS.md](https://github.com/Effect-TS/effect/blob/main/.agents/AGENTS.md)).
- **Example:** `.github/ci/workflow-lint/issues.ts:16`, a check whose message says the rule and its
  why: `"only scheduled.yaml's report job and ci-speed.yaml's measure job may touch issues (0534, 0541)"`.
- **Held by:** [0408](../../.decisions/0408-skills-keep-only-judgment.md) and the review.
- **Breaks today:** `.decisions/0023-next-follows-effects-code-style.md:12` names `effect@4.1.2`;
  the lockfile pins `effect@4.1.3`.

## R4: a record is accepted or superseded, and its status is data

- **Kind:** lint.
- **Means:** A record's status has two cases: `accepted`, or `superseded` with the one record that
  replaced it. There is no "amended in part": a partial change edits the rule's home (R2), and the
  new record says in its context what it changed. The status is a Schema, not Markdown links in a
  string.
- **Why:** MADR's status is "proposed | rejected | accepted | deprecated | … | superseded by
  ADR-0123" ([MADR](https://adr.github.io/madr/)); Nygard's reversed record is kept and you "mark
  it as superseded" ([Nygard](https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions)).
- **Example:** `.decisions/0146-a-pull-request-lands-only-on-ci-that-saw-main.md:4`, a whole
  reversal: `status: superseded by [0162](0162-no-friction-before-a-merge.md)`.
- **Held by:** [0606](../../.decisions/0606-a-record-is-accepted-or-superseded.md): the frontmatter
  Schema in `@kalfa/records`, checked by `pnpm lint`. Built by [the build plan](../plan/quests/rules-and-records-build-PLAN.md).
- **Breaks today:** 116 records say `amended-in-part`, such as
  `.decisions/0534-the-merge-line-runs-changed-tests-a-schedule-runs-all.md:4`, with five links;
  `.decisions/0012-twelve-agents-at-once.md:4` is patched by a record that is itself superseded.

## R5: every link lands on a live home

- **Kind:** lint.
- **Means:** No instruction file, plan file, pattern doc, glossary row or code comment links a
  superseded record. A link meant to state a rule goes to the rule's home, not to a record that
  once held it.
- **Why:** "if two instructions contradict each other, Claude may pick one arbitrarily"
  ([memory docs](https://code.claude.com/docs/en/memory)).
- **Example:** `node .agents/skills/lead/scripts/records.ts resolve 0146` prints
  `0146  superseded  live: .decisions/0162-no-friction-before-a-merge.md`.
- **Held by:** [0607](../../.decisions/0607-every-link-lands-on-a-live-record.md): a link check in
  `pnpm lint` that resolves each link in those files. Built by [the build plan](../plan/quests/rules-and-records-build-PLAN.md).
- **Breaks today:** `docs/plan/README.md:243` links superseded 0146 to say a pull request "now"
  lands only on CI that saw main; `AGENTS.md:210` says 0023 "lists the differences", and that list
  is stale.

## R6: the map every agent reads fits its readers' limits

- **Kind:** lint.
- **Means:** The files every agent reads (the root `AGENTS.md`, and a folder's `AGENTS.md` read
  with it) stay under the smallest documented limit of the agents that read them. The number is a
  setting with its source beside it, never one picked by hand.
- **Why:** Codex "stops adding files once the combined size reaches the `project_doc_max_bytes`
  limit", "(32 KiB by default)" ([Codex](https://developers.openai.com/codex/guides/agents-md));
  Claude Code's advice is "target under 200 lines per CLAUDE.md file"
  ([memory docs](https://code.claude.com/docs/en/memory)).
- **Example:** Effect's repo `AGENTS.md` is about 55 lines: layout, the narrowest check for each
  kind of change, and generated files.
- **Held by:** [0610](../../.decisions/0610-agents-md-follows-memory-guide.md): `AGENTS.md` follows
  Claude Code's memory guide and stays under 200 lines. Built by [the build plan](../plan/quests/rules-and-records-build-PLAN.md).
- **Breaks today:** `AGENTS.md` is 39,103 bytes; at 32 KiB a reader stops at line 389, before
  "How to write here" (`AGENTS.md:396`). With `next/AGENTS.md` it is 49,516 bytes.

## R7: a byte-for-byte check guards only bytes a person approved

- **Kind:** taste.
- **Means:** A check that compares exact bytes or a hash stays only where a person approved those
  exact bytes (a plan the lead approved, a diff a reviewer saw) or where a copy must stay faithful
  (a patch's quoted upstream lines). Anything else compares parsed values or the formatter's
  output. Each such check says in its header what it guards.
- **Why:** a Google compiler check should "produce no effective false positives (the analysis
  should never stop the build for correct code)" ([CACM 2018](https://6826.csail.mit.edu/2020/papers/google-analysis-cacm.pdf)).
  A hash of bytes nobody approved stops the build for a blank line.
- **Example:** `.agents/skills/lead/scripts/box.sh:102` refuses a plan whose body hash is not the
  `plan-sha256` the lead approved; the product does the same for a ticket
  ([0343](../../.decisions/0343-an-approval-covers-its-text.md)).
- **Held by:** the review.
- **Breaks today:** `.agents/skills/lead/scripts/skillscheck.sh:18-19` require exact sentences in
  several skills, which keeps copies alive ([experiment 283](../../experiments/283-context-audit.md)).

## R8: a finding seen twice becomes a check, measured before it blocks

- **Kind:** taste.
- **Means:** When a review or a finding row names the same kind of fault a second time, the fix is a
  check, not another sentence: a trusted tool's rule first
  ([0573](../../.decisions/0573-trusted-lint-rule-replaces-ours.md)), else ours. It advises until
  its false alarms are measured and blocks only at about zero.
- **Why:** "Developers, not tool authors, will determine and act on a tool's perceived
  false-positive rate", and a review check should "Produce less than 10% effective false positives"
  ([CACM 2018](https://6826.csail.mit.edu/2020/papers/google-analysis-cacm.pdf)).
- **Example:** who may open GitHub issues was a line in 0534; it is now
  `.github/ci/workflow-lint/issues.ts`.
- **Held by:** the review, and AGENTS.md's "seen a second time" rule.
- **Breaks today:** `.agents/skills/guidelines/SKILL.md:171` asks for an index row that
  [0522](../../.decisions/0522-no-folder-keeps-an-index-table.md) forbids; another guidelines pull
  request already filed it as a finding, and this study met it a second time.
