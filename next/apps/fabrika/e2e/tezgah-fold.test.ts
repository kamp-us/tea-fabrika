import { Effect } from "effect";
// Desk S4, next/ (the desk program fabrika/tezgah, ticket named by its title): law L33 of the approved
// plan (docs/plan/lanes/desk-PLAN.md), and the slice's shots. Written before a window folds. Starts the
// real `dev.ts` in its own temp home on its own port and drives headless Chromium: a 1440x900 tab
// beside a 1024x700 tab, both on workspace 1. Every resource is acquired in one scope through
// `p14.test-support.ts`.
//
// What this law holds the tab to, from the plan, 0506's lessons and the brief (the build may add more):
// - Size belongs to the viewer (0277): each tab folds tezgah's one layout to its own size. A tile the
//   frame draws under 220x120 in a tab is a strip there, the focused tile never; the other tab draws it
//   open when it fits there. A strip is a real button named `open <program>, t<n>`.
// - L33: Tab onto a strip shows its ring and moves no desk focus. Enter on it, or a click, focuses its
//   tile, so it opens: tezgah's focus is that tile, the tab draws it as a region, and DOM focus is in
//   it. The tile it left folds again where it does not fit.
//
// The layouts a strip needs are made by tezgah letters from a second granted client (plan amendment
// 6, point 4): a window refuses a split with no room at its own size (L18), and a split only halves,
// so no split made in either tab could leave a tile that folds in one tab and fits in the other. The
// letters make a tile of 3/16 of the width, which the frame draws about 266 wide at 1440 and about 188
// at 1024, and a tile of 1/16, under 220 in both.
//
// The shots (plan, "Show it running"; AGENTS.md, "Shoot more than one layout") go to the folder
// `SHOTS` names, only when it is set, named `tezgah-fold-<state>-<layout>.png`. One tile is never
// shot: a lone tile is focused, so it never folds.
import { describe, expect, it } from "vitest";
import { browser, devServer, grant, home, profile, reader, suite, tab, waiting } from "./p14.test-support.ts";
import {
  domSettles,
  type FoldDrawn,
  focused,
  focusRing,
  foldDifferences,
  foldSettle,
  keys,
  regionName,
  shoot,
  shown,
  stripName,
  stripsHere,
  tell,
  tezgahPid,
  typeId,
} from "./tezgah.test-support.ts";

/** The law's own limit in ms: a brain, two tabs and about sixty waits of at most 30 s each. */
const LIMIT = 600_000;
/** How long the law waits to see that something did not happen, in ms: a move reaches tezgah and
 *  comes back in well under a second on the real `dev.ts`. */
const QUIET = 2_000;
/** How many Tabs may lie between a tile's title bar and the strip after it: the checklist's field,
 *  its button and its rows. */
const TABS = 30;

const promised = <A>(f: () => Promise<A>) => Effect.promise(f);

type View = Parameters<typeof foldDifferences>[0];
type Page = Parameters<typeof shoot>[0];

