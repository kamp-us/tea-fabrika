/**
 * One load of fabrika's settings at a process start, on the engine's generic load: read both files,
 * check them whole, resolve the four sources and make the snapshot the process keeps. It returns
 * all of that or one `SettingsError`, so nothing starts on settings that were not checked.
 */
import * as Effect from "effect/Effect";
import * as Predicate from "effect/Predicate";
import * as Declarations from "../../settings/Declarations.ts";
import { Fabrika } from "../../settings/Fabrika.ts";
import * as Files from "../../settings/Files.ts";
import * as Load from "../../settings/Load.ts";
import { Toml } from "../../settings/Toml.ts";

interface Place {
  /** Where the file is read from. */
  readonly path: string;
  /** The name a person reads, as `~/.fabrika/fabrika.toml`. */
  readonly name: string;
}

/**
 * Loads fabrika's settings once, at a process start: parses and checks the repo's file and the
 * person's file whole, resolves the flags, the environment and the two files into values, and
 * makes the snapshot the process keeps.
 *
 * **Details**
 *
 * It answers the checked values with their snapshot, or one `SettingsError`. A person's file that
 * is missing counts as empty. The repo's file comes in as text already read, and with no repo
 * selected it counts as empty. A repo that needs a newer fabrika is refused before the person's
 * file is read.
 *
 * @category constructors
 */
export const load = Effect.fnUntraced(function* (options: {
  readonly person: Place;
  /** A start that selects no repo reads none, and the repo's file counts as empty. */
  readonly repo?: { readonly name: string; readonly text: string | null };
  readonly flags: Readonly<Record<string, string>>;
  readonly env: Readonly<Record<string, string>>;
  /** The running fabrika's version, which the repo's `fabrika-version` is checked against. */
  readonly version: string;
}) {
  const toml = yield* Toml;
  const name = options.repo?.name ?? Fabrika.repo;

  const repo = {
    file: name,
    document:
      options.repo?.text == null
        ? { value: {}, spans: [] }
        : yield* toml.parse(options.repo.text).pipe(
            Effect.mapError((cause) =>
              Files.SettingsError.make({
                reason: "syntax",
                message: `${name}, line ${cause.line}: ${cause.message}\n  ${Files.STOP}`,
                cause,
              }),
            ),
          ),
  };

  // A repo that needs a newer fabrika is refused before the person's file is read.
  yield* Files.supported(Fabrika, repo, options.version);
  const person = yield* Load.file(options.person);

  const checked = yield* Load.resolve(Declarations.all, {
    repo,
    person,
    flags: options.flags,
    env: options.env,
    version: options.version,
  });

  // The repo's own minimum, as its file states it, before a flag or the environment overrides it.
  const minimum = repo.document.value[Fabrika.version.path];

  const context =
    options.repo === undefined
      ? {}
      : { repo: { minimum: Predicate.isString(minimum) ? minimum : Fabrika.version.default } };

  return { ...checked, ...context };
});
