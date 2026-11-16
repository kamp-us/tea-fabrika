// T953 slice 2, next/: a start checked against the member whose input caused it, laws L10 to L15 and L20 of the
// approved plan (docs/plan/quests/t953-PLAN.md), on a real store (0062). A runner in the module that
// owns a driver calls `ChildrenMemberTest.suite(open)`; `open` acquires one store in a scope (0061).
//
// The contract these laws pin, from the plan's "The start check":
//   ChildrenLedger.ts: `layer({ grants, fabrika })`, now over `Relations` and `Senders` as well. A start
//     asks `Senders.sender(from.parent, child.requester.process)` first. A sender is checked with
//     `StartProgram` on `fabrika` and `StartGrant` is not read; `Denied` and `removed` answer
//     `forbidden`, `ended` answers `stale_sender`. With no sender, the requester's recorded `member`
//     is checked when it has one (L20, the owner's answer (c)), else today's `StartGrant` rule. The
//     write turn rechecks the proof's rows, and a recheck that says no writes nothing.
//   processes/internal/processTable.ts: the `started` line gains `member`, the sender it was checked
//     against, encoded as `Sender` with both its key and its person. A start checked against the
//     requester's recorded member (L20) records that member.
//   Senders.ts: `Senders.sender(parent, process)` answers `Option<Sender>` or fails `SendersError` with
//     reason `removed`, `ended` or `storage`.
// The test plays the gateway: its `Senders` answers from the inputs the test delivered, as the
// gateway's one signing service does (0262). The rows the oracle reads are the store's own.
import { describe, expect, it } from "@effect/vitest";
import {
  Cause,
  Deferred,
  Effect,
  Exit,
  Fiber,
  Formatter,
  Layer,
  Option,
  Schema,
  type Scope,
  Stream,
  Tracer,
} from "effect";
import * as fc from "fast-check";
import { Doorbell, Ledger } from "../ledger/Ledger.ts";
import * as LedgerSql from "../ledger/LedgerSql.ts";
import { LedgerTransaction, type LedgerTurn } from "../ledger/LedgerTransaction.ts";
import * as LedgerTransactionSql from "../ledger/LedgerTransactionSql.ts";
import { Model } from "../permissions/Model.ts";
import * as Relation from "../permissions/Relation.ts";
import { Relations } from "../permissions/Relations.ts";
import * as RelationsMemory from "../permissions/RelationsMemory.ts";
import { Sender, Senders, SendersError } from "../permissions/Senders.ts";
import type { Sql, SqlValue } from "../Sql.ts";
import { Children, ChildrenError, type Child, type StartGrant, type Started } from "./Children.ts";
import * as ChildrenLedger from "./ChildrenLedger.ts";
import { type From, Mailbox } from "./Mailbox.ts";
import { Owner, Recipient, Start } from "./Process.ts";
import { ProcessManager } from "./ProcessManager.ts";

/** One real store. */
export type Store = { readonly sql: Sql };

const SEED = 119120;

const BRAIN = "SHA256:brain";

const HASH = "build-a";

const FABRIKA = Model.ref("fabrika", "demo");

const FOUNDER = "person_01jcfounder0000000000000000";

const OTHER = "person_01jcother000000000000000000";

const PIDS: ReadonlyArray<string> = Array.from(
  { length: 40 },
  (_, n) => `process_0000000000e00900${String(n).padStart(10, "0")}`,
);

const QUEUE = "queue";

const WORKER = "worker";

const MERGER = "merger";

const ROGUE = "rogue";

const PROGRAMS = [QUEUE, WORKER, MERGER, ROGUE] as const;

/** The names the boot registers, each a requester of its own program and with no member behind it. */
const BOOT: ReadonlyArray<readonly [string, string]> = [
  ["queue:1", QUEUE],
  ["worker:9", WORKER],
  ["rogue:1", ROGUE],
];

const subjectFor = (person: string) => `person:${person}`;

/** A person's window, or an agent let in for that person. */
const senderFrom = (holder: "founder" | "other", as: "person" | "agent") => {
  const person = holder === "founder" ? FOUNDER : OTHER;

  return as === "person"
    ? Sender.cases.person.make({ key: `SHA256:window-${holder}`, for: person })
    : Sender.cases.agent.make({ key: `SHA256:agent-${holder}`, for: person });
};

