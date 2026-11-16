// T953 slice 2, next/: laws L17 and L18 of the approved plan (docs/plan/quests/t953-PLAN.md). L17 runs
// a real local instance with no start grants, as start-child.laws.integration.test.ts does: real
// workerd, sockets and object storage, booted twice on one home. L18 runs the public Project service on scoped SQLite,
// where the test plays the runner, so the agent's key is removed after its input was delivered and
// before the start it caused is asked, every run. A real instance gives no way to hold a step after
// its letter is delivered.
import { grantText, revokeText } from "@kampus/libfabrika/access/Text";
import { Recipient } from "@kampus/libfabrika/processes/Process";
import { ProjectService } from "@kampus/libfabrika/workers/runtime";
import { Array as Arr, Effect, Exit, Option, Schema, Scope } from "effect";
import { describe, expect, it, vi } from "vitest";
import { childHome, childProject, type Key, letter, PROJECT, SENT } from "./start-child.test-support.ts";

// Each built-in program's hash is the SHA-256 of its source, as `BuiltProgram` requires.
const CODE = vi.hoisted(() => ({
  counter: { hash: "efe899c74558f20b08bbc19bf0228c0c25bddb7871d80bd34ac8b33c030b3698", source: "counter" },
  checklist: { hash: "6da624dba5235ba1f3901c904a78ea41debbfb0d8a488aeba7063dba508d9211", source: "checklist" },
  tezgah: { hash: "a789b5dbd2d82dbed50bc81e9689731dfbb2e3a068c8373ee22182129a7ceb41", source: "tezgah" },
  child: { hash: "ddc9e669194254cef019a29d3619a2c16592e5d52e1a81e98b01bd52319149a3", source: "child" },
}));

vi.mock("virtual:fabrika-built", () => ({
  programs: {
    "fabrika/counter": CODE.counter,
    "fabrika/checklist": CODE.checklist,
    // Desk S2a: the founder's tezgah boots from the boot list, so the table holds its program too.
    "fabrika/tezgah": CODE.tezgah,
    "p42/child": CODE.child,
  },
  assets: {},
}));

/** Bounded waits tied to observable facts. */
const WAIT = 25_000;

const pause = (ms = 50) => new Promise<void>((done) => setTimeout(done, ms));

/** Polls an observable fact. A timeout fails with the last observed state. */
const until = async <A>(label: string, look: () => Promise<A>, done: (value: A) => boolean): Promise<A> => {
  const end = Date.now() + WAIT;
  let last: { value: A } | { error: string } | null = null;

  while (Date.now() < end) {
    try {
      const value = await look();
      last = { value };

      if (done(value)) {
        return value;
      }
    } catch (error) {
      last = { error: String(error) };
    }

    await pause();
  }

  throw new Error(`${label}: no answer in ${WAIT} ms; last observed ${JSON.stringify(last)}`);
};

type Instance = Record<string, any>;

/** One frame the door pushed, as JSON. */
const decodeFrame = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Unknown));

/** A real WebSocket client at the door, initialized with a signed hello. `close` waits for the close. */
const client = async (instance: Instance, key: Key, tab: string) => {
  const socket = new WebSocket(
    `${String(instance.url).replace("http", "ws")}/client/${encodeURIComponent(key.fingerprint)}/${tab}`,
  );

  const frames: any[] = [];
  let closed = false;
  socket.addEventListener("message", (event) => {
    if (event.data !== "pong") {
      frames.push(decodeFrame(String(event.data)));
    }
  });
  socket.addEventListener("close", () => {
    closed = true;
  });
  let serial = 0;

  const next = async (match: (frame: any) => boolean) => {
    const end = Date.now() + WAIT;

    while (Date.now() < end) {
      const index = Arr.findFirstIndex(frames, match);

      if (Option.isSome(index)) {
        return frames.splice(index.value, 1)[0];
      }

      if (closed) {
        throw new Error("the door closed the socket");
      }

      await pause(20);
    }

    throw new Error(`no frame in ${WAIT} ms`);
  };

  const call = async (method: string, params: unknown) => {
    const id = ++serial;
    socket.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));

    return next((frame) => frame.id === id);
  };

  const nonce = (await next((frame) => frame.method === "challenge")).params.nonce;

  const hello = await call("initialize", {
    versions: [1],
    has: ["seal"],
    ping: "30s",
    key: key.raw,
    tab,
    nonce,
    platform: "headless",
    os: "linux",
    sentAt: SENT,
    signed: key.proof(`fabrika-hello\n${instance.url}\n${tab}\n${nonce}`),
  });

  expect(hello.error).toBeUndefined();

  const close = async () => {
    socket.close();
    const end = Date.now() + WAIT;

    while (!closed && Date.now() < end) {
      await pause(20);
    }
  };

  return { call, close };
};

