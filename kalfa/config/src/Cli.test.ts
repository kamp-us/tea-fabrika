// Ticket 1846, kalfa/config (new work), slice 2: C1 to C8 and C11 of the approved plan
// (.kalfa/quests/kalfa-config-command-PLAN.md), for the `config` command that `@kalfa/config/cli` exports and `@kalfa/cli`
// mounts as its built-in. Written before the code; the command's type is C9 (Cli.types.test.ts).
//
// What the code does, as these laws hold it to (the plan's "The command" and "The listing"):
// - `config(app, groups, { version, repo })` is one `effect/cli` command over every group of one app: `get`, `set`,
//   `remove`, `list`, `schema` and `reference`. It reads the repo configuration in the folder `repo` names and nowhere else:
//   `kalfa` decides the repo's root and hands it over (issue 2076), so the command never reads the current folder on its
//   own (C11).
// - `list` and `get` run the start's own steps on the joined settings, with no flags, and fail with the start's faults
//   ending `<app> would not start with these settings.` (C2, C8). A typed name that is no setting is `unknown`, with the
//   same "Did you mean" as a mistyped key, and ends `Nothing was read.` for `get` (C3).
// - `get` prints the value as one line of JSON (the owner's answer on issue 1846). `set` reads its text as a variable's text
//   is read, and edits with the join's whole check (C4). `schema` and `reference` print the slice-1 calls on the joined
//   settings, byte for byte (C6).
// - A failure prints nothing and each run is one span (C8); a value text never reaches an output (C7).
//
// Every law is a property over generated scenes (Cli.test-support.ts): groups of settings with the files and the
// environment that set them, and the text each subcommand must print, written there from the scene and never from the code
// under test. A law builds one scene for each class it lists from the drawn seeds and fails when a class was not reached.
// Each names its plant: break one thing, run the law, see it red, undo it.
import { expect, it } from "@effect/vitest";
import { runsFor } from "@kampus/vitest";
import { Effect, Exit, Option, Schema } from "effect";
import {
  CliDraw,
  configSpans,
  declare,
  ended,
  type Entry,
  type Fact,
  FACTS,
  FAR,
  facts,
  failure,
  forms,
  joinedGroup,
  type Kind,
  LIST_IDS,
  type ListId,
  listed,
  listing,
  settingName,
  quiet,
  readFaults,
  nearest,
  OBJECT_NAMES,
  oneEdit,
  placeNames,
  printed,
  Reach,
  REFUSED,
  type Ran,
  repoPath,
  run,
  seen,
  type Spec,
  scene,
  textFor,
  twoEdits,
  unknownTexts,
  userPath,
  variable,
  type World,
  worldFrom,
  writable,
} from "./Cli.test-support.ts";
import { config } from "./Cli.ts";
import { type Setting, SettingGroup } from "./index.ts";
import { debounce } from "./internal/window.ts";
import { LOOSE, looseSetting } from "./SettingGroup.text.test-support.ts";

const readJson = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Json));

const check = { arbitrary: { runs: runsFor({ fast: 25, full: 100 }), size: 100 } };

const ROOT = "/work/repo";

const closing = (app: string) => `${app} would not start with these settings.`;

const WINDOW = debounce.name;

// ---------------------------------------------------------------------------------------------
// C1, `list` shows every setting
// ---------------------------------------------------------------------------------------------

// Plants: (k) list only the first group: red; (k) add the window once per group with a live setting: two window blocks,
// red; (k) dedupe by name, not by object: a shared object passes but two of one name hide a clash, red; (c) end each block
// with `\n` after the description: a description with a final break gets two, red; (l) print `\n` for an empty listing:
// red; (s) write a `$<APP>_HOME` origin with its `~` name: red.
it.effect.prop(
  "C1 `list` shows every setting: for generated groups, sources and descriptions, the standard output of `config list` is the listing written from the scene, byte for byte",
  { draw: CliDraw },
  ({ draw }) =>
    Effect.gen(function* () {
      const reach = new Reach<ListId | Fact>([...LIST_IDS, ...FACTS]);

      for (const { id, scene: s } of listed(draw)) {
        const world = worldFrom(s, ROOT);
        const ran = yield* run(world, ["list"]);

        ended(ran, id);
        expect(ran.stdout, `${id}: the standard output`).toBe(listing(s));
        // A read writes nothing.
        expect(ran.files, `${id}: no file changed`).toEqual(world.files);
        reach.mark(id, ...facts(s));
      }

      reach.done();
    }),
  check,
);

// ---------------------------------------------------------------------------------------------
// C2, every group is seen
// ---------------------------------------------------------------------------------------------

type Left = "left:first" | "left:middle" | "left:last";

// Plants: (k) check the file against each group alone and join the answers: red; (k) build the read's group from the first
// group's settings: red.
it.effect.prop(
  "C2 every group is seen: for generated groups of one app and a file that sets a key of each, `config(app, all)` lists them all and succeeds, and `config(app, all but one)` fails with one `unknown` error at the left-out group's key and line, ends `<app> would not start with these settings.` and prints nothing",
  { draw: CliDraw },
  ({ draw }) =>
    Effect.gen(function* () {
      const reach = new Reach<Left | "all">(["all", "left:first", "left:middle", "left:last"]);
      const s = seen(draw);
      const world = worldFrom(s, ROOT);
      const names = placeNames(s.app, s.userAt);

      const all = yield* run(world, ["list"]);

      ended(all, "all the groups");
      expect(all.stdout, "all the groups: the listing").toBe(listing(s));
      reach.mark("all");

      for (const [g, id] of [
        [0, "left:first"],
        [1, "left:middle"],
        [2, "left:last"],
      ] as const) {
        const left = s.groups[g]?.settings ?? [];
        const rest = s.groups.filter((_, n) => n !== g);
        const kept = rest.flatMap((group) => group.settings);
        const ran = yield* run({ ...world, groups: rest }, ["list"]);
        const out = failure(ran);

        // The left-out group holds exactly one key of the repo file: its line is the error's.
        const key = s.entries.find((e) => left.includes(e.setting) && e.source === "repo");

        // The names the error may suggest: the settings of the repo file's scope that are still there, the window when one is live.
        const near = s.entries
          .filter(
            (e) =>
              (kept.includes(e.setting) || (e.setting === debounce && kept.some((k) => k.live))) &&
              e.spec.files.includes("repo"),
          )
          .map((e) => e.spec.name);

        expect(out.reason, `${id}: the reason`).toBe("unknown");
        expect(out.file, `${id}: the file`).toBe(names.repo);
        expect(out.line, `${id}: the line`).toBe(key?.line);
        expect(
          unknownTexts(near, key?.spec.name ?? "").map(
            (text) => `${names.repo}, line ${key?.line}: ${text}\n  ${closing(s.app)}`,
          ),
          `${id}: the message`,
        ).toContain(out.message);
        expect(ran.stdout, `${id}: nothing is printed`).toBe("");
        reach.mark(id);
      }

      reach.done();
    }),
  check,
);

