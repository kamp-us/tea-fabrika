// P34c, next/. Node and live-object fixtures supply real runners and real stores to these laws.
// The fixture may supply transport and an archive double. It must not implement quota decisions.
import { describe, expect, it } from "@effect/vitest";
import { Clock, Effect, Option, Schema } from "effect";
import type { Scope } from "effect";
import { TestClock } from "effect/testing";
import { Appended } from "../coordination/index.ts";
import { Supervision } from "./internal/supervisor.ts";
import { Checkpoint } from "./ProcessStore.ts";
import type { ProgramRunner } from "./Runner.ts";

export interface Limits {
  readonly writes: number;
  readonly storage: number;
  readonly recovery: {
    readonly project: {
      readonly writes: number;
      readonly bytes: number;
      readonly message: { readonly writes: number; readonly bytes: number };
    };
    readonly process: {
      readonly writes: number;
      readonly bytes: number;
      readonly message: { readonly writes: number; readonly bytes: number };
    };
  };
}

export const defaults: Limits = {
  writes: 13_760,
  storage: 1_000_000_000,
  recovery: {
    project: { writes: 160, bytes: 74_080, message: { writes: 10, bytes: 5_469 } },
    process: { writes: 290, bytes: 207_410, message: { writes: 50, bytes: 18_790 } },
  },
};

export interface Use {
  readonly writes: number;
  readonly bytes: number;
  readonly ahead: { readonly writes: number; readonly bytes: number };
}

export interface Local {
  readonly program: { readonly writes: number; readonly bytes: number };
  /** The supervisor's bookkeeping saves for this name: counted, never limited (0593). */
  readonly supervisor: { readonly writes: number; readonly bytes: number };
  readonly recovery: {
    readonly writes: number;
    readonly bytes: number;
    readonly total: { readonly writes: number; readonly bytes: number };
  };
  readonly fault: unknown;
}

export interface World {
  readonly runner: (name: string) => Effect.Effect<ProgramRunner["Service"], unknown>;
  readonly input: (name: string, id: string, m: unknown) => Effect.Effect<unknown, unknown>;
  readonly msg: (name: string, id: string, m: unknown) => Effect.Effect<unknown, unknown>;
  readonly watch: (source: string, target: string, ref: string) => Effect.Effect<void, unknown>;
  readonly alarm: (name: string) => Effect.Effect<number | null>;
  readonly program: (name: string) => Effect.Effect<Use, unknown>;
  readonly local: (name: string) => Effect.Effect<Local, unknown>;
  readonly projectRecovery: (name: string) => Effect.Effect<Local["recovery"], unknown>;
  readonly replace: (name: string, saved: Checkpoint) => Effect.Effect<void, unknown>;
  readonly checkpoint: (name: string) => Effect.Effect<unknown, unknown>;
  readonly journal: (name: string) => Effect.Effect<unknown, unknown>;
  /** Saves `value` as the name's journal through the real store and the name's real account. */
  readonly save: (name: string, value: unknown) => Effect.Effect<void, unknown>;
  readonly entries: Effect.Effect<ReadonlyArray<Readonly<Record<string, unknown>>>, unknown>;
  readonly snapshot: Effect.Effect<unknown, unknown>;
  readonly reopen: Effect.Effect<void>;
  readonly cut: (boundary: number | null) => void;
  readonly limits: (next: Limits) => void;
  readonly restart: (name: string, id: string, person: boolean) => Effect.Effect<unknown, unknown>;
  readonly drain: (name: string) => Effect.Effect<void, unknown>;
}

export const supervision = Supervision;

const required = <A>(value: A | undefined): A => Option.getOrThrow(Option.fromUndefinedOr(value));

const Nat = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 10_000 }));
const Cell = Schema.Struct({ pick: Nat, amount: Nat, reopen: Schema.Boolean });
const Tape = Schema.Array(Cell).check(Schema.isMinLength(5), Schema.isMaxLength(25));

const History = Schema.Array(
  Schema.Struct({
    ...Cell.fields,
    length: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 1001 })),
  }),
).check(Schema.isMinLength(1), Schema.isMaxLength(3));

const options = { timeout: 600_000, arbitrary: { seed: 119120, runs: 40, size: 100 } };
const names = ["alpha:1", "alpha:2", "beta:1"];

const call = Effect.fnUntraced(function* (
  w: World,
  name: string,
  use: (runner: ProgramRunner["Service"]) => Effect.Effect<unknown, unknown>,
) {
  return yield* use(yield* w.runner(name));
});

// 0593: the supervisor's bookkeeping saves are charged to the supervisor, never to the program.
const Journal = Supervision.fields.journal;
type Saved = typeof Supervision.Type;
const decodeSaved = Schema.decodeUnknownSync(Supervision);

