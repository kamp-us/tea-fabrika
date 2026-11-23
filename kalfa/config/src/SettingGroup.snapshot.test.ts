// Ticket 1845, kalfa/config (new work), slice 1: SN1 to SN5 of the approved plan (.kalfa/quests/kalfa-config-nofiles-PLAN.md),
// for `SettingGroup.snapshots` and the strict read behind it (internal/snapshot.ts). The type laws SN11 and T5 are in
// SettingGroup.types.test.ts. Written before the code.
//
// What the code does, as these laws hold it to (the plan's "The shape"):
// - `SettingGroup.snapshots(group)` is a stream of snapshots of the files as last taken: the one now, then one each time a
//   change to a file is taken and the snapshot says something new (a different hash, or different origins). A refused
//   change gives none. A snapshot is plain JSON: the app, every value of the group (the quiet window included for a group
//   with a live setting) as its schema encodes it, each origin, and a SHA-256 of the values.
// - `read(group, input, closing)` reads one strictly, and stops at the first fault with one `SettingsError` of reason
//   `snapshot`, no file and no line, a message from the plan's table and the closing sentence it was given.
// - `fits(app, setting, origin)` is the origin rule: whether a start of the app could give the setting that origin.
//
// The oracle of SN1 and SN2 is a start of the same group on the same files: what a snapshot says must be what a start
// gives. Every start runs on a live disk in memory (MemoryFiles.test-support.ts), and time is Effect's `TestClock`.
import { expect, it } from "@effect/vitest";
import { runsFor } from "@kampus/vitest";
import { Effect, Exit, Option, Schema } from "effect";
import { fits } from "./internal/snapshot.ts";
import {
  boot,
  builds,
  CHANGES,
  candidates,
  close,
  flipped,
  GUARDS,
  kinds,
  guarded,
  hashed,
  KNOWN_HASH,
  KNOWN_VALUES,
  ORDERS,
  ordered,
  older,
  OldSnapshotError,
  reversed,
  Tree,
  collect,
  Declaration,
  Draw,
  firstItem,
  flush,
  forms,
  HiddenDraw,
  hiding,
  INTENT,
  loaded,
  misfits,
  MISFITS,
  alike,
  apply,
  effect,
  initial,
  model,
  named,
  pick,
  siteFor,
  READS,
  Reach,
  type Read,
  readGroup,
  readItem,
  refusal,
  render,
  richScene,
  sceneFor,
  sceneOn,
  script,
  settingFor,
  takeFirst,
  running,
  variable,
  type Change,
  type Guard,
  type Order,
  type Misfit,
} from "./SettingGroup.snapshot.test-support.ts";

const check = { arbitrary: { runs: runsFor({ fast: 25, full: 100 }), size: 100 } };

const field = (name: string) =>
  (name.split(".").at(-1) ?? name).replace(/-([a-z0-9])/gu, (_, letter: string) => letter.toUpperCase());

const WINDOW = "config.watch.debounce";

const through = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Json));

// ---------------------------------------------------------------------------------------------
// SN1, a snapshot reads back
// ---------------------------------------------------------------------------------------------

