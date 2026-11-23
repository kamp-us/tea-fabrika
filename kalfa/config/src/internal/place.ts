/**
 * Where an app's configuration files are, and how each is read: the repo's at `<repo>/.<app>/<app>.<extension>`, the user's at `$<APP>_HOME/<app>.<extension>` or else `$HOME/.<app>/<app>.<extension>`.
 */
import { type ConfigProvider, Effect, FileSystem, Path } from "effect";
import * as Result from "effect/Result";
import type * as Setting from "../Declaration.ts";
import { stop } from "./error.ts";
import type { Document, Format } from "./format.ts";

/** Where a file is read from, and the name a person reads. */
interface Place {
  readonly path: string;
  readonly name: string;
}

export interface Loaded {
  readonly name: string;
  readonly document: Document;
}

export type Names = Readonly<Record<Setting.File, string>>;

/** The value of a variable in the current environment, or none. */
const lookup = (app: string, provider: ConfigProvider.ConfigProvider, name: string) =>
  provider.load([name]).pipe(
    Effect.map((node) => node?.value),
    Effect.mapError((cause) => stop(app, "read", `${name} could not be read.`, undefined, cause)),
  );

/** Where the repo configuration is, inside the folder that holds `.<app>/`. */
export const repoPlace = Effect.fnUntraced(function* (app: string, format: Format, repo: string) {
  const path = yield* Path.Path;

  return {
    path: path.join(repo, `.${app}`, `${app}.${format.extension}`),
    name: `.${app}/${app}.${format.extension}`,
  };
});

/** Where the user configuration is: `$<APP>_HOME/<app>.<extension>`, else `$HOME/.<app>/<app>.<extension>`, else nowhere. */
export const userPlace = Effect.fnUntraced(function* (
  app: string,
  format: Format,
  provider: ConfigProvider.ConfigProvider,
) {
  const path = yield* Path.Path;
  const moved = yield* lookup(app, provider, `${app.toUpperCase()}_HOME`);
  const home = moved === undefined ? yield* lookup(app, provider, "HOME") : undefined;

  return moved !== undefined
    ? {
        path: path.join(moved, `${app}.${format.extension}`),
        name: `$${app.toUpperCase()}_HOME/${app}.${format.extension}`,
      }
    : {
        path: home === undefined ? undefined : path.join(home, `.${app}`, `${app}.${format.extension}`),
        name: `~/.${app}/${app}.${format.extension}`,
      };
});

export const empty: Document = { value: {}, spans: [] };

/** The two files as a person reads them where no environment is read: `.<app>/<app>.<extension>` and `~/.<app>/<app>.<extension>`. */
export const shown = (app: string, format: Format): Names => ({
  repo: `.${app}/${app}.${format.extension}`,
  user: `~/.${app}/${app}.${format.extension}`,
});

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

/** Reads and parses one file. A missing file counts as empty, any other failure to read it fails as `read`. */
export const load = Effect.fnUntraced(function* (app: string, format: Format, place: Place) {
  const fs = yield* FileSystem.FileSystem;

  const text = yield* fs
    .readFileString(place.path)
    .pipe(
      Effect.catchTag("PlatformError", (cause) =>
        cause.reason._tag === "NotFound"
          ? Effect.succeed("")
          : Effect.fail(stop(app, "read", "could not be read.", { file: place.name }, cause)),
      ),
    );

  return yield* Effect.fromResult(parse(app, format, place.name, text));
});
