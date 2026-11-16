// P13 slice 2, next/. Real SQLite files and ledger services for runtime's admission laws (0062).
import { DatabaseSync } from "node:sqlite"; // edge: Effect has no synchronous SQLite handle for referee transactions
import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { Stub } from "@kampus/vitest";
import { Effect, FileSystem, Layer, Path, Predicate, type Scope } from "effect";
import * as RateLimiter from "effect/persistence/RateLimiter";
import { TestClock } from "effect/testing";
import * as fc from "fast-check";
import type { Envelope } from "../access/SessionManager.ts";
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
import type { Incoming } from "../runtime/Entry.ts";
import { Sent } from "../runtime/Runner.ts";
import * as RunnerAdmissionTest from "../runtime/RunnerAdmissionTest.ts";
import { BRAIN, type Harness } from "../runtime/RunnerRepliesTest.ts";
import { Written } from "../telemetry/Records.ts";

const quiet = Layer.succeed(Doorbell, { ring: () => Effect.void });
// T843: the gateway needs a sender budget; this one is far above what the audit laws send.
const RATE_LIMIT = { limit: 100_000, window: 60_000 };

const files = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const folder = yield* fs.makeTempDirectoryScoped({ prefix: "p13-admission-" });
  return (name: string) =>
    Effect.acquireRelease(
      Effect.sync(() => new DatabaseSync(path.join(folder, `${name}.sqlite`))),
      (db) => Effect.sync(() => db.close()),
    ).pipe(Effect.map(nodeSql));
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
  it(
    name,
    async () => {
      await fc.assert(
        fc.asyncProperty(tape, (cells: Array<A>) =>
          Effect.runPromise(Effect.scoped(check(cells)).pipe(Effect.provide(TestClock.layer()))),
        ),
        options,
      );
      expect([...reached]).toEqual(expect.arrayContaining([...required]));
    },
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

// M3 of the mock sweep (ticket 1067): the stubs are typed by Env's bindings (M4), and both suites
// keep their seeds, run counts and coverage.
// Plant: make the process stub's `msg` refuse every object message, and four project audit laws are
// red (expected `result._tag` accepted).
// Cloudflare's RPC types wrap a Durable Object's methods (`Rpc.Provider`): the process's `msg` must
// answer a disposable promise and the record's `write` types as answering never, so neither plain
// async function goes in `own`. Each is answered by name in `rest`, which `Stub.make` types as one of
// the stub's own members, so these two do not type-check yet: ticket 1067 sent this back to plan.
const environment: ProjectAuditTest.Harness["environment"] = (box, accept, usage, loaded) => {
  const msg = async (input: Incoming) => {
    const message = input.envelope.input;
    const stamped = Predicate.isObject(message) ? { ...message, parent: input.envelope.id } : message;

    if (!(await box.admit(stamped))) {
      return Sent.cases.refused.make({ reason: "bad_msg" });
    }

    const rev = accept();
    return Sent.cases.accepted.make({ rev, pos: rev });
  };
  const write = async () => Written.cases.written.make({});
  return {
    PROJECT: Stub.make<Env["PROJECT"]>(unexpected),
    CONNECTION: Stub.make<Env["CONNECTION"]>(unexpected),
    LOADER: Stub.make<Env["LOADER"]>(unexpected, {
      get: (key, code) => {
        // The Project always names the code it loads; a load with no name is no call this law gave.
        if (key === null) {
          return unexpected("get with no name")();
        }

        loaded(key, code());
        // getEntrypoint is generic in its binding, so a plain `() => box` is not every Fetcher<T> it
        // may answer: it is answered by name.
        return Stub.make<ReturnType<Env["LOADER"]["get"]>>((member) =>
          member === "getEntrypoint" ? () => box : unexpected(member),
        );
      },
    }),
    PROCESS: Stub.make<Env["PROCESS"]>(unexpected, {
      getByName: (object) =>
        Stub.make<ReturnType<Env["PROCESS"]["getByName"]>>((member) => (member === "msg" ? msg : unexpected(member)), {
          configure: async () => undefined,
          usage: async (rows) => usage(object, rows),
        }),
    }),
    RECORD: Stub.make<Env["RECORD"]>(unexpected, {
      getByName: () =>
        Stub.make<ReturnType<Env["RECORD"]["getByName"]>>((member) =>
          member === "write" ? write : unexpected(member),
        ),
    }),
    MEASUREMENTS: Stub.make<Env["MEASUREMENTS"]>(unexpected),
  };
};

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
            name: (m: typeof input.Type) => m.type,
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
    door,
  },
  register,
);
