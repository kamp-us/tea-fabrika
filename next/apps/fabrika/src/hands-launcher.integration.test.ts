// P39 slice 4b, next/: the real hands launcher end to end, E2 and S2. Host-only under 0045 and 0536:
// a real local instance on workerd, a real hands process, a real git and a real SIGTERM. It runs only
// in CI's full run, in its container, never on a laptop.
//
// What these laws hold `next/apps/fabrika/hands.ts` to, from the approved plan
// (docs/plan/lanes/p39-s5-PLAN.md, "The launcher" and "One value traced through"):
// - `node hands.ts` takes its home from `FABRIKA_HOME`, keeps its key in `hands/key.json` and its
//   journal in `hands/journal.sqlite`, reads `instance.port` as `dev.ts` does, and prints one JSON
//   line per change a parent needs: `waiting { fingerprint, code, until }` while its key is not
//   granted, `online { fingerprint }`, `offline { fingerprint }`.
// - Once a person key grants it as `hands`, a `git_version` task asked of its key ends `finished`
//   with `exited` code 0. After a SIGTERM and a new start, the fingerprint is the same and the task
//   is not run again.
// - S2: the key's private half (`jwk.d`) appears in no stdout or stderr line, no journal row, and
//   no row the brain stored (its `job:` and `target:` rows, and what it kept of each hello and
//   knock the client wrote). The hands have no span sink at the brain yet (the plan's Records), so
//   no span reaches a place this law can read. This is the end-to-end supplement: the property over
//   generated flows, which scans every frame as sent, every span, log line and error, is
//   `next/packages/libfabrika/src/node/client/HandsSecrets.laws.test.ts`.
//
// The key's public half is read from the key file the launcher made, to grant it, as the person's
// approve screen will read it from the knock. The brain is `hands-launcher.test-support.ts`.
//
// Plants, each run once and undone (recorded in the tests step's field row): E2, open a fresh key
// file on every start. S2, print the stored JWK in the `online` line.
import { createHash, generateKeyPairSync, sign } from "node:crypto"; // edge: Node crypto makes the test person's key; it never touches a file or an account
import { DatabaseSync } from "node:sqlite"; // edge: S2 reads the journal file's rows as stored, below any layer of ours
import { NodeServices } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import { grantText } from "@kampus/libfabrika/access/Text";
import { build } from "@kampus/libfabrika/build";
import { Task } from "@kampus/libfabrika/tasks/Task";
import { runsFor } from "@kampus/vitest";
import { Effect, FileSystem, Option, Path, Queue, Schema, Stream } from "effect";
import { SecureRandom } from "effect/crypto";
import { ChildProcess } from "effect/process";
import * as fc from "fast-check";
import { PROCESS, TASK, type Project as LauncherProject } from "./hands-launcher.test-support.ts";
import { localInstance } from "./local-instance.ts";
import { heldPort } from "./port.test-support.ts";
import * as RecordWireTest from "./record-wire.test-support.ts";
import { programs } from "./table.ts";

const PERSON = "person_01m6v5270hf3c8x2q7w9z4k5mn";
const SENT = "2026-11-15T10:00:00.000Z";
const NAME = "hands-launcher";

/** The launcher's stdout protocol, as the plan writes it. */
const Line = Schema.TaggedUnion({
  waiting: { fingerprint: Schema.String, code: Schema.String, until: Schema.Number },
  online: { fingerprint: Schema.String },
  offline: { fingerprint: Schema.String },
});
type Line = typeof Line.Type;
const decodeLine = Schema.decodeUnknownOption(Schema.fromJsonString(Line));

/** The key file the plan stores: WebCrypto's JWK, its private half `d` and its public half `x`. */
const Stored = Schema.fromJsonString(
  Schema.Struct({ jwk: Schema.Struct({ kty: Schema.String, crv: Schema.String, d: Schema.String, x: Schema.String }) }),
);

const field = (v: string | Uint8Array) => {
  const b = Buffer.from(v);
  const n = Buffer.alloc(4);
  n.writeUInt32BE(b.length);
  return Buffer.concat([n, b]);
};

