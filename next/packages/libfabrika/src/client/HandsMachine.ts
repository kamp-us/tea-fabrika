/**
 * The hands client's machine: it asks the brain for work, runs it once, and reports it. A pure tea
 * machine: it reads no socket, no clock and no journal. The start turns its Cmds into frames,
 * journal calls and the one command, and socket events into Msgs.
 *
 * It steps the Link (`transport/Link.ts`) and the hello exchange (`transport/Handshake.ts`) by hand,
 * as the window does, and adds its own work state: list the open jobs for its key, wait when there
 * are none, take one, then save each step in the journal before the next. The command runs only in
 * `executing`, after the brain said it started and `executing` was saved, so a crash never runs it
 * twice: a job whose journal says `executing` and no result ends `unknown interrupted`.
 *
 * @stability unstable
 */
import { applyCell, type Sub } from "@demlik/tea";
import { Cmd, Machine } from "@demlik/tea/effect";
import { Option, Schema } from "effect";
import { Command, Job, Result } from "../jobs/Job.ts";
import { ProcessId } from "../ProcessId.ts";
import { Rev } from "../Rev.ts";
import { Handshake, handshakeMachine, hello, knock } from "../transport/Handshake.ts";
import { backoff, Link, linkMachine, LinkMsg, ping, socketDial, timerDeps } from "../transport/Link.ts";
import { Entry } from "./Journal.ts";

const Dial = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
const Count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
const Ms = Schema.Number.check(Schema.isFinite(), Schema.isGreaterThanOrEqualTo(0));
/** A JSON-RPC id the machine wrote: `j<dial>.<n>`, so an answer from an older dial never matches. */
const CallId = Schema.String;

/** The job a state is about, as `jobs.list` points at it. */
const Pointer = { id: Schema.NonEmptyString, process: ProcessId };
/** A job assigned to this client: its pointer, the execution the brain gave it, and its command. */
const Assigned = Schema.Struct({ ...Pointer, execution: Schema.NonEmptyString, command: Command });
type Assigned = typeof Assigned.Type;
const Exec = Assigned.fields;
/** When the command started, on the client's own clock, once an `executing` entry said so. */
const Started = { startedAt: Schema.optionalKey(Schema.String) };

/**
 * What the client is doing about work, one job at a time.
 *
 * A state with `call` has that JSON-RPC call out. `listing` and `reporting` without one wait
 * `backoff(tries)` before they call again, and `saving` that is `due` waits `backoff(tries)` before
 * it writes again: `tries` counts the failures in a row, so the wait grows. `executing` and `saving`
 * are local work: a link that drops lets them finish. A finish the brain refuses for good is saved
 * as a `held` entry, and the client goes back to listing: nothing waits on it.
 */
const Work = Schema.TaggedUnion({
  /** The link is not online, and no local work is running. */
  offline: {},
  /** `jobs.list` is out, or waits to go out again. */
  listing: { call: Schema.optionalKey(CallId), tries: Count },
  /** Nothing open: a `jobs.wait` after `rev` is out, parked at the brain. */
  watching: { rev: Rev, call: CallId },
  /** `jobs.take` is out for the pointer's process. */
  taking: { ...Pointer, call: CallId, tries: Count },
  /** Assigned to me: the journal entry for this job is being read. */
  recalling: { ...Exec, state: Schema.Literals(["assigned", "started"]) },
  /** A journal write of `entry` is out, or `due` again after a failure. Its `_tag` says what follows. */
  saving: { ...Exec, entry: Entry, tries: Count, due: Schema.Boolean },
  /** `prepared` is saved; `jobs.started` is out. */
  starting: { ...Exec, call: CallId },
  /** `executing` is saved, at `startedAt`; the command is out. The one place it runs. */
  executing: { ...Exec, startedAt: Schema.String },
  /** `result` is saved; `jobs.finish` with it is out, or waits to go out again. */
  reporting: { ...Exec, result: Result, ...Started, call: Schema.optionalKey(CallId), tries: Count },
});
type Work = typeof Work.Type;

