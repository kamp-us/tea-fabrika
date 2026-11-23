// Ticket 1843, slice 3, kalfa/config (new work): D1 to D10 of the approved plan (.kalfa/quests/kalfa-config-edit-PLAN.md,
// with its Amendment 1), for the disk calls `SettingGroup.set` and `SettingGroup.remove` (SettingGroup.ts), read through
// the package's root entry (index.ts). Written before the code. R2 is in SettingGroup.disk.integration.test.ts, the type
// laws T5 and T9 in SettingGroup.types.test.ts.
//
// What a disk call does, as these laws hold it to (the plan's "Slice 3: the disk half"):
// - `SettingGroup.set(group, setting, value, file, { repo })` and `SettingGroup.remove(group, setting, file, { repo })`
//   each answer an `Effect<void, SettingsError, FileSystem | Path>`. The file is found as the start finds it: the repo's
//   at `<repo>/.<app>/<app>.toml`, the user's at `$<APP>_HOME/<app>.toml`, else `$HOME/.<app>/<app>.toml`.
// - The text is the slice 2 edit's answer for the file's old text. It is written the way git writes its config: a link
//   is followed to its target, `<file>.lock` is made with the exclusive `"wx"` flag (a lock already there fails `write`),
//   the new text goes into the lock, and one rename puts the lock over the file. The file's own path is never written.
// - A set makes the app's own folder when it is missing, and a missing parent of that folder is a `write` error. A remove
//   of a file or folder that is not there succeeds and writes nothing.
// - A refused edit, an edit that changes nothing and a failed write leave the file as it was and no lock behind. A
//   refused read is `read`, and a refused lock, write or rename is `write`; neither names the file's text.
// - Each call ends one span, `config.set` or `config.remove`, with the app, the setting's name, the file and whether the
//   text changed, and never a value or the file's text.
//
// Every law is a property over generated typed files (slice 2's SettingGroup.edit.test-support.ts) and what the disk
// holds (SettingGroup.disk.test-support.ts, the plan's classes (u), (v) and (w)): each class is built from the drawn
// seeds in every run, a law keeps the ids it reached, and it fails when one is missing. The disk is the stand-in in
// MemoryFiles.test-support.ts, watched with `Recorder`; R2 checks the stand-in against a real folder. Each law names its
// plant: break one thing in the code, run the law, see it red, undo it.
import { expect, it } from "@effect/vitest";
import { Recorder, runsFor } from "@kampus/vitest";
import { ConfigProvider, Effect, FileSystem, Layer, Logger, Path, References, Tracer } from "effect";
import { type Setting, SettingGroup } from "./index.ts";
import * as MemoryFiles from "./MemoryFiles.test-support.ts";
import {
  accepted,
  Answer,
  answer,
  createRefused,
  DiskDraw,
  dotfile,
  names,
  placeFor,
  readRefused,
  renameRefused,
  ROOT,
  seedFor,
  type Place,
  siteFor,
  type Site,
  writeRefused,
} from "./SettingGroup.disk.test-support.ts";
import {
  broken,
  doRemove,
  doSet,
  type Draws,
  faulty,
  flat,
  forms,
  groupFor,
  hiding,
  mustText,
  type Position,
  positions,
  Reach,
  refused,
  scoped,
  spliceFor,
  targetSetting,
  unchanged,
  valued,
  valuesFor,
} from "./SettingGroup.edit.test-support.ts";

// 100 full runs took 16 to 22 s of CI's 60 s limit for each of this file's slowest laws (a draw builds a whole file, and a run reads and edits it several times),
// so the full count is 35: each run still draws every class, and `reach` still fails a law that misses one.
const check = { arbitrary: { runs: runsFor({ fast: 25, full: 35 }), size: 100 } };

// ---------------------------------------------------------------------------------------------
// The harness: one disk call on a disk in memory, watched.
// ---------------------------------------------------------------------------------------------

type Group = ReturnType<typeof groupFor>;

interface Scene {
  readonly group: Group;
  readonly setting: Setting.Any;
  readonly place: Place;
  readonly seed: MemoryFiles.Seed;
  /** The environment cannot be read: its provider fails, as a source that is down does. */
  readonly unreadable?: boolean;
  readonly op: { readonly kind: "set"; readonly value: unknown } | { readonly kind: "remove" };
}

interface State {
  readonly files: Readonly<Record<string, string>>;
  readonly folders: ReadonlyArray<string>;
  readonly links: Readonly<Record<string, string>>;
}

