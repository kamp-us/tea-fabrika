/**
 * What a tree is made of: a tree id, a blob id, the path of a file, its mode, and the entry a tree holds at a path.
 *
 * **Details**
 *
 * A tree id and a blob id are 40 lowercase hex digits, as a commit id is, and not each other. A path is checked by the rules of git's own `verify_path`, written out here, so a path that passes can be put in a tree and sent to a host that checks every tree it receives.
 */
import { Schema } from "effect";
import { OBJECT_ID } from "./internal/object.ts";

/**
 * Schema for a tree id: the name git gives a tree from its content, as lowercase hex with nothing around it.
 *
 * @category models
 */
export const TreeId = Schema.String.check(Schema.isPattern(OBJECT_ID)).pipe(Schema.brand("@kalfa/git/TreeId"));

export type TreeId = typeof TreeId.Type;

/**
 * Schema for a blob id: the name git gives a file's content, as lowercase hex with nothing around it.
 *
 * @category models
 */
export const BlobId = Schema.String.check(Schema.isPattern(OBJECT_ID)).pipe(Schema.brand("@kalfa/git/BlobId"));

export type BlobId = typeof BlobId.Type;

// A lone surrogate has no UTF-8 bytes. A pair is one code point and never matches.
const LONE_SURROGATE = /\p{Surrogate}/u;

// What git's HFS check ignores inside a name: U+200C to U+200F, U+202A to U+202E, U+206A to U+206F and U+FEFF.
const HFS_IGNORED = /[‌-‏‪-‮⁪-⁯﻿]/g;

// A name an HFS volume reads as `.git`.
const isHfsDotGit = (part: string): boolean => part.replace(HFS_IGNORED, "").toLowerCase() === ".git";

// A name an NTFS volume reads as `.git`: its short name `git~1`, trailing spaces and dots dropped, and a stream after a
// colon dropped. NTFS also reads a backslash as a folder separator, so each piece between backslashes is checked.
const NTFS_DOT_GIT = /^(?:\.git|git~1)[ .]*$/i;

const isNtfsDotGit = (part: string): boolean =>
  part.split("\\").some((piece) => NTFS_DOT_GIT.test(piece.split(":")[0] ?? ""));

const isPart = (part: string): boolean =>
  part !== "" && part !== "." && part !== ".." && !isHfsDotGit(part) && !isNtfsDotGit(part);

const isPath = (text: string): boolean =>
  !text.includes("\0") && !LONE_SURROGATE.test(text) && text.split("/").every(isPart);

/**
 * Schema for where a file sits in a tree: parts joined by `/`.
 *
 * **Details**
 *
 * No part is empty, `.` or `..`. No part is one that git calls `.git`, which is any letter case, trailing spaces and dots, a `:` stream, the characters an HFS volume ignores, and the short name `git~1`: `git fsck` refuses a tree that holds one. The path has no NUL and no lone surrogate, so it has UTF-8 bytes. Everything else git allows is allowed, such as a space, a line break, a leading `-` and a part `__proto__`.
 *
 * @category models
 */
export const Path = Schema.String.check(Schema.makeFilter(isPath, { title: "a path in a git tree" })).pipe(
  Schema.brand("@kalfa/git/Path"),
);

export type Path = typeof Path.Type;

/**
 * Schema for a file's kind as git writes it in a tree: a file, an executable file or a link.
 *
 * **Details**
 *
 * A link's content is its target. A submodule (`160000`) is not a file, so it is not a mode here.
 *
 * @category models
 */
export const Mode = Schema.Literals(["100644", "100755", "120000"]);

export type Mode = typeof Mode.Type;

/**
 * What a tree holds at one path: the file's kind and its blob.
 *
 * @category models
 */
export class Entry extends Schema.Class<Entry, { readonly brand: unique symbol }>("@kalfa/git/Entry")({
  mode: Mode,
  blob: BlobId,
}) {}