// ---------------------------------------------------------------------------------------------
// C3, `get`
// ---------------------------------------------------------------------------------------------

type Typed = "declared" | "near1" | "near2" | "far" | "table" | "empty" | "object" | "suggested" | "unsuggested";

// Plants: (m) accept a table's name and print its record: red; (m) suggest a name at three edits: red; (y) find by
// `byName[typed]` on a plain object: `constructor` finds Object's own function, red; (c) print a text value raw: a value
// with a break spans two lines, red.
it.effect.prop(
  "C3 `get`: for a generated declared name, standard output is one line of JSON that decodes to the value that was read; for a typed name that is no setting, one `unknown` error with no file, ` Did you mean <near>?` exactly when a name is within two edits, then `Nothing was read.`, and nothing printed",
  { draw: CliDraw },
  ({ draw }) =>
    Effect.gen(function* () {
      const reach = new Reach<Typed>([
        "declared",
        "near1",
        "near2",
        "far",
        "table",
        "empty",
        "object",
        "suggested",
        "unsuggested",
      ]);

      const scenes = [
        ...listed(draw)
          .filter(({ id }) => ["plain", "names", "shared-live", "file-only", "values"].includes(id))
          .map(({ scene: s }) => s),
      ];

      for (const s of scenes) {
        const world = worldFrom(s, ROOT);
        const declared = s.entries.map((e) => e.spec.name);

        for (const e of s.entries) {
          const ran = yield* run(world, ["get", e.spec.name]);

          ended(ran, `get ${e.spec.name}`);
          // One line: the value as JSON, and the line's own break, so no break of a text value spans a second line.
          expect(ran.stdout, `get ${e.spec.name}: the standard output`).toBe(`${JSON.stringify(e.json)}\n`);
          expect(ran.stdout.slice(0, -1), `get ${e.spec.name}: one line`).not.toMatch(/[\r\n]/u);
          expect(readJson(ran.stdout), `get ${e.spec.name}: the value`).toEqual(e.json);
          expect(ran.files, `get ${e.spec.name}: no file changed`).toEqual(world.files);
          reach.mark("declared");
        }

        const first = declared[0] ?? "";
        const second = declared[1] ?? first;
        const table = first.split(".").length > 1 ? (first.split(".")[0] ?? "") : `${first}.`;

        const typed: ReadonlyArray<readonly [string, Typed]> = [
          [oneEdit(first), "near1"],
          [twoEdits(second), "near2"],
          [FAR, "far"],
          [table, "table"],
          ["", "empty"],
          ...OBJECT_NAMES.map((name) => [name, "object"] as const),
        ];

        for (const [name, id] of typed) {
          // A typed name that is a setting is `declared`'s: this class is for names that are none.
          if (declared.includes(name)) {
            continue;
          }

          const ran = yield* run(world, ["get", name]);
          const out = failure(ran);
          const near = nearest(declared, name);

          expect(out.reason, `get ${JSON.stringify(name)}: the reason`).toBe("unknown");
          expect(out.file, `get ${JSON.stringify(name)}: no file`).toBeUndefined();
          expect(out.line, `get ${JSON.stringify(name)}: no line`).toBeUndefined();
          expect(
            unknownTexts(declared, name).map((text) => `${text}\n  Nothing was read.`),
            `get ${JSON.stringify(name)}: the message`,
          ).toContain(out.message);
          expect(ran.stdout, `get ${JSON.stringify(name)}: nothing is printed`).toBe("");
          reach.mark(id, near.length === 0 ? "unsuggested" : "suggested");

          // `Nothing was read.` is true: a name that is no setting is refused before a file is found or read. Each read of a
          // file would fail here, and none is made.
          const unread = yield* run({ ...world, faults: readFaults(s, ROOT) }, ["get", name]);
          const refused = failure(unread);

          expect(refused.reason, `get ${JSON.stringify(name)} with no readable file: the reason`).toBe("unknown");
          expect(unread.calls, `get ${JSON.stringify(name)}: no call of the file system`).toEqual([]);
        }
      }

      reach.done();
    }),
  check,
);

// ---------------------------------------------------------------------------------------------
// C4, `set` and `remove`
// ---------------------------------------------------------------------------------------------

type Written =
  | "set:default-repo"
  | "set:default-user"
  | "set:user-only"
  | "set:explicit-user"
  | "set:explicit-repo"
  | "set:file-only"
  | "set:window"
  | "set:scope"
  | "set:invalid"
  | "set:unknown"
  | "remove:default"
  | "remove:explicit"
  | "remove:absent"
  | "remove:window"
  | "remove:scope"
  | "remove:unknown";

