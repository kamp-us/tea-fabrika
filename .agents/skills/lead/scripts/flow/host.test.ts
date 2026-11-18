// The host step's parts, on Node in a temp folder: the brief's commands, the Electron lock, the
// time limit, what a failed command answers, and the quest's state file. Commands here are plain
// `sh` lines; no git, Electron, network or agent runs.
import { NodeServices } from "@effect/platform-node";
import {
  Array as Arr,
  Option,
  String as Str,
  pipe,
  Clock,
  Effect,
  Fiber,
  FileSystem,
  Formatter,
  Layer,
  Ref,
  Schema,
} from "effect";
import type { Scope } from "effect";
import { Digest } from "effect/crypto";

import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { repoNode } from "../boxnode.ts";
import {
  changedPaths,
  commandArgv,
  electronLock,
  host,
  hostCommands,
  hostEnv,
  lastHost,
  recordInQuest,
  runCommands,
  runners,
} from "./host.ts";
import * as Step from "./Step.ts";

const ran = <A, E>(law: Effect.Effect<A, E, NodeServices.NodeServices | Digest.Digest | Scope.Scope>) =>
  // oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: Vitest awaits the Promise a test hands back
  Effect.runPromise(law.pipe(Effect.scoped, Effect.provide(Layer.merge(NodeServices.layer, Digest.layerWebCrypto))));

const options = { seed: 119120, numRuns: 200 };

const temp = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;

  return yield* fs.makeTempDirectoryScoped({ prefix: "host-" });
});

const command = fc.stringMatching(/^[a-z][a-z0-9 ./=-]{0,40}$/).filter((c) => c === Str.trim(c));

const sha = pipe("a", Str.repeat(40));

/** The quest's state file read back: each step's name and outcome typed, and every other key kept. */
const readState = Schema.decodeUnknownEffect(
  Schema.fromJsonString(
    Schema.StructWithRest(
      Schema.Struct({
        steps: Schema.Array(
          Schema.StructWithRest(Schema.Struct({ step: Schema.String, outcome: Schema.String }), [
            Schema.Record(Schema.String, Schema.Unknown),
          ]),
        ),
      }),
      [Schema.Record(Schema.String, Schema.Unknown)],
    ),
  ),
);

const args = (commands: ReadonlyArray<string>) => ({
  main: "/nowhere/main",
  boxes: "/nowhere/boxes",
  quest: "quest",
  ticket: "7",
  branch: "fabrikalfa/quest",
  plan: "/nowhere/plan.md",
  head: sha,
  name: "quest-host3",
  commands,
  minutes: 1,
});

describe("the quest brief's host commands", () => {
  it("property: only the lines inside a fence run, in order, without blanks and comments; prose never runs", () => {
    fc.assert(
      fc.property(fc.array(command, { maxLength: 6 }), fc.array(command, { maxLength: 4 }), (inside, prose) => {
        const section = Arr.join(
          [...prose, "```sh", "# a comment", ...Arr.flatMap(inside, (c) => [c, ""]), "```", ...prose],
          "\n",
        );

        expect(hostCommands(section)).toEqual(inside);
      }),
      options,
    );
  });

  it("vector: no section, an empty one, and one with prose only name no command", () => {
    expect(hostCommands(undefined)).toEqual([]);
    expect(hostCommands("")).toEqual([]);
    expect(hostCommands("run the e2e on the host")).toEqual([]);
  });

  it("pinned: every command gets its own home and temp folder, and no foreground window or paid key", () => {
    expect(hostEnv("/tmp/fhX")).toEqual({
      FABRIKA_HOME: "/tmp/fhX/home",
      TMPDIR: "/tmp/fhX",
      FABRIKA_FOREGROUND: undefined,
      TYPESAFE_API_KEY: undefined,
    });
  });

  it("pinned: a command's nonlogin shell keeps its prepared runtime PATH", () => {
    expect(commandArgv("node e2e.ts")).toEqual(["sh", "-c", "node e2e.ts"]);
  });

  it("vector: the repo's Node is volta.node, else engines.node, and a range or no pin is none", () =>
    ran(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;

        const node = (pkg: unknown) =>
          Effect.gen(function* () {
            const dir = yield* temp;
            yield* fs.writeFileString(`${dir}/package.json`, Formatter.formatJson(pkg));

            return yield* repoNode(dir);
          });

        expect(yield* node({ volta: { node: "26.13.0" }, engines: { node: "26.1.0" } })).toBe("26.13.0");
        expect(yield* node({ engines: { node: "26.13.0" } })).toBe("26.13.0");
        expect(yield* node({ engines: { node: ">=22" } })).toBeNull();
        expect(yield* node({ name: "x" })).toBeNull();
        expect(yield* repoNode(yield* temp)).toBeNull();
      }),
    ));

  it("vector: git status -z gives one path per changed file", () => {
    expect(changedPaths(" M a/b.png\0?? docs/c d.png\0 D old.png\0")).toEqual(["a/b.png", "docs/c d.png", "old.png"]);
    expect(changedPaths("")).toEqual([]);
  });
});