describe("L33: a smaller tab folds what does not fit, and a strip opens by Enter or a click", () => {
  it(
    "scenario: on the real dev.ts, a 1024x700 tab beside a 1440x900 tab folds tezgah's one layout to its own size; Tab onto a strip shows its ring and moves no desk focus, and Enter or a click opens it",
    { timeout: LIMIT },
    (context) =>
      suite(
        Effect.gen(function* () {
          const h = yield* home;
          const dev = yield* devServer(h);
          const b = yield* browser;
          const big = (yield* tab(yield* profile(b), dev.url)).page;
          yield* promised(() => big.setViewportSize({ width: 1440, height: 900 }));
          expect((yield* grant(h, yield* waiting(big))).ok, "the 1440x900 tab is granted").toBe(true);
          const small = (yield* tab(yield* profile(b), dev.url)).page;
          yield* promised(() => small.setViewportSize({ width: 1024, height: 700 }));
          expect((yield* grant(h, yield* waiting(small))).ok, "the 1024x700 tab is granted").toBe(true);
          const r = yield* reader(h, dev);
          const pid = yield* tezgahPid(r);
          let letters = 0;

          /** Waits until tab `on` draws tezgah's workspace folded at its own size, `shape` holds of the
           *  view, and tezgah's focus is `want` when it is given. */
          const at = (
            on: Page,
            want: string | null,
            shape: (view: View, d: FoldDrawn) => ReadonlyArray<string>,
            label: string,
          ) =>
            foldSettle(
              on,
              r,
              pid,
              (view, d) => [
                ...(want === null || focused(view).id === want ? [] : [`tezgah's focus is not yet ${want}`]),
                ...foldDifferences(view, d),
                ...shape(view, d),
              ],
              label,
            );

          /** Both tabs draw the view folded at their own sizes, with the focus `want`. */
          const both = (want: string | null, label: string) =>
            Effect.gen(function* () {
              const wide = yield* at(big, want, () => [], `${label}, in the 1440x900 tab`);
              const narrow = yield* at(small, want, () => [], `${label}, in the 1024x700 tab`);
              return { wide, narrow };
            });

          /** One letter to tezgah from the second client, then a wait until the view has `done`. */
          const letter = (m: object, done: (view: View) => boolean, label: string) =>
            Effect.gen(function* () {
              yield* tell(r, pid, { ...m, via: { _tag: "word" } }, `letter_tezgah_fold_${++letters}`);
              // The wait reads tezgah alone: the tab is checked where the law looks at it.
              return yield* foldSettle(big, r, pid, (view) => (done(view) ? [] : [`not yet ${label}`]), label);
            });

          const has = (view: View, id: string) => shown(view).some((t) => t.id === id);
          let minted = 7_000;

          /** Splits `from` by a letter; the new tile's id. */
          const split = (from: string, down: boolean) =>
            Effect.gen(function* () {
              const id = typeId("tile", ++minted);
              yield* letter(
                { type: "did", does: down ? "tezgah.split_down" : "tezgah.split_right", from, tile: id },
                (view) => has(view, id),
                `a split of ${from}`,
              );
              return id;
            });

          /** Closes `tile` by a letter. */
          const close = (tile: string) =>
            letter({ type: "did", does: "tezgah.close", from: tile }, (view) => !has(view, tile), `${tile} closed`);

          /** A click on tile `id`'s title bar in tab `on`, which focuses it (L30). */
          const clickTile = (on: Page, view: View, id: string) =>
            promised(() =>
              on
                .getByRole("region", { name: regionName(view.tiles.find((t) => t.id === id)!), exact: true })
                .locator("header")
                .first()
                .click(),
            );

          const named = (view: View, id: string) => view.tiles.find((t) => t.id === id)!;
          const stripped = (view: View, d: FoldDrawn) => (d.main === null ? [] : stripsHere(view, d.main));

          // One tile, as the window's own attach made it.
          const one = yield* at(
            big,
            null,
            (view) => (shown(view).length === 1 ? [] : ["not yet one tile"]),
            "one tile",
          );
          const t1 = focused(one.view).id;

          // The 2x2, by letters: t1 over a, a beside b, t1 beside c.
          const a = yield* split(t1, true);
          const bb = yield* split(a, false);
          const c = yield* split(t1, false);
          // The lower row becomes a 50, b 25, d 18.75, f 6.25: d from 1/8 and the 1/16 e left of it.
          const d = yield* split(bb, false);
          const e = yield* split(d, false);
          const f = yield* split(e, false);
          yield* close(e);
          const grid = yield* at(big, null, () => [], "the 2x2 with a narrow pair");
          expect(
            shown(grid.view).map((t) => t.id),
            "the layout is the 2x2 with d and f after b",
          ).toEqual([t1, c, a, bb, d, f]);

          // Focus on t1, by a click in the larger tab: d and f are no longer the focused tile.
          yield* clickTile(big, grid.view, t1);
          const folded = yield* both(t1, "t1 focused over the folded pair");
          const wideStrips = stripped(folded.wide.view, folded.wide.d).map((t) => t.id);
          const narrowStrips = stripped(folded.narrow.view, folded.narrow.d).map((t) => t.id);
          expect(wideStrips, "L33: at 1440x900 only f is under 220x120, so only f is a strip").toEqual([f]);
          expect(narrowStrips, "L33: at 1024x700 d and f are under 220x120, so both are strips").toEqual([d, f]);
          expect(
            folded.wide.d.regions.map((x) => x.name),
            "L33: the larger tab draws d open while the smaller folds it: the fold is each tab's own",
          ).toContain(regionName(named(folded.wide.view, d)));
          yield* shoot(big, "fold-grid", "grid-2x2");
          yield* shoot(small, "fold-grid", "small-1024x700");

          // L33: in the smaller tab, b focused by a click, then Tab out of b onto d's strip.
          yield* clickTile(small, folded.narrow.view, bb);
          const onB = yield* both(bb, "b focused by a click in the smaller tab");
          const dStrip = stripName(named(onB.narrow.view, d));
          let reached = false;

          for (let k = 0; k < TABS && !reached; k++) {
            yield* keys(small, "Tab");
            reached = (yield* focusRing(small)).name === dStrip;
          }

          expect(reached, `L33: Tab from b's title bar reaches ${dStrip}`).toBe(true);
          const ring = yield* focusRing(small);
          expect(ring.tag, "L33: the strip Tab reached is a real button").toBe("button");
          expect(ring.ring, "L33: the strip Tab reached shows its focus ring").toBe(true);
          yield* Effect.sleep(QUIET);
          const still = yield* both(bb, "L33: Tab onto a strip moves no desk focus");
          expect(
            stripped(still.narrow.view, still.narrow.d).map((t) => t.id),
            "L33: Tab onto d's strip leaves it a strip",
          ).toEqual([d, f]);
          expect((yield* focusRing(small)).name, "L33: DOM focus stays on the strip").toBe(dStrip);
          yield* shoot(small, "fold-strip-ring", "small-1024x700");

          // L33: Enter on the strip focuses d, so it opens, and DOM focus goes into it.
          yield* keys(small, "Enter");
          const opened = yield* both(d, "L33: Enter on d's strip focuses d");
          expect(
            opened.narrow.d.regions.map((x) => x.name),
            "L33: d is drawn open in the smaller tab",
          ).toContain(regionName(named(opened.narrow.view, d)));
          expect(
            stripped(opened.narrow.view, opened.narrow.d).map((t) => t.id),
            "L33: with d focused only f is a strip at 1024x700",
          ).toEqual([f]);
          yield* domSettles(
            small,
            (x) => x.region === regionName(named(opened.narrow.view, d)),
            "L33: DOM focus is in d once it opens",
          );
          yield* shoot(small, "fold-strip-opened", "small-1024x700");
          yield* shoot(big, "fold-strip-opened", "grid-2x2");

          // L33: a click on f's strip focuses f, so it opens; d, left, folds again where it does not fit.
          yield* promised(() =>
            small
              .getByRole("main")
              .first()
              .getByRole("button", { name: stripName(named(opened.narrow.view, f)), exact: true })
              .click(),
          );
          const clicked = yield* both(f, "L33: a click on f's strip focuses f");
          expect(
            stripped(clicked.narrow.view, clicked.narrow.d).map((t) => t.id),
            "L33: at 1024x700 d folds again once focus leaves it",
          ).toEqual([d]);
          expect(
            stripped(clicked.wide.view, clicked.wide.d).map((t) => t.id),
            "L33: at 1440x900 nothing folds with f focused",
          ).toEqual([]);
          yield* domSettles(
            small,
            (x) => x.region === regionName(named(clicked.narrow.view, f)),
            "L33: DOM focus is in f once it opens",
          );
          yield* shoot(small, "fold-strip-clicked", "small-1024x700");

          // Side by side with a strip: back to t1 alone, then t1 keeps 15/16 and j the last 1/16, by letters.
          for (const gone of [c, a, bb, d, f]) {
            yield* close(gone);
          }

          const g = yield* split(t1, false);
          const hh = yield* split(g, false);
          const i = yield* split(hh, false);
          const j = yield* split(i, false);

          for (const gone of [g, hh, i]) {
            yield* close(gone);
          }

          const side = yield* at(big, null, () => [], "t1 beside a narrow j");
          expect(
            shown(side.view).map((t) => t.id),
            "the layout is t1 beside j",
          ).toEqual([t1, j]);
          yield* clickTile(big, side.view, t1);
          const sided = yield* both(t1, "t1 focused beside j");
          expect(
            stripped(sided.narrow.view, sided.narrow.d).map((t) => t.id),
            "L33: j is a strip beside t1",
          ).toEqual([j]);
          yield* shoot(big, "fold-strip", "side-by-side");
          yield* shoot(small, "fold-strip-side-by-side", "small-1024x700");

          // Stacked with a strip: t1 keeps 15/16 of the height and n the last 1/16.
          const k = yield* split(t1, true);
          yield* close(j);
          const l = yield* split(k, true);
          const m = yield* split(l, true);
          const n = yield* split(m, true);

          for (const gone of [k, l, m]) {
            yield* close(gone);
          }

          const stack = yield* at(big, null, () => [], "t1 over a low n");
          expect(
            shown(stack.view).map((t) => t.id),
            "the layout is t1 over n",
          ).toEqual([t1, n]);
          yield* clickTile(big, stack.view, t1);
          const stacked = yield* both(t1, "t1 focused over n");
          expect(
            stripped(stacked.wide.view, stacked.wide.d).map((t) => t.id),
            "L33: n is a strip under t1",
          ).toEqual([n]);
          yield* shoot(big, "fold-strip", "stacked");
          yield* shoot(small, "fold-strip-stacked", "small-1024x700");
        }),
        context,
      ),
  );
});