const WRITTEN: ReadonlyArray<Written> = [
  "set:default-repo",
  "set:default-user",
  "set:user-only",
  "set:explicit-user",
  "set:explicit-repo",
  "set:file-only",
  "set:window",
  "set:scope",
  "set:invalid",
  "set:unknown",
  "remove:default",
  "remove:explicit",
  "remove:absent",
  "remove:window",
  "remove:scope",
  "remove:unknown",
];

// Plants: (n) read the text as JSON: the plain word `owner` is refused, red; (o) default `--file` to the repo: a user-only
// setting fails `scope`, red; (k) edit with the setting's own group: another group's key is refused, red; (z) join without
// `watched`: a set of `config.watch.debounce` fails `unknown`, red.
it.effect.prop(
  "C4 `set` and `remove` write what the edit writes: for a generated setting, value text and file choice, the file's text after `config set <name> <text> [--file f]` is the join's edit of its old text with the value the text reads as, in the file `--file` names or else the first of the setting's scope, and `remove` is the edit's remove; a refused text fails `invalid` with `The <file> configuration was not changed.` and leaves the file; a file outside the scope fails `scope`; other groups' keys stay and are not refused; nothing is printed",
  { draw: CliDraw },
  ({ draw }) =>
    Effect.gen(function* () {
      const reach = new Reach<Written | "home:home" | "home:app-home">([...WRITTEN, "home:home", "home:app-home"]);

      // The user configuration is at `~/.<app>/<app>.toml` or at `$<APP>_HOME/<app>.toml`: each message names the one it is.
      for (const user of ["home", "app-home"] as const) {
        reach.mark(`home:${user}`);
        const s = writable(draw, user);
        const world = worldFrom(s, ROOT);
        const oracle = joinedGroup(s);
        const names = placeNames(s.app, s.userAt);
        const paths = { repo: repoPath(s, ROOT), user: userPath(s) } as const;
        const by = (n: number) => s.entries.find((e) => e.setting === oracle.settings[n]);

        const row = (n: number) => {
          const found = by(n);

          if (found === undefined) {
            return expect.fail(`the scene has no row ${n}`);
          }

          return found;
        };

        /** One `set`: where it is to write, what the join's edit makes of the old text, and what the run left. */
        const setting = Effect.fnUntraced(function* (
          id: Written,
          n: number,
          file: "repo" | "user",
          flag: boolean,
          value: { readonly text: string; readonly value: unknown },
        ) {
          const e = row(n);
          const ran = yield* run(world, ["set", e.spec.name, value.text, ...(flag ? ["--file", file] : [])]);
          const old = world.files[paths[file]] ?? "";
          const expected = yield* SettingGroup.edit(oracle, old, file).set(e.setting, value.value);

          ended(ran, id);
          expect(ran.stdout, `${id}: nothing is printed`).toBe("");
          expect(ran.files, `${id}: the file is the edit's, every other file as it was`).toEqual({
            ...world.files,
            [paths[file]]: expected,
          });
          spanned(ran, "set", e.spec.name, id);
          reach.mark(id);
        });

        yield* setting("set:default-repo", 0, "repo", false, textFor(draw, "int", 3));
        yield* setting("set:default-user", 1, "user", false, textFor(draw, "text", 4));
        yield* setting("set:user-only", 2, "user", false, textFor(draw, "literal", 5));
        yield* setting("set:explicit-user", 0, "user", true, textFor(draw, "int", 6));
        yield* setting("set:explicit-repo", 1, "repo", true, textFor(draw, "text", 7));
        yield* setting("set:file-only", 4, "repo", false, textFor(draw, "branded", 2));

        // The quiet window is a setting of the joined group: a set of it passes the whole-file check.
        const window = s.entries.find((e) => e.setting === debounce);

        if (window !== undefined) {
          const ran = yield* run(world, ["set", WINDOW, "2 seconds"]);
          const old = world.files[paths.repo] ?? "";
          const expected = yield* SettingGroup.edit(oracle, old, "repo").set(debounce, "2 seconds");

          ended(ran, "set:window");
          expect(ran.files, "set:window: the file is the edit's").toEqual({ ...world.files, [paths.repo]: expected });
          reach.mark("set:window");
        }

        // A file the setting's scope leaves out is `scope`, and nothing changes.
        const outside = row(3);
        const scoped = yield* run(world, ["set", outside.spec.name, "abc", "--file", "user"]);
        const scopedOut = failure(scoped);

        expect(scopedOut.reason, "set:scope: the reason").toBe("scope");
        expect(scopedOut.message, "set:scope: the file is named").toMatch(
          new RegExp(`${escaped(names.user)} was not changed\\.$`, "u"),
        );
        expect(scoped.files, "set:scope: no file changed").toEqual(world.files);
        expect(scoped.stdout, "set:scope: nothing is printed").toBe("");
        reach.mark("set:scope");

        // A text the schema refuses fails before any file is touched, and the message does not hold it.
        for (const [n, kind, flag] of [
          [0, "int", undefined],
          [0, "int", "user"],
          [2, "literal", undefined],
          [3, "pattern", undefined],
        ] as const) {
          const e = row(n);
          const text = REFUSED[kind] ?? "";
          const file = flag ?? e.spec.files[0];
          const ran = yield* run(world, ["set", e.spec.name, text, ...(flag === undefined ? [] : ["--file", flag])]);
          const out = failure(ran);

          expect(out.reason, `set:invalid ${kind}: the reason`).toBe("invalid");
          // The file is named as the write would name it, and every other message of the run names it: `~/...` or `$<APP>_HOME/...`.
          expect(out.file, `set:invalid ${kind}: the file`).toBe(names[file]);
          expect(out.message, `set:invalid ${kind}: opens with the file`).toMatch(
            new RegExp(`^${escaped(names[file])}: `, "u"),
          );
          expect(spannedNames(ran, "set"), `set:invalid ${kind}: a span`).not.toEqual([]);
          expect(out.message, `set:invalid ${kind}: the closing`).toMatch(
            new RegExp(`The ${file} configuration was not changed\\.$`, "u"),
          );
          expect(out.message, `set:invalid ${kind}: names the setting`).toContain(e.spec.name);
          expect(ran.files, `set:invalid ${kind}: no file changed`).toEqual(world.files);
          expect(ran.stdout, `set:invalid ${kind}: nothing is printed`).toBe("");
          reach.mark("set:invalid");
        }

        // A name that is no setting, for both writes: `unknown`, nothing changed.
        const declared = s.entries.map((e) => e.spec.name);
        const typed = oneEdit(declared[0] ?? "");

        for (const sub of ["set", "remove"] as const) {
          const ran = yield* run(world, sub === "set" ? ["set", typed, "1"] : ["remove", typed]);
          const out = failure(ran);

          expect(out.reason, `${sub}:unknown: the reason`).toBe("unknown");
          expect(out.file, `${sub}:unknown: no file`).toBeUndefined();
          expect(
            unknownTexts(declared, typed).map((text) => `${text}\n  Nothing was changed.`),
            `${sub}:unknown: the message`,
          ).toContain(out.message);
          expect(ran.files, `${sub}:unknown: no file changed`).toEqual(world.files);
          expect(spannedNames(ran, sub), `${sub}:unknown: a span`).not.toEqual([]);
          reach.mark(`${sub}:unknown`);
        }

        /** One `remove`: the join's edit of the old text without the key. */
        const removing = Effect.fnUntraced(function* (id: Written, e: Entry, file: "repo" | "user", flag: boolean) {
          const ran = yield* run(world, ["remove", e.spec.name, ...(flag ? ["--file", file] : [])]);
          const old = world.files[paths[file]] ?? "";
          const expected = yield* SettingGroup.edit(oracle, old, file).remove(e.setting);

          ended(ran, id);
          expect(ran.stdout, `${id}: nothing is printed`).toBe("");
          expect(ran.files, `${id}: the file is the edit's, every other file as it was`).toEqual({
            ...world.files,
            [paths[file]]: expected,
          });
          spanned(ran, "remove", e.spec.name, id);
          reach.mark(id);
        });

        yield* removing("remove:default", row(0), "repo", false);
        yield* removing("remove:explicit", row(1), "user", true);
        // A key the file lacks: nothing to take out, so the text is the same.
        yield* removing("remove:absent", row(3), "repo", false);

        if (window !== undefined) {
          yield* removing("remove:window", window, "repo", false);
        }

        const scopedRemove = yield* run(world, ["remove", outside.spec.name, "--file", "user"]);

        expect(failure(scopedRemove).reason, "remove:scope: the reason").toBe("scope");
        expect(failure(scopedRemove).message, "remove:scope: the file is named").toMatch(
          new RegExp(`${escaped(names.user)} was not changed\\.$`, "u"),
        );
        expect(scopedRemove.files, "remove:scope: no file changed").toEqual(world.files);
        reach.mark("remove:scope");
      }

      reach.done();
    }),
  check,
);

