import { Effect } from "effect";
// Desk S3, next/ (the desk program fabrika/tezgah, ticket named by its title): laws L28 and L30 of the
// approved plan, and the slice's shots. Written before a tab moves focus. Starts the real `dev.ts` in
// its own temp home on its own port and drives headless Chromium; every resource is acquired in one
// scope through `p14.test-support.ts`.
//
// What these laws hold the tab to, from the plan (the build may add more):
// - `C-b o`, `C-b ;`, `C-b h j k l` and the arrows after the prefix move desk focus in the tab that
//   pressed them, and tezgah confirms: the tab's `aria-current` and tezgah's view agree once it
//   answers, and a second tab on the same workspace follows (0277: focus is mirrored). F6 is not
//   shipped to a browser on Linux (S2b's backend rule), so it is walked in the library's laws only.
// - DOM focus follows desk focus: after a move, DOM focus is inside the focused tile's region.
//   Desk focus follows DOM focus: a click on a tile, or Tab into it, focuses it (0503's lesson).
// - L28: a tile keeps its cursor (0165). The checklist marks each row with `data-cursor="item:<name>"`;
//   a move that leaves a tile sends the key of the element that had DOM focus, tezgah's view keeps it
//   on that tile, and a return to the tile puts DOM focus back on that row. When the row is gone, or
//   the tile was never focused, DOM focus lands at the top of the tile: on no row, or on its first.
//
// The shots (plan, "Show it running"; AGENTS.md, "Shoot more than one layout") go to the folder
// `SHOTS` names, only when it is set, named `tezgah-focus-<state>-<layout>.png`.
import { describe, expect, it } from "vitest";
import { browser, devServer, grant, home, profile, reader, suite, tab, tile, waiting } from "./p14.test-support.ts";
import type { drawn } from "./tezgah.test-support.ts";
import {
  differences,
  domSettles,
  focused,
  keys,
  processId,
  regionName,
  settle,
  shoot,
  type Shot,
  shown,
  tell,
  tezgahPid,
  tezgahView,
} from "./tezgah.test-support.ts";

/** The law's own limit in ms: a brain, two tabs and about forty waits of at most 30 s each. */
const LIMIT = 420_000;
/** How long the law waits to see that something did not happen, in ms: a move reaches tezgah and
 *  comes back in well under a second on the real `dev.ts`. */
const QUIET = 2_000;

const promised = <A>(f: () => Promise<A>) => Effect.promise(f);

type View = Parameters<typeof differences>[0];
type Page = Parameters<typeof drawn>[0];

