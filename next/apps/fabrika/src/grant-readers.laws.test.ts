// P12, next/. The real command is captured at its NodeRuntime edge; no process or socket starts.
import { it } from "@effect/vitest";
import { grantText } from "@kampus/libfabrika/access/Text";
import { runsFor } from "@kampus/vitest";
import {
  Arbitrary,
  Cause,
  DateTime,
  Effect,
  Exit,
  Layer,
  Match,
  Option,
  Schema,
  Sink,
  Stream,
  Record as Rec,
} from "effect";
import { FetchHttpClient } from "effect/http";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import { TestClock, TestConsole } from "effect/testing";
import { expect, vi } from "vitest";

const cli = vi.hoisted(() => ({
  // SAFETY: work starts unset; the CLI mock stores the Effect it was handed.
  work: undefined as Effect.Effect<unknown, unknown> | undefined,
  // SAFETY: layer starts unset; a law sets it to the spawner layer it runs the handed work on.
  layer: undefined as Layer.Layer<ChildProcessSpawner.ChildProcessSpawner> | undefined,
}));

vi.mock("@effect/platform-node", async (original) => {
  const actual = await original<typeof import("@effect/platform-node")>();

  return {
    ...actual,
    NodeServices: {
      get layer() {
        return Layer.merge(actual.NodeServices.layer, cli.layer ?? Layer.empty);
      },
    },
    NodeRuntime: {
      runMain: (work: Effect.Effect<unknown, unknown>) => {
        cli.work = work;
      },
    },
  };
});

/** One `fetch` call as the law's stand-in saw it: the address and the options. */
type Sent = readonly [url: string, options: RequestInit | undefined];

/**
 * A stand-in for Effect's `FetchHttpClient.Fetch` reference that keeps each call it is handed, in
 * order, and answers with `answer`. The law owns the list, since `fetch` is a function reference and
 * not an Effect service the Recorder could watch.
 */
const fetches = (answer: (url: string, options: RequestInit | undefined) => Promise<Response>) => {
  const sent: Array<Sent> = [];

  const fetch: typeof globalThis.fetch = (url, options) => {
    sent.push([String(url), options]);

    return answer(String(url), options);
  };

  return { sent, fetch };
};

/** A stand-in that refuses every call, for a law that expects none. */
const refused = () => fetches(() => Promise.reject(new Error("must not fetch")));

/**
 * Runs the captured command with the law's `fetch` as the client's `fetch`, and Effect's
 * `TestConsole` as the `Console` it prints to, since grant.ts does not provide one of its own.
 * Answers the exit and every line printed with `Console.log`.
 */
const run = Effect.fnUntraced(function* (fetch: typeof globalThis.fetch) {
  // Keep the old wall-clock bounds on the grant's timestamp.
  const exit = yield* Effect.exit(
    TestClock.withLive(cli.work!).pipe(Effect.provideService(FetchHttpClient.Fetch, fetch)),
  );

  return { exit, logged: yield* TestConsole.logLines };
}, Effect.provide(TestConsole.layer));

/** What one `fetch` call puts on the wire: its method, every header, and its body as text. */
const wire = (options: RequestInit | undefined) => ({
  method: options?.method,
  // SAFETY: grant.ts runs on Effect's FetchHttpClient, which hands `fetch` the request's Headers, a plain record of strings.
  headers: { ...(options?.headers as Record<string, string> | undefined) },
  // SAFETY: grant.ts sets its body with HttpClientRequest.bodyText, which FetchHttpClient hands `fetch` as Uint8Array bytes.
  body: options?.body == null ? undefined : new TextDecoder().decode(options.body as Uint8Array),
});

const typed = (exit: Exit.Exit<unknown, unknown>, reason: string) => {
  expect(Exit.isFailure(exit)).toBe(true);
  const cause = Exit.isFailure(exit) ? exit.cause : Cause.empty;
  expect(Cause.hasDies(cause)).toBe(false);
  expect(Cause.hasFails(cause)).toBe(true);
  const error = Cause.findErrorOption(cause);
  expect(error).toMatchObject({ _tag: "Some", value: { _tag: "GrantError", reason } });
  expect(Option.getOrUndefined(error)).toBeInstanceOf(Error);
};

