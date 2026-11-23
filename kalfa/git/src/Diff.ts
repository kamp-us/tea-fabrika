/**
 * What two commits differ by: the name of that change, a patch id, and the change itself, a diff.
 *
 * **Details**
 *
 * A patch id is comparable only with ids the same adapter gave. `/process` takes its ids from git's own `patch-id` and `/memory` hashes the change itself, so the two never match. A diff holds each changed file with the lines added and removed, and the lines are git's in `/process` and the memory adapter's own in `/memory`.
 */
import { Schema } from "effect";
import { OBJECT_ID } from "./internal/object.ts";
import * as Tree from "./Tree.ts";

/**
 * Schema for a patch id: the name of a change, as lowercase hex with nothing around it.
 *
 * **Details**
 *
 * Two changes have one patch id when they add and remove the same lines, each with its own line end, at the same paths, and make the same mode changes. Where a line sits and the lines around it do not count, and whitespace does.
 *
 * @category models
 */
export const PatchId = Schema.String.check(Schema.isPattern(OBJECT_ID)).pipe(Schema.brand("@kalfa/git/PatchId"));

export type PatchId = typeof PatchId.Type;

/**
 * Schema for a line taken out of the old file: `at` counts from 1, in the old file, and `text` keeps the line's own end (`"b\n"`, `"b\r\n"`), or has none for a last line with no newline.
 *
 * @category models
 */
export const Removed = Schema.TaggedStruct("Removed", { at: Schema.Int, text: Schema.String });

/**
 * Schema for a line put in the new file: `at` counts from 1, in the new file, and `text` keeps the line's own end.
 *
 * @category models
 */
export const Added = Schema.TaggedStruct("Added", { at: Schema.Int, text: Schema.String });

/**
 * Schema for a line of a diff: one removed from the old file or one added in the new file.
 *
 * @category models
 */
export const Line = Schema.Union([Removed, Added]);

export type Line = typeof Line.Type;

/**
 * Schema for the lines of a text file's change, in file order and, in each block of changed lines, removed lines first. A mode-only change and an empty new file hold no line.
 *
 * @category models
 */
export const Text = Schema.TaggedStruct("Text", { lines: Schema.Array(Line) });

/**
 * Schema for a binary file's change: git does not split it into lines, and its two blobs say what changed.
 *
 * @category models
 */
export const Binary = Schema.TaggedStruct("Binary", {});

/**
 * Schema for what changed inside one file.
 *
 * @category models
 */
export const Content = Schema.Union([Text, Binary]);

export type Content = typeof Content.Type;

/**
 * Schema for a file the second commit has and the first lacks.
 *
 * @category models
 */
export const New = Schema.TaggedStruct("New", { path: Tree.Path, after: Tree.Entry, content: Content });

/**
 * Schema for a file the first commit has and the second lacks.
 *
 * @category models
 */
export const Deleted = Schema.TaggedStruct("Deleted", { path: Tree.Path, before: Tree.Entry, content: Content });

/**
 * Schema for a file both commits have, with another mode or other bytes. A file that changes kind (a file made a link) is one `Modified` entry, with every old line removed and every new line added.
 *
 * @category models
 */
export const Modified = Schema.TaggedStruct("Modified", {
  path: Tree.Path,
  before: Tree.Entry,
  after: Tree.Entry,
  content: Content,
});

/**
 * Schema for one changed file, with its entry on each side that has it and what changed inside.
 *
 * @category models
 */
export const FileChange = Schema.Union([New, Deleted, Modified]);

export type FileChange = typeof FileChange.Type;

/**
 * Every file two commits differ in, sorted by the path's UTF-8 bytes, as git sorts. `[]` means the two hold the same files.
 *
 * @category models
 */
export type Diff = ReadonlyArray<FileChange>;
