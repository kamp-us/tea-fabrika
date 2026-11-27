# A review verdict is a record on the reviewed head, and `ci-required` reads it on the merge queue

Today a review verdict lives only in the lead's chat, so nothing ties it to the code it judged, and code pushed after the
review can merge. The pipeline map (https://github.com/kamp-us/tea-fabrika/issues/2336) asked for a gate that every merge
path meets. The owner ruled on 2026-11-26, on the research in `.kalfa/research/review-and-merge-gates.md`:

- **The lead records the verdict, the reviewer stays read-only.** The lead writes a `review` record on the head the
  reviewer read, with the bot token it already has (the one `botpush.mjs` mints). The record is a check run, as the research
  recommends; a commit status named `review` is the fallback if that token cannot be given `checks: write`. No second GitHub
  App for now. One is added later only if it is needed.
- **`ci-required` enforces it, on the `merge_group` run.** The step finds the pull request of the queue entry, reads the
  `review` record on that pull request's head, and fails when there is no `success`. `review` is not a required status of
  its own: nothing posts it on the queue's temporary commit, so the entry would wait out the 180-minute timeout and be
  removed. The ruleset's merge-queue grouping goes from `HEADGREEN` to `ALLGREEN`, so an entry with no verdict cannot ride
  along behind a green head entry.
- **An admin merge needs a written override reason and is logged.** The ruleset's bypass mode for the admin role goes from
  `always` to `pull_request`, never `exempt`, so each bypass shows in the pull request and in the audit log. `land.ts`
  refuses an admin merge with no verdict unless the lead passes a reason, which it records on the head.
- **Changes under `next/` and `kalfa/` need a review. Docs and lead tooling do not,** as today.

We chose this because the queue is the one door every path crosses (`queue`, `arm`, the "Merge when ready" button), so a
gate there holds even when a script is skipped, and because a record keyed to one head cannot cover code that came after.
The new tickets are https://github.com/kamp-us/tea-fabrika/issues/2338 (record the verdict by one command, and the
`land.ts` paths read it) and https://github.com/kamp-us/tea-fabrika/issues/2339 (the `ci-required` step and the ruleset
changes).

## Considered Options

- A required `review` commit status: rejected, because the merge queue tests a commit that is not the pull request's head,
  nobody posts `review` there, and every entry would stall until the timeout. About 85% sure from the docs; no test run.
- A reviewer commit (the verdict as a commit pushed by the reviewer): rejected, because the reviewer stays read-only, and a
  commit moves the head it judges.
- A second GitHub App that only judges (the research's pick): rejected for now, because it costs an organization owner's
  setup and a second key, and the lead's token does the work today. It is the first thing to add if the weakness below
  matters.
- A bot's pull request approval with "dismiss stale approvals" on: rejected, because the docs do not say an App's approval
  counts toward the required review count, GitHub's "update branch" may dismiss it with no carry rule we control, and the
  queue does not judge reviews again on its own commit. A 20-minute test on a scratch repository would reopen it.

## Consequences

- The same key pushes code and writes the verdict, so the ruleset cannot pin the `review` record to a source that only
  judges, and anyone holding the lead's token can write `success`. This stops a forgotten review, not a forged one.
  The second App closes it.
- The gate is a step in `check.yaml`, which a pull request can edit, so a pull request could drop its own gate. Same limit:
  it stops a mistake, not an attack.
- A pull request put in the queue by hand with no verdict fails at the end of its queue run, not before. The `land.ts`
  paths check first, so the gate is the backstop.
- An admin can still merge. The bypass is now loud and carries a reason, but it is not blocked, because sev work needs it.
- Not decided here: how a record carries over a merge of main into the branch, which makes a new head with no new code. The
  research proposes a patch id of the change's own diff, with a second record on the new head, in the way decision 0066
  chose for approvals. Ticket 2338's plan settles it.
- Not decided here: the hourly mutation run's restart and its heartbeat (https://github.com/kamp-us/tea-fabrika/issues/2340).
  That is a workflow trigger, easy to reverse, so it is a ticket and not an ADR.
