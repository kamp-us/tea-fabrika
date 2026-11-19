# For fabrikaa-merger: 1279 plan amended

Pull request: https://github.com/kamp-us/tea-fabrika/pull/1279 (draft), branch `fabrikalfa/plan-t1003`, head `9fb9bb20e`. The plan is `docs/plan/quests/t1003-PLAN.md`. It is still unsigned, with line one blank. It now carries two amendments, each written by one plan subagent (opus, high effort): your five rulings, then the two owner calls you relayed after them (the inbox, and the web UI). Main is merged in. One commit between them, `1c7fc2dfe`, is a work-in-progress snapshot that a stop hook forced; read the plan at the head.

## The digest

- `plancheck.sh --draft` exits 0 with a frozen-lockfile install: `plan-sha256: b42fa3b8f7f24e85a9910d980acd8e958525c09fafd4fc365940f9de7f0d9503`.
- The line `plancheck.sh --approved` accepts, tried on a copy of the plan that was then deleted:

```text
Approved by the lead agent, builds 0537, 0601, 0611, 0616; body b42fa3b8f7f2
```

## Your five rulings, and where each landed

1. **`next/apps/fabrikalfa`.** Every path moved. The package is `@kampus/fabrikalfa`, as every `next/` package is, since 0556 keeps the `@kalfa` scope inside `kalfa/`. `Gates.ts` and `Freeze.ts` stay in `kalfa/ci`. New law L2 holds that nothing in `kalfa/` or `next/` imports the app. `boundary-rules.json` gets its own type, `next-fabrikalfa`, which may import kalfa packages only. L1 moves to an `eslint/no-restricted-imports` override in `.oxlintrc.json`. The caller-token file moves to `~/.fabrikalfa/`, by 0585. The checks input `run` becomes `check`, and the freeze input `run` becomes `workflow`, because in `next/` a bare "run" means an agent run (0212). The plan says this walks back a line of 0537 and one of 0556. Records says the lead decides in a separate docs pull request whether those get a note.
2. **T1 kept, and open question 2 written.** Read its lean before it goes to the owner: **it differs from your framing.** You framed it as "a second App for `tokens`". The plan's lean, 70% sure, gives the second App main's bypass and keeps push tokens on the existing `fabrikalfa` App, so every push stays `fabrikalfa[bot]`'s (0401). Your framing is in the question as the "swapped" branch, which follows Octo STS more literally. If you prefer it, the lean is one line to change. Mail 0004 carries the question as the plan writes it.
3. **The Order section** is new. It lists 1189, 1190, 810 and 1191, then 1192, then `@kalfa/program`, `@kalfa/ledger` and `@kalfa/provider-cloudflare`, each "ticket to be filed by the lead, its own plan". Then come slices 1 to 6, and admin merge goes live on the answer to open question 2. `## Builds on` matches it.
4. **Rulesets and repo settings.** If 1190 leaves them out, slice 1 adds them. Ten files-table rows are marked "only if 1190 leaves them out": six in `kalfa/codehost/src/`, two in `kalfa/provider-github/src/`, and both packages' exports. That is about 275 lines, with laws R1 and R2.
5. **"From memory" facts.** Under Validation, one rule for the tests step: no law leans on a "from memory" fact until a `vector:` fixture of a real response exists in `fixtures/next/fabrikalfa`. Every mark is kept.

## The second amendment: the two later owner calls

- **Slice 7, the lead's inbox, about 280 lines (70% sure).** Agents send through `POST /ask { _tag: "lead", input: { _tag: "send", id, sentAt, m } }`, and `m` is one of three messages: `status`, `plan` or `usage`. A usage message holds counts only, never message text. The answers are `queued { pos }` (a resend under the same id gets the same pos), `full` and `acked`. Only the `lead` identity reads, at `GET /inbox/lead?after=`, and each reader's place is an `acked` entry. The size limits are settings: `[mailbox] capacity = 256` and `chunk = 65536`. The client is `.agents/skills/lead/scripts/inbox.ts`. Its laws are I1 to I5, and P1 grows to cover the inbox asks. It follows 0601 (Runtime's mailbox), 0103, 0109, 0547 and 0582, and the glossary's `ack (inbox)` row.
- **The deletion, slice 7's last step,** waits for one week of messages through the inbox. It first copies every `fabrikalfa/mail-*` branch on `origin` into the private archive (0027), with their usage files and the `mail/` folder two branches carry, then deletes the branches. There were 46 `mail-session_*` branches on 2026-11-19, plus `mail-experiments`, `mail-t955` and `mail-twin`. Mail branches stay as the stopgap until then. 0525 lists `.agents/` as not frozen, so nothing frozen is touched. The deletion has no law, since no repo code writes the branches.
- **The web UI, `dashboard`, a later slice** (Order item 16). It is a program with a view at `GET /` and no shell. It shows the settings with drift (bypass lists read-only, per 0603), each program's journal and merger's queue. Its one write is `settings.propose`, which opens a draft pull request against `.fabrikalfa/fabrikalfa.toml`, so law S2 still holds. It is built from Manti parts (0461) and the shared design package (0456), and it speaks plain JSON over HTTPS, so a browser is its client. Its own build owes how Linear would build each screen, the look step and shots at the five layouts; this plan designs no look.
- **Open question 1 grew**, so its owner mail 0002 is updated. Agents may now send to the lead's inbox. The lead may read and ack it, and no other caller may read it. Later, a person known by a signed login may propose a settings change.

## Read closely in the second amendment

1. **Who "the merger" is (75%).** The plan reads "the lead and the merger read it" as your own landing session, not fabrikalfa's `merger` program. It is in "Doubt first".
2. **No mail watcher or usage collector is in the repo.** `.agents/`, `scripts/`, `.claude/` and the workflows folder were searched. The deletion step asks the lead to list the real watchers, which are likely the sessions' own loops.
3. **Usage rows wait for the owner's own words.** Child sessions refused to send usage rows on a relayed yes, so the plan holds usage sending until the owner's answer to open question 1 is written as a decision.
4. **The UI's write path is the plan's reading (70%).** No settings protocol is settled yet, so the plan reads it as asks to the settings program that become a pull request.

## Size

Seven slices, about 1,880 product lines, or about 2,130 with slice 1's conditional rows, and about 16 agent hours. Slice 1 is about 690 lines; the first draft's 760 did not match its own table. `Estimate: 26 steps, $210`, up from $170 in the first draft and $180 after the first amendment.