// Plants: (a) leave the window out of `make`: a group with a live setting is refused at step 3, red; (b) write a
// `$<APP>_HOME` file origin as its `~` name in `make`: the origin changes, red; (c) normalize `\r\n` to `\n`, or trim a
// final line break, when a text is encoded: red.
it.effect.prop(
  "SN1 a snapshot reads back: the first item of `snapshots(group)`, read strictly, gives exactly the values and the origins a start gives, each text byte for byte",
  { draw: Draw },
  ({ draw }) =>
    Effect.gen(function* () {
      const reach = new Reach<Read>(READS);

      for (const one of loaded(draw)) {
        const rig = yield* boot(one.scene);
        const item = yield* firstItem(rig);
        const start = yield* running(rig);
        const names = readGroup(rig.group).settings.map((setting) => setting.name);
        const closing = `${rig.app} did not start.`;

        expect(item.app, `${one.id}: the snapshot names its app`).toBe(rig.app);
        expect(Object.keys(item.values), `${one.id}: every name of the group, the window included`).toEqual(names);
        expect(Object.keys(item.origins), `${one.id}: every origin, in the group's order`).toEqual(names);

        // The snapshot is plain JSON: carried as text, it reads the same.
        for (const [style, input] of [
          ["as it is", item],
          ["through JSON", through(JSON.stringify(item))],
        ] as const) {
          const settled = yield* readItem(rig.group, input, closing);

          expect(
            settled.map((entry) => entry.setting.name),
            `${one.id} ${style}: the group's own order`,
          ).toEqual(names);

          for (const { setting, value, origin } of settled) {
            expect(origin, `${one.id} ${style}: ${setting.name}'s origin is the start's`).toEqual(
              start.origins[setting.name],
            );

            // The quiet window is the package's own setting: no field of the program's values holds it.
            if (setting.name !== WINDOW) {
              expect(value, `${one.id} ${style}: ${setting.name}'s value is the start's`).toEqual(
                start.values[field(setting.name)],
              );
            }
          }

          for (const [name, text] of one.texts) {
            expect(settled.find((entry) => entry.setting.name === name)?.value, `${one.id} ${style}: the text`).toBe(
              text,
            );
          }
        }

        for (const [name, want] of Object.entries(one.origins)) {
          const origin = item.origins[name];

          expect(origin?._tag, `${one.id}: ${name}'s origin is of its source`).toBe(want.tag);

          if (want.file !== undefined) {
            expect(origin?._tag === "file" ? origin.file : undefined, `${one.id}: the file as a person reads it`).toBe(
              want.file,
            );
          }
        }

        // `siteFor` names a file as a person reads it: a moved user file is `$<APP>_HOME/<app>.toml`.
        if (one.id === "home") {
          const origin = item.origins[Object.keys(one.origins)[0] ?? ""];

          expect(origin?._tag === "file" ? origin.file : undefined).toBe(siteFor(rig.app, true).user.name);
        }

        yield* close(rig);
        reach.mark(one.id);
      }

      reach.done();
    }),
  check,
);

// ---------------------------------------------------------------------------------------------
// SN2, the stream follows the taken files
// ---------------------------------------------------------------------------------------------

// Plants: (d) give the first item only: red; (e) make each snapshot from the running values: a restart change never
// sstyles, red; (f) call two snapshots the same when their hashes are equal: an origin-only change gives no item, red; (g)
// give an item for every taken change: a change that moves nothing repeats one, red; (h) set `taken` before the change
// is checked: a refused change gives an item, red.
it.effect.prop(
  "SN2 the stream follows the taken files: the first item, then one for each taken change whose snapshot says something new, each the snapshot of a start on the same files",
  { draw: Draw },
  ({ draw }) =>
    Effect.gen(function* () {
      const reach = new Reach<Change>(CHANGES);
      const site = siteFor(draw.app, false);

      let layouts = initial(draw);
      let taken = { repo: render(draw, "repo", layouts.repo), user: render(draw, "user", layouts.user) };

      const rig = yield* boot(sceneFor(draw, layouts));
      const items = yield* collect(rig);
      const first = (yield* takeFirst(sceneOn(draw, taken))).item;

      expect(items, "the first item is the snapshot of a start on these files").toEqual([first]);

      const wanted = [first];
      let before = first;

      for (const step of script(draw)) {
        const made = apply(draw, layouts, step);
        layouts = made.layouts;

        yield* rig.disk.write(site[made.file].path, made.text);
        yield* flush(rig);

        // The follower reads only the file that changed: the other one is as it was last taken.
        const candidate = { ...taken, [made.file]: made.text };
        const fresh = yield* Effect.option(takeFirst(sceneOn(draw, candidate)));
        const after = Option.map(fresh, (result) => result.item);

        expect(effect(draw, before, Option.getOrUndefined(after)), `a change of class ${step.change}`).toBe(
          INTENT[step.change],
        );

        if (Option.isSome(after)) {
          taken = candidate;

          if (!alike(before, after.value)) {
            wanted.push(after.value);
            before = after.value;
          }
        }

        expect(items, `after a change of class ${step.change}`).toEqual(wanted);
        reach.mark(step.change);
      }

      yield* close(rig);
      reach.done();
    }),
  check,
);

// ---------------------------------------------------------------------------------------------
// SN3, the strict read refuses what does not fit
// ---------------------------------------------------------------------------------------------

const closings = (app: string) => [`${app} did not start.`, `${app} keeps the last good values.`] as const;

