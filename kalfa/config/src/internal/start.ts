/**
 * The start of a setting group, in the order the protocol fixes: the repo configuration is read, its minimum version is checked, both files are checked whole, and only then is each value resolved by precedence with its origin kept.
 */
import {
  Config,
  ConfigProvider,
  Effect,
  FileSystem,
  Option,
  Path,
  Schema,
  SchemaAST,
  SchemaIssue,
  SemVer,
} from "effect";
import * as Rec from "effect/Record";
import type * as Setting from "../Declaration.ts";
import { Origin, type Source } from "../Sources.ts";
import * as Sources from "../Sources.ts";
import { Toml, type TomlDocument } from "../Toml.ts";
import { distance, leaf, lineAt, same } from "./document.ts";
import { SettingsError } from "./error.ts";
import { reading } from "./live.ts";
import { field, segments, variable } from "./names.ts";

interface Group {
  readonly app: string;
  readonly settings: ReadonlyArray<Setting.Any>;
}

/** Where a file is read from, and the name a person reads. */
interface Place {
  readonly path: string;
  readonly name: string;
}

interface Loaded {
  readonly name: string;
  readonly document: TomlDocument;
}

type Names = Readonly<Record<Setting.File, string>>;

/** What a start leaves: each value under its field and each origin under its setting name. */
export interface Resolved {
  readonly values: Readonly<Record<string, unknown>>;
  readonly origins: Readonly<Record<string, Origin>>;
}

interface Position {
  readonly file: string;
  readonly line?: number | undefined;
}

/** Where a fault was found, as a message opens: `file, line n: `. */
const opening = (position: Position | undefined) =>
  position === undefined ? "" : `${position.file}${position.line === undefined ? "" : `, line ${position.line}`}: `;

/** One error: where it was found, what is wrong and the closing sentence, with the failure beneath it when there is one. */
const stop = (app: string, reason: SettingsError["reason"], text: string, position?: Position, cause?: unknown) =>
  new SettingsError({
    reason,
    message: `${opening(position)}${text}\n  ${app} did not start.`,
    file: position?.file,
    line: position?.line,
    cause,
  });

/** The value of a variable in the current environment, or none. */
const lookup = (app: string, provider: ConfigProvider.ConfigProvider, name: string) =>
  provider.load([name]).pipe(
    Effect.map((node) => node?.value),
    Effect.mapError((cause) => stop(app, "read", `${name} could not be read.`, undefined, cause)),
  );

/** Where the user configuration is: `$<APP>_HOME/<app>.toml`, else `$HOME/.<app>/<app>.toml`, else nowhere. */
const userPlace = Effect.fnUntraced(function* (app: string, provider: ConfigProvider.ConfigProvider) {
  const path = yield* Path.Path;
  const moved = yield* lookup(app, provider, `${app.toUpperCase()}_HOME`);
  const home = moved === undefined ? yield* lookup(app, provider, "HOME") : undefined;

  return moved !== undefined
    ? { path: path.join(moved, `${app}.toml`), name: `$${app.toUpperCase()}_HOME/${app}.toml` }
    : {
        path: home === undefined ? undefined : path.join(home, `.${app}`, `${app}.toml`),
        name: `~/.${app}/${app}.toml`,
      };
});

const empty: TomlDocument = { value: {}, spans: [] };

/** Reads and parses one file. A missing file counts as empty, any other failure to read it fails as `read`. */
const load = Effect.fnUntraced(function* (app: string, place: Place) {
  const fs = yield* FileSystem.FileSystem;
  const toml = yield* Toml;

  const text = yield* fs
    .readFileString(place.path)
    .pipe(
      Effect.catchTag("PlatformError", (cause) =>
        cause.reason._tag === "NotFound"
          ? Effect.succeed("")
          : Effect.fail(stop(app, "read", "could not be read.", { file: place.name }, cause)),
      ),
    );

  const document = yield* toml
    .parse(text)
    .pipe(
      Effect.mapError((cause) =>
        stop(app, "syntax", "this is not valid TOML.", { file: place.name, line: cause.line }, cause),
      ),
    );

  return { name: place.name, document };
});

