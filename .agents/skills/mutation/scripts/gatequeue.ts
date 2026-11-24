// gatequeue.ts: the line for the one mutation box. Today's lead tooling, not product.
//
// The box is one Docker container at a time (the cap came from a laptop that froze), and its lock
// (`docker.lock`, mutbox's) is taken by whoever asks first when it is free. A run that found it busy
// used to stop with `docker_busy` and be started again by its agent, so a later run could take the
// box before one that had waited for hours. Now a run that needs the box takes a place in line:
//
//   <folder>/<arrival>.json   {pid, label}: one file a waiting run, written with `wx` so no two share a name
//
// - The arrival is the clock in ms, and always after the last file's, so the names sort in arrival order.
// - A run takes the box when it is the first live one in line and the box is free. Whoever holds
//   the lock without a place (the hourly run) is waited for, not raced.
// - A ticket whose process is gone is dropped, whoever finds it: the line never waits on a dead run.
// - A waiting run says where it is and who is ahead when it joins and every `every` seconds; it
//   stops with `Waited` after `limit` seconds, its place given up.
// - Before it takes the box, and on every poll, it asks whether the result it needs has been saved by the
//   run ahead (gatecache.ts): if so it leaves the line and the box is never started.
// - A run whose file someone removed writes it back at its own place.
// - A ticket file that cannot be read (being written, or foreign) is left alone and not counted.
import { Array as Arr, Clock, Duration, Effect, FileSystem, Option, Path, Schema } from "effect";

/** The run stopped waiting after its limit; its place is given up. */
export class Waited extends Schema.TaggedError<Waited, { readonly brand: unique symbol }>()("Waited", {
  seconds: Schema.Finite,
}) {}

const Body = Schema.Struct({ pid: Schema.Int, label: Schema.String });

/** One waiting run: its file's name (its arrival), its process and a few words for who it is. */
export type Ticket = typeof Body.Type & { readonly name: string };

/** What a waiting run says: its place, the line, the run ahead, and who holds the box. */
export type Note = {
  readonly place: number;
  readonly total: number;
  readonly ahead: Ticket | null;
  readonly holder: number | null;
  readonly waited: number;
};

/** The line's settings and its two facts about the machine, each a value so that a law can stand in for it. */
export type Line = {
  readonly dir: string;
  readonly pid: number;
  readonly label: string;
  /** The live process that holds the box, or none. */
  readonly holder: Effect.Effect<number | null, never, FileSystem.FileSystem>;
  readonly alive: (pid: number) => Effect.Effect<boolean>;
  readonly say: (note: Note) => Effect.Effect<void>;
  /** Seconds between looks at the line. */
  readonly poll: number;
  /** Seconds between two notes. */
  readonly every: number;
  /** Seconds after which the run stops waiting. */
  readonly limit: number;
};

const WIDTH = 16;

const ticketName = (arrival: number) => `${String(arrival).padStart(WIDTH, "0")}.json`;

const TICKET = new RegExp(`^\\d{${WIDTH}}\\.json$`);

/** The words of a note for the terminal. Pure. */
export const noteLine = (note: Note): string =>
  `waiting for the box, place ${note.place} of ${note.total}, ${note.waited} s in line; ${
    note.ahead === null
      ? note.holder === null
        ? "none ahead"
        : `none ahead, the box is held by pid ${note.holder}`
      : `ahead: pid ${note.ahead.pid} (${note.ahead.label})`
  }`;

/**
 * Takes a place in line: the file lands after every file there, and goes when the scope ends, whether
 * the run ended well, failed or was stopped.
 */