describe("the host step's outcomes", () => {
  it("scenario: an explicit pin keeps direct and nested pnpm on that Node, even when the manifest differs", () =>
    ran(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const dir = yield* temp;
        const pin = process.versions.node;

        for (const folder of ["current", "native", "shim", "old"]) {
          yield* fs.makeDirectory(`${dir}/${folder}`);
        }

        yield* fs.symlink(process.execPath, `${dir}/current/node`);
        yield* fs.writeFileString(`${dir}/package.json`, JSON.stringify({ volta: { node: "0.0.0" } }));

        const scripts = {
          "native/pnpm": '#!/bin/sh\nif [ "$1" = exec ]; then shift; fi\nexec "$@"\n',
          "old/node": "#!/bin/sh\nprintf 'v0.0.0\\n'\n",
          "shim/pnpm": `#!/bin/sh
base=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
PATH="$base/old:$PATH"
export PATH
exec "$base/native/pnpm" "$@"
`,
          "shim/volta": `#!/bin/sh
base=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
if [ "$1" = which ]; then printf '%s\\n' "$base/native/pnpm"; exit; fi
shift
shift
pin=$1
shift
printf '%s\\n' "$pin" >> "$base/discovery"
if [ "$1" = node ]; then printf '%s\\nv%s\\n' "$base/current/node" "$pin"; exit; fi
PATH="$base/current:$PATH"
export PATH
exec "$@"
`,
        };

        for (const [name, text] of Object.entries(scripts)) {
          yield* fs.writeFileString(`${dir}/${name}`, text);
          yield* fs.chmod(`${dir}/${name}`, 0o755);
        }

        yield* Effect.acquireRelease(
          Effect.sync(() => {
            const before = { PATH: process.env.PATH, HOST_RUNTIME_REMOVE: process.env.HOST_RUNTIME_REMOVE };
            process.env.PATH = `${dir}/shim:${before.PATH ?? ""}`;
            process.env.HOST_RUNTIME_REMOVE = "fixture parent";

            return before;
          }),
          (before) =>
            Effect.sync(() => {
              for (const [key, value] of Object.entries(before)) {
                if (value === undefined) {
                  delete process.env[key];
                } else {
                  process.env[key] = value;
                }
              }
            }),
        );
        const log = `${dir}/log`;
        const probe = "node --version; pnpm exec node --version; pnpm exec sh -c 'pnpm exec node --version'";
        const env = { ...hostEnv(dir), HOST_RUNTIME_REMOVE: undefined, HOST_RUNTIME_KEEP: "fixture child" };

        const result = yield* runCommands(
          dir,
          [
            probe,
            `node -e 'console.log(JSON.stringify({keep:process.env.HOST_RUNTIME_KEEP,removed:process.env.HOST_RUNTIME_REMOVE===undefined,home:process.env.FABRIKA_HOME,tmp:process.env.TMPDIR,foreground:process.env.FABRIKA_FOREGROUND===undefined,paid:process.env.TYPESAFE_API_KEY===undefined}))'`,
          ],
          env,
          log,
          1,
          pin,
        );

        expect(result).toBeNull();
        const text = yield* fs.readFileString(log);
        // The fake old node reports 0.0.0; only the current-node symlink runs the real runtime.
        expect(text.split("\n").filter((line) => /^v\d/.test(line))).toEqual(Array(3).fill(`v${pin}`));
        expect(yield* fs.readFileString(`${dir}/discovery`)).toBe(`${pin}\n`);
        const output = text.split("\n").find((line) => line.startsWith("{"));
        expect(output).toBe(
          JSON.stringify({
            keep: "fixture child",
            removed: true,
            home: `${dir}/home`,
            tmp: dir,
            foreground: true,
            paid: true,
          }),
        );
      }),
    ));

  it("scenario: a quest brief with no host section is a skip that touches nothing, since most quests have no window", () =>
    ran(
      Effect.gen(function* () {
        const hosted = yield* host(args([]));
        expect(hosted).toEqual({ outcome: expect.objectContaining({ _tag: "skip" }), head: sha, log: null });
      }),
    ));

  it("scenario: the flow runner's host step answers skip for no commands, and refuses args that do not parse", () =>
    ran(
      Effect.gen(function* () {
        const runner = runners.host ?? (() => Effect.die("no host runner"));
        const answer = yield* runner(Step.act("host", args([])));
        expect(answer.outcome._tag).toBe("skip");
        const failed = yield* runner(Step.act("host", { ...args([]), head: "HEAD" })).pipe(Effect.flip);
        expect(failed.reason).toContain("args do not parse");
      }),
    ));

  // Plant: read only `quest`, so a flow saved before decision 0546 no longer runs its host step.
  it("scenario: args a flow saved before decision 0546, with the quest under `lane`, still parse", () =>
    ran(
      Effect.gen(function* () {
        const runner = runners.host ?? (() => Effect.die("no host runner"));
        const { quest, ...rest } = args([]);
        const answer = yield* runner(Step.act("host", { ...rest, lane: quest }));
        expect(answer.outcome._tag).toBe("skip");
      }),
    ));

  it("property: the first command that exits non-zero sends the quest to build with its last lines, and no later command runs", () =>
    fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 125 }), fc.stringMatching(/^[a-z]{4,12}$/), (code, said) =>
        ran(
          Effect.gen(function* () {
            const dir = yield* temp;
            const log = `${dir}/log`;
            const outcome = yield* runCommands(dir, ["true", `echo ${said}; exit ${code}`, "touch later"], {}, log, 1);
            expect(outcome).toMatchObject({ _tag: "send", to: "build" });
            expect(outcome?.reason).toContain(`exited ${code}`);
            expect(outcome?.reason).toContain(said);
            const fs = yield* FileSystem.FileSystem;
            expect(yield* fs.exists(`${dir}/later`)).toBe(false);
          }),
        ),
      ),
      { ...options, numRuns: 10 },
    ));

  it("scenario: every command exits 0, in the folder, with the host env, and the answer is null", () =>
    ran(
      Effect.gen(function* () {
        const dir = yield* temp;

        const outcome = yield* runCommands(
          dir,
          ['printf "%s|" "$FABRIKA_HOME" > env.txt; env | grep -c "^FABRIKA_FOREGROUND=" >> env.txt || true'],
          hostEnv(dir),
          `${dir}/log`,
          1,
        );

        expect(outcome).toBeNull();
        const fs = yield* FileSystem.FileSystem;
        expect(yield* fs.readFileString(`${dir}/env.txt`)).toBe(`${dir}/home|0\n`);
      }),
    ));

  it("scenario: a command past its time limit is stopped and sends the quest to build, since a hung app must not hold the lock", () =>
    ran(
      Effect.gen(function* () {
        const dir = yield* temp;
        const started = yield* Clock.currentTimeMillis;
        // 0.002 minutes is 120 ms.
        const outcome = yield* runCommands(dir, ["echo begun; sleep 30"], {}, `${dir}/log`, 0.002);
        expect((yield* Clock.currentTimeMillis) - started).toBeLessThan(10_000);
        expect(outcome).toMatchObject({ _tag: "send", to: "build" });
        expect(outcome?.reason).toContain("0.002-minute limit");
        expect(outcome?.reason).toContain("begun");
      }),
    ));

  it("scenario: stalled runtime discovery shares the first command's deadline and is reaped before returning", () =>
    ran(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const dir = yield* temp;
        yield* fs.writeFileString(`${dir}/volta`, '#!/bin/sh\nprintf "%s\\n" "$$" > discovery-pid\nexec sleep 30\n');
        yield* fs.chmod(`${dir}/volta`, 0o755);
        yield* Effect.acquireRelease(
          Effect.sync(() => {
            const before = process.env.PATH;
            process.env.PATH = `${dir}:${before ?? ""}`;

            return before;
          }),
          (before) =>
            Effect.sync(() => {
              if (before === undefined) {
                delete process.env.PATH;
              } else {
                process.env.PATH = before;
              }
            }),
        );
        const started = Date.now();

        // Same 120 ms command budget, 30 s stand-in and cleanup bound as the timeout law above.
        const outcome = yield* runCommands(
          dir,
          ["touch ran", "touch later"],
          {},
          `${dir}/log`,
          0.002,
          process.versions.node,
        );

        expect(Date.now() - started).toBeLessThan(10_000);
        expect(outcome).toMatchObject({ _tag: "send", to: "build" });
        expect(outcome?.reason).toContain("0.002-minute limit");
        expect(yield* fs.exists(`${dir}/ran`)).toBe(false);
        expect(yield* fs.exists(`${dir}/later`)).toBe(false);
        const pid = Number((yield* fs.readFileString(`${dir}/discovery-pid`)).trim());
        expect(Number.isInteger(pid) && pid > 0).toBe(true);
        expect(() => process.kill(pid, 0)).toThrow(/ESRCH/);
      }),
    ));
});