/** One part's journal rows, as the store keeps them; a World's snapshot holds every part's tables. */
const Stored = Schema.Struct({
  process_recovery: Schema.optionalKey(Schema.Array(Schema.Struct({ name: Schema.String, value: Schema.String }))),
  process_receipts: Schema.optionalKey(
    Schema.Array(Schema.Struct({ name: Schema.String, letter: Schema.String, value: Schema.String })),
  ),
  process_recovery_generation: Schema.optionalKey(Schema.Array(Schema.Struct({ name: Schema.String }))),
});

const decodeStored = Schema.decodeUnknownSync(Schema.Record(Schema.String, Stored));

interface Rows {
  readonly journal: string | null;
  readonly receipts: ReadonlyMap<string, string>;
  readonly generation: boolean;
}

/** The name's journal row text, each receipt row's text, and whether its generation row exists. */
const storedRows = (snapshot: unknown, name: string): Rows => {
  const part = decodeStored(snapshot)[name];
  return {
    journal: part?.process_recovery?.find((r) => r.name === name)?.value ?? null,
    receipts: new Map(
      (part?.process_receipts ?? []).filter((r) => r.name === name).map((r) => [r.letter, r.value] as const),
    ),
    generation: (part?.process_recovery_generation ?? []).some((r) => r.name === name),
  };
};

const textBytes = (text: string | null) => (text === null ? 0 : new TextEncoder().encode(text).length);

/**
 * What one save cost, read from the rows before and after it, by the store's own rule
 * (RecoveryStore.ts, save): one write per changed receipt row and one when the journal row changed;
 * the bytes are the journal row's change, each new receipt row's text with its key (name and
 * letter), each changed receipt row's change, and on the first save the generation row's key and
 * its integer of up to 8 bytes, which adds no write.
 */
const charged = (name: string, before: Rows, after: Rows) => {
  let writes = before.journal === after.journal ? 0 : 1;
  let bytes = textBytes(after.journal) - textBytes(before.journal);

  for (const [letter, text] of after.receipts) {
    const prior = before.receipts.get(letter);

    if (prior === text) {
      continue;
    }

    writes += 1;
    bytes +=
      prior === undefined ? textBytes(text) + textBytes(name) + textBytes(letter) : textBytes(text) - textBytes(prior);
  }

  bytes += !before.generation && after.generation ? textBytes(name) + 8 : 0;
  return { writes, bytes };
};

/** The supervisor-only fields L3 edits, each a field the supervisor's own Msgs write. */
const Field = Schema.Literals(["healthyAt", "crashes", "build", "maxDeliveries", "restarts"]);
type Field = typeof Field.Type;
/** The program's own saves L3 makes: a step begun or ended, a receipt admitted, a receipt compacted. */
const Change = Schema.Literals(["begin", "receipt", "compact"]);
type Change = typeof Change.Type;

const Edit = Schema.TaggedUnion({
  bookkeeping: { field: Field, amount: Nat },
  program: { change: Change, amount: Nat },
  both: { field: Field, change: Change, amount: Nat },
});
type Edit = typeof Edit.Type;
const Edits = Schema.Array(Edit).check(Schema.isMinLength(1), Schema.isMaxLength(25));

const bookkeep: Record<Field, (s: Saved, amount: number, n: number) => Saved> = {
  healthyAt: (s, amount) => ({ ...s, healthyAt: s.healthyAt + 1 + amount }),
  crashes: (s) => ({ ...s, crashes: s.crashes + 1 }),
  build: (s, _amount, n) => ({ ...s, build: `build:${n}` }),
  maxDeliveries: (s, amount) => ({ ...s, maxDeliveries: 1 + (((s.maxDeliveries ?? 0) + 1 + amount) % 32) }),
  restarts: (s, amount) => ({ ...s, restarts: [...s.restarts, amount] }),
};

/**
 * The program's edit, walked from the journal it is made on: a compaction needs a receipt that
 * still keeps its input, so with none the walk admits a receipt instead.
 */
const work = (s: Saved, change: Change, amount: number, n: number, process: Saved["receipts"][number]["process"]) => {
  const compactable = s.receipts.find((r) => r.input !== null);

  if (change === "begin") {
    const next = Journal.guards.idle(s.journal)
      ? {
          ...s,
          seq: s.seq + 1,
          journal: Journal.cases.checking.make({
            attempt: { process, letter: `letter:${n}`, build: s.build, seq: s.seq + 1, phase: "fresh", at: amount },
          }),
        }
      : { ...s, journal: Journal.cases.idle.make({ process }) };
    return { next, change };
  }

  if (change === "compact" && compactable !== undefined) {
    const digest = `digest:${n}`;
    const receipts = s.receipts.map((r) =>
      r.letter === compactable.letter ? { ...r, input: null, digest, tries: 0, result: null } : r,
    );
    return { next: { ...s, receipts }, change };
  }

  const receipt = { letter: `letter:${n}`, input: { n: amount }, errors: [], tries: 0, result: null, process };
  return { next: { ...s, receipts: [...s.receipts, receipt] }, change: "receipt" as const };
};