export const join = Effect.fnUntraced(function* (ask: Pick<Line, "dir" | "pid" | "label">) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  yield* fs.makeDirectory(ask.dir, { recursive: true });

  return yield* Effect.acquireRelease(
    Effect.gen(function* () {
      const names = Arr.filter(yield* fs.readDirectory(ask.dir), (name) => TICKET.test(name)).sort();
      const last = Number(names.at(-1)?.slice(0, WIDTH) ?? 0);
      const body = yield* Schema.encodeEffect(Schema.fromJsonString(Body))({ pid: ask.pid, label: ask.label });

      for (let arrival = Math.max(yield* Clock.currentTimeMillis, last + 1); ; arrival += 1) {
        const name = ticketName(arrival);

        const wrote = yield* fs.writeFileString(path.join(ask.dir, name), body, { flag: "wx" }).pipe(
          Effect.as(true),
          Effect.catchIf(
            (error) => error.reason._tag === "AlreadyExists",
            () => Effect.succeed(false),
          ),
        );

        if (wrote) {
          return { name, pid: ask.pid, label: ask.label };
        }
      }
    }),
    (ticket) => fs.remove(path.join(ask.dir, ticket.name), { force: true }).pipe(Effect.ignore),
  );
});

/** Writes a ticket back at its own name, for a run whose file someone removed; a file that is there stays. */
const restore = Effect.fnUntraced(function* (dir: string, ticket: Ticket) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const body = yield* Schema.encodeEffect(Schema.fromJsonString(Body))({ pid: ticket.pid, label: ticket.label });

  yield* fs.writeFileString(path.join(dir, ticket.name), body, { flag: "wx" }).pipe(Effect.ignore);
});

/** The live runs in line, in arrival order. A run whose process is gone is dropped from the folder as it is found. */
export const waiting = Effect.fnUntraced(function* (ask: Pick<Line, "dir" | "alive">) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  const names = Arr.filter(yield* fs.readDirectory(ask.dir).pipe(Effect.orElseSucceed(() => [])), (name) =>
    TICKET.test(name),
  ).sort();

  const live: Array<Ticket> = [];

  for (const name of names) {
    const raw = yield* fs.readFileString(path.join(ask.dir, name)).pipe(Effect.orElseSucceed(() => ""));

    const body = yield* Schema.decodeEffect(Schema.fromJsonString(Body))(raw).pipe(Effect.orElseSucceed(() => null));

    if (body !== null) {
      if (yield* ask.alive(body.pid)) {
        live.push({ ...body, name });
      } else {
        yield* fs.remove(path.join(ask.dir, name), { force: true }).pipe(Effect.ignore);
      }
    }
  }

  return live;
});

/**
 * Waits in line for the box, then runs `use`. Each look at the line starts with `saved`: a result
 * the run ahead saved ends the wait with no box. At the head of the line with the box free, `use` runs; it gives
 * none when the box was taken by a run outside the line in that moment, and the wait goes on in the same place.
 */
export const held = <A, E1, R1, E2, R2>(
  ask: Line,
  saved: Effect.Effect<Option.Option<A>, E1, R1>,
  use: Effect.Effect<Option.Option<A>, E2, R2>,
) =>
  Effect.gen(function* () {
    const me = yield* join(ask);
    const started = yield* Clock.currentTimeMillis;
    let said: number | null = null;

    for (;;) {
      const found = yield* saved;

      if (Option.isSome(found)) {
        return found.value;
      }

      const line = yield* waiting(ask);
      const holder = yield* ask.holder;
      const index = Arr.findFirstIndex(line, (ticket) => ticket.name === me.name);

      if (Option.isNone(index)) {
        yield* restore(ask.dir, me);
      }

      if (Option.getOrNull(index) === 0 && holder === null) {
        const ran = yield* use;

        if (Option.isSome(ran)) {
          return ran.value;
        }
      }

      const now = yield* Clock.currentTimeMillis;
      const waited = Math.floor((now - started) / 1000);

      if (waited >= ask.limit) {
        return yield* Waited.make({ seconds: waited });
      }

      if (said === null || now - said >= ask.every * 1000) {
        said = now;
        const at = Option.getOrElse(index, () => line.length);

        yield* ask.say({
          place: at + 1,
          total: Math.max(line.length, at + 1),
          ahead: line[at - 1] ?? null,
          holder,
          waited,
        });
      }

      yield* Effect.sleep(Duration.seconds(ask.poll));
    }
  });

/** `held` in a scope of its own: the place is given back as soon as `use` has run. */
export const inLine = <A, E1, R1, E2, R2>(
  ask: Line,
  saved: Effect.Effect<Option.Option<A>, E1, R1>,
  use: Effect.Effect<Option.Option<A>, E2, R2>,
) => Effect.scoped(held(ask, saved, use));
