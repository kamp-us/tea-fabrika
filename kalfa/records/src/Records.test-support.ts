// Stand-ins and data for the laws of `@kalfa/records` (S8, .kalfa/quests/rules-and-records-build-PLAN.md):
// a repo held in a record, so no law starts git or writes a folder.
//
// `world(root, files)` is one repo: `files` maps a repo-relative path to its text, or to
// `{ text, symlink: true }` for a tracked symlink. It answers three services the checks read through:
//
// - `Tracked` (the product's `Tracked.ts`): the tracked list that `git ls-files -s` gives, sorted, each
//   entry `{ path, symlink }`. A test hands the list in; no law calls git.
// - Effect's `FileSystem`: `readFileString`, `readFile` and `exists` for `${root}/${path}`. Any other
//   call fails, so a check that reaches for the real disk or lists a folder is noticed.
// - Effect's `Path`.
//
// `cliLayers` adds what `Command.runWith` asks of its host: a terminal, the standard streams and a process spawner, none of
// which the command may use.
import { Effect, FileSystem, Layer, Path, PlatformError, Schema, Stdio, Terminal } from "effect";
import { ChildProcessSpawner } from "effect/process";
import { Tracked } from "./Tracked.ts";

export const ROOT = "/repo";

type Entry = string | { readonly text: string; readonly symlink: true };

type Files = Readonly<Record<string, Entry>>;

const entryText = (entry: Entry) => (typeof entry === "string" ? entry : entry.text);

const missing = (method: string, path: string) =>
  // oxlint-disable-next-line fabrika/no-hand-tag -- edge: Effect's PlatformError takes its system error tag as `_tag`
  PlatformError.systemError({ _tag: "NotFound", module: "FileSystem", method, pathOrDescriptor: path });

export const world = (root: string, files: Files) => {
  const held = new Map(Object.entries(files));
  const relative = (path: string) => (path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path);
  const folder = (path: string) => [...held.keys()].some((file) => file.startsWith(`${relative(path)}/`));

  const tracked = [...held.entries()]
    .map(([path, entry]) => ({ path, symlink: typeof entry !== "string" }))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

  return Layer.mergeAll(
    FileSystem.layerNoop({
      readFileString: (path) => {
        const entry = held.get(relative(path));

        return entry === undefined ? Effect.fail(missing("readFileString", path)) : Effect.succeed(entryText(entry));
      },
      readFile: (path) => {
        const entry = held.get(relative(path));

        return entry === undefined
          ? Effect.fail(missing("readFile", path))
          : Effect.succeed(new TextEncoder().encode(entryText(entry)));
      },
      exists: (path) => Effect.succeed(held.has(relative(path)) || folder(path)),
    }),
    Path.layer,
    Layer.succeed(Tracked, { files: Effect.succeed(tracked) }),
  );
};

export const cliLayers = (root: string, files: Files) =>
  Layer.mergeAll(
    world(root, files),
    Stdio.layerTest({}),
    Layer.succeed(
      Terminal.Terminal,
      Terminal.make({
        columns: Effect.succeed(80),
        rows: Effect.succeed(24),
        size: Effect.die("unused"),
        readInput: Effect.die("unused"),
        readLine: Effect.die("unused"),
        display: () => Effect.void,
      }),
    ),
    Layer.succeed(
      ChildProcessSpawner.ChildProcessSpawner,
      ChildProcessSpawner.make(() => Effect.die("unused")),
    ),
  );

/** Words for a name or a line of prose. */
const WORDS = [
  "layer",
  "check",
  "config",
  "model",
  "write",
  "small",
  "plain",
  "state",
  "order",
  "table",
  "value",
  "limit",
  "agent",
  "files",
  "bytes",
  "named",
  "tiny",
  "steady",
  "reader",
  "shape",
] as const;

export const Words = Schema.Array(Schema.Literals(WORDS)).check(Schema.isBetweenLength(2, 8));

/** A file name's slug from drawn words. */
export const slug = (words: ReadonlyArray<string>) => words.slice(0, 3).join("-");

/** A file of `count` lines of `width` characters, each ending in a newline: `wc -l` counts `count` of them. */
export const fileLines = (count: number, width: number) => `${"x".repeat(width)}\n`.repeat(count);