describe("one Electron app at a time", () => {
  it("scenario: a live holder's lock is waited on, not failed, and taken when it goes; the scope gives it back", () =>
    ran(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const lock = `${yield* temp}/electron.lock`;
        // This test's own pid: a live process that holds the lock.
        yield* fs.writeFileString(lock, String(process.pid));
        const taken = yield* Ref.make(false);

        const fiber = yield* Effect.forkChild(
          Effect.scoped(
            Effect.gen(function* () {
              yield* electronLock(lock, "10 millis");
              yield* Ref.set(taken, true);

              return yield* fs.readFileString(lock);
            }),
          ),
        );

        yield* Effect.sleep("100 millis");
        expect(yield* Ref.get(taken)).toBe(false);
        yield* fs.remove(lock);
        const held = yield* Fiber.join(fiber);
        expect(held).toBe(String(process.pid));
        expect(yield* Ref.get(taken)).toBe(true);
        expect(yield* fs.exists(lock)).toBe(false);
      }),
    ));

  it("scenario: a dead holder's lock is taken over at once", () =>
    ran(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const lock = `${yield* temp}/electron.lock`;
        // Above any pid macOS hands out (99998), so no process holds it.
        yield* fs.writeFileString(lock, "2000000000");

        const held = yield* Effect.scoped(
          electronLock(lock, "1 hour").pipe(Effect.andThen(fs.readFileString(lock)), Effect.timeoutOption("5 seconds")),
        );

        expect(held).toEqual(Option.some(String(process.pid)));
      }),
    ));
});