/** What one call left: its answer, the calls the file system saw, the disk before and after, the spans and the log lines. */
const run = (scene: Scene) => {
  const disk = MemoryFiles.writable(scene.seed);
  const spans: Array<Tracer.NativeSpan> = [];
  const logs: Array<string> = [];

  const tracer = Tracer.make({
    span: (options) => {
      const span = new Tracer.NativeSpan(options);
      spans.push(span);

      return span;
    },
  });

  const logger = Logger.map(Logger.formatStructured, (entry) => {
    logs.push(JSON.stringify(entry));
  });

  const options = { repo: ROOT };
  const { op, place, group, setting } = scene;

  const call =
    op.kind === "set"
      ? SettingGroup.set(group, setting, op.value, place.file, options)
      : SettingGroup.remove(group, setting, place.file, options);

  const state = Effect.gen(function* (): Effect.fn.Return<State> {
    return { files: yield* disk.files, folders: yield* disk.folders, links: yield* disk.links };
  });

  return Effect.gen(function* () {
    const before = yield* state;
    const exit = yield* Effect.exit(call);
    const calls = yield* Recorder.calls(FileSystem.FileSystem);
    const after = yield* state;

    return { answer: answer(exit), calls, before, after, spans, logs };
  }).pipe(
    Effect.provide(
      Layer.mergeAll(
        Recorder.layer(FileSystem.FileSystem, disk.fileSystem),
        Path.layer,
        ConfigProvider.layer(
          scene.unreadable === true
            ? ConfigProvider.make(() => Effect.fail(new ConfigProvider.SourceError({ message: "refused" })))
            : ConfigProvider.fromEnv({ env: { ...place.env } }),
        ),
      ),
    ),
    Effect.provide(Logger.layer([logger])),
    Effect.provideService(References.MinimumLogLevel, "All"),
    Effect.provideService(Tracer.Tracer, tracer),
  );
};

type Seen = Effect.Success<ReturnType<typeof run>>;

type Call = Seen["calls"][number];

const renames = (calls: ReadonlyArray<Call>) => calls.flatMap((c) => (c.method === "rename" ? [c.args] : []));

/** Every write of text to `path`: a write with any flag. */
const writes = (calls: ReadonlyArray<Call>, path: string) =>
  calls.flatMap((c) =>
    (c.method === "writeFileString" || c.method === "writeFile") && c.args[0] === path ? [c.args] : [],
  );

const done = Answer.cases.done.make({});

/** The disk is as it was: no file, folder or link added, changed or taken away, and no lock left. */
const asWas = (found: Seen, label: string) => {
  expect(found.after.files, `${label}: the files are as they were`).toEqual(found.before.files);
  expect(found.after.folders, `${label}: the folders are as they were`).toEqual(found.before.folders);
  expect(found.after.links, `${label}: the links are as they were`).toEqual(found.before.links);
  expect(renames(found.calls), `${label}: nothing is renamed`).toEqual([]);
};

const held = (draw: DiskDraw, text: string) => ({ text, dots: draw.disk.dots, lock: draw.disk.lock });

const place = (draw: DiskDraw, p: { readonly app: string }, file: Setting.File, n: number, site?: Site) =>
  placeFor(p.app, site ?? siteFor(draw, file, n), draw.disk.moved);

const label = (p: Position, at: Place, extra = "") =>
  `${p.ids.join("")} ${p.names.path.join(".")} ${p.mode} in ${at.site}${extra === "" ? "" : ` ${extra}`}`;

/** The places a key sits and the values each is set to, for one draw. */
const cases = (draw: Draws) =>
  [...positions(draw), ...valued(draw)].flatMap((p) => valuesFor(draw, p).map((value) => ({ p, value })));

/** The sets that change the text, each with the text a set must leave. */
const changing = (draw: Draws) =>
  cases(draw).flatMap(({ p, value }) => {
    const splice = spliceFor(p, value);

    return splice === "same" ? [] : [{ p, value }];
  });

const USER_PLACES = ["u:demo-home", "u:home"] as const;

// ---------------------------------------------------------------------------------------------
// D1, on disk is the edit and one write
// ---------------------------------------------------------------------------------------------

// Plant, run once and never kept: find the user file from `HOME` before `$DEMO_HOME` (in internal/disk.ts, or in
// internal/place.ts where it picks the user's path): a user file at `$DEMO_HOME` is not found, so the set writes a
// second file under `HOME` and the file at `$DEMO_HOME` is as it was, red.
it.effect.prop(
  "D1 on disk is the edit and one write: a set and a remove leave the file holding what the in-memory edit answers, for the repo file and the user file in both homes",
  DiskDraw.fields,
  (draw) =>
    Effect.gen(function* () {
      const reach = new Reach<string>(["u:repo", ...USER_PLACES, "v:file"]);

      for (const [n, { p, value }] of cases(draw).entries()) {
        const at = place(draw, p, p.file, n);
        const group = groupFor(p);
        const setting = targetSetting(p);
        const wanted = mustText(yield* doSet(group, p.located.text, p.file, setting, value));
        const seed = seedFor(at, "file", held(draw, p.located.text));
        const found = yield* run({ group, setting, place: at, seed, op: { kind: "set", value } });

        expect(found.answer, label(p, at)).toEqual(done);
        expect(found.after.files, `${label(p, at)}: only the file is there, holding the edit's text`).toEqual({
          [at.path ?? ""]: wanted,
        });
        expect(found.after.folders, `${label(p, at)}: no folder is made`).toEqual(found.before.folders);
        reach.mark(`u:${at.site}`, "v:file");
      }

      for (const [n, p] of positions(draw).entries()) {
        const at = place(draw, p, p.file, n + 1);
        const group = groupFor(p);
        const setting = targetSetting(p);
        const wanted = mustText(yield* doRemove(group, p.located.text, p.file, setting));
        const seed = seedFor(at, "file", held(draw, p.located.text));
        const found = yield* run({ group, setting, place: at, seed, op: { kind: "remove" } });

        expect(found.answer, label(p, at, "remove")).toEqual(done);
        expect(found.after.files, `${label(p, at, "remove")}: only the file is there, holding the edit's text`).toEqual(
          {
            [at.path ?? ""]: wanted,
          },
        );
        reach.mark(`u:${at.site}`);
      }

      reach.done();
    }),
  check,
);

