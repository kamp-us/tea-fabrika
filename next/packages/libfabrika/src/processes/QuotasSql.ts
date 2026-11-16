/**
 * The quota accounts on any `Sql`: the Project's admission policy with its account reads, and one
 * name's own accounting port. Each charge is saved in the transaction that commits the data it
 * charges.
 */
import { applyCell } from "@demlik/tea";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { Entry, encodedBytes, lineFor, type Line } from "../ledger/Log.ts";
import { Selection } from "../ledger/Referee.ts";
import { accountingEntries, nextPlace } from "../ledger/RefereeSql.ts";
import { WritePolicy, Writer, TrustedWriter } from "../ledger/WritePolicy.ts";
import type { Sql } from "../Sql.ts";
import * as Quota from "./internal/quota.ts";
import { ProcessTable } from "./Process.ts";
import {
  BadRow,
  Quotas,
  QuotasError,
  RecoveryReserveExhausted,
  Storage,
  type Accounting,
  type Allowance,
  type Charge,
  type Limits,
  type Use,
} from "./Quotas.ts";

const TABLES = [
  "CREATE TABLE IF NOT EXISTS quota_accounts (account TEXT PRIMARY KEY, value TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS quota_entries (rev INTEGER PRIMARY KEY, account TEXT NOT NULL, bytes INTEGER NOT NULL)",
  "CREATE TABLE IF NOT EXISTS quota_steps (name TEXT NOT NULL, message TEXT NOT NULL, account TEXT NOT NULL, bytes INTEGER NOT NULL, settled INTEGER NOT NULL, PRIMARY KEY(name,message))",
  "CREATE TABLE IF NOT EXISTS quota_restored (id INTEGER PRIMARY KEY, rev INTEGER NOT NULL)",
];

const encode = Schema.encodeSync(Schema.fromJsonString(Quota.Model));
const decode = Schema.decodeUnknownSync(Schema.fromJsonString(Quota.Model));
// An account's row key is its encoded tagged value, so no two kinds of account can share one.
const key = Schema.encodeSync(Schema.fromJsonString(Quota.Account));
const readAccount = Schema.decodeUnknownSync(Schema.fromJsonString(Quota.Account));
const Stepped = Schema.TaggedStruct("stepped", { input: Schema.String, pos: Schema.Number, build: Schema.String });
const StepBody = Schema.Struct({ input: Schema.String, pos: Schema.Number, build: Schema.String });
const readStep = Schema.decodeUnknownOption(StepBody);
const Held = Schema.Struct({ account: Schema.String, bytes: Schema.Number, settled: Schema.Number });
const readHeld = Schema.decodeUnknownSync(Held);

/**
 * Who a write is charged for, as trusted code said around it: `owner`, the owner its stream names;
 * a `program` writing as the process `process`; the `recovery` of `process`; the `runtime` of
 * `process` writing its own stream; or `infrastructure`, no account.
 */
const Authority = Schema.TaggedUnion({
  owner: {},
  program: { process: Schema.String },
  recovery: { process: Schema.String },
  runtime: { process: Schema.String },
  infrastructure: {},
});
type Authority = typeof Authority.Type;

const fromWriter = (writer: Writer | undefined): Authority =>
  writer === undefined
    ? Authority.cases.owner.make({})
    : Writer.match(writer, {
        runtime: ({ process }) => Authority.cases.runtime.make({ process }),
        own: ({ process }) => Authority.cases.program.make({ process }),
      });

// The brain's own streams: lifecycle, the door, the hands tasks, the instance's starts and access,
// and a person's trust in a repository. No program owns them, so a write there with no trusted
// writer, such as the hands client's own task updates through the door, is infrastructure, never a
// program's charge.
const infrastructure = (stream: string) =>
  stream === ProcessTable.stream ||
  stream.startsWith("processes/") ||
  stream === "gateway" ||
  stream.startsWith("gateway/") ||
  stream.startsWith("job:") ||
  stream.startsWith("target:") ||
  stream.startsWith("settings/") ||
  stream.startsWith("permissions/") ||
  stream.startsWith("repository/");

