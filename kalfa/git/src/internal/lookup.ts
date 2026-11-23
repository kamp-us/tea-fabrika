// What a path holds in a tree, and the one rule both adapters use to say what `readFile` answers for it. Each adapter says what
// the tree holds at a path; this file says what that makes of a path, so the two refuse the same paths in the same way.
import { Result, Schema } from "effect";
import * as Repository from "../Repository.ts";
import { Path } from "../Tree.ts";
import * as Folder from "./folder.ts";
import { byBytes } from "./object.ts";

/**
 * What a tree holds at one path: a file (mode 100644 or 100755), a folder, a link or a submodule.
 *
 * @internal
 */
export type Kind = "file" | "folder" | "link" | "submodule";

/**
 * What the base tree holds at a path, or nothing. Each adapter gives one.
 *
 * @internal
 */
export type At = (path: string) => Kind | undefined;

/**
 * Walks a path from its top part down and fails when it cannot hold a file.
 *
 * **Details**
 *
 * Nothing at a part, or a file at a part, ends the walk with no failure: git proved no file is there, or a file is the answer, and the caller's own tree says which. A link or a submodule above the last part fails `NotAFile` naming that part, since a checkout would reach a file through a link and so none would be a guess. At the last part a folder, a link or a submodule fails `NotAFile` naming the path.
 *
 * @internal
 */
export const find = (path: Path, at: At): Result.Result<void, Repository.NotAFile> => {
  const parts = path.split("/");

  for (const [index] of parts.entries()) {
    const so = parts.slice(0, index + 1).join("/");
    const kind = at(so);

    if (kind === undefined || kind === "file") {
      return Result.succeed(undefined);
    }

    if (index === parts.length - 1 || kind !== "folder") {
      return Result.fail(new Repository.NotAFile({ path: so, holds: kind }));
    }
  }

  return Result.succeed(undefined);
};

/**
 * Checks an edit against what the base tree holds: it fails `NotAFile` for the first changed path by bytes that `find` refuses, removal included, so a link is never replaced or removed, and then `PathInTheWay` for the first new file by bytes that sits below a file the edit keeps or below another new file.
 *
 * **Details**
 *
 * A file the edit keeps is one the base holds that the edit does not remove, and a replaced file is one too. A file removed and a file added below it, a file made a folder, is allowed. `"absent"` on a path that holds nothing passes: it is a state, not an action that needs something to remove.
 *
 * @internal
 */
export const check = (
  changes: Repository.Edit,
  at: At,
): Result.Result<void, Repository.NotAFile | Repository.PathInTheWay> =>
  Result.gen(function* () {
    const edit: ReadonlyMap<string, Uint8Array | "absent"> = changes;
    const paths = [...changes.keys()].toSorted(byBytes);

    for (const path of paths) {
      yield* find(path, at);
    }

    for (const path of paths) {
      const other = Folder.above(path).find((above) => {
        const change = edit.get(above);

        return change === undefined ? at(above) === "file" : change !== "absent";
      });

      if (changes.get(path) !== "absent" && other !== undefined) {
        return yield* Result.fail(new Repository.PathInTheWay({ path, other: Schema.decodeSync(Path)(other) }));
      }
    }
  });