// ---------------------------------------------------------------------------------------------
// D2, a refused edit writes nothing
// ---------------------------------------------------------------------------------------------

// Plants: rename the lock over the file even when the edit refused, writing the old text back (in internal/disk.ts, after
// the edit fails, write the old text into the lock and rename it): a rename is recorded, red. Make the app's own folder
// before the edit is checked and leave it when the edit refuses: a set into a repo with no `.<app>/` folder leaves one
// behind, red. Check a remove's scope only after the lock is made: a remove of a user-only key from a file whose folder
// is missing succeeds, red.
it.effect.prop(
  "D2 a refused edit writes nothing: each refusal of the in-memory edit fails the same way on disk, the file is as it was, no rename is recorded, no lock is left, and a folder the call made is gone while one that was there stays",
  DiskDraw.fields,
  (draw) =>
    Effect.gen(function* () {
      const reach = new Reach<string>(["u:repo", ...USER_PLACES, "v:file", "v:no-file", "v:no-folder", "v:no-parent"]);
      const port = draw.values.port;

      // A refusal that needs no text (a file scope, a value) is also tried with no file, no folder and no parent.
      const scenes = [
        ...scoped(draw).map((s) => ({ ...s, value: port, removes: true, bare: true })),
        ...refused(draw).map((s) => ({ ...s, removes: false, bare: true })),
        ...faulty(draw).map((s) => ({ ...s, value: port, removes: true, bare: false })),
        ...flat(draw).map((s) => ({ ...s, removes: true, bare: false })),
        ...broken(draw).map((s) => ({ ...s, value: port, removes: true, bare: false })),
      ];

      for (const [n, s] of scenes.entries()) {
        const at = placeFor(s.app, siteFor(draw, s.file, n), draw.disk.moved);

        for (const state of s.bare ? (["file", "no-file", "no-folder", "no-parent"] as const) : (["file"] as const)) {
          const seed = seedFor(at, state, held(draw, s.text));
          const text = state === "file" ? s.text : "";
          const named = `${s.target.name} in ${at.site} ${state}`;

          const set = yield* run({
            group: s.group,
            setting: s.target,
            place: at,
            seed,
            op: { kind: "set", value: s.value },
          });

          const pure = yield* doSet(s.group, text, s.file, s.target, s.value);

          expect(pure._tag, `${named}: the in-memory edit refuses`).toBe("error");
          expect(set.answer._tag, `${named}: the disk call refuses`).toBe("failed");

          // With the folder's parent missing the call may fail on the folder first: it fails, and writes nothing.
          if (pure._tag === "error" && set.answer._tag === "failed" && state !== "no-parent") {
            expect(names(set.answer, at.name), `${named}: it names the file`).toBe(true);

            // A `$DEMO_HOME` that is not there is refused as a place, before the edit.
            if (!(state === "no-folder" && at.site === "demo-home")) {
              expect(set.answer.reason, `${named}: the edit's reason`).toBe(pure.reason);
              expect(set.answer.line, `${named}: the edit's line`).toBe(pure.line);
            }
          }

          // The files, the folders and the links are as they were: a folder this call made is gone.
          asWas(set, named);

          if (s.removes) {
            const remove = yield* run({ group: s.group, setting: s.target, place: at, seed, op: { kind: "remove" } });
            const pureRemove = yield* doRemove(s.group, text, s.file, s.target);

            expect(pureRemove._tag, `${named}: the in-memory remove refuses`).toBe("error");
            expect(remove.answer._tag, `${named}: the disk remove refuses, whatever the disk holds`).toBe("failed");

            if (pureRemove._tag === "error" && remove.answer._tag === "failed") {
              expect(remove.answer.reason, `${named}: the remove's reason`).toBe(pureRemove.reason);
              expect(remove.answer.line, `${named}: the remove's line`).toBe(pureRemove.line);
            }

            asWas(remove, `${named} remove`);
          }

          reach.mark(`v:${state}`);
        }

        reach.mark(`u:${at.site}`);
      }

      reach.done();
    }),
  check,
);

// ---------------------------------------------------------------------------------------------
// D3, the lock
// ---------------------------------------------------------------------------------------------