/**
 * The jobs not to take again on this link while the list stays at `rev`: each take of them was
 * refused for a reason that cannot change by itself. A list at another rev starts it empty.
 */
const Skip = Schema.Struct({ rev: Rev, jobs: Schema.Array(Schema.String) });

/**
 * The hands client's whole state: its link, its hello exchange, its work, how many calls it named,
 * the failed dials the live dial follows (its socket's jitter), the key the door admitted, the
 * newest rev it heard, the jobs whose finish was refused for good (`held`, never sent or taken
 * again by this process), and the jobs this link skips.
 */
const HandsModel = Schema.Struct({
  link: Link,
  handshake: Handshake,
  work: Work,
  sent: Count,
  tries: Count,
  key: Schema.NullOr(Schema.String),
  seen: Rev,
  held: Schema.Array(Schema.String),
  skip: Skip,
});
type HandsModel = typeof HandsModel.Type;

const Own = Schema.Union([
  // What one dial's socket saw, raw, from the dial Sub the window shares.
  Schema.Struct({ type: Schema.Literal("socket_opened"), dial: Dial, at: Ms }),
  Schema.Struct({ type: Schema.Literal("frame"), dial: Dial, text: Schema.String, at: Ms, ms: Schema.optionalKey(Ms) }),
  Schema.Struct({ type: Schema.Literal("socket_closed"), dial: Dial, code: Schema.Int, at: Ms }),
  // The work's own timer: the backoff of the state's `tries` ran out.
  Schema.Struct({ type: Schema.Literal("again"), tries: Count }),
]);
type Own = typeof Own.Type;

/** One JSON-RPC call on the dial's socket. The start adds `sentAt` to a call whose params say what
 *  the client has `seen`: the writer's two facts go together. */
const write = Cmd.make("write", {
  input: Schema.Struct({ dial: Dial, id: CallId, method: Schema.String, params: Schema.Json }),
  ok: Schema.Null,
  err: ["unreachable"],
});

/** Reads one job's journal entry, or null before its first. */
const journalRead = Cmd.make("journal_read", {
  input: Schema.Struct({ job: Schema.String }),
  ok: Schema.NullOr(Entry),
  err: ["JournalError"],
});

/** Saves one job's journal entry, replacing the one before. */
const journalWrite = Cmd.make("journal_write", {
  input: Schema.Struct({ job: Schema.String, entry: Entry }),
  ok: Schema.Null,
  err: ["JournalError"],
});

/** Runs the job's one command and answers its result. A command that cannot start is a `failed` result. */
const execute = Cmd.make("execute", {
  input: Schema.Struct({ command: Command }),
  ok: Result,
  err: [],
});

type Out = ReadonlyArray<
  | ReturnType<typeof write>
  | ReturnType<typeof hello>
  | ReturnType<typeof knock>
  | ReturnType<typeof ping>
  | ReturnType<typeof journalRead>
  | ReturnType<typeof journalWrite>
  | ReturnType<typeof execute>
>;

type Step = readonly [HandsModel, Out];
type SocketSub = Sub<"socket", { readonly dial: number; readonly tries: number }>;

const stay = (s: HandsModel): Step => [s, []];
const offline = (s: HandsModel): Step => [{ ...s, work: Work.cases.offline.make({}) }, []];

/** The assigned job a work state carries, alone. */
const assigned = (w: Assigned): Assigned => ({
  id: w.id,
  process: w.process,
  execution: w.execution,
  command: w.command,
});

/** A Msg's time as the journal keeps it: the client's own clock, in ISO text. */
const iso = (at: number): string => new Date(at).toISOString();

/** The start time to keep on an entry, when one is known. */
const since = (startedAt: string | undefined) => (startedAt === undefined ? {} : { startedAt });

/** A skip list for no job yet. */
const noSkip = Skip.make({ rev: 0, jobs: [] });

