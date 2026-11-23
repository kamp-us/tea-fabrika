// Ticket 1843, slice 2, kalfa/config (new work): E1 to E8, E10 and S1 of the approved plan
// (.kalfa/quests/kalfa-config-edit-PLAN.md, with its Amendment 1), for `SettingGroup.edit` (SettingGroup.ts), read
// through the package's root entry (index.ts). Written before the code. E11 is in internal/change.test.ts, the type
// laws T5 and T7 in SettingGroup.types.test.ts, and P1 in Package.integration.test.ts. E9 went with ticket 1844: a
// record under its own header, as dotted sub-keys or as an array of tables, now edits (SettingGroup.record.test.ts), and
// the id E9 is not used again.
//
// What the edit does, as these laws hold it to (the plan's "What the edit does", and Amendment 1):
// - `SettingGroup.edit(group, text, file).set(setting, value)` and `.remove(setting)` each answer an
//   `Effect<string, SettingsError>` with no requirements: the file's new text, or the one error. Nothing is read or
//   written; the text is the only input.
// - The new text is the old text with one setting's value replaced, or one line (or inline member) added where the
//   format puts it, or one assignment taken out. Every other byte is the old byte.
// - Before the edit: the setting is one of the group's, its file scope holds the file, the value passes its schema and
//   can be written, the text parses, and the whole file passes with the edited setting's own old value left out. After
//   it: the answer parses, holds only the one change, and passes the whole check. Each error names the file; a message
//   ends `<file> was not changed.` and never holds a value.
// - A file name is as a person reads it: `.demo/demo.toml` and `~/.demo/demo.toml`.
//
// Every law is a property over generated typed files (SettingGroup.edit.test-support.ts): each class (a) to (y) of the
// plan's "Generators, slice 2" is built from the drawn seeds in every run, a law keeps the ids it reached, and it fails
// when one is missing. E1 is the one scenario, as the plan says. Each law names its plant: break one thing in the code,
// run the law, see it red, undo it.
import { expect, it } from "@effect/vitest";
import { runsFor } from "@kampus/vitest";
import { Effect, Schema } from "effect";
import { Setting, SettingGroup } from "./index.ts";
import {
  broken,
  Draw,
  type Draws,
  doRemove,
  doSet,
  FALLBACK,
  type Files,
  faulty,
  flat,
  field,
  forms,
  groupFor,
  hiding,
  lineNumber,
  middle,
  mustText,
  fileName,
  OLD,
  plain,
  reachesY,
  otherFile,
  type Outcome,
  ownFaults,
  type Position,
  positions,
  Reach,
  refused,
  removed,
  SET_IDS,
  scoped,
  sibling,
  startRefusal,
  spliceFor,
  startOn,
  targetSetting,
  unchanged,
  valued,
  valuesFor,
  variable,
  type Id,
} from "./SettingGroup.edit.test-support.ts";
import { Origin } from "./Sources.ts";

// 100 full runs took 16 to 22 s of CI's 60 s limit for each of this file's slowest laws (a draw builds a whole file, and a run reads and edits it several times),
// so the full count is 35: each run still draws every class, and `reach` still fails a law that misses one.
const check = { arbitrary: { runs: runsFor({ fast: 25, full: 35 }), size: 100 } };

/** The places a key sits and the values each is set to, for one draw. */
const cases = (draw: Draws) =>
  [...positions(draw), ...valued(draw)].flatMap((p) => valuesFor(draw, p).map((value) => ({ p, value })));