// Plants: (v) remove the lock on failure even when another writer made it (in internal/disk.ts, release the lock whether
// or not this call took it): the held lock is gone, red; (v) write with no lock, so a held lock does not stop the call
// (take the lock with a plain write, or skip it): the call goes on, red.
it.effect.prop(
  "D3 the lock: with the lock already beside the file, a set and a remove fail `write` naming the lock, the file is unchanged, and the lock is still there with its own text",
  DiskDraw.fields,
  (draw) =>
    Effect.gen(function* () {
      const reach = new Reach<string>(["u:repo", ...USER_PLACES, "v:lock", "v:file", "v:no-file"]);

      for (const [n, p] of positions(draw).entries()) {
        const at = place(draw, p, p.file, n);
        const path = at.path ?? "";
        const group = groupFor(p);
        const setting = targetSetting(p);
        const value = valuesFor(draw, p)[0];

        // The file is there with a lock, or only the lock is there.
        const withFile = n % 2 === 0;

        const seed: MemoryFiles.Seed = withFile
          ? seedFor(at, "lock", held(draw, p.located.text))
          : { files: { [`${path}.lock`]: draw.disk.lock } };

        for (const op of [{ kind: "set", value }, { kind: "remove" }] as const) {
          const found = yield* run({ group, setting, place: at, seed, op });
          const named = label(p, at, op.kind);

          expect(found.answer._tag, `${named}: the call fails`).toBe("failed");

          if (found.answer._tag === "failed") {
            expect(found.answer.reason, `${named}: it is a write error`).toBe("write");
            expect(names(found.answer, `${at.name}.lock`), `${named}: it names the lock`).toBe(true);
          }

          asWas(found, named);
          expect(found.after.files[`${path}.lock`], `${named}: the lock keeps its own text`).toBe(draw.disk.lock);
          expect(found.after.files[path], `${named}: the file is unchanged`).toBe(
            withFile ? p.located.text : undefined,
          );
        }

        reach.mark(`u:${at.site}`, "v:lock", withFile ? "v:file" : "v:no-file");
      }

      reach.done();
    }),
  check,
);

// ---------------------------------------------------------------------------------------------
// D4, the file sees one rename
// ---------------------------------------------------------------------------------------------

// Plants: (v) write the new text into the file in place (in internal/disk.ts, write to the file's own path in place of the
// lock, and skip the rename): a write to the file's path is recorded, red; (w) leave the lock behind when the rename
// fails (do not remove the lock on failure): a lock is left, red.
// D4 is three laws of its own with all of their runs, one for each way the call can go: a run of the whole took 14.7 s in CI as one law, since
// each of its draw's changes runs the call three times on a watched disk. The success law runs it once and each fault law once, so each is a
// third of the work.
const renamedOnce = (draw: DiskDraw) =>
  Effect.gen(function* () {
    const reach = new Reach<string>(["u:repo", ...USER_PLACES, "v:file"]);

    for (const [n, { p, value }] of changing(draw).entries()) {
      const at = place(draw, p, p.file, n);
      const path = at.path ?? "";
      const group = groupFor(p);
      const setting = targetSetting(p);
      const wanted = mustText(yield* doSet(group, p.located.text, p.file, setting, value));
      const named = label(p, at);
      const op = { kind: "set", value } as const;

      const found = yield* run({
        group,
        setting,
        place: at,
        seed: seedFor(at, "file", held(draw, p.located.text)),
        op,
      });

      expect(found.answer, named).toEqual(done);
      expect(renames(found.calls), `${named}: one rename, from the lock over the file`).toEqual([
        [`${path}.lock`, path],
      ]);
      expect(writes(found.calls, path), `${named}: no write to the file's own path`).toEqual([]);
      expect(found.after.files, `${named}: the file holds the new text and no lock is left`).toEqual({
        [path]: wanted,
      });
      reach.mark(`u:${at.site}`, "v:file");
    }

    reach.done();
  });

const refusedAtLock = (id: "w:lock-write" | "w:rename") => (draw: DiskDraw) =>
  Effect.gen(function* () {
    const reach = new Reach<string>(["u:repo", ...USER_PLACES, "v:file", id]);

    for (const [n, { p, value }] of changing(draw).entries()) {
      const at = place(draw, p, p.file, n);
      const path = at.path ?? "";
      const lock = `${path}.lock`;
      const group = groupFor(p);
      const setting = targetSetting(p);
      const wanted = mustText(yield* doSet(group, p.located.text, p.file, setting, value));
      const fault = id === "w:lock-write" ? writeRefused(lock, draw.disk.write) : renameRefused(lock, draw.disk.rename);
      const base = held(draw, p.located.text);
      const op = { kind: "set", value } as const;
      const refusedAt = yield* run({ group, setting, place: at, seed: seedFor(at, "file", base, [fault]), op });
      const failing = `${label(p, at)} with ${id}`;

      expect(refusedAt.answer._tag, `${failing}: the call fails`).toBe("failed");

      if (refusedAt.answer._tag === "failed") {
        expect(refusedAt.answer.reason, `${failing}: it is a write error`).toBe("write");
        expect(names(refusedAt.answer, at.name), `${failing}: it names the file`).toBe(true);
        expect(refusedAt.answer.printed, `${failing}: it never holds the new text`).not.toContain(wanted);
      }

      expect(refusedAt.after.files, `${failing}: the file is as it was and no lock is left`).toEqual({
        [path]: p.located.text,
      });
      expect(refusedAt.after.folders, `${failing}: the folders are as they were`).toEqual(refusedAt.before.folders);
      expect(writes(refusedAt.calls, path), `${failing}: no write to the file's own path`).toEqual([]);
      reach.mark(id, `u:${at.site}`, "v:file");
    }

    reach.done();
  });

it.effect.prop(
  "D4 the file sees one rename: on success no write touches the file's own path and one rename comes from its lock",
  DiskDraw.fields,
  renamedOnce,
  check,
);

