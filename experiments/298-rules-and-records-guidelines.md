---
date: "2026-11-17"
scripts: "none committed; rg, wc, git and two small read-only counting scripts run by hand on origin/main at ad93a08fb, each count written beside its number"
summary: "Our tooling and the records of both versions; $0. Where should a rule live so stale, repeated or contradictory rules cannot grow back? The makers agree: a rule lives once, where it is enforced or read, and is edited in place; a decision log keeps the why and is never patched. Here, 116 of 539 decisions (99,248 of 312,502 words) are amended in part, 74 of their amendments are themselves amended, 3 are patched by a superseded record, and 25 of AGENTS.md's 56 decision links land on an amended record. Eight principles, R1 to R8, three of them lint. The root AGENTS.md is 39,103 bytes, past Codex's 32 KiB default."
---

# 298. Where should a rule live, so stale, repeated or contradictory rules cannot grow back?

Read on 2026-11-17, on `origin/main` at `ad93a08fb`. This is reading, not a measurement: nothing
ran but `wc`, `rg`, `git`, `records.ts` and two small counting scripts. No model, no key, **$0**.
It feeds the proposed page [rules and records](../docs/guidelines/rules-and-records.md). This area
has no screen, so there is no Design canvas, no designs and no shots: step 5 and step 9 of the
guidelines skill were left out on purpose, and each principle is shown against three real records
instead. It covers today's tooling and the records both versions read (`.decisions/`, `AGENTS.md`,
skills, `.patterns/`, `.glossary/`, checks and settings), not product code.

**The answer: a rule lives once, in the thing that holds it, and is edited there. A decision record
keeps why the owner ruled, links that home, and is never patched by another record.** Every maker
read agrees on the split between a log of why and the living rule. The other team's repo with the
same problem found most of its stale rules were a second copy. Here, the status "amended in part"
is that second copy in another form: 116 records whose current rule is only found by reading the
record plus every record that changed it.

```text
before   a ruling   -> .decisions/0534 (rule + why) -> 0539, 0541, 0581, 0590, 0595 patch it
         a reader   -> reads six records, folds them in their head, may stop at the first
after    a ruling   -> .decisions/NNNN (why, one page) + one edit to the rule's home
         the home   -> .github/workflows/scheduled.yaml, changes.mjs, workflow-lint/issues.ts
         a reader   -> reads the home; git log is its history; the record says why
```

How sure: about 80% on the direction, which every source and our own counts support. Less on the
cost of moving 116 records (a guess, below) and on R6's number, which comes from a tool's docs and
was not tested here.

- **Today's records mostly break it.** 0534's title says the full suite runs "every 3 hours"; an
  `## Amendments` section further down says that line no longer holds. 0023's table says our
  indent is tabs and our width 100; `.oxfmtrc.json` says 2 spaces and 120.
- **The repo already holds many rules in code.** `.github/workflows/scheduled.yaml`'s header and
  `.github/ci/workflow-lint/issues.ts` hold what 0534 says, with the record numbers as their why.
  The record is the stale copy, not the code.
- **The skill this study follows has a live case.** The guidelines skill's step 8 says to add an
  index row to `docs/guidelines/README.md`; [0522](../.decisions/0522-no-folder-keeps-an-index-table.md)
  says no folder keeps an index table. This study follows 0522.

```text
how each one keeps a rule current
Nygard ADRs        a short record, never edited; a reversal marks it superseded
MADR               one status field: proposed, accepted, deprecated, "superseded by ADR-0123"
Kubernetes KEPs    one document per enhancement, kept up to date as it moves through milestones
Rust               the RFC is not edited after it lands; the Reference is edited in place
UK statutes        the amending act stays as enacted; the revised text folds every amendment in
aviation           a checklist is a short prompt, not the manual (secondary)
Google Tricorder   a rule that matters becomes a check; under 10% false alarms or it is switched off
OPA                policy is data: declarative, versioned, enforced automatically
Claude Code        instructions are context, not enforcement; under 200 lines; contradictions pick one
Codex              AGENTS.md files concatenate root to leaf, cut at 32 KiB by default
Effect             a short AGENTS.md: layout, the narrowest check, generated files; docs from code
another team       rules moved out of records into the files agents read; 29% of review findings were stale rules
```

## What was read

### Agent instruction files