describe("the quest's state file", () => {
  it("scenario: a host entry joins drive's steps, keeps their fields, and moves the head only on done", () =>
    ran(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const boxes = yield* temp;
        yield* fs.makeDirectory(`${boxes}/state`);
        const state = `${boxes}/state/quest.json`;

        const before = {
          quest: "quest",
          ticket: "7",
          head: sha,
          steps: [{ step: "build", outcome: "done", head: sha }],
        };

        yield* fs.writeFileString(state, Formatter.formatJson(before));
        const at = { boxes, quest: "quest", name: "quest-host3", head: sha };
        const sent = { _tag: "send", to: "build", reason: "red" } as const;
        yield* recordInQuest(at, { outcome: sent, head: sha, log: "x.log" }, "t1");
        const done = { _tag: "done", reason: "ok" } as const;
        yield* recordInQuest(at, { outcome: done, head: pipe("b", Str.repeat(40)), log: "y.log" }, "t2");
        const after = yield* readState(yield* fs.readFileString(state));
        expect(after.ticket).toBe("7");
        expect(after.head).toBe(pipe("b", Str.repeat(40)));
        expect(Arr.map(after.steps, (e: { step: string; outcome: string }) => `${e.step} ${e.outcome}`)).toEqual([
          "build done",
          "host send:build:host_failed",
          "host done",
        ]);
        expect(after.steps[1]).toMatchObject({ head: sha, report: "x.log", box: "quest-host3", ended: "t1" });
        // A review is told the last host entry, read back from the file as written.
        expect(lastHost(after.steps)).toBe(`done at ${pipe("b", Str.repeat(40))}: ok`);
        expect(lastHost(before.steps)).toBeNull();
      }),
    ));

  // Plants: keep the old `lane` key beside `quest`; start the file over when it says `lane`.
  it("scenario: a state file drive wrote before decision 0546 names the quest `lane`; the host entry joins it, and the file then says `quest`", () =>
    ran(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const boxes = yield* temp;
        yield* fs.makeDirectory(`${boxes}/state`);
        const state = `${boxes}/state/t9.json`;

        const before = {
          lane: "t9",
          ticket: "9",
          plan: "/nowhere/t9-PLAN.md",
          branch: "fabrikalfa/t9",
          root: sha,
          head: sha,
          steps: [{ step: "build", box: "t9-build1", outcome: "done", head: sha }],
        };

        yield* fs.writeFileString(state, `${Formatter.formatJson(before, { space: "\t" })}\n`);
        const done = { _tag: "done", reason: "ok" } as const;
        yield* recordInQuest(
          { boxes, quest: "t9", name: "t9-host1", head: sha },
          { outcome: done, head: sha, log: null },
          "t1",
        );
        const after = yield* readState(yield* fs.readFileString(state));
        expect(after).toMatchObject({
          quest: "t9",
          ticket: "9",
          plan: before.plan,
          branch: before.branch,
          root: sha,
          head: sha,
        });
        expect(after).not.toHaveProperty("lane");
        expect(Arr.map(after.steps, (e: { step: string }) => e.step)).toEqual(["build", "host"]);
      }),
    ));
});