const programAccount = (program: string) => Quota.Account.cases.program.make({ program });
const recoveryAccount = (name: string) => Quota.Account.cases.recovery.make({ name, location: "project" });
const none = { writes: 0, bytes: 0 };
const free = Result.succeed(undefined);
const refuse = Result.fail("quota" as const);

// A store failure met while accounting rows are read or written, as the error every call fails with.
const failed = (cause: unknown) =>
  cause instanceof QuotasError ? cause : new QuotasError({ reason: new Storage({ cause }) });

const use = (model: Quota.Model): Use => ({
  writes: model.writes,
  bytes: model.account._tag === "program" ? model.bytes - model.ahead.bytes : model.bytes,
  ahead: model.ahead,
  total: model.total,
});

/**
 * Creates the layer that provides `Quotas` and the ledger's `WritePolicy` over the Project's
 * store.
 *
 * **Details**
 *
 * Admission finds an entry's owning program in the committed process history and charges that
 * program's account. A recovery write, and a write a process's own runtime makes, is charged to
 * the name's recovery account instead, except a step record whose charge was taken ahead with
 * its message. Infrastructure writes are not charged. Entries committed before accounting existed
 * are charged to their owners first, whatever the limits.
 *
 * The accounting tables are made when the layer is built. A store that refuses them fails the
 * build with `QuotasError`, its reason `Storage`.
 *
 * @category layers
 */
export const layer = (sql: Sql, options: { readonly brain: string; readonly limits: Limits }) =>
  Layer.unwrap(
    Effect.flatMap(Clock.Clock, (clock) => Effect.try({ try: () => make(sql, options, clock), catch: failed })),
  );