describe("L28, L30: moving between tiles in the tab, on the real brain", () => {
  it(
    "scenario: on the real dev.ts, focus keys, clicks and Tab move focus, tezgah confirms, a second tab follows, and a return to a tile lands on its cursor",
    { timeout: LIMIT },
    (context) =>
      suite(
        Effect.gen(function* () {
          const h = yield* home;
          const dev = yield* devServer(h);
          const b = yield* browser;
          const { page } = yield* tab(yield* profile(b), dev.url);
          yield* promised(() => page.setViewportSize({ width: 1440, height: 900 }));
          expect((yield* grant(h, yield* waiting(page))).ok, "the grant line as shown grants").toBe(true);
          const r = yield* reader(h, dev);
          const pid = yield* tezgahPid(r);

          /** Waits until tab `on` draws tezgah's workspace, `shape` holds of it, and its focus is `want`. */
          const at = (on: Page, want: string | null, shape: (tiles: number, view: View) => boolean, label: string) =>
            settle(
              on,
              r,
              pid,
              (view, d) => [
                ...(shape(shown(view).length, view) ? [] : [`not yet ${label}`]),
                ...(want === null || focused(view).id === want ? [] : [`tezgah's focus is not yet ${want}`]),
                ...differences(view, d),
              ],
              label,
            );

          /** DOM focus is inside the region of tile `id` of `view`. */
          const domIn = (on: Page, view: View, id: string, label: string) => {
            const t = view.tiles.find((x) => x.id === id)!;
            return domSettles(on, (f) => f.region === regionName(t), `L30: DOM follows desk focus to ${label}`);
          };

          /** A focus key in tab `on` that moves to `to`: tezgah confirms, the tab draws it, DOM follows. */
          const move = (on: Page, pressed: ReadonlyArray<string>, to: string, label: string) =>
            Effect.gen(function* () {
              yield* keys(on, ...pressed);
              const view = yield* at(on, to, () => true, `${pressed.join(" ")} ${label}`);
              yield* domIn(on, view, to, `${pressed.join(" ")} ${label}`);
              return view;
            });

          /** Visits each tile of workspace 1 by `C-b o`, in reading order, shooting each at `layout`. */
          const tour = (on: Page, layout: Shot, state = "t") =>
            Effect.gen(function* () {
              const view = yield* tezgahView(r, pid);
              const tiles = shown(view);
              const start = tiles.findIndex((t) => t.id === focused(view).id);

              for (let k = 1; k <= tiles.length; k++) {
                const next = tiles[(start + k) % tiles.length]!;

                if (tiles.length > 1) {
                  yield* move(on, ["Control+b", "o"], next.id, `to t${next.n} in reading order`);
                }

                yield* shoot(on, `focus-${state}${next.n}`, layout);
              }
            });

          // One tile: workspace 1 as the window's own attach made it. Two rows go on its checklist.
          const one = yield* at(page, null, (n) => n === 1, "one tile");
          const t1 = focused(one);
          const list = tile(page, regionName(t1));
          yield* list.live;

          for (const item of ["milk", "eggs"]) {
            yield* promised(() => list.field.fill(item));
            yield* promised(() => list.field.press("Enter"));
          }

          yield* promised(() => list.box("eggs").waitFor({ timeout: 30_000 }));
          yield* shoot(page, `focus-t${t1.n}`, "one-tile");

          // Side by side: C-b % focuses the new tile, at its top (never focused); C-b h and C-b l move.
          yield* keys(page, "Control+b", "%");
          const side = yield* at(page, null, (n) => n === 2, "two side by side");
          const t2 = focused(side);
          expect(t2.id, "C-b % focuses the new tile").not.toBe(t1.id);
          const fresh = yield* domIn(page, side, t2.id, "the new tile");
          expect(
            fresh.cursor === null || fresh.cursor === fresh.first,
            "L28: a tile never focused lands at its top",
          ).toBe(true);
          yield* shoot(page, `focus-t${t2.n}`, "side-by-side");
          yield* move(page, ["Control+b", "h"], t1.id, "left to t1");
          yield* shoot(page, `focus-t${t1.n}`, "side-by-side");
          yield* move(page, ["Control+b", "ArrowRight"], t2.id, "right to t2");
          yield* move(page, ["Control+b", ";"], t1.id, "back to the last tile, t1");
          yield* move(page, ["Control+b", ";"], t2.id, "back to the last tile, t2");

          // Stacked: t2 closes (C-b x, y), then C-b " under t1; C-b k and C-b j move.
          yield* keys(page, "Control+b", "x");
          yield* promised(() => page.getByText(`close t${t2.n}? (y/n)`).first().waitFor({ timeout: 30_000 }));
          yield* keys(page, "y");
          yield* at(page, t1.id, (n) => n === 1, "t2 closed");
          yield* keys(page, "Control+b", '"');
          const stacked = yield* at(page, null, (n) => n === 2, "two stacked");
          const t3 = focused(stacked);
          yield* shoot(page, `focus-t${t3.n}`, "stacked");
          yield* move(page, ["Control+b", "k"], t1.id, "up to t1");
          yield* shoot(page, `focus-t${t1.n}`, "stacked");
          yield* move(page, ["Control+b", "ArrowDown"], t3.id, "down to the lower tile");
          yield* move(page, ["Control+b", "ArrowUp"], t1.id, "up to t1 by the arrow");

          // The 2x2: C-b % beside t1, C-b j down to the lower tile, C-b % beside it.
          yield* keys(page, "Control+b", "%");
          const three = yield* at(page, null, (n) => n === 3, "three tiles");
          const t4 = focused(three);
          yield* move(page, ["Control+b", "j"], t3.id, "down from t4 to the lower tile");
          yield* keys(page, "Control+b", "%");
          const grid = yield* at(
            page,
            null,
            (n, v) => {
              const l = v.workspaces[0]!.layout;
              return (
                n === 4 &&
                typeof l !== "string" &&
                l.dir === "column" &&
                l.parts.every((p) => typeof p.inner !== "string" && p.inner.dir === "row" && p.inner.parts.length === 2)
              );
            },
            "a 2x2",
          );
          const t5 = focused(grid);
          // A key that finds no tile on its side moves nothing (the window's lean, L26's window half).
          yield* keys(page, "Control+b", "l");
          yield* Effect.sleep(QUIET);
          yield* at(page, t5.id, () => true, "C-b l on the right edge moves nothing");
          yield* move(page, ["Control+b", "k"], t4.id, "up from t5 to t4");
          yield* move(page, ["Control+b", "ArrowLeft"], t1.id, "left from t4 to t1");
          yield* tour(page, "grid-2x2");

          // L28: on t1, DOM focus on the milk row; C-b o leaves it, and tezgah keeps the cursor on t1.
          yield* at(page, t1.id, () => true, "the tour ends back on t1");
          const milk = page.getByRole("region", { name: regionName(t1), exact: true }).getByRole("checkbox", {
            name: "milk",
            exact: true,
          });
          yield* promised(() => milk.focus());
          yield* domSettles(page, (f) => f.region === regionName(t1) && f.cursor === "item:milk", "on the milk row");
          yield* move(page, ["Control+b", "o"], t4.id, "away from t1");
          const kept = yield* settle(
            page,
            r,
            pid,
            (view) =>
              view.tiles.find((t) => t.id === t1.id)?.cursor === "item:milk" ? [] : ["t1 keeps no cursor yet"],
            "L28: tezgah keeps the cursor t1 was left on",
          );
          expect(kept.tiles.find((t) => t.id === t1.id)?.cursor, "L28: t1's cursor in tezgah's view").toBe("item:milk");
          yield* keys(page, "Control+b", ";");
          yield* at(page, t1.id, () => true, "C-b ; back to t1");
          yield* domSettles(
            page,
            (f) => f.region === regionName(t1) && f.cursor === "item:milk",
            "L28: back on t1, DOM focus is on the row it was left on",
          );
          yield* shoot(page, "focus-cursor", "grid-2x2");

          // L28: the row is gone while t1 is left; the return lands at the top of t1.
          yield* move(page, ["Control+b", "o"], t4.id, "away from t1 again");
          yield* tell(r, yield* processId(r, t1.shows), { type: "remove", name: "milk" }, "letter_tezgah_focus_remove");
          yield* promised(() => list.box("milk").waitFor({ state: "detached", timeout: 30_000 }));
          yield* keys(page, "Control+b", ";");
          yield* at(page, t1.id, () => true, "C-b ; back to t1 without its row");
          const top = yield* domSettles(page, (f) => f.region === regionName(t1), "L28: back on t1 with its row gone");
          expect(
            top.cursor === null || top.cursor === top.first,
            `L28: with its row gone, the return lands at t1's top, not ${top.cursor}`,
          ).toBe(true);

          // L30: a click on a tile focuses it, and tezgah agrees.
          yield* promised(() =>
            page
              .getByRole("region", { name: regionName(t5), exact: true })
              .locator("header")
              .first()
              .click(),
          );
          yield* at(page, t5.id, () => true, "L30: a click on t5 focuses it");

          // L30: Tab out of t1's last field moves desk focus to the tile DOM focus enters.
          yield* promised(() => list.field.focus());
          yield* at(page, t1.id, () => true, "L30: DOM focus into t1 focuses it");
          yield* keys(page, "Tab");
          const entered = yield* domSettles(
            page,
            (f) => f.region !== null && f.region !== regionName(t1),
            "Tab leaves t1 for the next tile",
          );
          const into = grid.tiles.find((t) => regionName(t) === entered.region)!;
          yield* at(page, into.id, () => true, `L30: Tab into ${entered.region} focuses it`);

          // A second tab on workspace 1 follows the first, and the first follows the second.
          const second = (yield* tab(yield* profile(b), dev.url)).page;
          yield* promised(() => second.setViewportSize({ width: 1440, height: 900 }));
          expect((yield* grant(h, yield* waiting(second))).ok, "the second tab is granted").toBe(true);
          yield* at(second, null, (n) => n === 4, "the second tab draws the 2x2");
          const order = shown(grid);
          const after = order[(order.findIndex((t) => t.id === into.id) + 1) % order.length]!;
          yield* keys(page, "Control+b", "o");
          yield* at(second, after.id, () => true, "L30: the second tab mirrors a key move in the first");
          yield* at(page, after.id, () => true, "the first tab agrees");
          yield* shoot(second, "focus-mirror", "grid-2x2");
          yield* promised(() =>
            second
              .getByRole("region", { name: regionName(t3), exact: true })
              .locator("header")
              .first()
              .click(),
          );
          yield* at(page, t3.id, () => true, "L30: the first tab mirrors a click in the second");
          yield* at(second, t3.id, () => true, "the second tab agrees");

          // The same 2x2 in a small window.
          yield* promised(() => page.setViewportSize({ width: 1024, height: 700 }));
          yield* at(page, null, (n) => n === 4, "a 2x2 at 1024x700");
          yield* tour(page, "small-1024x700");
        }),
        context,
      ),
  );
});
