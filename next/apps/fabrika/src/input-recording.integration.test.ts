// P13 slice 2, next/. The real build, Alchemy and local instance run under plain vitest.
import { NodeServices } from "@effect/platform-node";
import { Start } from "@kampus/libfabrika/processes/Process";
import { KeyLine, writeSshsig } from "@kampus/libfabrika/transport/Sshsig";
import * as SshsigTest from "@kampus/libfabrika/transport/Sshsig.test-support";
import { ConnectionId } from "@kampus/libfabrika/workers/bindings";
import { runsFor } from "@kampus/vitest";
import { localState } from "alchemy/State/LocalState";
import { Array as Arr, String as Str, Effect, FileSystem, Formatter, Path, Schema } from "effect";
import { SecureRandom } from "effect/crypto";

import * as fc from "fast-check";
import { expect, it } from "vitest";
import { build } from "./build.ts";
import { scopedEnv } from "./env.test-support.ts";
import { instanceDatabase } from "./instance-database.test-support.ts";
import { localInstance } from "./local-instance.ts";
import { heldPort } from "./port.test-support.ts";
import * as RecordWireTest from "./record-wire.test-support.ts";

/** The key of each Msg, Cmd and answer these laws write or expect, made by a schema (0569, 0562).
 *  A law hands over only the fields it reads, so a case holds the key alone. */
const Tag = Schema.TaggedUnion({
  save: {},
});

const PROGRAM = "p13/recording";

const NAME = "recording:1";

const PERSON = "person_01m6v5270hf3c8x2q7w9z4k5mn";

const SENT = "2026-11-11T00:00:00Z";

const TRACE = "4bf92f3577b34da6a3ce929d0e0e4736";

const Stored = Schema.Struct({ id: Schema.String, body: Schema.Json });

const Started = Schema.Struct({ process: Schema.String });

const Journal = Schema.Struct({
  crashes: Schema.Int,
  journal: Schema.Struct({ _tag: Schema.String, reply: Schema.optionalKey(Schema.Json) }),
});

const Metadata = Schema.TaggedStruct("save", { note: Schema.String, base: Schema.Int, reason: Schema.String });

class CallError extends Schema.TaggedError<CallError, { readonly brand: unique symbol }>()("CallError", {
  message: Schema.String,
  cause: Schema.Defect(),
}) {}

/** One typed call on the local instance's client, its rejection kept as the cause. */
const invoke = <A>(call: () => PromiseLike<A>) =>
  Effect.tryPromise({
    try: call,
    catch: (cause) => CallError.make({ message: "local instance call failed", cause }),
  });

const program = `
import {Machine} from "@demlik/tea/effect";
import {Schema} from "effect";
const Model=Schema.Struct({count:Schema.Int});
const Msg=Schema.TaggedStruct("save", { note:Schema.String,base:Schema.Int,body:Schema.String,reason:Schema.String });
const Metadata=Schema.TaggedStruct("save", { note:Schema.String,base:Schema.Int,reason:Schema.String });
export const program={name:"p13/recording",machine:Machine.make({model:Model,msg:Msg,cmds:[],init:s=>[s??{count:0},[]],update:{save:s=>[{count:s.count+1},[]]}}),state:{v:1,schema:Model,upgrades:[]},msg:Msg,view:{data:Model,select:s=>s},refuse:(s,m)=>m.base===s.count?null:{reason:"changed_elsewhere",now:s.count},inputs:{save:{_tag:"write",schema:Msg,description:"Save",personOnly:false}},outputs:{},writes:{},wake:()=>null,audit:{data:Metadata,select:m=>{if(m.note==="fail")throw new Error(m.body);return {_tag:m._tag,note:m.note,base:m.base,reason:m.reason};}}};
`;