/** The project's rows of one stream, through the instance's private local capability. */
const rows = async (instance: Instance, stream: string): Promise<Array<any>> =>
  (await instance.project(PROJECT).read(stream, 0, "audit")) as Array<any>;

const livePid = async (instance: Instance, name: string): Promise<string | undefined> =>
  Option.getOrUndefined(
    Arr.findFirst((await instance.project(PROJECT).info()) as Array<any>, (row) => row.name === name),
  )?.process;

describe("T953: a start is checked against the member who caused it, end to end", () => {
  // scenario: L17. Only a real instance proves the brain's wiring: the gateway answers who sent the
  // input, the boot wrote the owner row, and the started line keeps the member. Two boots on one home
  // prove the owner row is written once. Plant: the boot writes the owner row with `sentAt` in its
  // body, so the second boot is refused `id_reused` (cloudflare/runtime.ts).
  it("scenario: L17: with no start grants a person's input starts the child, names the person, and two boots keep one owner row", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const home = yield* childHome([]);
          const first = yield* Scope.make();
          const instance: Instance = yield* Scope.provide(first)(home.boot);
          yield* Effect.promise(async () => {
            const started = await instance.project(PROJECT).start(
              {
                _tag: "first",
                id: "start-starter:1",
                name: "starter:1",
                code: { program: "p42/starter", hash: home.hashes.starter },
              },
              home.from,
            );

            const starter = Schema.decodeUnknownSync(Schema.Struct({ process: Schema.String }))(started).process;
            const window = await client(instance, home.key, "member");

            try {
              const sent = await window.call(
                "process.send",
                letter(starter, "start-1", { type: "start", program: "p42/child", name: "child:1" }),
              );

              expect(sent, "the starter takes the person's letter").toMatchObject({ result: { _tag: "accepted" } });

              const child = await until(
                "L17: the child is live with no start grant",
                () => livePid(instance, "child:1"),
                (pid) => pid !== undefined,
              );
              const line = Option.getOrUndefined(
                Arr.findFirst(
                  await rows(instance, "processes/child:1"),
                (row) => row._tag === "started" && row.body.process === child,
                ),
              );

              expect(line?.body.member, "L17: the started line names the person whose input caused it").toEqual({
                _tag: "person",
                key: home.key.fingerprint,
                for: home.from.for,
              });
            } finally {
              await window.close();
            }
          });
          yield* Scope.close(first, Exit.void);
          const second = yield* Scope.make();
          const again: Instance = yield* Scope.provide(second)(home.boot);
          yield* Effect.promise(async () => {
            const relations = await rows(again, "permissions/relations");
            const brain = Option.getOrUndefined(
              Arr.findFirst(await rows(again, "processes/starter:1"), (row) => row._tag === "started"),
            )?.by;
            expect(brain, "the brain signed the starter's started line").toBeDefined();
            expect(
              Arr.map(relations, (row) => ({ by: row.by, _tag: row._tag, body: row.body })),
              "L17: after two boots the stream holds one owner row, by the brain",
            ).toEqual([
              {
                by: brain,
                _tag: "related",
                body: { subject: `person:${home.from.for}`, relation: "owner", object: `fabrika:${PROJECT}` },
              },
            ]);
          });
          yield* Scope.close(second, Exit.void);
        }),
      ),
    );
  }, 240_000);

  // scenario: L18. The race is one path: an agent's input is delivered to the requester, the founder
  // removes the agent, and only then is the start it caused asked. The Project's start grants would
  // let `fabrika/counter` start `p42/child`, so only the removed sender refuses it. Plant: treat
  // `removed` as no sender (access/SessionSenders.ts).
  it("scenario: L18: an input whose sender's key was removed before its step makes the start answer forbidden", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const fixture = yield* childProject();
          const runtime = yield* fixture.acquire();
          const project = yield* Effect.promise(() => runtime.runPromise(ProjectService));

          const call = <A>(work: Effect.Effect<A, unknown, ProjectService>) =>
            Effect.promise(() => runtime.runPromise(work));

          const person = fixture.from.for;
          const url = "http://127.0.0.1:18787";
          const saw = { label: "agent", location: "test", method: "command", check: "touch" } as const;
          const signed = (text: string) => ({ text, armored: fixture.founder.proof(text) });

          // The founder lets the agent in.
          const granted = yield* call(
            ProjectService.use((p) =>
              p.grant(
                signed(
                  grantText({
                    id: "grant-agent",
                    key: fixture.agent.raw,
                    for: person,
                    to: PROJECT,
                    as: "agent",
                    sentAt: SENT,
                    saw: { ...saw, code: "1234", has: [] },
                  }),
                ),
              ),
            ),
          );

          expect(granted, "the founder's grant lets the agent in").toMatchObject({ _tag: "applied" });
          // The agent comes online and sends an input to the boot's process.
          const agent = yield* call(ProjectService.use((p) => p.connect()));
          const nonce = yield* call(ProjectService.use((p) => p.challenge(agent)));
          const tab = "agent";

          const online = yield* call(
            ProjectService.use((p) =>
              p.initialize(
                agent,
                {
                  versions: [1],
                  has: ["seal"],
                  ping: "30s",
                  key: fixture.agent.raw,
                  tab,
                  nonce,
                  platform: "headless",
                  os: "linux",
                  sentAt: SENT,
                  signed: fixture.agent.proof(`fabrika-hello\n${url}\n${tab}\n${nonce}`),
                },
                { url, tab, name: fixture.agent.fingerprint },
              ),
            ),
          );

          expect(online, "the agent is online").toMatchObject({ _tag: "online" });
          const boot = project.boot.process;

          const sent = yield* call(
            ProjectService.use((p) => p.route(agent, "process.send", letter(boot, "agent-inc", { type: "inc" }))),
          );

          expect(sent, "the door takes the agent's input").toMatchObject({ _tag: "ok" });

          const incoming = Schema.decodeUnknownSync(
            Schema.Struct({ id: Schema.String, envelope: Schema.Struct({ id: Schema.String }) }),
          )(fixture.delivered.at(-1));

          // The founder removes the agent before the step that the input causes runs.
          const revoked = yield* call(
            ProjectService.use((p) =>
              p.grant(
                signed(
                  revokeText({
                    id: "revoke-agent",
                    key: fixture.agent.raw,
                    for: person,
                    to: PROJECT,
                    sentAt: SENT,
                    saw,
                  }),
                ),
              ),
            ),
          );

          expect(revoked, "the founder's revoke removes the agent").toMatchObject({ _tag: "applied" });

          // The test plays the runner: the step on that input asks for a child.
          const child = {
            id: `${boot}/agent-inc/0`,
            name: "child:agent",
            code: { program: "p42/child", hash: CODE.child.hash },
            requester: Recipient.cases.process.make({ process: boot }),
          };

          const answer = yield* call(
            ProjectService.use((p) => p.processChild(child, { ...fixture.from, parent: incoming.envelope.id })),
          );

          expect(answer, "L18: the removed sender's start is refused forbidden").toEqual({
            _tag: "ChildrenError",
            reason: "forbidden",
          });
          const starts = yield* call(ProjectService.use((p) => p.read("processes/child:agent", 0, "audit")));
          expect(starts, "L18: the refused start wrote nothing").toEqual([]);
        }),
      ),
    );
  }, 120_000);
});