/** The test person's key: a generated Ed25519 pair, as `tasks-wire.integration.test.ts` makes it. */
const person = () => {
  const pair = generateKeyPairSync("ed25519");
  const raw = pair.publicKey.export({ format: "jwk" }).x ?? "";
  const bytes = Buffer.from(raw, "base64url"),
    blob = Buffer.concat([field("ssh-ed25519"), field(bytes)]);
  return {
    raw,
    line: `ssh-ed25519 ${blob.toString("base64")}`,
    fingerprint: `SHA256:${createHash("sha256").update(bytes).digest("base64").replace(/=+$/, "")}`,
    sign: (value: string) => {
      const body = Buffer.concat([
        Buffer.from("SSHSIG"),
        field("fabrika-client"),
        field(""),
        field("sha512"),
        field(createHash("sha512").update(value).digest()),
      ]);
      const version = Buffer.alloc(4);
      version.writeUInt32BE(1);
      const packed = Buffer.concat([
        Buffer.from("SSHSIG"),
        version,
        field(blob),
        field("fabrika-client"),
        field(""),
        field("sha512"),
        field(Buffer.concat([field("ssh-ed25519"), field(sign(null, body, pair.privateKey))])),
      ]);
      return `-----BEGIN SSH SIGNATURE-----\n${packed
        .toString("base64")
        .match(/.{1,70}/g)
        ?.join("\n")}\n-----END SSH SIGNATURE-----\n`;
    },
  };
};

const keyFingerprint = (x: string) =>
  `SHA256:${createHash("sha256").update(Buffer.from(x, "base64url")).digest("base64").replace(/=+$/, "")}`;

/** A call on the brain's own local handle, by its method name on the fixture's Project. */
const method = (project: object, name: keyof LauncherProject) => Reflect.get(project, name);

const call = <A>(label: string, invoke: () => Promise<A>) =>
  Effect.tryPromise({ try: invoke, catch: (cause: unknown) => new Error(label, { cause }) });

/** What one launch of the flow saw: every line, the key's two halves, the task, and every stored row. */
type Seen = {
  readonly lines: Array<string>;
  readonly stderr: Array<string>;
  readonly d: string;
  readonly fingerprints: ReadonlyArray<string>;
  readonly task: typeof Task.Type;
  readonly taskAfterRestart: typeof Task.Type;
  readonly journal: Record<string, unknown>;
  readonly brain: unknown;
};

/** One hands process: its parsed lines, in order, and its raw stdout and stderr text. */
const launcher = Effect.fnUntraced(function* (
  script: string,
  cwd: string,
  home: string,
  all: Seen["lines"],
  errors: Seen["stderr"],
) {
  const lines = yield* Queue.unbounded<Line>();
  const handle = yield* ChildProcess.make(process.execPath, [script], {
    cwd,
    extendEnv: false,
    env: { FABRIKA_HOME: home, HOME: home, PATH: process.env.PATH ?? "" },
  });
  yield* handle.stdout.pipe(
    Stream.decodeText(),
    Stream.splitLines,
    Stream.runForEach((text) =>
      Effect.gen(function* () {
        all.push(text);
        const line = decodeLine(text);

        if (Option.isSome(line)) {
          yield* Queue.offer(lines, line.value);
        }
      }),
    ),
    Effect.forkScoped,
  );
  yield* handle.stderr.pipe(
    Stream.decodeText(),
    Stream.runForEach((text) => Effect.sync(() => errors.push(text))),
    Effect.forkScoped,
  );
  const next = <T extends Line["_tag"]>(tag: T) =>
    Effect.gen(function* () {
      const tagged = (line: Line): line is Extract<Line, { readonly _tag: T }> => line._tag === tag;

      while (true) {
        const line = yield* Queue.take(lines);

        if (tagged(line)) {
          return line;
        }
      }
    }).pipe(Effect.timeout("60 seconds"));
  return { handle, next };
});

