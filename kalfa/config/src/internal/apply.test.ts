// Ticket 1845, kalfa/config (new work), slice 2: SN8 of the approved plan (.kalfa/quests/kalfa-config-nofiles-PLAN.md), for
// the restart rule both followers share (internal/apply.ts), which moves out of the file follower's `publish`. Written
// before the code.
//
// What the code does, as this law holds it to (the plan's "The rule both followers share"):
// - `updates(before, after)` gives, in `after`'s order, one `live` update with its value for each live setting whose value
//   differs, and one `restart` update (no value) for each restart setting whose value differs. `before` is found by name,
//   as an own key, never by place. The quiet window is a restart setting like any other.
// - `reported(started, after)` gives each setting's origin: a live setting's from `after`, a restart setting's from the
//   start.
import { expect, it } from "@effect/vitest";
import { runsFor } from "@kampus/vitest";
import { Effect, Option } from "effect";
import { Draw, makeGroup, named, number, Reach, readGroup } from "../SettingGroup.snapshot.test-support.ts";
import type { Origin } from "../Sources.ts";
import { Origin as OriginMaker } from "../Sources.ts";
import { reported, updates } from "./apply.ts";
import { frozen } from "./frozen.ts";
import type { Settled } from "./read.ts";

const check = { arbitrary: { runs: runsFor({ fast: 25, full: 100 }), size: 100 } };

type Class = "live" | "restart" | "order" | "copy" | "names" | "window" | "absent";

const CLASSES: ReadonlyArray<Class> = ["live", "restart", "order", "copy", "names", "window", "absent"];

/** What each setting of a case holds: a number, or a table for the setting that holds one. */
type Held = Readonly<Record<string, unknown>>;

const WINDOW = "config.watch.debounce";

// Plants: (v) zip `before` and `after` by place: a reordered `after` gives wrong updates, red; (w) compare with `===`:
// equal copies update, red; (y) find `before` by `before[name]` on a plain object: a name `before` lacks, as `constructor`,
// finds Object's own function and gives an update, red; (z) skip the settings the program did not declare: a window change logs nothing, red.
it.effect.prop(
  "SN8 the shared rule: `updates` gives one live update with its value for each live setting whose value differs and one restart update without a value for each restart setting whose value differs, in `after`'s order and found by name, and `reported` gives a live setting's origin from `after` and a restart setting's from the start",
  { draw: Draw },
  ({ draw }) =>
    Effect.sync(() => {
      const reach = new Reach<Class>(CLASSES);

      // Three settings and the window: a restart number named as an object's own function, a live table named with a
      // hyphen, and a live number.
      const group = makeGroup(draw.app, [
        { name: "constructor", kind: "number" },
        { name: "to-string", kind: "table", live: true },
        { name: named(draw.a), kind: "number", live: true },
      ]);

      const settings = readGroup(group).settings;

      const base: Held = {
        constructor: number(draw, 0),
        "to-string": { a: number(draw, 1) },
        [named(draw.a)]: number(draw, 2),
        [WINDOW]: "100 millis",
      };

      const lineFor = (n: number) => OriginMaker.cases.file.make({ file: `.${draw.app}/${draw.app}.toml`, line: n });

      const list = (held: Held, line: number): ReadonlyArray<Settled> =>
        settings.map((setting, i) => ({
          setting,
          value: held[setting.name],
          origin: setting.name === WINDOW ? OriginMaker.cases.default.make({}) : lineFor(line + i),
        }));

      /** A copy of every value that is equal and is another object: frozen apart. */
      const copied = (held: Held): Held =>
        Object.fromEntries(
          Object.entries(held).map(([name, value]) => [name, Option.getOrElse(frozen(value), () => value)]),
        );

      const before = list(base, 1);
      const started = new Map<string, Origin>(before.map(({ setting, origin }) => [setting.name, origin]));

      // Each case: what `after` holds, whether it is in the group's order, and the updates the model says.
      const cases: ReadonlyArray<{
        readonly id: Class;
        readonly after: Held;
        readonly reversed: boolean;
        /** A setting `before` does not hold at all: there is nothing for it to differ from, so it gives no update. */
        readonly without?: string;
        readonly want: ReadonlyArray<{ readonly name: string; readonly live: boolean }>;
      }> = [
        {
          id: "live",
          after: { ...base, [named(draw.a)]: number(draw, 2) + 1, "to-string": { a: number(draw, 1) + 1 } },
          reversed: false,
          want: [
            { name: "to-string", live: true },
            { name: named(draw.a), live: true },
          ],
        },
        {
          id: "restart",
          after: { ...base, constructor: number(draw, 0) + 1 },
          reversed: false,
          want: [{ name: "constructor", live: false }],
        },
        {
          id: "order",
          after: { ...base, constructor: number(draw, 0) + 1, [named(draw.a)]: number(draw, 2) + 1 },
          reversed: true,
          want: [
            { name: named(draw.a), live: true },
            { name: "constructor", live: false },
          ],
        },
        { id: "copy", after: copied(base), reversed: false, want: [] },
        {
          id: "names",
          after: { ...base, constructor: number(draw, 0) + 1, "to-string": { a: number(draw, 1) + 1 } },
          reversed: false,
          want: [
            { name: "constructor", live: false },
            { name: "to-string", live: true },
          ],
        },
        {
          id: "absent",
          after: { ...base, constructor: number(draw, 0) + 1, [named(draw.a)]: number(draw, 2) + 1 },
          reversed: false,
          without: "constructor",
          want: [{ name: named(draw.a), live: true }],
        },
        {
          id: "window",
          after: { ...base, [WINDOW]: "200 millis" },
          reversed: false,
          want: [{ name: WINDOW, live: false }],
        },
      ];

      for (const one of cases) {
        const listed = list(one.after, 10);
        const after = one.reversed ? [...listed].reverse() : listed;

        const got = updates(
          before.filter(({ setting }) => setting.name !== one.without),
          after,
        );

        // The model: after's own order, each setting whose value differs from the one with its name.
        const order = after.map(({ setting }) => setting.name);
        const wanted = order.flatMap((name) => one.want.filter((change) => change.name === name));

        expect(
          got.map((change) => ({ name: change.name, live: change._tag === "live" })),
          `${one.id}: the updates, in after's order`,
        ).toEqual(wanted);

        for (const change of got) {
          if (change._tag === "live") {
            expect(change.value, `${one.id}: a live update holds the value after`).toEqual(one.after[change.name]);
          } else {
            // A restart update has no value: a running process cannot set a restart value from it.
            expect(Object.keys(change).sort(), `${one.id}: a restart update holds a name and nothing else`).toEqual([
              "_tag",
              "name",
            ]);
          }
        }

        // The origins a running process reports: a live setting's from `after`, a restart setting's from the start.
        const origins = reported(started, after);

        expect(Object.keys(origins).sort(), `${one.id}: one origin for each setting`).toEqual(order.toSorted());

        for (const { setting, origin } of after) {
          expect(origins[setting.name], `${one.id}: ${setting.name}'s origin`).toEqual(
            setting.live ? origin : started.get(setting.name),
          );
        }

        reach.mark(one.id);
      }

      reach.done();
    }),
  check,
);