/** The names of the spans a `set` or a `remove` run left whose name opens `config.`; each is `config.<subcommand>`. */
const spannedNames = (ran: Ran, sub: "set" | "remove") => {
  const names = configSpans(ran).map((span) => span.name);

  expect(
    names.filter((name) => name !== `config.${sub}`),
    `${sub}: no other span`,
  ).toEqual([]);

  return names;
};

/** A run of `set` or `remove` that went through leaves a span with the app, the setting and no value. */
const spanned = (ran: Ran, sub: "set" | "remove", name: string, id: string) => {
  expect(spannedNames(ran, sub), `${id}: a span`).not.toEqual([]);

  for (const span of configSpans(ran)) {
    expect(span.attributes.get("kalfa.config.setting"), `${id}: the setting`).toBe(name);
  }
};

const escaped = (text: string) => text.replace(/[\\^$.*+?()[\]{}|]/gu, "\\$&");

// ---------------------------------------------------------------------------------------------
// C5, the join
// ---------------------------------------------------------------------------------------------

type Joined =
  | "stop:other-app"
  | "stop:one-name"
  | "stop:value-and-table"
  | "stop:table-and-value"
  | "stop:one-variable"
  | "stop:bad-app"
  | "build:shared-object"
  | "build:one-field"
  | "build:empty"
  | "build:two-live";

const JOINED: ReadonlyArray<Joined> = [
  "stop:other-app",
  "stop:one-name",
  "stop:value-and-table",
  "stop:table-and-value",
  "stop:one-variable",
  "stop:bad-app",
  "build:shared-object",
  "build:one-field",
  "build:empty",
  "build:two-live",
];

/** A setting of one kind under a name, as a group holds it. */
const named = (name: string, kind: Kind = "int", live = false): Setting.Any =>
  declare({
    name,
    kind,
    files: ["repo", "user"],
    live,
    fileOnly: false,
    description: `The setting ${name}.`,
    default: kind === "required" ? Option.none() : Option.some(kind === "int" ? 18787 : "x"),
  } satisfies Spec);

