# Byte-for-byte checks in this repo, as of 2026-11-22

This is a read-only inventory made for GitHub issue 1909 (https://github.com/kamp-us/tea-fabrika/issues/1909); every check in it predates the kalfa package suite and is reference only.

I found 60 checks in 7 kinds, plus a long tail of ordinary behavior tests that I did not list one by one. Three findings change how rule R7 reads (`.kalfa/guidelines/rules-and-records.md:125`):

- **R7's ticket example is not in `next/`.** "The product does the same for a ticket" is `packages/pipeline/src/tickets/approval.ts:24-64`, which is today's frozen version. I found no ticket-body hash anywhere in `next/`.
- **R7's "Breaks today" cites too little.** It points at `skillscheck.sh:18-19`. The real exact-sentence check is lines 18-40 and 99-148: about 40 required sentences or labels and about 10 forbidden patterns.
- **74 approved plans in `.kalfa/quests/` carry a hash line, and nothing re-hashes them in `pnpm lint`.** Only `box.sh` and `stepcommit.sh` check the hash, when a box starts from one.

## Legend

Version is `tooling` (lead and CI tooling), `next/`, or `today's` (frozen). Guard letters:

- (a) bytes a person approved
- (b) a copy that must stay faithful
- (c) a signature or security gate
- (d) generated output kept in step with its source
- (e) nothing I can name

"Typed" means a person or agent wrote it. "Made" means code produced it from data. Each entry ends with R (I read the code) or G (guess).

## A. Hash or exact bytes of something a person approved (13)

- **A1.** `.agents/skills/plan/scripts/plancheck.sh:101,122-124,326` (tooling). `--approved` requires sha256 of the plan body (everything after line 2) to match the 12 hex digits on line 1. `--draft` prints the digest. (a). Markdown, typed. R.
- **A2.** `.agents/skills/lead/scripts/box.sh:100-103,140-142,220,240` (tooling). Box start stores `plan-sha256`. Before every step the plan body is re-hashed and must match. (a). Markdown, typed. R.
- **A3.** `.agents/skills/step-commit/scripts/stepcommit.sh:196-198` (tooling). The same check again before a step commit. (a). Markdown, typed. R.
- **A4.** `.agents/skills/lead/scripts/flow/host.ts:312-335` (tooling). The in-process flow writes the same `plan-sha256` fact so A3 passes, a fourth copy of the hash code. (a)/(b). Markdown, typed. R.
- **A5.** `packages/pipeline/src/tickets/approval.ts:24-64`, used at `packages/pipeline/src/stages/pipeline/hosts.ts:143,203` (today's). An "approve" covers a ticket only while sha256 of JSON `[title, body]` equals the stored hash, "to the character". (a). Markdown, typed. R. This is R7's ticket example.
- **A6.** `packages/pipeline/src/tickets/approval.ts:43-56`, `packages/pipeline/src/tickets/ask.ts:220-238`, `packages/pipeline/src/stages/pipeline/pulls.ts:284` (today's). New asks store `saw`, an RFC 8785 canonical-JSON hash of `shows` (plan, diff, rules). The yes holds only if the recomputed hash is equal. (a). A hash over parsed data, but the strings inside are exact. Not plainly Markdown. R.
- **A7.** `packages/pipeline/src/combos.ts:281-289` (today's). An answer covers a question only if sha256 of the question's `about` text equals `saw`. (a). Text, typed. R.
- **A8.** `packages/pipeline/src/stages/mutation/scope.ts:40-56,128,145` (today's). An approved exam-file change holds only while the file's 12-hex hash is unchanged. (a). Code. R.
- **A9.** `packages/pipeline/src/stages/pipeline/carry.ts:12-27,63-70` with `packages/pipeline/src/stages/pipeline/work.ts:771-790` (today's). A review "yes" given on a diff carries to a new head when tree ids match, or when `git patch-id --verbatim` matches. (a). Code diff. R. The tree-id half is git's own hash, so out of scope.
- **A10.** `.agents/skills/lead/scripts/loosening.sh:388` (tooling). A changed exam (test) file is cleared only if its blob bytes are identical (`left == right`) or it is a mapped in-place rename. Anything else is an "unrecognized change" that goes to the lead's hand check. (a)/(c). Code. R.
- **A11.** `apps/fabrika/src/host/keybindings.ts:41,97-99,216` (today's). sha256 of `keybindings.toml` is its "version", and undo is refused if the version moved. (a). TOML, typed. R.
- **A12.** `next/apps/fabrika/src/exam/commits.test.ts:843` (next/). An inline snapshot pins every byte of `exam-paths.json`. `oxlint-plugins/README.md:530` says it "must equal `exam-paths.json` byte for byte". (a)/(c). JSON, typed. R.
- **A13.** `next/packages/libfabrika/src/node/repositories/RepositoriesGit.ts:373-380`, `next/packages/libfabrika/src/packs/RepositoryTrustLedger.ts:114,166`, `next/packages/libfabrika/src/packs/internal/open.ts:96` (next/). sha256 of the repo's `.fabrika/fabrika.toml` text is stored with a person's trust answer, and the opening's events must carry the same hash. (a). TOML, typed. R for hash and chain. G on whether a changed file asks again, since trust is kept per clone.

## B. Exact sentence or exact text a check requires (7)

- **B1.** `.agents/skills/lead/scripts/skillscheck.sh:18-40` (tooling). 15 clause rows, 10 distinct sentences. Each must appear, whitespace and backticks normalized, in one named section of a skill. (e), in the owner's R7 sense: it keeps copies alive. Markdown, typed. R.
- **B2.** `.agents/skills/lead/scripts/skillscheck.sh:99-148,192-207` (tooling). 30 more required sentences or labels (review 6, answer 7, exam 1, cleanup 5, landing 2, review-brief labels 8, quest-brief 1), matched case-insensitively. Plus 10 forbidden patterns as regexes. (e). Markdown, typed. R.
- **B3.** `.github/ci/plant-cases.ts:19-70,109-130` (tooling). An exact `before` source snippet must occur exactly once in the target file, else `source_unsupported`. (b)/(e). Code. R.
- **B4.** `.github/ci/l11-cases.ts` mappings and `derive`, shown at `.github/ci/l11-exercise.test.ts:36-60` (tooling). The same exact-anchor edits for the L11 measurement. (b). Code. G (I read the test, not the whole mapping table).
- **B5.** `.github/ci/workflow-lint/*.ts` (tooling). About 145 string-equality tests on fields of parsed YAML (`run === "pnpm lint"`). Examples: `changes.ts:79`, `caches.ts:164-171`, `host.ts`, `l11.ts`, `scheduled.ts`, all in `.github/ci/workflow-lint/`. (d). Already parsed, with exact literals. The count is G (pattern count); the examples are R.
- **B6.** `next/apps/fabrika/src/exam/edges.ts:1-20` (next/). An edge comment is matched by file, rules and reason text, found with the oxc parser. Advice only. (e). Code. R (header).
- **B7.** `kalfa/records/src/Runbooks.ts:20,62-65` (tooling). Exact heading words (Trigger, Roles, Steps, Exit, Comms) and a summary, read through mdast. (e). Already parsed Markdown, typed. R.

## C. A copy or transfer that must stay faithful (14)

- **C1.** `oxlint-plugins/vendored.ts:34-52`, `vendor/anti-slop/pin.json` (tooling). The git tree id of `vendor/anti-slop/src` at HEAD must equal the pin, and nothing there may be uncommitted. (b). Code, plus a few Markdown files inside. R.
- **C2.** `apps/fabrika/src/project-migration.ts:253-276,325` (today's). Each moved desk file's sha256 and size must equal the original's. (b). JSON, made. R.
- **C3.** `apps/fabrika/src/host/move.ts:121-131,214-225` and `packages/fabrika/src/host/move.ts:120-136,432-485` (today's). The ledger-copy "seal": the server's hash of the moved rows must equal the sender's, or the ledger does not open. (b). Not Markdown. R.
- **C4.** `next/packages/libfabrika/src/telemetry/internal/measurements.ts:298-306`, `next/packages/libfabrika/src/cloudflare/runtime.ts:681-706`, `next/packages/libfabrika/src/cloudflare/DispatcherLive.ts:123-127`, `next/packages/libfabrika/src/telemetry/Archive.ts:85-116` (next/). The R2 archive put checks sha256 of the body, and local rows are deleted only if R2's stored hash matches. (b). Not Markdown. R.
- **C5.** `kalfa/config/src/Package.integration.test.ts:136,302,317-327` (tooling). The packed archive's sha256 must be the same after the test stages and in the delivery folder. The archive includes `README.md`. (b). R.
- **C6.** `next/packages/libfabrika/src/runtime/Built.ts:49-69,103` and `next/packages/libfabrika/src/runtime/CodeStore.ts:17-48` (next/). A built program or served asset fails to decode if its hash is not sha256 of its source or body. (b)/(d). JS, CSS or HTML, made. R.
- **C7.** `next/packages/libfabrika/src/runtime/Code.ts:121`, `next/packages/libfabrika/src/cloudflare/runtime.ts:1735,1816`, `next/packages/libfabrika/src/cloudflare/index.ts:99-101`, `next/packages/libfabrika/src/runtime/internal/supervisor.ts:154` (next/). The hot-reload "is this the same code" test is a hash equality on program hashes. (d)/(e). JS, made. R.
- **C8.** `next/packages/libfabrika/src/node/launchd/BrainControlLaunchd.ts:233,246,262,305,326,378` (next/). The installed plist's bytes must equal the freshly compiled plist, else a "conflict". (d). XML plist, made. R.
- **C9.** `.github/ci/related.ts:232` (tooling). The receipt's sha256 must equal sha256 of the kept package archive. (b). R.
- **C10.** `.github/ci/related.ts:311-313,556` and `.github/ci/plant.ts:280-291,310-374` (tooling). After a fault or plant, the file's bytes and digest must be restored, and `git diff --exit-code` must be clean. (b). JSON and code. R.
- **C11.** `packages/fabrika/src/program/storage.ts:385,401` (today's). A stored slot's checksum must match its body, or it is read as a torn write. (b). Not Markdown. R.
- **C12.** `next/packages/libfabrika/src/runtime/Runner.ts:461-465,2894,2908` (next/). A letter id may be reused only with the same input, tested by a digest of the formatted JSON of parsed fields. (c)/(e). R.
- **C13.** `next/packages/libfabrika/src/gateway/Gateway.ts:1495-1496,1969,2152` (next/). A delivery's stored `hash` must equal the hash of the message JSON. (c). R.
- **C14.** `kalfa/config/src/Snapshot.ts:57-71,178-181` (tooling). A saved settings snapshot's hash must equal the hash of its canonical, sorted values. This is already a hash of parsed data. (b). R.

## D. Pinned hashes and pinned bytes in experiments and tests (6)

- **D1.** `.github/workflows/l11-exercise.yaml:63-112`, `.github/ci/l11-cases.ts:36-72,85-91,115,513,529`, `.github/ci/l11-exercise.ts:2088,2101,2316-2324,2569` (tooling). A manual measurement refuses to run unless the source files, lockfile, workspace file, edited files and diffs match pinned sha256 values. About 30 pins. (a). Code and YAML. R.
- **D2.** `scripts/effect-arbitrary.test.ts:114-123` (tooling). sha256 of 300 generated cases must equal `ed2eda1836897dbf`. (a). Not Markdown. R.
- **D3.** `packages/fabrika/src/hash.ask-desk.test.ts:16-20` and `apps/fabrika/e2e/ask-desk.ts:229` (today's). A pinned RFC 8785 vector. (a). R.
- **D4.** `packages/pipeline/src/stages/pipeline/key.ts:45` and `packages/pipeline/src/stages/pipeline/lane.typed-again.test.ts:406` (today's). A step's input key is sha256 over its inputs. The test checks the recorded key. The header says nothing reads it to skip a step yet. (e). R.
- **D5.** `packages/pipeline/src/stages/pipeline/briefs.ts:28-45`, `packages/pipeline/src/stages/pipeline/program.ts:1967,1986` (today's). The hash of a brief file is recorded on each run, compared nowhere I found. (e). Markdown briefs, typed. R for the hash. G for "compared nowhere".
- **D6.** Tests that pin written formats byte for byte (next/): `next/apps/fabrika/src/exam/commits.test.ts:122-137` (signed text v2), `next/packages/libfabrika/src/transport/Sshsig.test.ts:83`, `next/packages/libfabrika/src/transport/Sshsig.integration.test.ts:134-145` (equal to what `ssh-keygen` writes), `next/packages/libfabrika/src/transport/SshsigWebauthn.test.ts:422`, `next/packages/libfabrika/src/settings/TomlEdit.test.ts:847`. (b). Made text. R for those lines, G that the list is complete.

## E. Generated output kept in step with its source (8)

- **E1.** `.github/workflows/check.yaml:310` runs `git diff --exit-code -- unreachable-ledger.json`. `pnpm lint` prunes it (`oxlint-plugins/lint.ts:245-251`), so the pruned file must be committed. (d). JSON, made. R.
- **E2.** `.github/workflows/check.yaml:316`, the same for `agents-ledger.json`. (d). R.
- **E3.** `.github/workflows/check.yaml:320`, the same for `next-ledger.json`. (d). R.
- **E4.** `packages/fabrika-design/src/build/tokens.ts:484-531`, run as `tokens.ts --check` in `pnpm lint`. `tokens.css` regions, `theme-colors.ts` and `token-names.json` must equal what the TOML gives. (d). CSS, TS, JSON, made. Lives under `packages/` but is new foundation work. R.
- **E5.** `oxlint-plugins/format.ts` (run as `format.ts --check`) and `.agents/skills/step-commit/scripts/stepcommit.sh:255-277` (staged files, `oxfmt --check`). The file must equal the formatter's output. (d). R7 allows this one.
- **E6.** `next/packages/libfabrika/src/node/build/build-one-file.integration.test.ts:387,438,989,1343` and `next/packages/libfabrika/src/node/dev/watch.laws.integration.test.ts:1175` (next/). Two clean builds write the same bytes, and a refused build leaves the last brain "byte for byte". (d). JS, made. R.
- **E7.** Cache keys, not gates: `.github/workflows/check.yaml:363` (`git hash-object` of lockfile and tsconfigs), `.github/workflows/host.yaml:77` (`hashFiles`), `.agents/skills/lead/scripts/mutbox.ts:1104` (image tag). `.github/ci/workflow-lint/caches.ts:39` requires that exact command string. (e). R.
- **E8.** `next/apps/fabrika/src/settings-generated.test.ts:93-128` (next/). The settings reference Markdown and JSON schemas are made when read, and the law compares outputs across declaration orders. (d). Markdown, made from data. G (I read the test header and a few lines).

## F. Signatures and keyed checks (6; signatures, not Markdown)

- **F1.** `.agents/skills/lead/scripts/box.sh:78-97` (tooling). `ssh-keygen -Y verify` over the text `fabrika-step attested v2\nstep…from…to…`, key fingerprint equality, tree ids, and `verify-commit` for people. Line 86 builds the signed text a second time, apart from F2's `signedText`. (c). R.
- **F2.** `next/apps/fabrika/src/exam/commits.ts:118-135,499-524,559-613,918,1092` (next/). `signedText` is the signed bytes. Plus verify, commit-signature checks, a squash-tree equality, and sign. (c). R.
- **F3.** `.agents/skills/step-commit/scripts/stepcommit.sh:292-293` (tooling). Calls `pnpm commits sign`. (c). R.
- **F4.** The product's gates (next/), all (c):
  - `next/packages/libfabrika/src/transport/Sshsig.ts:183-240` (SSHSIG verify).
  - `next/packages/libfabrika/src/transport/Webauthn.ts:197-205,279-281` (passkey signature and rp-hash equality).
  - `next/packages/libfabrika/src/transport/Hello.ts:162-175` (key fingerprint must equal `name`, plus the signature over `helloText`).
  - `next/packages/libfabrika/src/gateway/Gateway.ts:1012-1037,1079-1100,1152` (grant and enrollment signatures; a replay is accepted only with the exact same `text` and `armored`).
  - `next/packages/libfabrika/src/gateway/GatewayNonce.ts:100-108` (HMAC).
  - `next/packages/libfabrika/src/access/Text.ts` (the signed texts, made from data by code).

  R.
- **F5.** `packages/fabrika/src/host/sshsig.ts:149-250` and `packages/fabrika/src/host/door.ts:385-389,494,592` (today's). SSHSIG verify, and a token hash compare. (c). R.
- **F6.** `.agents/skills/lead/scripts/botpush.mjs:151` (tooling). Makes an RS256 token and compares nothing. Listed for completeness. (c). R.

## G. "Byte for byte" claims or loose compares with no strict check behind them (6)

- **G1.** `.agents/skills/write-pattern/SKILL.md:106`. An agent "compares byte for byte" a pinned version against `pnpm-workspace.yaml` with `rg`. Instruction only. (b). R.
- **G2.** `.agents/skills/build/SKILL.md:87`. "An import line a list already holds stays byte for byte as main has it." Instruction only. The ratchet (`next/apps/fabrika/src/exam/ratchet.ts`) already compares parsed rows. (b). R.
- **G3.** `oxlint-plugins/tracked-scripts.ts:42-45`. Says vendored skill scripts are "kept byte for byte". The code only exempts them from the no-shell rule, and no check compares them to upstream. (e). R.
- **G4.** `.agents/skills/lead/scripts/leakgrep.sh:84-100` and `.agents/skills/lead/scripts/leakgrep.patches.test.ts:10-14`. Says patch files quote upstream "byte for byte", so quoted lines skip style rules. Nothing compares them to upstream. (e). R.
- **G5.** `.github/ci/fixtures/same/*.txt` and `.github/ci/program.test.ts:461-470`. Saved copies "byte for byte" from a squash commit, but the test compares a parsed "same program" answer from `.github/ci/program.ts`. (b) is claimed, not checked. R.
- **G6.** `.agents/skills/lead/scripts/leakgrep.sh:119-123`. Two lines count as the same text after whitespace is collapsed, so it is a loosened compare, not a byte compare. (d). R.

## H. Long tail, not enumerated

Many behavior tests assert "the file is unchanged" or "same bytes". Examples:

- `next/packages/libfabrika/src/ledger/Ledger.integration.test.ts:528`
- `next/packages/libfabrika/src/runtime/CodeStoreTest.ts:185`
- `next/programs/checklist/src/RunnerTest.ts:349-388`
- `next/apps/fabrika/src/port-home-guard.integration.test.ts:10`
- `.agents/skills/lead/scripts/redact.test.ts:313`

I count roughly 40-45 test files with this shape (G). I treated them as ordinary assertions, not checks to rule on one by one.

## Count per kind

| Kind | Count |
|---|---|
| A. approved bytes or hash | 13 |
| B. exact sentence or text | 7 |
| C. faithful copy or transfer | 14 |
| D. pins in experiments and tests | 6 |
| E. generated output in step | 8 |
| F. signatures and keyed checks | 6 |
| G. claims or loose compares, no strict check | 6 |
| Total | 60 |

Markdown typed by a person or agent (so a candidate for "check parsed data instead"): A1-A5, A7, B1, B2, D5, G1, G2. Markdown made by code: E8 only. The rest is code, JSON, TOML, XML, archives or binary.

## Parsed-data checks that already exist, as models for a replacement

- `.github/ci/program.ts` (same-program test on the syntax tree)
- `next/apps/fabrika/src/exam/ratchet.ts` (keyed rows)
- `kalfa/records/src/*` (mdast)
- `kalfa/quality/src/stryker/Target.ts` (finds a plant by shape; "no byte offset or commit is pinned")
- `kalfa/config/src/Snapshot.ts` (hash of canonical values)
- `packages/fabrika/src/hash.ts` (RFC 8785 canonical JSON)

## The 5 hardest to replace with a check on parsed data

1. **Commit-step signatures (F1-F3).** A signature is over exact bytes by definition. The signed text is already made from parsed fields, so nothing is left to parse.
2. **The product's signature and HMAC gates (F4, F5).** These follow outside standards (SSHSIG, WebAuthn, HMAC) that verify raw bytes, and replay protection needs the exact same signed text.
3. **Plan approval hash (A1-A4).** It protects the exact free prose a lead read. A parsed version needs a rule for what counts as the same prose, and that rule is the hard part. Table and owner rows could be parsed, but the prose could not.
4. **Ticket and ask approval hashes (A5-A7).** A yes means "on this text". The new `saw` hash (A6) already hashes parsed canonical JSON, but the plan and diff strings inside stay exact. A ticket body typed as Markdown would need a canonical Markdown form.
5. **Integrity hashes between systems (C3, C4, C5, C6, C11).** R2, the ledger server or the archive reader verifies bytes on the other side, and the data is binary or JSON, not Markdown. A parsed check cannot stand in for the other side's check.

## Easy to drop or replace

- B1/B2: move clauses into data that skills link to.
- D1: the L11 pins guard a one-time manual measurement, and could simply go.
- A12: the `exam-paths.json` snapshot could compare parsed rows.
- B3/B4: the newer `.github/ci/plants.ts` + `kalfa/quality` route already avoids byte anchors.

## What I could not search or did not do

- **Not run:** `gh search code` (the lead skill suggests it first). I used scoped local `nice -n 19 rg` instead, because I needed line numbers. Load was about 6-7 while I searched, with no `tsgo` running.
- **Not searched, by design:**
  - `node_modules`, `dist`, `runs/`, `.tmp-review/`, `.playwright-mcp/`
  - untracked root files (`docs/`, `adr104.out`, `armed.*`, `m-194.md`, `n-53.md`, `n-98.md`, `flaky-lane-writes.md`)
  - `pnpm-lock.yaml` and `adapters/pnpm-lock.yaml` (lockfile integrity, out of scope)
  - git history and other branches
- **Folders with no checks found:** `.claude/` (31 skill links, 4 agent files), `.fabrika/` (1 file), `bin/`, `adapters/`, `patches/` (only the G4 claim), `experiments/` (0 tracked files).
- **Every other named folder** got every wording: `.agents/`, `.github/`, `.kalfa/`, `oxlint-plugins/`, `scripts/`, `package.json` and all other `package.json` scripts, plus `kalfa/`, `next/`, `packages/`, `programs/`, `apps/`, `fixtures/` and `vendor/`.
- **Wording `exact`:** too common to sweep alone. I searched it only in combinations (`exact text`, `exact bytes`, `exact file`, `exactly equal`, `exactly the same`).
- **`.kalfa/quests/*-PLAN.md` (76 files):** searched for wording only. They describe checks and are not checks.
- **Read only partly (G):** `.agents/skills/lead/scripts/movecheck.ts` (a "move changes no line of logic" line compare, read by header only, so not in the list), `.agents/skills/lead/scripts/leakgrep.sh`, `.agents/skills/lead/scripts/loosening.sh`, `next/apps/fabrika/src/exam/edges.ts`, `.github/ci/l11-cases.ts` mappings.
- I ran no test, lint or typecheck.