// Plants, one per class (run once, never kept), in internal/toml.ts and internal/edit.ts:
// (a) build an assignment's path from its own key only, without its header's path: the key is not found and a second
//     one is added, red; (b) join a dotted key's parts into one word: red; (c) leave an inline table's members out of
//     the assignments: red; (d) put a missing key at the end of the file, not its table's section: it lands under a
//     later table, red; (e) with no table, write the key at the root with no header: red; (f) read a key from its source
//     text, so `"delivery"` keeps its quotes and is not found: red; (g) replace from the value's start to the end of its
//     line, so the comment after it goes: red; (h) end each added line with `\n` whatever the file uses: red; (i) put a
//     missing key at the end of the deepest section under its table, `[delivery.rule]`, not its own: red.
it.effect.prop(
  "E2 every other byte kept: a set replaces only the key's value, or adds one line where the format puts it",
  Draw.fields,
  (draw) =>
    Effect.gen(function* () {
      const reach = new Reach(SET_IDS);
      const cased = cases(draw);

      for (const { p, value } of cased) {
        const label = `${p.ids.join("")} ${p.names.path.join(".")} ${p.mode} in ${p.file}`;
        const answer = yield* doSet(groupFor(p), p.located.text, p.file, targetSetting(p), value);

        expect(answer._tag, `${label}: ${answer._tag === "error" ? answer.message : ""}`).toBe("text");
        const text = answer._tag === "text" ? answer.text : "";
        const splice = spliceFor(p, value);

        if (splice === "same") {
          expect(text, `${label}: the value the file holds is no change`).toBe(p.located.text);
        } else {
          expect(text.slice(0, splice.pre.length), `${label}: the bytes before`).toBe(splice.pre);
          expect(text.slice(text.length - splice.post.length), `${label}: the bytes after`).toBe(splice.post);
          expect(text.length, label).toBeGreaterThan(splice.pre.length + splice.post.length);

          const added = middle(text, splice);

          expect(added.startsWith(splice.lead), `${label}: the new text starts with the key`).toBe(true);
          // The value's own text: not empty, and on the one line.
          expect(added.slice(splice.lead.length), label).toMatch(/^[^\r\n]+$/u);
        }

        reach.mark(...p.ids);
      }

      if (reachesY(cased.map(({ p }) => p))) {
        reach.mark("y");
      }

      reach.done();
    }),
  check,
);

// Plants, one per class, in the order of E2's list and also: (j) write the value as decoded, not as its JSON encoding:
// a `NumberFromString` setting writes `5` where its file form is `"5"`, red; (k) compare arrays by length in the
// no-change test, so `[1, 2]` set to `[3, 4]` stays `[1, 2]`: red; (l) write a record's keys bare, so `a.b` reads back
// as a nested table: red; (y) take the table from the name's first word only, so `quality.stryker.runs` is written
// under `[quality]` as `runs`: red; (y) refuse a file-only setting in the edit as the start refuses its variable: red.
it.effect.prop(
  "E3 it reads back: a start over the answer gives the set value, with the file and the key's line",
  Draw.fields,
  (draw) =>
    Effect.gen(function* () {
      const reach = new Reach(SET_IDS);
      const cased = cases(draw);

      for (const { p, value } of cased) {
        const label = `${p.ids.join("")} ${p.names.path.join(".")} ${p.mode} in ${p.file}`;
        const group = groupFor(p);
        const answer = yield* doSet(group, p.located.text, p.file, targetSetting(p), value);

        expect(answer._tag, `${label}: ${answer._tag === "error" ? answer.message : ""}`).toBe("text");
        const text = answer._tag === "text" ? answer.text : "";
        const splice = spliceFor(p, value);
        const name = p.names.path.join(".");

        const exit = yield* startOn(group, p.app, p.file === "repo" ? { repo: text } : { user: text });

        expect(exit._tag, label).toBe("Success");

        if (exit._tag === "Success") {
          // The start's values are untyped here: a live setting reads as an Effect to yield.
          const read = exit.value.values[field(name)];
          const live: SettingGroup.Live<unknown> = read;
          const got = p.mode === "live" ? yield* live : read;

          // A start reads `-0.0` as `0` (the start's own reading, not the edit's): the data is compared as JSON.
          expect(plain(got), `${label}: the value`).toEqual(plain(value));
          expect(exit.value.origins[name], `${label}: where it came from`).toEqual(
            Origin.cases.file.make({
              file: fileName(p.app, p.file),
              line: lineNumber(text, splice === "same" ? (p.located.key ?? 0) : splice.key),
            }),
          );
        }

        reach.mark(...p.ids);
      }

      if (reachesY(cased.map(({ p }) => p))) {
        reach.mark("y");
      }

      reach.done();
    }),
  check,
);

// ---------------------------------------------------------------------------------------------
// E1, the ticket's file
// ---------------------------------------------------------------------------------------------

const Approver = Schema.Literals(["people", "robots", "owner"]);

const approver = Setting.make("delivery.approver", Approver).pipe(
  Setting.withDefault("people"),
  Setting.withDescription("Who may approve a change request."),
);

