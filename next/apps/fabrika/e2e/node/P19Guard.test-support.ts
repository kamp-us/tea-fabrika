// P19 next/. Host-only. The guard is a separate process, so worker SIGKILL cannot skip cleanup.
// The guard's own entry: the guard and the few helpers both sides share. It imports effect, the
// platform and the launchd status reader, and nothing that builds, so its bundle carries no
// compiler and starts fast (ticket 1167).
import { NodeRuntime, NodeServices } from "@effect/platform-node";
import * as LaunchdStatus from "@kampus/libfabrika/node/launchd/LaunchdStatus";
import * as ProcessGroups from "@kampus/libfabrika/node/launchd/ProcessGroups.test-support";
import {
  Array as Arr,
  Effect,
  Exit,
  FileSystem,
  Formatter,
  Path,
  Redacted,
  Result,
  Schedule,
  Schema,
  Stream,
  String as Str,
} from "effect";
import { Digest } from "effect/crypto";
import { FetchHttpClient, HttpClient } from "effect/http";
import { ChildProcess } from "effect/process";

export class HostError extends Schema.TaggedError<HostError, { readonly brand: unique symbol }>()("HostError", {
  reason: Schema.String,
  cause: Schema.optionalKey(Schema.Defect()),
}) {}

export const checked = (ok: boolean, reason: string) => (ok ? Effect.void : Effect.fail(HostError.make({ reason })));

export const command = Effect.fn("P19Host.command")(function* (executable: string, args: ReadonlyArray<string>) {
  return yield* Effect.scoped(
    Effect.gen(function* () {
      const handle = yield* ChildProcess.make(executable, args, { stdin: "ignore", stdout: "pipe", stderr: "pipe" });

      const [code, stdout, stderr] = yield* Effect.all(
        [
          handle.exitCode,
          Stream.mkString(Stream.decodeText(handle.stdout)),
          Stream.mkString(Stream.decodeText(handle.stderr)),
        ],
        { concurrency: "unbounded" },
      );

      return { code: Number(code), stdout, stderr };
    }),
  );
});

export const wait = Effect.fn("P19Host.wait")(function* <E, R>(
  condition: Effect.Effect<boolean, E, R>,
  duration: number,
) {
  yield* condition.pipe(
    Effect.repeat({ schedule: Schedule.spaced("100 millis"), until: (value) => value }),
    Effect.timeout(`${duration} millis`),
  );
});

export const alive = (pid: number) =>
  Effect.sync(() => {
    // Effect has no non-owning probe for an OS process or process group.
    const result = Result.try(() => process.kill(pid, 0));

    return (
      Result.isSuccess(result) ||
      !(result.failure instanceof Error && "code" in result.failure && result.failure.code === "ESRCH")
    );
  });

export const processes = Effect.fn("P19Host.processes")(function* () {
  const out = yield* command("ps", ["-axo", "pid=,ppid=,pgid="]);
  yield* checked(out.code === 0, "cannot-observe-processes");

  return yield* Schema.decodeUnknownEffect(Schema.Array(ProcessGroups.Row))(
    Arr.map(Arr.filter(Str.split(Str.trim(out.stdout), "\n"), Boolean), (line) => {
      const [pid, parent, group] = Arr.map(Str.split(Str.trim(line), /\s+/), Number);
      return { pid, parent, group };
    }),
  );
});

/**
 * The one place a group is signaled. The group is decoded again here: a 0 or a 1 fails the test
 * and never reaches `kill`, where -1 means every process this user owns.
 */
export const signal = Effect.fn("P19Host.signal")(function* (name: "TERM" | "KILL", group: number) {
  const owned = yield* Schema.decodeEffect(ProcessGroups.Owned)(group).pipe(
    Effect.mapError((cause) => HostError.make({ reason: "refused-group", cause: Redacted.make(cause) })),
  );

  yield* command("kill", [`-${name}`, `-${owned}`]);
});

export const Config = Schema.Struct({
  home: Schema.String,
  // One service, `gui/<uid>/<label>`. A bare domain would let `launchctl bootout` end the whole login.
  target: Schema.String.check(Schema.isPattern(/^gui\/[1-9][0-9]*\/[A-Za-z0-9][A-Za-z0-9._-]+$/u)),
  url: Schema.String,
  owner: Schema.Int,
  stopTimeout: Schema.Int,
  poll: Schema.Int,
});

export type Config = typeof Config.Type;