const flow = Effect.fnUntraced(
  function* () {
    const fs = yield* FileSystem.FileSystem,
      path = yield* Path.Path;
    const home = yield* fs.makeTempDirectoryScoped({ prefix: "hands-launcher-" });
    const hands = path.join(home, "hands-home");
    yield* fs.makeDirectory(hands);
    const port = yield* Effect.acquireRelease(heldPort(), (held) => held.release);
    const root = person();
    const app = path.resolve(import.meta.dirname, "..");
    const entry = path.join(home, "hands-entry.ts");
    yield* fs.symlink(path.join(app, "node_modules"), path.join(home, "node_modules"));
    yield* fs.writeFileString(
      entry,
      [
        `export { default, Connection, Process, RecordPart, IsolateTail, Control } from ${JSON.stringify(path.join(app, "src/brain.ts"))};`,
        `export { Project } from ${JSON.stringify(path.join(app, "src/hands-launcher.test-support.ts"))};`,
      ].join("\n"),
    );
    const built = yield* build({
      out: path.join(home, "dist"),
      root: path.resolve(app, "../../.."),
      entry,
      programs,
      chaos: false,
      files: [],
    });
    const oldHome = process.env.ALCHEMY_HOME;
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        if (oldHome === undefined) {
          delete process.env.ALCHEMY_HOME;
        } else {
          process.env.ALCHEMY_HOME = oldHome;
        }
      }),
    );
    const running = yield* localInstance(
      built,
      RecordWireTest.startupFixture({
        home,
        name: NAME,
        person: PERSON,
        founder: root.line,
        window: root.raw,
        port: port.port,
      }),
    );
    const url = `http://127.0.0.1:${port.port}`;
    const project = running.project(NAME);
    // The task's requester is a started name: a finish wakes it (P39 slice 3).
    yield* call("requester start failed", () =>
      Reflect.get(project, "start")(
        {
          _tag: "first",
          id: "start-wire",
          name: "wire:1",
          code: { program: "fabrika/counter", hash: built.programs["fabrika/counter"]?.hash ?? "missing" },
        },
        {
          by: root.fingerprint,
          for: PERSON,
          sentAt: SENT,
          seen: 0,
          parent: null,
          traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
          build: built.build,
        },
      ),
    );
    // The launcher's home: a fresh FABRIKA_HOME whose person file names the instance's port.
    yield* fs.writeFileString(path.join(hands, "fabrika.toml"), `[instance]\nport = ${port.port}\n`);
    const script = path.join(app, "hands.ts");
    const lines: Seen["lines"] = [],
      stderr: Seen["stderr"] = [];

    // First start: the key is made, the knock waits for a person.
    const first = yield* Effect.scoped(
      Effect.gen(function* () {
        const one = yield* launcher(script, app, hands, lines, stderr);
        const waiting = yield* one.next("waiting");
        expect(waiting._tag).toBe("waiting");
        const stored = Schema.decodeUnknownSync(Stored)(
          yield* fs.readFileString(path.join(hands, "hands", "key.json")),
        );
        expect(keyFingerprint(stored.jwk.x), "E2: the waiting line names the key file's own key").toBe(
          waiting.fingerprint,
        );
        const value = grantText({
          id: "grant-hands",
          key: stored.jwk.x,
          for: PERSON,
          to: NAME,
          as: "hands",
          sentAt: SENT,
          saw: {
            label: "hands",
            location: "test",
            code: waiting.code,
            method: "command",
            check: "touch",
            has: ["git"],
          },
        });
        const reply = yield* call("grant failed", () =>
          fetch(`${url}/grant`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ text: value, armored: root.sign(value) }),
          }),
        );
        expect(reply.ok, "E2: the person key's grant is accepted").toBe(true);
        const online = yield* one.next("online");
        expect(online.fingerprint, "E2: online is the same key").toBe(waiting.fingerprint);
        yield* call("task request failed", () => method(project, "requestHandsTask")(waiting.fingerprint));
        let task = Schema.decodeUnknownSync(Task)(
          yield* call("task read failed", () => method(project, "readHandsTask")()),
        );

        for (let i = 0; i < 120 && task.state._tag !== "finished"; i++) {
          yield* Effect.sleep("500 millis");
          task = Schema.decodeUnknownSync(Task)(
            yield* call("task read failed", () => method(project, "readHandsTask")()),
          );
        }

        // A SIGTERM, as launchd stops a job; the scope's close then reaps it.
        yield* one.handle.kill({ killSignal: "SIGTERM" });
        yield* one.handle.exitCode.pipe(Effect.ignore);
        return { fingerprint: waiting.fingerprint, d: stored.jwk.d, task };
      }),
    );

    // Second start, over the same home: the same key, already granted, and nothing run again.
    const second = yield* Effect.scoped(
      Effect.gen(function* () {
        const two = yield* launcher(script, app, hands, lines, stderr);
        const online = yield* two.next("online");
        // Time for a client that would take or run the task again to do so.
        yield* Effect.sleep("5 seconds");
        const task = Schema.decodeUnknownSync(Task)(
          yield* call("task read failed", () => method(project, "readHandsTask")()),
        );
        yield* two.handle.kill({ killSignal: "SIGTERM" });
        yield* two.handle.exitCode.pipe(Effect.ignore);
        return { fingerprint: online.fingerprint, task };
      }),
    );

    const db = new DatabaseSync(path.join(hands, "hands", "journal.sqlite"), { readOnly: true });
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all()
      .map((row) => String(row["name"]));
    const journal = Object.fromEntries(
      tables.map((t) => [t, db.prepare(`SELECT * FROM "${t.replace(/"/g, '""')}"`).all()]),
    );
    db.close();
    const brain: unknown = yield* call("rows read failed", () => method(project, "allRows")());
    return {
      lines,
      stderr,
      d: first.d,
      fingerprints: [first.fingerprint, second.fingerprint],
      task: first.task,
      taskAfterRestart: second.task,
      journal,
      brain,
    } satisfies Seen;
  },
  Effect.scoped,
  Effect.provide(SecureRandom.layerWebCrypto),
  Effect.provide(NodeServices.layer),
);