// fc.string's default alphabet is printable ASCII. Keep that domain when moving its runner.
const text = Schema.String.check(Schema.isPattern(/^[\x20-\x7e]*$/));

it.effect.prop(
  "grant command rejects malformed outside URLs as GrantError before fetching or signing",
  { text, broken: Schema.Literals(["http://[", "http://%", "http://[::1", "https://"]) },
  ({ text, broken }) =>
    Effect.forEach(
      ["http://[", `relative-${encodeURIComponent(text)}`, broken],
      (url) =>
        Effect.gen(function* () {
          yield* Effect.acquireRelease(
            Effect.sync(() => process.argv),
            (argv) =>
              Effect.sync(() => {
                process.argv = argv;
                cli.work = undefined;
              }),
          );
          const f = refused();
          process.argv = [
            process.execPath,
            "grant.ts",
            "client",
            url,
            "public-fingerprint",
            "--code=made-up",
            "--key=unused-key-path",
          ];

          cli.work = undefined;
          vi.resetModules();
          yield* Effect.tryPromise({
            try: () => import("../grant.ts"),
            catch: (cause: unknown) => new Error("grant import failed", { cause }),
          });
          expect(cli.work).toBeDefined();
          // Plant (run once): in grant.ts, fetch the target before parsing the URL; `sent` is not [].
          typed((yield* run(f.fetch)).exit, "bad_url");
          expect(f.sent).toEqual([]);
        }).pipe(Effect.scoped),
      { concurrency: 1, discard: true },
    ),
  { arbitrary: { size: 100, runs: runsFor({ fast: 3, full: 20 }) } },
);

const usage = "usage: grant.ts client URL KEY --code=CODE --key=PATH";

it.effect.prop(
  "grant usage guard names the error for each missing argument or flag",
  { text, missing: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 4 })) },
  ({ text, missing }) =>
    Effect.gen(function* () {
      const args = ["client", "http://127.0.0.1:18787", "public-fingerprint", `--code=${text}`, "--key=unused-path"];

      if (missing === 0) {
        args[0] = `wrong-${text}`;
      } else if (missing === 1) {
        args.splice(1, 2);
      } else {
        args.splice(missing, 1);
      }

      // Removing the URL also removes its following positional argument so the CLI cannot shift it.
      yield* Effect.acquireRelease(
        Effect.sync(() => process.argv),
        (argv) =>
          Effect.sync(() => {
            process.argv = argv;
            cli.work = undefined;
          }),
      );
      const f = refused();
      process.argv = [process.execPath, "grant.ts", ...args];

      vi.resetModules();
      yield* Effect.tryPromise({
        try: () => import("../grant.ts"),
        catch: (cause: unknown) => new Error("grant import failed", { cause }),
      });
      // Plant (run once): in grant.ts, fetch before the usage check; `sent` is not [].
      typed((yield* run(f.fetch)).exit, usage);
      expect(f.sent).toEqual([]);
    }),
  { arbitrary: { size: 100, runs: runsFor({ fast: 3, full: 25 }) } },
);

const target = Schema.Struct({
  key: text,
  for: text,
  to: text,
  code: text,
  label: text,
});

