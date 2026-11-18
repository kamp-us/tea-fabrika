// T1076, slice 1, next/: K1 to K5 of the approved plan (docs/plan/quests/kalfa-config-PLAN.md), for
// `settings/App.ts` and the generic load. Written before the modules. Slice 2 moves this file to
// kalfa/config/src/App.test.ts with `git mv`.
//
// The shape these tests hold the engine to:
// - `App.make({ name, list })` gives an app whose `prefix`, `home`, `repo`, `person` and `version`
//   all come from its one-word name, and whose `Setting.make`, `Setting.group` and `Sources.env`
//   are bound to it. Every `Setting` carries its `app`. `App.make` throws for a name that is not one
//   lowercase word, and `Setting.group` throws for declarations of two apps, naming both paths.
// - `Load.load(group, { repo, home, flags, env, version })`, in `settings/Load.ts`, is the generic
//   load. It reads the repo's file at `<repo>/.<app>/<app>.toml`, named `.<app>/<app>.toml`, and the
//   person's file at `$<APP>_HOME/<app>.toml` when `env` holds `<APP>_HOME`, else at
//   `<home>/.<app>/<app>.toml`, named `~/.<app>/<app>.toml`, through `FileSystem.readFileString`.
//   A missing file counts as empty. It answers `{ values, snapshot }` as fabrika's load does. It
//   lives beside the engine, not in `node/settings/`, because fabrika's own
//   `node/settings/Load.ts` keeps `load({ person, repo, flags, env, version })` for the F1 laws.
// - `Files.validate`, `Sources.resolve`, `Snapshot.read`, `Reference.rows`, `Reference.warnings`
//   and `Print` keep the signatures they have today, and read the app from the declarations.
import { describe, expect, it } from "@effect/vitest";
import { Recorder, runsFor } from "@kampus/vitest";
import { Effect, Exit, FileSystem, Layer, Path, PlatformError, Schema } from "effect";
import { Digest } from "effect/crypto";
import * as App from "./App.ts";
import * as Files from "./Files.ts";
import * as Load from "./Load.ts";
import * as Print from "./Print.ts";
import * as Reference from "./Reference.ts";
import * as Snapshot from "./Snapshot.ts";
import * as Sources from "./Sources.ts";
import { Toml, type TomlDocument } from "./Toml.ts";
import * as TomlParser from "./TomlParser.ts";

const check = { arbitrary: { runs: runsFor({ fast: 25, full: 100 }), size: 100 } };

const Port = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 65535 }));
const DEFAULT = 18787;
const ROOT = "/work";
const HOME = "/people/one";
const VERSION = "1.2.3";

const services = Layer.mergeAll(TomlParser.layer, Digest.layerWebCrypto);

// App.Name is private; keep its pattern and the old generated bounds here.
const Word = Schema.String.check(
  Schema.isPattern(/^[a-z][a-z0-9]{3,7}$/u),
  Schema.makeFilter((n) => !n.includes("fabrika")),
);

const Verb = Schema.Literals(["settings", "config get", "prefs"]);

const Names = Schema.Tuple([Word, Word, Verb, Verb]).check(
  Schema.makeFilter(([a, b]) => !a.includes(b) && !b.includes(a)),
);

const PINNED = ["kalfa", "fabrika", "config get", "settings"] as const;

const apps = ([a, b, va, vb]: readonly [string, string, string, string]) => ({
  a: App.make({ name: a, list: `${a} ${va}` }),
  b: App.make({ name: b, list: `${b} ${vb}` }),
});

const SettingPath = Schema.String.check(
  Schema.isPattern(/^[a-z]{1,6}(-[a-z]{1,4})?\.[a-z]{1,6}$/u),
  Schema.makeFilter((path) => {
    const section = path.split(".")[0]!;
    return section !== "version" && !section.endsWith("-version");
  }),
);

const Paths = Schema.Array(SettingPath).check(
  Schema.isMinLength(1),
  Schema.isMaxLength(4),
  Schema.makeFilter((list) => new Set(list.map((path) => path.split(".")[0])).size === list.length),
);

const Value = Port.check(Schema.makeFilter((p) => p !== DEFAULT));
const PLACES = ["b-repo", "b-person", "b-env", "a-repo", "a-person", "a-env", "none"] as const;
type Place = (typeof PLACES)[number];

