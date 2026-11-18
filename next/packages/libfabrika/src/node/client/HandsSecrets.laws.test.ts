// P39 slice 4b, next/: S2's merge-line property, [secrets] over generated flows. The private half of
// the hands key (`jwk.d`) appears in no frame the client wrote, no span, no log line, no error, no
// journal row and no state the run held, on every flow: keys created, reused and replaced, knocks
// refused, hellos refused, a key the door removed (close 4003), key files that fail to read, and
// commands that fail. `hands-launcher.integration.test.ts`'s S2 is the end-to-end supplement on the
// real launcher and brain, on the schedule.
//
// What it holds the real `HandsStart.start` and `KeyFile.layer` to, from the approved plan
// (docs/plan/quests/p39-s5-PLAN.md, S2's row and "No secret is in any row"): the private half stays
// in `key.json`. The parts are real: the start, the key file on the in-memory file system
// (`MemoryFiles.test-support.ts`), the journal on `JournalSqlite` at `:memory:`, and the real command
// layer over a fake spawner (`Spawner.test-support.ts`). The door is the 4a door
// (`client/HandsDoor.test-support.ts`), which keeps every socket and so every frame as it was sent,
// not only what the door kept of it.
//
// The walk reads the run's link and the disk, and picks its next move from what is possible there:
// ask a task while the key is online, grant a waiting key, remove an online key, refuse the next
// hello, drop the socket, let time pass, or end the process and start again after a change to the
// key file (replace the removed key, damage it, widen its mode, make it unreadable, delete it).
// Every private half the key file ever held is scanned for, as base64url, base64 with and without
// padding, and hex.
//
// Plants, each run once and undone (recorded in this round's field row): the hello carries `d` as
// an extra field; a span attribute holds the JWK; an error message includes the JWK text.
import { describe, expect, it } from "@kampus/vitest";
import * as Cause from "effect/Cause";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Base64 from "effect/encoding/Base64";
import * as Base64Url from "effect/encoding/Base64Url";
import * as Hex from "effect/encoding/Hex";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Logger from "effect/Logger";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as KeyValueStore from "effect/persistence/KeyValueStore";
import * as References from "effect/References";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as TestClock from "effect/testing/TestClock";
import * as Tracer from "effect/Tracer";
import * as fc from "fast-check";
import { type TestContext, vi } from "vitest";
import { brain, door, type Gate, HelloAnswer } from "../../client/HandsDoor.test-support.ts";
import { start } from "../../client/HandsStart.ts";
import * as JournalStore from "../../client/JournalStore.ts";
import * as Id from "../../Id.ts";
import { fcTypeId } from "../../tasks/TasksTest.ts";
import { ClientKey } from "../../transport/ClientKey.ts";
import * as CommandsNode from "./CommandsNode.ts";
import * as JournalSqlite from "./JournalSqlite.ts";
import * as KeyFile from "./KeyFile.ts";
import * as MemoryFiles from "./MemoryFiles.test-support.ts";
import { type Child, fresh, spawner } from "./Spawner.test-support.ts";

const FOLDER = "/fabrika-home/hands";

const FILE = `${FOLDER}/key.json`;

const ORIGIN = "http://127.0.0.1:18787";

/** The name the scripted brain keeps the hands' tasks under; the door admits whatever key dials. */
const TARGET = "SHA256:hands-secrets-target-0000000000000000000000";

const decodeStored = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Struct({ jwk: Schema.Struct({ d: Schema.String }) })),
);

/** Every form the private half `d` could be written in: base64url as stored, base64, and hex. */
const forms = (d: string): ReadonlyArray<string> => {
  const bytes = Base64Url.decode(d);

  if (bytes._tag === "Failure") {
    return [d];
  }

  const padded = Base64.encode(bytes.success);

  return [d, Base64Url.encode(bytes.success), padded, padded.replace(/=+$/, ""), Hex.encode(bytes.success)];
};

/** Any value as text, Maps, bigints and errors included, so a scan reads every field. */
const text = (value: unknown): string =>
  JSON.stringify(value, (_k, v: unknown) =>
    typeof v === "bigint"
      ? String(v)
      : v instanceof Map
        ? Object.fromEntries(v)
        : v instanceof Error
          ? { ...v, name: v.name, message: v.message, stack: v.stack, cause: v.cause }
          : v,
  ) ?? String(value);