it.effect.prop(
  "D4 the file sees one rename: with the lock's write refused the call fails `write`, the file is as it was and no lock is left",
  DiskDraw.fields,
  refusedAtLock("w:lock-write"),
  check,
);

it.effect.prop(
  "D4 the file sees one rename: with the rename refused the call fails `write`, the file is as it was and no lock is left",
  DiskDraw.fields,
  refusedAtLock("w:rename"),
  check,
);

// ---------------------------------------------------------------------------------------------
// D5, a missing folder or file
// ---------------------------------------------------------------------------------------------

// Plants: skip making the folder (in internal/disk.ts, drop the `makeDirectory` call): a set into a repo with no
// `.<app>/` folder fails, red; make a `$<APP>_HOME` that is not there when its parent is: the set succeeds where it must
// fail `write`, red; leave a folder this call made when a later step fails: a folder is left, red.
it.effect.prop(
  "D5 a missing folder or file: a set makes the file and the app's own folder and no more, a missing parent of that folder fails `write`, and a remove of a missing file or folder succeeds and writes nothing",
  DiskDraw.fields,
  (draw) =>
    Effect.gen(function* () {
      const reach = new Reach<string>(["u:repo", ...USER_PLACES, "v:no-file", "v:no-folder", "v:no-parent"]);

      for (const [n, p] of valued(draw).entries()) {
        const group = groupFor(p);
        const setting = targetSetting(p);
        const value = valuesFor(draw, p)[0];
        const wanted = mustText(yield* doSet(group, "", p.file, setting, value));

        const at = place(draw, p, p.file, n);
        const path = at.path ?? "";
        const dir = at.dir ?? "";
        const lock = `${path}.lock`;

        for (const state of ["no-file", "no-folder", "no-parent"] as const) {
          const seed = seedFor(at, state, held(draw, ""));
          const named = label(p, at, state);

          // A `.<app>/` folder is made. A `$<APP>_HOME` that is not there is not, with its parent there or not, and nor is
          // a folder whose parent is not there: the call fails `write` and makes nothing.
          const made = state === "no-file" || (state === "no-folder" && at.site !== "demo-home");

          const set = yield* run({ group, setting, place: at, seed, op: { kind: "set", value } });

          if (made) {
            expect(set.answer, named).toEqual(done);
            expect(set.after.files, `${named}: the file is made with the edit's text and no lock is left`).toEqual({
              [path]: wanted,
            });
            // The one folder is made, and nothing above it.
            expect(set.after.folders, `${named}: the app's own folder is made, and no other`).toEqual(
              [...new Set([...set.before.folders, dir])].sort(),
            );
          } else {
            expect(set.answer._tag, `${named}: a missing home or parent fails`).toBe("failed");

            if (set.answer._tag === "failed") {
              expect(set.answer.reason, `${named}: it is a write error`).toBe("write");
              expect(names(set.answer, at.name), `${named}: it names the file`).toBe(true);
            }

            asWas(set, named);
          }

          // A folder this call made is gone when the call then fails: at the lock's create, its write and the rename.
          if (state === "no-folder" && made) {
            for (const fault of [
              createRefused(lock, draw.disk.create),
              writeRefused(lock, draw.disk.write),
              renameRefused(lock, draw.disk.rename),
            ]) {
              const failed = yield* run({
                group,
                setting,
                place: at,
                seed: seedFor(at, state, held(draw, ""), [fault]),
                op: { kind: "set", value },
              });

              expect(failed.answer._tag, `${named}: a refused write fails`).toBe("failed");
              const after = `${named} with a refused write`;

              expect(failed.after.folders, `${after}: the folder this call made is gone`).toEqual(
                failed.before.folders,
              );
              expect(failed.after.files, `${after}: no file or lock is left`).toEqual(failed.before.files);
            }
          }

          const remove = yield* run({ group, setting, place: at, seed, op: { kind: "remove" } });

          expect(remove.answer, `${named} remove`).toEqual(done);
          asWas(remove, `${named} remove`);
          expect(remove.after.files, `${named} remove: no file is made`).toEqual({});
          reach.mark(`v:${state}`, `u:${at.site}`);
        }
      }

      reach.done();
    }),
  check,
);

// ---------------------------------------------------------------------------------------------
// D6, no change writes nothing
// ---------------------------------------------------------------------------------------------

// Plant: rename even when the text did not change (in internal/disk.ts, drop the `next === old` early return): a rename
// is recorded, red.
it.effect.prop(
  "D6 no change writes nothing: a set of the value the file holds, or a remove of a key it lacks, renames nothing and leaves no lock",
  DiskDraw.fields,
  (draw) =>
    Effect.gen(function* () {
      const reach = new Reach<string>(["u:repo", ...USER_PLACES, "v:file"]);

      const sets = unchanged(draw).map((p) => ({ p, op: { kind: "set", value: p.old } as const }));

      const removes = positions(draw).flatMap((p) =>
        p.located.value === undefined ? [{ p, op: { kind: "remove" } as const }] : [],
      );

      for (const [n, { p, op }] of [...sets, ...removes].entries()) {
        const at = place(draw, p, p.file, n);
        const path = at.path ?? "";
        const group = groupFor(p);
        const setting = targetSetting(p);
        const named = label(p, at, op.kind);

        const pure = yield* op.kind === "set"
          ? doSet(group, p.located.text, p.file, setting, op.value)
          : doRemove(group, p.located.text, p.file, setting);

        expect(mustText(pure), `${named}: the in-memory edit changes nothing`).toBe(p.located.text);

        const found = yield* run({
          group,
          setting,
          place: at,
          seed: seedFor(at, "file", held(draw, p.located.text)),
          op,
        });

        expect(found.answer, named).toEqual(done);
        asWas(found, named);
        expect(found.after.files, `${named}: the file is the same bytes`).toEqual({ [path]: p.located.text });
        expect(writes(found.calls, path), `${named}: the file's own path is not written`).toEqual([]);
        reach.mark(`u:${at.site}`, "v:file");
      }

      reach.done();
    }),
  check,
);

