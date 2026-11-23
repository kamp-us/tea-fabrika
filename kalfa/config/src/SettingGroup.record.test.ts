// Ticket 1844, kalfa/config (new work): RC1 to RC8 of the approved plan (.kalfa/quests/kalfa-config-record-PLAN.md), for
// the whole-record edit of `SettingGroup.edit(group, text, file).set(setting, value)` and `.remove(setting)`
// (SettingGroup.ts), read through the package's root entry (index.ts). Written before the code. The guard half of RC8
// is in internal/change.test.ts; E1 to E11 and S1 stay in SettingGroup.edit.test.ts and internal/change.test.ts.
//
// What the edit does with a record, as these laws hold it to (the plan, with the lead's calls at signing):
// - A record setting written over several lines (under its own header, under headers of its items, by dotted keys, or
//   mixed) is compared key by key: an equal key keeps its lines byte for byte, a changed key has only its value
//   replaced, a new item is written beside its siblings (its own header after the last block when the items sit under
//   headers, else one inline line at the end of the record's section), and an item that leaves takes its lines.
// - A table that leaves takes the comment lines right above its header (no blank line between), the comments inside it,
//   and the blank lines up to the next header's own comments; a comment with a blank line between it and the header
//   stays. A block that ends the file takes the blank lines above it. A dotted-key table that leaves takes its whole
//   lines; an own-line comment between its dotted lines stays. One key written as one assignment keeps a comment found
//   inside its value, on a line of its own.
// - An array is replaced whole, in its own form: an inline one stays inline, an array of tables comes back as `[[name]]`
//   blocks where its first block started.
//
// Every law is a property over generated typed files (SettingGroup.record.test-support.ts): each class (a) to (z) of the
// plan's "Generators" is built from the drawn seeds in every run, a law keeps the ids it reached, and it fails when one
// is missing. RC1 is the one scenario. Each law names its plants: break one thing in the code, run the law, see it red,
// undo it.
import { expect, it } from "@effect/vitest";
import { runsFor } from "@kampus/vitest";
import { Effect, Schema } from "effect";
import { Setting } from "./index.ts";
import { doRemove, doSet, field, forms, mustText, Outcome, plain, startOn } from "./SettingGroup.edit.test-support.ts";
import {
  APPROVER,
  arrayScene,
  DEFAULT,
  Draw,
  fileName,
  holds,
  isRec,
  judge,
  originLine,
  type Id,
  makeGroup,
  OTHER_KEYS,
  OTHERS,
  PORT,
  LIMIT,
  oldRecord,
  Reach,
  rulesSetting,
  type Node,
  type Rec,
  type Scene,
  type Spec,
  buildScene,
  same,
  separators,
  shown,
} from "./SettingGroup.record.test-support.ts";
import { Origin } from "./Sources.ts";

const check = { arbitrary: { runs: runsFor({ fast: 25, full: 100 }), size: 100 } };

// ---------------------------------------------------------------------------------------------
// RC1, the traced file
// ---------------------------------------------------------------------------------------------

const refRule = rulesSetting("reconciliation.ref-rule");

const Demo = makeGroup("demo", [refRule, APPROVER, PORT, LIMIT]);

/** The plan's "One value traced": nineteen lines, a record under headers of its items, each with a `desired` table. */
const TRACED = [
  "# Reconciliation: what each ref must look like.",
  "",
  "# The main branch.",
  "[reconciliation.ref-rule.main]",
  'source = "codehost"   # read from the host',
  "",
  "[reconciliation.ref-rule.main.desired]",
  "approvals = 2",
  'checks = ["ci"]',
  "",
  "# Old release branch, going away.",
  "[reconciliation.ref-rule.release]",
  'source = "codehost"',
  "# kept for one more week",
  "[reconciliation.ref-rule.release.desired]",
  "approvals = 1",
  "# Who may approve.",
  "[delivery]",
  'approver = "people"',
  "",
].join("\n");

// Scenario: the one file the plan traces, with the exact bytes each call must give, and the two files that settle which
// header owns a comment between two tables. Plants, run once and never kept: write the answer from the parsed document
// with the serializer, so every comment and blank line goes: red; end a leaving block at the next header, not at that
// header's own comment lines: `# Who may approve.` leaves with `release.desired`, red.
it.effect(
  "scenario: RC1 the traced file gives exactly the expected text for a set and for a remove, and a comment between two tables belongs to the header below it",
  () =>
    Effect.gen(function* () {
      const set = yield* doSet(Demo, TRACED, "repo", refRule, {
        main: { source: "codehost", desired: { approvals: 3, checks: ["ci"] } },
        dev: { source: "codehost", desired: { approvals: 1 } },
      });

      expect(mustText(set)).toBe(
        [
          "# Reconciliation: what each ref must look like.",
          "",
          "# The main branch.",
          "[reconciliation.ref-rule.main]",
          'source = "codehost"   # read from the host',
          "",
          "[reconciliation.ref-rule.main.desired]",
          "approvals = 3",
          'checks = ["ci"]',
          "",
          "[reconciliation.ref-rule.dev]",
          'source = "codehost"',
          "",
          "[reconciliation.ref-rule.dev.desired]",
          "approvals = 1",
          "# Who may approve.",
          "[delivery]",
          'approver = "people"',
          "",
        ].join("\n"),
      );

      // A remove takes the four blocks, from `# The main branch.` through `approvals = 1`; the top comment stays.
      const gone = yield* doRemove(Demo, TRACED, "repo", refRule);

      expect(mustText(gone)).toBe(
        [
          "# Reconciliation: what each ref must look like.",
          "",
          "# Who may approve.",
          "[delivery]",
          'approver = "people"',
          "",
        ].join("\n"),
      );

      // Two tables with a comment between them, no blank line on either side: it belongs to the header below it.
      const BETWEEN = [
        "[reconciliation.ref-rule.upper]",
        'source = "codehost"',
        "# between two tables",
        "[reconciliation.ref-rule.lower]",
        'source = "codehost"',
        "",
      ].join("\n");

      const upper = { upper: { source: "codehost" } };
      const lower = { lower: { source: "codehost" } };

      // The lower table leaves: the comment goes with it.
      expect(mustText(yield* doSet(Demo, BETWEEN, "repo", refRule, upper))).toBe(
        ["[reconciliation.ref-rule.upper]", 'source = "codehost"', ""].join("\n"),
      );

      // The upper table leaves: the comment stays, with the header below it.
      expect(mustText(yield* doSet(Demo, BETWEEN, "repo", refRule, lower))).toBe(
        ["# between two tables", "[reconciliation.ref-rule.lower]", 'source = "codehost"', ""].join("\n"),
      );
    }),
);