/** The owner row the brain writes at boot. */
const OWNER: Relation.Change = {
  id: "owner",
  row: Relation.Row.cases.related.make({ subject: subjectFor(FOUNDER), relation: "owner", object: FABRIKA }),
};

const otherRow = (role: "member" | "admin"): Relation.Change => ({
  id: `other-${role}`,
  row: Relation.Row.cases.related.make({ subject: subjectFor(OTHER), relation: role, object: FABRIKA }),
});

const WRITER = {
  by: BRAIN,
  for: FOUNDER,
  sentAt: "2026-11-14T10:00:00.000Z",
  seen: 0,
  parent: null,
  traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
  build: "t953-test",
};

const from = (parent: string | null): From => ({
  by: "SHA256:program-writer",
  for: FOUNDER,
  sentAt: "2026-11-14T10:00:01.000Z",
  seen: 0,
  parent,
  traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
  build: "writer-build",
});

const quiet = Layer.succeed(Doorbell, { ring: () => Effect.void });

/** An input the test delivered, as the gateway keeps it. */
type Input = { readonly process: string; readonly sender: Sender; state: "live" | "removed" | "ended" };

/** The gateway's answer, from the inputs the test delivered: none unless the input was delivered to that process. */
const gateway = (inputs: ReadonlyMap<string, Input>) =>
  Layer.succeed(Senders, {
    sender: (parent: string | null, process: string) =>
      Effect.suspend(() => {
        const input = parent === null ? undefined : inputs.get(parent);

        if (input === undefined || input.process !== process) {
          return Effect.succeedNone;
        }

        return input.state === "live"
          ? Effect.succeedSome(input.sender)
          : Effect.fail(new SendersError({ reason: input.state }));
      }),
  });

/** A transaction gate: runs before every turn, with the turn's index since it was last armed. */
type Gate = (turn: number) => Effect.Effect<void>;

/** The real ledger, process manager and start piece on one Sql, with memory relations and the test's gateway. */
const stack = (
  sql: Sql,
  next: Effect.Effect<string>,
  grants: ReadonlyArray<typeof StartGrant.Type>,
  changes: ReadonlyArray<Relation.Change>,
  inputs: ReadonlyMap<string, Input>,
  gate: { current: Gate | undefined; turns: number },
) => {
  const tx = LedgerTransactionSql.layer(sql).pipe(Layer.provide(quiet));

  const gated = Layer.effect(
    LedgerTransaction,
    Effect.gen(function* () {
      const real = yield* LedgerTransaction;

      return LedgerTransaction.of({
        transact: <A>(step: (turn: LedgerTurn) => A) =>
          Effect.suspend(() => (gate.current === undefined ? Effect.void : gate.current(gate.turns++))).pipe(
            Effect.andThen(real.transact(step)),
          ),
      });
    }),
  ).pipe(Layer.provide(tx));

  const data = Layer.merge(LedgerSql.layer(sql, { reader: "connection:test" }).pipe(Layer.provide(quiet)), gated);

  return ChildrenLedger.layer({ grants, fabrika: FABRIKA }).pipe(
    Layer.provideMerge(
      ProcessManager.layer(
        {
          owner: Owner.cases.brain.make({}),
          recipient: Recipient.cases.client.make({ client: "window-a", session: PIDS[39] as string }),
          by: BRAIN,
        },
        next,
      ).pipe(Layer.provideMerge(Mailbox.layer.pipe(Layer.provideMerge(data)))),
    ),
    Layer.provideMerge(RelationsMemory.layer(changes)),
    Layer.provideMerge(gateway(inputs)),
  );
};

