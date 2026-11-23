/**
 * The disk half of an edit: read a configuration file, run the edit on its text and put the answer back, the way git writes its config. A link is followed to its target, `<file>.lock` is made with the exclusive `"wx"` flag so a second writer fails at once, the new text goes into the lock, and one rename puts the lock over the file, so a reader never sees half a file and no other write reaches the file's own path.
 *
 * Nothing here holds a value or the file's text: a failure names the file as the start does, never an absolute path, and the span says only which setting and file, and whether the text changed.
 */
import { ConfigProvider, Effect, Exit, FileSystem } from "effect";
import type * as PlatformError from "effect/PlatformError";
import type * as Setting from "../Declaration.ts";
import * as change from "./change.ts";
import type { Group } from "./check.ts";
import { type SettingsError, stop } from "./error.ts";
import type { Format } from "./format.ts";
import { contents, type Names, repoPlace, userPlace } from "./place.ts";

/** What one disk call is about: the edit it makes, and the file as a person reads it. */
interface Call {
  readonly app: string;
  readonly kind: "set" | "remove";
  readonly name: string;
  readonly names: Names;
  readonly edit: (text: string, names: Names) => Effect.Effect<string, SettingsError>;
}

/** The one error of a disk call: the file's own name, or another's, and the closing sentence that says the file was not changed. */
const fail = (call: Call, reason: "read" | "write", text: string, cause?: unknown, file = call.name) =>
  stop(call.app, reason, text, { file }, cause, `${call.name} was not changed.`);

/** Why a write failed, as a sentence: a folder that is not there is the one reason a person can fix at once. */
const unwritten = (call: Call, cause: PlatformError.PlatformError) =>
  fail(call, "write", cause.reason._tag === "NotFound" ? "its folder is not there." : "could not be written.", cause);

/** The folder this call made: its path, or none when the folder was there already, or there is none to make. */
type Made = string | undefined;

/** Makes the app's own folder, and nothing above it. One already there is as good, and is not this call's to take away. */
const folder = (fs: FileSystem.FileSystem, call: Call, path: string | undefined) =>
  path === undefined
    ? Effect.undefined
    : fs.makeDirectory(path).pipe(
        Effect.as<Made>(path),
        Effect.catchTag("PlatformError", (cause) =>
          cause.reason._tag === "AlreadyExists" ? Effect.undefined : Effect.fail(unwritten(call, cause)),
        ),
      );

/** Takes a folder this call made away again when it is still empty: another writer may have put its lock in it since. */
const unmake = (fs: FileSystem.FileSystem, call: Call, path: string) =>
  fs.readDirectory(path).pipe(
    Effect.flatMap((entries) => (entries.length === 0 ? fs.remove(path, { recursive: true }) : Effect.void)),
    Effect.ignore({ log: "Warn", message: `${call.name}'s folder was not removed.` }),
  );

/** A remove with no file to take the key out of. The edit still checks the setting and the file's scope, on an empty text, so a remove refuses the same way whatever the disk holds. */
const nothing = (call: Call) => call.edit("", call.names).pipe(Effect.as(false));

/**
 * Makes the lock, empty and with `"wx"`, so it is made only when no one holds it. Answers false when the file's folder is not there and the call is a remove: it has nothing to take out.
 */
const take = (fs: FileSystem.FileSystem, call: Call, lock: string) =>
  fs.writeFileString(lock, "", { flag: "wx" }).pipe(
    Effect.as(true),
    Effect.catchTag("PlatformError", (cause) => {
      switch (cause.reason._tag) {
        case "AlreadyExists":
          return Effect.fail(
            fail(
              call,
              "write",
              "another change is under way, or an earlier one stopped before it finished. If none is running, remove this file.",
              cause,
              `${call.name}.lock`,
            ),
          );
        case "NotFound":
          return call.kind === "remove" ? nothing(call) : Effect.fail(unwritten(call, cause));
        default:
          return Effect.fail(unwritten(call, cause));
      }
    }),
  );

/**
 * Runs the edit on the file's text under the lock: the answer goes into the lock, and one rename puts the lock over the file. Answers whether the file changed. An answer equal to the old text leaves the file alone.
 */
const replace = Effect.fnUntraced(function* (fs: FileSystem.FileSystem, call: Call, real: string, lock: string) {
  const old = yield* contents(call.app, { path: real, name: call.name }, `${call.name} was not changed.`);
  const next = yield* call.edit(old, call.names);

  if (next === old) {
    yield* fs.remove(lock).pipe(Effect.mapError((cause) => unwritten(call, cause)));

    return false;
  }

  yield* fs.writeFileString(lock, next).pipe(Effect.mapError((cause) => unwritten(call, cause)));
  yield* fs.rename(lock, real).pipe(Effect.mapError((cause) => unwritten(call, cause)));

  return true;
});