const carry = Setting.make("delivery.carry", Schema.Struct({ rule: Approver, days: Schema.Int })).pipe(
  Setting.withDefault({ rule: "people", days: 3 }),
  Setting.withDescription("Who carries a rule over, and for how long."),
);

const labels = Setting.make("delivery.labels", Schema.Array(Schema.String)).pipe(
  Setting.withDefault([]),
  Setting.withDescription("The labels a change request takes."),
);

const port = Setting.make("instance.port", Schema.Int).pipe(
  Setting.withDefault(18787),
  Setting.withDescription("The port the bot listens on."),
);

const Demo = SettingGroup.make("demo", approver, carry, labels, port);

/** The ticket's file: a comment block above a header, a comment after a value, an inline table, a multi-line array and blank lines. */
const TICKET = [
  "# Delivery settings.",
  "# Who may approve a change request.",
  "",
  "[delivery]",
  'approver = "people"   # the default',
  'carry = { rule = "people", days = 3 }   # as one inline table',
  "labels = [",
  '  "a",   # first',
  '  "b",',
  "]",
  "",
  "[instance]",
  "port = 4100",
  "",
].join("\n");

const around = (before: string, after: string) => TICKET.replace(before, after);

// Scenario: the one file the ticket describes, with the exact bytes each call must give. Plant: write the answer from
// the parsed document with the serializer, so the comments and the inline table's spacing go: red.
it.effect("scenario: E1 the ticket's file gives exactly the expected text for a set and for a remove", () =>
  Effect.gen(function* () {
    const edit = SettingGroup.edit(Demo, TICKET, "repo");

    // Only the value's text changes: the comment, its three spaces and every other line are the same bytes.
    expect(yield* edit.set(approver, "owner")).toBe(around('approver = "people"', 'approver = "owner"'));

    // A comment inside a replaced array stays, on the line above its key.
    expect(yield* edit.set(labels, ["x"])).toBe(
      around('labels = [\n  "a",   # first\n  "b",\n]', '# first\nlabels = [ "x" ]'),
    );

    // The inline table is replaced by one inline table, and its comment stays.
    expect(yield* edit.set(carry, { rule: "owner", days: 5 })).toBe(
      around('carry = { rule = "people", days = 3 }', 'carry = { rule = "owner", days = 5 }'),
    );

    // A removed key takes only its assignment: the comment after it, the line break and the blank lines stay.
    expect(yield* edit.remove(port)).toBe(around("port = 4100", ""));
    expect(yield* edit.remove(labels)).toBe(around('labels = [\n  "a",   # first\n  "b",\n]', "# first\n"));

    // A key the file lacks goes on a line of its own at the end of its table, before the blank line that ends it.
    const lacking = around('approver = "people"   # the default\n', "");

    expect(yield* SettingGroup.edit(Demo, lacking, "repo").set(approver, "robots")).toBe(
      lacking.replace("]\n\n[instance]", ']\napprover = "robots"\n\n[instance]'),
    );
  }),
);

// ---------------------------------------------------------------------------------------------
// E4, remove takes out one key
// ---------------------------------------------------------------------------------------------

const started = Effect.fnUntraced(function* (position: Position, mode: Position["mode"], files: Files) {
  const exit = yield* startOn(groupFor(position, mode), position.app, files);

  expect(exit._tag, `${position.names.path.join(".")}: the start`).toBe("Success");

  return exit._tag === "Success" ? exit.value : yield* Effect.die(new Error("the start failed"));
});

/** The value a start reads for a setting, a live one yielded, and where it came from. */
const readBack = Effect.fnUntraced(function* (position: Position, mode: Position["mode"], files: Files) {
  const found = yield* started(position, mode, files);
  const name = position.names.path.join(".");
  const read = found.values[field(name)];
  const live: SettingGroup.Live<unknown> = read;

  return { value: mode === "live" ? yield* live : read, origin: found.origins[name] };
});