const generated = {
  fingerprint: text,
  code: text,
  label: Schema.UndefinedOr(text),
  target,
  armored: text,
  exit: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 255 })),
  badTarget: Arbitrary.schema(Schema.Json).pipe(
    Arbitrary.filter(
      (raw) =>
        raw !== null &&
        !Schema.is(
          Schema.Struct({
            key: Schema.String,
            for: Schema.String,
            to: Schema.String,
            code: Schema.String,
            label: Schema.String,
          }),
        )(raw),
    ),
    // Keep the old smallest failing JSON case while retaining every rejected JSON value.
    (invalid) => Arbitrary.array(invalid, { maxLength: 1 }),
    Arbitrary.map((values) => (values.length === 0 ? {} : values[0]!)),
  ),
  badReply: Arbitrary.schema(Schema.Json).pipe(
    Arbitrary.filter((raw) => !Schema.is(Schema.Record(Schema.String, Schema.Json))(raw)),
    (invalid) => Arbitrary.array(invalid, { maxLength: 1 }),
    Arbitrary.map((values) => (values.length === 0 ? [] : values[0]!)),
  ),
};

const results = {
  get: "unreachable",
  json: "bad_target",
  target: "bad_target",
  waiting: "not_waiting",
  sign: "sign_failed",
  post: "unreachable",
  status: "refused",
  replyJson: "bad_reply",
  reply: "bad_reply",
  refused: "refused",
  applied: null,
} as const;

