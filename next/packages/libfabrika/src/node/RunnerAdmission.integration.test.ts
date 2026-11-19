// P13 slice 2, next/. Real SQLite files and ledger services for runtime's admission laws (0062).
import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { Recorder, Stub } from "@kampus/vitest";
import * as TestDatabase from "@kampus/vitest/TestDatabase";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as RateLimiter from "effect/persistence/RateLimiter";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";
import * as TestClock from "effect/testing/TestClock";
import * as fc from "fast-check";
import type { Envelope } from "../access/SessionManager.ts";
import { ProcessObjects, RecordObjects } from "../cloudflare/ObjectCalls.ts";
import * as ProjectAuditTest from "../cloudflare/ProjectAuditTest.ts";
import type { Env, ProjectDoorOptions } from "../cloudflare/runtime.ts";
import { Gateway } from "../gateway/Gateway.ts";
import * as RateLimiterSql from "../gateway/RateLimiterSql.ts";
import * as Id from "../Id.ts";
import { Doorbell } from "../ledger/Ledger.ts";
import * as LedgerSql from "../ledger/LedgerSql.ts";
import * as LedgerTransactionSql from "../ledger/LedgerTransactionSql.ts";
import { nodeSql } from "../ledger/NodeSqlite.ts";
import { Mailbox } from "../processes/Mailbox.ts";
import { Owner, Recipient } from "../processes/Process.ts";
import { ProcessManager } from "../processes/ProcessManager.ts";
import { Incoming } from "../runtime/Entry.ts";
import { Sent } from "../runtime/Runner.ts";
import * as RunnerAdmissionTest from "../runtime/RunnerAdmissionTest.ts";
import { BRAIN, type Harness } from "../runtime/RunnerRepliesTest.ts";
import { Written } from "../telemetry/Records.ts";

/** A promise the test waits on rejected: the test's own failure, with the rejection as its cause. */
class TestFailure extends Schema.TaggedError<TestFailure, { readonly brand: unique symbol }>()("TestFailure", {
  cause: Schema.Unknown,
}) {}

/** Waits on a promise inside the test's Effect, as `Effect.tryPromise` in its object form. */
const promised = <A>(run: () => PromiseLike<A>) =>
  Effect.tryPromise({ try: run, catch: (cause) => TestFailure.make({ cause }) });

const quiet = Layer.succeed(Doorbell, { ring: () => Effect.void });

// T843: the gateway needs a sender budget; this one is far above what the audit laws send.
const RATE_LIMIT = { limit: 100_000, window: 60_000 };

const files = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const folder = yield* fs.makeTempDirectoryScoped({ prefix: "p13-admission-" });

  return (name: string) => TestDatabase.make(path.join(folder, `${name}.sqlite`)).pipe(Effect.map(nodeSql));
}).pipe(Effect.provide(NodeServices.layer), Effect.orDie);

const services: Harness["services"] = (inbox, manager) =>
  Layer.mergeAll(
    Mailbox.layer.pipe(
      Layer.provideMerge(LedgerSql.layer(inbox, { reader: "admission-fixture" }).pipe(Layer.provide(quiet))),
    ),
    ProcessManager.layer(
      {
        by: BRAIN,
        owner: Owner.cases.brain.make({}),
        recipient: Recipient.cases.client.make({ client: "fixture", session: "process_0000000000e008000000000003" }),
      },
      Id.Generator.use((ids) => ids.next(Id.Process)).pipe(Effect.provide(Id.Generator.layer), Effect.orDie),
    ).pipe(Layer.provide(LedgerTransactionSql.layer(manager).pipe(Layer.provide(quiet)))),
  );

const register = <A>(
  name: string,
  tape: fc.Arbitrary<Array<A>>,
  check: (cells: ReadonlyArray<A>) => Effect.Effect<void, unknown, Scope.Scope>,
  options: { readonly seed: number; readonly numRuns: number; readonly endOnFailure?: boolean },
  reached: Set<string>,
  required: ReadonlyArray<string>,
) => {
  it.live(
    name,
    () =>
      Effect.gen(function* () {
        yield* promised(() =>
          fc.assert(
            fc.asyncProperty(tape, (cells: Array<A>) =>
              Effect.runPromise(Effect.scoped(check(cells)).pipe(Effect.provide(TestClock.layer()))),
            ),
            options,
          ),
        );
        expect([...reached]).toEqual(expect.arrayContaining([...required]));
      }),
    600_000,
  );
};

RunnerAdmissionTest.suite({ files, services }, register);

/**
 * Any platform member this law does not give throws, naming it, as a member left out of `Layer.mock`
 * dies. A law that leans on a member it did not give fails loudly.
 */
const unexpected = (member: string) => (): never => {
  throw new Error(`unused platform call: ${member}`);
};