// Plants: (c) remove the whole line of a key in an inline table, so its siblings go: red; drop a comment found inside
// the removed value: red.
it.effect.prop(
  "E4 remove takes out one key: only that assignment (and its comma) goes, and a start reads the next source or the default",
  Draw.fields,
  (draw) =>
    Effect.gen(function* () {
      const reach = new Reach<Id>(["a", "b", "c", "g"]);

      for (const p of positions(draw)) {
        const want = removed(p);

        if (want === undefined) {
          continue;
        }

        // A required setting has no default to read once its key is gone.
        const mode = p.mode === "required" ? "restart" : p.mode;
        const label = `${p.ids.join("")} ${p.names.path.join(".")} ${mode} in ${p.file}`;
        const answer = yield* doRemove(groupFor(p, mode), p.located.text, p.file, targetSetting(p, mode));

        expect(mustText(answer), label).toBe(want);

        // Without the key in either file the setting reads its default; with it in the other file, from there.
        const fallback = yield* readBack(p, mode, p.file === "repo" ? { repo: want } : { user: want });

        expect(plain(fallback.value), `${label}: the default`).toEqual(plain(FALLBACK[p.kind]));
        expect(fallback.origin, label).toEqual(Origin.cases.default.make({}));

        const next = otherFile(p.file);
        const kept = yield* readBack(p, mode, { [p.file]: want, [next]: sibling(p) });

        expect(plain(kept.value), `${label}: the next source`).toEqual(plain(OLD[p.kind].value));
        expect(kept.origin, label).toEqual(Origin.cases.file.make({ file: fileName(p.app, next), line: 2 }));

        reach.mark(...p.ids);
      }

      reach.done();
    }),
  check,
);

// ---------------------------------------------------------------------------------------------
// E5, file scope comes before the edit
// ---------------------------------------------------------------------------------------------

/** Whether a message names a file as a person reads it, the repo's not taken for the end of the user's. */
const names = (text: string, app: string, file: "repo" | "user") =>
  file === "user"
    ? text.includes(`~/.${app}/${app}.toml`)
    : new RegExp(`(?<!~/)\\.${app}/${app}\\.toml`, "u").test(text);

/** The words a refusal says, without the file it opens with and the sentence it ends with. */
const said = (found: typeof Outcome.cases.error.Type, file: string) =>
  found.message.split("\n")[0]?.replace(`${file}: `, "") ?? "";

// Plants: (n) drop the scope check before a set: the second whole-file check still refuses, but with the new key's
// line, red; (n) check scope for set only: a remove of a user-only setting from the repo file gives text, red.
it.effect.prop(
  "E5 file scope comes before the edit: a setting outside its file scope fails scope with that file, whether the key is there or not",
  Draw.fields,
  (draw) =>
    Effect.gen(function* () {
      const reach = new Reach<Id>(["n"]);

      for (const scene of scoped(draw)) {
        const file = fileName(scene.app, scene.file);
        const label = `${scene.file} ${scene.fileOnly ? "file-only" : "restart"} ${scene.present ? "present" : "absent"}`;

        for (const found of [
          yield* doSet(scene.group, scene.text, scene.file, scene.target, draw.values.port),
          yield* doRemove(scene.group, scene.text, scene.file, scene.target),
        ]) {
          expect(found._tag, label).toBe("error");

          if (found._tag === "error") {
            expect(found.reason, label).toBe("scope");
            expect(found.file, label).toBe(file);
            expect(found.line, `${label}: no line`).toBeUndefined();
            expect(
              found.message.endsWith(`${file} was not changed.`),
              `${label}: the file is named as not changed`,
            ).toBe(true);

            // It names where the setting may be set: its files, and its variable unless only a file may set it.
            const words = said(found, file);

            for (const place of scene.scope) {
              expect(names(words, scene.app, place), `${label}: names ${place}`).toBe(true);
            }

            expect(names(words, scene.app, scene.file), `${label}: not the file it was refused in`).toBe(false);
            expect(words.includes(variable(scene.app, scene.target.name)), `${label}: its variable`).toBe(
              !scene.fileOnly,
            );
          }
        }

        reach.mark("n");
      }

      reach.done();
    }),
  check,
);

// ---------------------------------------------------------------------------------------------
// E6, a refused value
// ---------------------------------------------------------------------------------------------