// SAFETY: results is a const object literal, so its own keys are exactly its declared keys.
for (const mode of Rec.keys(results) as Array<keyof typeof results>) {
  it.effect.prop(
    `grant ${mode} path preserves the signed fields and exact error reason`,
    generated,
    (data) =>
      Effect.gen(function* () {
        yield* Effect.acquireRelease(
          Effect.sync(() => process.argv),
          (argv) =>
            Effect.sync(() => {
              process.argv = argv;
              cli.layer = undefined;
              cli.work = undefined;
            }),
        );
        const commands: Array<ChildProcess.Command> = [];
        const signed: Array<string> = [];
        cli.layer = Layer.succeed(
          ChildProcessSpawner.ChildProcessSpawner,
          ChildProcessSpawner.make((command) =>
            Effect.gen(function* () {
              commands.push(command);

              if (!ChildProcess.isStandardCommand(command) || !Stream.isStream(command.options.stdin)) {
                return yield* Effect.die("expected streamed signing input");
              }

              signed.push(yield* Stream.mkString(Stream.decodeText(command.options.stdin)));
              const stdout = Stream.make(new TextEncoder().encode(data.armored));

              return ChildProcessSpawner.makeHandle({
                pid: ChildProcessSpawner.ProcessId(27000),
                exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(mode === "sign" ? data.exit : 0)),
                isRunning: Effect.succeed(false),
                kill: () => Effect.void,
                stdin: Sink.drain,
                stdout,
                stderr: Stream.empty,
                all: stdout,
                getInputFd: () => Sink.drain,
                getOutputFd: () => Stream.empty,
                unref: Effect.succeed(Effect.void),
              });
            }),
          ),
        );

        const { sent: calls, fetch } = fetches((_url, options) => {
          if (options?.method === "POST") {
            if (mode === "post") {
              return Promise.reject(new Error("post unavailable"));
            }

            if (mode === "status") {
              return Promise.resolve(new Response("refused", { status: 403 }));
            }

            if (mode === "replyJson") {
              return Promise.resolve(new Response("{"));
            }

            return Promise.resolve(
              Response.json(mode === "reply" ? data.badReply : { _tag: mode === "refused" ? "refused" : "applied" }),
            );
          }

          if (mode === "get") {
            return Promise.reject(new Error("get unavailable"));
          }

          if (mode === "json") {
            return Promise.resolve(new Response("{"));
          }

          return Promise.resolve(
            Response.json(
              Match.value(mode).pipe(
                Match.when("target", () => data.badTarget),
                Match.when("waiting", () => null),
                Match.orElse(() => data.target),
              ),
            ),
          );
        });

        process.argv = [
          process.execPath,
          "grant.ts",
          `--code=${data.code}`,
          "--key=unused-signing-path",
          ...(data.label === undefined ? [] : [`--label=${data.label}`]),
          // A generated fingerprint may start with "-". It is a positional value, not a flag.
          "--",
          "client",
          "http://127.0.0.1:18787/ignored?q=ignored",
          data.fingerprint,
        ];

        vi.resetModules();
        yield* Effect.tryPromise({
          try: () => import("../grant.ts"),
          catch: (cause: unknown) => new Error("grant import failed", { cause }),
        });
        const before = DateTime.toEpochMillis(DateTime.nowUnsafe());
        const { exit, logged } = yield* run(fetch);
        const reason = results[mode];

        if (reason === null) {
          expect(Exit.isSuccess(exit)).toBe(true);
        } else {
          typed(exit, reason);
        }

        // The address as `fetch` itself parses the string the command builds, and nothing beside
        // it: a plain GET with no body and no header at all, so no `traceparent` and no `b3`.
        expect(calls[0]?.[0]).toBe(
          new URL(
            `http://127.0.0.1:18787/grant/client/${encodeURIComponent(data.fingerprint)}?code=${encodeURIComponent(data.code)}`,
          ).href,
        );
        expect(wire(calls[0]?.[1])).toEqual({ method: "GET", headers: {}, body: undefined });
        const signs = !["get", "json", "target", "waiting"].includes(mode);
        expect(commands).toHaveLength(signs ? 1 : 0);

        if (signs) {
          expect(commands[0]).toMatchObject({
            command: "ssh-keygen",
            args: ["-Y", "sign", "-n", "fabrika-client", "-f", "unused-signing-path"],
          });
          const text = signed[0]!;
          const change = JSON.parse(text);
          expect(change._tag).toBe("granted");
          const grant = change.grant;
          expect(grant).toEqual({
            id: expect.stringMatching(/^[0-9a-f-]{36}$/),
            key: data.target.key,
            for: data.target.for,
            to: data.target.to,
            as: "window",
            saw: {
              code: data.target.code,
              label: data.label ?? data.target.label,
              location: "local",
              method: "command",
              check: "none",
              has: [],
            },
            sentAt: expect.any(String),
          });
          expect(Date.parse(grant.sentAt)).toBeGreaterThanOrEqual(before);
          expect(Date.parse(grant.sentAt)).toBeLessThanOrEqual(DateTime.toEpochMillis(DateTime.nowUnsafe()));
          expect(text).toBe(grantText(grant));
        }

        const posts = signs && mode !== "sign";
        expect(calls).toHaveLength(posts ? 2 : 1);

        if (posts) {
          // The one header is the content type: no trace header rides along to an outside address.
          expect(calls[1]?.[0]).toBe("http://127.0.0.1:18787/grant");
          expect(wire(calls[1]?.[1])).toEqual({
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ text: signed[0], armored: data.armored }),
          });
        }

        // The whole log, so a second line printed beside the one it names is red too.
        // Plant (run once): in grant.ts, print the line on `refused` too, or print a second line;
        // `logged` differs.
        expect(logged).toEqual(mode === "applied" ? [`Granted ${data.fingerprint} to ${data.target.for}`] : []);
      }),
    { arbitrary: { size: 100, runs: runsFor({ fast: 3, full: 12 }) } },
  );
}

it.effect.prop(
  "grant reports bad_args when the CLI refuses unknown flags",
  { flag: Schema.String.check(Schema.isUUID()) },
  ({ flag }) =>
    Effect.gen(function* () {
      yield* Effect.acquireRelease(
        Effect.sync(() => process.argv),
        (argv) =>
          Effect.sync(() => {
            process.argv = argv;
            cli.work = undefined;
          }),
      );
      const f = refused();
      process.argv = [process.execPath, "grant.ts", `--unknown-${flag}`];

      vi.resetModules();
      yield* Effect.tryPromise({
        try: () => import("../grant.ts"),
        catch: (cause: unknown) => new Error("grant import failed", { cause }),
      });
      // Plant (run once): in grant.ts, fetch in the ShowHelp handler; `sent` is not [].
      typed((yield* run(f.fetch)).exit, "bad_args");
      expect(f.sent).toEqual([]);
    }),
  { arbitrary: { size: 100, runs: runsFor({ fast: 3, full: 10 }) } },
);