const Woke = Schema.Struct({ rev: Rev });
const Listed = Schema.Struct({ jobs: Schema.Array(Schema.Struct(Pointer)), rev: Rev });
const TakeReply = Schema.TaggedUnion({ idle: {}, assigned: { job: Job }, refused: { reason: Schema.String } });
const Admitted = Schema.Struct({ identity: Schema.Struct({ key: Schema.String }) });
const WaitingCode = Schema.Struct({ code: Schema.String, until: Schema.Number });
const Nonce = Schema.Struct({ nonce: Schema.String });

const Rpc = Schema.Struct({
  id: Schema.String,
  result: Schema.optionalKey(Schema.Unknown),
  error: Schema.optionalKey(
    Schema.Struct({ data: Schema.optionalKey(Schema.Struct({ reason: Schema.optionalKey(Schema.String) })) }),
  ),
});

const Notice = Schema.Struct({ method: Schema.String, params: Schema.optionalKey(Schema.Unknown) });
const decodeFrame = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Union([Rpc, Notice])));

/** The result a crash leaves: the command may have run, and nobody saw how it ended. */
const interrupted = Result.cases.unknown.make({ reason: "interrupted" });

// --- The work ------------------------------------------------------------------------------------

/** Names the next call on the online dial and writes it. Only an online link calls. */
const calling = (s: HandsModel, method: string, params: typeof Schema.Json.Type) => {
  const dial = socketDial(s.link) ?? 0;
  const id = `j${dial}.${s.sent + 1}`;
  return { s: { ...s, sent: s.sent + 1 }, call: id, out: [write({ dial, id, method, params })] };
};

/** Lists the open jobs for this key, keeping the failures in a row so far. */
const list = (s: HandsModel, tries = 0): Step => {
  if (s.link._tag !== "online") {
    return offline(s);
  }

  const asked = calling(s, "jobs.list", {});
  return [{ ...asked.s, work: Work.cases.listing.make({ call: asked.call, tries }) }, asked.out];
};

/** Lists again once `backoff` of one more failure has passed: nothing is out until the timer fires. */
const relist = (s: HandsModel, tries: number): Step =>
  s.link._tag === "online" ? [{ ...s, work: Work.cases.listing.make({ tries: tries + 1 }) }, []] : offline(s);

/** Sends the finish for `job` with `result`. Offline, the result waits in the journal for the next link. */
const report = (s: HandsModel, job: Assigned, result: Result, tries: number, startedAt?: string): Step => {
  if (s.link._tag !== "online") {
    return offline(s);
  }

  const params = { process: job.process, job: job.id, execution: job.execution, result, seen: s.seen };
  const asked = calling(s, "jobs.finish", params);
  return [
    { ...asked.s, work: Work.cases.reporting.make({ ...job, result, ...since(startedAt), call: asked.call, tries }) },
    asked.out,
  ];
};

/** Holds `job` for good in this process, and lists again: a held job is never sent or taken again. */
const hold = (s: HandsModel, job: Assigned): Step => list({ ...s, held: [...s.held, job.id] });

/** Saves `entry` for `job` before the step that follows it. */
const save = (s: HandsModel, job: Assigned, entry: Entry, tries = 0): Step => [
  { ...s, work: Work.cases.saving.make({ ...job, entry, tries, due: false }) },
  [journalWrite({ job: job.id, entry })],
];

/**
 * The recovery table: what the brain's state and the journal's entry for the same job mean the
 * client does next. An entry of another execution is no entry for this one. `at` stamps the entry
 * the next step saves.
 *
 * | Brain     | Journal (this execution) | Next                                       |
 * |-----------|--------------------------|--------------------------------------------|
 * | assigned  | nothing or `prepared`    | save `prepared`, then `jobs.started`       |
 * | started   | `prepared`               | save `executing`, then execute             |
 * | any       | `executing`              | save `unknown interrupted`, then finish    |
 * | any       | `result`, `acknowledged` | finish with the saved result               |
 * | any       | `held`                   | send nothing: hold it, and list again      |
 * | started   | nothing                  | save `unknown interrupted`, then finish    |
 */