/** Who 0593 says pays for one edit, and which of L3's required cases it reached. */
const edited = (s: Saved, edit: Edit, n: number, process: Saved["receipts"][number]["process"]) =>
  Edit.match(edit, {
    bookkeeping: (e) => ({
      next: bookkeep[e.field](s, e.amount, n),
      owner: "supervisor" as const,
      reached: "bookkeeping",
    }),
    program: (e) => {
      const done = work(s, e.change, e.amount, n, process);
      return { next: done.next, owner: "program" as const, reached: done.change };
    },
    both: (e) => ({
      next: work(bookkeep[e.field](s, e.amount, n), e.change, e.amount, n, process).next,
      owner: "program" as const,
      reached: "both",
    }),
  });

/** L3's required cases, each made once at the end of a tape that never reached it. */
const coverage: ReadonlyArray<Edit> = [
  Edit.cases.bookkeeping.make({ field: "healthyAt", amount: 0 }),
  Edit.cases.program.make({ change: "begin", amount: 0 }),
  Edit.cases.program.make({ change: "receipt", amount: 0 }),
  Edit.cases.program.make({ change: "compact", amount: 0 }),
  Edit.cases.both.make({ field: "crashes", change: "receipt", amount: 0 }),
];

const reachedBy = (edit: Edit) =>
  Edit.match(edit, { bookkeeping: () => "bookkeeping", program: (e) => e.change, both: () => "both" });

/**
 * Saves `value` through the World and checks who paid: a supervisor save leaves the program's
 * account as it was and charges the supervisor tally the save's exact cost; a program save the
 * reverse. Recovery is never charged for either.
 */
const settled = Effect.fnUntraced(function* (
  w: World,
  name: string,
  value: Saved,
  owner: "program" | "supervisor",
  label: string,
) {
  const before = yield* w.local(name);
  const rows = storedRows(yield* w.snapshot, name);
  yield* w.save(name, value);
  const after = yield* w.local(name);
  const cost = charged(name, rows, storedRows(yield* w.snapshot, name));

  if (owner === "supervisor") {
    // Plant (RecoveryStore.ts charges every non-recovery save to "program", today's rule): red here.
    expect(after.program, `${label}: a supervisor save was charged to the program`).toEqual(before.program);
    expect(after.supervisor, `${label}: the supervisor tally missed its save`).toEqual({
      writes: before.supervisor.writes + cost.writes,
      bytes: before.supervisor.bytes + cost.bytes,
    });
  } else {
    // Plants after the build (RecoveryStore.ts): charge every save, or a mixed one, to "supervisor";
    // classify by `seq` and `journal` alone, so a compacted receipt goes to the supervisor. Red here.
    expect(after.program, `${label}: the program's own save was not charged to it`).toEqual({
      writes: before.program.writes + cost.writes,
      bytes: before.program.bytes + cost.bytes,
    });
    expect(after.supervisor, `${label}: a program save reached the supervisor tally`).toEqual(before.supervisor);
  }

  expect(after.recovery, `${label}: an idle save was charged to recovery`).toEqual(before.recovery);
});

const Gaps = Schema.Array(
  Schema.Struct({
    gap: Schema.Int.check(Schema.isBetween({ minimum: 5_000, maximum: 120_000 })),
    reopen: Schema.Boolean,
  }),
).check(Schema.isMinLength(1), Schema.isMaxLength(5));

