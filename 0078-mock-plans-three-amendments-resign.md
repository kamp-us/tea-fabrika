# 0078: three mock-plan amendments are ready for one re-sign

`fabrikalfa/mock-plans` is at `c2dee77272d34156865e3220269ae4529e8ff588`. On top of your signed
`5ecab3938`, it carries three amendments, each one commit, each pushed without force:

| Commit | From | What it changes |
|---|---|---|
| `f52376bea` | group 1 | the chained-vi pair, in all 12 plans |
| `77c4f6d41` | group 3 | app-src: a slice 2 build row for `dev.ts` |
| `c2dee7727` | group 3 | cloudflare: 0095's sibling layer files, and the Files rows the build needs |

For each commit, `plancheck --draft` on an unsigned copy exits 0, the full `pnpm lint` passes, and
leakgrep is clean. `plancheck --approved` fails only on the body hashes, which your re-sign clears.

Three slices wait on this re-sign: group 1's app-e2e L5 round, app-src s2's build, and cloudflare
s2.

## Why not wait for node-s1 too

Group 2's node-s1 amendment, option (b) from your ruling, is not written yet. I am not holding
these three for it. Group 2 adds its one commit on top of your re-signed head, and it comes to you
as a second, smaller re-sign.

## Group 1, `f52376bea`: the chained-vi pair

- All 12 plans are amended, because all 12 locks name vi methods. For app-src, cloudflare and
  node-dev, the note says this is the shape their lock takes when it lands later.
- Each plan cites oxc#29656.
- Each has a pair sketch that restates the `no-restricted-properties` entries its folders already
  take on main (JSON.parse, and Reflect where it applies).
- Each has the chained-forms plant, red first.
- app-e2e's patch note and pipeline's reader note cite Effect#10665. They say the patch adds only
  `warnLines`, plus pipeline's `infoLines` and `debugLines`. No plan line said it adds
  `errorLines`.
- Three old lock plants were chained calls that the vitest rule alone never refused: app-e2e L5,
  node M2 and pipeline L2. Each now turns red through `no-restricted-properties`.

**One call for you (the plan step is 85% sure).** `plants.test.ts` checks each plant against one
rule only. So `VI_METHODS` keeps its chained lines as `false`. A second plant, `VI_PROPERTIES` (a
new name), holds them as refused against `no-restricted-properties`, the way `REFLECT` is checked.
The other way is to teach the plants test to accept a hit from either rule.

## Group 3, `77c4f6d41`: app-src's `dev.ts` row

This is a slice 2 build row for `next/packages/libfabrika/src/node/dev/dev.ts`, for law B3. It is
the one-line `Context.add` of `ChildProcessSpawner`, plus its import, as mail 0074 described.
Nothing else changed.

## Group 3, `c2dee7727`: cloudflare, under 0095

It touches `docs/plan/quests/mock-cloudflare-PLAN.md` only. Its notes are dated 2026-11-16, as my
ruling as lead.

**The ruling.** 0095 is in force and covers this case, so I ruled it without asking you. The plan's
sketch gave `Waits` and `Dispatcher` static layers, which 0095 forbids. Under the amendment:

- `Waits.ts` and `Dispatcher.ts` hold only their contracts.
- Their live layers go in `WaitsLive.ts` and `DispatcherLive.ts`, named like the repo's
  `HandsTasksLive.ts` and `MailDeliveryLive.ts`. They are read as `WaitsLive.layer`.
- The fixed sketch sits beside the old one, and the old `static readonly layer` lines are marked
  wrong.

**New Files rows:**

- `DispatcherLive.ts` and `WaitsLive.ts`: the live layers.
- `record.ts`: `recordPartImplementation`.
- `ProcessObject.ts`: `implementation`, reading `SinkLayer` and `RunnerLayer`.
- `ConnectionObject.ts`: provides `WaitsLive.layer`.
- `next/apps/fabrika/src/brain.ts`: provides `DispatcherLive.layer`.
- `next/packages/libfabrika/package.json`: exports `Waits` and `WaitsLive`.
- `door.integration.test.ts`: `WaitsLive` at run time.
- `reload.laws.test.ts`: L12 provides `DispatcherLive`.

**Changed rows:**

- `objects.ts`: now 0 lines, not changed.
- `runtime.ts`: no longer provides the two layers.
- `control.ts` and `connection.ts`: name the Live files.

**Tests rows,** for the laws whose imports change: `readers.laws` (M1, M2), `alarm.laws` (M8),
`ObjectService` (M9), `error-cause` (M10) and `connection.test`.

The plan said those names are "exported from objects.ts". The code's names are
`recordPartImplementation` and `ProcessObject.implementation`, and the code wins.

If you would rather keep the static layers against 0095, that is a ruling against an accepted
decision, so the owner's. Say so before you sign.

## After the re-sign

| Group | Next |
|---|---|
| Group 1 | app-e2e's L5 round, then lib-top's pair lock, then the review. app-e2e-s1's tests fix is at `687479bfe`. lib-top-s1's build is still running. |
| Group 3 | Cloudflare s2 runs a tests round for the import changes, then its build. App-src s2's build runs. |
| Group 2 | Adds the node-s1 amendment on top of your head, for a second re-sign. |

## What this cannot tell you

Whether `VI_PROPERTIES` or a plants test that accepts either rule reads better over time. Neither
has been built.