// ---------------------------------------------------------------------------------------------
// RC2, only what differs
// ---------------------------------------------------------------------------------------------

const RC2_IDS: ReadonlyArray<Id> = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "l", "m", "v", "w"];

const LF = "\n";

const CRLF = "\r\n";

/** The cases of RC2: each form (a) to (g) with its own change, others around the record, and the three line ends. */
const record = (draw: Draw): ReadonlyArray<Scene> =>
  [...specs, ...kinds(draw)].map((spec, k) => buildScene(draw, { leave: (draw.leave + k) % 3, ...spec }));

/**
 * The cases of (l) and (m) under (w): a table becomes a scalar or an array, a table empties, in a file of CRLF, of mixed
 * line ends, and with no final line break. Every line the call does not touch is judged byte for byte with its own break.
 */
const kinds = (draw: Draw): ReadonlyArray<Spec> => {
  const old = oldRecord(draw);
  const [first = "a", second = "b"] = Object.keys(old);
  const shaped = { [first]: { n: 1, desired: { a: 2 } }, [second]: { n: 3, desired: { a: 4 } } };
  const became = { [first]: 7, [second]: { n: 3, desired: [1, 2] } };
  const again = [new RegExp(`(^|\\.)${first} = 7$`, "u"), /(^|\.)desired = \[.*\]$/u];

  // A record that nothing names is written again as `name = {}`, in a table of its own when its table is gone.
  const empty = [
    new RegExp(`^\\[${draw.table}\\]$`, "u"),
    new RegExp(`^(${draw.table}\\.)?${draw.name} = \\{\\}$`, "u"),
  ];

  const whole = [
    new RegExp(`^\\[${draw.table}\\]$`, "u"),
    new RegExp(`^(${draw.table}\\.)?${draw.name} = \\[.*\\]$`, "u"),
  ];

  return [
    {
      ids: ["l", "w"],
      label: "l a table becomes a scalar and another an array, CRLF, no final break",
      form: "c",
      style: 1,
      eol: CRLF,
      final: false,
      old: shaped,
      next: became,
      free: again,
      others: ["before"],
    },
    {
      ids: ["l", "w"],
      label: "l a table becomes a scalar and another an array, mixed, a final break",
      form: "c",
      style: 2,
      eol: CRLF,
      mixed: true,
      final: true,
      old: shaped,
      next: became,
      free: again,
      others: ["after"],
    },
    {
      ids: ["l", "w"],
      label: "l a table becomes a scalar and another an array, mixed, no final break",
      form: "c",
      style: 3,
      eol: LF,
      mixed: true,
      final: false,
      old: shaped,
      next: became,
      free: again,
    },
    {
      ids: ["m", "w"],
      label: "m an item becomes empty, mixed, no final break",
      form: "c",
      style: 0,
      eol: CRLF,
      mixed: true,
      final: false,
      next: { ...old, [first]: {} },
      others: ["before"],
    },
    {
      ids: ["m", "w"],
      label: "m a record under its own header becomes empty, CRLF, no final break",
      form: "b",
      style: 1,
      eol: CRLF,
      final: false,
      next: {},
      others: ["before"],
    },
    {
      ids: ["m", "w"],
      label: "m a record of dotted keys becomes empty, mixed, a final break",
      form: "e",
      style: 2,
      eol: LF,
      mixed: true,
      final: true,
      next: {},
      free: empty,
      others: ["after"],
    },
    {
      ids: ["m", "w"],
      label: "m a record under headers becomes empty, no final break",
      form: "c",
      style: 3,
      eol: LF,
      final: false,
      next: {},
      free: empty,
      others: ["before"],
    },
    // A dotted record at the root whose first item is one inline table: the inline item's own line never counts as a dotted key.
    {
      ids: ["i", "w"],
      label: "i a dotted item leaves, an inline item first",
      form: "e",
      style: 0,
      eol: CRLF,
      final: true,
      inlineFirst: true,
      change: { i: true, h: true },
      others: ["after"],
    },
    // The whole record becomes an array, or empties: the other lines keep their breaks, and the final break stays when the record is the whole file.
    {
      ids: ["l", "w"],
      label: "l the whole record becomes an array, another setting before it, CRLF, no final break",
      form: "c",
      style: 0,
      eol: CRLF,
      final: false,
      next: [{ n: 1 }],
      free: whole,
      others: ["before"],
    },
    {
      ids: ["l", "w"],
      label: "l the whole record becomes an array under one line of another setting, CRLF, no final break",
      form: "c",
      style: 0,
      eol: CRLF,
      final: false,
      next: [{ n: 1 }],
      free: whole,
      lone: true,
    },
    {
      ids: ["l", "w"],
      label: "l the whole record becomes an array and is the whole file, a final break",
      form: "c",
      style: 1,
      eol: CRLF,
      final: true,
      next: [{ n: 1 }],
      free: whole,
    },
    {
      ids: ["m", "w"],
      label: "m the whole record empties and is the whole file, a final break",
      form: "c",
      style: 2,
      eol: LF,
      final: true,
      next: {},
      free: empty,
    },
    // A new item beside a dotted item that no header holds goes in a line of its own, not under a header.
    {
      ids: ["c", "j"],
      label: "c an item arrives beside a dotted item at the root",
      form: "c",
      style: 2,
      eol: LF,
      final: true,
      rootFirst: true,
      change: { j: true },
      others: ["after"],
    },
  ];
};

