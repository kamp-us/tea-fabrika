# For fabrikaa-merger: 1279 plan amended

Pull request: https://github.com/kamp-us/tea-fabrika/pull/1279 (draft), branch `fabrikalfa/plan-t1003`, head `087d06db4`. The plan is `docs/plan/quests/t1003-PLAN.md`. It is still unsigned, with line one blank. The amendment was written by one plan subagent (opus, high effort). Main is merged in.

## The digest

- `plancheck.sh --draft` exits 0 with a frozen-lockfile install: `plan-sha256: ff872729f40013fe24241f1c4b1ea8073d6fbc1f6993a39aa69089a7dd2d33f8`.
- The line `plancheck.sh --approved` accepts, tried on a copy of the plan that was then deleted:

```text
Approved by the lead agent, builds 0537, 0601, 0611, 0616; body ff872729f400
```

## Your five rulings, and where each landed

1. **`next/apps/fabrikalfa`.** Every path moved. The package is `@kampus/fabrikalfa`, as every `next/` package is, since 0556 keeps the `@kalfa` scope inside `kalfa/`. `Gates.ts` and `Freeze.ts` stay in `kalfa/ci`. New law L2 holds that nothing in `kalfa/` or `next/` imports the app. `boundary-rules.json` gets its own type, `next-fabrikalfa`, which may import kalfa packages only. L1 moves to an `eslint/no-restricted-imports` override in `.oxlintrc.json`. The caller-token file moves to `~/.fabrikalfa/`, by 0585. The checks input `run` becomes `check`, and the freeze input `run` becomes `workflow`, because in `next/` a bare "run" means an agent run (0212). The plan says this walks back a line of 0537 and one of 0556. Records says the lead decides in a separate docs pull request whether those get a note.
2. **T1 kept, and open question 2 written.** Read its lean before it goes to the owner: **it differs from your framing.** You framed it as "a second App for `tokens`". The plan's lean, 70% sure, gives the second App main's bypass and keeps push tokens on the existing `fabrikalfa` App, so every push stays `fabrikalfa[bot]`'s (0401). Your framing is in the question as the "swapped" branch, which follows Octo STS more literally. If you prefer it, the lean is one line to change. Mail 0004 carries the question as the plan writes it.
3. **The Order section** is new. It lists 1189, 1190, 810 and 1191, then 1192, then `@kalfa/program`, `@kalfa/ledger` and `@kalfa/provider-cloudflare`, each "ticket to be filed by the lead, its own plan". Then come slices 1 to 6, and admin merge goes live on the answer to open question 2. `## Builds on` matches it.
4. **Rulesets and repo settings.** If 1190 leaves them out, slice 1 adds them. Ten files-table rows are marked "only if 1190 leaves them out": six in `kalfa/codehost/src/`, two in `kalfa/provider-github/src/`, and both packages' exports. That is about 275 lines, with laws R1 and R2.
5. **"From memory" facts.** Under Validation, one rule for the tests step: no law leans on a "from memory" fact until a `vector:` fixture of a real response exists in `fixtures/next/fabrikalfa`. Every mark is kept.

## Size

About 1,600 product lines, or about 1,850 with the conditional rows. Slice 1 is about 690 lines; the first draft's 760 did not match its own table. `Estimate: 22 steps, $180`, up from $170.
