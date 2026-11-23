// gatecache.ts: the guard check's saved results. One run of the mutation box answers for the same
// code every time, so `survivors.ts` saves what the box said and reads it back for a later call
// with the same key, with no box started. Today's lead tooling, not product.
//
// The key is everything the box's answer depends on, and nothing it does not:
//
//   base      the commit the change starts from, which decides each file's changed lines
//   tree      the head's tree, so the files and the laws. A tree, not a commit: the builder runs the
//             check on its working tree before it commits, the reviewer on the commit after, and
//             both name one tree. A message edit or an amend with the same files is a hit.
//   files     the product files mutated, sorted and unique
//   version   the scripts that make the run (`survivors.ts`, mutbox and what it starts)
//   seconds   MUTATE_SECONDS, the time budget: a larger one can reach more mutants
//
// The commit bodies and `--answers` are not in the key: `Survivor:` lines are read again on every call
// and applied to the saved result, so a line added after the run counts at once.
//
// A result lives in `<folder>/<key>.json`, in the boxes folder beside the main checkout, outside every
// worktree, and a save drops every result older than MUTATE_KEEP_DAYS (survivors.ts), the new one never. Only a whole answer of the box is saved
// (`done` with every sampled mutant reached, or `skip` when nothing could be sampled): a `stuck` run says the box broke, and a
// run the time budget cut short is a part of an answer, and the next call must try again. A file that cannot be read
// or decoded is a miss, never an error.
import { createHash } from "node:crypto"; // edge: a hash of a short text, taken in one step; effect/crypto Digest is async and needs a layer
import { Array as Arr, Clock, Effect, FileSystem, Option, Path, Schema } from "effect";
import { Summary } from "../../lead/scripts/mutbox.ts";

const sha = (text: string) => createHash("sha256").update(text).digest("hex");

/** The key of one run. Pure. */
export const key = (ask: {
  readonly base: string;
  readonly tree: string;
  readonly files: ReadonlyArray<string>;
  readonly version: string;
  readonly seconds: number;
}): string => sha(JSON.stringify([ask.base, ask.tree, [...new Set(ask.files)].sort(), ask.version, ask.seconds]));

/** The version of a set of scripts: a hash of each one's name and text. Pure. */
export const version = (scripts: ReadonlyArray<{ readonly name: string; readonly text: string }>): string =>
  sha(
    JSON.stringify(
      Arr.map(
        [...scripts].sort((a, b) => (a.name < b.name ? -1 : 1)),
        (s) => [s.name, sha(s.text)],
      ),
    ),
  );

const Entry = Schema.Struct({ saved: Schema.Finite, summary: Summary });

/** A saved run: the box's whole answer and when it was saved, in ms. */
export type Saved = typeof Entry.Type;

const file = Effect.fnUntraced(function* (dir: string, id: string) {
  const path = yield* Path.Path;

  return path.join(dir, `${id}.json`);
});

/** The run saved under an id, or none. A file that is missing, unreadable or of another shape is none. */
export const find = Effect.fnUntraced(function* (dir: string, id: string) {
  const fs = yield* FileSystem.FileSystem;
  const raw = yield* fs.readFileString(yield* file(dir, id)).pipe(Effect.orElseSucceed(() => ""));

  return Option.fromNullishOr(
    yield* Schema.decodeEffect(Schema.fromJsonString(Entry))(raw).pipe(Effect.orElseSucceed(() => null)),
  );
});

/** Whether the time budget stopped the run: a partial answer, which a later call under the same budget would repeat. Pure. */
const cutShort = (summary: Summary): boolean =>
  summary.b !== null && (summary.b.unreached > 0 || summary.b.from !== "report");

const DAY = 86_400_000;

/**
 * Drops each saved run of the folder that is more than `days` days old at `now`, and none other: a file
 * that cannot be read is left, since it may be one being written.
 */
const prune = Effect.fnUntraced(function* (dir: string, days: number, now: number) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  const names = Arr.filter(yield* fs.readDirectory(dir).pipe(Effect.orElseSucceed(() => [])), (name) =>
    name.endsWith(".json"),
  );

  for (const name of names) {
    const raw = yield* fs.readFileString(path.join(dir, name)).pipe(Effect.orElseSucceed(() => ""));

    const entry = yield* Schema.decodeEffect(Schema.fromJsonString(Entry))(raw).pipe(Effect.orElseSucceed(() => null));

    if (entry !== null && now - entry.saved > days * DAY) {
      yield* fs.remove(path.join(dir, name), { force: true }).pipe(Effect.ignore);
    }
  }
});

/**
 * Saves an answer of the box under an id, and says whether it did: a `stuck` run is not saved. The
 * file is written whole beside its place and then moved there, so a call that reads it at that
 * moment sees all of it or none. Then every saved run older than `days` days is dropped.
 */
export const keep = Effect.fnUntraced(function* (dir: string, id: string, summary: Summary, days: number) {
  if (summary.outcome === "stuck" || cutShort(summary)) {
    return false;
  }

  const fs = yield* FileSystem.FileSystem;
  const target = yield* file(dir, id);
  const part = `${target}.${process.pid}.part`;
  yield* fs.makeDirectory(dir, { recursive: true });

  yield* fs.writeFileString(
    part,
    yield* Schema.encodeEffect(Schema.fromJsonString(Entry))({ saved: yield* Clock.currentTimeMillis, summary }),
  );

  yield* fs.rename(part, target);
  yield* prune(dir, days, yield* Clock.currentTimeMillis);

  return true;
});
