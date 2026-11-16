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
import { runsFor } from "@kampus/vitest";
import { Effect, Exit, FileSystem, Layer, Path, PlatformError, Schema } from "effect";
import { Digest } from "effect/crypto";
import * as fc from "fast-check";
import * as App from "./App.ts";
import * as Files from "./Files.ts";
import * as Load from "./Load.ts";
import * as Print from "./Print.ts";
import * as Reference from "./Reference.ts";
import * as Snapshot from "./Snapshot.ts";
import * as Sources from "./Sources.ts";
import { Toml, type TomlDocument } from "./Toml.ts";
import * as TomlParser from "./TomlParser.ts";

const SEED = 119120; // the shared seed (AGENTS.md), so a red run repeats
const check = { seed: SEED, numRuns: runsFor({ fast: 25, full: 100 }) };

const Port = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 65535 }));
const DEFAULT = 18787;
const ROOT = "/work";
const HOME = "/people/one";
const VERSION = "1.2.3";

const services = Layer.mergeAll(TomlParser.layer, Digest.layerWebCrypto);

// ---------------------------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------------------------

/** One lowercase word, never one that holds fabrika's name, so a message search stays exact. */
const word = fc.stringMatching(/^[a-z][a-z0-9]{3,7}$/).filter((n) => !n.includes("fabrika"));
const verb = fc.constantFrom("settings", "config get", "prefs");

/**
 * Two app names, neither a part of the other, so one app's words can never be found inside the
 * other's. `kalfa` and `fabrika` are always among the runs, through each law's `examples`.
 */
const names = fc
  .tuple(word, word)
  .filter(([a, b]) => !a.includes(b) && !b.includes(a))
  .chain(([a, b]) => fc.tuple(fc.constant(a), fc.constant(b), verb, verb));

const PINNED = ["kalfa", "fabrika", "config get", "settings"] as const;

const apps = ([a, b, va, vb]: readonly [string, string, string, string]) => ({
  a: App.make({ name: a, list: `${a} ${va}` }),
  b: App.make({ name: b, list: `${b} ${vb}` }),
});

/** A section of letters with at most one hyphen, so its environment spelling is plain to write. */
const section = fc
  .stringMatching(/^[a-z]{1,6}(-[a-z]{1,4})?$/)
  .filter((s) => !s.endsWith("-version") && s !== "version");

const key = fc.stringMatching(/^[a-z]{1,6}$/);

/** 1 to 4 dotted paths, one per section, so no path is a table of another. */
const paths = fc
  .uniqueArray(fc.tuple(section, key), { minLength: 1, maxLength: 4, selector: ([s]) => s })
  .map((pairs) => pairs.map(([s, k]) => `${s}.${k}`));

const ports = fc.integer({ min: 1, max: 65535 }).filter((p) => p !== DEFAULT);

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