const recovery = Effect.fnUntraced(function* (home: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  for (const file of yield* fs.glob("**/*.{sqlite,db}", { root: home, dot: true, exclude: ["node_modules/"] })) {
    // It writes this file's triggers while the live instance writes it too, so it waits for the lock.
    const db = yield* instanceDatabase(path.join(home, file), { readOnly: false });
    const table = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='process_recovery'").get();

    if (table !== undefined && db.prepare("SELECT name FROM process_recovery WHERE name=?").get(NAME) !== undefined) {
      return db;
    }
  }

  return yield* Effect.die(new Error("the live instance has no recovery database"));
});

const pendingReply = Effect.fnUntraced(function* (
  home: string,
  move: string,
  body: string,
  letter: string,
  route: Effect.Effect<unknown, Error>,
) {
  const db = yield* recovery(home);

  const read = () =>
    Schema.decodeUnknownSync(Schema.fromJsonString(Journal))(
      db.prepare("SELECT value FROM process_recovery WHERE name=?").get(NAME)?.value,
    );

  const before = read();

  const trigger =
    move === "reply_write"
      ? "CREATE TRIGGER p13_cut BEFORE INSERT ON process_replies BEGIN SELECT RAISE(FAIL, 'reply cut'); END"
      : "CREATE TRIGGER p13_cut BEFORE UPDATE OF value ON process_recovery WHEN json_extract(OLD.value, '$.journal._tag')='writing_reply' AND json_extract(NEW.value, '$.journal._tag')='idle' BEGIN SELECT RAISE(FAIL, 'reply completion cut'); END";

  yield* Effect.acquireRelease(
    Effect.sync(() => db.exec(trigger)),
    () => Effect.sync(() => db.exec("DROP TRIGGER p13_cut")),
  );
  expect((yield* Effect.result(route))._tag).toBe("Failure");
  const pending = read();
  expect(pending.journal._tag).toBe("writing_reply");
  expect(pending.crashes).toBe(before.crashes);
  expect(db.prepare("SELECT value FROM process_receipts WHERE name=? AND letter=?").get(NAME, letter)).toBeUndefined();
  const reply = db.prepare("SELECT value FROM process_replies WHERE name=? AND id=?").get(NAME, letter);
  expect(reply === undefined).toBe(move === "reply_write");
  const output = Formatter.formatJson([db.prepare("SELECT value FROM process_recovery WHERE name=?").get(NAME), reply]);

  for (const form of [body, Str.slice(1, -1)(Formatter.formatJson(body)), encodeURIComponent(body)]) {
    expect(output).not.toContain(form);
  }
});

const resumedReply = Effect.fnUntraced(function* (home: string) {
  const db = yield* recovery(home);
  const saved = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(Journal))(
    db.prepare("SELECT value FROM process_recovery WHERE name=?").get(NAME)?.value,
  );

  expect(saved.journal._tag).toBe("idle");
  expect(saved.crashes).toBe(0);
});