const make = (sql: Sql, options: { readonly brain: string; readonly limits: Limits }, clock: Clock.Clock) => {
  // The authority a synchronous step runs under, set by `within` around it and nowhere else.
  let authority: Option.Option<Authority> = Option.none();
  const limits = options.limits;

  // The tables are made once, when the layer is built and before any transaction, so a first
  // write that rolls back cannot take them away, and no later write pays for them again.
  for (const query of TABLES) {
    sql.exec(query);
  }

  const allowance = (account: Quota.Account): Allowance =>
    Quota.Account.match(account, {
      program: () => ({ writes: limits.writes, bytes: limits.storage, message: limits.recovery.project.message }),
      recovery: ({ location }) => limits.recovery[location],
      local: () => limits.recovery.process,
      supervisor: () => limits.recovery.process,
    });
  const machine = (account: Quota.Account) => Quota.make({ account, limits: allowance(account) });
  const load = (account: Quota.Account) => {
    const [row] = sql.exec("SELECT value FROM quota_accounts WHERE account=?", key(account));
    return row === undefined ? machine(account).init(null, {})[0] : decode(row.value);
  };
  const save = (model: Quota.Model) =>
    sql.exec(
      "INSERT INTO quota_accounts (account,value) VALUES (?,?) ON CONFLICT(account) DO UPDATE SET value=excluded.value",
      key(model.account),
      encode(model),
    );
  const charged = (entry: Entry, account: Quota.Account) =>
    sql.exec(
      "INSERT INTO quota_entries (rev,account,bytes) VALUES (?,?,?)",
      entry.rev,
      key(account),
      encodedBytes(entry),
    );
  const propose = (
    account: Quota.Account,
    entry: Entry,
    ahead = none,
    replay?: { readonly message: string; readonly recovery: string },
  ) => {
    const next = applyCell(machine(account), load(account), {
      type: "propose",
      at: entry.arrivedAt,
      operation: "ledger",
      writes: 1,
      bytes: encodedBytes(entry),
      ahead,
      ...(replay === undefined ? {} : { replay }),
    })[0];

    if (next._tag === "reserve_fault") {
      throw new QuotasError({ reason: next.fault });
    }

    if (next.decision._tag === "refused") {
      return refuse;
    }

    save(next);
    charged(entry, account);
    return free;
  };
  // The process table folds the lifecycle streams alone, as the manager's own fold does, so one
  // write reads the same rows however many messages the ledger holds.
  const table = () =>
    ProcessTable.read(
      (stream, after) => accountingEntries(sql, Selection.cases.stream.make({ stream, after })),
      options.brain,
    );
  const owner = (entry: Entry, registry: ProcessTable) => {
    const live = registry.info.find((p) => entry.stream === `${p.name}/inbox` || entry.stream.startsWith(`${p.name}/`));

    if (live !== undefined) {
      return live;
    }

    const life = registry.life(entry.stream.split("/")[0] ?? "");
    return Option.isNone(life)
      ? undefined
      : {
          process: life.value.state.process,
          name: life.value.name,
          program: life.value.state.code.program,
          build: life.value.state.code.hash,
        };
  };
  type Owner = NonNullable<ReturnType<typeof owner>>;
  const aheadFor = (entry: Entry, target: Owner) =>
    encodedBytes(
      Entry.make({
        ...entry,
        id: `step:${entry.id}`,
        stream: target.process,
        pos: 1,
        rev: entry.rev + 1,
        ...lineFor(
          { ...entry, by: options.brain, build: target.build },
          Stepped.make({ input: entry.id, pos: entry.pos, build: target.build }),
        ),
      }),
    );
  // The charge a step record's message took ahead, if the entry is one: who paid it, its bytes and
  // whether a step record already settled it.
  const held = (entry: Entry, target: Owner) => {
    const step = entry._tag === "stepped" ? readStep(entry.body) : Option.none();
    const [row] = Option.isNone(step)
      ? []
      : sql.exec(
          "SELECT account,bytes,settled FROM quota_steps WHERE name=? AND message=?",
          target.name,
          step.value.input,
        );

    if (Option.isNone(step) || row === undefined) {
      return undefined;
    }

    const saved = readHeld(row);
    return {
      message: step.value.input,
      payer: readAccount(saved.account),
      bytes: saved.bytes,
      settled: saved.settled !== 0,
    };
  };

  // Charges `payer` for the entry. A message into an inbox is charged with its one step record,
  // ahead, and the payer is kept beside it for that record to settle. A step record whose
  // message's charge is still held is the runtime's alone to write.
  const asPayer = (entry: Entry, target: Owner | undefined, payer: Quota.Account) => {
    if (target !== undefined && held(entry, target)?.settled === false) {
      return refuse;
    }

    if (target === undefined || entry.stream !== `${target.name}/inbox`) {
      return propose(payer, entry);
    }

    const ahead = { writes: 1, bytes: aheadFor(entry, target) };
    const result = propose(payer, entry, ahead);

    if (Result.isSuccess(result)) {
      sql.exec(
        "INSERT INTO quota_steps (name,message,account,bytes,settled) VALUES (?,?,?,?,0)",
        target.name,
        entry.id,
        key(payer),
        ahead.bytes,
      );
    }

    return result;
  };
  // A write with no trusted writer is charged to the program its stream names, or to nobody on
  // the brain's own streams. A stream nobody owns is refused.
  const byOwner = (entry: Entry) => {
    if (infrastructure(entry.stream)) {
      return free;
    }

    const target = owner(entry, table());
    return target === undefined ? refuse : asPayer(entry, target, programAccount(target.program));
  };
  // A process's program pays for its own writes; a historical process no longer has a program to
  // charge, so it is refused.
  const asProgram = (entry: Entry, process: string) => {
    const registry = table();
    const life = Option.getOrUndefined(registry.life(process));
    return life === undefined
      ? refuse
      : asPayer(entry, owner(entry, registry), programAccount(life.state.code.program));
  };
  // A recovery write is paid from the recovering name's own reserved room.
  const asRecovery = (entry: Entry, process: string) => {
    const registry = table();
    const life = Option.getOrUndefined(registry.life(process));
    return life === undefined ? refuse : asPayer(entry, owner(entry, registry), recoveryAccount(life.name));
  };
  // A process's runtime writes only its own stream. Its step record settles the charge its message
  // took ahead; a step record for a message already settled is a replay, in that message's room;
  // anything else it writes is its name's recovery work.
  const asRuntime = (entry: Entry, process: string) => {
    const target = process === entry.stream ? owner(entry, table()) : undefined;

    if (target === undefined) {
      return refuse;
    }

    const recovery = recoveryAccount(target.name);
    const step = held(entry, target);

    if (step === undefined) {
      return propose(recovery, entry);
    }

    if (step.settled) {
      return propose(recovery, entry, none, { message: step.message, recovery: process });
    }

    save(
      applyCell(machine(step.payer), load(step.payer), {
        type: "settle",
        bytes: encodedBytes(entry),
        ahead: { writes: 1, bytes: step.bytes },
      })[0],
    );
    sql.exec("UPDATE quota_steps SET settled=1 WHERE name=? AND message=?", target.name, step.message);
    charged(entry, step.payer);
    return free;
  };
  const charge = (entry: Entry, cause: Authority) =>
    Authority.match(cause, {
      infrastructure: () => free,
      owner: () => byOwner(entry),
      program: ({ process }) => asProgram(entry, process),
      recovery: ({ process }) => asRecovery(entry, process),
      runtime: ({ process }) => asRuntime(entry, process),
    });
  // Charges what was committed before accounting saw it, and nothing else: only entries past the
  // saved revision are read, so a ledger that is already accounted costs one empty query.
  const restore = () => {
    const through = Number(sql.exec("SELECT rev FROM quota_restored WHERE id=1")[0]?.rev ?? 0);
    const pending = accountingEntries(sql, Selection.cases.all.make({ after: through }));
    const last = pending.at(-1);

    if (last === undefined) {
      return;
    }

    const registry = table();

    for (const entry of pending) {
      if (sql.exec("SELECT rev FROM quota_entries WHERE rev=?", entry.rev).length !== 0) {
        continue;
      }

      // Existing lifecycle, door, instance start and access history precede accounting. Ordinary data must
      // have an owner.
      if (infrastructure(entry.stream)) {
        continue;
      }

      const target = owner(entry, registry);

      if (target === undefined) {
        throw new QuotasError({ reason: new BadRow({ cause: null }) });
      }

      // Restore exact historical use even when it already exceeds a newly lowered wall.
      const account = programAccount(target.program);
      const unlimited = Quota.make({
        account,
        limits: {
          writes: Number.MAX_SAFE_INTEGER,
          bytes: Number.MAX_SAFE_INTEGER,
          message: limits.recovery.project.message,
        },
      });
      const ahead = entry.stream === `${target.name}/inbox` ? { writes: 1, bytes: aheadFor(entry, target) } : none;
      save(
        applyCell(unlimited, load(account), {
          type: "propose",
          at: entry.arrivedAt,
          operation: "restore",
          writes: 1,
          bytes: encodedBytes(entry),
          ahead,
        })[0],
      );
      charged(entry, account);

      if (ahead.writes !== 0) {
        sql.exec(
          "INSERT OR IGNORE INTO quota_steps (name,message,account,bytes,settled) VALUES (?,?,?,?,0)",
          target.name,
          entry.id,
          key(account),
          ahead.bytes,
        );
      }
    }

    sql.exec(
      "INSERT INTO quota_restored (id,rev) VALUES (1,?) ON CONFLICT(id) DO UPDATE SET rev=excluded.rev",
      last.rev,
    );
  };
  const read = Effect.fnUntraced(function* (account: Quota.Account) {
    return yield* Effect.try({
      try: () =>
        sql.transaction(() => {
          restore();
          return use(
            applyCell(machine(account), load(account), { type: "advance", at: clock.currentTimeMillisUnsafe() })[0],
          );
        }),
      catch: failed,
    });
  });
  const within = <A>(next: Authority, step: () => A): A => {
    const before = authority;
    authority = Option.some(next);

    try {
      return step();
    } finally {
      authority = before;
    }
  };
  // The trial runs the admission itself at the place the message will land, past the `before`
  // entries the caller writes first and at the referee's arrival time, then rolls it back: the
  // answer is the one an append there would get, and nothing is saved either way.
  const admits = Effect.fnUntraced(function* (name: string, id: string, line: Line, before: number) {
    const rollback = new Error("quota trial");
    let fits = false;
    const stream = `${name}/inbox`;
    // The referee reads its clock when it places an entry, so the trial reads it now, as it does.
    const now = yield* Clock.currentTimeMillis;
    const tried = Result.try(() =>
      sql.transaction(() => {
        restore();

        if (sql.exec("SELECT 1 FROM quota_steps WHERE name=? AND message=?", name, id).length > 0) {
          fits = true;
        } else {
          const place = nextPlace(sql, stream, now);
          const entry = Entry.make({
            ...line,
            id,
            stream,
            pos: place.pos,
            rev: place.rev + before,
            arrivedAt: place.arrivedAt,
          });
          fits = Result.isSuccess(charge(entry, Authority.cases.owner.make({})));
        }

        throw rollback;
      }),
    );

    if (Result.isFailure(tried) && tried.failure !== rollback) {
      const cause = tried.failure;
      return yield* failed(cause);
    }

    return fits;
  });
  const service = Quotas.of({
    program: (identity) => read(programAccount(identity)),
    recovery: (name) => read(recoveryAccount(name)),
    admits,
    ordinary: (process, step) => within(Authority.cases.program.make({ process }), step),
    recovering: (process, step) => within(Authority.cases.recovery.make({ process }), step),
    infrastructure: (step) => within(Authority.cases.infrastructure.make({}), step),
    runtime: (process, work) => work.pipe(Effect.provideService(TrustedWriter, Writer.cases.runtime.make({ process }))),
    own: (process, work) => work.pipe(Effect.provideService(TrustedWriter, Writer.cases.own.make({ process }))),
  });
  return Layer.mergeAll(
    Layer.succeed(Quotas, service),
    Layer.succeed(WritePolicy, {
      admit: (entry, writer) => {
        restore();
        // A step's own authority wins; else the writer trusted code named around the call.
        const result = charge(
          entry,
          Option.getOrElse(authority, () => fromWriter(writer)),
        );

        if (Result.isSuccess(result)) {
          sql.exec(
            "INSERT INTO quota_restored (id,rev) VALUES (1,?) ON CONFLICT(id) DO UPDATE SET rev=excluded.rev",
            entry.rev,
          );
        }

        return result;
      },
    }),
  );
};