// Plants: (m) decode the envelope without refusing excess keys: an extra top-level key passes, red; (n) delete the app
// check: red; (o) check the names of `values` only: a missing origin passes, red; (p) delete the `fits` step: red; (q)
// decode values as `Schema.Json`, not by their codec: red; (r) decode values without refusing excess keys: red; (s)
// delete the hash compare: red; (t) build the value codec from the snapshot's names, not the group's: one more setting
// passes, red.
it.effect.prop(
  "SN3 the strict read refuses what does not fit: one SettingsError of reason snapshot, no file and no line, the step's message and the closing it was given, and the same snapshot unchanged reads",
  { draw: Draw },
  ({ draw }) =>
    Effect.gen(function* () {
      const reach = new Reach<Misfit>(MISFITS);
      const rig = yield* boot(richScene(draw));
      const item = yield* firstItem(rig);
      const built = yield* builds(draw);
      const [first, later] = closings(draw.app);
      const closing = pick(draw, 11) % 2 === 0 ? first : later;

      // The loader's own snapshot reads, with either closing.
      yield* readItem(rig.group, item, closing);

      for (const one of yield* misfits(draw, item, built)) {
        const found = refusal(yield* Effect.exit(readItem(rig.group, one.input, closing)));

        expect(found.reason, `${one.id} ${one.label}`).toBe("snapshot");
        expect(found.file, `${one.id} ${one.label}: no file`).toBeUndefined();
        expect(found.line, `${one.id} ${one.label}: no line`).toBeUndefined();
        expect(found.message, `${one.id} ${one.label}`).toBe(`${one.message}\n  ${closing}`);
        reach.mark(one.id);
      }

      yield* close(rig);
      reach.done();
    }),
  check,
);

// ---------------------------------------------------------------------------------------------
// SN4, the origin rule
// ---------------------------------------------------------------------------------------------

// Plants: (p) accept any relative file name, as the old read does: another app's file fits, red; (p) let a variable fit
// a file-only setting: red; (p) let the default fit a required setting: red.
it.effect.prop(
  "SN4 the origin rule: an origin fits a setting exactly when a start of the app could give it: the default only with a default, a flag or a variable only when not file-only and by the setting's own name, a file only by a name of a file in the setting's scope",
  { draw: Draw, declaration: Declaration },
  ({ draw, declaration }) =>
    Effect.sync(() => {
      const setting = settingFor(draw, declaration);
      let yes = 0;
      let no = 0;

      for (const origin of candidates(draw, draw.words)) {
        const want = model(draw, declaration, origin);

        expect(fits(draw.app, setting, origin), JSON.stringify(origin)).toBe(want);

        if (want) {
          yes++;
        } else {
          no++;
        }
      }

      // The rule is asked about origins it accepts and origins it refuses, so a rule that says one answer fails.
      expect(yes, "some origin fits").toBeGreaterThan(0);
      expect(no, "some origin does not fit").toBeGreaterThan(0);
      expect(variable(draw.app, named(draw.a)).startsWith(draw.app.toUpperCase())).toBe(true);
    }),
  check,
);

// ---------------------------------------------------------------------------------------------
// SN5 [secrets], a refused snapshot keeps its values out
// ---------------------------------------------------------------------------------------------

const STEPS = ["1", "2", "3", "4", "5", "6"] as const;

const SAYS: Readonly<Record<number, string>> = {
  1: "this is not a snapshot.",
  2: "the snapshot is another app's.",
  3: "does not hold",
  4: "the snapshot gives it an origin",
  5: "the snapshot's value is refused by its schema.",
  6: "the snapshot's hash does not match its values.",
};

// Plants: (x) put the decoder's issue in `cause` unredacted: red; (x) name the extra key in the step 3 message: red.
it.effect.prop(
  "SN5 [secrets] a refused snapshot keeps its values out: a secret in a snapshot refused at each step never appears in the error's message, its cause or its printed trace, raw, escaped or encoded",
  { input: HiddenDraw },
  ({ input: { draw, secret } }) =>
    Effect.gen(function* () {
      const reach = new Reach<string>(STEPS);
      const rig = yield* boot(richScene(draw));
      const item = yield* firstItem(rig);
      const [closing] = closings(draw.app);

      for (const one of yield* hiding(draw, item, secret)) {
        const found = refusal(yield* Effect.exit(readItem(rig.group, one.input, closing)));

        expect(found.reason, `${one.label}`).toBe("snapshot");
        // The secret sits where its step refuses it, so the message is that step's.
        expect(found.message, `${one.label}: refused at step ${one.step}`).toContain(SAYS[one.step] ?? "");

        for (const form of forms(secret)) {
          expect(found.printed, `${one.label}: the failure holds no ${form}`).not.toContain(form);
        }

        reach.mark(String(one.step));
      }

      yield* close(rig);
      reach.done();
    }),
  check,
);

// ---------------------------------------------------------------------------------------------
// SN13, the hash does not depend on the order of keys
// ---------------------------------------------------------------------------------------------