const recover = (
  s: HandsModel,
  job: Assigned,
  state: "assigned" | "started",
  entry: Entry | null,
  at: string,
): Step => {
  const mine = entry !== null && entry.execution === job.execution ? entry : null;

  if (mine?._tag === "held") {
    return hold(s, job);
  }

  if (mine?._tag === "result" || mine?._tag === "acknowledged") {
    return report(s, job, mine.result, 0, mine.startedAt);
  }

  if (mine?._tag === "executing" || (state === "started" && mine === null)) {
    const startedAt = mine?._tag === "executing" ? mine.at : undefined;
    return save(
      s,
      job,
      Entry.cases.result.make({ execution: job.execution, result: interrupted, ...since(startedAt), at }),
    );
  }

  return state === "assigned"
    ? save(s, job, Entry.cases.prepared.make({ execution: job.execution, at }))
    : save(s, job, Entry.cases.executing.make({ execution: job.execution, at }));
};

/** What follows a saved entry: start, run, report or list again. */
const saved = (s: HandsModel, job: Assigned, entry: Entry): Step => {
  switch (entry._tag) {
    case "prepared": {
      if (s.link._tag !== "online") {
        return offline(s);
      }

      const params = { process: job.process, job: job.id, execution: job.execution, seen: s.seen };
      const asked = calling(s, "jobs.started", params);
      return [{ ...asked.s, work: Work.cases.starting.make({ ...job, call: asked.call }) }, asked.out];
    }
    case "executing":
      return [
        { ...s, work: Work.cases.executing.make({ ...job, startedAt: entry.at }) },
        [execute({ command: job.command })],
      ];
    case "result":
      return report(s, job, entry.result, 0, entry.startedAt);
    case "acknowledged":
      return list(s);
    case "held":
      return hold(s, job);
  }
};

/**
 * The listed job to take next, or none. A take names a process, so a process with two open jobs
 * for this key answers `ambiguous` every time: only a job whose process is listed once can be
 * taken. A held job and a job this link skips are never taken. Each failed take in a row tries the
 * next one, so one job whose take fails for a passing reason does not hold back the others.
 */
const takeable = (s: HandsModel, jobs: ReadonlyArray<(typeof Listed.Type.jobs)[number]>, tries: number) => {
  const once = jobs.filter(
    (p) =>
      jobs.filter((q) => q.process === p.process).length === 1 && !s.held.includes(p.id) && !s.skip.jobs.includes(p.id),
  );
  return once[tries % Math.max(1, once.length)];
};

/**
 * Take refusals that cannot change by themselves while the list stays at one rev, so the job is
 * skipped on this link until the list's rev moves (`gateway/Jobs.ts`'s `jobs.take`):
 *
 * - `idle`: no open job for the process, so the list was behind; only a new request moves it.
 * - `ambiguous`: the process has two open jobs for this key (`JobAccess.select`); only a new
 *   request or an outside finish changes that.
 * - `not_allowed`: the job is not this key's to take, as is an assignment that names another key
 *   or a job no longer open; a job's target never changes.
 * - `lacks_capability`: the job needs what this link's hello did not offer; `has` is fixed for the
 *   link.
 * - `bad_input`: the client's own params, which it would send the same again.
 *
 * Every other refusal (`rate_limited`, `unreachable`, `unavailable`, a storage failure, or an
 * answer that does not decode) can pass by itself, so the list and take are tried again after a
 * backoff. A journal entry that reads as no entry (`bad_entry`) also cannot change by itself.
 */
const STUCK: ReadonlySet<string> = new Set(["idle", "ambiguous", "not_allowed", "lacks_capability", "bad_input"]);

/** Why a take that assigned nothing to this client was refused, or null when its answer does not decode. */
const refusal = (reason: string | null, result: unknown): string | null =>
  reason ??
  Option.match(Schema.decodeUnknownOption(TakeReply)(result), {
    onNone: () => null,
    onSome: (reply) => (reply._tag === "idle" ? "idle" : reply._tag === "refused" ? reply.reason : "not_allowed"),
  });

