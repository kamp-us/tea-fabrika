// RedactFs.layer: the Redact service on the disk and a child process, redact.sh's rules ported
// exact. Secrets and the child's environment come from the `env` given, never from the parent's.
//
// A run, in order:
//   1. the receipt `<events>.redacted` goes, and the two output folders are made
//   2. the Lock is held for the run's folder (its real path's sha256), so two runs in one folder
//      never hold the `.npmrc` swap at once
//   3. the project's `.npmrc` moves aside to `.npmrc.redact-backup` beside it (never into the temp
//      folder, so a failed restore never deletes it) and a blank one takes its place; the user and
//      global npm configs point at blank files in a temp folder
//   4. the child runs in the folder, with `env` less every secret name and with nothing added from
//      the parent, fed the prompt, its stdout and stderr written to the events file
//   5. both saved files are scrubbed BEFORE the config goes back: a restore that fails must not
//      leave secrets in either output. A scrub that fails removes both files and writes no receipt
//   6. the config goes back; a failed restore says where the original is and keeps it there
//
// A signal or an interrupt stops only the child's wait: closing its scope ends the child, and steps
// 5 and 6 still run. A file that cannot be scrubbed is never released.

import { constants } from "node:os"; // edge: Effect has no table of the system's signal numbers, which a signal's exit code needs
import { Console, Effect, Exit, FileSystem, Layer, Option, Path, type PlatformError, Predicate, Stream } from "effect";
import { Digest } from "effect/crypto";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import { Lock } from "../sys/Lock.ts";
import { type Ask, type Files, type Ran, Redact, SECRET_NAME, scrub, secretValues } from "./Redact.ts";

/** The exit code a run reports when its wait was interrupted; the process's own end reports the signal. */
const INTERRUPTED = 130;

const fatal = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
const encoder = new TextEncoder();

/** How many bytes the UTF-8 sequence at `i` takes, or 0 when the byte there starts no valid one. */
const sequence = (bytes: Uint8Array, i: number): number => {
  const first = bytes[i] ?? 0;

  if (first < 0x80) {
    return 1;
  }

  const [length, low, high] =
    first >= 0xc2 && first <= 0xdf
      ? [2, 0x80, 0xbf]
      : first === 0xe0
        ? [3, 0xa0, 0xbf]
        : first === 0xed
          ? [3, 0x80, 0x9f]
          : first >= 0xe1 && first <= 0xef
            ? [3, 0x80, 0xbf]
            : first === 0xf0
              ? [4, 0x90, 0xbf]
              : first >= 0xf1 && first <= 0xf3
                ? [4, 0x80, 0xbf]
                : first === 0xf4
                  ? [4, 0x80, 0x8f]
                  : [0, 0, 0];

  if (length === 0 || i + length > bytes.length) {
    return 0;
  }

  const second = bytes[i + 1] ?? 0;

  if (second < low || second > high) {
    return 0;
  }

  for (let k = i + 2; k < i + length; k++) {
    const next = bytes[k] ?? 0;

    if (next < 0x80 || next > 0xbf) {
      return 0;
    }
  }

  return length;
};

/**
 * Saved bytes as text, as Python's `surrogateescape` reads them: valid UTF-8 as itself, and each
 * byte that is not as one of U+DC80 to U+DCFF, so `toBytes` gives every byte back unchanged.
 */
const fromBytes = (bytes: Uint8Array): string => {
  const parts: Array<string> = [];
  let run = 0;

  for (let i = 0; i < bytes.length;) {
    const length = sequence(bytes, i);

    if (length > 0) {
      i += length;
      continue;
    }

    parts.push(fatal.decode(bytes.subarray(run, i)), String.fromCharCode(0xdc00 + (bytes[i] ?? 0)));
    i += 1;
    run = i;
  }

  parts.push(fatal.decode(bytes.subarray(run)));
  return parts.join("");
};

/** Text back to bytes: a lone U+DC80 to U+DCFF is the byte it stood for, everything else is UTF-8. */
const toBytes = (text: string): Uint8Array => {
  const parts: Array<Uint8Array> = [];
  let run = 0;

  for (let i = 0; i < text.length; i++) {
    const unit = text.charCodeAt(i);

    if (unit >= 0xd800 && unit <= 0xdbff && i + 1 < text.length) {
      const next = text.charCodeAt(i + 1);
      i += next >= 0xdc00 && next <= 0xdfff ? 1 : 0;
    } else if (unit >= 0xdc80 && unit <= 0xdcff) {
      parts.push(encoder.encode(text.slice(run, i)), Uint8Array.of(unit - 0xdc00));
      run = i + 1;
    }
  }

  parts.push(encoder.encode(text.slice(run)));
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;

  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }

  return out;
};