/** An exit as every text a reader could see of it: its JSON, its pretty cause, and each error's own fields. */
const exitText = (exit: Exit.Exit<unknown, unknown>): string =>
  Exit.isSuccess(exit)
    ? text(exit.value)
    : [text(exit), Cause.pretty(exit.cause), ...Cause.prettyErrors(exit.cause).map(text)].join("\n");

/** A span as every text a tracer exports of it: name, attributes, events, links and its exit. */
const spanText = (span: Tracer.NativeSpan): string =>
  [
    span.name,
    text([...span.attributes]),
    text(span.events),
    text(span.links.map((l) => l.attributes)),
    span.status._tag === "Ended" ? exitText(span.status.exit) : "",
  ].join("\n");

const bytes = (s: string) => new TextEncoder().encode(s);

/** The children the fake spawner plays: the real command layer answers each a success or a failure. */
const CHILDREN: ReadonlyArray<readonly [string, Child]> = [
  ["exited", { spawn: "ok", chunks: [{ to: "out", bytes: bytes("git version 2.47.1\n") }], code: 0, endless: false }],
  ["exited:1", { spawn: "ok", chunks: [{ to: "err", bytes: bytes("fatal: not a git\n") }], code: 1, endless: false }],
  ["spawn_failed", { spawn: "fails", chunks: [], code: 0, endless: false }],
  [
    "output_limit",
    { spawn: "ok", chunks: [{ to: "out", bytes: new Uint8Array(5000).fill(0x61) }], code: 0, endless: true },
  ],
  [
    "not_utf8",
    { spawn: "ok", chunks: [{ to: "out", bytes: new Uint8Array([0xff, 0xfe, 0x0a]) }], code: 0, endless: false },
  ],
];

/** What can happen to the key file between two processes. */
const CHANGES = ["none", "none", "replace", "replace", "damage", "widen", "unreadable", "delete"] as const;

type Change = (typeof CHANGES)[number];

const Cell = fc.record({ move: fc.nat(), pick: fc.nat(), ms: fc.integer({ min: 0, max: 40_000 }) });

const Flow = fc.record({
  /** Whether the key is granted from the first hello, or the door says not granted and the client knocks. */
  granted: fc.boolean(),
  /** How the door answers each knock in turn: a code, or a refusal for one of its words. */
  knocks: fc.array(
    fc.oneof(
      fc.record({ code: fc.stringMatching(/^[A-Z0-9]{6}$/), until: fc.integer({ min: 1, max: 4_102_444_800_000 }) }),
      fc.record({ reason: fc.constantFrom("rate_limited", "not_allowed", "blocked", "bad_input", "unavailable") }),
    ),
    { minLength: 1, maxLength: 4 },
  ),
  processes: fc.uniqueArray(fcTypeId("process"), { minLength: 1, maxLength: 3 }),
  cells: fc.array(Cell, { minLength: 10, maxLength: 40, size: "max" }),
});

type Flow = typeof Flow extends fc.Arbitrary<infer A> ? A : never;

/** Lets the run go on: virtual time moves `ms`, and real work (WebCrypto, the hello's hashing) gets its turn. */
const pass = (ms: number) =>
  TestClock.adjust(ms).pipe(
    Effect.andThen(TestClock.withLive(Effect.sleep("1 millis"))),
    Effect.andThen(Effect.yieldNow),
  );

/** What one flow wrote anywhere a reader could look. */
type Outputs = {
  readonly frames: Array<string>;
  readonly spans: Array<Tracer.NativeSpan>;
  readonly logs: Array<unknown>;
  readonly errors: Array<string>;
  readonly states: Array<unknown>;
  readonly rows: Array<unknown>;
};