describe("P39 slice 4b: the hands launcher end to end", () => {
  it.live(
    "E2 scenario: the real launcher, as its own process with a fresh FABRIKA_HOME, against a real local instance, prints waiting, then online once a person key grants it as hands; a git_version task ends finished with exited code 0; after a SIGTERM and a new start the fingerprint is the same and the task is not run again",
    () =>
      Effect.gen(function* () {
        const seen = yield* flow();
        expect(seen.task.state._tag, `E2: the task ends finished: ${JSON.stringify(seen.task.state)}`).toBe("finished");
        const result = seen.task.state._tag === "finished" ? seen.task.state.result : null;
        expect(result?._tag, "E2: real git exits").toBe("exited");
        expect(result?._tag === "exited" ? result.code : null, "E2: with code 0").toBe(0);
        expect(result?._tag === "exited" && result.version.startsWith("git version "), "E2: its version line").toBe(
          true,
        );
        const [first, second] = seen.fingerprints;
        expect(second, "E2: a new start keeps the same key").toBe(first);
        expect(seen.taskAfterRestart, "E2: the restart runs nothing again").toEqual(seen.task);
        expect(
          seen.task.events.map((e) => e.event),
          "E2: the task was taken, started and finished once",
        ).toEqual(["requested", "taken", "started", "finished"]);
        expect(seen.task.state._tag === "finished" && seen.task.state.request.id).toBe(TASK);
        expect(seen.task.state._tag === "finished" && seen.task.state.request.process).toBe(PROCESS);
      }),
    600_000,
  );

  it.live(
    "S2: [secrets] the key's private half appears in no stdout line, no journal row, and no row the brain stored, across generated launches",
    () =>
      Effect.tryPromise({
        try: () =>
          fc.assert(
            fc.asyncProperty(fc.constantFrom("first", "second", "third"), (launch) =>
              Effect.runPromise(
                Effect.gen(function* () {
                  const seen = yield* flow();
                  const secret = Buffer.from(seen.d, "base64url");
                  // Every form the private half could be written in.
                  const forms = [
                    seen.d,
                    secret.toString("base64"),
                    secret.toString("base64").replace(/=+$/, ""),
                    secret.toString("base64url"),
                    secret.toString("hex"),
                    encodeURIComponent(seen.d),
                  ];
                  const outputs: Record<string, unknown> = {
                    stdout: seen.lines,
                    stderr: seen.stderr,
                    journal: seen.journal,
                    brain: seen.brain,
                    task: seen.task,
                  };
                  expect(seen.lines.length, `S2 (${launch}): the scan read real lines`).toBeGreaterThan(0);

                  for (const [name, value] of Object.entries(outputs)) {
                    const text = JSON.stringify(value, (_k, v: unknown) => (typeof v === "bigint" ? String(v) : v));

                    for (const form of forms) {
                      expect(text.includes(form), `S2: [secrets] the private half is not in ${name}`).toBe(false);
                    }
                  }
                }),
              ),
            ),
            { seed: 119120, numRuns: runsFor({ fast: 1, full: 3 }), includeErrorInReport: true },
          ),
        catch: (cause) => new Error("S2 failed", { cause }),
      }),
    1_800_000,
  );
});