// M4 of the mock sweep (ticket 1067): every member this law gives is typed by a type that names it.
// The plain bindings are Stub.make over Env's interfaces, so a misspelled member of the loader stub's
// `own` does not compile. A Durable Object stub's Cloudflare type takes any key, so the process
// stub's `usage` is held by M3 at run time instead: the walk's usage rows never arrive.
// Plant: rename the loader stub's `get` to `gett`: TS2561 in libfabrika's `tsc --noEmit -p .`.
// RECORD gives nothing and PROCESS only the tail's `usage`: the Project's own calls on its objects go
// through `objects` below.
const environment: ProjectAuditTest.Harness["environment"] = (box, usage, loaded) => ({
  PROJECT: Stub.make<Env["PROJECT"]>(unexpected),
  CONNECTION: Stub.make<Env["CONNECTION"]>(unexpected),
  LOADER: Stub.make<Env["LOADER"]>(unexpected, {
    get: (key, code) => {
      // The Project always names the code it loads; a load with no name is no call this law gave.
      if (key === null) {
        return unexpected("get with no name")();
      }

      loaded(key, code());

      // getEntrypoint is generic in its binding, so a plain `() => box` is not every Fetcher<T> it may
      // answer: it is answered by name.
      return Stub.make<ReturnType<Env["LOADER"]["get"]>>((member) =>
        member === "getEntrypoint" ? () => box : unexpected(member),
      );
    },
  }),
  PROCESS: Stub.make<Env["PROCESS"]>(unexpected, {
    getByName: (object) =>
      Stub.make<ReturnType<Env["PROCESS"]["getByName"]>>(unexpected, {
        usage: (rows) => Promise.resolve(usage(object, rows)),
      }),
  }),
  RECORD: Stub.make<Env["RECORD"]>(unexpected),
  MEASUREMENTS: Stub.make<Env["MEASUREMENTS"]>(unexpected),
});

// M3 of the mock sweep (ticket 1067): the Project's calls on its Process and Record objects go
// through ProcessObjects and RecordObjects, provided with Recorder.layer, and both suites keep their
// seeds, run counts and coverage. A member this law leaves out dies with UnimplementedError, as one
// left out of Layer.mock does.
// Plant: make `msg` answer refused for every object message, and the project audit laws that expect
// an accepted answer are red.
// M4: each impl is typed by its service, so a misspelled member does not compile (the Recorder's laws
// R17 and R18). Plant: rename `write` to `writ` in the RecordObjects impl: red in libfabrika's
// `tsc --noEmit -p .`.
const objects: ProjectAuditTest.Harness["objects"] = (box, accept) =>
  Layer.merge(
    Recorder.layer(ProcessObjects, {
      configure: () => Effect.void,
      msg: (_object, input) =>
        Effect.gen(function* () {
          // The Process object types msg's input as unknown; the stand-in reads it through Entry's schema.
          const incoming = yield* Schema.decodeUnknownEffect(Incoming)(input);
          const message = incoming.envelope.input;
          const stamped = Predicate.isObject(message) ? { ...message, parent: incoming.envelope.id } : message;

          // The program box admits through a Promise, as the platform's stub did.
          if ((yield* promised(() => box.admit(stamped))) !== true) {
            return Sent.cases.refused.make({ reason: "bad_msg" });
          }

          const rev = accept();

          return Sent.cases.accepted.make({ rev, pos: rev });
        }).pipe(Effect.orDie),
    }),
    Recorder.layer(RecordObjects, { write: () => Effect.succeed(Written.cases.written.make({})) }),
  );

const door: ProjectAuditTest.Harness["door"] =
  (url: string, input: Parameters<ProjectAuditTest.Harness["door"]>[1]) => (options: ProjectDoorOptions) =>
    Gateway.pipe(
      Effect.provide(
        Gateway.layer({
          ...options,
          name: "p13-project",
          url,
          origins: ["https://fabrika.test"],
          versions: [1],
          location: "test",
          build: "build-a",
          waiting: { most: 20, ttl: 600_000 },
          ping: { min: 10_000, max: 60_000 },
          inputCap: 1000,
          spentCap: 1000,
          rateLimit: RATE_LIMIT,
          deliver: (
            pid: Parameters<ProjectDoorOptions["deliver"]>[0],
            _envelope: Envelope<typeof input.Type>,
            _span: { readonly traceId: string; readonly spanId: string },
            incoming: Parameters<ProjectDoorOptions["deliver"]>[1],
          ) => options.deliver(pid, incoming),
          inputs: {
            schema: input,
            raw: [],
            personOnly: [],
            name: (m: typeof input.Type) => Option.getOrUndefined(Schema.decodeUnknownOption(Schema.String)(m["_tag"])),
          },
          events: { personOnly: [] },
        }).pipe(
          Layer.provide(
            RateLimiter.layer.pipe(
              Layer.provide(RateLimiterSql.layer(options.sql, { build: "build-a", policy: RATE_LIMIT })),
            ),
          ),
        ),
      ),
    );

ProjectAuditTest.suite(
  {
    open: files.pipe(Effect.flatMap((open: Effect.Success<typeof files>) => open("project-audit"))),
    tail: () => ({ fetch: () => Promise.resolve(new Response()) }),
    environment,
    objects,
    door,
  },
  register,
);