// ---------------------------------------------------------------------------------------------
// D7, a link stays a link
// ---------------------------------------------------------------------------------------------

// Plant: lock and rename at the link's own path (in internal/disk.ts, skip the `realPath` call and use the file's path):
// the link becomes a plain file, red.
it.effect.prop(
  "D7 a link stays a link: when the file's path is a link the new text lands at its target, the link is never written or renamed over, and the lock sits beside the target",
  DiskDraw.fields,
  (draw) =>
    Effect.gen(function* () {
      const reach = new Reach<string>(["u:repo", ...USER_PLACES, "v:link"]);

      const sets = changing(draw).map(({ p, value }) => ({ p, op: { kind: "set", value } as const }));
      const removes = positions(draw).map((p) => ({ p, op: { kind: "remove" } as const }));

      for (const [n, { p, op }] of [...sets, ...removes].entries()) {
        const at = place(draw, p, p.file, n);
        const path = at.path ?? "";
        const target = dotfile(at, draw.disk.dots);
        const group = groupFor(p);
        const setting = targetSetting(p);
        const named = label(p, at, op.kind);

        const pure = yield* op.kind === "set"
          ? doSet(group, p.located.text, p.file, setting, op.value)
          : doRemove(group, p.located.text, p.file, setting);

        const wanted = mustText(pure);

        const found = yield* run({
          group,
          setting,
          place: at,
          seed: seedFor(at, "link", held(draw, p.located.text)),
          op,
        });

        expect(found.answer, named).toEqual(done);
        expect(found.after.links, `${named}: the link still points to its target`).toEqual({ [path]: target });
        expect(found.after.files, `${named}: the target holds the edit's text, and no lock is left`).toEqual({
          [target]: wanted,
        });

        // The link's own path and the lock beside it are never touched; the lock sits beside the target.
        expect(writes(found.calls, path), `${named}: the link is not written`).toEqual([]);
        expect(writes(found.calls, `${path}.lock`), `${named}: no lock beside the link`).toEqual([]);

        expect(
          renames(found.calls)
            .flat()
            .filter((to) => to === path || to === `${path}.lock`),
          `${named}: the link is not renamed over`,
        ).toEqual([]);

        if (wanted !== p.located.text) {
          expect(renames(found.calls), `${named}: the lock beside the target goes over the target`).toEqual([
            [`${target}.lock`, target],
          ]);
          expect(
            writes(found.calls, `${target}.lock`).length,
            `${named}: the lock beside the target is written`,
          ).toBeGreaterThan(0);
        }

        reach.mark(`u:${at.site}`, "v:link");
      }

      reach.done();
    }),
  check,
);

// ---------------------------------------------------------------------------------------------
// D8, the span
// ---------------------------------------------------------------------------------------------

/** What a span, a log line and the answer can print, as lines of text. */
const printed = (seen: Seen) => [
  ...seen.logs,
  ...seen.spans.flatMap((span) => [
    span.name,
    ...[...span.attributes.entries()].map(([key, value]) => `${key}=${String(value)}`),
    ...span.events.flatMap(([name, , attributes]) => [
      name,
      ...Object.entries(attributes).map(([key, value]) => `${key}=${String(value)}`),
    ]),
  ]),
  ...(seen.answer._tag === "failed" ? [seen.answer.printed] : []),
];