/** One generated flow over one disk, one journal, one brain and one door, through many processes. */
const walk = (f: Flow, out: Outputs, secrets: Set<string>, done: Set<string>) =>
  Effect.gen(function* () {
    const disk = MemoryFiles.disk([FOLDER, "/usr/bin"]);
    MemoryFiles.put(disk, "/usr/bin/git", new Uint8Array([0x7f, 0x45, 0x4c, 0x46]), 0o755);

    /** The private half the key file holds now, kept: the scan looks for every one ever stored. */
    const remember = () => {
      const file = MemoryFiles.read(disk, FILE);
      const stored = file === null ? Option.none() : decodeStored(new TextDecoder().decode(file.bytes));

      if (Option.isSome(stored)) {
        secrets.add(stored.value.jwk.d);
      }

      return file;
    };

    // The door's answer to each hello and knock, as the walk sets it.
    let hello: typeof HelloAnswer.Type = f.granted
      ? HelloAnswer.cases.admit.make({})
      : HelloAnswer.cases.not_granted.make({});

    let knocked = 0;

    const gate: Gate = {
      hello: () => hello,
      knock: () => {
        const said = f.knocks[knocked++ % f.knocks.length] ?? { reason: "not_allowed" };
        done.add("reason" in said ? "knock:refused" : "knock:code");

        return said;
      },
    };

    const b = brain();
    const d = door(b, TARGET, gate);
    // The journal file outlives every process, as the real file does.
    const journal = yield* Layer.build(JournalSqlite.layer({ file: ":memory:" }));
    const files = Layer.mergeAll(MemoryFiles.layer(disk), Path.layer);
    const keyFile = KeyFile.layer({ file: FILE }).pipe(Layer.provide(files));

    const commands = (child: Child) =>
      CommandsNode.layer.pipe(
        Layer.provide(
          Layer.mergeAll(
            spawner(child, fresh()),
            files,
            ConfigProvider.layer(ConfigProvider.fromEnv({ env: { PATH: "/usr/bin" } })),
          ),
        ),
      );

    /** One hands process: the start over the real key file, the journal and the real command layer. */
    const boot = (pick: number) =>
      Effect.gen(function* () {
        const [name, child] = CHILDREN[pick % CHILDREN.length] ?? ["none", null];

        if (child === null) {
          return null;
        }

        done.add(`child:${name}`);
        const before = MemoryFiles.read(disk, FILE);
        const scope = yield* Scope.make();

        const layers = Layer.mergeAll(
          d.socket,
          keyFile,
          commands(child),
          JournalStore.layer.pipe(Layer.provide(Layer.succeedContext(journal))),
          Id.Generator.layer,
        );

        const booted = yield* start({ origin: ORIGIN, build: "hands-build", label: "hands", os: "macos" }).pipe(
          Effect.flatMap((booting) => booting.ready),
          Effect.provide(layers),
          Scope.provide(scope),
          Effect.exit,
        );

        const after = remember();

        if (Exit.isFailure(booted)) {
          out.errors.push(exitText(booted));
          done.add("start:failed");
          yield* Scope.close(scope, Exit.void);

          return null;
        }

        done.add(before === null && after !== null ? "key:created" : "key:reused");

        return { scope, run: booted.value };
      });

    let starts = 0;
    let live = yield* boot(0);

    const stop = Effect.gen(function* () {
      if (live !== null) {
        out.states.push(live.run.getState());
        yield* Scope.close(live.scope, Exit.void);
        live = null;
      }
    });

    const current = (rejected: string | null) =>
      ClientKey.use((keys) => keys.current(rejected)).pipe(Effect.provide(keyFile), Effect.exit);

    /** The key file changes between two processes, as a person, another tool or an Ask again would. */
    const change = (c: Change, pick: number) =>
      Effect.gen(function* () {
        const entry = disk.entries.get(FILE);

        if (c === "replace" && entry?.type === "File" && entry.mode === 0o600) {
          // Ask again after a removal: the stored key's own fingerprint is replaced by a new key.
          const known = yield* current(null);
          const made = Exit.isSuccess(known) ? yield* current(known.value.fingerprint) : known;
          out.errors.push(...[known, made].filter(Exit.isFailure).map(exitText));
          done.add(`key:${Exit.isSuccess(made) ? made.value.found : "failed"}`);
          remember();
        } else if (c === "damage" && entry?.type === "File") {
          // Cut short, so what is left still holds part of the file, often the private half whole.
          entry.bytes = entry.bytes.slice(0, Math.max(1, entry.bytes.length - 1 - (pick % 8)));
          done.add("file:damaged");
        } else if (c === "widen" && entry?.type === "File") {
          entry.mode = 0o600 | (1 + (pick % 0o077));
          done.add("file:wide");
        } else if (c === "unreadable" && entry?.type === "File") {
          // A folder where the key file should be: it stats, and reading it fails.
          disk.entries.set(FILE, { type: "Directory", mode: 0o700, mtime: new Date(0) });
          done.add("file:unreadable");
        } else if (c !== "none" && entry !== undefined) {
          // A person deletes the key file, or one that cannot be used any more.
          disk.entries.delete(FILE);
          done.add("file:deleted");
        }
      });

    for (const cell of f.cells) {
      yield* pass(0);
      const link = live === null ? null : live.run.getState().link._tag;
      done.add(`link:${link ?? "stopped"}`);
      const open = b.all().filter((t) => t.phase !== "finished");
      const free = f.processes.filter((p) => !open.some((t) => t.request.process === p));

      const options: ReadonlyArray<string> =
        live === null
          ? ["restart"]
          : [
              "time",
              "time",
              "restart",
              ...(link === "waiting_grant" ? ["grant", "grant", "drop"] : []),
              ...(link === "online" && free.length > 0 ? ["request", "request", "request"] : []),
              ...(link === "online" ? ["remove", "refuse", "drop"] : []),
            ];

      const move = options[cell.move % options.length] ?? "time";

      if (move === "time") {
        yield* pass(cell.ms);
      } else if (move === "grant") {
        hello = HelloAnswer.cases.admit.make({});
        d.grant();
        done.add("grant");
      } else if (move === "request") {
        d.request(free[cell.pick % free.length] ?? "", b.all().length + 1);
        done.add("request");
      } else if (move === "remove") {
        // The person removed the key: its grant is gone, and the door closes with 4003.
        hello = HelloAnswer.cases.not_granted.make({});
        d.remove();
        done.add("remove");
      } else if (move === "refuse") {
        // The door refuses the next hello for one of its words, and drops the socket so one comes.
        hello = HelloAnswer.cases.refuse.make({ reason: cell.pick % 2 === 0 ? "blocked" : "version_unsupported" });
        d.drop();
        done.add("hello:refused");
      } else if (move === "drop") {
        d.drop();
      } else {
        yield* stop;
        yield* change(CHANGES[cell.pick % CHANGES.length] ?? "none", cell.ms);
        // A refused hello holds for one process at most, so a later one can be online again.
        hello = hello._tag === "refuse" ? HelloAnswer.cases.not_granted.make({}) : hello;
        live = yield* boot(cell.pick + ++starts);
      }
    }

    // Quiet now: a live client works through what it was asked, then every span ends with its exit.
    for (let i = 0; i < 200 && live !== null && b.all().some((t) => t.phase !== "finished"); i++) {
      yield* pass(i % 10 === 0 ? 30_000 : 1_000);
    }

    yield* pass(60_000);
    yield* stop;
    out.frames.push(...d.state.sockets.flatMap((s) => [s.url, ...s.sent]));
    const kv = Context.get(journal, KeyValueStore.KeyValueStore);
    const keys = yield* kv.keys.pipe(Effect.orDie);
    out.rows.push(
      ...(yield* Effect.forEach(
        keys,
        (k) =>
          kv.get(k).pipe(
            Effect.orDie,
            Effect.map((v) => [k, v]),
          ),
        { concurrency: 1 },
      )),
    );
    done.add(out.rows.length > 0 ? "journal:rows" : "journal:empty");

    for (const t of b.all()) {
      done.add(
        t.result === undefined
          ? "result:none"
          : `result:${t.result._tag === "failed" ? t.result.reason : t.result._tag}`,
      );
    }
  });