/** Every row of every table, so "nothing was written" covers whatever table a start might use. */
const snapshot = (sql: Sql): Record<string, ReadonlyArray<Record<string, SqlValue>>> => {
  const tables = sql
    .exec("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .map((row) => String(row.name));

  return Object.fromEntries(tables.map((table) => [table, sql.exec(`SELECT * FROM "${table}"`)]));
};

const ids = (values: ReadonlyArray<string>) => {
  let calls = 0;

  return Effect.sync(() => {
    const value = values[calls++];

    if (value === undefined) {
      throw new Error("test exhausted its process IDs");
    }

    return value;
  });
};

/**
 * One store with the boot's processes placed, the stack built once so the memory relations keep what
 * a law writes, and every span the starts open kept.
 */
const world = Effect.fnUntraced(function* (
  open: Effect.Effect<Store, never, Scope.Scope>,
  grants: ReadonlyArray<typeof StartGrant.Type>,
  changes: ReadonlyArray<Relation.Change>,
) {
  const { sql } = yield* open;
  const inputs = new Map<string, Input>();
  const gate: { current: Gate | undefined; turns: number } = { current: undefined, turns: 0 };
  const context = yield* Layer.build(stack(sql, ids(PIDS), grants, changes, inputs, gate));
  const spans: Array<Tracer.NativeSpan> = [];

  const tracer = Tracer.make({
    span(options) {
      const span = new Tracer.NativeSpan(options);
      spans.push(span);

      return span;
    },
  });

  const run = <A, E>(effect: Effect.Effect<A, E, Children | ProcessManager | Relations | Ledger>) =>
    effect.pipe(Effect.provideContext(context), Effect.withTracer(tracer));

  const boot = new Map<string, { readonly process: string; readonly program: string }>();

  for (const [name, program] of BOOT) {
    const placed = yield* run(
      ProcessManager.use((p) =>
        p.start(Start.cases.first.make({ id: `boot:${name}`, name, code: { program, hash: HASH } }), from(null)),
      ),
    ).pipe(Effect.orDie);

    boot.set(name, { process: placed.process, program });
  }

  let n = 0;
  const start = (child: Child, said: From) => run(Children.use((c) => c.start(child, said))).pipe(Effect.exit);

  /** The `started` line the brain wrote for `name` at `id`, read from the store's own rows. */
  const startedLine = (name: string, id: string) =>
    run(Ledger.use((ledger) => Stream.runCollect(ledger.read(`processes/${name}`, 0)))).pipe(
      Effect.orDie,
      Effect.map((rows) => [...rows].find((row) => row._tag === "started" && row.id === id)),
    );

  /** Delivers an input to `process` as the gateway would, and answers its id. */
  const deliver = (process: string, sender: Sender) => {
    const id = `in-${process}-${++n}`;
    inputs.set(id, { process, sender, state: "live" });

    return id;
  };

  const write = (changes: ReadonlyArray<Relation.Change>) =>
    run(Relations.use((r) => r.write(changes, WRITER))).pipe(Effect.orDie);

  const fresh = (program: string, requester: string, input: boolean): Child => {
    const k = ++n;

    return {
      id: `t953/${k}`,
      name: `${program}:t${k}`,
      code: { program, hash: HASH },
      requester: Recipient.cases.process.make({ process: requester }),
      ...(input ? { input: { k } } : {}),
    };
  };

  return { sql, boot, inputs, start, startedLine, deliver, write, fresh, spans, gate };
});

type World = Effect.Success<ReturnType<typeof world>>;

type Answer = Exit.Exit<Started, ChildrenError>;

const granted = (grants: ReadonlyArray<typeof StartGrant.Type>, source: string, to: string) =>
  grants.some((g) => g.source === source && g.to === to);

/** A refusal keeps its shape (L13): `ChildrenError`, the reason, no cause, and a span that says the reason. */
const refused = (w: World, answer: Answer, before: ReturnType<typeof snapshot>, label: string) => {
  const error = Exit.isFailure(answer) ? Option.getOrUndefined(Cause.findErrorOption(answer.cause)) : undefined;
  expect(error, `${label}: refused`).toBeInstanceOf(ChildrenError);
  expect(error, label).toMatchObject({ reason: "forbidden" });
  expect(
    error instanceof ChildrenError ? error.cause : "not a ChildrenError",
    `L13: ${label}: no cause`,
  ).toBeUndefined();
  expect(snapshot(w.sql), `L13: ${label}: a refusal writes nothing`).toEqual(before);
  const span = w.spans.findLast((s) => s.name === "children.start");
  expect(span?.attributes.get("fab.children.reason"), `L13: ${label}: the span says the reason`).toBe("forbidden");
};

const startedFresh = (answer: Answer, label: string) => {
  expect(Exit.isSuccess(answer), `${label}; got ${Exit.isFailure(answer) ? Cause.pretty(answer.cause) : ""}`).toBe(
    true,
  );
  expect(Exit.isSuccess(answer) ? answer.value._tag : undefined, label).toBe("started");
};

const encodeSender = Schema.encodeSync(Sender);

const Grants = fc.uniqueArray(fc.record({ source: fc.constantFrom(...PROGRAMS), to: fc.constantFrom(...PROGRAMS) }), {
  maxLength: 4,
  selector: (g) => `${g.source}>${g.to}`,
});

/** The relations a case starts with: the owner row or not, and the other person's role. */
const Roles = fc.record({ owner: fc.boolean(), other: fc.constantFrom("none", "member", "admin") });

type Roles = typeof Roles extends fc.Arbitrary<infer A> ? A : never;

const startingRows = (roles: Roles): ReadonlyArray<Relation.Change> => [
  ...(roles.owner ? [OWNER] : []),
  ...(roles.other === "none" ? [] : [otherRow(roles.other)]),
];

/** The oracle's rule, 0170's first: any member, owner and admins included, may start any program. */
const holds = (roles: Roles, holder: "founder" | "other") =>
  holder === "founder" ? roles.owner : roles.other !== "none";

/**
 * Who the requester is: a boot process with no member, or a process a member's input started, so it
 * has a recorded member. That member differs from the sender: another person, or the sender's person
 * by the other key kind.
 */
const RECORDED = ["none", "another person", "another key"] as const;

const SenderCase = fc.record({
  grants: Grants,
  roles: Roles,
  holder: fc.constantFrom("founder", "other"),
  as: fc.constantFrom("person", "agent"),
  requester: fc.nat(),
  recorded: fc.constantFrom(...RECORDED),
  recordedAs: fc.constantFrom("person", "agent"),
  middle: fc.constantFrom(...PROGRAMS),
  program: fc.constantFrom(...PROGRAMS),
  input: fc.boolean(),
});

type SenderCase = typeof SenderCase extends fc.Arbitrary<infer A> ? A : never;

const pick = <A>(items: ReadonlyArray<A>, n: number): A => {
  const item = items[n % items.length];

  if (item === undefined) {
    throw new Error("a case chose from an empty list");
  }

  return item;
};

/** The member a case's requester was started by, never the sender itself (0170: the sender wins). */
const recordedFor = (c: SenderCase): Sender | undefined => {
  switch (c.recorded) {
    case "none":
      return undefined;
    case "another person":
      return senderFrom(c.holder === "founder" ? "other" : "founder", c.recordedAs);
    case "another key":
      return senderFrom(c.holder, c.as === "person" ? "agent" : "person");
  }
};

/** The row that lets a person start, written only while the requester is started and removed after. */
const lift = (holder: "founder" | "other"): Relation.Change => (holder === "founder" ? OWNER : otherRow("member"));

/**
 * The requester of a sender's case: a boot process, or a process a member's input started. That member
 * is let in for the requester's own start, and the case's roles are put back before the law's start.
 */
const requesterFor = (w: World, c: SenderCase) =>
  Effect.gen(function* () {
    const boot = pick([...w.boot.values()], c.requester);
    const member = recordedFor(c);

    if (member === undefined) {
      return { ...boot, recorded: undefined };
    }

    const holder = member.for === FOUNDER ? "founder" : "other";
    const lifted = !holds(c.roles, holder);

    if (lifted) {
      yield* w.write([lift(holder)]);
    }

    const middle = w.fresh(c.middle, boot.process, false);
    const placed = yield* w.start(middle, from(w.deliver(boot.process, member)));
    startedFresh(placed, "L10: a member's input starts the requester");
    const recorded = encodeSender(member);
    const line = yield* w.startedLine(middle.name, middle.id);
    expect(line?.body, "L10: the requester's started line records its member").toMatchObject({ member: recorded });

    if (lifted) {
      const { subject, relation, object } = lift(holder).row;
      yield* w.write([{ id: `drop-${holder}`, row: Relation.Row.cases.unrelated.make({ subject, relation, object }) }]);
    }

    return {
      process: Exit.isSuccess(placed) ? placed.value.process : expect.fail("started"),
      program: c.middle,
      recorded,
    };
  });

/**
 * L10, L13 and L14 on one case: a start caused by a member's input to the requester. When the
 * requester has a recorded member too, the sender is the one checked and the one recorded (0170).
 */
const senderLaw = (open: Effect.Effect<Store, never, Scope.Scope>) =>
  Effect.fnUntraced(function* (c: SenderCase) {
    const w = yield* world(open, c.grants, startingRows(c.roles));
    const requester = yield* requesterFor(w, c);
    const sender = senderFrom(c.holder, c.as);
    const parent = w.deliver(requester.process, sender);
    const child = w.fresh(c.program, requester.process, c.input);
    const before = snapshot(w.sql);
    const answer = yield* w.start(child, from(parent));
    const label = `${c.as} for ${c.holder}, requester's member ${c.recorded}, roles ${Formatter.format(c.roles)}, ${requester.program} -> ${c.program}`;

    if (holds(c.roles, c.holder)) {
      startedFresh(answer, `L10: ${label} starts, whatever StartGrant says`);
      const line = yield* w.startedLine(child.name, child.id);
      expect(line?.body, `L14: ${label}: the started line names the sender as member`).toMatchObject({
        member: encodeSender(sender),
      });
    } else {
      refused(w, answer, before, `L10: ${label}`);
    }
  });

const NoSenderCase = fc.record({
  grants: Grants,
  roles: Roles,
  cause: fc.constantFrom("null", "elsewhere"),
  requester: fc.nat(),
  program: fc.constantFrom(...PROGRAMS),
});

type NoSenderCase = typeof NoSenderCase extends fc.Arbitrary<infer A> ? A : never;

/**
 * L11 and L14 on one case: a start with no member's input delivered to its requester, and no recorded
 * member, since every requester here is a boot process.
 */
const noSenderLaw = (open: Effect.Effect<Store, never, Scope.Scope>) =>
  Effect.fnUntraced(function* (c: NoSenderCase) {
    const w = yield* world(open, c.grants, startingRows(c.roles));
    const boots = [...w.boot.values()];
    const requester = pick(boots, c.requester);

    // An input delivered to another process, by a sender who holds `start`: it is not this start's cause.
    const elsewhere = pick(
      boots.filter((b) => b.process !== requester.process),
      c.requester,
    );

    const parent = c.cause === "null" ? null : w.deliver(elsewhere.process, senderFrom("founder", "person"));
    const child = w.fresh(c.program, requester.process, false);
    const before = snapshot(w.sql);
    const answer = yield* w.start(child, from(parent));
    const label = `L11: ${c.cause} cause, ${requester.program} -> ${c.program}, grants ${Formatter.format(c.grants)}`;

    if (granted(c.grants, requester.program, c.program)) {
      startedFresh(answer, label);
      const line = yield* w.startedLine(child.name, child.id);
      expect(
        line?.body ?? {},
        `L14: ${label}: a start with no sender and no recorded member has no member`,
      ).not.toHaveProperty("member");
    } else {
      refused(w, answer, before, label);
    }
  });

const RemovedCase = fc.record({
  grants: Grants,
  as: fc.constantFrom("person", "agent"),
  saved: fc.boolean(),
  requester: fc.nat(),
  program: fc.constantFrom(...PROGRAMS),
});

type RemovedCase = typeof RemovedCase extends fc.Arbitrary<infer A> ? A : never;

/** L12 and L13 on one case: the sender's key is removed, with a grant that would let the program through. */
const removedLaw = (open: Effect.Effect<Store, never, Scope.Scope>) =>
  Effect.fnUntraced(function* (c: RemovedCase) {
    const requesterName = pick(BOOT, c.requester);
    // The host grant would let this start through: only the sender's removal refuses it.
    const grants = [...c.grants, { source: requesterName[1], to: c.program }];
    const w = yield* world(open, grants, [OWNER]);
    const requester = w.boot.get(requesterName[0]) ?? expect.fail("a booted requester");
    const parent = w.deliver(requester.process, senderFrom("founder", c.as));
    const child = w.fresh(c.program, requester.process, false);
    const first = c.saved ? yield* w.start(child, from(parent)) : undefined;

    if (first !== undefined) {
      startedFresh(first, "L12: the start is saved before the key is removed");
    }

    const input = w.inputs.get(parent) ?? expect.fail("the delivered input");
    input.state = "removed";
    const before = snapshot(w.sql);
    const again = yield* w.start(child, from(parent));

    if (first !== undefined && Exit.isSuccess(first)) {
      expect(again, "L12: a retry of a saved start id answers its started after the removal").toEqual(first);
    } else {
      refused(w, again, before, `L12: a removed ${c.as} key with a grant ${requesterName[1]} -> ${c.program}`);
    }
  });

const OwnerCase = fc.record({
  grants: Grants,
  member: fc.constantFrom("none", "founder", "other"),
  removed: fc.boolean(),
  cause: fc.constantFrom("null", "elsewhere"),
  middle: fc.constantFrom(...PROGRAMS),
  program: fc.constantFrom(...PROGRAMS),
  requester: fc.nat(),
});

type OwnerCase = typeof OwnerCase extends fc.Arbitrary<infer A> ? A : never;

/**
 * L20 on one case: a start with no member's input is checked against the requester's recorded member
 * when it has one, and by `StartGrant` when it has none.
 */
const ownerLaw = (open: Effect.Effect<Store, never, Scope.Scope>) =>
  Effect.fnUntraced(function* (c: OwnerCase) {
    const w = yield* world(open, c.grants, [OWNER, otherRow("member")]);
    const boots = [...w.boot.values()];
    const boot = pick(boots, c.requester);

    // The requester: a boot process with no member, or a process a member's input started. `recorded`
    // is the member the requester's own `started` line names, read from the store's rows.
    const requester =
      c.member === "none"
        ? { ...boot, recorded: undefined }
        : yield* Effect.gen(function* () {
            const sender = senderFrom(c.member === "founder" ? "founder" : "other", "person");
            const parent = w.deliver(boot.process, sender);
            const middle = w.fresh(c.middle, boot.process, false);
            const placed = yield* w.start(middle, from(parent));
            startedFresh(placed, "L20: a member's input starts the requester");
            const recorded = encodeSender(sender);
            const line = yield* w.startedLine(middle.name, middle.id);
            expect(line?.body, "L20: the requester's started line records its member").toMatchObject({
              member: recorded,
            });

            return {
              process: Exit.isSuccess(placed) ? placed.value.process : expect.fail("started"),
              program: c.middle,
              recorded,
            };
          });

    if (c.member !== "none" && c.removed) {
      const [subject, relation] = c.member === "founder" ? [FOUNDER, "owner"] : [OTHER, "member"];
      yield* w.write([
        {
          id: `remove-${relation}`,
          row: Relation.Row.cases.unrelated.make({ subject: subjectFor(subject), relation, object: FABRIKA }),
        },
      ]);
    }

    const elsewhere = pick(
      boots.filter((b) => b.process !== requester.process),
      c.requester,
    );

    const parent = c.cause === "null" ? null : w.deliver(elsewhere.process, senderFrom("founder", "person"));
    const child = w.fresh(c.program, requester.process, false);
    const before = snapshot(w.sql);
    const answer = yield* w.start(child, from(parent));
    const label = `L20: member ${c.member}${c.removed ? " (removed)" : ""}, ${requester.program} -> ${c.program}, grants ${Formatter.format(c.grants)}`;
    const allowed = c.member === "none" ? granted(c.grants, requester.program, c.program) : !c.removed;

    if (allowed) {
      startedFresh(answer, label);
      const line = yield* w.startedLine(child.name, child.id);

      if (requester.recorded === undefined) {
        expect(
          line?.body ?? {},
          `${label}: with no recorded member, the started line has no member`,
        ).not.toHaveProperty("member");
      } else {
        expect(line?.body, `${label}: the started line records the member it was checked against`).toMatchObject({
          member: requester.recorded,
        });
      }
    } else {
      refused(w, answer, before, label);
    }
  });

/** Runs one case per property run, each on a fresh store. */
const prop = <A>(
  name: string,
  arbitrary: fc.Arbitrary<A>,
  law: (c: A) => Effect.Effect<void, unknown, Scope.Scope>,
  numRuns: number,
  examples: ReadonlyArray<[A]> = [],
) =>
  it.effect(
    name,
    () =>
      Effect.gen(function* () {
        // oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: fast-check awaits each case
        const property = fc.asyncProperty(arbitrary, (c) => Effect.runPromise(Effect.scoped(law(c))));
        const checks = { seed: SEED, numRuns, endOnFailure: true, examples: [...examples] };
        // oxlint-disable-next-line fabrika/no-promises -- edge: fast-check's async property answers a Promise
        yield* Effect.promise(() => fc.assert(property, checks));
      }),
    600_000,
  );

/** L15: a relation removed while the start is held between its look turn and its write turn. */
const raced = (open: Effect.Effect<Store, never, Scope.Scope>) =>
  Effect.gen(function* () {
    const w = yield* world(open, [], [OWNER]);
    const requester = w.boot.get("queue:1") ?? expect.fail("the boot's queue");
    const parent = w.deliver(requester.process, senderFrom("founder", "person"));
    const child = w.fresh(WORKER, requester.process, true);
    const reached = yield* Deferred.make<void>();
    const release = yield* Deferred.make<void>();
    const before = snapshot(w.sql);
    // The look turn is the start's first; hold the next one, so the write turn comes after the removal.
    w.gate.turns = 0;
    w.gate.current = (turn) =>
      turn === 1 ? Deferred.succeed(reached, undefined).pipe(Effect.andThen(Deferred.await(release))) : Effect.void;
    const fiber = yield* Effect.forkChild(w.start(child, from(parent)));
    yield* Deferred.await(reached).pipe(Effect.timeout("10 seconds"), Effect.orDie);
    w.gate.current = undefined;
    yield* w.write([
      {
        id: "remove-owner",
        row: Relation.Row.cases.unrelated.make({ subject: subjectFor(FOUNDER), relation: "owner", object: FABRIKA }),
      },
    ]);
    yield* Deferred.succeed(release, undefined);
    const answer = yield* Fiber.join(fiber);
    refused(w, answer, before, "L15: the owner row removed between the look and the write");
  });

/** Runs the laws on the store `open` gives. */
export const suite = (open: Effect.Effect<Store, never, Scope.Scope>) =>
  describe("T953 a start is checked against the member whose input caused it", () => {
    // Plant: also require `granted(program, program)` for a sender's start (ChildrenLedger.ts). Plant:
    // the requester's recorded member wins over the sender (`requester.member ?? sender`, ChildrenLedger.ts).
    prop(
      "L10 and L13: a member's start is started exactly when the member holds start, whatever StartGrant says",
      SenderCase,
      senderLaw(open),
      100,
      [
        // pinned: main answers `forbidden` here, with no grant at all: the plan's traced value.
        [
          {
            grants: [],
            roles: { owner: true, other: "none" },
            holder: "founder",
            as: "person",
            requester: 0,
            recorded: "none",
            recordedAs: "person",
            middle: QUEUE,
            program: WORKER,
            input: true,
          },
        ],
      ],
    );
    // Plant: treat no sender as allowed (ChildrenLedger.ts).
    prop(
      "L11 and L13: a start with no member's input answers what main answers, by StartGrant",
      NoSenderCase,
      noSenderLaw(open),
      100,
    );
    // Plant: judge the sender before the saved-id check (ChildrenLedger.ts).
    prop(
      "L12 and L13: a removed sender is refused even with a grant, and a saved start id still answers",
      RemovedCase,
      removedLaw(open),
      50,
    );
    // Plant: write the requester's process as `member` (ChildrenLedger.ts or ProcessManager.ts).
    prop(
      "L14: a sender's start names that sender as member, and a start with no sender and no recorded member has none",
      fc.tuple(SenderCase, NoSenderCase),
      ([withSender, without]) => Effect.andThen(senderLaw(open)(withSender), noSenderLaw(open)(without)),
      100,
    );
    // Plant: the no-sender rule ignores the recorded owner (ChildrenLedger.ts). Plant: the start
    // checked against the recorded member writes no `member` on its `started` line.
    prop(
      "L20: with no member's input, a recorded member is checked as that member and written on the started line, else StartGrant decides",
      OwnerCase,
      ownerLaw(open),
      100,
      [
        // pinned: the plant's case, a removed member with a grant that would let the program through.
        [
          {
            grants: [{ source: WORKER, to: MERGER }],
            member: "founder",
            removed: true,
            cause: "null",
            middle: WORKER,
            program: MERGER,
            requester: 0,
          },
        ],
      ],
    );

    // scenario: L15. The race is one path, not a space to walk: the gate holds the start after its
    // look turn, the memory store removes the owner, and the gate opens. Plant: drop the guard from `place`.
    it.effect("scenario: L15: a relation removed between the look turn and the write turn refuses the start", () =>
      Effect.scoped(raced(open)),
    );
  });
