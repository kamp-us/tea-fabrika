// What a path holds in a tree, and the one rule both adapters use to say what `readFile` answers for it. Each adapter says what
// the tree holds at a path; this file says what that makes of a path, so the two refuse the same paths in the same way.
import { Result } from "effect";
import * as Repository from "../Repository.ts";
import type { Path } from "../Tree.ts";

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