export const suite = (open: (limits: Limits) => Effect.Effect<World, unknown, Scope.Scope>) =>
  describe("P34c runner quota laws", () => {
    it.effect.prop(
      "Q5 replacements, deletion of replaceable content and unchanged saves charge exact byte deltas",
      { tape: Tape },
      ({ tape }) =>
        Effect.scoped(
          Effect.gen(function* () {
            const w = yield* open(defaults);
            yield* w.input("alpha:1", "first", { type: "inc" });
            yield* w.drain("alpha:1");
            const encode = Schema.encodeSync(Schema.fromJsonString(Checkpoint));
            let previous = Schema.decodeUnknownSync(Checkpoint)(yield* w.checkpoint("alpha:1"));

            for (const c of tape) {
              const old = yield* w.local("alpha:1");
              const model = c.pick % 3 === 0 ? previous.saved.model : { payload: "😀é\n".repeat(c.amount % 120) };
              const next = { ...previous, saved: { ...previous.saved, model } };
              const delta =
                new TextEncoder().encode(encode(next)).length - new TextEncoder().encode(encode(previous)).length;
              yield* w.replace("alpha:1", next);
              const use = yield* w.local("alpha:1");
              expect(use.program.bytes - old.program.bytes).toBe(delta);
              expect(use.program.writes - old.program.writes).toBe(encode(next) === encode(previous) ? 0 : 1);
              expect(use.recovery).toEqual(old.recovery);
              yield* w.reopen;
              expect(yield* w.checkpoint("alpha:1")).toEqual(next);
              expect(yield* w.local("alpha:1")).toEqual(use);
              previous = next;
            }
          }),
        ),
      options,
    );

    it.effect.prop(
      "Q16 ordinary inputs, timers and command answers never spend recovery room",
      { tape: Tape },
      ({ tape }) =>
        Effect.scoped(
          Effect.gen(function* () {
            yield* TestClock.setTime(1_000);
            const w = yield* open(defaults);
            const baseline = new Map<string, { project: Local["recovery"]; process: Local["recovery"] }>();

            for (const name of names) {
              yield* call(w, name, (r) => r.open("watcher"));
              baseline.set(name, { project: yield* w.projectRecovery(name), process: (yield* w.local(name)).recovery });
            }

            for (const [n, c] of tape.entries()) {
              const name = required(names[c.pick % names.length]);
              const m = required([{ type: "inc" }, { type: "work" }, { type: "schedule", at: 1001 + n }][c.amount % 3]);
              expect(yield* w.input(name, `healthy:${n}`, m)).toHaveProperty("_tag", "placed");
              yield* w.drain(name);
              yield* call(w, name, (r) => r.due(1001 + n));

              if (c.reopen) {
                yield* w.reopen;
              }

              for (const registered of names) {
                expect(yield* w.projectRecovery(registered)).toEqual(required(baseline.get(registered)).project);
                expect((yield* w.local(registered)).recovery).toEqual(required(baseline.get(registered)).process);
              }

              const state = yield* w.local(name);
              expect(state.program.writes).toBeGreaterThan(0);
              expect(state.fault).toBeNull();
            }

            // Refusal must occur before any step or any Process-local save.
            const used = yield* w.program("sample/alpha");
            w.limits({ ...defaults, writes: used.writes });
            const before = yield* w.snapshot;
            expect(yield* w.input("alpha:1", "never-admitted", { type: "inc" })).toEqual(
              Appended.cases.refused.make({ reason: "quota" }),
            );
            expect(yield* w.snapshot).toEqual(before);
          }),
        ),
      options,
    );

    it.effect.prop(
      "Q17 an admitted message settles its step once at the exact cap and after reopen",
      { tape: Tape },
      ({ tape }) =>
        Effect.scoped(
          Effect.gen(function* () {
            yield* TestClock.setTime(1_000);
            const w = yield* open({ ...defaults, writes: 2 });

            for (const [n, c] of tape.entries()) {
              yield* TestClock.setTime(1_000 + n * 60_001);
              const name = required(names[c.pick % 2]);
              const before = yield* w.program("sample/alpha");
              expect(yield* w.input(name, `pair:${n}`, { type: "inc" })).toHaveProperty("_tag", "placed");
              const admitted = yield* w.program("sample/alpha");
              expect(admitted.writes).toBe(2);
              expect(admitted.ahead.writes).toBe(before.ahead.writes + 1);
              yield* w.reopen;
              yield* w.drain(name);
              const settled = yield* w.program("sample/alpha");
              expect(settled.writes).toBe(2);
              expect(settled.ahead.writes).toBe(before.ahead.writes);
              expect((yield* w.entries).filter((e) => e._tag === "stepped" && e.id === `step:pair:${n}`)).toHaveLength(
                1,
              );
              const saved = yield* w.snapshot;
              expect(yield* w.input(name, `refused:${n}`, { type: "inc" })).toEqual(
                Appended.cases.refused.make({ reason: "quota" }),
              );
              expect(yield* w.snapshot).toEqual(saved);
            }
          }),
        ),
      options,
    );

    it.effect.prop(
      "Q7 a full program still records failure, dead letter, signals, cleanup and successor checkpoint",
      { tape: Tape },
      ({ tape }) =>
        Effect.scoped(
          Effect.gen(function* () {
            yield* TestClock.setTime(1_000);
            const w = yield* open(defaults);
            const name = required(names[required(tape[0]).pick % 2]);
            yield* w.watch("beta:1", name, "inbound");
            yield* w.watch(name, "beta:1", "outbound");
            const initial = yield* w.program("sample/alpha");

            for (const [n, c] of tape.entries()) {
              expect(yield* w.msg(required(names[c.pick % 2]), `healthy:${n}`, { type: "inc" })).toHaveProperty(
                "_tag",
                "accepted",
              );
            }

            const full = yield* w.program("sample/alpha");
            expect(full.writes - initial.writes).toBe(2 * tape.length);
            w.limits({ ...defaults, writes: full.writes });
            let terminal = false;

            for (const c of tape) {
              const saved = Schema.decodeUnknownSync(Schema.NullOr(supervision))(yield* w.journal(name));

              if (saved !== null && saved.journal._tag !== "idle") {
                yield* w.drain(name);
              } else if (!terminal) {
                w.cut(c.amount % 8);
                const result = yield* Effect.result(w.msg(name, "poison", { type: "throw" }));
                w.cut(null);
                terminal =
                  result._tag === "Success" &&
                  Schema.is(Schema.TaggedStruct("refused", { reason: Schema.Literal("dead") }))(result.success);
              }

              if (c.reopen) {
                yield* w.reopen;
              }

              expect((yield* w.program("sample/alpha")).writes).toBe(full.writes);
              expect((yield* w.local(name)).fault).toBeNull();
            }

            // Finish the saved delivery limit after the generated cuts, then replay the accepted history.
            for (let retry = 0; retry < 3 && !terminal; retry++) {
              yield* w.drain(name);
              const result = yield* Effect.result(w.msg(name, "poison", { type: "throw" }));
              terminal =
                result._tag === "Success" &&
                Schema.is(Schema.TaggedStruct("refused", { reason: Schema.Literal("dead") }))(result.success);
            }

            yield* w.drain(name);
            expect(terminal).toBe(true);
            yield* w.restart(name, "person", true);
            yield* w.drain(name);
            expect((yield* w.program("sample/alpha")).writes).toBe(full.writes);
            expect((yield* w.local(name)).fault).toBeNull();
            expect((yield* w.local(name)).recovery.total.writes).toBeGreaterThan(0);
            expect((yield* w.projectRecovery(name)).total.writes).toBeGreaterThan(0);
            const entries = yield* w.entries;
            expect(entries.some((e) => e._tag === "exited")).toBe(true);
            expect(entries.some((e) => e._tag === "restarted")).toBe(true);
            expect(
              entries.some(
                (e) =>
                  e._tag === "send" &&
                  e.stream === "beta:1/inbox" &&
                  Schema.is(Schema.Struct({ m: Schema.Struct({ ref: Schema.Literal("inbound") }) }))(e.body),
              ),
            ).toBe(true);
            expect(
              entries.some(
                (e) =>
                  e._tag === "demonitored" && Schema.is(Schema.Struct({ ref: Schema.Literal("outbound") }))(e.body),
              ),
            ).toBe(true);
            expect(entries.some((e) => typeof e.stream === "string" && e.stream.endsWith("/dead"))).toBe(true);
            expect(yield* w.checkpoint(name)).not.toBeNull();
            expect(yield* w.input("beta:1", "other", { type: "inc" })).toHaveProperty("_tag", "placed");
            yield* w.drain("beta:1");
          }),
        ),
      options,
    );

    it.effect.prop(
      "Q8 reserve exhaustion keeps saved work, faults durably, and only checked person restart resumes",
      { tape: Tape },
      ({ tape }) =>
        Effect.scoped(
          Effect.gen(function* () {
            const w = yield* open(defaults);
            yield* TestClock.setTime(1_000);
            expect(yield* w.msg("alpha:1", "healthy", { type: "inc" })).toHaveProperty("_tag", "accepted");
            const old = yield* w.program("sample/alpha");
            const location = required(tape[0]).pick % 3;
            const resource = required(tape[0]).amount % 2 === 0 ? "writes" : "storage";
            // A limit of N admits N writes, as Q17's cap of 2 admits a message that counts 2. So the room
            // left is drawn. With none, the call's first recovery write runs out. With one at the
            // Project alone, the call's recovery writes there may fit, and then a later one, on a
            // saved alarm, runs out.
            const spare = required(tape[1]).pick % 2;
            const tighten = (allowance: Limits["recovery"]["process"]) => ({
              ...allowance,
              ...(resource === "writes" ? { writes: spare } : { bytes: 1 }),
            });
            w.limits({
              ...defaults,
              recovery: {
                project: location === 0 ? defaults.recovery.project : tighten(defaults.recovery.project),
                process: location === 1 ? defaults.recovery.process : tighten(defaults.recovery.process),
              },
            });
            const failure = yield* Effect.result(w.msg("alpha:1", "pending", { type: "throw" }));
            expect(failure).toHaveProperty("_tag", "Failure");
            const fits = location === 1 && resource === "writes" && spare === 1;
            const later = fits && (yield* w.local("alpha:1")).fault === null;

            if (later) {
              // Its recovery writes fit, so this call met no exhaustion: it fails with the step's own failure.
              expect(failure).toHaveProperty("failure._tag", "ProgramDown");
              expect(failure).toHaveProperty("failure.reason", "step");
              expect(failure).toHaveProperty("failure.cause", expect.any(TypeError));

              // Only the alarms the product saved move the clock, until one meets the full window.
              for (let n = 0; n < 16 && (yield* w.local("alpha:1")).fault === null; n++) {
                const at = yield* w.alarm("alpha:1");
                expect(at).not.toBeNull();
                yield* TestClock.setTime(required(at ?? undefined));
                yield* Effect.result(call(w, "alpha:1", (r) => r.due(required(at ?? undefined))));
              }

              // The write that ran out was not charged: the window never passes its limit.
              expect((yield* w.projectRecovery("alpha:1")).writes).toBeLessThanOrEqual(spare);
            } else {
              expect(failure).toHaveProperty("failure._tag", "QuotasError");
              expect(failure).toHaveProperty("failure.reason._tag", "RecoveryReserveExhausted");
              expect(failure).toHaveProperty("failure.reason.resource", resource);
              expect(failure).toHaveProperty("failure.reason.location", location === 1 ? "project" : "process");
              expect(failure).toHaveProperty("failure.reason.cause._tag", "ProgramDown");
              expect(failure).toHaveProperty("failure.reason.cause.reason", "step");
              expect(failure).toHaveProperty("failure.reason.cause.cause", expect.any(TypeError));
            }

            const stopped = yield* w.local("alpha:1");
            expect(stopped.fault).not.toBeNull();
            expect(stopped.fault).toHaveProperty("_tag", "RecoveryReserveExhausted");
            expect(stopped.fault).toHaveProperty("resource", resource);
            expect(stopped.fault).toHaveProperty("location", location === 1 ? "project" : "process");
            const saved = yield* w.journal("alpha:1");
            const checkpoint = yield* w.checkpoint("alpha:1");
            const entries = yield* w.entries;

            for (const [n, c] of tape.entries()) {
              yield* TestClock.setTime(120_000 + n * 60_001);

              if (c.reopen) {
                yield* w.reopen;
              }

              yield* Effect.result(
                call(w, "alpha:1", (r) => (c.pick % 2 === 0 ? r.due(120_000 + n * 60_001) : r.open("poll"))),
              );
              expect((yield* w.local("alpha:1")).fault).toEqual(stopped.fault);
              expect(yield* w.journal("alpha:1")).toEqual(saved);
              expect(yield* w.checkpoint("alpha:1")).toEqual(checkpoint);
              expect(yield* w.entries).toEqual(entries);
              const repeated = yield* Effect.result(w.msg("alpha:1", "pending", { type: "throw" }));
              expect(repeated).toHaveProperty("_tag", "Failure");
              expect(repeated).toHaveProperty("failure._tag", "QuotasError");
              expect(repeated).toHaveProperty("failure.reason._tag", "RecoveryReserveExhausted");
            }

            w.limits(defaults);
            expect(yield* Effect.result(w.restart("alpha:1", "agent-restart", false))).toHaveProperty(
              "_tag",
              "Failure",
            );
            expect((yield* w.local("alpha:1")).fault).toEqual(stopped.fault);
            yield* w.restart("alpha:1", "person-restart", true);
            yield* w.drain("alpha:1");
            expect((yield* w.local("alpha:1")).fault).toBeNull();
            expect((yield* w.program("sample/alpha")).bytes).toBe(old.bytes);
            expect(yield* w.input("beta:1", "unaffected", { type: "inc" })).toHaveProperty("_tag", "placed");
          }),
        ),
      options,
    );

    it.effect.prop(
      "Q18 accepted history brings replay room, independent of exhausted program and recovery windows",
      { tape: History },
      ({ tape }) =>
        Effect.scoped(
          Effect.gen(function* () {
            yield* TestClock.setTime(1_000);
            const w = yield* open(defaults);
            const messages: string[] = [];

            for (const [n, c] of tape.entries()) {
              // Beyond the measured 350: generated histories include up to 1,001 accepted messages.
              const length = c.length;

              for (let j = 0; j < length; j++) {
                const id = `history:${n}:${j}`;
                const m = j === length - 1 ? { type: "inc", text: "é😀".repeat(c.amount % 256) } : { type: "inc" };
                expect(yield* w.input("alpha:1", id, m)).toHaveProperty("_tag", "placed");
                messages.push(id);
              }

              yield* w.drain("alpha:1");
              const full = yield* w.program("sample/alpha");
              w.limits({
                ...defaults,
                writes: full.writes,
                recovery: {
                  project: { ...defaults.recovery.project, writes: 16 },
                  process: { ...defaults.recovery.process, writes: 28 },
                },
              });

              if (c.reopen) {
                yield* w.reopen;
              }

              yield* w.restart("alpha:1", `restart:${n}`, true);
              yield* w.drain("alpha:1");
              expect((yield* w.local("alpha:1")).fault).toBeNull();
              expect(yield* w.program("sample/alpha")).toEqual(full);
              expect(yield* w.checkpoint("alpha:1")).toHaveProperty("saved.model.count", messages.length);
              const before = yield* w.entries;
              yield* w.restart("alpha:1", `restart:${n}`, true);
              yield* w.drain("alpha:1");
              expect(yield* w.entries).toEqual(before);
              expect(yield* w.program("sample/alpha")).toEqual(full);
              const after = yield* w.entries;

              for (const id of messages) {
                expect(
                  after.filter((e) => e._tag === "stepped" && e.id === `step:${id}`).length,
                ).toBeGreaterThanOrEqual(1);
              }

              w.limits(defaults);
              yield* TestClock.setTime((yield* Clock.currentTimeMillis) + 60_001);
            }
          }),
        ),
      options,
    );

    it.effect.prop(
      "Q19 quota-refused timers and command answers keep saved work and land after the window opens",
      { tape: Tape },
      ({ tape }) =>
        Effect.scoped(
          Effect.gen(function* () {
            const w = yield* open({ ...defaults, writes: 2 });

            for (const [n, c] of tape.entries()) {
              const at = 1_000 + n * 120_002;
              yield* TestClock.setTime(at);
              const m = c.pick % 2 === 0 ? { type: "work" } : { type: "schedule", at: at + 1 };
              expect(yield* w.input("alpha:1", `deferred:${n}`, m)).toHaveProperty("_tag", "placed");
              yield* w.drain("alpha:1");
              const saved = yield* w.checkpoint("alpha:1");
              const journal = yield* w.journal("alpha:1");
              const usage = yield* w.local("alpha:1");
              yield* TestClock.setTime(at + 1);

              for (let attempt = 0; attempt < 2 + (c.amount % 5); attempt++) {
                yield* call(w, "alpha:1", (r) => r.due(at + 1));
                expect(yield* w.alarm("alpha:1")).toBeGreaterThan(at + 1);

                if (c.reopen) {
                  yield* w.reopen;
                }

                expect(yield* w.checkpoint("alpha:1")).toEqual(saved);
                expect(yield* w.journal("alpha:1")).toEqual(journal);
                expect((yield* w.local("alpha:1")).recovery).toEqual(usage.recovery);
                expect((yield* w.entries).filter((e) => e._tag === "dead" || e._tag === "exited")).toEqual([]);
              }

              yield* TestClock.setTime(at + 60_001);
              yield* call(w, "alpha:1", (r) => r.due(at + 60_001));
              yield* w.drain("alpha:1");
              const after = yield* w.checkpoint("alpha:1");
              expect(after).not.toEqual(saved);
              expect((yield* w.local("alpha:1")).fault).toBeNull();
            }
          }),
        ),
      options,
    );

    // 0593 (docs/plan/quests/supervisor-writes-uncharged-PLAN.md, L1): the stand-in form of L2.
    it.effect.prop(
      "L1 the healthy mark after an idle gap is the supervisor's save: the program's local account is unchanged",
      { pick: Nat, gaps: Gaps },
      ({ pick, gaps }) =>
        Effect.scoped(
          Effect.gen(function* () {
            yield* TestClock.setTime(1_000);
            const w = yield* open(defaults);
            const name = required(names[pick % names.length]);
            yield* call(w, name, (r) => r.open("watcher"));

            for (const [n, g] of gaps.entries()) {
              const saved = decodeSaved(yield* w.journal(name));
              // The required case: the gap reaches the journal's own reset window, so the turn saves the mark.
              expect(g.gap, "the gap is shorter than the journal's reset window").toBeGreaterThanOrEqual(
                saved.policy.backoff.resetAfterMs,
              );
              const at = (yield* Clock.currentTimeMillis) + g.gap;
              const before = yield* w.local(name);
              const rows = storedRows(yield* w.snapshot, name);
              yield* TestClock.setTime(at);
              yield* call(w, name, (r) => r.open("watcher"));
              expect(decodeSaved(yield* w.journal(name)).healthyAt, `turn ${n} saved no healthy mark`).toBe(at);
              const after = yield* w.local(name);
              const cost = charged(name, rows, storedRows(yield* w.snapshot, name));

              // Plant (RecoveryStore.ts charges every non-recovery save to "program", today's rule): the
              // program gains one write here; red.
              expect(after.program, `the healthy mark ${n} was charged to the program`).toEqual(before.program);
              expect(cost.writes, `the healthy mark ${n} wrote other than the journal row`).toBe(1);
              expect(after.supervisor, `the supervisor tally missed the healthy mark ${n}`).toEqual({
                writes: before.supervisor.writes + 1,
                bytes: before.supervisor.bytes + cost.bytes,
              });
              expect(after.recovery, `the healthy mark ${n} was charged to recovery`).toEqual(before.recovery);

              if (g.reopen) {
                yield* w.reopen;
                expect(yield* w.local(name), `a reopen after the healthy mark ${n} changed the accounts`).toEqual(
                  after,
                );
              }
            }
          }),
        ),
      options,
    );

    // 0593 (the plan's L3): only the supervisor's own saves move; a program's own save is still charged.
    it.effect.prop(
      "L3 a bookkeeping save charges only the supervisor, and a program or mixed save charges the program exactly",
      { pick: Nat, edits: Edits },
      ({ pick, edits }) =>
        Effect.scoped(
          Effect.gen(function* () {
            yield* TestClock.setTime(1_000);
            const w = yield* open(defaults);
            const source = required(names[pick % names.length]);
            const name = required(names[(pick + 1) % names.length]);
            // The runner's real first boot gives a real record; the law saves its copy as `name`'s first.
            yield* call(w, source, (r) => r.open("watcher"));
            const booted = decodeSaved(yield* w.journal(source));

            if (!Journal.guards.idle(booted.journal) || booted.receipts.length > 0) {
              return yield* Effect.die("the first boot saved more than an idle record");
            }

            const process = booted.journal.process;
            expect(yield* w.journal(name), "the law's name already has a journal").toBeNull();
            // The first save of a new journal, with no receipts, is the supervisor's child record.
            yield* settled(w, name, { ...booted, name }, "supervisor", "first save");
            const reached = new Set<string>();
            // Each edit is made on the journal as saved now, so the walk only makes moves that exist there.
            const apply = Effect.fnUntraced(function* (edit: Edit, n: number) {
              const done = edited(decodeSaved(yield* w.journal(name)), edit, n, process);
              reached.add(done.reached);
              yield* settled(w, name, done.next, done.owner, `edit ${n} (${done.reached})`);
            });

            for (const [n, edit] of edits.entries()) {
              yield* apply(edit, n);
            }

            // A compaction with no receipt left to compact admits one first, so a second try reaches it.
            for (const [k, edit] of coverage.entries()) {
              for (let tries = 0; tries < 2 && !reached.has(reachedBy(edit)); tries++) {
                yield* apply(edit, edits.length + 2 * k + tries);
              }
            }

            // Every required case was reached: a bookkeeping, a begin, a new receipt, a compaction, a mixed save.
            expect([...reached].toSorted()).toEqual(["begin", "bookkeeping", "both", "compact", "receipt"]);
          }),
        ),
      options,
    );

    // 0593 with 0147 (the plan's L4): restart counts stay on the recovery account, never the program's.
    it.effect.prop(
      "L4 a crash and its restart leave the supervisor tally, grow recovery, and cost the program no more than a letter",
      { pick: Nat, crashes: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 2 })) },
      ({ pick, crashes }) =>
        Effect.scoped(
          Effect.gen(function* () {
            yield* TestClock.setTime(1_000);
            const w = yield* open(defaults);
            const name = required(names[pick % names.length]);
            yield* call(w, name, (r) => r.open("watcher"));
            const start = yield* w.local(name);
            expect(yield* w.msg(name, "paid", { type: "inc" })).toHaveProperty("_tag", "accepted");
            yield* w.drain(name);
            const paid = yield* w.local(name);
            const letter = paid.program.writes - start.program.writes;

            for (let n = 0; n < crashes; n++) {
              expect(yield* Effect.result(w.msg(name, "poison", { type: "throw" }))).toHaveProperty("_tag", "Failure");
              const crashed = yield* w.local(name);
              yield* w.drain(name);
              // The restart itself, from the saved exit to the successor's checkpoint, is the brain's:
              // the program's account is as the crashed delivery left it.
              // Plant (RecoveryStore.ts reads only recoveryState(saved)): the successor's checkpointed save,
              // from checkpointing to idle with its restart counts, goes to the program; red here.
              expect((yield* w.local(name)).program, `restart ${n} was charged to the program`).toEqual(
                crashed.program,
              );
            }

            // The required case: each crash restarted the name, and it is idle again.
            const recovered = decodeSaved(yield* w.journal(name));
            expect(recovered.restarts, "the name did not restart once per crash").toHaveLength(crashes);
            expect(Journal.guards.idle(recovered.journal), "the name did not recover").toBe(true);
            const after = yield* w.local(name);
            expect(after.fault).toBeNull();
            // The crashed deliveries' own saves (begun, admitted, its stepping marker) are the program's; all
            // of them together cost no more writes than one accepted letter did. Bytes are not bounded: a
            // failed delivery's receipt keeps its input (recovery.ts, Receipt), so it is never compacted.
            expect(
              after.program.writes - paid.program.writes,
              "the crashes cost the program more writes than an accepted letter",
            ).toBeLessThanOrEqual(letter);
            expect(after.supervisor, "a restart reached the supervisor tally").toEqual(paid.supervisor);
            expect(after.recovery.total.writes, "the restart spent no recovery room").toBeGreaterThan(
              paid.recovery.total.writes,
            );
          }),
        ),
      options,
    );
  });