/**
 * A child's exit code, from a spawner error: 128 and the signal's number when a signal ended it, as
 * redact.sh reported it, else 1. Node's spawner says the signal only in its cause's message.
 */
const failedCode = (error: PlatformError.PlatformError): number => {
  const said = Predicate.isError(error.cause) ? error.cause.message : error.message;
  const name = /receipt of signal: '(SIG[A-Z0-9]+)'/.exec(said)?.[1];
  const number = Object.entries(constants.signals).find(([signal]) => signal === name)?.[1];
  return number === undefined ? 1 : 128 + number;
};

/** The blank npm configs a run points its child at. */
type Blank = { readonly user: string; readonly global: string };

/** `env` is the whole environment: the secrets to scrub, and the child's, less its secret names. */
export const layer = (
  env: Readonly<Record<string, string | undefined>>,
): Layer.Layer<Redact, never, FileSystem.FileSystem | Path.Path | ChildProcessSpawner.ChildProcessSpawner | Lock> =>
  Layer.effect(
    Redact,
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
      const lock = yield* Lock;
      const digest = yield* Digest.Digest;
      const secrets = secretValues(env);
      const kept = Object.fromEntries(
        Object.entries(env).flatMap(([name, value]) =>
          value === undefined || SECRET_NAME.test(name) ? [] : [[name, value] as const],
        ),
      );

      /** Scrub one file in place: the spans redacted. A file that is not there has none. */
      const scrubFile = Effect.fn("RedactFs.scrubFile")(function* (file: string) {
        if (!(yield* fs.exists(file))) {
          return 0;
        }

        const got = scrub(fromBytes(yield* fs.readFile(file)), secrets);

        if (got.count > 0) {
          yield* fs.writeFile(file, toBytes(got.text));
        }

        return got.count;
      });

      const files = Effect.fn("RedactFs.files")(function* (paths: ReadonlyArray<string>) {
        let count = 0;
        const failed: Array<string> = [];

        for (const file of paths) {
          const got = yield* Effect.option(scrubFile(file));

          if (Option.isSome(got)) {
            count += got.value;
          } else {
            // An unreadable file is removed, not skipped: the rest are still scrubbed.
            yield* fs.remove(file, { force: true }).pipe(Effect.ignore);
            yield* Console.error("redaction failed");
            failed.push(file);
          }
        }

        return { count, failed } satisfies Files;
      });

      /** The child, run to its end in `ask.cwd`: its exit code, 1 when it could not start or its output could not be saved. */
      const child = Effect.fn("RedactFs.child")(
        function* (ask: Ask, blank: Blank, events: string) {
          const [command, ...args] = ask.command;

          if (command === undefined) {
            yield* Console.error("redact: --run needs a command");
            return 1;
          }

          const handle = yield* ChildProcess.make(command, args, {
            cwd: ask.cwd,
            env: { ...kept, NPM_CONFIG_USERCONFIG: blank.user, NPM_CONFIG_GLOBALCONFIG: blank.global },
            extendEnv: false,
            stdin: fs.stream(ask.prompt),
          });
          const [, code] = yield* Effect.all(
            [
              Stream.run(handle.all, fs.sink(events)),
              handle.exitCode.pipe(
                Effect.map(Number),
                Effect.catch((error) => Effect.succeed(failedCode(error))),
              ),
            ],
            { concurrency: 2 },
          );
          return code;
        },
        Effect.scoped,
        Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
        Effect.catch(() => Console.error("redact: the command could not run").pipe(Effect.as(1))),
      );

      /** The blank configs, and the project's `.npmrc` set aside; whether it was moved, and the blanks or none. */
      const setAside = Effect.fn("RedactFs.setAside")(function* (project: string, backup: string, events: string) {
        const had = yield* fs.lstat(project).pipe(
          Effect.as(true),
          Effect.orElseSucceed(() => false),
        );
        const moved =
          had &&
          (yield* fs.rename(project, backup).pipe(
            Effect.as(true),
            Effect.orElseSucceed(() => false),
          ));
        const blank = yield* Effect.gen(function* () {
          if (had && !moved) {
            return Option.none<Blank>();
          }

          if (moved) {
            yield* fs.writeFileString(project, "");
          }

          const tmp = yield* fs.makeTempDirectoryScoped({
            prefix: "npm-isolate-",
            ...(env.TMPDIR === undefined ? {} : { directory: env.TMPDIR }),
          });
          const made = { user: path.join(tmp, "empty"), global: path.join(tmp, "global") };
          yield* fs.writeFileString(made.user, "");
          yield* fs.writeFileString(made.global, "");
          yield* fs.writeFile(events, new Uint8Array());
          return Option.some(made);
        }).pipe(Effect.orElseSucceed(() => Option.none<Blank>()));
        return { moved, blank };
      });

      /**
       * The project's `.npmrc` back from beside it, and whether it went back. A folder the run left
       * at `.npmrc` goes only when it is empty, as `rmdir` does; else the original stays beside it.
       */
      const putBack = Effect.fn("RedactFs.putBack")(
        function* (project: string, backup: string) {
          const there = yield* fs.lstat(project).pipe(Effect.option);

          if (Option.isSome(there) && there.value.type === "Directory") {
            if ((yield* fs.readDirectory(project)).length > 0) {
              return false;
            }

            yield* fs.remove(project, { recursive: true });
          } else {
            yield* fs.remove(project, { force: true });
          }

          yield* fs.rename(backup, project);
          return true;
        },
        Effect.orElseSucceed(() => false),
      );

      const run = Effect.fn("RedactFs.run")(function* (ask: Ask) {
        const answer = path.resolve(ask.answer);
        const events = path.resolve(ask.events);
        const receipt = `${events}.redacted`;
        const project = path.join(ask.cwd, ".npmrc");
        const backup = path.join(ask.cwd, ".npmrc.redact-backup");
        const prepared = yield* Effect.gen(function* () {
          yield* fs.remove(receipt, { force: true });
          yield* fs.makeDirectory(path.dirname(answer), { recursive: true });
          yield* fs.makeDirectory(path.dirname(events), { recursive: true });
          const real = yield* fs.realPath(ask.cwd).pipe(Effect.orElseSucceed(() => path.resolve(ask.cwd)));
          return `npm-isolate-${yield* digest.digestHex(Digest.sha256, encoder.encode(real))}`;
        }).pipe(Effect.option);

        if (Option.isNone(prepared)) {
          yield* Console.error("redact: the output folders could not be made");
          return { code: 1, redacted: null } satisfies Ran;
        }

        return yield* Effect.scoped(
          Effect.uninterruptibleMask((restore) =>
            Effect.gen(function* () {
              yield* restore(lock.hold(prepared.value));
              const aside = yield* setAside(project, backup, events);
              let code = 1;

              if (Option.isNone(aside.blank)) {
                yield* Console.error("redact: the npm config could not be set aside");
              } else {
                const ended = yield* Effect.exit(restore(child(ask, aside.blank.value, events)));
                code = Exit.isSuccess(ended) ? ended.value : INTERRUPTED;
              }

              // Scrub first: a restore that fails must not leave secrets in either output.
              const scrubbed = yield* Effect.gen(function* () {
                const count = (yield* scrubFile(answer)) + (yield* scrubFile(events));
                yield* fs.writeFileString(receipt, `${count}\n`);
                return count;
              }).pipe(Effect.option);

              if (Option.isNone(scrubbed)) {
                // Never release a file whose scrub could not finish.
                yield* fs.remove(answer, { force: true }).pipe(Effect.ignore);
                yield* fs.remove(events, { force: true }).pipe(Effect.ignore);
                yield* Console.error("redaction failed");
                code = code || 1;
              }

              if (aside.moved && !(yield* putBack(project, backup))) {
                yield* Console.error("config restore failed; the original is at .npmrc.redact-backup");
                code = code || 1;
              }

              return { code, redacted: Option.getOrNull(scrubbed) } satisfies Ran;
            }),
          ),
        );
      });

      return Redact.of({ files, run });
    }),
  ).pipe(Layer.provide(Digest.layerWebCrypto));
