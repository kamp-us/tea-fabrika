// Look: what one look at the typecheck lock found, and `judge`, which decides from it whether the
// lock is free, held or stale. Pure: LocksFile.layer reads the files and the processes, then asks
// `judge`. The rule is Mercurial 7.2.4's `mercurial/lock.py` (`_testlock`): a holder counts while
// its pid is alive, plus a start-time check, since a dead holder's pid can come back as another
// process. Today's tooling (0113, 0410 as amended on 2026-11-15), following next/'s rules (0033).
import { Option, Schema } from "effect";

/** How one pid stands: gone (kill said ESRCH), or running since `startedAt` ms, where ps could read it. */
export const Liveness = Schema.TaggedUnion({
  gone: {},
  running: { startedAt: Schema.optional(Schema.Number) },
});

export type Liveness = typeof Liveness.Type;

/** One lock file as a waiter read it: its text, and its mtime in ms. */
export type Read = { readonly text: string; readonly at: number };

/** What a waiter read: the label and the running command's file, and each pid's liveness. */
export type Look = {
  readonly label: Option.Option<Read>;
  readonly child: Option.Option<Read>;
  readonly liveness: (pid: number) => Liveness;
};

/** What the lock is: free, held by the label's or the running command's pid, or stale and why. */
export const Seen = Schema.TaggedUnion({
  free: {},
  held: { pid: Schema.Int, by: Schema.Literals(["label", "child"]) },
  stale: { reason: Schema.Literals(["gone", "reused", "empty", "unreadable"]) },
});

export type Seen = typeof Seen.Type;

// ps reads a start time to the second, so a process started up to a second after its file's mtime
// can read as later than it; 2 s of slack keeps that one from looking like a reused pid.
const SLACK_MS = 2_000;

// A label is one positive pid and a newline. "0" names the caller's process group to kill(2), and a
// sign or a hex prefix is no pid either.
const PID = /^[1-9][0-9]*$/;

/** The pid a lock file names, if its text is one. */
export const pidIn = (text: string): Option.Option<number> => {
  const trimmed = text.trim();
  return PID.test(trimmed) ? Option.some(Number(trimmed)) : Option.none();
};

/** Whether the pid in `file` is alive and started before its file was written. */
const holding = (look: Look, file: Read): Option.Option<number> =>
  Option.filter(pidIn(file.text), (pid) =>
    Liveness.match(look.liveness(pid), {
      gone: () => false,
      running: ({ startedAt }) => startedAt === undefined || startedAt < file.at + SLACK_MS,
    }),
  );

/**
 * Held when the label's pid, or else the running command's, is alive and started before its file
 * was written; stale otherwise, with the reason; free when there is no label.
 */
export const judge = (look: Look): Seen =>
  Option.match(look.label, {
    onNone: () => Seen.cases.free.make({}),
    onSome: (label) => {
      const byLabel = holding(look, label);

      if (Option.isSome(byLabel)) {
        return Seen.cases.held.make({ pid: byLabel.value, by: "label" });
      }

      const byChild = Option.flatMap(look.child, (child) => holding(look, child));

      if (Option.isSome(byChild)) {
        return Seen.cases.held.make({ pid: byChild.value, by: "child" });
      }

      if (label.text.trim() === "") {
        return Seen.cases.stale.make({ reason: "empty" });
      }

      return Option.match(pidIn(label.text), {
        onNone: () => Seen.cases.stale.make({ reason: "unreadable" }),
        onSome: (pid) => Seen.cases.stale.make({ reason: look.liveness(pid)._tag === "gone" ? "gone" : "reused" }),
      });
    },
  });