const walk = Effect.fnUntraced(function* (tape: ReadonlyArray<number>, reached: Set<string>) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const home = yield* fs.makeTempDirectoryScoped({ prefix: "p13-wire-" });
  yield* fs.symlink(path.resolve(import.meta.dirname, "../node_modules"), path.join(home, "node_modules"));
  const file = path.join(home, "recording.ts");
  yield* fs.writeFileString(file, program);
  const built = yield* build({ out: path.join(home, "dist"), files: [], ledger: [], programs: { [PROGRAM]: file } });
  const held = yield* Effect.acquireRelease(heldPort(), (p) => p.release);
  const key = yield* SshsigTest.identity;
  const line = yield* Schema.decodeEffect(KeyLine)(key.line);

  // localInstance sets ALCHEMY_HOME, so it goes back as it was too.
  yield* scopedEnv({ FABRIKA_HOME: home }, ["ALCHEMY_HOME"]);

  const instance = yield* localInstance(
    built,
    yield* RecordWireTest.startupFixture({
      home,
      name: "p13-recording",
      person: PERSON,
      founder: line,
      window: key.raw,
      port: held.port,
    }),
  );

  const project = instance.project("p13-recording");
  const fingerprint = key.fingerprint;

  const from = {
    by: fingerprint,
    for: PERSON,
    sentAt: SENT,
    seen: 0,
    parent: null,
    traceId: TRACE,
    build: built.build,
  };

  const started = yield* invoke(() =>
    project.start(
      Start.cases.first.make({
        id: "recording-start",
        name: NAME,
        code: { program: PROGRAM, hash: built.programs[PROGRAM]!.hash },
      }),
      from,
    ),
  );
  const pid = (yield* Schema.decodeUnknownEffect(Started)(started)).process;
  const connect = Effect.fnUntraced(function* (n: number) {
    const client = yield* Schema.decodeUnknownEffect(ConnectionId)(yield* invoke(() => project.connect()));
    const nonce = yield* Schema.decodeUnknownEffect(Schema.String)(yield* invoke(() => project.challenge(client)));
    const tab = `recording-${n}`;

    const signed = yield* writeSshsig({
      text: `fabrika-hello\n${instance.url}\n${tab}\n${nonce}`,
      line,
      space: "fabrika-client",
      sign: key.sign,
    });

    const answer = yield* invoke(() =>
      project.initialize(
        client,
        {
          versions: [1, 2],
          has: ["seal"],
          ping: "30s",
          key: key.raw,
          tab,
          nonce,
          signed,
          platform: "headless",
          os: "linux",
          sentAt: SENT,
        },
        { url: instance.url, tab, name: fingerprint },
      ),
    );

    expect(answer).toMatchObject({ _tag: "online" });

    return client;
  });

  let client = yield* connect(0);
  let count = 0;
  let serial = 0;
  const accepted: Array<{ letter: string; m: typeof Metadata.Type & { body: string }; answer: unknown }> = [];
  const refused: typeof accepted = [];
  const received: Array<typeof Metadata.Type> = [];
  const bodies: Array<string> = [];

  for (const entropy of tape) {
    const choices = [
      "admit",
      "refuse",
      "audit_failed",
      "reconnect",
      ...(accepted.length === 0 ? [] : ["lost_answer", "retry"]),
      ...(refused.length === 0 ? [] : ["refused_retry", "refused_lost_answer", "reply_write", "reply_complete"]),
    ];

    const move = choices[entropy % choices.length]!;
    reached.add(move);

    if (move === "reconnect") {
      client = yield* connect(++serial);
      continue;
    }

    if (move === "retry" || move === "lost_answer" || move === "refused_retry" || move === "refused_lost_answer") {
      const history = Str.startsWith("refused_")(move) ? refused : accepted;
      const prior = history[Math.floor(entropy / choices.length) % history.length]!;

      if (move === "refused_lost_answer") {
        yield* invoke(() => instance.process(pid).abort());
        client = yield* connect(++serial);
      }

      // A previous call has already committed. Its answer may have been lost to the caller.
      expect(
        yield* invoke(() =>
          project.route(client, "process.send", { pid, letter: prior.letter, m: prior.m, sentAt: SENT, seen: 0 }),
        ),
      ).toEqual(prior.answer);
    } else {
      const body = `BODY-${entropy}-${serial} "/雪\n`;
      bodies.push(body);

      const m = {
        ...Tag.cases.save.make({}),
        note: move === "audit_failed" ? "fail" : "record",
        base: move === "refuse" || move === "reply_write" || move === "reply_complete" ? count + 1 : count,
        reason: "user-save",
        body,
      } as const;

      const letter = `wire-${++serial}`;
      const route = () =>
        invoke(() => project.route(client, "process.send", { pid, letter, m, sentAt: SENT, seen: 0 }));
      let result;

      if (move === "reply_write" || move === "reply_complete") {
        yield* Effect.scoped(pendingReply(home, move, body, letter, route()));
        yield* invoke(() => instance.process(pid).abort());
        client = yield* connect(++serial);
        result = yield* Effect.result(route());
        yield* Effect.scoped(resumedReply(home));
      } else {
        result = yield* Effect.result(route());
      }

      if (move === "audit_failed") {
        expect(result._tag).toBe("Failure");
      } else {
        expect(result).toMatchObject({ _tag: "Success", success: { _tag: "ok" } });
        received.push(Metadata.make({ note: m.note, base: m.base, reason: m.reason }));

        if (move === "admit") {
          count++;
          accepted.push({ letter, m, answer: result._tag === "Success" ? result.success : null });
        } else {
          expect(result).toMatchObject({
            _tag: "Success",
            success: { _tag: "ok", result: { _tag: "refused", reason: "changed_elsewhere", now: count } },
          });
          refused.push({ letter, m, answer: result._tag === "Success" ? result.success : null });
        }
      }
    }

    const page = yield* invoke(() => project.read("gateway/inputs", 0, "p13-check"));
    const rows = yield* Schema.decodeUnknownEffect(Schema.Array(Stored))(page);
    const selected = Arr.map(
      rows,
      (row) => Schema.decodeUnknownSync(Schema.Struct({ input: Metadata }))(row.body).input,
    );
    expect(selected).toEqual(received);
    const output = Formatter.formatJson(rows);

    for (const body of bodies) {
      for (const form of [body, Str.slice(1, -1)(Formatter.formatJson(body)), encodeURIComponent(body)]) {
        expect(output).not.toContain(form);
      }
    }
  }

  // A13 reaches the project call below the wire. An unknown type must remain a normal refusal.
  const unknown = Schema.TaggedStruct(`unknown-${count}-${serial}`, { body: Schema.String }).make({
    body: `BODY-unknown-${tape.at(-1)} "/雪\n`,
  });
  expect(
    yield* invoke(() =>
      project.route(client, "process.send", {
        pid,
        letter: `unknown-${++serial}`,
        m: unknown,
        sentAt: SENT,
        seen: 0,
      }),
    ),
  ).toMatchObject({ _tag: "ok", result: { _tag: "refused" } });
  reached.add("unknown");

  // The same client can still submit a valid input after the refusal.
  const control = { ...Tag.cases.save.make({}), note: "record", base: count, reason: "user-save", body: "control" };
  expect(
    yield* invoke(() =>
      project.route(client, "process.send", {
        pid,
        letter: `control-${++serial}`,
        m: control,
        sentAt: SENT,
        seen: 0,
      }),
    ),
  ).toMatchObject({ _tag: "ok", result: { _tag: "accepted" } });
  const rows = yield* invoke(() => project.read("gateway/inputs", 0, "p13-unknown-check"));

  for (const form of [
    unknown.body,
    Str.slice(1, -1)(Formatter.formatJson(unknown.body)),
    encodeURIComponent(unknown.body),
  ]) {
    expect(Formatter.formatJson(rows)).not.toContain(form);
  }
});

it("A13: built boxes and the real instance record selected metadata across refusal, unknown types, lost answers and reconnects", async () => {
  const reached = new Set<string>();
  await fc.assert(
    fc.asyncProperty(fc.array(fc.noBias(fc.nat()), { minLength: 20, maxLength: 28 }), (tape) =>
      Effect.runPromise(
        Effect.scoped(walk(tape, reached)).pipe(
          Effect.provide(SecureRandom.layerWebCrypto),
          Effect.provide(localState()),
          Effect.provide(NodeServices.layer),
        ),
      ),
    ),
    // Each run builds and starts a real instance, about 5 s on a busy CI machine. Shrinking a failure
    // runs hundreds more of them, so one failed run became a 600 s timeout that hid its failing check
    // (merge-group run 43571022082: 171 instance starts). The first failing tape is reported as found.
    { seed: 119120, numRuns: runsFor({ fast: 3, full: 6 }), endOnFailure: true },
  );
  expect([...reached]).toEqual(
    expect.arrayContaining([
      "admit",
      "refuse",
      "audit_failed",
      "lost_answer",
      "reconnect",
      "retry",
      "refused_retry",
      "refused_lost_answer",
      "reply_write",
      "reply_complete",
      "unknown",
    ]),
  );
}, 600_000);