// Plants: put the new text in a span attribute (in internal/disk.ts, annotate the span with the text): the secret is in
// an attribute, red; leave `kalfa.config.changed` out of the span: red.
it.effect.prop(
  "D8 [secrets] the span: each disk call ends one span, `config.set` or `config.remove`, with the app, the setting's name, the file and whether it changed, and no attribute, event or log line holds a secret value or the file's text",
  DiskDraw.fields,
  (draw) =>
    Effect.gen(function* () {
      const reach = new Reach<string>(["u:repo", ...USER_PLACES]);
      const secret = draw.secret;

      const refusals = hiding(draw).map((h, n) => ({
        name: h.name,
        group: h.group,
        setting: h.target,
        // A refusal is about one file, the one its text and scope make it for.
        wheres: [siteFor(draw, h.file, n)],
        text: h.text,
        op: { kind: "set", value: h.value } as const,
        changed: undefined,
      }));

      // The secret accepted and written, written again as it is, and taken out. The file's own text holds it in a comment.
      const everywhere: ReadonlyArray<Site> = ["repo", "demo-home", "home"];
      const own = { ...accepted(draw), wheres: everywhere };

      const quoted = JSON.stringify(secret);
      const note = `# note ${secret}\n[${own.table}]\n`;
      const kept = `${note}secret = ${quoted}\nother = 7\n`;

      const scenes = [
        ...refusals,
        {
          ...own,
          name: "accepted",
          text: `${note}secret = "old"\nother = 7\n`,
          op: { kind: "set", value: secret } as const,
          changed: true,
        },
        { ...own, name: "same", text: kept, op: { kind: "set", value: secret } as const, changed: false },
        { ...own, name: "removed", text: kept, op: { kind: "remove" } as const, changed: true },
      ];

      for (const [s, home] of scenes.flatMap((scene) => scene.wheres.map((at) => [scene, at] as const))) {
        const at = placeFor(draw.app, home, draw.disk.moved);
        const seed = seedFor(at, "file", held(draw, s.text));
        const found = yield* run({ group: s.group, setting: s.setting, place: at, seed, op: s.op });
        const named = `${s.name} in ${at.site}`;

        const spans = found.spans.filter((span) => span.name.startsWith("config."));

        expect(
          spans.map((span) => span.name),
          `${named}: one span`,
        ).toEqual([`config.${s.op.kind}`]);
        expect(spans[0]?.attributes.get("kalfa.config.app"), `${named}: the app`).toBe(draw.app);
        expect(spans[0]?.attributes.get("kalfa.config.setting"), `${named}: the setting`).toBe(s.setting.name);
        expect(spans[0]?.attributes.get("kalfa.config.file"), `${named}: the file`).toBe(at.file);

        if (s.changed === undefined) {
          expect(found.answer._tag, `${named}: a refusal`).toBe("failed");
          expect(spans[0]?.attributes.get("kalfa.config.changed"), `${named}: a refusal is not a change`).not.toBe(
            true,
          );
        } else {
          expect(found.answer, named).toEqual(done);
          expect(spans[0]?.attributes.get("kalfa.config.changed"), `${named}: whether the text changed`).toBe(
            s.changed,
          );
        }

        for (const output of printed(found)) {
          for (const form of forms(secret)) {
            expect(output, `${named}: no output holds the secret`).not.toContain(form);
          }
        }

        reach.mark(`u:${at.site}`);
      }

      reach.done();
    }),
  check,
);

// ---------------------------------------------------------------------------------------------
// D9, read and write faults
// ---------------------------------------------------------------------------------------------

// Plants: count every read failure as an empty file (in internal/disk.ts, answer "" for any failed read): a permission
// fault writes a file, red; answer `read` for a refused lock create: red.
// D9 is two laws of its own with all of their runs, one for each fault: each draw's changes ran four faulted calls, and the one law took 11.3 s.
const faulted = (only: "w:read" | "w:lock-create") => (draw: DiskDraw) =>
  Effect.gen(function* () {
    const reach = new Reach<string>(["u:repo", ...USER_PLACES, "v:file", only]);

    for (const [n, { p, value }] of cases(draw).entries()) {
      const at = place(draw, p, p.file, n);
      const path = at.path ?? "";
      const group = groupFor(p);
      const setting = targetSetting(p);
      const base = held(draw, p.located.text);

      const [fault, reason] =
        only === "w:read"
          ? ([readRefused(path, draw.disk.read), "read"] as const)
          : ([createRefused(`${path}.lock`, draw.disk.create), "write"] as const);

      for (const op of [{ kind: "set", value }, { kind: "remove" }] as const) {
        const found = yield* run({ group, setting, place: at, seed: seedFor(at, "file", base, [fault]), op });
        const named = `${label(p, at, op.kind)} with ${only}`;

        expect(found.answer._tag, `${named}: the call fails`).toBe("failed");

        if (found.answer._tag === "failed") {
          expect(found.answer.reason, named).toBe(reason);
          expect(names(found.answer, at.name), `${named}: it names the file`).toBe(true);

          if (p.located.text !== "") {
            expect(found.answer.printed, `${named}: it never holds the file's text`).not.toContain(p.located.text);
          }
        }

        asWas(found, named);
        expect(found.after.files, `${named}: the file is as it was`).toEqual({ [path]: p.located.text });
      }

      reach.mark(only, `u:${at.site}`, "v:file");
    }

    reach.done();
  });

it.effect.prop(
  "D9 a refused read fails `read`, naming the file and never its text, and nothing is written",
  DiskDraw.fields,
  faulted("w:read"),
  check,
);

it.effect.prop(
  "D9 a refused lock create fails `write`, naming the file and never its text, and nothing is written",
  DiskDraw.fields,
  faulted("w:lock-create"),
  check,
);

// ---------------------------------------------------------------------------------------------
// D10, no home
// ---------------------------------------------------------------------------------------------

