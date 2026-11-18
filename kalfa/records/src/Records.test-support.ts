// Stand-ins and data for the laws of `@kalfa/records` (S8, docs/plan/quests/rules-and-records-build-PLAN.md):
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

const textOf = (entry: Entry) => (typeof entry === "string" ? entry : entry.text);

const missing = (method: string, path: string) =>
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

        return entry === undefined ? Effect.fail(missing("readFileString", path)) : Effect.succeed(textOf(entry));
      },
      readFile: (path) => {
        const entry = held.get(relative(path));

        return entry === undefined
          ? Effect.fail(missing("readFile", path))
          : Effect.succeed(new TextEncoder().encode(textOf(entry)));
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

/** A decision as the repo writes it: `id` unquoted, the status words as given, `successor` quoted. */
export const record = (options: {
  readonly id: string;
  readonly status?: string;
  readonly successor?: string;
  readonly title?: string;
  readonly body?: ReadonlyArray<string>;
}) => {
  const title = options.title ?? "A rule that holds";

  return `${[
    "---",
    `id: ${options.id}`,
    `title: ${title}`,
    `status: ${options.status ?? "accepted"}`,
    ...(options.successor === undefined ? [] : [`successor: "${options.successor}"`]),
    "date: 2026-11-18",
    "tags: [records, rules]",
    "---",
    "",
    `# ${options.id}: ${title}`,
    "",
    ...(options.body ?? ["The rule, in plain words."]),
  ].join("\n")}\n`;
};

/** The line, counted from 1, of the first line that starts with `start`. */
export const lineOf = (text: string, start: string) => text.split("\n").findIndex((line) => line.startsWith(start)) + 1;

export const pad = (n: number) => String(n).padStart(4, "0");

/** A decision's number, as a Schema has a property draw it. */
export const Number4 = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 9999 }));

/** `numbers` made different from each other, each moved on to the next free number from where it drew. */
export const distinct = (numbers: ReadonlyArray<number>) => {
  const used = new Set<number>();

  return numbers.map((n) => {
    let next = n;

    while (used.has(next)) {
      next = (next % 9999) + 1;
    }

    used.add(next);

    return next;
  });
};

/** Words that no check reads as a patch: none of `rest`, `holds`, `carried`, `forward`, `amendments`. */
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

export const Phrasing = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 7 }));

/** A line of prose from drawn words. */
export const sentence = (words: ReadonlyArray<string>) => `${words.join(" ")}.`;

/** A file name's slug from drawn words. */
export const slugOf = (words: ReadonlyArray<string>) => words.slice(0, 3).join("-");

/** A file of `count` lines of `width` characters, each ending in a newline: `wc -l` counts `count` of them. */
export const fileLines = (count: number, width: number) => `${"x".repeat(width)}\n`.repeat(count);
