
Plancheck-Version: 3

# Plan: the rules and records checks, and the cleanup of today's records they would fail, in our tooling

This is our tooling (`kalfa/`, `.agents/`, the root `package.json`) and the records both versions
read (`.decisions/`, `AGENTS.md`, `next/AGENTS.md`, `docs/plan/`). No product code changes, in
today's app or in `next/`. It builds the approved
[rules and records guidelines](../../guidelines/rules-and-records.md)
([0604](../../../.decisions/0604-rules-and-records-guidelines-approved.md)) and its four lint
decisions: [0605](../../../.decisions/0605-no-record-patches-another.md) (R2, no record patches
another), [0606](../../../.decisions/0606-a-record-is-accepted-or-superseded.md) (R4, two statuses,
typed), [0607](../../../.decisions/0607-every-link-lands-on-a-live-record.md) (R5, no link to a
superseded record) and [0608](../../../.decisions/0608-the-map-fits-its-readers-limits.md) (R6, the
map fits its readers' limit). The checks live in a new `@kalfa/records`
([0585](../../../.decisions/0585-kalfa-is-six-domain-packages.md)).

```ts
// The whole idea, as a sketch. One command, four checks, each a Finding case, run by `pnpm lint`.
// $ node kalfa/records/src/bin.ts check
// .decisions/0534-the-merge-line-runs-changed-tests-a-schedule-runs-all.md:4  status: amended-in-part
//   is not a status. A status is `accepted`, or `superseded` with `successor: "NNNN"` (0606).
// .decisions/0534-the-merge-line-runs-changed-tests-a-schedule-runs-all.md:89  `## Amendments`:
//   edit the rule where it lives and say why in the new record; no record patches another (0605).
// docs/plan/README.md:300  links 0146, which is superseded; link 0162, or the rule's home (0607).
// AGENTS.md + next/AGENTS.md  49,582 bytes, over records.map.max-bytes 32,768 (Codex's
//   project_doc_max_bytes default, 0608).
// 4 findings; exit 1
```

Nine slices. Seven clean today's records up, two build and turn on the checks. No two slices edit
the same file, so slices 1 to 6 and slice 8 run in parallel; slice 7 follows slices 1 to 5. Slice 9
turns every check on in `pnpm lint`, and lands only after slices 1 to 8 are on main.

## Doubts, first

- **R6's cut is bigger than the experiment said.** Experiment 298 sized "about 7 KB from the root
  file". 0608 counts the root with `next/AGENTS.md` read after it: 49,582 bytes today against
  32,768, a cut of about 16.8 KB across both files, or about 34%. Slice 6 does it under 0129's
  rules (a table row for every line removed, no rule changed). If the cut cannot reach the limit
  without dropping a rule, slice 6 stops and the lead takes it to the owner; slice 9 waits.
- **The successor key** is `successor`, the experiment's smaller call 1 at 70%. The owner approved
  the eight principles at their leans; this smaller call was not named, and 0606 leaves the key to
  this plan. It decides only how the code does what 0606 says, so it is this plan's call.
- **`records.ts` keeps a status reader of its own** until 0585's records plan moves its commands
  into `@kalfa/records`. Two readers of one shape is a copy, which R1 does not like. The small fix
  ships here (slice 7 makes it read the two cases and the `successor` key), and the move is
  ticketed (see Findings). Importing the package from `.agents/` would need a root dependency,
  which would put the root `package.json` in two slices.
- **Where the size check lives.** 0585 lists a `sizecap` under `@kalfa/ci/checks`, which does not
  exist yet. The map size check goes in `@kalfa/records` beside the link check, which already reads
  the same instruction files. 75%; it moves if the ci plan says so.

## What was run for this plan

Read on 2026-11-18, on `origin/main` merged into this branch at `3aa6551e1`:

```text
$ grep -l '^status: amended' .decisions/*.md | wc -l              126 records
$ grep -l '^## Amendments' .decisions/*.md | wc -l                 72 records
$ grep -l -i -E 'still holds|carried forward' .decisions/*.md      45 records
  union of the three, by number:  0001-0049  36   0050-0099  30   0100-0199  43
                                  0200-0499  34   0500-0603  46   (189 records; 187 without
                                  the superseded 0034 and 0588)
$ grep -l '^status: superseded' .decisions/*.md                     9 records:
  0034 0097 0146 0150 0156 0518 0540 0588 0596  (0034 and 0588 also hold an Amendments
  section or a still-holds line)
links to a superseded record, outside records, experiments, field rows and direction notes:
  docs/plan/README.md:300 -> 0146        (the only one; no skill, pattern, glossary row or
                                          code comment links one)
typed values a config owns, stated as current:
  .decisions/0023-next-follows-effects-code-style.md:12, :52   effect@4.1.2; the lockfile pins 4.1.3
  .decisions/0023-next-follows-effects-code-style.md:90, :91   tabs, 100; .oxfmtrc.json holds
                                                               useTabs false, printWidth 120
  .decisions/0534-the-merge-line-runs-changed-tests-a-schedule-runs-all.md:3   "every 3 hours";
                                                               .github/workflows/scheduled.yaml holds the cron
$ wc -c AGENTS.md next/AGENTS.md                                39,103 + 10,479 = 49,582
readers of the amended form: .agents/skills/adr/SKILL.md (steps 4 and 5),
  .agents/skills/lead/scripts/records.ts (readStatus, the "amended by" lines) and its test
```

## How others do it

- **MADR** has statuses "proposed | rejected | accepted | deprecated | … | superseded by ADR-0123",
  and no "amended" ([MADR](https://adr.github.io/madr/)). **Nygard** keeps a reversed record and
  marks it superseded ([Nygard](https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions)).
  log4brains and adr-tools read status from the record's own header, one value per record.
- **Consolidated law** keeps one revised text and leaves each amending act as enacted
  ([legislation.gov.uk](https://www.legislation.gov.uk/help)). That is the cleanup: fold each
  amendment into the older record's text, and leave the amending record as it was written.
- **Link checkers** (`markdown-link-check`, `lychee`) check that a link's target exists, not what
  the target says. None knows a record's status, so the status part is ours; the link scanning
  follows theirs: Markdown links only, fenced code skipped.
- **Codex** "stops adding files once the combined size reaches the `project_doc_max_bytes` limit",
  32 KiB by default ([Codex](https://developers.openai.com/codex/guides/agents-md)). That is the
  default of the size setting, with the link in its doc text.
- **Elm and OTP:** a tagged union makes "amended in part by five records, one of them superseded"
  unrepresentable; OTP's `whereis` always names a live process, which is what the link check asks
  of a record link.
- **Effect:** `Schema.TaggedUnion` for the status and the findings, `effect/cli` for the
  command, as `kalfa/quality/src/cli.ts` does, and `@kalfa/config`'s `Setting.make` for the limit.

## The shape

### The status, and a decision's frontmatter (slice 8)

```ts
// kalfa/records/src/Status.ts, a sketch. Read from frontmatter that `yaml` has parsed.
export const DecisionId = Schema.String.check(Schema.isPattern(/^\d{4}$/));

export const Status = Schema.TaggedUnion({
  accepted: {},
  superseded: { successor: DecisionId },
});

// kalfa/records/src/Frontmatter.ts, a sketch: the keys every decision has today.
export const Decision = Schema.Struct({
  id: DecisionId,
  title: Schema.NonEmptyString,
  status: Schema.Literals(["accepted", "superseded"]),
  successor: Schema.optional(DecisionId),
  date: Schema.String.check(Schema.isPattern(/^\d{4}-\d{2}-\d{2}$/)),
  tags: Schema.Array(Schema.String),
});
// decodeStatus: { status: "superseded", successor: "0162" } -> Status.superseded({ successor: "0162" })
//               { status: "superseded" }                   -> a status Finding: no successor
//               { status: "accepted", successor: "0162" }  -> a status Finding: an accepted record names none
//               { status: "amended-in-part by [0539](...)" } -> a status Finding
```

```yaml
# a superseded record's frontmatter after slice 7
status: superseded
successor: "0162"
```

### The findings, one union for the four checks

```ts
// kalfa/records/src/Finding.ts, a sketch. Each case prints one line that names the place and
// says what to do instead, with its decision; the message is where the rule is taught (R3).
export const Finding = Schema.TaggedUnion({
  status: { path: Schema.String, line: Schema.Int, raw: Schema.String }, // 0606
  patch: {
    path: Schema.String,
    line: Schema.Int,
    form: Schema.Literals(["amendments", "still-holds", "carried-forward"]),
  }, // 0605
  link: { path: Schema.String, line: Schema.Int, target: DecisionId, live: DecisionId }, // 0607
  map: { chain: Schema.Array(Schema.String), bytes: Schema.Int, max: Schema.Int }, // 0608
});
```

### What each check reads

```text
status   every .decisions/NNNN-slug.md, its frontmatter; id equals the file's number; a successor
         names a record that exists
patch    every .decisions/NNNN-slug.md body, outside fenced code and inline code:
           a heading `## Amendments`
           a line matching /\b(the )?rest\b[^.]{0,60}\b(still )?holds\b/i
           a line matching /\bcarried forward\b/i
link     Markdown links [text](target) and, in code comments, `.decisions/NNNN-slug.md` paths, in:
           AGENTS.md and CLAUDE.md files, .agents/skills/**, docs/guidelines/**, .runbooks/**,
           docs/plan/**, .patterns/**, .glossary/**, and the comments of tracked .ts, .tsx, .js,
           .mjs, .sh and .yaml files outside experiments/ and field/
         a target whose record is superseded is a finding naming its successor
         not read: .decisions/, experiments/, field/, docs/direction/ (history, 0607); fenced code;
         symlinks (.claude/skills/ links into .agents/skills/, read once there)
map      the root AGENTS.md alone, then the root plus each folder's AGENTS.md (git ls-files), in
         bytes, against records.map.max-bytes
```

### The setting

```ts
// kalfa/records/src/Settings.ts, a sketch, on @kalfa/config (0069, 0086).
const app = App.make({ name: "kalfa", list: "kalfa config get" });

export const maxBytes = app.Setting.make("records.map.max-bytes", {
  schema: Schema.Int.check(Schema.isGreaterThan(0)),
  default: 32_768,
  doc:
    "The most bytes of AGENTS.md an agent reads in one chain, root first (0608). Codex's " +
    "project_doc_max_bytes default, https://developers.openai.com/codex/guides/agents-md.",
  scope: ["repo"],
  reload: "restart",
  since: "0.0.0",
});
// environment: KALFA_RECORDS_MAP_MAX_BYTES; repo file: .kalfa/kalfa.toml [records.map] max-bytes
```

**Is this a setting?** The limit is, by 0608. Nothing else is: the folders the link check reads and
the patch phrasings are the rule itself, decided in 0605 and 0607, and a new phrasing is added
when a review meets it a second time (R8), by a pull request, not a knob.

### The command

```text
node kalfa/records/src/bin.ts check            all four, every finding, exit 1 if any
node kalfa/records/src/bin.ts check status     one check (status, patch, link, map)
```

`src/cli.ts` exports the `effect/cli` command as `./cli`, with
`"kalfa": { "cli": "./cli" }` in `package.json`, as `@kalfa/quality` does, so `kalfa records check`
works once `@kalfa/cli` exists. `bin.ts` is the edge that runs it with the Node layers, as
`pnpm lint` needs a file to run today.

### How a cleanup slice folds an amendment (slices 1 to 5)

```text
before  0534  title: "... a schedule runs every 3 hours"
              status: amended-in-part by [0539], [0541], [0581], [0590], [0595]
              ## Amendments
              - 2026-11-16 (0581): the full run starts on push to main and hourly ...
after   0534  title: "... a schedule runs every test, its times in .github/workflows/scheduled.yaml"
              status: accepted
              the body says what holds now, in place; where a config or a check holds a value,
              the body names the file and key; no Amendments section
        0581  unchanged, unless it holds a still-holds line, which goes (0581 is in slice 5's
              range; slice 5 owns that edit)
```

- Each record in the range: read it and every record its status links, then write what holds now
  into its own text, keep its why, keep its file name and number, and set `status: accepted`.
- A title that no longer says what the record decides is retitled, frontmatter and heading
  together.
- A record whose why was reversed whole is not edited by slices 1 to 5. Its slice names it in its
  pull request, and slice 7 marks it superseded.
- An amendment by a superseded record (0012, 0032, 0049 today) is folded only as far as the
  record that superseded it still holds it.
- A typed value a config or the lockfile owns, stated as current, is replaced by its file and key
  (the starters are the three in "What was run").
- A record in the range that is itself an amending record loses only its still-holds and
  carried-forward lines; its Context keeps saying what it changed.
- Every edit changes no rule. A fold that would change one becomes a question to the lead.

## One value, traced

`0146`, a superseded record, through slices 6, 7, 8 and 9.

1. Today `.decisions/0146-a-pull-request-lands-only-on-ci-that-saw-main.md:4` reads
   `status: superseded by [0162](0162-no-friction-before-a-merge.md)`, and `docs/plan/README.md:300`
   links 0146 for how a pull request lands "now".
2. Slice 6 changes that sentence in `docs/plan/README.md` to link 0162.
3. Slice 7 writes `status: superseded` and `successor: "0162"` into 0146, and `records.ts` reads
   them: `records.ts resolve 0146` still prints
   `0146  superseded  live: .decisions/0162-no-friction-before-a-merge.md`.
4. Slice 8's `decodeStatus` gives `{ _tag: "superseded", successor: "0162" }`; the link check, run
   on a fixture where a plan links 0146, gives
   `{ _tag: "link", path: "docs/plan/README.md", line: 300, target: "0146", live: "0162" }`.
5. Slice 9 turns the check on; `pnpm lint` on main prints no finding. A later pull request that
   links 0146 from a skill fails `pnpm lint` with the line from the opening sketch.

## Laws

All laws are slice 8's and slice 9's. The cleanup slices change no code; their proof is slice 9's
first green `pnpm lint`, and their review reads every fold.

| Law | Kind (lint, type or test?) | Generator | Plant | Where |
|---|---|---|---|---|
| L1, the status decodes to exactly two cases: an `accepted` record with no successor, and a `superseded` one with a four-digit successor, give their case; every other value (`amended-in-part by` with links, `proposed`, `superseded by [NNNN](...)`, `superseded` with no successor, `accepted` with one, an empty status) gives one `status` finding with the file and line | test | fc.constantFrom: the valid and invalid shapes, with fc.integer ids 1 to 9999 padded to four digits, seed 119120, 200 runs | add an `amended` case to `Status`: the amended shapes decode, L1 red | kalfa/records/src/Status.test.ts |
| L2, a decision's frontmatter: `id` equals the file's four-digit number, and a successor names a record in the same folder; a missing successor file or a mismatched id gives a `status` finding | test | fc.integer: a folder of 2 to 20 generated records in a temp directory, seed 119120, 100 runs | drop the successor lookup: a successor naming no file passes, L2 red | kalfa/records/src/Frontmatter.test.ts |
| L3, the patch check: an `## Amendments` heading, a still-holds line and a carried-forward line each give one `patch` finding with its line and form; the same text inside a fenced block, inside inline code, or as `### Amendments` under a plan file outside `.decisions/` gives none; a history line ("0146 was superseded on 2026-11-12") gives none | test | fc.constantFrom: the three forms and eight phrasings each, placed at generated lines among generated prose, seed 119120, 200 runs | stop skipping fenced code: 0605's own opening block gives findings, L3 red | kalfa/records/src/Patches.test.ts |
| L4, the patch check on the real records: 0605, 0606, 0607 and 0608, which quote the forbidden forms in fences and code, give no finding | test | scenario: the four files as committed | match the still-holds pattern on the raw text: 0605 fails, L4 red | kalfa/records/src/Patches.test.ts |
| L5, the link check: a Markdown link or a code-comment path to a superseded record, in a file under the scope, gives one `link` finding naming the successor; a link to an accepted record, a link in fenced code, a bare number, and any link from `.decisions/`, `experiments/`, `field/` or `docs/direction/` give none; a symlinked file is not read | test | fc.constantFrom: the scope's folders and the history folders, crossed with link forms (inline, reference-style, angle-bracket target, `./` and `../` paths, a `#anchor`), seed 119120, 200 runs | treat `docs/direction/` as in scope: the history links give findings, L5 red | kalfa/records/src/Links.test.ts |
| L6, the map check: with generated byte sizes for the root and up to three folder files, a finding comes exactly when the root alone, or the root plus one folder file, is over the limit; each finding names its chain and its bytes | test | fc.integer: sizes 0 to 70,000 and limits 1 to 70,000, seed 119120, 300 runs | compare each folder file alone, not with the root: a 20 KB root plus a 15 KB folder passes at 32,768, L6 red | kalfa/records/src/MapSize.test.ts |
| L7, the limit is the setting: its default is 32,768, its doc text holds the Codex docs URL, and `KALFA_RECORDS_MAP_MAX_BYTES=100` makes a 101-byte root fail and a 100-byte root pass | test | scenario: `@kalfa/config`'s `Load.load` with an in-memory file service, as its README does | hard-code 32,768 in `MapSize.ts`: the environment value is ignored, L7 red | kalfa/records/src/Settings.test.ts |
| L8, the command: `check` runs all four on a fixture repo and prints one line per finding in path order, then the count, exit 1; on a clean fixture it prints nothing and exits 0; `check link` runs only that check | test | scenario: two fixture folders written in a temp directory by the test, one with one finding of each kind, one clean | make `check` stop at the first check with findings: three lines are missing, L8 red | kalfa/records/src/cli.test.ts |
| L9, `records.ts` reads the new shape: `status: superseded` with `successor: "NNNN"` resolves to that record; `accepted` resolves to itself with no "amended by" line; any other status shows as `other` with its raw text | test | fc.integer: ids 1 to 9999 padded, seed 119120, 100 runs | read the successor from a `[NNNN]` link in the status line only: the new shape shows no live record, L9 red | .agents/skills/lead/scripts/records.test.ts |
| L10, the checks are on: the root `lint` script runs `node kalfa/records/src/bin.ts check`, so a planted `## Amendments` heading in a decision fails `pnpm lint` | lint | lint | leave the entry out of the root `lint` script: the planted heading passes `pnpm lint`, L10 red | package.json |

No law here needs the real machine: no launchd, no Electron, no process signal. The tests read temp
folders and fixtures only.

## Files

| File | Owner | Product lines expected | What |
|---|---|---|---|
| .decisions/0001-decisions-live-in-the-repo.md .decisions/0003-a-clean-repo-kept-clean-by-code.md .decisions/0004-squash-merges-and-native-stacks.md .decisions/0005-patterns-and-decisions-are-visual.md .decisions/0006-no-unused-exports.md .decisions/0007-drive-is-the-pipeline-lab.md .decisions/0008-decision-discovery-is-the-agents-md-contract.md .decisions/0011-leak-check-allows-plain-tmp-paths.md .decisions/0012-twelve-agents-at-once.md .decisions/0014-the-lead-merges-when-every-step-passed.md .decisions/0016-tier-1-supervision-is-otps-top-level-supervisor.md .decisions/0017-each-model-we-follow-has-one-table.md .decisions/0018-one-application-per-program.md .decisions/0020-programs-get-hard-walls.md .decisions/0021-a-blank-line-between-top-level-statements.md .decisions/0022-codex-steps-run-on-astra-at-medium.md .decisions/0023-next-follows-effects-code-style.md .decisions/0026-fabrika-never-owns-the-agent-loop.md .decisions/0029-format-and-names-follow-effect.md .decisions/0030-copy-clankas-shapes-where-better.md .decisions/0031-lane-tooling-dogfoods-fabrikas-primitives.md .decisions/0032-libraries-take-effects-file-layout.md .decisions/0033-agents-code-follows-next-rules.md .decisions/0035-outside-work-becomes-finding-rows.md .decisions/0036-a-flaky-test-is-fixed.md .decisions/0037-implicit-state-machines-made-explicit.md .decisions/0039-keep-semicolons-and-es5-commas.md .decisions/0040-existing-tools-before-hand-written.md .decisions/0041-object-classes-are-effect-objects.md .decisions/0042-platform-pieces-go-through-alchemy.md .decisions/0043-rooms-on-floors.md .decisions/0045-test-steps-run-in-containers.md .decisions/0046-one-tea-machine-per-file.md .decisions/0047-respaced-line-is-old-text.md .decisions/0049-merge-behind-main-once-lint-passes-on-the-true-merge.md | build | docs | Slice 1: the 35 records from 0001 to 0049, each folded as "How a cleanup slice folds" says; 0012, 0032 and 0049 drop their superseded patch; 0023's lines 12, 52, 90 and 91 name `pnpm-lock.yaml` and `.oxfmtrc.json`'s keys; 0034 is slice 7's |
| .decisions/0051-gateway-connection-and-node-by-job.md .decisions/0054-read-upstream-before-patching-it.md .decisions/0055-errors-named-by-their-service.md .decisions/0056-lead-runs-a-refused-step-itself.md .decisions/0059-pipeline-starts-from-the-work.md .decisions/0062-test-files-keep-the-floors.md .decisions/0063-todays-app-lanes-share-the-slots.md .decisions/0066-mutation-runs-on-a-schedule.md .decisions/0067-hourly-mutation-runs-in-ci.md .decisions/0068-tiers-carry-every-part.md .decisions/0070-flow-runner-stays-a-machine.md .decisions/0071-risk-tier-decides-who-looks.md .decisions/0072-a-churning-lane-is-redone.md .decisions/0074-agent-hands-over-a-flow.md .decisions/0075-cold-author-checks-outside-programs.md .decisions/0076-a-lane-stops-at-its-budget.md .decisions/0078-agent-and-flow-slices-start-early.md .decisions/0079-size-counts-governed-paths-name-who.md .decisions/0081-no-question-word-names.md .decisions/0082-approvals-is-a-floor-for-every-run.md .decisions/0083-every-program-in-a-pack.md .decisions/0084-own-pack-listed-by-path.md .decisions/0087-a-pull-request-caps-product-lines.md .decisions/0088-six-slices-in-tier-1.md .decisions/0089-mutation-covers-lane-code.md .decisions/0093-laws-walk-plants-run-once.md .decisions/0095-a-service-file-holds-only-its-contract.md .decisions/0096-the-lead-fixes-forward-while-the-owner-is-away.md .decisions/0098-the-signed-chain-covers-the-branch-not-main.md .decisions/0099-no-number-caps-a-pull-request.md | build | docs | Slice 2: the 30 records from 0050 to 0099; 0097 is slice 7's |
| .decisions/0103-a-program-may-mail-another-by-name.md .decisions/0107-fabrika-provides-the-merge-queue.md .decisions/0109-a-pipe-is-saved-program-mail.md .decisions/0113-no-shell-or-python-scripts.md .decisions/0114-effects-team-as-the-builder.md .decisions/0115-decided-rules-live-in-decision-files.md .decisions/0116-github-requires-ci-required-on-main.md .decisions/0117-every-mutation-gap-gets-a-ticket.md .decisions/0118-no-since-tag-before-a-release.md .decisions/0119-an-errors-reason-is-a-tagged-error.md .decisions/0120-effect-code-guidelines.md .decisions/0123-githubs-schedule-starts-the-mutation-run.md .decisions/0125-the-example-program-is-a-checklist.md .decisions/0128-a-write-up-is-born-in-the-repo.md .decisions/0129-agents-md-becomes-a-short-map.md .decisions/0130-every-piece-of-knowledge-has-one-home.md .decisions/0132-a-path-pack-may-sit-anywhere.md .decisions/0133-no-push-waits-on-a-local-typecheck.md .decisions/0134-no-code-stays-only-on-a-local-branch.md .decisions/0135-a-laws-file-pins-its-shapes-to-the-schema.md .decisions/0136-guidelines-live-in-their-own-pages.md .decisions/0138-email-recovery-lets-in-at-once.md .decisions/0140-gateway-refuses-client-id-and-by.md .decisions/0143-a-refused-write-is-counted-never-a-row.md .decisions/0147-the-brain-keeps-reserved-room-for-recovery-writes.md .decisions/0149-notes-and-drawing-laws-leave-the-tier-1-exam.md .decisions/0151-a-thin-inbox-is-a-tier-1-row.md .decisions/0152-the-recovery-byte-allowance-is-a-rate.md .decisions/0154-the-brain-mails-the-inbox-one-letter-per-notice.md .decisions/0158-no-dms-only-rooms.md .decisions/0159-fabsh-pipes-summon-join-first.md .decisions/0161-no-step-signing-by-hand.md .decisions/0162-no-friction-before-a-merge.md .decisions/0164-the-bot-stays-without-signing.md .decisions/0166-owed-work-needs-no-owner-read.md .decisions/0168-old-lint-breaks-are-fixed.md .decisions/0172-a-timers-start-is-its-owners.md .decisions/0173-child-root-and-requester.md .decisions/0174-a-queue-run-follows-its-paths.md .decisions/0175-every-run-follows-its-paths.md .decisions/0176-second-send-back-stops-lane.md .decisions/0177-fix-round-is-one-agent.md .decisions/0178-host-only-laws-run-first.md .decisions/0179-an-admin-merge-is-the-owners.md .decisions/0180-instruction-files-take-quick-edits.md .decisions/0183-the-lead-admin-merges-docs-only.md .decisions/0185-tier-2-runs-agents-after-the-four-primitives.md | build | docs | Slice 3: the 43 records from 0100 to 0199, plus 0117, 0143, 0154 and 0180, whose still-holds lines the regexes miss ("the rest of 0066 stands", "its other rules hold"); 0605 forbids them whatever their words; 0129's size target names 0608's setting; 0146, 0150 and 0156 are slice 7's |
| .decisions/0201-full-disk-fails-the-step.md .decisions/0202-spans-and-measurements-kept-forever.md .decisions/0214-unions-are-tagged-with-tag.md .decisions/0215-untrusted-input-never-throws.md .decisions/0217-next-grows-beside-today.md .decisions/0227-saved-state-carries-shape-number.md .decisions/0250-effect-modules-first-node-at-an-edge.md .decisions/0253-init-cmds-run-once-per-process.md .decisions/0254-tea-is-the-one-engine.md .decisions/0256-a-program-is-one-program-make.md .decisions/0257-a-programs-api-has-one-way.md .decisions/0258-inputs-are-plain-data.md .decisions/0259-each-event-brings-its-write.md .decisions/0260-an-output-is-a-model-value.md .decisions/0261-inputs-carry-their-sender.md .decisions/0279-tuval-is-a-package-desk-in-tier-2.md .decisions/0280-the-app-starts-a-launchd-brain.md .decisions/0281-a-saved-job-is-decoded-not-trusted.md .decisions/0293-every-record-names-its-build.md .decisions/0320-every-secret-is-an-effect-redacted.md .decisions/0338-email-recovery-waits-a-day.md .decisions/0374-triage-declines-only-on-the-bar.md .decisions/0389-an-estimate-is-on-a-doubling-scale.md .decisions/0401-agents-commit-as-the-fabrikalfa-bot.md .decisions/0407-this-repos-agent-commits-are-the-bots.md .decisions/0410-the-machine-caps-live-in-code.md .decisions/0411-property-data-comes-from-schemas.md .decisions/0432-next-has-fabsh-rethought-from-tsh.md .decisions/0454-an-aria-snapshot-per-story.md .decisions/0463-react-compiler-from-day-one.md .decisions/0464-every-compiler-finding-fails-the-build.md .decisions/0465-render-is-pure.md .decisions/0469-a-ui-check-reads-data-first.md .decisions/0481-a-tile-opened-with-content.md | build | docs | Slice 4: the 34 records from 0200 to 0499 |
| .decisions/0523-advice-rules-block-where-clean.md .decisions/0525-todays-version-is-frozen.md .decisions/0527-type-laws-get-a-type-label.md .decisions/0531-a-start-carries-its-member-down.md .decisions/0532-a-sev0-freezes-ci.md .decisions/0534-the-merge-line-runs-changed-tests-a-schedule-runs-all.md .decisions/0535-pull-requests-stay-fast-the-schedule-carries-the-rest.md .decisions/0536-real-resource-tests-run-only-on-the-schedule.md .decisions/0537-infra-holds-our-own-small-services.md .decisions/0538-kampus-vitest-holds-the-test-primitives.md .decisions/0539-the-merge-line-runs-no-tooling-tests.md .decisions/0543-next-follows-approved-guidelines-as-written.md .decisions/0544-every-reviewed-pull-request-is-armed.md .decisions/0546-a-lane-is-called-a-quest.md .decisions/0547-program-mail-is-a-message.md .decisions/0548-ctrl-c-stops-the-whole-line.md .decisions/0549-a-pipe-carries-the-whole-value.md .decisions/0551-the-brain-checks-and-records-pipes.md .decisions/0554-no-reflect-get-set-has.md .decisions/0555-no-vi-mock-or-domock.md .decisions/0556-kalfa-holds-our-tooling-packages.md .decisions/0557-kalfa-vitest-is-the-test-toolbox.md .decisions/0562-nothing-teaches-the-wrong-shape.md .decisions/0563-anti-slop-plugin-as-it-ships.md .decisions/0564-lead-decides-further-fix-rounds.md .decisions/0565-effects-own-checks-block.md .decisions/0567-a-tagged-value-is-matched.md .decisions/0568-error-cause-follows-effect.md .decisions/0569-tea-msgs-are-keyed-on-tag.md .decisions/0571-runbooks-live-in-top-level-runbooks.md .decisions/0573-trusted-lint-rule-replaces-ours.md .decisions/0577-libraries-namespace-programs-barrel-imports.md .decisions/0578-tea-cell-answers-a-step.md .decisions/0579-property-laws-use-it-prop.md .decisions/0581-main-full-run-starts-on-push-and-hourly.md .decisions/0583-a-room-keeps-one-stream-of-events-and-its-words-apart.md .decisions/0585-kalfa-is-six-domain-packages.md .decisions/0586-fabsh-v1-is-todays-terminal.md .decisions/0587-new-helpers-and-names-cite-sources.md .decisions/0589-agents-edit-files-with-any-tool.md .decisions/0590-a-branch-proof-run-runs-only-what-its-change-reaches.md .decisions/0594-safe-checks-direct-mac-ci.md .decisions/0595-scheduled-runs-share-slots.md .decisions/0598-merge-line-leaves-scheduled-groups.md .decisions/0601-program-make-with-optional-pipes.md | build | docs | Slice 5: the 45 records from 0500 to 0603; 0534's title names the schedule's file; 0518, 0540, 0588 and 0596 are slice 7's; 0604 to 0608 are already in the new shape |
| AGENTS.md next/AGENTS.md | build | docs | Slice 6: the cut to 32,768 bytes or less for the root, and for the root with `next/AGENTS.md`, by 0129's three moves, with its table of every line removed and where it went; line 210's "0023 lists the differences" links `.patterns/effect-differences-say-why.md` |
| docs/plan/README.md | build | docs | Slice 6: line 300 links 0162, not 0146; one line under "where we are" for this quest |
| .patterns/ .agents/skills/plan/SKILL.md .agents/skills/lead/SKILL.md docs/how-to/ | build | docs | Slice 6: where moved map text goes, chosen in the slice and named in its table; never `.agents/skills/adr/SKILL.md`, a `.decisions/` file or a `kalfa/` file, which other slices own |
| .decisions/0034-libfabrika-folders-are-bounded-contexts.md .decisions/0097-a-green-pull-request-lands-without-catching-up.md .decisions/0146-a-pull-request-lands-only-on-ci-that-saw-main.md .decisions/0150-the-recovery-notice-is-a-toast-for-now.md .decisions/0156-a-batch-lands-on-one-check-run.md .decisions/0518-you-summon-with-at.md .decisions/0540-the-queue-follows-the-merge-line.md .decisions/0588-no-program-edits-files-but-the-language-servers-quick-fix.md .decisions/0596-eight-active-tracker-tickets.md | build | docs | Slice 7: `status: superseded` and `successor: "NNNN"`; 0034 and 0588 lose their Amendments section or still-holds line; plus each record slices 1 to 5 hand over as reversed whole |
| .agents/skills/lead/scripts/records.ts | build | 30 | Slice 7: `readStatus` reads the two cases and the `successor` key; the "amended by" lines and `amendedBy` go; the header comment says so |
| .agents/skills/lead/scripts/records.test.ts | tests | tests | Slice 7: L9; the amended cases change to the new shape |
| .agents/skills/adr/SKILL.md | build | docs | Slice 7: step 4 becomes "edit the rule's home, or supersede whole", with no `amended-in-part` row and no `## Amendments` row; the frontmatter's `status` is `accepted` or `superseded` with `successor`; step 5 cites only `accepted`; the flow chart's "amend" goes |
| kalfa/records/package.json | build | 40 | Slice 8: `@kalfa/records`, private, exports `./Status`, `./Frontmatter`, `./Finding`, `./cli`, `"kalfa": { "cli": "./cli" }`; depends on `effect`, `yaml` and `@kalfa/config` from the catalog and the workspace |
| kalfa/records/README.md | build | 60 | Slice 8: a README with the four checks, the command and the setting |
| kalfa/records/tsconfig.json | tests | tests | Slice 8: the package's type check, as `kalfa/quality/tsconfig.json` |
| kalfa/records/src/Status.ts kalfa/records/src/Frontmatter.ts kalfa/records/src/Finding.ts | build | 120 | Slice 8: the shapes above |
| kalfa/records/src/Patches.ts kalfa/records/src/Links.ts kalfa/records/src/MapSize.ts kalfa/records/src/Settings.ts | build | 260 | Slice 8: the four checks and the setting; files listed through a `git ls-files` call behind a small service, so tests hand in a fixture list |
| kalfa/records/src/cli.ts kalfa/records/src/bin.ts | build | 90 | Slice 8: the `check` command and its edge |
| kalfa/records/src/Status.test.ts kalfa/records/src/Frontmatter.test.ts kalfa/records/src/Patches.test.ts kalfa/records/src/Links.test.ts kalfa/records/src/MapSize.test.ts kalfa/records/src/Settings.test.ts kalfa/records/src/cli.test.ts | tests | tests | Slice 8: L1 to L8 |
| pnpm-lock.yaml | tests | tests | Slice 8: the new importer, by `pnpm install`; no version changes |
| package.json | tests | tests | Slice 9: one entry in the root `lint` script, `'node kalfa/records/src/bin.ts check'`; L10 |
| field/runs/ field/findings/ | build | docs | Each slice's run row and any finding, one new file each, the same day |
| .github/ci/field-check.ts .github/ci/field-schema.ts .github/workflows/scheduled.yaml .oxfmtrc.json kalfa/quality/tsconfig.json | tests | tests | Read for this plan and named by the cleanup slices' text, not changed |

## Existing tools

- kalfa/records/src/Status.ts and kalfa/records/src/Frontmatter.ts: searched `.agents/skills/lead/scripts/records.ts` (its `Status` reads amended links and has an `other` case, so it cannot refuse a bad status), `.github/ci/field-schema.ts` (field rows only) and npm for `adr`, `madr` and `log4brains` readers (they parse MADR's Markdown, not our frontmatter). None fits, so these are new; `yaml` from the catalog parses the frontmatter.
- kalfa/records/src/Finding.ts: searched `.github/ci/field-check.ts`'s `Finding` (a field-row finding, its own cases); new, in the same tagged shape.
- kalfa/records/src/Patches.ts: searched `.agents/skills/lead/scripts/governance.sh` (lists decision files a diff names; reads no body) and oxlint (reads code, not Markdown); new.
- kalfa/records/src/Links.ts: searched npm for `markdown-link-check`, `lychee` and `remark-validate-links` (they check that a target exists, not its status) and `records.ts resolve` (resolves one id; its lookup is the model); new, with a small link scanner that skips fenced code.
- kalfa/records/src/MapSize.ts: searched `.agents/skills/lead/scripts/sizecap.ts` (counts a pull request's lines against advice, not a file's bytes against a sourced setting); new.
- kalfa/records/src/Settings.ts: searched `kalfa/quality/src/stryker/Settings.ts` (plain Effect `Config`, written before `@kalfa/config` was on main) and `kalfa/config/README.md`; uses `@kalfa/config`'s `App.make` and `Setting.make`.
- kalfa/records/src/cli.ts and kalfa/records/src/bin.ts: searched `kalfa/quality/src/cli.ts`, whose `effect/cli` tree and `./cli` export this follows.

## Order against other work

```text
slices 1-5   .decisions ranges      any order, in parallel
slice 6      the map                in parallel
slice 7      superseded + reader    after 1-5 (it takes their hand-overs, and records.ts drops
                                    the amended case once main has none)
slice 8      @kalfa/records         in parallel with 1-7; not run by pnpm lint
slice 9      turn on                after 1-8; runs `check` on main first, and must print nothing
```

- A decision merged by another pull request while these run, in the old shape, is fixed by slice 9
  before it turns the check on. That file is no other slice's.
- 0585's records plan (the move of `records.ts`'s commands and the folders under `.kalfa/`) comes
  after this quest. It takes slice 8's package as its start.

## Not in this quest

- **R1's moves of rules to their homes** (experiment 298's tryout items 2 to 5: about 33 agent
  hours, a guess). A fold here keeps a rule in its record; the move to a check, skill or pattern doc
  is each record's own later work.
- **R7's `skillscheck.sh` rewrite** and **R8's count of findings by kind.** Both are taste, held by
  the review.
- **The experiment's smaller calls 2 to 5** (no word cap, `find` over skills, the `Decision:` commit
  trailer). Each is its own later change.
- **Dead record links** (a target that does not exist). 0607 is about superseded records; a dead
  link is another check.

## Calls taken

- The successor key is `successor`, a quoted four-digit string, 70% (smaller call 1's lean).
- The size check lives in `@kalfa/records`, 75%.
- `records.ts` keeps its own two-case reader until 0585's records plan, 80%: the small fix, and
  the move is ticketed.
- The patch phrasings are the three of 0605 and the regexes above, 80%. Slice 8 measures them on
  today's main: every hit must be one of the 189 records listed by the commands above, and any hit
  outside them is read by hand. A hit that is not a real patch removes its phrasing before slice 9.
- A code comment's link is a `.decisions/NNNN-slug.md` path, not a bare number, 85%: a bare number
  is too often a count or a port.
- Cleanup slices are cut by number range, since a fold edits only the older record and every older
  record has one number. Five slices of 30 to 45 records keep each review readable, 75%.

## Validation

Slices 1 to 7: `pnpm format`, then `pnpm lint`, then the slice's own counts from "What was run",
over its range, print nothing. Slice 7 also runs
`nice -n 15 pnpm exec vitest run --maxWorkers=3 .agents/skills/lead/scripts/records.test.ts`.
Slice 8: `nice -n 15 pnpm exec vitest run --maxWorkers=3 kalfa/records/`, each law's plant made once
and seen red, then undone; then `node kalfa/records/src/bin.ts check` on the checkout, whose output
is the measured hit list for the pull request. Slice 9: `node kalfa/records/src/bin.ts check` on
newest main prints nothing, then `pnpm lint`. The lead runs the one `pnpm typecheck`, and CI the rest.

## Records

- **What is lost if it is not recorded now:** which amendment changed which line of an older
  record. The amending record keeps its Context, git keeps the fold's diff, and each cleanup pull
  request lists, per record, the amending records it folded. Nothing else is lost: the rest
  rebuilds from git.
- Each slice writes its run row under `field/runs/` the same day; slice 8's pull request lists the
  measured hit count per check on main before the cleanup.
- 0604 to 0608 are written. No glossary word is new: `successor` is a plain word, and a glossary
  row is added only if a review asks for one.

## What this cannot tell us

- **Whether agents do better with folded records.** No run compares them; the experiment says
  the same.
- **Whether our Codex steps load `AGENTS.md` at all.** 0608 takes the documented default; a run
  that asks a Codex step for a line from the end of the map would settle it.
- **Whether a fold kept every rule.** Each fold is a reading of the amending records; the review
  reads them again, and a missed rule is found when an agent misses it.
- **Bare numbers.** A prose line that says "0146" without a link is not checked.

## Size

1. Slice 1, 0001 to 0049: 35 records, about 900 lines changed, docs. About 3 agent hours.
2. Slice 2, 0050 to 0099: 30 records, about 750 lines changed, docs.
3. Slice 3, 0100 to 0199: 43 records, about 1,000 lines changed, docs.
4. Slice 4, 0200 to 0499: 34 records, about 700 lines changed, docs.
5. Slice 5, 0500 to 0603: 45 records, about 1,200 lines changed, docs.
6. Slice 6, the map: about 500 lines removed or moved and a removal table of about 150 rows, docs.
7. Slice 7, superseded records, the reader and the adr skill: about 120 lines, 30 product lines.
8. Slice 8, `@kalfa/records`: about 1,100 lines with laws, 585 product lines.
9. Slice 9, turn on: about 5 lines, 0 product lines.

Confidence 60% on the cleanup line counts, which assume about 25 lines changed per record (an
Amendments section averages 17 bullets); 75% on slice 8.

The budget prices each slice at tests, build and review, plus one likely fix round on slices 3, 5,
6 and 8, from the anti-slop install plan's medians in `field/runs.jsonl` (tests $1.14, build $1.24,
review $1.18), raised for the cleanup slices, whose builders read 30 to 45 records each. A guess.

Estimate: 31 steps, $120

## Open questions

None.

Each call above decides how the code does what 0605 to 0608 say. Slice 6 brings a cut that
cannot reach the limit without dropping a rule to the lead, who takes it to the owner.

## Findings

```json
{"_tag": "finding", "id": "2026-11-18-records-ts-status-reader-copy", "date": "2026-11-18", "by": "plan", "model": "claude-opus-5-5", "rule": "duplicate", "location": {"path": ".agents/skills/lead/scripts/records.ts", "line": 306}, "says": "Today's lead tooling: after the rules and records build, records.ts keeps its own decision status reader beside the Status Schema in @kalfa/records, two readers of one shape, until 0585's records plan moves records.ts's commands into @kalfa/records.", "proof": "records.ts:306 defines Status and readStatus; the build plan's slice 7 keeps them, since importing @kalfa/records from .agents/ needs a root dependency that would put the root package.json in two slices", "cost": "a status shape changed in one reader and not the other gives records.ts resolve and the lint check two answers", "head": "2c324184e2458ca8b910b9e46820d6908a57640d", "ticket": null, "pr": "kamp-us/tea-fabrika#1604"}
```
