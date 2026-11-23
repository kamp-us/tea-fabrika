// One folder of a tree being made again, for the git adapter's `editTree`: the entries `mktree` is given, each as the line
// `<mode> <type> <id>` and a tab and the name. An entry no change touches is the exact bytes `ls-tree` printed, so a name that is
// not UTF-8, a submodule and an odd mode pass through as they are.
import { Result } from "effect";
import { joined } from "./bytes.ts";
import type { Listed } from "./parse.ts";

const encoder = new TextEncoder();

/**
 * Every folder a path sits in, the top one first: `a/b/c` has `a` and `a/b`, and `a` has none.
 *
 * @internal
 */
export const above = (path: string): ReadonlyArray<string> =>
  path
    .split("/")
    .slice(0, -1)
    .map((_, at, parts) => parts.slice(0, at + 1).join("/"));

// A name as text, or nothing when its bytes are not UTF-8: no path of an edit can name such an entry.
const utf8 = new TextDecoder("utf-8", { fatal: true });

const named = (name: Uint8Array): string | undefined => {
  const text = Result.try(() => utf8.decode(name));

  return Result.isSuccess(text) ? text.success : undefined;
};

const entry = (head: string, name: Uint8Array): Uint8Array => joined([encoder.encode(`${head}\t`), name]);

// What a listed entry becomes: its own line when nothing changes it, a new line, or nothing when it leaves.
const becomes = (
  each: Listed,
  path: string,
  after: ReadonlyMap<string, string>,
  made: ReadonlyMap<string, string | undefined>,
): Uint8Array | undefined => {
  // A folder made again leaves here, and `lines` adds it with its new id, or not at all when it holds no file.
  if (each.type === "tree") {
    return made.has(path) ? undefined : each.line;
  }

  const id = after.get(path);

  if (id === undefined) {
    return each.line;
  }

  return id === "absent" ? undefined : entry(`${each.mode} blob ${id}`, each.name);
};

/**
 * What a folder holds after an edit, as the lines `mktree -z` takes.
 *
 * **Details**
 *
 * `listed` is the folder's own listing, none when the base has no such folder. `after` says what each changed path holds: the id of its new blob, or `"absent"`. `made` holds each folder below that was made again: its new id, or none when it was left with no files. A replaced file keeps its mode and a new file is `100644`. An entry that leaves, such as a removed file or an emptied folder, leaves its name free for a new one.
 *
 * @internal
 */
export const lines = (
  folder: string,
  listed: ReadonlyArray<Listed> | undefined,
  after: ReadonlyMap<string, string>,
  made: ReadonlyMap<string, string | undefined>,
): ReadonlyArray<Uint8Array> => {
  const above = folder === "" ? "" : `${folder}/`;
  const kept = new Set<string>();
  const found: Array<Uint8Array> = [];

  for (const each of listed ?? []) {
    const name = named(each.name);
    const path = name === undefined ? undefined : `${above}${name}`;
    const line = path === undefined ? each.line : becomes(each, path, after, made);

    if (line !== undefined) {
      found.push(line);
    }

    if (path !== undefined && line !== undefined) {
      kept.add(path);
    }
  }

  const below = (path: string): boolean => path.startsWith(above) && !path.slice(above.length).includes("/");

  for (const [path, id] of after) {
    if (below(path) && !kept.has(path) && id !== "absent") {
      found.push(entry(`100644 blob ${id}`, encoder.encode(path.slice(above.length))));
    }
  }

  for (const [path, id] of made) {
    if (below(path) && !kept.has(path) && id !== undefined) {
      found.push(entry(`040000 tree ${id}`, encoder.encode(path.slice(above.length))));
    }
  }

  return found;
};

// A line as text, one character for each byte, so two lines are equal exactly when their bytes are.
const key = (line: Uint8Array): string => Array.from(line, (octet) => String.fromCharCode(octet)).join("");

/**
 * Whether two lists hold the same entries, in any order.
 *
 * @internal
 */
export const same = (a: ReadonlyArray<Uint8Array>, b: ReadonlyArray<Uint8Array>): boolean => {
  const left = a.map(key).toSorted();
  const right = b.map(key).toSorted();

  return left.length === right.length && left.every((line, at) => line === right[at]);
};