// Plants: (p) leave out the app check: another app's group builds, red; (p) refuse a field two groups share: red; (p) keep
// a shared setting object twice: one name clashes with itself, red; (l) refuse an empty list of groups: red.
it.effect.prop(
  "C5 the join: for generated groups, `config(app, groups, options)` throws an `Error` naming both settings for each class that must stop, and builds for each that must not",
  { draw: CliDraw },
  ({ draw }) =>
    Effect.sync(() => {
      const reach = new Reach<Joined>(JOINED);
      const { app } = draw;
      const options = { version: "0.0.0", repo: ROOT };
      const [t0, t1] = [draw.tables[0] ?? "a", draw.tables[1] ?? "b"];
      const [k0, k1] = [draw.keys[0] ?? "c", draw.keys[1] ?? "d"];
      const [w0, w1, w2] = [draw.words[0] ?? "x", draw.words[1] ?? "y", draw.words[2] ?? "z"];
      const make = (group: string, ...settings: ReadonlyArray<Setting.Any>) => SettingGroup.make(group, ...settings);

      /** A join that must stop: it throws an Error, and its message names each of the two settings. */
      const stops = (id: Joined, groups: ReadonlyArray<ReturnType<typeof make>>, names: ReadonlyArray<string>) => {
        expect(() => config(app, groups, options), `${id}: throws an Error`).toThrow(Error);

        for (const name of names) {
          expect(() => config(app, groups, options), `${id}: names ${name}`).toThrow(name);
        }

        reach.mark(id);
      };

      /** A join that must build: a command named by the root name `config`. */
      const builds = (id: Joined, groups: ReadonlyArray<ReturnType<typeof make>>) => {
        expect(() => config(app, groups, options), `${id}: builds`).not.toThrow();
        expect(config(app, groups, options).name, `${id}: its name`).toBe("config");
        reach.mark(id);
      };

      const own = `${t0}.${k0}`;
      const table = `${t0}.${k0}.${k1}`;
      const dashed = `${w0}-${w1}.${w2}`;
      const joined = `${w0}.${w1}-${w2}`;

      // A group of another app: the app is the rule's own, so the settings are the group's and no clash is named.
      stops("stop:other-app", [make(`${app}x`, named(own))], []);

      stops("stop:one-name", [make(app, named(own)), make(app, named(own, "text"))], [own]);
      stops("stop:value-and-table", [make(app, named(own)), make(app, named(table))], [own, table]);
      // The table first, then the value under it: the clash is found whichever of the two is declared first.
      stops("stop:table-and-value", [make(app, named(table)), make(app, named(own))], [own, table]);
      stops("stop:one-variable", [make(app, named(dashed)), make(app, named(joined))], [dashed, joined]);

      // The app's name is held to the rule of `SettingGroup.make`.
      expect(() => config(`${app.toUpperCase()}_`, [], options), "stop:bad-app: throws").toThrow(Error);
      reach.mark("stop:bad-app");

      const shared = named(own);

      builds("build:shared-object", [make(app, shared, named(`${t1}.${k1}`)), make(app, shared)]);
      // One field under two tables is two fields: each group yields its own.
      builds("build:one-field", [make(app, named(`${t0}.${k0}`)), make(app, named(`${t1}.${k0}`))]);
      builds("build:empty", []);
      expect(() => config(app, [make(app)], options), "build:empty: a group with no settings").not.toThrow();
      builds("build:two-live", [
        make(app, named(`${t0}.${k0}`, "int", true)),
        make(app, named(`${t1}.${k1}`, "int", true)),
      ]);

      reach.done();
    }),
  check,
);

// ---------------------------------------------------------------------------------------------
// C6, `schema` and `reference` print their calls
// ---------------------------------------------------------------------------------------------

// Plants: (c) print with `Console.log(text)`: one extra `\n`, red; (e) default `--file` to the user: the repo's version key
// is missing, red.
it.effect.prop(
  "C6 `schema` and `reference` print their calls: for generated groups, the standard output of `config schema [--file f]` is `jsonSchema` of a group of the joined settings in that file (`repo` when left out), and of `config reference` is `reference` of it, byte for byte",
  { draw: CliDraw },
  ({ draw }) =>
    Effect.gen(function* () {
      const reach = new Reach<ListId | "schema:default" | "schema:repo" | "schema:user" | "reference">([
        "plain",
        "shared-live",
        "two-live",
        "empty-group",
        "no-groups",
        "file-only",
        "names",
        "schema:default",
        "schema:repo",
        "schema:user",
        "reference",
      ]);

      for (const { id, scene: s } of listed(draw)) {
        // One field under two tables cannot be one group, so the call the command is held to has no group to be asked of.
        if (id === "same-field") {
          continue;
        }

        const world = worldFrom(s, ROOT);
        const group = joinedGroup(s);

        for (const [args, file, tag] of [
          [["schema"], "repo", "schema:default"],
          [["schema", "--file", "repo"], "repo", "schema:repo"],
          [["schema", "--file", "user"], "user", "schema:user"],
        ] as const) {
          const ran = yield* run(world, args);

          ended(ran, `${id} ${args.join(" ")}`);
          expect(ran.stdout, `${id} ${args.join(" ")}: the standard output`).toBe(SettingGroup.jsonSchema(group, file));
          reach.mark(tag);
        }

        const reference = yield* run(world, ["reference"]);

        ended(reference, `${id} reference`);
        expect(reference.stdout, `${id} reference: the standard output`).toBe(SettingGroup.reference(group));
        expect(reference.files, `${id} reference: no file changed`).toEqual(world.files);
        reach.mark(id, "reference");
      }

      reach.done();
    }),
  check,
);

// ---------------------------------------------------------------------------------------------
// C7, a value text stays out
// ---------------------------------------------------------------------------------------------

type Hidden = "taken:text" | "taken:branded" | "taken:explicit" | "refused:int" | "refused:literal";

