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
import {
  differences,
  domSettles,
  drawn,
  focused,
  keys,
  processId,
  regionName,
  settle,
  shoot,
  type Shot,
  shown,
  statusBar,
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

/** A checklist row whose name is the field's longest, 80 characters, so its cursor key `item:<name>`
 *  is 85: past the 80 a cursor key once held (plan amendment 10: up to 256). */
const LONG = "a row whose name is as long as the checklist field takes, eighty characters in all".slice(0, 80);

/** Runs inside Chromium before the page script: every socket the page opens is kept, so the law
 *  can lose the link as a network drop would, with the page's own redial bringing it back. */
const keepSockets = () => {
  const NativeSocket = WebSocket;
  const opened: Array<WebSocket> = [];
  Reflect.set(globalThis, "__deskSockets", opened);
  globalThis.WebSocket = class extends NativeSocket {
    constructor(url: string | URL, protocols?: string | Array<string>) {
      super(url, protocols);
      opened.push(this);
    }
  };
};

/** Closes every socket the page opened, in the page: the link is lost until the page dials again. */
const loseLink = () => {
  // SAFETY: keepSockets set `__deskSockets` to its own Array<WebSocket> before the page script ran.
  for (const socket of Reflect.get(globalThis, "__deskSockets") as Array<WebSocket>) {
    socket.close(4000, "the law loses the link");
  }
};

type View = Parameters<typeof differences>[0];
type Page = Parameters<typeof drawn>[0];

/** Whether tile `under` sits right below tile `above` in workspace 1 of `view`, the two alone in one
 *  column: `above` split down. */
const splitBelow = (view: View, above: string, under: string): boolean => {
  const holds = (node: View["workspaces"][number]["layout"]): boolean =>
    typeof node !== "string" &&
    ((node.dir === "column" &&
      node.parts.length === 2 &&
      node.parts[0]!.inner === above &&
      node.parts[1]!.inner === under) ||
      node.parts.some((p) => holds(p.inner)));
  return holds(view.workspaces[0]!.layout);
};

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
          const own = yield* profile(b);
          yield* promised(() => own.addInitScript(keepSockets));
          const { page } = yield* tab(own, dev.url);
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

          for (const item of ["milk", "eggs", LONG]) {
            yield* promised(() => list.field.fill(item));
            yield* promised(() => list.field.press("Enter"));
          }

          yield* promised(() => list.box("eggs").waitFor({ timeout: 30_000 }));
          yield* shoot(page, `focus-t${t1.n}`, "one-tile");

          // Plan amendment 9, point 3: a split leaves t1 too, so it carries t1's cursor. DOM focus
          // goes to the eggs row first; the split's letter carries `item:eggs`, and tezgah keeps it.
          yield* promised(() =>
            page
              .getByRole("region", { name: regionName(t1), exact: true })
              .getByRole("checkbox", { name: "eggs", exact: true })
              .focus(),
          );
          yield* domSettles(page, (f) => f.region === regionName(t1) && f.cursor === "item:eggs", "on the eggs row");

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
          // Desk round R (finding desk-dom-focus-not-following): after C-b %, keyboard focus is in the
          // new tile, so what a person types lands in the new tile's field, never t1's, and C-b x
          // closes the new tile: its ask names it.
          const typed = tile(page, regionName(t2));
          yield* promised(() => page.keyboard.type("q"));
          yield* promised(() => typed.field.waitFor({ timeout: 30_000 }));
          expect(yield* promised(() => typed.field.inputValue()), "R4: typing after C-b % lands in the new tile").toBe(
            "q",
          );
          expect(yield* promised(() => list.field.inputValue()), "R4: typing after C-b % never lands in t1").toBe("");
          yield* promised(() => page.keyboard.press("Backspace"));
          expect(yield* promised(() => typed.field.inputValue()), "R4: the new tile's field takes the Backspace").toBe(
            "",
          );
          yield* keys(page, "Control+b", "x");
          yield* promised(() => page.getByText(`close t${t2.n}? (y/n)`).first().waitFor({ timeout: 30_000 }));
          yield* keys(page, "n");
          yield* promised(() =>
            page.getByText(`close t${t2.n}? (y/n)`).first().waitFor({ state: "detached", timeout: 30_000 }),
          );
          yield* domIn(page, side, t2.id, "the new tile, after the close ask is answered n");
          yield* shoot(page, `focus-t${t2.n}`, "side-by-side");
          expect(
            side.tiles.find((t) => t.id === t1.id)?.cursor,
            "L28: tezgah keeps the cursor the split left t1 on",
          ).toBe("item:eggs");
          yield* move(page, ["Control+b", "h"], t1.id, "left to t1");
          yield* domSettles(
            page,
            (f) => f.region === regionName(t1) && f.cursor === "item:eggs",
            "L28: back on t1 after C-b %, DOM focus is on the row the split left it on",
          );
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

          // L28: a row of 80 characters, whose key is 85, is a cursor too: away and back lands on it.
          yield* promised(() =>
            page
              .getByRole("region", { name: regionName(t1), exact: true })
              .getByRole("checkbox", { name: LONG, exact: true })
              .focus(),
          );
          yield* domSettles(page, (f) => f.region === regionName(t1) && f.cursor === `item:${LONG}`, "on the long row");
          yield* move(page, ["Control+b", "o"], t4.id, "away from t1 on its long row");
          yield* keys(page, "Control+b", ";");
          yield* at(page, t1.id, () => true, "C-b ; back to t1 on its long row");
          yield* domSettles(
            page,
            (f) => f.region === regionName(t1) && f.cursor === `item:${LONG}`,
            "L28: back on t1, DOM focus is on the 80-character row it was left on",
          );

          // L28, 0165: the cursor is where focus last sat in the tile, so a click on the focused tile's
          // own title bar lands on the row focus is on now, the eggs row, never on the long row tezgah's
          // view still keeps from when focus last left t1.
          yield* promised(() =>
            page
              .getByRole("region", { name: regionName(t1), exact: true })
              .getByRole("checkbox", { name: "eggs", exact: true })
              .focus(),
          );
          yield* domSettles(page, (f) => f.region === regionName(t1) && f.cursor === "item:eggs", "on the eggs row");
          yield* promised(() =>
            page
              .getByRole("region", { name: regionName(t1), exact: true })
              .locator("header")
              .first()
              .click(),
          );
          yield* domSettles(
            page,
            (f) => f.region === regionName(t1) && f.cursor === "item:eggs",
            "L28: a click on t1's own title bar lands on the eggs row, where focus last sat",
          );

          // L28, 0165: a lost link and back lands on the row focus last sat on, the eggs row, never
          // the long row tezgah's view keeps. The lost link makes every tile inert, so DOM focus
          // leaves t1, and the return lands it where the window's own note says. Fix round 4, from
          // the recheck: the return read the view's cursor, which learns a row only when focus
          // leaves the tile.
          yield* promised(() => page.evaluate(loseLink));
          yield* promised(() => list.region.and(page.locator("[inert]")).waitFor({ timeout: 30_000 }));
          yield* list.live;
          yield* domSettles(
            page,
            (f) => f.region === regionName(t1) && f.cursor === "item:eggs",
            "L28: after a lost link and back, DOM focus is on the eggs row, where it last sat in t1",
          );

          // L28, 0165: focus on t1's add box sits on no row, and that is a note too: a click on t1's
          // own title bar lands at its top, never on the long row tezgah's view keeps. Fix round 4,
          // from the recheck: a note of no row fell back to the view's cursor.
          yield* promised(() => list.field.focus());
          yield* domSettles(page, (f) => f.region === regionName(t1) && f.cursor === null, "on t1's add box");
          yield* promised(() =>
            page
              .getByRole("region", { name: regionName(t1), exact: true })
              .locator("header")
              .first()
              .click(),
          );
          const onTop = yield* domSettles(
            page,
            (f) => f.region === regionName(t1),
            "L28: a click on t1's title bar from its add box stays in t1",
          );
          expect(
            onTop.cursor === null || onTop.cursor === onTop.first,
            `L28: a click on t1's title bar from its add box lands at t1's top, not ${onTop.cursor}`,
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
          // L28, L30: the click on t5's title bar lands DOM focus at t5's top, its field, never on the
          // region itself: what a person types next goes into t5. Desk round R2, from the shots: a
          // click on a title bar left DOM focus on the region, so the field had no ring and typing
          // went nowhere.
          const clicked = tile(page, regionName(t5));
          yield* domSettles(page, (f) => f.region === regionName(t5), "L30: DOM focus follows the click into t5");
          yield* promised(() => page.keyboard.type("z"));
          expect(
            yield* promised(() => clicked.field.inputValue()),
            "L28: typing after a click on t5's title bar lands in t5's field",
          ).toBe("z");
          yield* promised(() => clicked.field.fill(""));

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

          // Ticket 1043: prefix keys as fast as a person types them. C-b h and at once C-b " (no wait
          // between them) move to the tile on the left and split it down, as with a pause between
          // them: the split's new tile sits under the tile the move landed on, no tile's field takes
          // the quote, and the prefix is disarmed after. Then the same with C-b l.
          yield* promised(() => page.setViewportSize({ width: 1440, height: 900 }));
          yield* at(page, t3.id, (n) => n === 4, "the 2x2 at 1440x900, the tour back on the lower tile");
          yield* move(page, ["Control+b", "l"], t5.id, "right from the lower tile to t5");

          /** Burst `pressed` then wait until tezgah's workspace has one more tile, under `above`, the
           *  two alone in one column, focus on the new tile. */
          const fastSplit = (pressed: ReadonlyArray<string>, above: string, count: number) =>
            Effect.gen(function* () {
              const before = yield* tezgahView(r, pid);
              yield* keys(page, ...pressed);
              const under = (view: View) => shown(view).find((t) => !shown(before).some((b) => b.id === t.id));
              const view = yield* at(
                page,
                null,
                (n, v) =>
                  n === count &&
                  under(v) !== undefined &&
                  focused(v).id === under(v)!.id &&
                  splitBelow(v, above, under(v)!.id),
                `${pressed.join(" ")} with no pause splits the tile the move landed on`,
              );
              const bar = yield* statusBar(page);
              expect(bar.text, `1043: the prefix is disarmed after ${pressed.join(" ")}`).not.toContain("Esc cancel");
              expect((yield* drawn(page)).polite, `1043: the polite region no longer says prefix`).not.toMatch(
                /\bprefix\b/,
              );

              for (const t of shown(view)) {
                expect(
                  yield* promised(() => tile(page, regionName(t)).field.inputValue()),
                  `1043: ${regionName(t)}'s field takes no key of ${pressed.join(" ")}`,
                ).toBe("");
              }

              return under(view)!;
            });
          yield* fastSplit(["Control+b", "h", "Control+b", '"'], t3.id, 5);
          yield* fastSplit(["Control+b", "l", "Control+b", '"'], t5.id, 6);
        }),
        context,
      ),
  );
});