const specs: ReadonlyArray<Spec> = [
  {
    ids: ["a", "h", "i", "j", "w"],
    label: "a inline items",
    form: "a",
    style: 0,
    mixed: true,
    eol: LF,
    final: true,
    change: { h: true, i: true, j: true },
    others: ["after"],
  },
  {
    ids: ["b", "h", "i", "j", "w"],
    label: "b dotted items",
    form: "b",
    style: 1,
    eol: CRLF,
    final: true,
    change: { h: true, i: true, j: true },
    others: ["before", "after"],
  },
  {
    ids: ["c", "h", "i", "j", "v", "w"],
    label: "c items under headers",
    form: "c",
    style: 2,
    eol: CRLF,
    final: false,
    change: { h: true, i: true, j: true },
    others: ["before", "between", "after"],
    top: true,
    leave: 0,
  },
  {
    ids: ["d", "h", "i", "j", "w"],
    label: "d dotted under the parent",
    form: "d",
    style: 3,
    mixed: true,
    eol: CRLF,
    final: false,
    change: { h: true, i: true, j: true },
    others: ["after"],
  },
  {
    ids: ["e", "h", "i", "j", "w"],
    label: "e dotted at the root",
    form: "e",
    style: 0,
    eol: LF,
    final: true,
    change: { h: true, i: true, j: true },
    others: ["after"],
  },
  {
    ids: ["f", "h", "i", "j", "w"],
    label: "f mixed",
    form: "f",
    style: 1,
    eol: LF,
    final: true,
    change: { h: true, i: true, j: true },
    others: ["after"],
  },
  {
    ids: ["g", "h", "i", "j", "w"],
    label: "g inline item over lines",
    form: "g",
    style: 2,
    mixed: true,
    eol: CRLF,
    final: true,
    change: { h: true, i: true, j: true },
    others: ["after"],
  },
  {
    ids: ["c", "i", "v"],
    label: "c an item leaves between others",
    form: "c",
    style: 3,
    eol: LF,
    final: true,
    change: { i: true },
    others: ["between", "after"],
    leave: 1,
  },
  { ids: ["c", "h"], label: "c one key changes", form: "c", style: 0, eol: CRLF, final: true, change: { h: true } },
  {
    ids: ["b", "i"],
    label: "b a dotted item leaves",
    form: "b",
    style: 2,
    eol: LF,
    final: true,
    change: { i: true },
    others: ["after"],
  },
  {
    ids: ["e", "j"],
    label: "e a dotted item arrives",
    form: "e",
    style: 3,
    eol: CRLF,
    final: false,
    change: { j: true },
    others: ["after"],
  },
  {
    ids: ["a", "j"],
    label: "a an inline item arrives",
    form: "a",
    style: 1,
    eol: LF,
    final: true,
    change: { j: true },
    others: ["before"],
  },
  {
    ids: ["f", "i"],
    label: "f the dotted item leaves",
    form: "f",
    style: 0,
    eol: LF,
    final: false,
    change: { i: true },
  },
  {
    ids: ["g", "h"],
    label: "g an inline item over lines changes",
    form: "g",
    style: 3,
    eol: LF,
    final: true,
    change: { h: true },
  },
  {
    ids: ["d", "i", "j"],
    label: "d an item leaves and one arrives",
    form: "d",
    style: 2,
    eol: LF,
    final: true,
    change: { i: true, j: true },
  },
  {
    ids: ["j", "c"],
    label: "c an item arrives under headers",
    form: "c",
    style: 1,
    eol: LF,
    final: true,
    change: { j: true },
    others: ["after"],
  },
];