// Plant: (o) drop the schema check before the edit: an out-of-range port fails the second whole-file check with the
// edited text's line, red.
it.effect.prop(
  "E6 a refused value: a value the schema refuses, or the format cannot write, fails invalid with the setting and the file, and no line",
  Draw.fields,
  (draw) =>
    Effect.gen(function* () {
      const reach = new Reach<Id>(["o"]);

      for (const scene of refused(draw)) {
        const label = `${scene.target.name} ${scene.present ? "present" : "absent"}`;
        const found = yield* doSet(scene.group, scene.text, scene.file, scene.target, scene.value);

        expect(found._tag, label).toBe("error");

        if (found._tag === "error") {
          expect(found.reason, label).toBe("invalid");
          expect(found.file, label).toBe(fileName(scene.app, scene.file));
          expect(found.line, `${label}: no line`).toBeUndefined();
          expect(found.message, `${label}: the setting`).toContain(scene.target.name);
        }

        reach.mark("o");
      }

      reach.done();
    }),
  check,
);

// ---------------------------------------------------------------------------------------------
// E7, the whole text is checked
// ---------------------------------------------------------------------------------------------

// Plants: (p) turn a plain value where the key's table goes into an empty table before the first check, as `drop`
// does for a value above the key: the edit fails `edit` where the start fails `invalid`, red; (p) check only the answer: a fault after an inserted line is named one line late, red; (p) skip both
// whole-file checks: a file with an unknown key gets text, red; (q) check the input whole with the edited setting in
// it: a bad old value cannot be fixed, red.
it.effect.prop(
  "E7 the whole text is checked: a fault elsewhere fails with its own reason and its line in the input, and a fault at the edited setting is fixed",
  Draw.fields,
  (draw) =>
    Effect.gen(function* () {
      const reach = new Reach<Id>(["p", "q"]);
      const seen = new Set<string>();

      for (const scene of faulty(draw)) {
        const label = `${scene.fault} ${scene.side} in ${scene.file}`;

        for (const found of [
          yield* doSet(scene.group, scene.text, scene.file, scene.target, scene.value),
          yield* doRemove(scene.group, scene.text, scene.file, scene.target),
        ]) {
          expect(found._tag, label).toBe("error");

          if (found._tag === "error") {
            expect(found.reason, label).toBe(scene.reason);
            expect(found.file, label).toBe(fileName(scene.app, scene.file));
            expect(found.line, `${label}: the line in the input`).toBe(scene.line);
          }
        }

        seen.add(`${scene.fault}:${scene.side}`);
      }

      // Six faults, before and after the table, except the version's, which only fits before it.
      expect(seen.size, "every fault, on each side").toBe(11);

      // A plain value where the key's table goes, of each kind and at each depth: the edit refuses as the start does.
      const depths = new Set<string>();

      for (const scene of flat(draw)) {
        const label = `a ${scene.kind} at depth ${scene.depth} of ${scene.target.name} in ${scene.file}`;
        const files: Files = scene.file === "repo" ? { repo: scene.text } : { user: scene.text };
        const refusal = startRefusal(yield* startOn(scene.group, scene.app, files));

        expect(refusal, `${label}: the start refuses it`).toBeDefined();

        for (const found of [
          yield* doSet(scene.group, scene.text, scene.file, scene.target, scene.value),
          yield* doRemove(scene.group, scene.text, scene.file, scene.target),
        ]) {
          expect(found._tag, label).toBe("error");

          if (found._tag === "error") {
            expect(found.reason, `${label}: the start's reason`).toBe(refusal?.reason);
            expect(found.file, label).toBe(refusal?.file);
            expect(found.line, `${label}: the start's line`).toBe(refusal?.line);
          }
        }

        depths.add(`${scene.kind}:${scene.target.name.split(".").length}:${scene.depth}`);
      }

      // Five kinds, at the one depth of a two-word name and the two of a three-word name.
      expect(depths.size, "every kind at every depth").toBe(15);
      reach.mark("p");

      const own = ownFaults(draw);

      for (const p of own) {
        const label = `${p.kind} old ${p.located.text.split("\n")[1] ?? ""} in ${p.file}`;
        const value = draw.values[p.kind];
        const group = groupFor(p, "restart");
        const set = spliceFor(p, value);
        const changed = mustText(yield* doSet(group, p.located.text, p.file, targetSetting(p, "restart"), value));

        if (set !== "same") {
          expect(
            changed.startsWith(set.pre) && changed.endsWith(set.post),
            `${label}: only the value is replaced`,
          ).toBe(true);
        }

        const read = yield* readBack(p, "restart", p.file === "repo" ? { repo: changed } : { user: changed });

        expect(plain(read.value), `${label}: a start reads the new value`).toEqual(plain(value));

        const gone = mustText(yield* doRemove(group, p.located.text, p.file, targetSetting(p, "restart")));

        expect(gone, `${label}: the bad key goes`).toBe(removed(p));

        const fallback = yield* readBack(p, "restart", p.file === "repo" ? { repo: gone } : { user: gone });

        expect(plain(fallback.value), `${label}: a start reads the default`).toEqual(plain(FALLBACK[p.kind]));
      }

      expect(own).toHaveLength(4);
      reach.mark("q");
      reach.done();
    }),
  check,
);