/** Skips `job` on this link while the list stays at its rev, and lists again at once. */
const skip = (s: HandsModel, job: string): Step => list({ ...s, skip: { ...s.skip, jobs: [...s.skip.jobs, job] } });

/** A journal error that says the saved value is no entry, which reading again cannot change. */
const BadEntry = Schema.Struct({ reason: Schema.Literal("bad_entry") });

/** The assignment in a take's answer, when it is this client's own for an open job. */
const assignment = (s: HandsModel, result: unknown) =>
  Option.flatMap(Schema.decodeUnknownOption(TakeReply)(result), (reply) => {
    const state = reply._tag === "assigned" ? reply.job.state : null;
    return (state?._tag === "assigned" || state?._tag === "started") &&
      s.key !== null &&
      state.assignment.executor.key === s.key
      ? Option.some({
          job: {
            id: state.request.id,
            process: state.request.process,
            execution: state.assignment.execution,
            command: state.request.command,
          },
          state: state._tag,
        })
      : Option.none();
  });

/** The brain answered the live work call: `result` when it is ok, else the door's `reason`. */
const answered = (s: HandsModel, result: unknown, reason: string | null, at: string): Step => {
  const w = s.work;
  const woke = reason === null ? Option.getOrNull(Schema.decodeUnknownOption(Woke)(result)) : null;
  const heard: HandsModel = woke === null ? s : { ...s, seen: Math.max(s.seen, woke.rev) };

  switch (w._tag) {
    case "listing": {
      const listed = reason === null ? Option.getOrNull(Schema.decodeUnknownOption(Listed)(result)) : null;

      if (listed === null) {
        return relist(s, w.tries);
      }

      // A list at another rev means new work came: every job this link skipped may be tried again.
      const next = {
        ...s,
        seen: Math.max(s.seen, listed.rev),
        skip: listed.rev === s.skip.rev ? s.skip : Skip.make({ rev: listed.rev, jobs: [] }),
      };
      const pick = takeable(next, listed.jobs, w.tries);

      if (pick === undefined) {
        const asked = calling(next, "jobs.wait", { after: listed.rev });
        return [{ ...asked.s, work: Work.cases.watching.make({ rev: listed.rev, call: asked.call }) }, asked.out];
      }

      const asked = calling(next, "jobs.take", { process: pick.process, seen: next.seen });
      return [{ ...asked.s, work: Work.cases.taking.make({ ...pick, call: asked.call, tries: w.tries }) }, asked.out];
    }
    case "watching":
      return woke === null ? relist(s, 0) : list(heard);
    case "taking": {
      // An idle, a refusal, or a job assigned to another key: nothing here runs, and the list is
      // asked again. A refusal that cannot change by itself skips the job on this link.
      const mine = reason === null ? assignment(s, result) : Option.none();
      const refused = refusal(reason, result);
      return Option.match(mine, {
        onNone: () => (refused !== null && STUCK.has(refused) ? skip(s, w.id) : relist(s, w.tries)),
        onSome: ({ job, state }) => [
          { ...s, work: Work.cases.recalling.make({ ...job, state }) },
          [journalRead({ job: job.id })],
        ],
      });
    }
    case "starting":
      return woke === null
        ? relist(s, 0)
        : save(heard, assigned(w), Entry.cases.executing.make({ execution: w.execution, at }));
    case "reporting": {
      const job = assigned(w);

      const started = since(w.startedAt);

      if (reason === "unavailable") {
        // The result is saved at the brain and its requester's wake failed: send the same one again.
        return [
          { ...s, work: Work.cases.reporting.make({ ...job, result: w.result, ...started, tries: w.tries + 1 }) },
          [],
        ];
      }

      // Refused for good: why is saved first, so no process sends this result again, then the
      // client lists again and the rest of the work goes on.
      return reason !== null || woke === null
        ? save(
            s,
            job,
            Entry.cases.held.make({
              execution: w.execution,
              result: w.result,
              reason: reason ?? "other",
              ...started,
              at,
            }),
          )
        : save(
            heard,
            job,
            Entry.cases.acknowledged.make({ execution: w.execution, result: w.result, rev: woke.rev, ...started, at }),
          );
    }
    default:
      return stay(s);
  }
};

