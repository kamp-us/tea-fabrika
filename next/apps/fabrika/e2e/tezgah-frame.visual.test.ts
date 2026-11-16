import { Effect } from "effect";
// Desk S2b, next/ (the desk program fabrika/tezgah, ticket named by its title): law L21 of the approved
// plan, and the slice's shots. Written before the tab draws tezgah's workspace and before it reads a
// key. Starts the real `dev.ts` in its own temp home on its own port and drives headless Chromium;
// every resource is acquired in one scope through `p14.test-support.ts`.
//
// What this law holds the tab to, from the plan (the build may add more):
// - The browser entry starts its window with the `tezgah: {workspace: 1}` option and the tezgah
//   commands' key table, and draws workspace 1 of the founder's tezgah: one `main`, one region per
//   open tile in reading order, named by `tileName` (`checklist, t1`), `aria-current` on the focused
//   tile alone, each tile where tezgah's percents put it.
// - `C-b %` and `C-b "` split the focused tile right and down; `C-b x` on a tile tezgah started asks
//   `close t<n>? (y/n)` in the status line, `n` keeps the tile and `y` closes it; a split that would
//   leave a tile under 220x120 is refused in the window, said in the polite region with the tile's
//   name, and tezgah's view does not change.
// - What the tab draws always comes from tezgah's view, read here from the real brain by a second,
//   granted client, never from a fixed tile list.
//
// The shots (plan, "Show it running"; AGENTS.md, "Shoot more than one layout") go to the folder
// `SHOTS` names, only when it is set, named `tezgah-<state>-<layout>.png`.
import { describe, expect, it } from "vitest";
import { browser, devServer, grant, home, profile, reader, suite, tab, waiting } from "./p14.test-support.ts";
import {
  differences,
  drawn,
  focused,
  foldDifferences,
  foldSettle,
  keys,
  settle,
  shoot,
  type Shot,
  tell,
  tezgahPid,
  tezgahView,
  shown,
  statusBar,
  typeId,
} from "./tezgah.test-support.ts";

/** The law's own limit in ms: a brain, a browser and about twenty waits of at most 30 s each. */
const LIMIT = 300_000;

/** How long the law waits to see that something did not happen, in ms: a split or close reaches
 *  tezgah and comes back in well under a second on the real `dev.ts`. */
const QUIET = 2_000;

const promised = <A>(f: () => Promise<A>) => Effect.promise(f);