// Plants, one per class, run once and never kept (in internal/edit.ts and internal/toml.ts): (a) take a key that has a
// header of its own for one value and replace the whole record: every item line is rewritten, red; (b) call a table
// spread only when a header names it: a dotted item `main.n = 1` is removed and written again as `main = { n = 2 }`, red;
// (c) take out a leaving item's header line only, so its keys fall into the block above, red; (d) look for a leaving
// dotted line only inside its own path's block: `rules.old.n = 2` under `[r]` stays, red; (e) put a new dotted item at
// the end of the file: it lands under the last header, red; (f) decide every item's form from the first item: the dotted
// item is taken out as a block, with the lines after it, red; (g) compare a multi-line inline item member by member: a new
// member lands before its closing brace with no line break, red; (h) set the whole item when one of its keys differs: its
// other lines are rewritten, red; (j) write a new item beside header-written siblings where today's one-key set puts it: it
// lands above the first header, red; (v) end a leaving block at the next block of the same setting only: another
// setting's table between the record's blocks goes too, red; (w) end each new block's lines with `\n` whatever the file
// uses: red.
it.effect.prop(
  "RC2 only what differs: a record set writes the keys that differ, an item that leaves takes its lines, and every other line stays as it was",
  Draw.fields,
  (draw) =>
    Effect.gen(function* () {
      const reach = new Reach<Id>(RC2_IDS);

      for (const scene of record(draw)) {
        const found = yield* doSet(scene.group, scene.text, "repo", scene.setting, scene.next);

        expect(found._tag, `${shown(scene)}: ${found._tag === "error" ? found.message : ""}`).toBe("text");

        if (found._tag === "text") {
          expect(judge(scene, found.text).join("\n"), shown(scene)).toBe("");
        }

        reach.mark(...scene.ids);
      }

      reach.done();
    }),
  check,
);

// ---------------------------------------------------------------------------------------------
// RC3, it reads back
// ---------------------------------------------------------------------------------------------

/** What a start over the answer reads: the record, where it came from, and the other settings as before. */
const readBack = Effect.fnUntraced(function* (scene: Scene, text: string) {
  const exit = yield* startOn(scene.group, scene.app, { repo: text });

  expect(exit._tag, `${scene.label}: the start`).toBe("Success");

  if (exit._tag !== "Success") {
    return;
  }

  const got = exit.value.values[field(scene.name)];
  const origin = exit.value.origins[scene.name];

  if (scene.remove) {
    expect(plain(got), `${scene.label}: the default`).toEqual(plain(DEFAULT));
    expect(origin, scene.label).toEqual(Origin.cases.default.make({}));
  } else {
    expect(plain(got), `${scene.label}: the value\n${text}`).toEqual(plain(scene.next));

    // The origin is the line at exactly the setting's path (Sources.ts `file`), 0 when none is: a record named only by the headers of its items.
    expect(origin?._tag === "file" ? origin.line : origin?._tag, `${scene.label}: the origin's line\n${text}`).toBe(
      originLine(text, scene.path),
    );
    expect(origin?._tag === "file" ? origin.file : undefined, scene.label).toBe(fileName(scene.app));
  }

  for (const which of OTHER_KEYS) {
    const { key, name: setting, value } = OTHERS[which];
    const line = holds(text, [which, key]) ? originLine(text, [which, key]) : undefined;
    const read = exit.value.values[field(setting)];

    if (line === undefined) {
      expect(exit.value.origins[setting], `${scene.label}: ${setting} reads its default`).toEqual(
        Origin.cases.default.make({}),
      );
    } else {
      expect(read, `${scene.label}: ${setting}`).toBe(value);
      expect(exit.value.origins[setting], `${scene.label}: ${setting} stays where it was`).toEqual(
        Origin.cases.file.make({ file: fileName(scene.app), line }),
      );
    }
  }
});

/** Run one scene's call; the answer's text. */
const answer = Effect.fnUntraced(function* (scene: Scene) {
  const found = scene.remove
    ? yield* doRemove(scene.group, scene.text, "repo", scene.setting)
    : yield* doSet(scene.group, scene.text, "repo", scene.setting, scene.next);

  expect(found._tag, `${shown(scene)}: ${found._tag === "error" ? found.message : ""}`).toBe("text");

  return found._tag === "text" ? found.text : "";
});

const RC3_IDS: ReadonlyArray<Id> = ["i", "l", "m", "o"];

/** The cases of RC3, at most eight starts: an item leaves (i), a value changes kind (l), a record empties (m), keys need quotes (o). */
const readable = (draw: Draw): ReadonlyArray<Scene> => {
  const old = oldRecord(draw);
  const [first = "a", second = "b"] = Object.keys(old);

  return [
    buildScene(draw, {
      ids: ["i"],
      label: "i a dotted item leaves",
      form: "b",
      style: 0,
      eol: LF,
      final: true,
      change: { i: true },
      others: ["before", "after"],
    }),
    // A spread table becomes a scalar, and a table inside an item becomes an array.
    buildScene(draw, {
      ids: ["l"],
      label: "l a table becomes a scalar, a table inside an item becomes an array",
      form: "c",
      style: 1,
      eol: CRLF,
      mixed: true,
      final: false,
      old: { [first]: { n: 1, desired: { a: 2 } }, [second]: { n: 3, desired: { a: 4 } } },
      next: { [first]: 7, [second]: { n: 3, desired: [1, 2] } },
    }),
    // An array of tables becomes a record.
    arrayScene(draw, {
      ids: ["l"],
      label: "l an array of tables becomes a record",
      form: "tables",
      old: [{ n: 1 }, { n: 2 }],
      next: { [first]: { n: 1 } },
      sep: true,
      rules: true,
      style: 2,
      eol: LF,
      final: true,
      others: true,
    }),
    // A table that empties: an item under its own header, a record under its own header, a record nothing names once its keys go.
    buildScene(draw, {
      ids: ["m"],
      label: "m an item under a header becomes empty",
      keeps: [`[${draw.table}.${draw.name}.${first}]`],
      form: "c",
      style: 3,
      eol: LF,
      final: true,
      next: { ...old, [first]: {} },
    }),
    buildScene(draw, {
      ids: ["m"],
      label: "m a record under its own header becomes empty",
      keeps: [`[${draw.table}.${draw.name}]`],
      form: "b",
      style: 0,
      eol: CRLF,
      final: false,
      next: {},
      others: ["after"],
    }),
    buildScene(draw, {
      ids: ["m"],
      label: "m a record of dotted keys becomes empty",
      form: "e",
      style: 1,
      eol: LF,
      mixed: true,
      final: false,
      next: {},
      others: ["after"],
    }),
    // Keys that need quotes, as an item's name and as a key inside one: new under headers, and old inline.
    buildScene(draw, {
      ids: ["o"],
      label: "o quoted keys arrive under their own headers",
      form: "c",
      style: 2,
      eol: LF,
      final: true,
      old: { [first]: { n: 1 }, "a.b": { "": 2, 雪: 3 } },
      next: { [first]: { n: 1 }, "a.b": { "": 2, 雪: 3, "x.y": 4 }, "": { "a.b": { 雪: 5 } }, 雪: { "": 6 } },
      others: ["after"],
    }),
    buildScene(draw, {
      ids: ["o"],
      label: "o quoted keys in inline items change",
      form: "a",
      style: 3,
      eol: CRLF,
      final: true,
      old: { "a.b": { "": 1, 雪: 2 }, "": { x: 3 } },
      next: { "a.b": { "": 1, 雪: 9 }, "": { x: 3 }, 雪: { "a.b": 7 } },
    }),
  ];
};