// Plants: sort the keys of the top level only: a nested object in another order has another hash, red; sort no keys at all:
// red; (old read) compare the saved hash with itself in `Snapshot.read`: a changed value reads, red.
it.effect.prop(
  "SN13 the hash of the values is one for any order of keys at any depth, it is not one for other values, and a known set of values has the hash written out here; the older read agrees",
  { draw: Draw, values: Schema.Record(Schema.String, Schema.Json), tree: Tree },
  ({ draw, values, tree }) =>
    Effect.gen(function* () {
      const sum = yield* hashed(values);

      expect(yield* hashed(flipped(values)), "the keys in the opposite order").toBe(sum);
      expect(yield* hashed({ ...values, [`Extra ${draw.app}`]: 1 }), "one more value").not.toBe(sum);

      // The known values are spelled in no order, and their hash was made outside this package.
      expect(yield* hashed(KNOWN_VALUES)).toBe(KNOWN_HASH);
      expect(yield* hashed(flipped(KNOWN_VALUES))).toBe(KNOWN_HASH);

      // The older read makes its hash the same way: keys of a value in another order read, and another value does not.
      const made = yield* older(draw, tree);
      const saved = made.snapshot.values[made.path];

      const again = yield* made
        .read({ ...made.snapshot, values: { [made.path]: reversed(saved ?? null) } })
        .pipe(Effect.map((read) => read.snapshot.hash));

      expect(again, "the older read of the same values in another key order").toBe(made.snapshot.hash);

      // Another value of the same shape: a key less, or a key more when it has none.
      const other = Object.fromEntries(Object.entries(tree).slice(1));
      const another = Object.keys(tree).length === 0 ? { zzzz: {} } : other;
      const changed = yield* Effect.exit(made.read({ ...made.snapshot, values: { [made.path]: another } }));

      expect(Exit.isFailure(changed), "the older read of other values").toBe(true);

      if (Exit.isFailure(changed)) {
        expect(
          changed.cause.reasons.some((reason) => reason._tag === "Fail" && Schema.is(OldSnapshotError)(reason.error)),
        ).toBe(true);
      }
    }),
  check,
);

// ---------------------------------------------------------------------------------------------
// SN14, the two guards a value can reach in the read
// ---------------------------------------------------------------------------------------------

// Plants: delete the guard that dies on a value that is not plain data: a cast schema's `Date` is read, red; skip the
// encode of the value again: a value whose encoded form the schema refuses is read, red.
it.effect.prop(
  "SN14 the read dies on a value that is not plain data (a cast schema), and refuses a value whose encoded form its schema refuses, with step 5's message",
  { draw: Draw },
  ({ draw }) =>
    Effect.gen(function* () {
      const reach = new Reach<Guard>(GUARDS);
      const [closing] = closings(draw.app);

      const found = yield* guarded(draw);

      // The author's bug: a defect, never a refusal a person could fix.
      for (const one of found.filter((candidate) => candidate.id === "cast")) {
        expect(kinds(yield* Effect.exit(readItem(one.group, one.input, closing))), "a cast schema").toEqual(["Die"]);
        reach.mark(one.id);
      }

      for (const one of found.filter((candidate) => candidate.id === "encode")) {
        const refused = refusal(yield* Effect.exit(readItem(one.group, one.input, closing)));

        expect(refused.reason).toBe("snapshot");
        expect(refused.message).toBe(`${one.name}: the snapshot's value is refused by its schema.\n  ${closing}`);

        // The control: the same schema reads a value whose decoded form it also encodes.
        const fine = yield* readItem(one.group, one.fine, closing);

        expect(fine.map((entry) => entry.value)).toEqual(["ab!"]);
        reach.mark(one.id);
      }

      reach.done();
    }),
  check,
);

// ---------------------------------------------------------------------------------------------
// SN15, every origin is checked before any value
// ---------------------------------------------------------------------------------------------

// Plant: check each origin right before its own value: a value refused at an earlier setting speaks first, red.
it.effect.prop(
  "SN15 every origin is checked before any value: a snapshot with an origin no start gives and a refused value, at the same setting or another, gets the origin's message",
  { draw: Draw },
  ({ draw }) =>
    Effect.gen(function* () {
      const reach = new Reach<Order>(ORDERS);
      const rig = yield* boot(richScene(draw));
      const item = yield* firstItem(rig);
      const [closing] = closings(draw.app);

      for (const one of yield* ordered(draw, item)) {
        const found = refusal(yield* Effect.exit(readItem(rig.group, one.input, closing)));

        expect(found.reason, one.label).toBe("snapshot");
        expect(found.message, one.label).toBe(`${one.message}\n  ${closing}`);
        reach.mark(one.id);
      }

      yield* close(rig);
      reach.done();
    }),
  check,
);