describe("L21: the tab draws tezgah's workspace, and splits and closes by keys", () => {
  it(
    "scenario: on the real dev.ts, C-b % and C-b \" split, C-b x asks and y closes, a split with no room is refused, and every layout is tezgah's view",
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
          const ask = (n: number) => page.getByText(`close t${n}? (y/n)`, { exact: false });

          /** Waits until the tab draws tezgah's workspace and `shape` holds of it. */
          const drawnAs = (shape: (tiles: number, view: Parameters<typeof differences>[0]) => boolean, label: string) =>
            settle(
              page,
              r,
              pid,
              (view, d) => [...(shape(shown(view).length, view) ? [] : [`not yet ${label}`]), ...differences(view, d)],
              label,
            );

          /** The prefix line armed, read, shot, then disarmed by Escape with nothing sent. The bar is
           *  one line at every size (the tile guidelines; modes M3): arming it moves, resizes or folds
           *  no tile, the bar keeps its idle height and covers no tile, `prefix` at the left and
           *  `Esc cancel` at the right are drawn whole, the way out's right edge at the bar's right inner
           *  edge; the hints between them may run out. */
          const armedShot = (layout: Shot) =>
            Effect.gen(function* () {
              const before = yield* tezgahView(r, pid);
              const idle = yield* statusBar(page);
              yield* keys(page, "Control+b");

              for (let tries = 0; ; tries++) {
                const bar = yield* statusBar(page);

                if (bar.text.includes("Esc cancel") || tries >= 120) {
                  expect(bar.text, `the prefix line is up (${layout})`).toContain("Esc cancel");
                  expect(bar.tiles, `arming the prefix moves, resizes or folds no tile (${layout})`).toEqual(
                    idle.tiles,
                  );
                  expect(bar.height, `the armed bar keeps its idle height, one line (${layout})`).toBe(idle.height);
                  expect(bar.over, `the prefix line covers no tile (${layout})`).toEqual([]);
                  expect(bar.ends, `prefix and Esc cancel are drawn whole at the two ends (${layout})`).toEqual([
                    { text: "prefix", whole: true },
                    { text: "Esc cancel", whole: true },
                  ]);
                  // Modes M3: the way out is the line's right end, at the bar's right inner edge.
                  const right = bar.right!;
                  expect(
                    Math.abs(right.gap),
                    `Esc cancel's right edge is ${right.gap}px from the bar's right inner edge, within its ${right.padding}px padding (${layout})`,
                  ).toBeLessThanOrEqual(right.padding);
                  break;
                }

                yield* Effect.sleep("250 millis");
              }

              yield* shoot(page, "prefix-armed", layout);
              yield* keys(page, "Escape");
              yield* Effect.sleep(QUIET);
              expect(shown(yield* tezgahView(r, pid)), `L21: the prefix and Escape send nothing (${layout})`).toEqual(
                shown(before),
              );
            });

          /** C-b x on the focused tile asks; the ask is shot; n keeps the tile and sends nothing. */
          const askShot = (layout: Shot) =>
            Effect.gen(function* () {
              const before = yield* tezgahView(r, pid);
              const focus = focused(before);
              expect(focus.child, `the focused tile in ${layout} is one tezgah started`).toBe(true);
              yield* keys(page, "Control+b", "x");
              // format: the ask's words, the tile guidelines' `close t<n>? (y/n)`, as tmux asks.
              yield* promised(() => ask(focus.n).first().waitFor({ timeout: 30_000 }));
              yield* shoot(page, "close-ask", layout);
              yield* keys(page, "n");
              yield* promised(() => ask(focus.n).first().waitFor({ state: "detached", timeout: 30_000 }));
              yield* Effect.sleep(QUIET);
              const after = yield* tezgahView(r, pid);
              expect(shown(after), `L21: n after the ask keeps every tile (${layout})`).toEqual(shown(before));
              expect(
                differences(after, yield* drawn(page)),
                `L21: the tab still draws tezgah's view (${layout})`,
              ).toEqual([]);
            });

          // One tile: workspace 1 as the window's own attach made it, t1 showing the boot list's checklist.
          const one = yield* drawnAs((n) => n === 1, "one tile");
          const t1 = focused(one);
          yield* shoot(page, "one-tile", "one-tile");
          yield* armedShot("one-tile");

          // C-b %: t1 and a new tile side by side, focus on the new one.
          yield* keys(page, "Control+b", "%");

          const side = yield* drawnAs(
            (n, v) => n === 2 && typeof v.workspaces[0]!.layout !== "string" && v.workspaces[0]!.layout.dir === "row",
            "two side by side",
          );

          expect(focused(side).id, "L21: the split's new tile takes focus").not.toBe(t1.id);
          expect(shown(side)[0]!.id, "L21: the new tile goes after t1").toBe(t1.id);
          yield* shoot(page, "split-right", "side-by-side");
          yield* armedShot("side-by-side");
          yield* askShot("side-by-side");

          // C-b x, y: the new tile closes, and t1 is alone again.
          const t2 = focused(side);
          yield* keys(page, "Control+b", "x");
          yield* promised(() => ask(t2.n).first().waitFor({ timeout: 30_000 }));
          yield* keys(page, "y");
          const closed = yield* drawnAs((n) => n === 1, "t2 closed");
          expect(
            shown(closed).map((t) => t.id),
            "L21: y closes the asked tile",
          ).toEqual([t1.id]);

          // C-b ": t1 over a new tile.
          yield* keys(page, "Control+b", '"');
          yield* drawnAs(
            (n, v) =>
              n === 2 && typeof v.workspaces[0]!.layout !== "string" && v.workspaces[0]!.layout.dir === "column",
            "two stacked",
          );
          yield* shoot(page, "split-down", "stacked");
          yield* armedShot("stacked");
          yield* askShot("stacked");

          // C-b % on the lower tile, then t1 split by another client (focus moves by key come in the
          // next slice): a 2x2.
          yield* keys(page, "Control+b", "%");
          yield* drawnAs((n) => n === 3, "three tiles");
          yield* tell(
            r,
            pid,
            {
              type: "did",
              does: "tezgah.split_right",
              from: t1.id,
              tile: typeId("tile", 4_242),
              via: { _tag: "word" },
            },
            "letter_tezgah_frame_grid",
          );

          const grid = yield* drawnAs((n, v) => {
            const l = v.workspaces[0]!.layout;

            return (
              n === 4 &&
              typeof l !== "string" &&
              l.dir === "column" &&
              l.parts.every((p) => typeof p.inner !== "string" && p.inner.dir === "row" && p.inner.parts.length === 2)
            );
          }, "a 2x2");

          yield* shoot(page, "grid", "grid-2x2");
          yield* armedShot("grid-2x2");
          yield* askShot("grid-2x2");

          // The same 2x2 in a small window.
          yield* promised(() => page.setViewportSize({ width: 1024, height: 700 }));
          yield* drawnAs((n) => n === 4, "a 2x2 at 1024x700");
          yield* shoot(page, "grid", "small-1024x700");
          yield* armedShot("small-1024x700");
          yield* askShot("small-1024x700");

          // The narrowest window the desk draws, 420x700 as the fold law's band, folded: the prefix
          // line is still one line, folds nothing more, and keeps prefix and Esc cancel whole. Then
          // back to 1024x700 for the refused split.
          yield* promised(() => page.setViewportSize({ width: 420, height: 700 }));
          yield* foldSettle(page, r, pid, foldDifferences, "the 2x2 folded to a 420x700 window");
          yield* armedShot("narrow-420x700");
          yield* promised(() => page.setViewportSize({ width: 1024, height: 700 }));
          yield* drawnAs((n) => n === 4, "the 2x2 at 1024x700 again");

          // C-b % on a quarter still fits; once more would leave a tile under 220 wide, and is refused.
          const quarter = focused(grid);
          yield* keys(page, "Control+b", "%");
          const five = yield* drawnAs((n) => n === 5, "a quarter split right");
          const narrow = focused(five);
          expect(narrow.id, "L21: the quarter's new tile takes focus").not.toBe(quarter.id);
          const box = (yield* drawn(page)).regions.find((x) => x.name.endsWith(`, t${narrow.n}`))?.box;
          expect(box?.width ?? 0, "the narrow tile is too narrow to split again").toBeLessThan(2 * 220);
          yield* keys(page, "Control+b", "%");
          yield* Effect.sleep(QUIET);
          const refused = yield* tezgahView(r, pid);
          expect(shown(refused), "L21: a split with no room sends nothing").toEqual(shown(five));
          const said = yield* drawn(page);
          expect(said.polite, "L21: the refused split is said in the polite region, naming its tile").toContain(
            `t${narrow.n}`,
          );
          expect(differences(refused, said), "L21: the tab still draws tezgah's view").toEqual([]);
          yield* shoot(page, "refused-split", "small-1024x700");
        }),
        context,
      ),
  );
});