// ---------------------------------------------------------------------------------------------
// E8, text that is not TOML
// ---------------------------------------------------------------------------------------------

// Plant: (r) report line 1 for every syntax fault: red.
it.effect.prop(
  "E8 text that is not TOML fails syntax with the file and the parser's line, for set and remove",
  Draw.fields,
  (draw) =>
    Effect.gen(function* () {
      const reach = new Reach<Id>(["r"]);

      for (const scene of broken(draw)) {
        for (const found of [
          yield* doSet(scene.group, scene.text, scene.file, scene.target, draw.values.port),
          yield* doRemove(scene.group, scene.text, scene.file, scene.target),
        ]) {
          expect(found._tag).toBe("error");

          if (found._tag === "error") {
            expect(found.reason).toBe("syntax");
            expect(found.file).toBe(fileName(scene.app, scene.file));
            expect(found.line, "the line the text breaks on").toBe(scene.line);
          }
        }

        reach.mark("r");
      }

      reach.done();
    }),
  check,
);

// ---------------------------------------------------------------------------------------------
// E10, no change gives the same text
// ---------------------------------------------------------------------------------------------

// Plants: (m) always splice the new value's text, so `'x'` becomes `"x"` and `1.0` becomes `1`: red; (t) fail `unknown`
// when the removed key is absent: red.
it.effect.prop(
  "E10 no change gives the same text: the value the file holds, or a key it lacks, answers the input byte for byte",
  Draw.fields,
  (draw) =>
    Effect.gen(function* () {
      const reach = new Reach<Id>(["m", "t"]);

      for (const p of unchanged(draw)) {
        const label = `${p.kind} ${p.located.text.split("\n")[1] ?? ""}`;
        // The file holds the value the set asks for, spelled by the fixture writer, not by the format.
        const found = yield* doSet(groupFor(p), p.located.text, p.file, targetSetting(p), p.old);

        expect(mustText(found), label).toBe(p.located.text);
        reach.mark("m");
      }

      for (const p of positions(draw)) {
        if (p.located.value !== undefined) {
          continue;
        }

        const found = yield* doRemove(groupFor(p), p.located.text, p.file, targetSetting(p));

        expect(mustText(found), `${p.ids.join("")} ${p.names.path.join(".")}`).toBe(p.located.text);
        reach.mark("t");
      }

      reach.done();
    }),
  check,
);

// ---------------------------------------------------------------------------------------------
// S1 [secrets], values stay out
// ---------------------------------------------------------------------------------------------

// Plants: (x) name the refused value in the `invalid` message: red; (x) keep the `SchemaError` as the cause: red.
it.effect.prop(
  "S1 [secrets] values stay out: a secret-looking value never appears in an edit's error message or cause, for every refusal",
  Draw.fields,
  (draw) =>
    Effect.gen(function* () {
      const reach = new Reach<Id>(["x"]);

      const reasons: Record<string, string> = {
        scope: "scope",
        invalid: "invalid",
        refused: "invalid",
        other: "invalid",
        unknown: "unknown",
        version: "invalid",
      };

      for (const scene of hiding(draw)) {
        const asked = yield* doSet(scene.group, scene.text, scene.file, scene.target, scene.value);

        expect(asked._tag, `${scene.name}: a set is refused`).toBe("error");

        if (asked._tag === "error") {
          expect(asked.reason, scene.name).toBe(reasons[scene.name]);
        }

        // A remove may refuse as well: either way, no secret is printed.
        for (const found of [asked, yield* doRemove(scene.group, scene.text, scene.file, scene.target)]) {
          if (found._tag === "error") {
            for (const form of forms(draw.secret)) {
              expect(found.printed.includes(form), `${scene.name}: ${found.reason} holds the secret as ${form}`).toBe(
                false,
              );
            }
          }
        }

        reach.mark("x");
      }

      reach.done();
    }),
  check,
);
