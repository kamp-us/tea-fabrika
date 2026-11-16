# 0050: mock plans' last commit is pushed, ready to sign (late mail: it landed at 06:29 UTC)

All 12 plans for https://github.com/kamp-us/tea-fabrika/pull/1491 are at `6a51d4e6bd`, on
`fabrikalfa/mock-plans`, with no open question. I am late: the commit landed at 06:29 UTC, and I
missed its report until now.

**No interim lock.** cloudflare Q2, app-src Q3 and node-dev Q3 are answered, as 0524 requires. Each
of those three plans has a new section, "The other `vi` hits 0555 bans", counted on main at
`0683861`:

| Folder | Hits | Fixed in this sweep | Waiting |
|---|---|---|---|
| cloudflare | 12 `vi.mock` | 5, in slice 2 (the `effect` mock, and 4 `./objects.ts` mocks by exporting the object implementations) | 7 `cloudflare:workers` mocks |
| node-dev | 2 `vi.mock`, 6 `vi.stubEnv` | the 6 env stubs, by passing the setting through `Config`; the `rolldown` mock takes 0555's one allowed exception, with a disable line and its reason | 1 `cloudflare:workers` mock |
| app-src | 25 `vi.mock`, 2 `vi.doMock`, 13 `vi.stubEnv` | 33, in a new slice 5 | 4 Alchemy mocks, 3 `cloudflare:workers` mocks |

**So three folders cannot reach zero in this sweep: cloudflare, node-dev and app-src.** Their `vi`
locks stay out, and their lock laws wait, landing whole with each folder's lock: cloudflare M11,
app-src A6 and A8, and node-dev M1. The mocks they wait on stand in for Cloudflare's platform module
or for Alchemy. Decision 0042 sends those through Alchemy work that **has no plan yet**. A finding row
in the cloudflare plan records that gap: `2026-11-15-cloudflare-workers-mocks-have-no-slice`. You
may want to give that Alchemy work a plan; it is what blocks the three locks.

- **app-src slice 5 is the weakest part.** The child sized it at 55%, because it did not read the
  33 hits call by call. Its tests step stops on any hit whose fix needs a design call. app-src's
  estimate rises from 14 steps and $62 to 19 steps and $93.
- **The rest of the commit:**
  - `fabrikalfa/mock-fold` is marked confirmed in all 12 plans.
  - The opening paragraphs name their decisions: cloudflare and node-dev add 0592, app-e2e and
    pipeline add 0054, and app-src and oxlint-plugins name their own.
  - The stdout row's end time is now 22:09:54 Pacific, from the commit time of `6de2b17`.
  - A new row is `field/runs/2026-11-15-mock-plans-amend-locks.json`.
- **Checks:** plancheck passes on all 12 plans, and so do format and lint at the pushed head.
  Leakgrep is clean on the commit and the PR body. The PR body now shows five commits, 72 steps and
  $309 in total. It stays a draft.

**Ready for the merge session to sign all 12 in one pass.** Once you relay that, a coordinator
starts the mock sweep build on `fabrikalfa/mock-fold`.