/** Fails when the repo configuration asks for a newer app than the one running. */
const supported = Effect.fnUntraced(function* (app: string, repo: Loaded, version: string) {
  const key = `${app}-version`;
  const wanted = repo.document.value[key];

  if (wanted === undefined) {
    return;
  }

  const position = { file: repo.name, line: lineAt(repo.document, [key]) };
  const decode = Schema.decodeUnknownEffect(Schema.SemVerFromString);

  const asked = yield* decode(wanted).pipe(
    Effect.mapError(() => stop(app, "invalid", `${key} is not a version, as 1.2.3.`, position)),
  );

  const running = yield* decode(version).pipe(
    Effect.mapError(() => stop(app, "invalid", `${version} is not a version, as 1.2.3.`)),
  );

  if (SemVer.isGreaterThan(asked, running)) {
    return yield* stop(
      app,
      "version",
      `this repo needs ${app} ${SemVer.format(asked)} or newer. You have ${SemVer.format(running)}.`,
      position,
    );
  }
});

/** The Struct a file is decoded with: every table and leaf optional. */
const struct = (settings: ReadonlyArray<Setting.Any>, depth: number): Schema.Codec<unknown, unknown> =>
  Schema.Struct(
    Rec.fromEntries(
      [...new Set(settings.flatMap((s) => segments(s.name)[depth] ?? []))].map((word) => {
        const below = settings.filter((s) => segments(s.name)[depth] === word);
        const own = below.find((s) => segments(s.name).length === depth + 1);

        return [
          word,
          Schema.optionalKey(own === undefined ? struct(below, depth + 1) : Schema.toCodecJson(own.schema)),
        ];
      }),
    ),
  );

/** Whether `path` is the setting's own name or one of its tables. */
const under = (s: Setting.Any, path: ReadonlyArray<string>) => path.every((word, n) => segments(s.name)[n] === word);

/** Where a setting may be set, as a message says it: its files, and its variable unless only a file may set it. */
const places = (app: string, s: Setting.Any, names: Names) =>
  [...s.files.map((file) => names[file]), ...(s.fileOnly ? [] : [`as ${variable(app, s.name)}`])]
    .map((place, n, all) =>
      n === 0 ? place : n === all.length - 1 && place.startsWith("as ") ? `, or ${place}` : ` or ${place}`,
    )
    .join("");

/** The one message for the first issue of `file`. An unknown key is named, and its value never is. */
const explain = (group: Group, file: Setting.File, found: Loaded, names: Names, issue: SchemaIssue.Issue) => {
  const { app, settings } = group;
  const path = (SchemaIssue.makeFormatterStandardSchemaV1()(issue).issues[0]?.path ?? []).map(String);
  const own = settings.filter((s) => s.files.includes(file));

  const stopped = (reason: SettingsError["reason"], text: string, key: ReadonlyArray<string>) =>
    stop(app, reason, text, { file: found.name, line: lineAt(found.document, key) });

  if (own.some((s) => under(s, path))) {
    const s = own.find((s) => same(segments(s.name), path));

    return s === undefined
      ? stopped("invalid", `${path.join(".")} is a table of settings, not a value.`, path)
      : refused(app, s, Origin.cases.file.make({ file: found.name, line: lineAt(found.document, path) ?? 0 }));
  }

  const key = leaf(found.document.value, path);
  const version = `${app}-version`;

  if (file === "user" && key.join(".") === version) {
    return stopped("scope", `${version} may be set only in ${names.repo}.`, key);
  }

  const other = settings.find((s) => same(segments(s.name), key));

  if (other !== undefined) {
    return stopped("scope", `${other.name} may be set only in ${places(app, other, names)}.`, key);
  }

  const near = own
    .map((s) => ({ name: s.name, edits: distance(s.name, key.join(".")) }))
    .filter(({ edits }) => edits <= 2)
    .sort((a, b) => a.edits - b.edits)[0];

  return stopped(
    "unknown",
    `there is no setting ${key.join(".")}.${near === undefined ? "" : ` Did you mean ${near.name}?`}`,
    key,
  );
};

/** The `invalid` error for a value its setting's schema refuses, naming where it was and never what it was. */
const refused = (app: string, s: Setting.Any, origin: Origin) => {
  const expected = SchemaAST.resolveTitle(s.schema.ast) ?? "a valid value";
  const rule = SchemaAST.resolveDescription(s.schema.ast);
  const text = (name: string) => `${name} is not ${expected}.${rule === undefined ? "" : ` ${rule}`}`;

  return Origin.matchOrElse(
    origin,
    {
      file: ({ file, line }) => stop(app, "invalid", text(s.name), { file, line }),
      default: () => stop(app, "invalid", text(s.name)),
    },
    ({ name }) => stop(app, "invalid", text(name)),
  );
};