/** Every flow S2 names: an empty walk cannot pass. */
const FLOWS = [
  "key:created",
  "key:reused",
  "key:replaced",
  "knock:code",
  "knock:refused",
  "hello:refused",
  "remove",
  "link:removed",
  "grant",
  "link:online",
  "link:waiting_grant",
  "start:failed",
  "file:damaged",
  "file:wide",
  "file:unreadable",
  "result:exited",
  "result:spawn_failed",
  "result:output_limit",
  "journal:rows",
  "span:execute",
  "span:hello",
];

/** What each law's cases reached so far, by the law's own task, so each run of a law starts empty. */
const reaches = new WeakMap<object, Set<string>>();

/**
 * The set one law's cases add what they reach to. The first case registers `covers`, which runs once
 * when the law ends, so a walk that reached too little fails loudly however its cases went.
 */
const reach = (ctx: TestContext, covers: (seen: ReadonlyArray<string>) => void): Set<string> => {
  const known = reaches.get(ctx.task);

  if (known !== undefined) {
    return known;
  }

  const seen = new Set<string>();
  reaches.set(ctx.task, seen);
  ctx.onTestFinished(() => covers([...seen]));
  return seen;
};

describe("P39 slice 4b: the hands key's private half stays in its file", () => {
  it.live.prop(
    "S2 property: [secrets] over generated flows (keys created, reused and replaced, knocks and hellos refused, a key removed with 4003, key files that fail to read, commands that fail), the private half in base64url, base64 or hex is in no frame the client wrote, no span, no log line, no error, no journal row and no state the run held",
    // fast-check kept: moved unchanged from the property runner; the Schema rewrite comes later in 0579's sweep
    { flow: Flow },
    ({ flow: f }, ctx) => {
      const done = reach(ctx, (seen) => expect(seen).toEqual(expect.arrayContaining(FLOWS)));
      return Effect.gen(function* () {
        const out: Outputs = { frames: [], spans: [], logs: [], errors: [], states: [], rows: [] };
        const secrets = new Set<string>();
        const tracer = Tracer.make({
          span: (init) => {
            const span = new Tracer.NativeSpan(init);
            out.spans.push(span);
            return span;
          },
        });
        const logger = Logger.layer([Logger.map(Logger.formatStructured, (entry) => void out.logs.push(entry))]);
        // What reaches the console or the process's own output outside Effect's logger, tea's
        // own error sink included, is a log line too.
        yield* Effect.acquireRelease(
          Effect.sync(() => [
            ...(["log", "info", "warn", "error", "debug"] as const).map((method) =>
              vi.spyOn(console, method).mockImplementation((...args) => void out.logs.push(args)),
            ),
            vi.spyOn(process.stdout, "write").mockImplementation((chunk) => out.logs.push(String(chunk)) > 0),
            vi.spyOn(process.stderr, "write").mockImplementation((chunk) => out.logs.push(String(chunk)) > 0),
          ]),
          (spies) =>
            Effect.sync(() => {
              for (const spy of spies) {
                spy.mockRestore();
              }
            }),
        );
        yield* walk(f, out, secrets, done).pipe(
          Effect.withTracer(tracer),
          Effect.provide(logger),
          Effect.provideService(References.MinimumLogLevel, "All"),
          Effect.provide(TestClock.layer()),
        );
        const outputs: Record<string, ReadonlyArray<string>> = {
          frames: out.frames,
          spans: out.spans.map(spanText),
          logs: out.logs.map(text),
          errors: out.errors,
          journal: out.rows.map(text),
          states: out.states.map(text),
        };
        expect(secrets.size, "S2: the flow stored at least one key to look for").toBeGreaterThan(0);

        for (const [name, texts] of Object.entries(outputs)) {
          for (const secret of secrets) {
            for (const form of forms(secret)) {
              const at = texts.findIndex((t) => t.includes(form));
              expect(
                at,
                `S2: [secrets] the private half is in no ${name}: ${at < 0 ? "" : (texts[at] ?? "").slice(0, 400)}`,
              ).toBe(-1);
            }
          }
        }

        done.add(out.spans.some((s) => s.name === "Commands.execute") ? "span:execute" : "span:none");
        done.add(out.spans.some((s) => s.name === "Hands.hello") ? "span:hello" : "span:no-hello");
      });
    },
    {
      plant: "the key file's loaded identity answers the private half as raw, so the hello sends it",
      timeout: 300_000,
      fastCheck: { numRuns: 100 },
    },
  );
});
