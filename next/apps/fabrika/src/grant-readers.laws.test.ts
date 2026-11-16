// P12, next/. The real command is captured at its NodeRuntime edge; no process or socket starts.
import { grantText } from "@kampus/libfabrika/access/Text";
import { runsFor } from "@kampus/vitest";
import { Cause, Effect, Exit, Layer, Option, Schema, Sink, Stream } from "effect";
import { FetchHttpClient } from "effect/http";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import { TestConsole } from "effect/testing";
import * as fc from "fast-check";
import { expect, it, vi } from "vitest";

const cli = vi.hoisted(() => ({
  work: undefined as Effect.Effect<unknown, unknown> | undefined,
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
const run = (fetch: typeof globalThis.fetch) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const exit = yield* Effect.exit(cli.work!);
      return { exit, logged: yield* TestConsole.logLines };
    }).pipe(Effect.provideService(FetchHttpClient.Fetch, fetch), Effect.provide(TestConsole.layer)),
  );

/** What one `fetch` call puts on the wire: its method, every header, and its body as text. */
const wire = (options: RequestInit | undefined) => ({
  method: options?.method,
  headers: { ...(options?.headers as Record<string, string> | undefined) },
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

it("grant command rejects malformed outside URLs as GrantError before fetching or signing", async () => {
  const invalid = fc.oneof(
    fc.string().map((s) => `relative-${encodeURIComponent(s)}`),
    fc.constantFrom("http://[", "http://%", "http://[::1", "https://"),
  );

  await fc.assert(
    fc.asyncProperty(invalid, async (url) => {
      const argv = process.argv;
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

      try {
        cli.work = undefined;
        vi.resetModules();
        await import("../grant.ts");
        expect(cli.work).toBeDefined();
        // Plant (run once): in grant.ts, fetch the target before parsing the URL; `sent` is not [].
        typed((await run(f.fetch)).exit, "bad_url");
        expect(f.sent).toEqual([]);
      } finally {
        process.argv = argv;
      }
    }),
    { seed: 119120, numRuns: runsFor({ fast: 3, full: 20 }), examples: [["http://["]] },
  );
});

const usage = "usage: grant.ts client URL KEY --code=CODE --key=PATH";

it("grant usage guard names the error for each missing argument or flag", async () => {
  await fc.assert(
    fc.asyncProperty(fc.string(), fc.integer({ min: 0, max: 4 }), async (text, missing) => {
      const args = ["client", "http://127.0.0.1:18787", "public-fingerprint", `--code=${text}`, "--key=unused-path"];

      if (missing === 0) {
        args[0] = `wrong-${text}`;
      } else if (missing === 1) {
        args.splice(1, 2);
      } else {
        args.splice(missing, 1);
      }

      // Removing the URL also removes its following positional argument so the CLI cannot shift it.
      const argv = process.argv;
      const f = refused();
      process.argv = [process.execPath, "grant.ts", ...args];

      try {
        vi.resetModules();
        await import("../grant.ts");
        // Plant (run once): in grant.ts, fetch before the usage check; `sent` is not [].
        typed((await run(f.fetch)).exit, usage);
        expect(f.sent).toEqual([]);
      } finally {
        process.argv = argv;
      }
    }),
    { seed: 119120, numRuns: runsFor({ fast: 3, full: 25 }) },
  );
});

const generated = fc.record({
  fingerprint: fc.string(),
  code: fc.string(),
  label: fc.option(fc.string(), { nil: undefined }),
  target: fc.record({
    key: fc.string(),
    for: fc.string(),
    to: fc.string(),
    code: fc.string(),
    label: fc.string(),
  }),
  armored: fc.string(),
  exit: fc.integer({ min: 1, max: 255 }),
  badTarget: fc.jsonValue().filter(
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
  badReply: fc.jsonValue().filter((raw) => !Schema.is(Schema.Record(Schema.String, Schema.Json))(raw)),
});

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

for (const mode of Object.keys(results) as Array<keyof typeof results>) {
  it(`grant ${mode} path preserves the signed fields and exact error reason`, async () => {
    await fc.assert(
      fc.asyncProperty(generated, async (data) => {
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
        const { sent: calls, fetch } = fetches(async (_url, options) => {
          if (options?.method === "POST") {
            if (mode === "post") {
              throw new Error("post unavailable");
            }

            if (mode === "status") {
              return new Response("refused", { status: 403 });
            }

            if (mode === "replyJson") {
              return new Response("{");
            }

            return Response.json(
              mode === "reply" ? data.badReply : { _tag: mode === "refused" ? "refused" : "applied" },
            );
          }

          if (mode === "get") {
            throw new Error("get unavailable");
          }

          if (mode === "json") {
            return new Response("{");
          }

          return Response.json(mode === "target" ? data.badTarget : mode === "waiting" ? null : data.target);
        });

        const argv = process.argv;
        process.argv = [
          process.execPath,
          "grant.ts",
          "client",
          "http://127.0.0.1:18787/ignored?q=ignored",
          data.fingerprint,
          `--code=${data.code}`,
          "--key=unused-signing-path",
          ...(data.label === undefined ? [] : [`--label=${data.label}`]),
        ];

        try {
          vi.resetModules();
          await import("../grant.ts");
          const before = Date.now();
          const { exit, logged } = await run(fetch);
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
            expect(Date.parse(grant.sentAt)).toBeLessThanOrEqual(Date.now());
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
        } finally {
          process.argv = argv;
          cli.layer = undefined;
        }
      }),
      { seed: 119120, numRuns: runsFor({ fast: 3, full: 12 }) },
    );
  });
}

it("grant reports bad_args when the CLI refuses unknown flags", async () => {
  await fc.assert(
    fc.asyncProperty(fc.uuid(), async (flag) => {
      const argv = process.argv;
      const f = refused();
      process.argv = [process.execPath, "grant.ts", `--unknown-${flag}`];

      try {
        vi.resetModules();
        await import("../grant.ts");
        // Plant (run once): in grant.ts, fetch in the ShowHelp handler; `sent` is not [].
        typed((await run(f.fetch)).exit, "bad_args");
        expect(f.sent).toEqual([]);
      } finally {
        process.argv = argv;
      }
    }),
    { seed: 119120, numRuns: runsFor({ fast: 3, full: 10 }) },
  );
});