// Plants: (r) put the text in the `invalid` message: red; (r) annotate the span with the typed text: red.
it.effect.prop(
  "C7 [secrets] a value text stays out: a generated secret-looking value text given to `set`, refused or taken, never appears in the error's message, its cause, `Cause.pretty`, standard output, a log line, or any span's attributes or events, raw, JSON-escaped or URL-encoded",
  { draw: CliDraw },
  ({ draw }) =>
    Effect.gen(function* () {
      const reach = new Reach<Hidden>([
        "taken:text",
        "taken:branded",
        "taken:explicit",
        "refused:int",
        "refused:literal",
      ]);

      const s = writable(draw);
      const world = worldFrom(s, ROOT);
      const secret = draw.secret;
      const settings = joinedGroup(s).settings;
      const nameAt = (n: number) => settings[n]?.name ?? "";

      const cases: ReadonlyArray<readonly [Hidden, ReadonlyArray<string>, boolean]> = [
        ["taken:text", ["set", nameAt(1), secret], true],
        ["taken:branded", ["set", nameAt(4), secret], true],
        ["taken:explicit", ["set", nameAt(1), secret, "--file", "repo"], true],
        ["refused:int", ["set", nameAt(0), secret], false],
        ["refused:literal", ["set", nameAt(2), secret], false],
      ];

      for (const [id, args, taken] of cases) {
        const ran = yield* run(world, args);

        expect(Exit.isSuccess(ran.exit), `${id}: ${taken ? "taken" : "refused"}`).toBe(taken);

        if (!taken) {
          expect(failure(ran).reason, `${id}: the reason`).toBe("invalid");
        }

        for (const output of printed(ran)) {
          for (const form of forms(secret)) {
            expect(output, `${id}: no output holds the secret`).not.toContain(form);
          }
        }

        reach.mark(id);
      }

      reach.done();
    }),
  check,
);

// ---------------------------------------------------------------------------------------------
// C8, a failure prints nothing, and each run is one span
// ---------------------------------------------------------------------------------------------

type Failing =
  | "list:late-fault"
  | "list:unknown-key"
  | "list:version"
  | "get:late-fault"
  | "get:version"
  | "get:unknown"
  | "set:unknown"
  | "set:scope"
  | "set:invalid"
  | "remove:unknown"
  | "remove:scope"
  | "schema:defect";

const FAILING: ReadonlyArray<Failing> = [
  "list:late-fault",
  "list:unknown-key",
  "list:version",
  "get:late-fault",
  "get:version",
  "get:unknown",
  "set:unknown",
  "set:scope",
  "set:invalid",
  "remove:unknown",
  "remove:scope",
  "schema:defect",
];

interface Fails {
  readonly id: Failing;
  readonly sub: "list" | "get" | "set" | "remove" | "schema";
  readonly world: World;
  readonly args: ReadonlyArray<string>;
  /** The setting the typed name found, when it found one. */
  readonly found: string | undefined;
  /** A typed name that is no setting: it is never recorded. */
  readonly typed: string | undefined;
  /** A defect, not a `SettingsError`. */
  readonly defect?: true;
}

/** The runs of C8: each subcommand failing, each in the way the plan names. */
const failing = (draw: CliDraw): ReadonlyArray<Fails> => {
  const { app } = draw;
  const base = writable(draw);
  const world = worldFrom(base, ROOT);
  const settings = joinedGroup(base).settings;
  const nameAt = (n: number) => settings[n]?.name ?? "";

  // (t) a fault in a setting that sorts after others that resolved: a variable for a file-only setting named `zz...`.
  const last = "zzzzzzzzzzzzzzzz.fault";

  const late = scene(
    draw,
    [
      { kind: "int", source: "repo" },
      { kind: "text", source: "default" },
      { kind: "text", source: "repo", fileOnly: true, name: last },
    ],
    [[0, 1, 2]],
  );

  const lateWorld: World = { ...worldFrom(late, ROOT), env: { ...late.env, [variable(app, last)]: "x" } };

  const stale = scene(draw, [{ kind: "int", source: "repo" }], [[0]], { version: "9.9.9" });

  const unknownKey = scene(draw, [{ kind: "int", source: "repo" }], [[0]]);

  const unknownWorld: World = {
    ...worldFrom(unknownKey, ROOT),
    files: {
      [repoPath(unknownKey, ROOT)]: `${unknownKey.repoText}\n[nosuch]\nkey = 1\n`,
      [userPath(unknownKey)]: unknownKey.userText,
    },
  };

  const typed = oneEdit(nameAt(0));

  const kind = LOOSE[(draw.numbers[0] ?? 0) % LOOSE.length];
  const loose = SettingGroup.make(app, looseSetting(settingName(draw, 0), kind?.schema ?? Schema.String));

  return [
    { id: "list:late-fault", sub: "list", world: lateWorld, args: ["list"], found: undefined, typed: undefined },
    { id: "list:unknown-key", sub: "list", world: unknownWorld, args: ["list"], found: undefined, typed: undefined },
    {
      id: "list:version",
      sub: "list",
      world: worldFrom(stale, ROOT),
      args: ["list"],
      found: undefined,
      typed: undefined,
    },
    {
      id: "get:late-fault",
      sub: "get",
      world: lateWorld,
      args: ["get", settingName(draw, 0)],
      found: settingName(draw, 0),
      typed: undefined,
    },
    {
      id: "get:version",
      sub: "get",
      world: worldFrom(stale, ROOT),
      args: ["get", settingName(draw, 0)],
      found: settingName(draw, 0),
      typed: undefined,
    },
    { id: "get:unknown", sub: "get", world, args: ["get", typed], found: undefined, typed },
    { id: "set:unknown", sub: "set", world, args: ["set", typed, "1"], found: undefined, typed },
    {
      id: "set:scope",
      sub: "set",
      world,
      args: ["set", nameAt(3), "abc", "--file", "user"],
      found: nameAt(3),
      typed: undefined,
    },
    { id: "set:invalid", sub: "set", world, args: ["set", nameAt(0), "abc"], found: nameAt(0), typed: undefined },
    { id: "remove:unknown", sub: "remove", world, args: ["remove", typed], found: undefined, typed },
    {
      id: "remove:scope",
      sub: "remove",
      world,
      args: ["remove", nameAt(3), "--file", "user"],
      found: nameAt(3),
      typed: undefined,
    },
    {
      id: "schema:defect",
      sub: "schema",
      world: { ...world, groups: [loose] },
      args: ["schema"],
      found: undefined,
      typed: undefined,
      defect: true,
    },
  ];
};