// Plants (in internal/edit.ts and internal/toml.ts): (i) skip the keys that are gone: the old item stays and the start
// reads it, red; (l) set over a spread table without taking it out first: the one-key set refuses and the edit fails
// `edit`, red; (m) plan the keys of an empty new record written by dotted keys: nothing names it afterwards and the start
// reads the default, red; (o) write a new header's keys bare: `a.b` reads back as two tables, red.
it.effect.prop(
  "RC3 it reads back: a start over the answer gives the new record, the file and the line of the setting's own key, and the other settings as before",
  Draw.fields,
  (draw) =>
    Effect.gen(function* () {
      const reach = new Reach<Id>(RC3_IDS);

      for (const scene of readable(draw)) {
        const text = yield* answer(scene);

        // A table that a header names keeps its header when its keys go: the header is still a line of the answer.
        for (const line of scene.keeps) {
          expect(text.split(/\r?\n/u), `${scene.label}: the header stays\n${text}`).toContain(line);
        }

        yield* readBack(scene, text);
        reach.mark(...scene.ids);
      }

      reach.done();
    }),
  check,
);

// ---------------------------------------------------------------------------------------------
// RC4, a leaving table takes its comments
// ---------------------------------------------------------------------------------------------

const RC4_IDS: ReadonlyArray<Id> = ["p", "q", "r", "s", "t", "y"];

/** The cases of RC4: at most five sets and seven removes, six starts (the `start` flag). */
const leaving = (draw: Draw): ReadonlyArray<{ readonly scene: Scene; readonly start: boolean }> => {
  // The comment right above the second item's header, and a comment then a blank line above the third's.
  const layout = { form: "c", gaps: ["c", "cb"], inner: "b", eol: LF, final: true } as const;

  return [
    // (p) (s) the lower table leaves: the comment right above its header goes with it.
    {
      start: true,
      scene: buildScene(draw, {
        ...layout,
        ids: ["p", "s"],
        label: "p s the lower table of two leaves",
        style: 0,
        leave: 1,
        change: { i: true },
        others: ["after"],
      }),
    },
    // (s) the upper table leaves: the comment between the two stays, with the header below it.
    {
      start: false,
      scene: buildScene(draw, {
        ...layout,
        ids: ["s"],
        label: "s the upper table of two leaves",
        style: 1,
        leave: 0,
        change: { i: true },
        others: ["after"],
      }),
    },
    // (q) a comment with a blank line between it and the header stays when that table leaves.
    {
      start: true,
      scene: buildScene(draw, {
        ...layout,
        ids: ["q"],
        label: "q a comment above a blank line stays",
        style: 2,
        leave: 2,
        change: { i: true },
        others: ["after"],
      }),
    },
    // (r) (t) comments inside a block, after a value and inside a list; the block ends the file, with blank lines above it.
    {
      start: true,
      scene: buildScene(draw, {
        form: "c",
        ids: ["r", "t"],
        label: "r t the last block leaves with its comments",
        style: 3,
        leave: 2,
        change: { i: true },
        gaps: ["b", "bb"],
        inner: "b",
        inside: true,
        multi: true,
        tail: "   # tail",
        eol: LF,
        final: false,
      }),
    },
    // (r) the same in dotted keys: an own-line comment between the dotted lines stays.
    {
      start: false,
      scene: buildScene(draw, {
        form: "b",
        ids: ["r"],
        label: "r dotted lines leave with their comments",
        style: 0,
        leave: 1,
        change: { i: true },
        inside: true,
        multi: true,
        tail: " # tail",
        eol: CRLF,
        final: true,
        others: ["after"],
      }),
    },
    // (y) the whole setting removed, in each form.
    // (y) a record of dotted keys at the root whose first item is one inline table: the lines of the item are cut once.
    {
      start: false,
      scene: buildScene(draw, {
        form: "e",
        ids: ["y"],
        label: "y a remove of dotted keys with an inline item first",
        style: 0,
        eol: LF,
        final: true,
        remove: true,
        inlineFirst: true,
        others: ["after"],
      }),
    },
    // (y) a file that holds only the record, and ends with a line break, loses all of it: the answer is empty text.
    ...(["a", "b", "c", "e", "f", "g"] as const).flatMap((form, n) =>
      [LF, CRLF].map((eol) => ({
        start: false,
        scene: buildScene(draw, {
          form,
          ids: ["y"],
          label: `y a remove in form ${form} leaves an empty file (${JSON.stringify(eol)})`,
          style: n,
          eol,
          final: true,
          remove: true,
          alone: true,
          inside: false,
        }),
      })),
    ),
    ...(["a", "b", "c", "d", "e", "f", "g"] as const).map((form, n) => ({
      start: form === "a" || form === "c" || form === "e",
      scene: buildScene(draw, {
        form,
        ids: ["y"],
        label: `y a remove in form ${form}`,
        style: n,
        eol: n % 2 === 0 ? LF : CRLF,
        final: n !== 4,
        mixed: n % 3 === 1,
        remove: true,
        inside: n % 2 === 0,
        others: ["before", "after"],
      }),
    })),
  ];
};