// Plant: with no home, write to `.<app>/<app>.toml` under the current folder (in internal/disk.ts, in place of failing,
// build the path from an empty home): a file is written, red.
it.effect.prop(
  "D10 no home: with neither the app's home variable nor HOME, a set to the user file fails `write` naming both variables, and a remove succeeds with no file call",
  DiskDraw.fields,
  (draw) =>
    Effect.gen(function* () {
      const reach = new Reach<string>(["u:no-home"]);
      const users = positions(draw).filter((p) => p.file === "user");

      expect(users.length, "the draw has user files").toBeGreaterThan(0);

      for (const p of users) {
        const at = place(draw, p, "user", 0, "no-home");
        const group = groupFor(p);
        const setting = targetSetting(p);
        const variable = `${p.app.toUpperCase()}_HOME`;

        const set = yield* run({
          group,
          setting,
          place: at,
          seed: {},
          op: { kind: "set", value: valuesFor(draw, p)[0] },
        });

        const named = label(p, at);

        expect(set.answer._tag, `${named}: a set fails`).toBe("failed");

        if (set.answer._tag === "failed") {
          expect(set.answer.reason, `${named}: it is a write error`).toBe("write");
          expect(set.answer.message, `${named}: it names the app's variable`).toContain(variable);
          // `HOME` on its own, not as the end of the app's variable.
          expect(set.answer.message, `${named}: it names HOME`).toMatch(/(?<![A-Z_])HOME/u);
        }

        asWas(set, named);
        expect(set.after.files, `${named}: nothing is written`).toEqual({});

        const remove = yield* run({ group, setting, place: at, seed: {}, op: { kind: "remove" } });

        expect(remove.answer, `${named} remove`).toEqual(done);
        expect(remove.calls, `${named} remove: no file call`).toEqual([]);
        reach.mark("u:no-home");
      }

      reach.done();
    }),
  check,
);

// ---------------------------------------------------------------------------------------------
// D11, every failure says the file was not changed
// ---------------------------------------------------------------------------------------------

/**
 * A failure's message ends with the closing sentence of an edit: the file as a person reads it, and that it was not changed.
 * `subject` is what the sentence names: the file's name where the file is known. A failure that comes before the file is
 * known, as an environment that cannot be read (it may move the user file), names the configuration instead.
 */
const closes = (found: Seen, subject: string, named: string) => {
  expect(found.answer._tag, `${named}: the call fails`).toBe("failed");

  if (found.answer._tag === "failed") {
    const last = found.answer.message.trimEnd().split("\n").at(-1)?.trim();

    expect(last, `${named}: the closing sentence`).toBe(`${subject} was not changed.`);
  }
};

// Plant: end a disk failure with the start's closing sentence, `<app> did not start.` (in internal/place.ts, where `stop`
// takes its default closing, or in internal/disk.ts where `fail` builds a message): the closing sentence is the start's,
// red.
it.effect.prop(
  "D11 every disk failure ends by naming the file and saying it was not changed: a refused edit, a held lock, a refused read, a refused lock, a missing parent, an environment that cannot be read and no home",
  DiskDraw.fields,
  (draw) =>
    Effect.gen(function* () {
      const reach = new Reach<string>([
        "u:repo",
        ...USER_PLACES,
        "u:no-home",
        "v:lock",
        "v:no-parent",
        "w:read",
        "w:lock-create",
        "w:environment",
      ]);

      for (const [n, s] of scoped(draw).entries()) {
        const at = placeFor(s.app, siteFor(draw, s.file, n), draw.disk.moved);
        const seed = seedFor(at, "file", held(draw, s.text));

        for (const op of [{ kind: "set", value: draw.values.port }, { kind: "remove" }] as const) {
          closes(
            yield* run({ group: s.group, setting: s.target, place: at, seed, op }),
            at.name,
            `${s.target.name} in ${at.site} ${op.kind}`,
          );
        }

        reach.mark(`u:${at.site}`);
      }

      for (const [n, p] of positions(draw).entries()) {
        const at = place(draw, p, p.file, n);
        const path = at.path ?? "";
        const group = groupFor(p);
        const setting = targetSetting(p);
        const op = { kind: "set", value: valuesFor(draw, p)[0] } as const;
        const base = held(draw, p.located.text);

        const failures = [
          ["a held lock", seedFor(at, "lock", base), "v:lock"],
          ["a refused read", seedFor(at, "file", base, [readRefused(path, draw.disk.read)]), "w:read"],
          [
            "a refused lock",
            seedFor(at, "file", base, [createRefused(`${path}.lock`, draw.disk.create)]),
            "w:lock-create",
          ],
          ["a missing parent", seedFor(at, "no-parent", base), "v:no-parent"],
        ] as const;

        for (const [cause, seed, id] of failures) {
          closes(yield* run({ group, setting, place: at, seed, op }), at.name, `${label(p, at)} ${cause}`);
          reach.mark(id);
        }

        closes(
          yield* run({ group, setting, place: at, seed: seedFor(at, "file", base), unreadable: true, op }),
          // The file may be `$<APP>_HOME/<app>.toml` or `~/.<app>/<app>.toml`: no path is known to name.
          at.file === "repo" ? "The repo configuration" : "The user configuration",
          `${label(p, at)} an environment that cannot be read`,
        );

        reach.mark("w:environment");

        if (p.file === "user") {
          const none = placeFor(p.app, "no-home", draw.disk.moved);

          closes(yield* run({ group, setting, place: none, seed: {}, op }), none.name, `${label(p, none)} no home`);
          reach.mark("u:no-home");
        }

        reach.mark(`u:${at.site}`);
      }

      reach.done();
    }),
  check,
);