const Selection = Schema.Array(
  Schema.Struct({ path: SettingPath, place: Schema.Literals(PLACES), value: Value }),
).check(
  Schema.isMinLength(1),
  Schema.isMaxLength(4),
  Schema.makeFilter((list) => new Set(list.map(({ path }) => path.split(".")[0])).size === list.length),
);

const Triple = Schema.Tuple([
  Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 20 })),
  Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 20 })),
  Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 20 })),
]);

const dotted = ([x, y, z]: readonly [number, number, number]) => `${x}.${y}.${z}`;

const later = (w: readonly number[], r: readonly number[]) =>
  w[0]! !== r[0]! ? w[0]! > r[0]! : w[1]! !== r[1]! ? w[1]! > r[1]! : w[2]! > r[2]!;

const Hostile = Schema.String.check(Schema.isPattern(/^sk-([A-Za-z0-9]{6,12})["/ +\\&][A-Za-z0-9]{3}$/u));
const HiddenCase = Schema.Struct({ pair: Names, list: Paths, word: Hostile });

const VersionCase = Schema.Struct({
  pair: Names,
  list: Paths,
  running: Triple,
  wanted: Triple,
  theirs: Schema.Boolean,
});

const NameCase = Schema.Union([
  Schema.String.check(Schema.isPattern(/^[a-zA-Z0-9_.-]{0,10}$/u)),
  Schema.String.check(Schema.isPattern(/^[a-z][a-z0-9]{0,8}$/u)),
  Schema.String.check(Schema.isPattern(/^[a-z]{1,4}[_\-.AZ][a-z]{0,4}$/u)),
  Schema.String.check(Schema.isPattern(/^[0-9][a-z0-9]{0,6}$/u)),
]);

const envName = (prefix: string, path: string) =>
  [prefix, ...path.split(".").map((s) => s.replace(/-/g, "_").toUpperCase())].join("_");

/** A group of the app's own declarations, a port each, settable in both files. */
const groupFor = (app: App.App, list: ReadonlyArray<string>) =>
  app.Setting.group(
    Object.fromEntries(
      list.map((path, n) => [
        `s${n}`,
        app.Setting.make(path, {
          schema: Port,
          default: DEFAULT,
          doc: "A port.",
          scope: ["repo", "person"],
          reload: "restart",
          since: "0.0.0",
        }),
      ]),
    ),
  );

// ---------------------------------------------------------------------------------------------
// An in-memory disk and the generic load on it
// ---------------------------------------------------------------------------------------------

/** A TOML file of `path = value` lines, one table each, with the line every leaf sits on. */
const toml = (entries: ReadonlyArray<readonly [string, string]>) => {
  const lines = ["# a settings file"];
  const at: Record<string, number> = {};

  for (const [path, raw] of entries) {
    const [table, ...rest] = path.split(".");
    lines.push("", `[${table}]`, `${rest.join(".")} = ${raw}`);
    at[path] = lines.length;
  }

  return { text: `${lines.join("\n")}\n`, at };
};

interface Disk {
  readonly files: Readonly<Record<string, string>>;
  /** A path whose read fails with something other than NotFound. */
  readonly broken?: string;
}

const disk = (input: Disk) =>
  Layer.merge(
    Recorder.layer(
      FileSystem.FileSystem,
      FileSystem.makeNoop({
        exists: (path) => Effect.succeed(input.files[path] !== undefined),
        readFileString: (path) => {
          const text = input.files[path];
          return path === input.broken
            ? Effect.fail(
                PlatformError.systemError({
                  module: "FileSystem",
                  method: "readFileString",
                  _tag: "PermissionDenied",
                  pathOrDescriptor: path,
                }),
              )
            : text === undefined
              ? Effect.fail(
                  PlatformError.systemError({
                    module: "FileSystem",
                    method: "readFileString",
                    _tag: "NotFound",
                    pathOrDescriptor: path,
                  }),
                )
              : Effect.succeed(text);
        },
      }),
    ),
    Path.layer,
  );

/** Where an app's two files sit on the disk, with or without `<APP>_HOME` set. */
const placesFor = (app: App.App, homeSet: boolean) => {
  const home = `/apps/${app.name}`;
  return {
    repo: { path: `${ROOT}/.${app.name}/${app.name}.toml`, name: app.repo },
    person: homeSet
      ? { path: `${home}/${app.name}.toml`, name: `$${app.prefix}_HOME/${app.name}.toml` }
      : { path: `${HOME}/.${app.name}/${app.name}.toml`, name: app.person },
    env: homeSet ? { [app.home]: home } : {},
  };
};

const run = Effect.fnUntraced(function* (
  group: Parameters<typeof Load.load>[0],
  input: Disk,
  env: Readonly<Record<string, string>>,
  version = VERSION,
  flags: Readonly<Record<string, string>> = {},
) {
  return yield* Effect.gen(function* () {
    const exit = yield* Load.load(group, { repo: ROOT, home: HOME, flags, env, version }).pipe(Effect.exit);
    const reads = (yield* Recorder.calls(FileSystem.FileSystem, "readFileString")).map(([path]) => path);
    return { exit, reads };
  }).pipe(Effect.provide(Layer.mergeAll(disk(input), services)));
});

const failure = (exit: Exit.Exit<unknown, unknown>) => {
  if (Exit.isSuccess(exit)) {
    return undefined;
  }

  const reason = exit.cause.reasons.find((r) => r._tag === "Fail");
  return reason?._tag === "Fail" ? reason.error : undefined;
};

/** The message of a failed effect, or the empty string. */
const message = (exit: Exit.Exit<unknown, unknown>) => {
  const error = failure(exit);
  return Schema.is(Files.SettingsError)(error) ? error.message : "";
};

const parse = (text: string) =>
  Effect.gen(function* () {
    const parser = yield* Toml;
    return yield* parser.parse(text);
  });

/** Every message an app's own words must reach, and no other app's. */
const words = (own: App.App, other: App.App, text: string) => {
  expect(text).toContain(own.list);
  expect(text).not.toContain(other.list);
  expect(own.name === "fabrika" || !text.includes("fabrika")).toBe(true);
};

const ONE_WORD = /^[a-z][a-z0-9]*$/;

/** Which rule a name breaks, for coverage, or `ok`. */
const broken = (name: string) =>
  name.length === 0
    ? "empty"
    : /[A-Z]/.test(name)
      ? "capital"
      : /^[0-9]/.test(name)
        ? "digit-first"
        : name.includes("_")
          ? "underscore"
          : name.includes("-")
            ? "hyphen"
            : name.includes(".")
              ? "dot"
              : "ok";

const isolation = Effect.fnUntraced(function* (
  pair: readonly [string, string, string, string],
  list: ReadonlyArray<string>,
  picks: ReadonlyArray<readonly [Place, number]>,
  aHome: boolean,
  bHome: boolean,
  reached: Set<Place>,
) {
  const { a, b } = apps(pair);
  const group = groupFor(a, list);
  const own = placesFor(a, aHome),
    other = placesFor(b, bHome);
  const entries: Record<"a-repo" | "a-person" | "b-repo" | "b-person", Array<readonly [string, string]>> = {
    "a-repo": [],
    "a-person": [],
    "b-repo": [],
    "b-person": [],
  };
  const env: Record<string, string> = { ...own.env, ...other.env };
  list.forEach((path, n) => {
    const [place, value] = picks[n]!;
    reached.add(place);

    if (place === "a-env") {
      env[envName(a.prefix, path)] = String(value);
    } else if (place === "b-env") {
      env[envName(b.prefix, path)] = String(value);
    } else if (place !== "none") {
      entries[place].push([path, String(value)]);
    }
  });
  const texts = {
    "a-repo": toml(entries["a-repo"]),
    "a-person": toml(entries["a-person"]),
    "b-repo": toml(entries["b-repo"]),
    "b-person": toml(entries["b-person"]),
  };
  const files = {
    [own.repo.path]: texts["a-repo"].text,
    [own.person.path]: texts["a-person"].text,
    [other.repo.path]: texts["b-repo"].text,
    [other.person.path]: texts["b-person"].text,
  };
  const { exit, reads } = yield* run(group, { files }, env);
  expect(failure(exit)).toBeUndefined();

  if (Exit.isFailure(exit)) {
    return;
  }

  const loaded = exit.value;
  list.forEach((path, n) => {
    const [place, value] = picks[n]!;
    const want =
      place === "a-repo"
        ? { value, origin: { _tag: "file", file: a.repo, line: texts["a-repo"].at[path] } }
        : place === "a-person"
          ? { value, origin: { _tag: "file", file: own.person.name, line: texts["a-person"].at[path] } }
          : place === "a-env"
            ? { value, origin: { _tag: "env", name: envName(a.prefix, path) } }
            : { value: DEFAULT, origin: { _tag: "default" } };
    expect({ value: loaded.snapshot.values[path], origin: loaded.snapshot.origins[path] }).toEqual(want);
  });
  // The other app's files are never opened.
  expect(reads).not.toContain(other.repo.path);
  expect(reads).not.toContain(other.person.path);
  expect(reads).toContain(own.repo.path);
  expect(reads).toContain(own.person.path);
});

const naming = Effect.fnUntraced(function* (
  pair: readonly [string, string, string, string],
  list: ReadonlyArray<string>,
  value: number,
) {
  const { a, b } = apps(pair);
  const upper = pair[0].toUpperCase();
  // The names the app makes.
  expect(a.name).toBe(pair[0]);
  expect(a.prefix).toBe(upper);
  expect(a.home).toBe(`${upper}_HOME`);
  expect(a.repo).toBe(`.${pair[0]}/${pair[0]}.toml`);
  expect(a.person).toBe(`~/.${pair[0]}/${pair[0]}.toml`);
  expect(a.version.path).toBe(`${pair[0]}-version`);
  expect(a.version.scope).toEqual(["repo"]);
  expect(a.version.app).toBe(a);
  const group = groupFor(a, list);

  for (const d of group.declarations) {
    expect(d.env).toBe(envName(upper, d.path));
    expect(d.app).toBe(a);
  }

  const first = list[0]!;
  const table = first.split(".")[0]!;
  const empty = { value: {}, spans: [] };
  const ran = yield* Effect.gen(function* () {
    const resolved = yield* Sources.resolve(group, {
      flags: Sources.flags({ [first]: String(value) }),
      env: a.Sources.env(Object.fromEntries(list.slice(1).map((p) => [envName(upper, p), String(value)]))),
      repo: Sources.file(a.repo, empty),
      person: Sources.file(a.person, empty),
    });
    const at = (document: TomlDocument) => ({
      repo: { file: a.repo, document },
      person: { file: a.person, document: empty },
    });
    const unknown = yield* Files.validate(group, at(yield* parse("[zzzzzz]\nunknown = 1\n")), {
      version: VERSION,
    }).pipe(Effect.exit);
    const asTable = yield* Files.validate(group, at(yield* parse(`${table} = 1\n`)), {
      version: VERSION,
    }).pipe(Effect.exit);
    const refused = yield* Sources.resolve(group, {
      flags: Sources.flags({}),
      env: a.Sources.env({ [envName(upper, first)]: "not a port" }),
      repo: Sources.file(a.repo, empty),
      person: Sources.file(a.person, empty),
    }).pipe(Effect.exit);
    const snapshot = yield* Snapshot.make(group, resolved);
    // One key left at its default, so the report closes with its `--all` line.
    const partial = Reference.rows(group, {
      ...snapshot,
      origins: { ...snapshot.origins, [first]: { _tag: "default" } },
    });
    const homes = yield* Effect.forEach(
      [a, b],
      (app) =>
        Snapshot.read(group, {
          ...snapshot,
          origins: {
            ...snapshot.origins,
            [first]: { _tag: "file", file: `$${app.prefix}_HOME/${app.name}.toml`, line: 1 },
          },
        }).pipe(Effect.exit),
      { concurrency: 1 },
    );
    return { resolved, unknown, asTable, refused, partial, homes };
  }).pipe(Effect.provide(services));
  // The flag is `--section.key`, the variable `<APP>_<SECTION>_<KEY>`.
  expect(ran.resolved.origins[first]).toEqual({ _tag: "flag", name: `--${first}` });

  for (const p of list.slice(1)) {
    expect(ran.resolved.origins[p]).toEqual({ _tag: "env", name: envName(upper, p) });
  }

  // Every message names this app's own list command.
  words(a, b, message(ran.unknown));
  words(a, b, message(ran.asTable));
  words(a, b, message(ran.refused));
  const report = Print.report(ran.partial, { all: false });
  words(a, b, report);
  // The snapshot accepts the app's own `$<APP>_HOME` file and refuses the other app's.
  expect(Exit.isSuccess(ran.homes[0]!)).toBe(true);
  expect(Exit.isFailure(ran.homes[1]!)).toBe(true);
});

const warning = Effect.fnUntraced(function* (
  pair: readonly [string, string, string, string],
  list: ReadonlyArray<string>,
  value: number,
) {
  const { a, b } = apps(pair);
  const group = a.Setting.group(
    Object.fromEntries(
      list.map((path, n) => [
        `s${n}`,
        a.Setting.make(path, {
          schema: Port,
          default: DEFAULT,
          doc: "A port.",
          scope: ["repo", "person"],
          reload: "restart",
          // Newer than the repo's stated minimum, so a set key warns.
          since: "9.0.0",
        }),
      ]),
    ),
  );
  const empty = { value: {}, spans: [] };
  const rows = yield* Effect.gen(function* () {
    const resolved = yield* Sources.resolve(group, {
      flags: Sources.flags(Object.fromEntries(list.map((p) => [p, String(value)]))),
      env: a.Sources.env({}),
      repo: Sources.file(a.repo, empty),
      person: Sources.file(a.person, empty),
    });
    return Reference.rows(group, yield* Snapshot.make(group, resolved));
  }).pipe(Effect.provide(services));
  const lines = Print.warnings(Reference.warnings(rows, "1.0.0"));
  expect(lines).toHaveLength(list.length);

  for (const line of lines) {
    expect(line).toContain(a.name);
    expect(line).not.toContain(b.name);
    expect(a.name === "fabrika" || !line.includes("fabrika")).toBe(true);
  }
});

const nameCheck = (name: string, reached: Set<string>) => {
  const rule = broken(name);
  reached.add(rule);
  const made = () => App.make({ name, list: `${name} settings` });

  expect(rule === "ok").toBe(ONE_WORD.test(name));

  if (ONE_WORD.test(name)) {
    expect(made).not.toThrow();
  } else {
    expect(made).toThrow();
  }
};

const mixed = (
  pair: readonly [string, string, string, string],
  left: ReadonlyArray<string>,
  right: ReadonlyArray<string>,
) => {
  const { a, b } = apps(pair);
  const own = groupFor(a, left);
  const theirs = groupFor(b, right);
  const x = own.declarations[0]!;
  const y = theirs.declarations[0]!;

  for (const app of [a, b]) {
    const grouped = () => app.Setting.group({ x, y });
    expect(grouped).toThrow(x.path);
    expect(grouped).toThrow(y.path);
  }

  // One app's own declarations still group.
  expect(() => a.Setting.group({ ...own.settings })).not.toThrow();
};

const minimum = Effect.fnUntraced(function* (
  pair: readonly [string, string, string, string],
  list: ReadonlyArray<string>,
  running: readonly [number, number, number],
  wanted: readonly [number, number, number],
  theirs: boolean,
  reached: Set<string>,
) {
  const { a, b } = apps(pair);
  const group = a.Setting.group({ ...groupFor(a, list).settings, version: a.version });
  const owner = theirs ? b : a;
  const text = `${owner.version.path} = ${JSON.stringify(dotted(wanted))}\n`;
  const exit = yield* Effect.gen(function* () {
    const document = yield* parse(text);
    return yield* Files.validate(
      group,
      { repo: { file: a.repo, document }, person: { file: a.person, document: { value: {}, spans: [] } } },
      { version: dotted(running) },
    ).pipe(Effect.exit);
  }).pipe(Effect.provide(services));
  const error = failure(exit);
  const newer = later(wanted, running);
  reached.add(`${theirs ? "theirs" : "own"}-${newer ? "newer" : "older"}`);

  const want = theirs ? "unknown" : newer ? "version" : undefined;
  expect(Schema.is(Files.SettingsError)(error) ? error.reason : error).toBe(want);
  // A version refusal names this app, never the other, and never fabrika for another app.
  const said = message(exit);
  expect(want !== "version" || said.includes(a.name)).toBe(true);
  expect(want !== "version" || !said.includes(b.name)).toBe(true);
  expect(want !== "version" || a.name === "fabrika" || !said.includes("fabrika")).toBe(true);
});

/** Every form a secret may take in text: raw, JSON-escaped and URL-encoded. */
const forms = (secret: string) => [secret, JSON.stringify(secret).slice(1, -1), encodeURIComponent(secret)];

/** A value as searchable text: a bigint prints as its digits, every other value as JSON does. */
const printed = (value: unknown) =>
  JSON.stringify(value, (_key, v: unknown) => (typeof v === "bigint" ? String(v) : v));

const HIDDEN = ["b-env", "b-repo", "b-person", "a-table", "a-array", "a-scalar", "a-unknown"] as const;

const hidden = Effect.fnUntraced(function* (
  pair: readonly [string, string, string, string],
  list: ReadonlyArray<string>,
  word: string,
  place: (typeof HIDDEN)[number],
  unreadable: boolean,
) {
  const { a, b } = apps(pair);
  const group = groupFor(a, list);
  const own = placesFor(a, false),
    other = placesFor(b, false);
  const first = list[0]!;
  const [table, ...rest] = first.split(".");
  const s = JSON.stringify(word);
  const env: Record<string, string> = place === "b-env" ? { [envName(b.prefix, first)]: word } : {};
  const files: Record<string, string> = {
    [own.repo.path]:
      place === "a-table"
        ? `[${first}]\nnested = ${s}\n`
        : place === "a-array"
          ? `[${table}]\n${rest.join(".")} = [${s}]\n`
          : place === "a-scalar"
            ? `${table} = ${s}\n`
            : place === "a-unknown"
              ? `[zz9zz]\nk = ${s}\n`
              : "",
    [own.person.path]: "",
    [other.repo.path]: place === "b-repo" ? `[${table}]\n${rest.join(".")} = ${s}\n` : "",
    [other.person.path]: place === "b-person" ? `[${table}]\n${rest.join(".")} = ${s}\n` : "",
  };
  const { exit } = yield* run(group, { files, ...(unreadable ? { broken: own.person.path } : {}) }, env);
  const outputs: Array<string> = [printed(exit), String(exit)];

  if (Exit.isSuccess(exit)) {
    const loaded = exit.value;
    const rows = Reference.rows(group, loaded.snapshot);
    outputs.push(
      printed(loaded.values),
      JSON.stringify(Schema.encodeSync(Snapshot.Snapshot)(loaded.snapshot)),
      Print.report(rows, { all: true }),
      ...Print.warnings(Reference.warnings(rows, "0.0.0")),
    );
  } else {
    const error = failure(exit);
    expect(error).toBeInstanceOf(Files.SettingsError);
    outputs.push(String(exit.cause), printed(error), error instanceof Error ? error.message : "");
  }

  for (const output of outputs) {
    for (const form of forms(word)) {
      expect(output).not.toContain(form);
    }
  }
});

// K1 plants: hard-code the repo path, env prefix, or home variable to fabrika.
describe("K1, a second app reads only its own", () => {
  it.effect.prop(
    "a value in the other app's files or variables stays at the default; the app's own is read, with its origin",
    { pair: Names, selection: Selection, aHome: Schema.Boolean, bHome: Schema.Boolean },
    ({ pair, selection, aHome, bHome }) =>
      Effect.gen(function* () {
        const reached = new Set<Place>();
        const list = selection.map(({ path }) => path);
        yield* isolation(
          pair,
          list,
          selection.map(({ place, value }) => [place, value]),
          aHome,
          bHome,
          reached,
        );

        for (const place of PLACES) {
          for (const ownHome of [false, true]) {
            for (const otherHome of [false, true]) {
              yield* isolation(
                pair,
                list,
                selection.map(({ value }) => [place, value]),
                ownHome,
                otherHome,
                reached,
              );
            }
          }
        }

        expect([...reached].sort()).toEqual([...PLACES].sort());
      }),
    check,
  );
  it.effect("pinned: T1076 original isolation examples and captured plant inputs", () =>
    Effect.gen(function* () {
      const reached = new Set<Place>();
      yield* isolation(PINNED, ["leak.words"], [["b-env", 1]], false, false, reached);
      yield* isolation(PINNED, ["leak.words"], [["b-repo", 2]], false, true, reached);
      yield* isolation(PINNED, ["leak.words"], [["b-person", 3]], true, true, reached);
      yield* isolation(PINNED, ["leak.words"], [["a-env", 4]], false, false, reached);
      yield* isolation(PINNED, ["leak.words"], [["a-person", 5]], true, false, reached);
    }),
  );
});

// K2 plants: hard-code the list command or snapshot home to fabrika.
describe("K2, every name comes from the app", () => {
  it.effect.prop(
    "names, files, flags, the version key and every message come from the app's own name and list",
    { pair: Names, list: Paths, value: Value },
    ({ pair, list, value }) => naming(pair, list, value),
    check,
  );
  it.effect.prop(
    "a version warning names the app, never another",
    { pair: Names, list: Paths, value: Value },
    ({ pair, list, value }) => warning(pair, list, value),
    check,
  );
  it.effect("pinned: T1076 original naming and warning examples and captured plant inputs", () =>
    Effect.gen(function* () {
      yield* naming(PINNED, ["leak.words"], 1);
      yield* warning(PINNED, ["leak.words"], 1);
    }),
  );
});

// K3 plants: permit underscores, or remove the mixed-app refusal.
describe("K3, an app name is one lowercase word, and a group holds one app", () => {
  it.prop(
    "App.make throws for any name that is not one lowercase word, and only for those",
    { name: NameCase, valid: Word },
    ({ name, valid }) => {
      const reached = new Set<string>();

      for (const candidate of [
        name,
        valid,
        "",
        valid.toUpperCase(),
        `1${valid}`,
        `${valid}_`,
        `${valid}-`,
        `${valid}.`,
      ]) {
        nameCheck(candidate, reached);
      }

      expect([...reached].sort()).toEqual(["capital", "digit-first", "dot", "empty", "hyphen", "ok", "underscore"]);
    },
    check,
  );
  it.prop(
    "Setting.group throws for declarations of two apps, naming both paths",
    { pair: Names, left: Paths, right: Paths },
    ({ pair, left, right }) => mixed(pair, left, right),
    check,
  );
  it("pinned: T1076 original name and mixed-group examples, including the captured a_ counterexample", () => {
    const reached = new Set<string>();

    for (const name of ["kal_fa", "", "Kalfa", "1kalfa", "kal-fa", "kal.fa", "kalfa", "a_"]) {
      nameCheck(name, reached);
    }

    mixed(PINNED, ["leak.words"], ["instance.port"]);
  });
});

// K4 plants: read fabrika-version for another app, or remove only Load.load's early supported call.
const earlyMinimum = Effect.fnUntraced(function* (
  pair: readonly [string, string, string, string],
  list: ReadonlyArray<string>,
  running: readonly [number, number, number],
  wanted: readonly [number, number, number],
) {
  const { a } = apps(pair);
  const group = a.Setting.group({ ...groupFor(a, list).settings, version: a.version });
  const newer = dotted([running[0] + 1, wanted[1], wanted[2]]);

  for (const homeSet of [false, true]) {
    const own = placesFor(a, homeSet);

    for (const [minimum, reason] of [
      [newer, "version"],
      [`${dotted(wanted)}-bad`, "invalid"],
    ] as const) {
      const { exit, reads } = yield* run(
        group,
        {
          files: {
            [own.repo.path]: `${a.version.path} = ${JSON.stringify(minimum)}\n[zz9zz]\nunknown = 1\n`,
          },
          broken: own.person.path,
        },
        own.env,
        dotted(running),
      );
      const error = failure(exit);
      expect(error).toBeInstanceOf(Files.SettingsError);
      expect(Schema.is(Files.SettingsError)(error) ? error.reason : error).toBe(reason);
      expect(reads).toEqual([own.repo.path]);
      expect(reads).not.toContain(own.person.path);
      expect(message(exit)).toContain(a.repo);

      if (reason === "version") {
        expect(message(exit)).toContain(a.name);
        expect(message(exit)).toContain(newer);
        expect(message(exit)).toContain(dotted(running));
      } else {
        expect(message(exit)).toContain(a.version.path);
      }
    }

    // Equal, older and absent minima must still open the person file.
    for (const minimum of [dotted(running), "0.0.0", undefined]) {
      const { exit, reads } = yield* run(
        group,
        {
          files: {
            [own.repo.path]: minimum === undefined ? "" : `${a.version.path} = ${JSON.stringify(minimum)}\n`,
          },
          broken: own.person.path,
        },
        own.env,
        dotted(running),
      );
      const error = failure(exit);
      expect(Schema.is(Files.SettingsError)(error) ? error.reason : error).toBe("read");
      expect(reads).toEqual([own.repo.path, own.person.path]);
    }
  }
});

describe("K4, each app checks its own minimum version", () => {
  it.effect.prop(
    "the app's own <app>-version stops a newer repo; another app's is an unknown key; the generic load refuses before opening the person file",
    { input: VersionCase },
    ({ input: { pair, list, running, wanted, theirs } }) =>
      Effect.gen(function* () {
        const reached = new Set<string>();
        yield* minimum(pair, list, running, wanted, theirs, reached);

        for (const foreign of [false, true]) {
          yield* minimum(pair, list, running, [running[0] + 1, wanted[1], wanted[2]], foreign, reached);
          yield* minimum(pair, list, running, [0, 0, 0], foreign, reached);
        }

        expect([...reached].sort()).toEqual(["own-newer", "own-older", "theirs-newer", "theirs-older"]);
        yield* earlyMinimum(pair, list, running, wanted);
      }),
    check,
  );
  it.effect("pinned: T1076 original version examples and captured running 0.0.0 / wanted 0.1.0 plant input", () =>
    Effect.gen(function* () {
      const reached = new Set<string>();

      for (const theirs of [false, true]) {
        yield* minimum(PINNED, ["leak.words"], [0, 1, 0], [0, 2, 0], theirs, reached);
        yield* minimum(PINNED, ["leak.words"], [0, 2, 0], [0, 1, 0], theirs, reached);
      }

      yield* minimum(PINNED, ["leak.words"], [0, 0, 0], [0, 1, 0], false, reached);
      yield* earlyMinimum(PINNED, ["leak.words"], [1, 2, 3], [1, 3, 0]);
    }),
  );
});

// K5 plants: leak the environment on a read refusal, structural contents, a table-path scalar,
// or an unknown-key value. Declared scalar leaf values are displayed by S5 and checked below.
describe("K5 [secrets], another app's values never reach an output", () => {
  for (const place of HIDDEN) {
    for (const unreadable of [true, false]) {
      it.effect.prop(
        `a secret in ${place} (person file unreadable: ${unreadable}) reaches no value, error, snapshot or report`,
        { input: HiddenCase },
        ({ input: { pair, list, word } }) => hidden(pair, list, word, place, unreadable),
        check,
      );
      it.effect(`pinned: T1076 original ${place}/${unreadable} example and captured plant input`, () =>
        hidden(PINNED, ["leak.words"], "sk-abcdef/abc", place, unreadable),
      );
    }
  }
});

// Plant: replace the displayed declared scalar with a placeholder in Files.refused.
it.effect.prop(
  "K5-display, a refused declared scalar is shown with its key and file/env/flag source",
  { input: HiddenCase },
  ({ input: { pair, list, word } }) =>
    Effect.gen(function* () {
      const { a } = apps(pair);
      const group = groupFor(a, list);
      const first = list[0]!;
      const own = placesFor(a, false);
      const text = toml([[first, JSON.stringify(word)]]);

      for (const source of ["repo", "person", "env", "flag"] as const) {
        const { exit } = yield* run(
          group,
          {
            files: {
              [own.repo.path]: source === "repo" ? text.text : "",
              [own.person.path]: source === "person" ? text.text : "",
            },
          },
          source === "env" ? { [envName(a.prefix, first)]: word } : {},
          VERSION,
          source === "flag" ? { [first]: word } : {},
        );
        expect(Exit.isFailure(exit)).toBe(true);
        const error = failure(exit);
        expect(error).toBeInstanceOf(Files.SettingsError);
        expect(Schema.is(Files.SettingsError)(error) ? error.reason : error).toBe("invalid");
        const said = message(exit);
        expect(said).toContain(first);
        expect(said).toContain(source === "repo" || source === "person" ? JSON.stringify(word) : word);
        expect(said).toContain(
          source === "repo"
            ? a.repo
            : source === "person"
              ? a.person
              : source === "env"
                ? envName(a.prefix, first)
                : `--${first}`,
        );

        if (source === "repo" || source === "person") {
          expect(said).toContain(`line ${text.at[first]}`);
        }
      }
    }),
  check,
);
