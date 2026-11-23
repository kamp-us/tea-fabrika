/**
 * Where an app's configuration files are, and how each is read: the repo's at `<repo>/.<app>/<app>.<extension>`, the user's at `$<APP>_HOME/<app>.<extension>` or else `$HOME/.<app>/<app>.<extension>`.
 */
import { type ConfigProvider, Effect, FileSystem, Path } from "effect";
import * as Result from "effect/Result";
import type * as Setting from "../Declaration.ts";
import { stop } from "./error.ts";
import type { Document, Format } from "./format.ts";

/** Where a file is read from, and the name a person reads. */
export interface Place {
  readonly path: string;
  readonly name: string;
}

export interface Loaded {
  readonly name: string;
  readonly document: Document;
}

export type Names = Readonly<Record<Setting.File, string>>;

/** The value of a variable in the current environment, or none. A failure to read it ends with `closing`, the start's own sentence when none is given. */
const lookup = (app: string, provider: ConfigProvider.ConfigProvider, name: string, closing?: string) =>
  provider.load([name]).pipe(
    Effect.map((node) => node?.value),
    Effect.mapError((cause) => stop(app, "read", `${name} could not be read.`, undefined, cause, closing)),
  );

/** The folder and the file name of an app's configuration, `.<app>` and `<app>.<extension>`: the one rule for a path and for the name a person reads. */
const parts = (app: string, format: Format) => ({ folder: `.${app}`, file: `${app}.${format.extension}` });

/** The two files as a person reads them where no environment is read: `.<app>/<app>.<extension>` and `~/.<app>/<app>.<extension>`. */
export const shown = (app: string, format: Format): Names => {
  const { folder, file } = parts(app, format);

  return { repo: `${folder}/${file}`, user: `~/${folder}/${file}` };
};

/** Where the repo configuration is, inside the folder that holds `.<app>/`, and that `.<app>/` folder, which a set may make. */
export const repoPlace = Effect.fnUntraced(function* (app: string, format: Format, repo: string) {
  const path = yield* Path.Path;
  const { folder, file } = parts(app, format);

  return { path: path.join(repo, folder, file), name: shown(app, format).repo, folder: path.join(repo, folder) };
});

/**
 * Where the user configuration is: `$<APP>_HOME/<app>.<extension>`, else `$HOME/.<app>/<app>.<extension>`, else nowhere. With no home it has no path. Its folder is the `.<app>/` under `HOME`, which a set may make, and never the folder `$<APP>_HOME` names: a person chose that one, and a typo in it must not make a new folder. A failure to read the environment ends with `closing`, the start's own sentence when none is given.
 */
export const userPlace = Effect.fnUntraced(function* (
  app: string,
  format: Format,
  provider: ConfigProvider.ConfigProvider,
  closing?: string,
) {
  const path = yield* Path.Path;
  const moved = yield* lookup(app, provider, `${app.toUpperCase()}_HOME`, closing);
  const home = moved === undefined ? yield* lookup(app, provider, "HOME", closing) : undefined;

  const { folder, file } = parts(app, format);

  return moved !== undefined
    ? { path: path.join(moved, file), name: `$${app.toUpperCase()}_HOME/${file}`, folder: undefined }
    : {
        path: home === undefined ? undefined : path.join(home, folder, file),
        name: shown(app, format).user,
        folder: home === undefined ? undefined : path.join(home, folder),
      };
});

export const empty: Document = { value: {}, spans: [] };

/** Parses one file's text. Fails as `syntax` with the parser's line. The message ends with `closing`, the start's own sentence when none is given. */
export const parse = (app: string, format: Format, name: string, text: string, closing?: string) =>
  Result.mapBoth(format.parse(text), {
    onSuccess: (document): Loaded => ({ name, document }),
    onFailure: (fault) =>
      stop(
        app,
        "syntax",
        `this is not valid ${format.name}.`,
        { file: name, line: fault._tag === "Value" ? undefined : fault.line },
        fault.cause,
        closing,
      ),
  });

/** The text of one file. A missing file counts as empty, any other failure to read it fails as `read`. The message ends with `closing`, the start's own sentence when none is given. */
export const contents = Effect.fnUntraced(function* (app: string, place: Place, closing?: string) {
  const fs = yield* FileSystem.FileSystem;

  return yield* fs
    .readFileString(place.path)
    .pipe(
      Effect.catchTag("PlatformError", (cause) =>
        cause.reason._tag === "NotFound"
          ? Effect.succeed("")
          : Effect.fail(stop(app, "read", "could not be read.", { file: place.name }, cause, closing)),
      ),
    );
});

/** Reads and parses one file. A missing file counts as empty, any other failure to read it fails as `read`. The message ends with `closing`, the start's own sentence when none is given. */
export const load = Effect.fnUntraced(function* (app: string, format: Format, place: Place, closing?: string) {
  const text = yield* contents(app, place, closing);

  return yield* Effect.fromResult(parse(app, format, place.name, text, closing));
});