export const status = Effect.fn("P19Host.status")(function* (target: string) {
  const out = yield* command("launchctl", ["print", target]);

  return yield* LaunchdStatus.decode({
    target,
    code: out.code,
    stdout: Redacted.make(out.stdout),
    stderr: Redacted.make(out.stderr),
  });
});

export const listening = (url: string) =>
  HttpClient.get(url).pipe(
    Effect.as(true),
    Effect.orElseSucceed(() => false),
    Effect.provide(FetchHttpClient.layer),
  );

/** Registered before bootstrap. The parent waits for this process's ready file first. */
const guard = Effect.fn("P19Host.guard")(function* (file: string) {
  const fs = yield* FileSystem.FileSystem,
    path = yield* Path.Path;

  const config = yield* fs
    .readFileString(file)
    .pipe(Effect.flatMap(Schema.decodeUnknownEffect(Schema.fromJsonString(Config))));

  const groups = new Set<number>();

  const acquireGroups = Effect.gen(function* () {
    const loaded = yield* status(config.target);

    if (loaded._tag === "loaded" && loaded.pid !== null) {
      const rows = yield* processes();

      for (const group of ProcessGroups.descendants(rows, loaded.pid)) {
        groups.add(group);
      }

      yield* fs.writeFileString(`${config.home}/groups.json`, Formatter.formatJson([...groups]));
    }
  });

  const cleanup = Effect.gen(function* () {
    // An exact service target, then only groups observed as that service's descendants.
    yield* command("launchctl", ["bootout", config.target]);
    yield* wait(status(config.target).pipe(Effect.map((value) => value._tag === "absent")), config.stopTimeout);

    for (const group of groups) {
      if (yield* alive(-group)) {
        yield* signal("TERM", group);
      }
    }

    const gone = Effect.gen(function* () {
      for (const group of groups) {
        if (yield* alive(-group)) {
          return false;
        }
      }

      return !(yield* listening(config.url));
    });

    yield* wait(gone, config.stopTimeout).pipe(
      Effect.catch(() =>
        Effect.gen(function* () {
          for (const group of groups) {
            if (yield* alive(-group)) {
              yield* signal("KILL", group);
            }
          }
        }),
      ),
    );
    yield* wait(gone, config.stopTimeout);
    yield* fs.remove(`${config.home}/brain.plist`, { force: true });
    yield* fs.writeFileString(`${config.home}/guard.result`, Formatter.formatJson({ leftovers: [] }));
  });

  yield* Effect.acquireRelease(Effect.void, () =>
    cleanup.pipe(
      Effect.onExit((exit) =>
        Effect.gen(function* () {
          const result = Formatter.formatJson({ leftovers: Exit.isSuccess(exit) ? [] : ["cleanup-unconfirmed"] });
          yield* fs.writeFileString(`${config.home}/guard.result`, result);

          if (!(yield* alive(config.owner))) {
            const archive = path.resolve("runs/p19", `guard-${config.owner}.json`);
            yield* fs.makeDirectory(path.dirname(archive), { recursive: true });
            yield* fs.writeFileString(archive, result);

            if (Exit.isSuccess(exit)) {
              yield* fs.remove(config.home, { recursive: true });
            }
          }
        }),
      ),
      Effect.orDie,
    ),
  );
  yield* fs.writeFileString(`${config.home}/guard.ready`, "ready");
  yield* Effect.gen(function* () {
    yield* acquireGroups;

    return !(yield* alive(config.owner)) || (yield* fs.exists(`${config.home}/guard.stop`));
  }).pipe(Effect.repeat({ schedule: Schedule.spaced(`${config.poll} millis`), until: (done) => done }));
});

/**
 * The guard's ready file or its exit, whichever comes first. A guard that dies on start fails the
 * wait at once with its exit code, in place of a timeout that says nothing about why.
 */
export const ready = Effect.fn("P19Host.guardReady")(function* <E>(
  file: string,
  exit: Effect.Effect<number, E>,
  timeout: number,
) {
  const fs = yield* FileSystem.FileSystem;

  yield* Effect.raceFirst(
    wait(fs.exists(file), timeout),
    exit.pipe(Effect.flatMap((code) => Effect.fail(HostError.make({ reason: `guard-exited-${code}` })))),
  );
});

if (process.argv[2] === "p19:guard") {
  NodeRuntime.runMain(
    Effect.scoped(guard(process.argv[3] ?? "")).pipe(Effect.provide([NodeServices.layer, Digest.layerWebCrypto])),
  );
}