/** Checks one file against the settings that may be set in it. Its first fault is the one error. */
const check = Effect.fnUntraced(function* (group: Group, file: Setting.File, found: Loaded, names: Names) {
  const own = group.settings.filter((s) => s.files.includes(file));
  // The repo's minimum version was checked on its own, ahead of everything else.
  const value = file === "repo" ? Rec.remove(found.document.value, `${group.app}-version`) : found.document.value;

  // A file no setting may be set in refuses every key, where an empty Struct would take any object.
  const schema = own.length === 0 ? Schema.Record(Schema.String, Schema.Never) : struct(own, 0);

  yield* Schema.decodeUnknownEffect(schema)(value, { onExcessProperty: "error" }).pipe(
    Effect.mapError((error) => explain(group, file, found, names, error.issue)),
  );
});

/** The first source that holds the setting. */
const holder = (app: string, s: Setting.Any, sources: ReadonlyArray<Source>) =>
  Effect.findFirst(sources, (source) =>
    source.provider.load(segments(s.name)).pipe(
      Effect.map((node) => node !== undefined),
      Effect.mapError((cause) => stop(app, "read", `${s.name} could not be read.`, undefined, cause)),
    ),
  );

/** One setting's value and where it came from: the first source that holds it, else its default. */
const resolve = Effect.fnUntraced(function* (
  group: Group,
  s: Setting.Any,
  files: Readonly<Record<Setting.File, Source>>,
  names: Names,
  provider: ConfigProvider.ConfigProvider,
) {
  const { app } = group;
  const name = variable(app, s.name);

  // A file-only setting skips the environment. An environment variable reads at its own name, so the origin names what was read.
  const env: Source = {
    provider: provider.pipe(ConfigProvider.mapInput(() => [name])),
    origin: () => Origin.cases.env.make({ name }),
  };

  const sources = [...(s.fileOnly ? [] : [env]), files.repo, files.user];
  const first = yield* holder(app, s, sources);

  if (Option.isNone(first)) {
    if (Option.isNone(s.default)) {
      return yield* stop(
        app,
        "missing",
        `${s.name} is required, and nothing sets it. Set it in ${places(app, s, names)}.`,
      );
    }

    return { value: s.default.value, origin: Origin.cases.default.make({}) };
  }

  const origin = first.value.origin(segments(s.name));
  const chain = sources.map((source) => source.provider).reduce((all, next) => ConfigProvider.orElse(all, next));

  const value = yield* Config.schema(s.schema, segments(s.name))
    .parse(chain)
    .pipe(
      Effect.mapError((error) =>
        error.cause instanceof Schema.SchemaError
          ? refused(app, s, origin)
          : stop(app, "read", `${s.name} could not be read.`, undefined, error),
      ),
    );

  return { value, origin };
});

/**
 * Starts a group: reads and checks both files, then resolves every setting, and fails with the first fault.
 */
export const start = Effect.fnUntraced(function* (
  group: Group,
  options: { readonly version: string; readonly repo?: string },
) {
  const { app } = group;
  const path = yield* Path.Path;
  const provider = yield* ConfigProvider.ConfigProvider;
  const user = yield* userPlace(app, provider);
  const names = { repo: `.${app}/${app}.toml`, user: user.name };

  const repo = yield* load(app, { path: path.join(options.repo ?? ".", `.${app}`, `${app}.toml`), name: names.repo });
  yield* supported(app, repo, options.version);
  yield* check(group, "repo", repo, names);

  // No home means no user configuration, so there is no file to read.
  const found: Loaded =
    user.path === undefined
      ? { name: user.name, document: empty }
      : yield* load(app, { path: user.path, name: user.name });

  yield* check(group, "user", found, names);

  const files = { repo: Sources.file(repo.name, repo.document), user: Sources.file(found.name, found.document) };
  const values: Record<string, unknown> = {};
  const origins: Record<string, Origin> = {};

  for (const s of group.settings) {
    const resolved = yield* resolve(group, s, files, names, provider);
    values[field(s.name)] = s.live ? yield* reading(resolved.value) : resolved.value;
    origins[s.name] = resolved.origin;
  }

  const started: Resolved = { values, origins };

  return started;
});