/** The work's timer: the backoff a state waits before it calls or writes again, or null. */
const workTimer = (w: Work): { readonly ms: number; readonly msg: Own } | null =>
  ((w._tag === "listing" || w._tag === "reporting") && w.call === undefined) || (w._tag === "saving" && w.due)
    ? { ms: backoff(w.tries), msg: { type: "again", tries: w.tries } }
    : null;

/** The work state a journal Cmd's answer is for: the write out now, of the same entry for the same job. */
const writing = (w: Work, cmd: { readonly job: string; readonly entry: Entry }) =>
  w._tag === "saving" &&
  !w.due &&
  w.id === cmd.job &&
  w.entry._tag === cmd.entry._tag &&
  w.entry.execution === cmd.entry.execution
    ? w
    : null;

// --- The link and the hello exchange ------------------------------------------------------------

/**
 * What a change of the link means for the work: list once online, stop all but local work once
 * not. A new link skips nothing yet: a refusal for good is kept for the link it came on.
 */
const moved = (was: HandsModel, [stepped, out]: Step): Step => {
  const fresh = was.link._tag !== "online" && stepped.link._tag === "online";
  const s = fresh ? { ...stepped, skip: noSkip } : stepped;

  if (fresh && s.work._tag === "offline") {
    const [listed, calls] = list(s);
    return [listed, [...out, ...calls]];
  }

  const local = s.work._tag === "executing" || s.work._tag === "saving";
  return s.link._tag !== "online" && !local ? [offline(s)[0], out] : [s, out];
};

/** Steps the Link by hand. A new dial starts its own hello exchange; a grant wait's renewal knocks. */
const linked = (s: HandsModel, m: LinkMsg): Step => {
  const [link, cmds] = applyCell(linkMachine, s.link, m);
  const open = socketDial(link);
  const fresh = open !== null && open > s.handshake.dial;
  // A grant wait's renewal knock goes on the dial it holds, with its own id `k<dial>.<n>`: its answer
  // renews the code the exchange shows.
  const renew = cmds.some((c) => c.type === "knock");
  const next: HandsModel = {
    ...s,
    link,
    handshake: fresh ? applyCell(handshakeMachine, s.handshake, { type: "opened", dial: open })[0] : s.handshake,
    tries: fresh && link._tag === "dialing" ? (link.tries ?? 0) : s.tries,
    sent: renew ? s.sent + 1 : s.sent,
  };
  const pings = cmds.filter((c): c is ReturnType<typeof ping> => c.type === "ping");
  const knocks = renew ? [knock({ dial: open ?? 0, id: `k${open ?? 0}.${next.sent}` })] : [];
  return moved(s, [next, [...pings, ...knocks]]);
};

type HandshakeIn =
  typeof handshakeMachine extends Machine<Handshake, infer M, infer _C, infer _U, infer _X> ? M : never;

/** The Link Msg a change of the hello exchange means, if any. */
const outcome = (was: Handshake, now: Handshake, fingerprint: string): LinkMsg | null => {
  if (now._tag === "admitted" && was._tag !== "admitted") {
    return { type: "admitted", dial: now.dial, ping: now.ping, ms: now.ms };
  }

  if (now._tag === "waiting" && (was._tag !== "waiting" || was.code !== now.code || was.until !== now.until)) {
    return { type: "not_granted", dial: now.dial, fingerprint, code: now.code, until: now.until, ms: now.ms };
  }

  return was._tag === "waiting" && now._tag === "initializing" ? { type: "granted", dial: now.dial } : null;
};