// Plants: (p) start a leaving block at its header: the comment right above it stays, red; (q) walk up over blank lines
// too, as an insert's section start does: a comment with a blank line between goes, red; (r) take a leaving block's keys
// out one by one, as a one-key remove does: its own-line comments stay, red; (t) leave the blank lines above a leaving
// last block: the file ends in blank lines, red; (y) remove a record setting by its own header only: its items' blocks
// stay, red.
it.effect.prop(
  "RC4 a leaving table takes its comments: exactly the lines its blocks own go, every other line stays, and a start reads the rest",
  Draw.fields,
  (draw) =>
    Effect.gen(function* () {
      const reach = new Reach<Id>(RC4_IDS);

      for (const { scene, start } of leaving(draw)) {
        const text = yield* answer(scene);

        expect(judge(scene, text).join("\n"), shown(scene)).toBe("");

        if (start) {
          yield* readBack(scene, text);
        }

        reach.mark(...scene.ids);
      }

      reach.done();
    }),
  check,
);

// ---------------------------------------------------------------------------------------------
// RC5, one key still keeps its comment
// ---------------------------------------------------------------------------------------------

/** The cases of RC5: a key written as one assignment whose list over several lines holds a comment, gone from the record. */
const oneKey = (draw: Draw): ReadonlyArray<Scene> => {
  const lists = oldRecord(draw, true);
  const [first = "a", second = "b", third = "c"] = Object.keys(lists);
  const items: Rec = { [first]: [1, 2], [second]: [3, 4], [third]: [5, 6] };

  const without = (record: Rec, gone: string) =>
    Object.fromEntries(Object.entries(record).filter(([key]) => key !== gone));

  const gone = Object.keys(lists)[draw.leave % 3] ?? first;

  const trimmed = Object.fromEntries(
    Object.entries(lists).map(([key, item]) => [key, key === gone && isRec(item) ? without(item, "list") : item]),
  );

  return [
    // An item that is one assignment: `main = [` ... `]`, under the record's header.
    buildScene(draw, {
      ids: ["u"],
      label: "u an item that is a list over lines leaves",
      form: "a",
      style: 0,
      eol: LF,
      final: true,
      old: items,
      next: without(items, gone),
      multi: true,
      others: ["after"],
    }),
    // A key inside an item under its own header.
    buildScene(draw, {
      ids: ["u"],
      label: "u a key of an item under a header leaves",
      form: "c",
      style: 1,
      eol: CRLF,
      final: true,
      old: lists,
      next: trimmed,
      multi: true,
      others: ["after"],
    }),
    // A dotted key.
    buildScene(draw, {
      ids: ["u"],
      label: "u a dotted key leaves",
      form: "b",
      style: 2,
      eol: LF,
      final: false,
      old: lists,
      next: trimmed,
      multi: true,
      inside: true,
    }),
  ];
};

