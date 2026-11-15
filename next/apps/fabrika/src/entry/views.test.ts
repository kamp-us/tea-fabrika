// Ticket 1042, next/ (a new tile opens the shell, through the setting `tezgah.new`): law N8 of the
// approved plan, the fast half of L17's browser half: the app registers a window for every program a
// tile may show, by program. Written before `views.ts` registers the shell and the counter. The shape
// it holds `views.ts` to, from the plan: `windowFor(program)` answers the window that program's own
// package exports, for every program of the app's table but `fabrika/tezgah`, the frame itself; the
// tab decodes a tile's view with that window's `data`, so one program's decoder takes any view of
// its own window and refuses the other windows' views; a name no tile may show has no window.
import { describe, expect, it } from "@effect/vitest";
import { checklist } from "@kampus/checklist";
import { checklistWindow } from "@kampus/checklist/window";
import { counter } from "@kampus/counter";
import { counterWindow } from "@kampus/counter/window";
import { fabsh } from "@kampus/fabsh";
import { fabshWindow } from "@kampus/fabsh/window";
import { ProgramName } from "@kampus/libfabrika/packs/ProgramName";
import { Arbitrary, Result, Schema } from "effect";
import { programs } from "../table.ts";
import { windowFor } from "./views.ts";

/** Each program's own window, as its package exports it: what the tab must find for that program. */
const OWN: Readonly<Record<string, { readonly data: Schema.Top }>> = {
  [checklist.name]: checklistWindow,
  [counter.name]: counterWindow,
  [fabsh.name]: fabshWindow,
};

/** The programs a tile may show: the app's table but tezgah. */
const SHOWN = programs.map((p) => p.name).filter((name) => name !== "fabrika/tezgah");

/** One view of each package's window, drawn by Effect's Arbitrary from that window's own `data`. */
const Views = Arbitrary.all({
  [checklist.name]: Arbitrary.schema(Schema.toType(checklistWindow.data)),
  [counter.name]: Arbitrary.schema(Schema.toType(counterWindow.data)),
  [fabsh.name]: Arbitrary.schema(Schema.toType(fabshWindow.data)),
});

/** Program names no tile may show, drawn each run: the frame `fabrika/tezgah`, any program name,
 *  and names that sit next to a table name (one with more after it, one in other case), each kept
 *  only when it is a program name outside the tiles' programs. */
const Outside = Arbitrary.map(
  Arbitrary.all({
    any: Arbitrary.schema(ProgramName),
    near: Arbitrary.schema(Schema.Literals(SHOWN)),
    more: Arbitrary.schema(ProgramName),
  }),
  ({ any, near, more }) =>
    ["fabrika/tezgah", any, `${near}${more.slice(more.indexOf("/") + 1)}`, near.toUpperCase(), near.toLowerCase()]
      .filter(Schema.is(ProgramName))
      .filter((name) => !SHOWN.includes(name)),
);

const decodes = (schema: Schema.Top, view: unknown) =>
  Result.isSuccess(Schema.decodeUnknownResult(Schema.toCodecJson(schema as Schema.Codec<unknown, unknown>))(view));

describe("Ticket 1042 N8: the tab registers a window for every program a tile may show", () => {
  it.prop(
    "N8: every program in the app's table but fabrika/tezgah has its own window registered by program, and the tab's decoder for it takes any view of that window and refuses the other windows' views",
    { views: Views },
    ({ views }) => {
      // Every program a tile may show, each draw: the table is the source, and a program this law does
      // not know fails here rather than going unchecked.
      expect(
        SHOWN.filter((name) => OWN[name] === undefined),
        "N8: every program a tile may show has its package's window known to this law",
      ).toEqual([]);

      for (const program of SHOWN) {
        const own = OWN[program]!;
        const found = windowFor(program);
        expect(found, `N8: the tab registers ${program}'s own window for ${program}`).toBe(own);
        const shown = Schema.encodeUnknownSync(Schema.toCodecJson(own.data as Schema.Codec<unknown, unknown>))(
          views[program],
        );
        expect(decodes(found!.data, shown), `N8: ${program}'s decoder takes a view of its own window`).toBe(true);

        for (const other of SHOWN.filter((name) => name !== program)) {
          const theirs = Schema.encodeUnknownSync(
            Schema.toCodecJson(OWN[other]!.data as Schema.Codec<unknown, unknown>),
          )(views[other]);
          expect(decodes(found!.data, theirs), `N8: ${program}'s decoder refuses a view of ${other}'s window`).toBe(
            false,
          );
        }
      }
    },
  );

  it.prop(
    "N8: a program name no tile may show, fabrika/tezgah or any name outside the app's table, has no window registered",
    { names: Outside },
    ({ names }) => {
      // The plan's start check refuses each of these as a value of tezgah.new; the registry must
      // never answer for one either, however close it sits to a name the table has.
      for (const name of names) {
        expect(windowFor(name), `N8: ${name} is no tile's program, so it has no window`).toBeNull();
      }
    },
  );
});