| Tag | Source | What it says, short, as fetched 2026-11-17 |
|---|---|---|
| `[a1]` | [Anthropic, effective context engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents) | "find the smallest set of high-signal tokens that maximize the likelihood of your desired outcome"; keep "lightweight identifiers (file paths, stored queries, web links, etc.)" and load data at runtime; warns against "hardcoding complex, brittle logic in their prompts" |
| `[a2]` | [Claude Code, how Claude remembers your project](https://code.claude.com/docs/en/memory) | "Claude treats them as context, not enforced configuration"; "target under 200 lines per CLAUDE.md file. Longer files consume more context and reduce adherence"; "if two instructions contradict each other, Claude may pick one arbitrarily" |
| `[a3]` | [agents.md](https://agents.md/) | "Think of AGENTS.md as a README for agents"; "The closest AGENTS.md to the edited file wins" |
| `[a4]` | [Codex, AGENTS.md](https://developers.openai.com/codex/guides/agents-md) (it redirects to the chatgpt.com learn docs) | "Codex stops adding files once the combined size reaches the `project_doc_max_bytes` limit" "(32 KiB by default)"; "Files closer to your current directory override earlier guidance because they appear later in the combined prompt" |
| `[a5]` | Effect's [`.agents/AGENTS.md`](https://github.com/Effect-TS/effect/blob/main/.agents/AGENTS.md), and the `AGENTS.md` that ships inside `effect@4.1.3` | the repo file is about 55 lines: layout, "Use the narrowest validation that covers the change", "Do not edit generated output directly", "`LLMS.md` is generated from `ai-docs/src`". The shipped file links compiled example files in `ai-docs/src` and says to avoid "external documentation, as they may be outdated or incorrect" |

### Decision records and living documents

- `[d1]` [Nygard, documenting architecture decisions](https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions):
  each record is "a short text file", the whole "one or two pages long"; a reversed one is kept and
  you "mark it as superseded".
- `[d2]` [MADR](https://adr.github.io/madr/): the status field is
  "proposed | rejected | accepted | deprecated | … | superseded by ADR-0123". It has no "amended"
  value and says nothing on editing an accepted record.
- `[d3]` [Kubernetes KEP template](https://github.com/kubernetes/enhancements/blob/master/keps/NNNN-kep-template/README.md):
  its release checklist asks that the "Implementation History" section is "up-to-date for
  milestone". A KEP is one file kept current through its life. **Secondary** for "edited in place
  as a rule": the fetched pages say it only through that checklist line.
- `[d4]` [Rust RFCs README](https://github.com/rust-lang/rfcs/blob/master/README.md): "once
  accepted, RFCs should not be substantially changed"; "More substantial changes should be new
  RFCs, with a note added to the original RFC"; "we cannot expect every merged RFC to actually
  reflect what the end result will be".
- `[d5]` [rustc dev guide, stabilization](https://rustc-dev-guide.rust-lang.org/stabilization-guide.html):
  "there must be a complete PR to the Reference describing the feature". The RFC is history; the
  Reference is the living rule, edited when the feature lands.

### Checks

- `[c1]` Sadowski and others, [Lessons from building static analysis tools at Google](https://6826.csail.mit.edu/2020/papers/google-analysis-cacm.pdf),
  CACM April 2018, read from the PDF. "Developers, not tool authors, will determine and act on a
  tool's perceived false-positive rate." A compiler check should "produce no effective false
  positives (the analysis should never stop the build for correct code)"; a review check should
  "Produce less than 10% effective false positives"; "If the ratio for an analyzer goes above 10%,
  the Tricorder team disables the analyzer". The Clang team would "programmatically fix all existing
  instances of a problem in the codebase" and only then turn the check into an error.
- `[c2]` [Open Policy Agent, philosophy](https://www.openpolicyagent.org/docs/latest/philosophy/):
  policies "specified declaratively, updated at any time without recompiling or redeploying, and
  enforced automatically". The page does not use the words "policy as code".

### Outside software

- `[o1]` [legislation.gov.uk help](https://www.legislation.gov.uk/help): the revised text is "The
  latest available revised version of the legislation incorporating changes (i.e. amendments and
  other effects)"; the original "as enacted" has "No changes have been applied to the text". Law
  keeps both: the amending act is history, the consolidated text is what you read to obey. What
  does not carry over: an editorial team does the folding there; here the person who changes the
  rule must, in the same pull request.
- `[o2]` Aviation checklists, from Degani and Wiener (NASA, 1990), **secondary**, through a
  [summary page](https://www.thehumandiver.com/post/how-to-building-an-effective-checklist): a
  checklist is "a prompt or cognitive aid rather than a long instruction set". What carries over:
  the always-read file is a short prompt, and the manual sits elsewhere. What does not: a cockpit
  checklist is read aloud in order; an agent searches.

### Another team's repo

`[x1]` A private study of another team's repo with its own agents and the same problem, read on
2026-11-17 and rewritten here in our words. Nothing in it was measured in this repo.

- Its decision log was used as the rulebook. Every rule change wrote a new record that copied the
  old one, so one rule set grew from about 900 to about 11,100 words in 10 days, and 4 of its 26
  current records held 59% of the current words. After its rules moved to the files agents read,
  that one record was 651 words.
- "Superseded except one rule" records were live rulebooks under another name.
- An audit of 141 review findings across 25 pull requests: 41 (29%) came from a stale, repeated or
  contradictory instruction, not from the code. About 17 of those 41 were a rule typed twice.
- One shape nit was raised in 9 pull requests; it is a lint rule's job.
- A 500-word cap on records, with no data behind it, turned main red twice in one day and was
  removed. The team kept its byte-for-byte checks only where they guard bytes a person approved: a
  paid run's approved plan, a reviewer's approved diff, a copy that must stay faithful.

The plain way they agree on: **a log of why and a living rule are two documents. The rule lives
once, in the thing that holds it (a check, a config, the instruction read for the job), and is
edited in place with version control as its history. The log is short and is never patched.** It
clashes with one goal of ours in one line: [0115](../.decisions/0115-decided-rules-live-in-decision-files.md)
put every decided rule in a decision file so a search finds it; moving rules to their homes means a
search must find homes too.

## What is settled

- **Decided:** decisions live in `.decisions/`, one per ruling, the turn it is made
  ([0001](../.decisions/0001-decisions-live-in-the-repo.md)); a moved decision leaves one link,
  never a copy ([0002](../.decisions/0002-moving-a-decision-removes-it-from-its-source.md)); a
  decision with a shape opens with a diagram ([0005](../.decisions/0005-patterns-and-decisions-are-visual.md));
  discovery is the AGENTS.md contract with no index ([0008](../.decisions/0008-decision-discovery-is-the-agents-md-contract.md),
  [0522](../.decisions/0522-no-folder-keeps-an-index-table.md)); a decided rule lives in a decision
  file ([0115](../.decisions/0115-decided-rules-live-in-decision-files.md)); AGENTS.md is a short
  map and each rule leaves it by one of three moves ([0129](../.decisions/0129-agents-md-becomes-a-short-map.md),
  [0180](../.decisions/0180-instruction-files-take-quick-edits.md)); each kind of knowledge has one
  home and no new direction note is written ([0130](../.decisions/0130-every-piece-of-knowledge-has-one-home.md));
  a guideline is one page, and each law or lint principle gets a decision file
  ([0136](../.decisions/0136-guidelines-live-in-their-own-pages.md)); a skill keeps only judgment
  and a checked rule leaves it ([0408](../.decisions/0408-skills-keep-only-judgment.md)); no list
  lets broken code pass ([0524](../.decisions/0524-no-list-lets-broken-code-pass.md)); record
  tooling and each kind's frontmatter Schema live in `@kalfa/records`
  ([0585](../.decisions/0585-kalfa-is-six-domain-packages.md)), and test, lint and format in
  `@kalfa/quality` ([0600](../.decisions/0600-kalfa-quality-holds-test-lint-format.md)); a trusted
  tool before a hand-written one ([0040](../.decisions/0040-existing-tools-before-hand-written.md),
  [0573](../.decisions/0573-trusted-lint-rule-replaces-ours.md)).
- **Leaned:** [experiment 283](./283-context-audit.md) found 578 of 2,928 skill lines cut with
  proof, mostly copies of script headers, and that `skillscheck.sh` keeps three duplicates alive.
- **Untouched:** the status "amended in part" (no decision defines it); a check on a record's
  frontmatter (0008 and 0522 left it open); a check on links to superseded records; a number for
  the map's size (0129 and 0180 left it open).
- **Open pull requests on the area:** [PR 1305](https://github.com/kamp-us/tea-fabrika/pull/1305)
  (modules guidelines) and [PR 1254](https://github.com/kamp-us/tea-fabrika/pull/1254) (fabsh
  guidelines) each add `docs/guidelines/README.md`; this study adds the same text as PR 1305's, so
  the three merge without a conflict. [PR 1504](https://github.com/kamp-us/tea-fabrika/pull/1504)
  moves the exam's code-shape checks into lint, the direction of R3.

## Today's records: the 116 amended in part

Counted on `origin/main` at `ad93a08fb`. The brief that started this study had 538 records and 113
amended in part; main moved since. Each line is one command or one counting script, run by hand.

| What | Today | Where |
|---|---|---|
| decision records, and words in them | 539, 312,502 | `ls .decisions`, `wc -w` |
| status `accepted`, `amended-in-part`, `superseded` | 414, 116, 9 | the `status:` line |
| words in the 116 amended records | 99,248 (32%) | `wc -w` |
| amended records with "carried forward" or "still holds" | 44 | `grep -liE` over all records |
| amended records with an `## Amendments` section | 37 | `grep '^## Amendments'` |
| amendments whose amending record is itself amended | 74 | status links, followed one step |
| amended records patched by a superseded record | 3, by 4 links: 0012 by 0596, 0032 by 0034, 0049 by 0097 and 0146 | the same |
| records patched by 2 or more others | 33; the most, 0023, by 7 | the same |
| longest titles | 61 words (0076), 52 (0172 and 0586) | the `title:` line |
| links to a superseded record | 1 in `docs/plan/README.md` (0146), 23 from other records, 0 in AGENTS.md, skills, `.patterns/` | `rg` over each folder |
| links that land on an amended record | AGENTS.md 25 of 56, `next/AGENTS.md` 10 of 18, skills 77 of 147, `.patterns/` 21 of 39, plan 284 of 621 | the same |
| root `AGENTS.md` | 480 lines, 39,103 bytes; with `next/AGENTS.md`, 49,516 | `wc -lc` |

A link to an amended record is a link to half a rule: the reader must also open each record named
in its status, and those in theirs. The one superseded link in the plan is a dated history entry
that still says "a pull request now lands only when its checks ran on a head that holds main",
which [0162](../.decisions/0162-no-friction-before-a-merge.md) reversed.

**A first sort of the 116, by this study alone.** Read from each title and, for the three examples,
the whole record. The sort another agent is writing into `docs/plan/amended-decisions-sort.md` was
not on main when this was written, so this one is mine, not checked by anyone. About 75% sure of
each line; the counts could move by ten either way.

```text
check-held  36  a check, config or script holds the rule today; the record is a copy
            0003 0004 0006 0012 0029 0039 0043 0062 0066 0067 0116 0123 0135 0164 0168 0174 0175
            0217 0401 0407 0464 0525 0527 0534 0535 0536 0539 0544 0554 0557 0565 0573 0579 0581
            0590 0595
checkable   41  code could hold it (a lint rule, a Schema, a law, a setting) and does not yet
            0005 0008 0023 0032 0033 0036 0041 0042 0045 0046 0055 0076 0087 0093 0099 0118 0119
            0140 0147 0172 0178 0183 0202 0214 0215 0227 0261 0280 0293 0338 0389 0411 0454 0465
            0469 0481 0538 0547 0556 0571 0585
judgment    30  only prose can hold it; its home is a skill, a folder's AGENTS.md or a pattern doc
            0001 0014 0016 0018 0031 0035 0037 0040 0056 0063 0071 0074 0079 0083 0096 0103 0107
            0115 0120 0129 0130 0162 0166 0176 0177 0179 0432 0463 0532 0537
history      9  plan state or work done; no live rule is left in it
            0049 0068 0078 0088 0098 0151 0159 0161 0279
```

### The three records the principles are shown on

One from each of the three live classes.

| Record | Class | Words | Patched by | What a reader meets |
|---|---|---|---|---|
| [0534](../.decisions/0534-the-merge-line-runs-changed-tests-a-schedule-runs-all.md), which tests run where | check-held | 931 | 0539, 0541, 0581, 0590, 0595 | title and Decision say "every 3 hours"; an `## Amendments` section at the end says that line no longer holds. The rules are in `.github/workflows/scheduled.yaml`, `.github/ci/changes.mjs` and `.github/ci/workflow-lint/issues.ts` |
| [0023](../.decisions/0023-next-follows-effects-code-style.md), next/ follows Effect's code style | checkable | 1,759 | 0021, 0029, 0032, 0039, 0095, 0118, 0574 | an italic line says 0029 settles format "and the rest of this file still holds"; its table still says indent "tabs", width "100", "open: owner picks", while `.oxfmtrc.json` says `"useTabs": false`, `"printWidth": 120`. It names `effect@4.1.2`; the lockfile has 4.1.3. AGENTS.md links it as the list of differences |
| [0129](../.decisions/0129-agents-md-becomes-a-short-map.md), AGENTS.md becomes a short map | judgment | 680 | 0180 | its title still says the cut waits on "one test of long against short", which 0180 withdrew; a heading in its body says so. It aimed at "about 150 lines"; the map is 480 |

Two more live contradictions turned up while reading, both in this area:

- AGENTS.md's "Where to read, where to write" table says to write a note under `docs/direction/`
  "when a decision needs the long reasoning". [0130](../.decisions/0130-every-piece-of-knowledge-has-one-home.md)
  says "No new note is written under `docs/direction/`", and the guidelines skill says the same.
  `docs/direction/` still holds 139 files.
- The guidelines skill's step 8 asks for an index row; 0522 forbids one. [PR 1254](https://github.com/kamp-us/tea-fabrika/pull/1254)
  already filed this as a finding.

## What this tells us for fabrika

Eight principles. The page holds the rules; this section holds the reasoning, the leans, the
Effect row, the Elm or OTP row, accessibility where it fits, the cost, and each principle against
the three records: what moves, where it lands, and what the record shrinks to. Kinds: **law** (a
test checks it), **lint** (`pnpm lint` holds it) or **taste**, which here means the review judges
it, since this area has no shot.

### R1: one home per rule, picked by what holds it

A rule lives in exactly one place. The order: a check, a type or a config file, if code can hold
it; else the instruction already read for that job (a skill, a folder's `AGENTS.md`, a pattern
doc, a guideline page, a runbook); else its own decision record, edited in place, until one of the
first two can take it. A record that is not a rule's home holds no copy of it.

**Lean, 80%.** Every source splits the why from the rule `[d1]`-`[d5]`, `[o1]`, and the other
team's poison was mostly copies `[x1]`. The doubt: this walks back part of
[0115](../.decisions/0115-decided-rules-live-in-decision-files.md) ("A rule the owner decided ...
lives in a decision file"), of [0130](../.decisions/0130-every-piece-of-knowledge-has-one-home.md)
("A rule the owner decided is a decision file"), of 0129's second move (a decided rule becomes "one
line with a link to its decision file") and of [0136](../.decisions/0136-guidelines-live-in-their-own-pages.md)
(one decision file per law or lint principle). That is the owner's call, and the one real design
call in this study. What would settle it: one sweep of the 36 check-held records, then a count of
review findings that cite a stale record, before and after.

- **Effect row:** Effect keeps its rules where its tools hold them (`pnpm lint-fix`, `pnpm check`,
  `pnpm jsdocs --check`) and its `AGENTS.md` names the commands `[a5]`. The fetched file names no
  decision folder; whether the team keeps one elsewhere was not checked (**guess**: it does not).
- **Elm or OTP:** event sourcing, which Elm's update is. Records are the messages; each rule's
  home is the model, folded from them. Nobody reads the message log to learn the state. OTP's
  `code_change` upgrades a process's state in place rather than keeping old states beside it.
- **Accessibility:** no fit.
- **Cost:** a rule with no code home and no instruction home stays in its record, so this is not
  "empty `.decisions/`". The cost is the move itself (see the tryout) and the walk-back above.

Against the three records:

- **0534:** nothing moves; the homes exist. Job choice is `.github/ci/changes.mjs`; when the full
  run starts is `scheduled.yaml`'s `on:` block, its `gate` job and cron `17 * * * *`; who may open
  issues is `workflow-lint/issues.ts`. One rule has no file: the merge queue's build concurrency of
  2 is a GitHub setting. Its home is a check that reads the setting through the API, or the record
  until that check exists. The record shrinks to its why: the 2026-11-14 sev0, the queue taking 46%
  of 15,057 machine-minutes, and the call that the merge line never runs the full suite.
- **0023:** format values move nowhere, since `.oxfmtrc.json` already holds them; the "follow"
  rows (`no-console`, `array-type`, inline type imports) become lint rules from a trusted set
  (0573) or tickets; each kept difference's reason goes beside its code as `.patterns/effect-differences-say-why.md`
  already says. The record shrinks to its why: code in `next/` reads like Effect's for a reader who
  knows Effect, and each difference says why where it is.
- **0129:** the three moves already sit at the top of AGENTS.md ("A rule lives where it is read");
  the cut-table rule is the lead's judgment and goes to the lead skill; "about 150 lines" goes to
  R6's check with a sourced number. The record shrinks to its why: one long file read by every
  agent for every job.

### R2: a rule changes where it lives, and no record patches another

A change to a rule edits its home, in the same pull request as the short record of why. A record
gets no `## Amendments` section, no "the rest still holds" line and no "carried forward" copy. A
record whose why was reversed is superseded whole.

**Lean, 85%.** Law's revised text `[o1]`, Rust's Reference `[d5]`, KEPs `[d3]` and Effect's
generated docs `[a5]` all fold changes into one text; Rust's RFC note and Nygard's superseded mark
`[d1]` `[d4]` keep the log short. Our numbers show the cost of patching: 74 amendments of
amendments, 44 records with "still holds" wording. The doubt: a reader loses the per-record chain
of what changed; `git log` on the home and the new record's context keep it.

- **Effect row:** changes are `.changeset/` files, one per change, folded into the changelog at
  release; the docs are edited in place `[a5]`.
- **Elm or OTP:** the same fold as R1. A patch record is a message that only says "apply message
  0534, except its third field", which no update function should need.
- **Accessibility:** no fit.
- **Cost:** a check (below) and the habit of editing the home. 0001's "the turn it is made" holds:
  the why-record lands that turn, with the edit.

Against the three records:

- **0534:** [0581](../.decisions/0581-main-full-run-starts-on-push-and-hourly.md) would have edited
  `scheduled.yaml` (it did) and written its own why, with no section added to 0534. 0534's title
  stays true because it no longer names an interval: "the merge line runs only the tests a change
  reaches, and a schedule runs the rest".
- **0023:** seven records patched it. Under R2, 0029 and 0039 are edits to `.oxfmtrc.json` (whose
  comment already names them), 0118 and 0574 are edits to the doc-comment lint, and 0023 stays
  untouched and true.
- **0129:** 0180 withdrew its order. Under R2 the order was never in the record: it was plan state
  and lived in `docs/plan/`, so 0180 edits the plan, and 0129's title has no clause to go stale.

### R3: code holds what it can; prose names the command, the key and what its exit means

Prose keeps only judgment ([0408](../.decisions/0408-skills-keep-only-judgment.md)). A fact a
config file or lockfile owns (a version, an interval, a cap, a width, a list of paths) is pointed
to by file and key, never typed. A check's own message teaches its rule. An example an agent copies
is code that runs or typechecks, as `@kalfa/records` calls once 0585 lands.

**Lean, 85%.** 0408 already decides the first sentence; this extends it to config facts and
examples. `[a2]` says instructions are "not enforced configuration"; `[c2]` says policy is
"enforced automatically"; `[a1]` warns against brittle logic typed into prompts. Of the other
team's 41 stale findings, about 13 were a statement a change made false or a fact that drifted
with nothing failing `[x1]`. The doubt: a pointer is harder to read than the value; a check's
message must carry enough for a reader who never opens the config.

- **Effect row:** "Do not edit generated output directly"; `LLMS.md` is generated from
  `ai-docs/src`, whose examples are compiled files `[a5]`. Their docs cannot drift from the code
  because they are the code.
- **Elm or OTP:** Elm's compiler messages teach the rule at the moment it breaks. A check's message
  is our compiler error.
- **Accessibility:** WCAG 3.1.5, reading level, loosely: plain prose for readers who are not
  native speakers, which AGENTS.md's "How to write here" already asks. No screen reader run needed.
- **Cost:** each pointer must resolve; R5's check covers links, not config keys. A key check is a
  smaller call.

Against the three records:

- **0534:** the "only `ci-scheduled` issues" rule is already a lint whose message cites the record
  (`.github/ci/workflow-lint/issues.ts`, `ISSUES_RULE`). The cron value is typed in 0534's
  Amendments section and in `scheduled.yaml`; only the workflow should hold it.
- **0023:** the typed values "tabs" and "100" are wrong today because a config owns them. The
  record says `effect@4.1.2`; the lockfile says `effect@4.1.3`. Both become "as `.oxfmtrc.json`
  sets" and "the installed version" (AGENTS.md's "Read the installed version" already says so).
- **0129:** the commands AGENTS.md shows (`records.ts find`, `records.ts resolve`) become
  `kalfa records decisions find` calls once 0585 lands, and a test runs each one.

### R4: a record is accepted or superseded, and its status is typed data

Two cases. A record whose why stands is `accepted`. A record whose why was reversed is `superseded`,
naming one record. "Amended in part" goes: a partial change edits the rule's home (R2), and the new
record says in its context what it changed. The status is a Schema in `@kalfa/records` (0585), not
a Markdown link in a string.

```ts
// A sketch, in @kalfa/records: frontmatter status as a tagged union (0214).
const Status = Schema.Union([
  Schema.TaggedStruct("accepted", {}),
  Schema.TaggedStruct("superseded", { successor: DecisionId }),
]);
// today, one string with five Markdown links:
// status: amended-in-part by [0539](0539-...md), [0541](...), [0581](...), [0590](...), [0595](...)
// after:
// status: accepted
```

**Lean, 75%.** MADR has no "amended" status `[d2]`; Nygard has "superseded" only `[d1]`; Rust adds a
note to the old RFC and writes a new one `[d4]`. Our numbers: 3 records patched by a record that is
itself superseded, a state a reader cannot fold. The doubt: `records.ts resolve` prints "amended
by" today, and some readers use it to find newer records. After R2 a reader needs the home, not
the newer record, so `resolve` would print the home instead. What would settle it: the other
agent's sort, checking how many amended records still need a pointer once their rules have moved.

- **Effect row:** no record statuses; a changeset's bump (`patch`, `minor`, `major`) is typed data
  a tool reads. No direct answer beyond that.
- **Elm or OTP:** make invalid states unrepresentable. A tagged union with `_tag`, as
  [0214](../.decisions/0214-unions-are-tagged-with-tag.md) asks; "amended in part by five records,
  one of them superseded" is not a state the union can hold.
- **Accessibility:** no fit.
- **Cost:** one Schema and one migration: 116 status lines become `accepted`, each after its
  rules have moved (R1), so the status change waits on the move.

Against the three records: **0534**, **0023** and **0129** each become `status: accepted`, since
each one's why still stands; what changed them lives in their homes and in 0539 to 0595, 0021 to
0574, and 0180's own context. The three records patched by a superseded record (0012, 0032, 0049)
lose that dead link with the rest.

### R5: every link lands on a live home

No instruction file (AGENTS.md, a folder's AGENTS.md, a skill), plan file, pattern doc, glossary
row or code comment links a superseded record, and a link meant to state a rule goes to the rule's
home, not to a record that once held it. `resolve` is the check, run by `pnpm lint`.

**Lean, 85%.** `[a2]` says contradictions make Claude "pick one arbitrarily"; a link to a stale
record is a contradiction delivered on request. The other team's check on this is the single
mechanism it found most direct for "old decisions given as reasons" `[x1]`. Here the count is
already low (1 link in the plan, 23 between records), so the check would land at about zero, as a
blocking check must `[c1]`.

- **Effect row:** `pnpm jsdocs --check` covers "JSDoc text/category/link changes" `[a5]`: they check
  doc links with a tool.
- **Elm or OTP:** OTP's registry: a name always resolves to the live process (`whereis`), never to
  one that exited. `resolve` is that lookup for records.
- **Accessibility:** no fit.
- **Cost:** a small check on `@kalfa/records`; the 23 record-to-superseded links are history in
  context sections and stay, so the check covers instruction files, the plan, patterns, the
  glossary and code comments only.

Against the three records:

- **0534:** `scheduled.yaml` and `issues.ts` cite 0534 as their why; after R1 that link lands on a
  true page. Today it lands on a title that says "every 3 hours".
- **0023:** AGENTS.md says "0023 lists the differences"; the list it lands on is stale. After R1
  the link goes to `.patterns/effect-differences-say-why.md`.
- **0129:** AGENTS.md's first lines cite 0129 as the why of the map; that is a why link and stays.

### R6: the map every agent reads fits its readers' limits

The always-read files (the root AGENTS.md, and the folder file read with it) stay under the
smallest documented limit of the agents that read them, checked by `pnpm lint`. Today that limit
is Codex's default of 32 KiB for the whole chain `[a4]`; Claude Code's advice is under 200 lines
per file `[a2]`. The number is a setting with its source beside it, never a number picked by hand.

**Lean, 65%.** The root file is 39,103 bytes. If a Codex step reads it with the default limit, the
text after byte 32,768 (line 389) is never seen: "How to write here", "Changing files" and
"Changing the product". For work in `next/`, root plus `next/AGENTS.md` is 49,516 bytes, and the
folder file, which "wins" `[a3]`, would be cut whole. The doubts: this was read in the docs, not
tested; `codexexec.ts` gives each run its own home and sets no `project_doc_max_bytes`, so the
default should apply, but whether a step's working folder makes Codex load the repo files was not
checked. And the other team's 500-word cap was poison `[x1]`: a size check is only safe with a
sourced number. What would settle it: one Codex run here that asks for a line from the last
section of AGENTS.md.

- **Effect row:** their repo file is about 55 lines; the package ships its own `AGENTS.md`
  matching the installed version `[a5]`.
- **Elm or OTP:** no fit.
- **Accessibility:** WCAG 3.1.5 loosely, as R3.
- **Cost:** a cut of about 7 KB from the root file, by 0129's three moves; R1 and R3 do most of it.

Against the three records: **0129** is this principle's own record; its "about 150 lines" target
becomes a sourced setting. **0534** has no map line, so nothing moves. **0023** has one map line
(the "Read the installed version" bullet links it), which stays as a link.

### R7: a byte-for-byte check guards only bytes a person approved

A check that compares exact bytes or a hash stays only where a person approved those exact bytes
(a plan the lead approved, a diff a reviewer saw) or where a copy must stay faithful (a patch's
quoted upstream lines). Anything else compares parsed values or formatter output. Each such check
names what it guards in its header.

**Lean, 80%.** The other team kept exactly these three kinds and removed the rest `[x1]`; its own
rule was to compare parsed values or formatted output. Here, [0600](../.decisions/0600-kalfa-quality-holds-test-lint-format.md)
already removed the plant runner's sha256 pins after two blank lines changed 27 hashes. The doubt:
whether a skill's required sentence counts as approved bytes. `skillscheck.sh` requires exact
sentences in five skills; its source says an approved plan asked for them, and [experiment 283](./283-context-audit.md)
found they keep three duplicates alive. Under R7 those become checks that a skill links the home,
not that it repeats a sentence.

What this repo has, read 2026-11-17:

```text
keep    box.sh            plan-sha256: the lead approved this plan body; 0343 is the same idea in the product
keep    leakgrep.sh       a pnpm patch quotes upstream lines byte for byte, so nobody rewords them
keep    oxfmt --check     compares to the formatter's own output, not to a typed copy
gone    plant runner      sha256 and commit pins on targets; replaced by Stryker (0600)
change  skillscheck.sh    exact sentences required in five skills; check a link to the home instead
```

- **Effect row:** no answer from what was read.
- **Elm or OTP:** no fit.
- **Accessibility:** no fit.
- **Cost:** a rewrite of `skillscheck.sh`'s clause table into link checks; 0113 means its rewrite is
  TypeScript, not Python in a shell file.

Against the three records: **0534** holds no byte check. **0023**'s format rows are held by
`oxfmt --check`, which compares formatter output, the kept kind. **0129**'s cut table ("a rule with
no row blocks the merge") is a reviewer's read, not a byte check, and stays judgment.

### R8: a finding seen twice becomes a check, measured before it blocks

When a review raises the same kind of finding a second time, the fix is a check, not a sentence in a
skill: a trusted tool's rule first (0040, 0573), else ours, advising until its false alarms are
measured, blocking only at about zero `[c1]`.

**Lean, 70%.** Tricorder's bar `[c1]` and AGENTS.md's own (0523, the 10% advise line) agree. The
other team's 9-times nit `[x1]`. The doubt: a new check is a cost, and the owner's standing view is
that a check is never the reflex answer; the Effect team's own means come first. So R8 counts only a
finding seen twice, and the first move is a trusted rule.

- **Effect row:** Effect turns style points into rules of its own (`effect/no-import-from-barrel-package`,
  which 0023's table cites).
- **Elm or OTP:** no fit.
- **Accessibility:** no fit.
- **Cost:** a count of findings by kind, which `field/findings/` rows can give.

Against the three records: **0534**'s issue rule became `issues.ts`, the model. **0023**'s "follow"
rows are exactly review nits waiting for a rule. **0129**: [0180](../.decisions/0180-instruction-files-take-quick-edits.md)
says a rule an agent missed after the cut "is put back, or given a better home, the day it is
seen"; R8 adds that the second miss gets a check.

### The smaller calls

1. **The key for a superseded record's successor.** `successor: "0162"` or MADR's prose. `by` is
   taken (who wrote it). Lean `successor`, 70%.

   ```yaml
   status: superseded
   successor: "0162"
   ```
2. **No word cap on records.** Nygard's "one or two pages" `[d1]` goes in the adr skill as advice;
   no check counts words. The other team's cap shows why. Lean, 85%.
3. **Search finds homes.** `records.ts find` covers records, `.patterns/` and `.runbooks/`; once
   rules live in skills and AGENTS.md, it should rank those too. Lean, 75%.
4. **A rule with no home yet stays in its record, edited in place,** not a new folder of topic
   pages as the other team made. One fewer kind of file. Lean, 65%; the doubt is that a record then
   holds both why and rule for a while.
5. **A home edit's commit names the record that decided it,** as a `Decision: 0581` trailer, so
   `git log --grep` answers "who decided this line, when". A fact lost if not written at commit
   time. Lean, 60%.
6. **The guidelines skill's index-row step** changes to follow 0522. This page follows 0522 now.

### What the ledger records

Nothing new. Smaller call 5 adds one commit trailer, which is git's, not the ledger's.

### A tryout in today's tooling

Sized in agent hours, a **guess** before the owner's yes on R1:

```text
1. records check in lead tooling, TypeScript, moving to @kalfa/records with 0585:
   status Schema (R4), no Amendments heading or still-holds line (R2), superseded links (R5),
   the map's size from its setting (R6)                         about 400 lines with laws, 3 h
2. the 36 check-held records cut to their why, in slices        about 4 h
3. the 30 judgment records: rules into skills, AGENTS.md,
   pattern docs                                                 about 9 h
4. the 41 checkable: each waits on its check (0408), then cuts  about 20 h, mostly next/ laws
5. the 9 history records marked superseded or left as history   about 1 h
6. skillscheck.sh's clause table becomes link checks (R7)        about 2 h
```

## What it cannot tell us

- **No agent ran.** Nothing here shows that agents do better with rules in their homes. The other
  team's 29% is theirs, measured by one agent's grouping that nobody checked, and not measured here.
- **The sort of the 116 is one agent's read of titles,** with three records read whole. It will
  disagree with the other agent's sort in places, and that sort wins where it read more.
- **R6's limit is from Codex's docs, not a run.** Whether our Codex steps load the repo's
  AGENTS.md at all, and at what limit, was not tested.
- **The cost of the walk-back** of 0115, 0130 and 0136 is not measured: how often an agent finds a
  rule by searching `.decisions/` today, and whether it would find it in a skill.
- **The tryout's hours are guesses** with no data from a sweep like this here.
- **Some sources are secondary:** the aviation checklist line, and "edited in place" for KEPs,
  which the fetched pages say only through one checklist line. The Effect team's practice outside
  its fetched `AGENTS.md` was not read.

## Links

- `[a1]` https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents
- `[a2]` https://code.claude.com/docs/en/memory
- `[a3]` https://agents.md/
- `[a4]` https://developers.openai.com/codex/guides/agents-md
- `[a5]` https://github.com/Effect-TS/effect/blob/main/.agents/AGENTS.md, and `node_modules/effect/AGENTS.md` at `effect@4.1.3`
- `[d1]` https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions
- `[d2]` https://adr.github.io/madr/
- `[d3]` https://github.com/kubernetes/enhancements/blob/master/keps/NNNN-kep-template/README.md
- `[d4]` https://github.com/rust-lang/rfcs/blob/master/README.md
- `[d5]` https://rustc-dev-guide.rust-lang.org/stabilization-guide.html
- `[c1]` https://6826.csail.mit.edu/2020/papers/google-analysis-cacm.pdf (CACM 61(4), April 2018)
- `[c2]` https://www.openpolicyagent.org/docs/latest/philosophy/
- `[o1]` https://www.legislation.gov.uk/help
- `[o2]` https://www.thehumandiver.com/post/how-to-building-an-effective-checklist (secondary, on Degani and Wiener, NASA 1990)
- `[x1]` another team's repo, a private study; not linked