const disk = (input: Disk, reads: Array<string>) =>
  Layer.merge(
    FileSystem.layerNoop({
      exists: (path) => Effect.succeed(input.files[path] !== undefined),
      readFileString: (path) => {
        reads.push(path);
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

const run = (group: Parameters<typeof Load.load>[0], input: Disk, env: Readonly<Record<string, string>>) => {
  const reads: Array<string> = [];
  return Effect.runPromise(
    Load.load(group, { repo: ROOT, home: HOME, flags: {}, env, version: VERSION }).pipe(
      Effect.exit,
      Effect.map((exit) => ({ exit, reads })),
      Effect.provide(Layer.mergeAll(disk(input, reads), services)),
    ),
  );
};

const failure = (exit: Exit.Exit<unknown, unknown>) => {
  if (Exit.isSuccess(exit)) {
    return undefined;
  }

  const reason = exit.cause.reasons.find((r) => r._tag === "Fail");
  return reason?._tag === "Fail" ? reason.error : undefined;
};

// ---------------------------------------------------------------------------------------------
// K1
// ---------------------------------------------------------------------------------------------

const PLACES = ["b-repo", "b-person", "b-env", "a-repo", "a-person", "a-env", "none"] as const;
type Place = (typeof PLACES)[number];

describe("K1, a second app reads only its own", () => {
  // Plants, run once each: (a) the load keeps `.fabrika/fabrika.toml` as its repo path; (b)
  // `Sources.env` keeps `nested("fabrika")`; (c) the person's home falls back to `FABRIKA_HOME`.
  // Each turns this law red.
  it("a value in the other app's files or variables stays at the default; the app's own is read, with its origin", async () => {
    const reached = new Set<Place>();
    await fc.assert(
      fc.asyncProperty(
        names,
        paths.chain((list) =>
          fc.tuple(
            fc.constant(list),
            fc.array(fc.tuple(fc.constantFrom(...PLACES), ports), { minLength: list.length, maxLength: list.length }),
          ),
        ),
        fc.boolean(),
        fc.boolean(),
        async (pair, [list, picks], aHome, bHome) => {
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
          const { exit, reads } = await run(group, { files }, env);
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
        },
      ),
      {
        ...check,
        examples: [
          [[PINNED[0], PINNED[1], PINNED[2], PINNED[3]], [["leak.words"], [["b-env", 1]]], false, false],
          [[PINNED[0], PINNED[1], PINNED[2], PINNED[3]], [["leak.words"], [["b-repo", 2]]], false, true],
          [[PINNED[0], PINNED[1], PINNED[2], PINNED[3]], [["leak.words"], [["b-person", 3]]], true, true],
          [[PINNED[0], PINNED[1], PINNED[2], PINNED[3]], [["leak.words"], [["a-env", 4]]], false, false],
          [[PINNED[0], PINNED[1], PINNED[2], PINNED[3]], [["leak.words"], [["a-person", 5]]], true, false],
        ],
      },
    );
    // Coverage: every place a value can sit was reached.
    expect([...reached].sort()).toEqual([...PLACES].sort());
  });
});

// ---------------------------------------------------------------------------------------------
// K2
// ---------------------------------------------------------------------------------------------

/** The message of a failed effect, or the empty string. */
const message = (exit: Exit.Exit<unknown, unknown>) => {
  const error = failure(exit);
  return error instanceof Files.SettingsError ? error.message : "";
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

describe("K2, every name comes from the app", () => {
  // Plants, run once each: (a) `Files.refused` keeps "fabrika settings lists every setting"; (b)
  // the snapshot's origin check keeps `$FABRIKA_HOME`. Each turns this law red.
  it("names, files, flags, the version key and every message come from the app's own name and list", async () => {
    await fc.assert(
      fc.asyncProperty(names, paths, ports, async (pair, list, value) => {
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
        const ran = await Effect.runPromise(
          Effect.gen(function* () {
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
          }).pipe(Effect.provide(services)),
        );
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
      }),
      { ...check, examples: [[[PINNED[0], PINNED[1], PINNED[2], PINNED[3]], ["leak.words"], 1]] },
    );
  });

  it("a version warning names the app, never another", async () => {
    await fc.assert(
      fc.asyncProperty(names, paths, ports, async (pair, list, value) => {
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
        const rows = await Effect.runPromise(
          Effect.gen(function* () {
            const resolved = yield* Sources.resolve(group, {
              flags: Sources.flags(Object.fromEntries(list.map((p) => [p, String(value)]))),
              env: a.Sources.env({}),
              repo: Sources.file(a.repo, empty),
              person: Sources.file(a.person, empty),
            });
            return Reference.rows(group, yield* Snapshot.make(group, resolved));
          }).pipe(Effect.provide(services)),
        );
        const lines = Print.warnings(Reference.warnings(rows, "1.0.0"));
        expect(lines).toHaveLength(list.length);

        for (const line of lines) {
          expect(line).toContain(a.name);
          expect(line).not.toContain(b.name);
          expect(a.name === "fabrika" || !line.includes("fabrika")).toBe(true);
        }
      }),
      { ...check, examples: [[[PINNED[0], PINNED[1], PINNED[2], PINNED[3]], ["leak.words"], 1]] },
    );
  });
});

// ---------------------------------------------------------------------------------------------
// K3
// ---------------------------------------------------------------------------------------------

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

const CHARS = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-.".split("");

describe("K3, an app name is one lowercase word, and a group holds one app", () => {
  // Plants, run once each: (a) accept `_` in a name; (b) drop the two-app check in `group`. Each
  // turns this law red.
  it("App.make throws for any name that is not one lowercase word, and only for those", () => {
    const reached = new Set<string>();
    fc.assert(
      fc.property(
        fc.oneof(
          fc.string({ unit: fc.constantFrom(...CHARS), maxLength: 10 }),
          fc.stringMatching(/^[a-z][a-z0-9]{0,8}$/),
          fc
            .tuple(
              fc.stringMatching(/^[a-z]{1,4}$/),
              fc.constantFrom("_", "-", ".", "A", "Z"),
              fc.stringMatching(/^[a-z]{0,4}$/),
            )
            .map(([x, mark, y]) => `${x}${mark}${y}`),
          fc.stringMatching(/^[0-9][a-z0-9]{0,6}$/),
        ),
        (name) => {
          const rule = broken(name);
          reached.add(rule);
          const made = () => App.make({ name, list: `${name} settings` });

          const threw = Exit.isFailure(Effect.runSyncExit(Effect.try(made)));
          expect(rule === "ok").toBe(ONE_WORD.test(name));
          expect(threw).toBe(!ONE_WORD.test(name));
        },
      ),
      { ...check, examples: [["kal_fa"], [""], ["Kalfa"], ["1kalfa"], ["kal-fa"], ["kal.fa"], ["kalfa"]] },
    );
    expect([...reached].sort()).toEqual(["capital", "digit-first", "dot", "empty", "hyphen", "ok", "underscore"]);
  });

  it("Setting.group throws for declarations of two apps, naming both paths", () => {
    fc.assert(
      fc.property(names, paths, paths, (pair, left, right) => {
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
      }),
      { ...check, examples: [[[PINNED[0], PINNED[1], PINNED[2], PINNED[3]], ["leak.words"], ["instance.port"]]] },
    );
  });
});

// ---------------------------------------------------------------------------------------------
// K4
// ---------------------------------------------------------------------------------------------

const triple = fc.tuple(fc.nat(20), fc.nat(20), fc.nat(20));
const dotted = ([x, y, z]: readonly [number, number, number]) => `${x}.${y}.${z}`;

const later = (w: readonly number[], r: readonly number[]) =>
  w[0]! !== r[0]! ? w[0]! > r[0]! : w[1]! !== r[1]! ? w[1]! > r[1]! : w[2]! > r[2]!;

describe("K4, each app checks its own minimum version", () => {
  // Plant, run once: `Files.supported` keeps reading `fabrika-version`. It turns this law red.
  it("the app's own <app>-version stops a newer repo; another app's is an unknown key", async () => {
    const reached = new Set<string>();
    await fc.assert(
      fc.asyncProperty(names, paths, triple, triple, fc.boolean(), async (pair, list, running, wanted, theirs) => {
        const { a, b } = apps(pair);
        const group = a.Setting.group({ ...groupFor(a, list).settings, version: a.version });
        const owner = theirs ? b : a;
        const text = `${owner.version.path} = ${JSON.stringify(dotted(wanted))}\n`;
        const exit = await Effect.runPromise(
          Effect.gen(function* () {
            const document = yield* parse(text);
            return yield* Files.validate(
              group,
              { repo: { file: a.repo, document }, person: { file: a.person, document: { value: {}, spans: [] } } },
              { version: dotted(running) },
            ).pipe(Effect.exit);
          }).pipe(Effect.provide(services)),
        );
        const error = failure(exit);
        const newer = later(wanted, running);
        reached.add(`${theirs ? "theirs" : "own"}-${newer ? "newer" : "older"}`);

        const want = theirs ? "unknown" : newer ? "version" : undefined;
        expect(error instanceof Files.SettingsError ? error.reason : error).toBe(want);
        // A version refusal names this app, never the other, and never fabrika for another app.
        const said = message(exit);
        expect(want !== "version" || said.includes(a.name)).toBe(true);
        expect(want !== "version" || !said.includes(b.name)).toBe(true);
        expect(want !== "version" || a.name === "fabrika" || !said.includes("fabrika")).toBe(true);
      }),
      {
        ...check,
        examples: [
          [[PINNED[0], PINNED[1], PINNED[2], PINNED[3]], ["leak.words"], [0, 1, 0], [0, 2, 0], false],
          [[PINNED[0], PINNED[1], PINNED[2], PINNED[3]], ["leak.words"], [0, 1, 0], [0, 2, 0], true],
          [[PINNED[0], PINNED[1], PINNED[2], PINNED[3]], ["leak.words"], [0, 2, 0], [0, 1, 0], true],
          [[PINNED[0], PINNED[1], PINNED[2], PINNED[3]], ["leak.words"], [0, 2, 0], [0, 1, 0], false],
        ],
      },
    );
    expect([...reached].sort()).toEqual(["own-newer", "own-older", "theirs-newer", "theirs-older"]);
  });
});

// ---------------------------------------------------------------------------------------------
// K5 [secrets]
// ---------------------------------------------------------------------------------------------

/** Every form a secret may take in text: raw, JSON-escaped and URL-encoded. */
const forms = (secret: string) => [secret, JSON.stringify(secret).slice(1, -1), encodeURIComponent(secret)];

// Made-up secrets with the characters that make the three forms differ.
const secret = fc
  .tuple(fc.stringMatching(/^[A-Za-z0-9]{6,12}$/), fc.constantFrom('"', "/", " ", "+", "\\", "&"))
  .map(([w, mark]) => `sk-${w}${mark}${w.slice(0, 3)}`);

/** A value as searchable text: a bigint prints as its digits, every other value as JSON does. */
const printed = (value: unknown) =>
  JSON.stringify(value, (_key, v: unknown) => (typeof v === "bigint" ? String(v) : v));

/**
 * Each place a secret may sit. `a-table`, `a-array`, `a-scalar` (a plain value where a table of
 * settings belongs) and `a-unknown` (a key no declaration has) are values the app's own schema
 * refuses. The unknown section holds a digit, which no generated section does, so it never meets a
 * declared one.
 */
const HIDDEN = ["b-env", "b-repo", "b-person", "a-table", "a-array", "a-scalar", "a-unknown"] as const;

describe("K5 [secrets], another app's values never reach an output", () => {
  // Plant, run once: the `read` error prints the whole environment record. It turns this law red.
  // Plants, run once: `Files`' "is a table of settings" message prints the refused value (a-scalar
  // red), and its "there is no setting" message prints the unknown key's value (a-unknown red).
  // Every place, with the person's file readable and unreadable, is its own run of the property,
  // so each case is reached on every run.
  it.each(HIDDEN.flatMap((place) => [true, false].map((unreadable) => ({ place, unreadable }))))(
    "a secret in $place (person file unreadable: $unreadable) reaches no value, error, snapshot or report",
    async ({ place, unreadable }) => {
      await fc.assert(
        fc.asyncProperty(names, paths, secret, async (pair, list, word) => {
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
          const { exit } = await run(group, { files, ...(unreadable ? { broken: own.person.path } : {}) }, env);
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
        }),
        {
          ...check,
          examples: [[[PINNED[0], PINNED[1], PINNED[2], PINNED[3]], ["leak.words"], "sk-abcdef/abc"]],
        },
      );
    },
  );
});
