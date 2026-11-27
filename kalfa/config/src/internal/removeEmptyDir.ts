/**
 * The one call Effect's `FileSystem` lacks: remove a folder only when it is empty. Node's `rmdir` does it in one system call, which the system refuses for a folder that holds anything, so a file another writer has put there since is never deleted.
 *
 * Effect's `FileSystem.remove` cannot do it: without `recursive` it refuses every folder, an empty one too, and with `recursive` it deletes what is inside. When Effect has the call, this file goes.
 */
import { Context, Effect, PlatformError, Predicate } from "effect";

/** What a removal of an empty folder did: took the folder away, or left it in place because it holds something or is gone. */
export type Removal = "removed" | "left";

/** The `code` Node puts on a failed call, as `ENOTEMPTY`. */
const code = (cause: unknown): string | undefined =>
  Predicate.hasProperty(cause, "code") && Predicate.isString(cause.code) ? cause.code : undefined;

/** What Node refused with: its `code`, and its own error, which a failure keeps as its cause. */
interface Refused {
  readonly code: string | undefined;
  readonly cause: unknown;
}

/** Not empty (POSIX allows either code) or not there: the folder is left as it is, and that is no failure. */
const isLeft = (found: string | undefined): boolean =>
  found === "ENOTEMPTY" || found === "EEXIST" || found === "ENOENT";

const reason = (found: string | undefined): PlatformError.SystemErrorTag => {
  switch (found) {
    case "EACCES":
    case "EPERM":
      return "PermissionDenied";
    case "EBUSY":
      return "Busy";
    case "ENOTDIR":
      return "BadResource";
    default:
      return "Unknown";
  }
};

/**
 * Removes the folder at `path` only when it is empty, in one `rmdir`. Answers `"left"` for a folder that is not empty or not there, and fails for anything else, with Node's error kept as the cause. Effect's `FileSystem` has no such call; when it has, this goes.
 */
export const removeEmptyDir = (path: string): Effect.Effect<Removal, PlatformError.PlatformError> =>
  // oxlint-disable-next-line fabrika/no-promises -- edge: Effect's FileSystem cannot remove only an empty folder, and Node's rmdir answers a Promise
  Effect.tryPromise({
    // edge: the module loads on the call, so a Worker that imports this package never pulls in a Node module
    // oxlint-disable-next-line fabrika/no-promises -- edge: the same call, loaded on use
    try: () => import("node:fs/promises").then((fs) => fs.rmdir(path)),
    catch: (cause): Refused => ({ code: code(cause), cause }),
  }).pipe(
    Effect.as<Removal>("removed"),
    Effect.catch((refused) =>
      isLeft(refused.code)
        ? Effect.succeed<Removal>("left")
        : Effect.fail(
            PlatformError.systemError({
              // oxlint-disable-next-line fabrika/no-hand-tag -- edge: Effect PlatformError requires its own system error tag
              _tag: reason(refused.code),
              module: "FileSystem",
              method: "removeEmptyDir",
              pathOrDescriptor: path,
              cause: refused.cause,
            }),
          ),
    ),
  );

/** The edge `disk.ts` calls. Its default is Node's; a law gives the in-memory disk's in its place, so no caller's requirements change. */
export const RemoveEmptyDir = Context.Reference<(path: string) => Effect.Effect<Removal, PlatformError.PlatformError>>(
  "@kalfa/config/internal/removeEmptyDir.RemoveEmptyDir",
  { defaultValue: () => removeEmptyDir },
);