// Plants: (t) print each block as it is made: a fault in a later setting leaves earlier blocks printed, red; (m) annotate
// the setting before it is found: a mistyped name is recorded, red.
it.effect.prop(
  "C8 a failure prints nothing, and each run is one span: for every generated failing run of every subcommand, standard output is empty; each `get`, `list` and `schema` run ends one span `config.<subcommand>` with `kalfa.config.app` and no other `config.` span, and `kalfa.config.setting` is never a name that was typed and found no setting",
  { draw: CliDraw },
  ({ draw }) =>
    Effect.gen(function* () {
      const reach = new Reach<Failing>(FAILING);

      for (const f of failing(draw)) {
        const ran = yield* run(f.world, f.args);
        const spans = configSpans(ran);

        expect(Exit.isFailure(ran.exit), `${f.id}: the run fails`).toBe(true);
        expect(ran.stdout, `${f.id}: nothing is printed`).toBe("");

        if (f.defect === true) {
          // A schema JSON Schema cannot hold is the program's own fault: a defect, with no `SettingsError` beside it.
          expect(
            Exit.isFailure(ran.exit) && ran.exit.cause.reasons.every((reason) => reason._tag === "Die"),
            `${f.id}: a defect`,
          ).toBe(true);
        } else {
          expect(failure(ran).reason, `${f.id}: one SettingsError`).toBeDefined();
        }

        if (f.sub === "set" || f.sub === "remove") {
          // `set` and `remove` keep the disk call's own span, when the call is made.
          expect(
            spans.map((span) => span.name).filter((name) => name !== `config.${f.sub}`),
            `${f.id}: no other span`,
          ).toEqual([]);
          // Every run of `set` and `remove` leaves a span, a refusal before the disk call included.
          expect(spans.length, `${f.id}: a span`).toBeGreaterThanOrEqual(1);
        } else {
          expect(
            spans.map((span) => span.name),
            `${f.id}: one span`,
          ).toEqual([`config.${f.sub}`]);
        }

        for (const span of spans) {
          expect(span.attributes.get("kalfa.config.app"), `${f.id}: the app`).toBe(f.world.app);

          const recorded = span.attributes.get("kalfa.config.setting");

          if (f.found === undefined) {
            expect(recorded, `${f.id}: no setting was found`).toBeUndefined();
          } else {
            expect([undefined, f.found], `${f.id}: the setting found`).toContain(recorded);
          }

          // A name that was typed and found no setting is recorded nowhere: no attribute holds it.
          if (f.typed !== undefined) {
            for (const held of span.attributes.values()) {
              expect(String(held), `${f.id}: a name that is no setting is not recorded`).not.toBe(f.typed);
            }
          }
        }

        reach.mark(f.id);
      }

      reach.done();
    }),
  check,
);

// A success is one span as well: `get` of a found name records it, and `list`, `schema` and `reference` record none.
it.effect.prop(
  "C8b each successful `get`, `list`, `schema` and `reference` run ends one span `config.<subcommand>` with `kalfa.config.app`, and `kalfa.config.setting` exactly when a typed name was found",
  { draw: CliDraw },
  ({ draw }) =>
    Effect.gen(function* () {
      const reach = new Reach<"get" | "list" | "schema" | "reference">(["get", "list", "schema", "reference"]);
      const s = writable(draw);
      const world = worldFrom(s, ROOT);
      const name = s.entries[0]?.spec.name ?? "";

      for (const [sub, args, found] of [
        ["get", ["get", name], name],
        ["list", ["list"], undefined],
        ["schema", ["schema"], undefined],
        ["reference", ["reference"], undefined],
      ] as const) {
        const ran = yield* run(world, args);
        const spans = configSpans(ran);

        ended(ran, sub);
        expect(
          spans.map((span) => span.name),
          `${sub}: one span`,
        ).toEqual([`config.${sub}`]);
        expect(spans[0]?.attributes.get("kalfa.config.app"), `${sub}: the app`).toBe(s.app);
        expect(spans[0]?.attributes.get("kalfa.config.setting"), `${sub}: the setting`).toBe(found);

        reach.mark(sub);
      }

      reach.done();
    }),
  check,
);

// ---------------------------------------------------------------------------------------------
// C11, the command's root is the one it was handed
// ---------------------------------------------------------------------------------------------

type Rooted = "list" | "get" | "set" | "remove" | "missing";