/** Steps the hello exchange by hand, sends its Cmds on and tells the Link what changed. */
const shook = (s: HandsModel, m: HandshakeIn): Step => {
  const [handshake, cmds] = applyCell<Handshake, HandshakeIn, ReturnType<typeof hello> | ReturnType<typeof knock>>(
    handshakeMachine,
    s.handshake,
    m,
  );
  const next: HandsModel = { ...s, handshake };
  const told: LinkMsg | null =
    handshake._tag === "failed" && s.handshake._tag !== "failed"
      ? { type: "blocked", reason: handshake.error }
      : outcome(s.handshake, handshake, s.key ?? "");

  if (told === null) {
    return [next, cmds];
  }

  const [after, out] = linked(next, told);
  return [after, [...cmds, ...out]];
};

/** A frame of the live dial, handed to its one owner: the Link, the hello exchange or the work. */
const frameIn = (s: HandsModel, m: { readonly dial: number; readonly text: string; readonly at: number }): Step => {
  if (m.dial !== socketDial(s.link)) {
    return stay(s);
  }

  if (m.text === "pong") {
    return linked(s, { type: "pong", dial: m.dial });
  }

  const decoded = decodeFrame(m.text);

  if (Option.isNone(decoded)) {
    return stay(s);
  }

  const frame = decoded.value;
  const waiting = (params: unknown): Step =>
    Option.match(Schema.decodeUnknownOption(WaitingCode)(params), {
      onNone: () => stay(s),
      onSome: (w) => shook(s, { type: "waiting", dial: m.dial, ...w, at: m.at }),
    });

  if (!("id" in frame)) {
    if (frame.method === "challenge" || frame.method === "client.granted") {
      return Option.match(Schema.decodeUnknownOption(Nonce)(frame.params), {
        onNone: () => stay(s),
        onSome: ({ nonce }) =>
          shook(s, { type: frame.method === "challenge" ? "challenge" : "granted", dial: m.dial, nonce, at: m.at }),
      });
    }

    return frame.method === "gateway.waiting" ? waiting(frame.params) : stay(s);
  }

  const reason = frame.error === undefined ? null : (frame.error.data?.reason ?? "other");

  if (frame.id.startsWith("h")) {
    const [next, out] = shook(s, {
      type: "answer",
      dial: m.dial,
      id: frame.id,
      result: frame.result ?? null,
      ...(reason === null ? {} : { reason }),
      at: m.at,
    });
    // The key the door admitted is the one every assignment this client runs must name.
    const admitted = next.handshake._tag === "admitted" && s.handshake._tag !== "admitted";
    const key = admitted ? Option.getOrNull(Schema.decodeUnknownOption(Admitted)(frame.result)) : null;
    return [key === null ? next : { ...next, key: key.identity.key }, out];
  }

  if (frame.id.startsWith("k")) {
    return waiting(frame.result);
  }

  return "call" in s.work && s.work.call === frame.id ? answered(s, frame.result, reason, iso(m.at)) : stay(s);
};

/**
 * The hands client as one tea machine.
 *
 * **Details**
 *
 * It boots on dial 1 with its work `offline`, and lists once the Link is online. Its `socket` Sub
 * asks for one socket per dial the Link has, and its timers are tea's built-in `timer`: the Link's,
 * and the work's backoff. An answer for a call id that is not the live one, a Cmd's answer for a job
 * the work is not about, and a take that assigns another key's job change nothing it would run. Its
 * Cmds are `write`, `hello`, `knock`, `ping`, `journal_read`, `journal_write` and `execute`.
 *
 * @stability unstable
 * @category constructors
 */