// Desk round R, next/: plan amendment 11, point 2, in the real tab. The boot starts only the founder's
// tezgah, and this app admits one person, the founder (`access/Access.ts`: a founded ledger has one
// `person`, and any other is `not_member`), so no second person can be granted here. The law makes
// the founder's tab meet the brain's own answer for a person with no tezgah: while `hide` is on, the
// tab's read of `processes/tezgah:<person>` is sent to the real brain as a read of a tezgah no one
// started, and the brain answers it as it answers any stream never written, with no entries.
// Everything else on the socket passes as it is. Then the socket drops, and the next dial reads the
// tab's own tezgah, which exists.
const NOBODY = `processes/tezgah:${typeId("person", 77).slice("person_".length)}`;

const TEZGAH_READ = /"stream":"processes\/tezgah:[^"]*"/;

describe("Desk R: a tab whose person has no tezgah says so, and follows tezgah once it exists", () => {
  it(
    "scenario: on the real dev.ts, a tab whose tezgah read finds no process says tezgah is not running in the status bar and the polite region, never Opening, and after a redial reads its tezgah again and draws its workspace",
    { timeout: LIMIT },
    (context) =>
      suite(
        Effect.gen(function* () {
          const h = yield* home;
          const dev = yield* devServer(h);
          const b = yield* browser;
          const profiled = yield* profile(b);

          const wire = {
            hide: true,
            /** Per socket, the tezgah streams the tab read on it, in order. */
            reads: [] as Array<Array<string>>,
            sockets: [] as Array<{ close: () => Promise<void> }>,
          };

          yield* promised(() =>
            profiled.routeWebSocket(/.*/, (ws) => {
              const server = ws.connectToServer();
              const read: Array<string> = [];
              wire.reads.push(read);
              wire.sockets.push({ close: () => ws.close({ code: 4000, reason: "the law drops the socket" }) });
              ws.onMessage((message) => {
                const found = typeof message === "string" ? TEZGAH_READ.exec(message) : null;

                if (typeof message !== "string" || found === null) {
                  server.send(message);

                  return;
                }

                read.push(found[0]);
                server.send(wire.hide ? message.replace(TEZGAH_READ, `"stream":"${NOBODY}"`) : message);
              });
            }),
          );
          const { page } = yield* tab(profiled, dev.url);
          yield* promised(() => page.setViewportSize({ width: 1440, height: 900 }));
          expect((yield* grant(h, yield* waiting(page))).ok, "the grant line as shown grants").toBe(true);
          const r = yield* reader(h, dev);
          const pid = yield* tezgahPid(r);
          const words = /tezgah is not running for you yet/i;

          /** What the page says now: its status bar (the line under the desk), its polite region, and
           *  whether it says Opening anywhere. */
          const says = Effect.gen(function* () {
            const status = yield* promised(() =>
              page.evaluate(() => document.querySelector(".statusbar")?.textContent ?? ""),
            );

            const opening = yield* promised(() => page.getByText("Opening", { exact: true }).count());

            return { status, polite: (yield* drawn(page)).polite, opening };
          });

          // No tezgah: the page says so, in both places, and never Opening.
          for (let tries = 0; ; tries++) {
            const now = yield* says;

            if ((words.test(now.status) && words.test(now.polite)) || tries >= 120) {
              const seen = `the page says ${JSON.stringify(now)}, the tab read ${JSON.stringify(wire.reads)}`;
              expect(now.status, `R2: the status bar says tezgah is not running for this person; ${seen}`).toMatch(
                words,
              );
              expect(now.polite, `R2: the polite region says it too; ${seen}`).toMatch(words);
              break;
            }

            yield* Effect.sleep("250 millis");
          }

          for (let k = 0; k < QUIET / 250; k++) {
            const now = yield* says;
            expect(now.opening, "R2: a tab with no tezgah never says Opening").toBe(0);
            expect(now.status, "R2: the status bar keeps saying tezgah is not running").toMatch(words);
            yield* Effect.sleep("250 millis");
          }

          yield* shoot(page, "no-tezgah", "one-tile");
          const before = wire.reads.filter((x) => x.length > 0).length;
          expect(before, "R2: the tab read its tezgah on its dial").toBeGreaterThan(0);

          // tezgah exists for this person now; the socket drops, and the next dial finds it.
          wire.hide = false;
          yield* promised(() => wire.sockets.at(-1)!.close());

          const one = yield* settle(
            page,
            r,
            pid,
            (view, d) => [...(shown(view).length === 1 ? [] : ["not yet one tile"]), ...differences(view, d)],
            "R2: after a redial, the tab follows its tezgah and draws workspace 1",
          );

          expect(shown(one), "R2: the tab draws tezgah's one tile").toHaveLength(1);
          expect((yield* says).status, "R2: once tezgah is there, the status bar no longer says it is not").not.toMatch(
            words,
          );
          const read = wire.reads.filter((x) => x.length > 0);
          expect(read.length, "R2: the redial read the tab's tezgah again, on a new socket").toBeGreaterThan(before);

          for (const streams of read) {
            expect(streams, "R2: each dial reads the tab's own processes/tezgah:<person> once").toHaveLength(1);
          }
        }),
        context,
      ),
  );
});