// Owner's answer on issue 2076: `kalfa` is the one place that decides the repo's root and hands it to every subcommand, so
// no subcommand reads the current folder on its own. The command takes `repo` and reads the repo configuration in that
// folder only: a file of another folder is never read or written, whether it is the current folder's (`.<app>/<app>.toml`
// as a relative path), the filesystem root's or the parent folder's.
// Plants: read the repo configuration from `.` and ignore `repo`: the folder's own file is not found, red; fall back to the
// parent folder's file when the folder has none: red.
it.effect.prop(
  "C11 the command's root is the one it was handed: for a generated repo folder, `list`, `get`, `set` and `remove` read and write the repo configuration at `<repo>/.<app>/<app>.toml`, and no call of the file system names a path of any other folder",
  { draw: CliDraw },
  ({ draw }) =>
    Effect.gen(function* () {
      const reach = new Reach<Rooted>(["list", "get", "set", "remove", "missing"]);
      const s = writable(draw);
      const repo = draw.repo;
      const world = worldFrom(s, repo);
      const oracle = joinedGroup(s);

      // Files of other folders hold other values of the same settings: the current folder's (as a relative path), the
      // filesystem root's, and the parent folder's.
      const own = repoPath(s, repo);
      const decoyText = s.repoText.replace(/= (\d+)/gu, (_, digits: string) => `= ${Number(digits) + 1}`);
      const parent = repo.slice(0, repo.lastIndexOf("/"));
      const relative = `.${s.app}/${s.app}.toml`;
      // A read of `.<app>/<app>.toml` as a relative path is a read of the file system's root folder, so that is its decoy.
      const decoys = [`/${relative}`, `${parent}/${relative}`].filter((path) => path !== own);

      const decoyed: World = {
        ...world,
        files: { ...world.files, ...Object.fromEntries(decoys.map((path) => [path, decoyText])) },
      };

      const isText = Schema.is(Schema.String);

      const touched = (calls: ReadonlyArray<{ readonly args: ReadonlyArray<unknown> }>) =>
        calls.flatMap((call) => (isText(call.args[0]) ? [call.args[0]] : []));

      const clean = (id: Rooted, ran: Ran, text = decoyText) => {
        for (const path of touched(ran.calls)) {
          expect(decoys, `${id}: ${path} is no other folder's file`).not.toContain(path);
          expect(path.startsWith("/"), `${id}: ${path} is absolute`).toBe(true);
        }

        for (const path of decoys) {
          expect(ran.files[path], `${id}: the file of another folder is as it was`).toBe(text);
        }
      };

      const listed1 = yield* run(decoyed, ["list"]);

      ended(listed1, "list");
      expect(listed1.stdout, "list: the folder's own file is read").toBe(listing(s));
      clean("list", listed1);
      reach.mark("list");

      const first = s.entries.find((one) => one.source === "repo");
      const got = yield* run(decoyed, ["get", first?.spec.name ?? ""]);

      ended(got, "get");
      expect(got.stdout, "get: the folder's own file is read").toBe(`${JSON.stringify(first?.json)}\n`);
      clean("get", got);
      reach.mark("get");

      const e = s.entries.find((one) => one.source === "repo" && one.spec.kind === "int");

      if (e === undefined) {
        return expect.fail("the scene has an int setting in the repo file");
      }

      const written = yield* run(decoyed, ["set", e.spec.name, "4242"]);
      const expected = yield* SettingGroup.edit(oracle, decoyed.files[own] ?? "", "repo").set(e.setting, 4242);

      ended(written, "set");
      expect(written.files[own], "set: the folder's own file is written").toBe(expected);
      clean("set", written);
      reach.mark("set");

      const removed = yield* run(decoyed, ["remove", e.spec.name]);
      const without = yield* SettingGroup.edit(oracle, decoyed.files[own] ?? "", "repo").remove(e.setting);

      ended(removed, "remove");
      expect(removed.files[own], "remove: the folder's own file is written").toBe(without);
      clean("remove", removed);
      reach.mark("remove");

      // The folder holds no repo configuration: no folder above or beside it is looked in, and the settings come from the
      // user file, the variables and the defaults. The files of the other folders would be refused if they were read.
      const bare = quiet(draw);

      const bareWorld: World = {
        ...worldFrom(bare, repo),
        files: { [userPath(bare)]: bare.userText, ...Object.fromEntries(decoys.map((path) => [path, s.repoText])) },
      };

      const absent = yield* run(bareWorld, ["list"]);

      ended(absent, "missing");
      expect(absent.stdout, "missing: no other folder's file is read").toBe(listing(bare));
      clean("missing", absent, s.repoText);
      reach.mark("missing");

      reach.done();
    }),
  check,
);

// ---------------------------------------------------------------------------------------------
// C12, a fault in the environment ends as the run says
// ---------------------------------------------------------------------------------------------

type Ended = "list" | "get" | "set" | "remove";

// The user configuration is found from the environment, and a fault there ends with the run's own closing sentence: a read
// says `<app> would not start with these settings.`, a write `The <file> configuration was not changed.`
// Plants: delete the `closing` of the user file's place in `load` (internal/start.ts): a read ends `<app> did not start.`,
// red; delete it in the disk call's place: a write ends with the same, red.
it.effect.prop(
  "C12 a fault in the environment ends as the run says: when the environment cannot be read, `list` and `get` fail `read` naming `<APP>_HOME` and ending `<app> would not start with these settings.`, and `set` and `remove` end `The <file> configuration was not changed.`, with nothing printed or changed",
  { draw: CliDraw },
  ({ draw }) =>
    Effect.gen(function* () {
      const reach = new Reach<Ended>(["list", "get", "set", "remove"]);
      const s = writable(draw);
      const world = { ...worldFrom(s, ROOT), unreadable: true };
      const home = `${s.app.toUpperCase()}_HOME`;
      const name = s.entries[0]?.spec.name ?? "";
      const row = (n: number) => joinedGroup(s).settings[n]?.name ?? "";

      const cases: ReadonlyArray<readonly [Ended, ReadonlyArray<string>, string]> = [
        ["list", ["list"], `${s.app} would not start with these settings.`],
        ["get", ["get", name], `${s.app} would not start with these settings.`],
        ["set", ["set", row(0), "4200"], "The repo configuration was not changed."],
        ["set", ["set", row(0), "4200", "--file", "user"], "The user configuration was not changed."],
        ["remove", ["remove", row(1)], "The user configuration was not changed."],
        ["remove", ["remove", row(0), "--file", "repo"], "The repo configuration was not changed."],
      ];

      for (const [id, args, closing] of cases) {
        const ran = yield* run(world, args);
        const out = failure(ran);

        expect(out.reason, `${args.join(" ")}: the reason`).toBe("read");
        expect(
          out.message.startsWith(`${home} could not be read.`),
          `${args.join(" ")}: names ${home}: ${out.message}`,
        ).toBe(true);
        expect(out.message.endsWith(closing), `${args.join(" ")}: ends ${closing}: ${out.message}`).toBe(true);
        expect(ran.stdout, `${args.join(" ")}: nothing is printed`).toBe("");
        expect(ran.files, `${args.join(" ")}: no file changed`).toEqual(world.files);
        reach.mark(id);
      }

      reach.done();
    }),
  check,
);