export const handsMachine = Machine.make({
  model: HandsModel,
  msg: Schema.Union([LinkMsg, Own]),
  cmds: [write, hello, knock, ping, journalRead, journalWrite, execute],
  types: { sub: {} as SocketSub },
  init: (loaded) => [
    loaded ??
      HandsModel.make({
        link: linkMachine.init(null, {})[0],
        // Dial 1's exchange waits for its challenge; its socket opening times it.
        handshake: applyCell(handshakeMachine, handshakeMachine.init(null, {})[0], { type: "opened", dial: 1 })[0],
        work: Work.cases.offline.make({}),
        sent: 0,
        tries: 0,
        key: null,
        seen: 0,
        held: [],
        skip: noSkip,
      }),
    [],
  ],
  update: {
    admitted: linked,
    not_granted: linked,
    granted: linked,
    closed: linked,
    retry: linked,
    beat: linked,
    pong: linked,
    stalled: linked,
    renew: linked,
    blocked: linked,
    ask_again: linked,
    socket_opened: (s, m): Step =>
      socketDial(s.link) === m.dial ? shook(s, { type: "opened", dial: m.dial, at: m.at }) : stay(s),
    frame: (s, m): Step => frameIn(s, m),
    socket_closed: (s, m): Step => {
      if (socketDial(s.link) !== m.dial) {
        return stay(s);
      }

      const h = s.handshake;
      const ms = h.dial === m.dial && "since" in h && h.since !== undefined ? Math.max(0, m.at - h.since) : 0;
      return linked(s, { type: "closed", dial: m.dial, code: m.code, fingerprint: s.key ?? "", ms });
    },
    again: (s): Step => {
      const w = s.work;

      if (w._tag === "listing" && w.call === undefined) {
        return list(s, w.tries);
      }

      if (w._tag === "reporting" && w.call === undefined) {
        return report(s, assigned(w), w.result, w.tries, w.startedAt);
      }

      return w._tag === "saving" && w.due ? save(s, assigned(w), w.entry, w.tries) : stay(s);
    },
    write_ok: stay,
    // The socket is gone: its close moves the Link, and the work with it.
    write_err: stay,
    hello_ok: (s, m): Step => shook(s, m),
    hello_err: (s, m): Step => shook(s, m),
    knock_ok: (s, m): Step => (m.cmd.id.startsWith("h") ? shook(s, m) : stay(s)),
    knock_err: (s, m): Step => (m.cmd.id.startsWith("h") ? shook(s, m) : stay(s)),
    ping_ok: stay,
    ping_err: stay,
    journal_read_ok: (s, m): Step => {
      const w = s.work;
      return w._tag === "recalling" && w.id === m.cmd.job
        ? recover(s, assigned(w), w.state, m.value, iso(m.at))
        : stay(s);
    },
    // An entry that cannot be read proves nothing: list, take and read it again after a backoff. A
    // saved value that is no entry reads the same every time: the job is skipped on this link.
    journal_read_err: (s, m): Step =>
      s.work._tag !== "recalling" || s.work.id !== m.cmd.job
        ? stay(s)
        : Option.isSome(Schema.decodeUnknownOption(BadEntry)(m.error))
          ? skip(s, s.work.id)
          : relist(s, 0),
    journal_write_ok: (s, m): Step => {
      const w = writing(s.work, m.cmd);
      return w === null ? stay(s) : saved(s, assigned(w), w.entry);
    },
    // A write that failed is tried again after a backoff. Nothing that follows it starts.
    journal_write_err: (s, m): Step => {
      const w = writing(s.work, m.cmd);
      return w === null ? stay(s) : [{ ...s, work: { ...w, tries: w.tries + 1, due: true } }, []];
    },
    execute_ok: (s, m): Step => {
      const w = s.work;
      return w._tag === "executing"
        ? save(
            s,
            assigned(w),
            Entry.cases.result.make({ execution: w.execution, result: m.value, startedAt: w.startedAt, at: iso(m.at) }),
          )
        : stay(s);
    },
    // A command whose answer came back malformed may have run: its result is not known.
    execute_err: (s, m): Step => {
      const w = s.work;
      return w._tag === "executing"
        ? save(
            s,
            assigned(w),
            Entry.cases.result.make({
              execution: w.execution,
              result: interrupted,
              startedAt: w.startedAt,
              at: iso(m.at),
            }),
          )
        : stay(s);
    },
  },
  subs: [
    { type: "timer", deps: (s) => timerDeps(s.link) },
    { type: "timer", deps: (s) => workTimer(s.work) },
    {
      type: "socket",
      deps: (s) => {
        const dial = socketDial(s.link);
        return dial === null ? null : { dial, tries: s.tries };
      },
    },
  ],
});