/** The place of the file a call is about: its path, none with no home, and the folder a set may make. */
interface Place {
  readonly path: string | undefined;
  readonly folder: string | undefined;
}

/**
 * Changes the file at `place`: follows a link to its target, makes the app's own folder for a set, and edits under the lock. Answers whether the file changed.
 *
 * With no home there is no user configuration: a set fails `write` naming both variables, and a remove has nothing to take out.
 */
const onDisk = Effect.fnUntraced(function* (call: Call, place: Place) {
  const { path } = place;

  if (path === undefined) {
    return call.kind === "set"
      ? yield* fail(
          call,
          "write",
          `could not be written, because neither $${call.app.toUpperCase()}_HOME nor HOME is set.`,
        )
      : yield* nothing(call);
  }

  const fs = yield* FileSystem.FileSystem;

  // A link is followed to its target, as git does. A path that is not there, or a link to nothing, is used as it is: the read or the lock then says what is wrong.
  const real = yield* fs.realPath(path).pipe(Effect.orElseSucceed(() => path));
  const lock = `${real}.lock`;

  const locked = Effect.acquireUseRelease(
    take(fs, call, lock),
    (taken) => (taken ? replace(fs, call, real, lock) : Effect.succeed(false)),
    // Only a lock this call made is taken out, and only when the call did not finish: a finished one has renamed it away.
    (taken, exit) =>
      taken && Exit.isFailure(exit)
        ? fs
            .remove(lock, { force: true })
            .pipe(Effect.ignore({ log: "Warn", message: `${call.name}.lock was not removed.` }))
        : Effect.void,
  );

  // Only a folder this call made goes again when the call fails, after the lock in it has gone.
  return yield* Effect.acquireUseRelease(
    call.kind === "set" ? folder(fs, call, place.folder) : Effect.undefined,
    () => locked,
    (made, exit) => (made !== undefined && Exit.isFailure(exit) ? unmake(fs, call, made) : Effect.void),
  );
});

/**
 * One disk call: finds the file as the start does and changes it. Annotates the span the caller made with whether the text changed.
 */
const write = Effect.fnUntraced(function* (
  group: Group,
  format: Format,
  file: Setting.File,
  repo: string,
  kind: "set" | "remove",
  edit: Call["edit"],
) {
  const { app } = group;
  const provider = yield* ConfigProvider.ConfigProvider;
  // No file is known before the environment is read, so a failure to read it names the configuration.
  const closing = `The ${file === "repo" ? "repo" : "user"} configuration was not changed.`;
  const found = { repo: yield* repoPlace(app, format, repo), user: yield* userPlace(app, format, provider, closing) };
  const names = { repo: found.repo.name, user: found.user.name };
  // A file name cast past the types reaches the user configuration, never a key that `Object` holds.
  const place = file === "repo" ? found.repo : found.user;

  const changed = yield* onDisk({ app, kind, name: place.name, names, edit }, place);

  yield* Effect.annotateCurrentSpan("kalfa.config.changed", changed);
});

/** The span's attributes: which app, which setting and which file, and no value. */
const attributes = (group: Group, setting: Setting.Any, file: Setting.File) =>
  Effect.annotateCurrentSpan({
    "kalfa.config.app": group.app,
    "kalfa.config.setting": setting.name,
    "kalfa.config.file": file,
  });

/** Sets one setting in the file `file` of `group`, on disk, in a span `config.set`. */
export const set = Effect.fn("config.set")(function* (
  group: Group,
  format: Format,
  setting: Setting.Any,
  value: unknown,
  file: Setting.File,
  repo: string,
) {
  yield* attributes(group, setting, file);
  yield* write(group, format, file, repo, "set", (text, names) =>
    change.set(group, format, { file, names }, text, setting, value),
  );
});

/** Takes one setting out of the file `file` of `group`, on disk, in a span `config.remove`. */
export const remove = Effect.fn("config.remove")(function* (
  group: Group,
  format: Format,
  setting: Setting.Any,
  file: Setting.File,
  repo: string,
) {
  yield* attributes(group, setting, file);
  yield* write(group, format, file, repo, "remove", (text, names) =>
    change.remove(group, format, { file, names }, text, setting),
  );
});