const LocalTables = [
  "CREATE TABLE IF NOT EXISTS quota_local (account TEXT PRIMARY KEY,value TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS quota_fault (name TEXT PRIMARY KEY,value TEXT NOT NULL)",
];

const Pending = Schema.Struct({ operation: Schema.String, writes: Schema.Number, bytes: Schema.Number });
const Fault = Schema.Struct({ ...Pending.fields, fault: RecoveryReserveExhausted });
const faultEncode = Schema.encodeSync(Schema.fromJsonString(Fault));
const faultDecode = Schema.decodeUnknownSync(Schema.fromJsonString(Fault));

class Stopped extends Schema.TaggedError<Stopped>()("Stopped", { pending: Pending, fault: RecoveryReserveExhausted }) {}

/**
 * Creates the accounting port for one name's own store. It keeps the name's local account, its
 * supervisor tally, its recovery account and one fault slot in that store's own tables.
 *
 * @category constructors
 */
export const accounting = (sql: Sql, options: { readonly name: string; readonly limits: Allowance }): Accounting => {
  const local = Quota.Account.cases.local.make({ name: options.name });
  const supervisor = Quota.Account.cases.supervisor.make({ name: options.name });
  const recovery = Quota.Account.cases.recovery.make({ name: options.name, location: "process" });
  const accounts: Record<Charge, Quota.Account> = { program: local, recovery, supervisor };
  const machine = (account: Quota.Account) => Quota.make({ account, limits: options.limits });
  const initialize = () => {
    for (const query of LocalTables) {
      sql.exec(query);
    }

    sql.exec("INSERT OR IGNORE INTO quota_fault (name,value) VALUES (?,?)", options.name, "");
  };
  initialize();
  const load = (account: Quota.Account) => {
    const [row] = sql.exec("SELECT value FROM quota_local WHERE account=?", key(account));
    return row === undefined ? machine(account).init(null, {})[0] : decode(row.value);
  };
  const save = (next: Quota.Model) =>
    sql.exec(
      "INSERT INTO quota_local (account,value) VALUES (?,?) ON CONFLICT(account) DO UPDATE SET value=excluded.value",
      key(next.account),
      encode(next),
    );
  const fault = () => {
    const [row] = sql.exec("SELECT value FROM quota_fault WHERE name=?", options.name);
    return row?.value === "" || row === undefined ? null : faultDecode(row.value);
  };
  // The step runs inside a synchronous SQL transaction, which rolls back on a throw, so the guard
  // reads the throw as a Result and throws it again, never swallowing it.
  const protect = <A>(step: () => A): A => {
    const ran = Result.try(step);

    if (Result.isSuccess(ran)) {
      return ran.success;
    }

    const cause = ran.failure;

    if (!(cause instanceof Stopped)) {
      throw cause;
    }

    // This write is after the data transaction rolled back. A storage failure stays loud.
    sql.exec(
      "UPDATE quota_fault SET value=? WHERE name=?",
      faultEncode({ ...cause.pending, fault: cause.fault }),
      options.name,
    );
    throw new QuotasError({ reason: cause.fault });
  };
  return {
    protect,
    recordFault: (failure) =>
      Effect.try({
        try: () => {
          if (fault() !== null) {
            return;
          }

          sql.exec(
            "UPDATE quota_fault SET value=? WHERE name=?",
            faultEncode({
              operation: "ledger",
              writes: failure.resource === "writes" ? failure.required : 0,
              bytes: failure.resource === "storage" ? failure.required : 0,
              fault: new RecoveryReserveExhausted({ ...failure, cause: null }),
            }),
            options.name,
          );
        },
        catch: failed,
      }),
    check: Effect.try({
      try: () => {
        const stopped = fault();

        if (stopped !== null) {
          throw new QuotasError({ reason: stopped.fault });
        }
      },
      catch: failed,
    }),
    change: (operation, writes, bytes, at, charge) => {
      const account = accounts[charge];

      if (writes === 0 && bytes === 0) {
        return;
      }

      // A saved reserve fault refuses every charge, a supervisor one too: a stopped name writes
      // nothing until a checked restart clears it.
      const stopped = fault();

      if (stopped !== null) {
        throw new QuotasError({ reason: stopped.fault });
      }

      const next = applyCell(machine(account), load(account), {
        type: "propose",
        at,
        operation,
        writes,
        bytes,
        ahead: none,
      })[0];

      if (next._tag === "reserve_fault") {
        throw new Stopped({ pending: { operation, writes, bytes }, fault: next.fault });
      }

      save(next);
    },
    status: Effect.clockWith((clock) =>
      Effect.try({
        try: () => {
          const reserve = applyCell(machine(recovery), load(recovery), {
            type: "advance",
            at: clock.currentTimeMillisUnsafe(),
          })[0];
          return {
            program: load(local).total,
            supervisor: load(supervisor).total,
            recovery: use(reserve),
            fault: fault()?.fault ?? null,
          };
        },
        catch: failed,
      }),
    ),
    resume: Effect.clockWith((clock) =>
      Effect.try({
        try: () =>
          sql.transaction(() => {
            const stopped = fault();

            if (stopped === null) {
              return;
            }

            const m = machine(recovery);
            const ready = applyCell(m, load(recovery), { type: "resume", at: clock.currentTimeMillisUnsafe() })[0];
            const trial = applyCell(m, ready, {
              type: "propose",
              at: clock.currentTimeMillisUnsafe(),
              ...stopped,
              ahead: none,
            })[0];

            if (trial._tag === "reserve_fault") {
              throw new QuotasError({ reason: trial.fault });
            }

            save(ready);
            sql.exec("UPDATE quota_fault SET value='' WHERE name=?", options.name);
          }),
        catch: failed,
      }),
    ),
  };
};