// Plant: drop the comments inside a removed value on a one-key remove, as a leaving table does: red.
it.effect.prop(
  "RC5 one key still keeps its comment: a key written as one assignment leaves only its assignment, and the comment inside its list stays on a line of its own where the key was",
  Draw.fields,
  (draw) =>
    Effect.gen(function* () {
      const reach = new Reach<Id>(["u"]);

      for (const scene of oneKey(draw)) {
        const text = yield* answer(scene);

        expect(judge(scene, text).join("\n"), shown(scene)).toBe("");
        // The comment inside the gone list is in the answer, once.
        expect(text.match(/# note \d+/gu)?.length, `${scene.label}: the comments`).toBe(
          scene.text.match(/# note \d+/gu)?.length,
        );
        reach.mark(...scene.ids);
      }

      reach.done();
    }),
  check,
);

// ---------------------------------------------------------------------------------------------
// RC6, no change gives the same text
// ---------------------------------------------------------------------------------------------

/** The same data, every table's keys in the other order. */
const reorder = (record: Rec): Rec =>
  Object.fromEntries(
    Object.entries(record)
      .map(([key, child]): [string, Node] => [key, isRec(child) ? reorder(child) : child])
      .reverse(),
  );

/** The cases of RC6: the record the file holds, spelled with floats and literal strings, asked for in another key order. */
const unchanged = (draw: Draw): ReadonlyArray<Scene> =>
  (["a", "b", "c", "d", "e", "f", "g"] as const).map((form, n) =>
    buildScene(draw, {
      form,
      ids: ["n"],
      label: `n the record the file holds, form ${form}`,
      style: n,
      eol: n % 2 === 0 ? LF : CRLF,
      final: n !== 3,
      odd: n % 3 !== 2,
      next: reorder(oldRecord(draw)),
      others: ["after"],
    }),
  );

// Plant: compare text, not data, so `1.0` for 1 or a new key order rewrites the line: red.
it.effect.prop(
  "RC6 no change gives the same text: the record the file already holds, in any spelling or key order, answers the input byte for byte",
  Draw.fields,
  (draw) =>
    Effect.gen(function* () {
      const reach = new Reach<Id>(["n"]);

      for (const scene of unchanged(draw)) {
        expect(yield* answer(scene), shown(scene)).toBe(scene.text);
        reach.mark(...scene.ids);
      }

      reach.done();
    }),
  check,
);

// ---------------------------------------------------------------------------------------------
// RC7, an array is replaced whole, in its own form
// ---------------------------------------------------------------------------------------------

/** The cases of RC7: twelve sets and five starts (the `start` flag). */
const arrays = (draw: Draw): ReadonlyArray<{ readonly scene: Scene; readonly start: boolean }> => {
  const [a = 1, b = 2, c = 3] = draw.steps;
  const word = draw.fresh.word;
  const inline = { form: "inline", style: 0, eol: LF, final: true, others: true } as const;
  const tables = { form: "tables", style: 1, eol: LF, final: true, others: true } as const;
  const crlf = { eol: CRLF, final: false } as const;

  return [
    // (k) an inline array that differs is one new inline value; none of it is written as blocks.
    {
      start: false,
      scene: arrayScene(draw, {
        ...inline,
        ids: ["k"],
        label: "k an inline list on one line",
        old: [a, b, c],
        next: [a + 1, word],
      }),
    },
    // (k) over several lines with a comment inside: the comment stays, on the line above its key.
    {
      start: true,
      scene: arrayScene(draw, {
        ...inline,
        ...crlf,
        ids: ["k"],
        label: "k an inline list over lines with a comment",
        multi: true,
        old: [a, b, c],
        next: [word],
      }),
    },
    // (k) an inline array of records stays inline, whatever changes in it.
    {
      start: false,
      scene: arrayScene(draw, {
        ...inline,
        ids: ["k"],
        label: "k an inline array of records",
        old: [{ n: a }, { n: b }],
        next: [{ n: a }, { n: b + 1, s: word }],
      }),
    },
    // (k) an equal array is not touched.
    {
      start: false,
      scene: arrayScene(draw, {
        ...inline,
        ids: ["k"],
        label: "k an equal inline array",
        old: [a, b, c],
        next: [a, b, c],
      }),
    },
    // (z) an element changed, with a comment above the first block and comments inside the blocks, and a blank line between them.
    {
      start: true,
      scene: arrayScene(draw, {
        ...tables,
        ids: ["z"],
        label: "z an element changes",
        old: [{ n: a, s: word }, { n: b }],
        next: [{ n: a, s: word }, { n: b + 1 }],
        sep: true,
        above: true,
        inside: true,
      }),
    },
    // (z) one added, no blank line between blocks.
    {
      start: false,
      scene: arrayScene(draw, {
        ...tables,
        ...crlf,
        others: false,
        ids: ["z"],
        label: "z an element is added, the blocks end a file with no final line break",
        old: [{ n: a }],
        next: [{ n: a }, { n: b }],
        sep: false,
      }),
    },
    // (z) one gone, a non-empty record inside the elements.
    {
      start: true,
      scene: arrayScene(draw, {
        ...tables,
        ids: ["z"],
        label: "z an element is gone, a table inside the others",
        old: [{ n: a, sub: { x: b } }, { n: b, sub: { x: c } }, { n: c }],
        next: [
          { n: a, sub: { x: b } },
          { n: c, sub: { y: a } },
        ],
        sep: true,
        inside: true,
        above: true,
      }),
    },
    // (z) a new array that is empty cannot be blocks: one inline line where the first block started.
    {
      start: true,
      scene: arrayScene(draw, {
        ...tables,
        ids: ["z"],
        label: "z a new empty array",
        old: [{ n: a }, { n: b }],
        next: [],
        sep: true,
        above: true,
      }),
    },
    // (z) a new array with an element that is not a record.
    {
      start: false,
      scene: arrayScene(draw, {
        ...tables,
        ids: ["z"],
        label: "z a new array of plain values",
        old: [{ n: a }, { n: b }],
        next: [a, { n: b }],
        sep: false,
      }),
    },
    // (z) the same two, with the first block under the header of the table that holds it: the line is written in that table.
    {
      start: true,
      scene: arrayScene(draw, {
        ...tables,
        ids: ["z"],
        home: true,
        label: "z a new empty array, in a table",
        old: [{ n: a }, { n: b }],
        next: [],
        sep: true,
        above: true,
      }),
    },
    {
      start: false,
      scene: arrayScene(draw, {
        ...tables,
        ids: ["z"],
        home: true,
        label: "z a new array of plain values, in a table",
        old: [{ n: a }, { n: b }],
        next: [b, { n: a }],
        sep: false,
      }),
    },
    // (z) the first block follows another setting's table: that table cannot hold the line, so it is written where a new key goes.
    {
      start: true,
      scene: arrayScene(draw, {
        ...tables,
        ids: ["z"],
        behind: true,
        mixed: true,
        label: "z a new empty array, the blocks follow another table",
        old: [{ n: a }, { n: b }],
        next: [],
        sep: true,
      }),
    },
    {
      start: false,
      scene: arrayScene(draw, {
        ...tables,
        ids: ["z"],
        behind: true,
        eol: CRLF,
        final: false,
        label: "z a new array of plain values, the blocks follow another table",
        old: [{ n: a }, { n: b }],
        next: [b, { n: a }],
        sep: false,
      }),
    },
    // (z) an equal array of tables is not touched.
    {
      start: false,
      scene: arrayScene(draw, {
        ...tables,
        ids: ["z"],
        label: "z an equal array of tables",
        old: [{ n: a }, { n: b, sub: { x: c } }],
        next: [{ n: a }, { n: b, sub: { x: c } }],
        sep: true,
        inside: true,
        above: true,
      }),
    },
  ];
};

// Plants: (k) diff arrays by index, as Effect's `JsonPatch.get` does: one element of an inline array changes alone, red;
// (k) write every differing array with the block writer: an inline array of records becomes `[[...]]` blocks, red; (z)
// write a differing array of tables as one inline array: red; (z) start the new blocks at the first block's `headerStart`:
// the comment above the array goes, red; (z) write an empty new array as zero blocks: the key vanishes and a start reads
// the default, red.
it.effect.prop(
  "RC7 an array is replaced whole in its own form: an inline array stays inline, an array of tables comes back as `[[name]]` blocks where its first block started, and an equal one is not touched",
  Draw.fields,
  (draw) =>
    Effect.gen(function* () {
      const reach = new Reach<Id>(["k", "z"]);

      for (const { scene, start } of arrays(draw)) {
        const text = yield* answer(scene);

        expect(judge(scene, text).join("\n"), shown(scene)).toBe("");

        if (scene.lines.some((line) => line.text.startsWith("[["))) {
          const next = Array.isArray(scene.next) ? scene.next : [];

          if (same(scene.old, scene.next)) {
            expect(text, `${scene.label}: not touched`).toBe(scene.text);
          } else if (next.length > 0 && next.every(isRec)) {
            // One block per element, a blank line between two only when the old blocks had one.
            const heads = scene.lines.flatMap((line, i) => (line.text === `[[${scene.path.join(".")}]]` ? [i] : []));
            const wanted = heads.length > 1 && scene.lines[(heads[1] ?? 0) - 1]?.text === "" ? 1 : 0;

            expect((text.match(/^\[\[/gmu) ?? []).length, `${scene.label}: one block per element\n${text}`).toBe(
              next.length,
            );
            expect(separators(text, scene.path), `${scene.label}: blank lines between blocks\n${text}`).toEqual(
              next.slice(1).map(() => wanted),
            );
          } else {
            expect(text.includes("[["), `${scene.label}: no block\n${text}`).toBe(false);
          }
        } else {
          expect(text.includes("[["), `${scene.label}: an inline array stays inline`).toBe(false);
        }

        if (start) {
          yield* readBack(scene, text);
        }

        reach.mark(...scene.ids);
      }

      reach.done();
    }),
  check,
);

// ---------------------------------------------------------------------------------------------
// RC8, values stay out
// ---------------------------------------------------------------------------------------------

const hiddenRules = Setting.make(
  "secret.rules",
  Schema.Record(Schema.String, Schema.Record(Schema.String, Schema.Int)),
).pipe(Setting.withDefault({}), Setting.withDescription("Rules by name."));

// [secrets] Plant: name the keys that differ in the `edit` message (internal/change.ts), red; the guard half is in
// internal/change.test.ts. Here a refused record never prints a key or a value: a member of the wrong type, and a record
// whose text is refused for another reason.
it.effect.prop(
  "RC8 [secrets] values stay out: a secret-looking item name or value never appears in an edit's message or cause, for a refused record",
  Draw.fields,
  (draw) =>
    Effect.gen(function* () {
      const reach = new Reach<Id>(["x"]);
      const [one, two] = draw.secrets;
      const group = makeGroup("demo", [hiddenRules]);
      const quoted = JSON.stringify(one);

      const flows: ReadonlyArray<{
        readonly name: string;
        readonly text: string;
        readonly value: unknown;
        readonly reason: string;
      }> = [
        {
          name: "a member of the wrong type under a secret name",
          text: "",
          value: { [one]: { n: "not a number" } },
          reason: "invalid",
        },
        { name: "a secret as the wrong member", text: "", value: { main: { n: two } }, reason: "invalid" },
        { name: "a secret name and member", text: "", value: { [one]: { [two]: two } }, reason: "invalid" },
        {
          name: "a record refused for another key of the file",
          text: `[nobody]\nqqqq = ${quoted}\n`,
          value: { [one]: { [two]: 1 } },
          reason: "unknown",
        },
        {
          name: "a text that is not TOML",
          text: `[secret.rules.${quoted}]\nn = = 1\n`,
          value: { [one]: { [two]: 1 } },
          reason: "syntax",
        },
      ];

      for (const flow of flows) {
        for (const found of [
          yield* doSet(group, flow.text, "repo", hiddenRules, flow.value),
          yield* doRemove(group, flow.text, "repo", hiddenRules),
        ]) {
          if (found._tag === "error") {
            for (const secret of [one, two]) {
              for (const form of forms(secret)) {
                expect(found.printed.includes(form), `${flow.name}: ${found.reason} holds the secret as ${form}`).toBe(
                  false,
                );
              }
            }
          }
        }

        const asked = yield* doSet(group, flow.text, "repo", hiddenRules, flow.value);

        expect(asked._tag, `${flow.name}: a set is refused`).toBe("error");
        expect(asked._tag === "error" ? asked.reason : "", flow.name).toBe(flow.reason);
        reach.mark("x");
      }

      reach.done();
    }),
  check,
);

void Outcome;
