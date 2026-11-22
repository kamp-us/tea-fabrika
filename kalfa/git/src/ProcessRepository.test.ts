// The laws of the git-binary adapter on a stand-in spawner (P2 to P6): what each exit code means, the time
// limit, git's version, the command's environment, and that sizes are read before objects. The real binary
// answers the shared laws in ProcessRepository.integration.test.ts.
import { expect, it } from "@effect/vitest";
import { Arbitrary, ConfigProvider, Context, Duration, Effect, Fiber, Layer, Result, Schema } from "effect";
import { TestClock } from "effect/testing";
import * as CommitId from "./CommitId.ts";
import { commitIdArb, wordArb } from "./HistoryTest.ts";
import * as ProcessRepository from "./ProcessRepository.ts";
import * as Ref from "./Ref.ts";
import * as Repository from "./Repository.ts";
import { expectFailure, settings } from "./RepositoryTest.ts";
import * as Settings from "./Settings.ts";
import { standIn, type Call, type Reply } from "./StandIn.test-support.ts";

const int = (minimum: number, maximum: number): Arbitrary.Arbitrary<number> =>
  Arbitrary.schema(Schema.Int.check(Schema.isBetween({ minimum, maximum })));

const commitIdFrom = (text: string): CommitId.CommitId => Schema.decodeUnknownSync(CommitId.CommitId)(text);

const PATH = "repo.git";

/** The answers git gives while a layer opens, and the cheap questions before a call; `rest` answers the call itself. */
const script =
  (known: ReadonlyArray<string>, size: number, rest: (call: Call) => Reply = () => ({ code: 0 })) =>
  (call: Call): Reply => {
    switch (call.verb) {
      case "version":
        return { code: 0, stdout: "git version 2.40.1\n" };
      case "rev-parse":
        return { code: 0, stdout: call.rest.includes("--is-shallow-repository") ? "false\n" : ".\n" };
      case "cat-file":
        return call.rest.includes("--batch-check")
          ? { code: 0, stdout: known.map((id) => `${id} commit ${size}\n`).join("") }
          : rest(call);
      default:
        return rest(call);
    }
  };

const open = (
  run: (call: Call) => Reply,
  limits: { readonly commits?: number; readonly refs?: number; readonly bytes?: number } = {},
  env: Record<string, string> = { PATH: "/usr/bin:/bin" },
) =>
  Effect.gen(function* () {
    const stand = yield* standIn(run);

    const context = yield* Layer.build(
      ProcessRepository.layer({ path: PATH, settings: settings(limits) }).pipe(Layer.provide(stand.layer)),
    );

    return { repo: Context.get(context, Repository.Repository), stand };
  }).pipe(Effect.provide(ConfigProvider.layer(ConfigProvider.fromEnv({ env }))));

const failure = <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<E, never, R> =>
  Effect.flip(effect).pipe(Effect.orDie);

const isTimedOut = Schema.is(Repository.TimedOut);

/** The call failed with GitUnavailable, for the reason class given, holding these fields. */
const unavailable = <E>(
  error: E,
  reason: abstract new (...args: never[]) => object,
  fields: object,
  message: string,
): void => {
  expectFailure(error, Repository.GitUnavailable, { reason: expect.any(reason) }, message);
  expectFailure(error, Repository.GitUnavailable, { reason: fields }, message);
};

// Plant: read any code but 0 as false; read exit 1 with output as `[]`.
it.effect.prop(
  "P2 exit codes: 0 and 1 mean what git says; any other code, a failed start or unreadable output is GitUnavailable",
  { a: commitIdArb, other: int(2, 255), junk: wordArb },
  ({ a, other, junk }) =>
    Effect.gen(function* () {
      const first = commitIdFrom(a);
      const second = commitIdFrom(`b${a.slice(1)}`);
      const known = [a, `b${a.slice(1)}`];

      const run = (reply: Reply) =>
        open(script(known, 200, (call) => (call.verb === "merge-base" ? reply : { code: 0 })));

      const ancestor = (reply: Reply) => Effect.flatMap(run(reply), ({ repo }) => repo.isAncestor(first, second));
      const bases = (reply: Reply) => Effect.flatMap(run(reply), ({ repo }) => repo.mergeBases(first, second));

      expect(yield* ancestor({ code: 0 }), "exit 0 is true").toBe(true);
      expect(yield* ancestor({ code: 1 }), "exit 1 is false").toBe(false);
      expect(yield* bases({ code: 0, stdout: `${a}\n` }), "exit 0 with an id").toEqual([a]);
      expect(yield* bases({ code: 1 }), "exit 1 with no output is no merge base").toEqual([]);

      for (const code of [other, 2, 128, 255]) {
        unavailable(
          yield* failure(ancestor({ code, stderr: junk })),
          Repository.Exited,
          { code },
          `isAncestor, exit ${code}`,
        );
        unavailable(
          yield* failure(bases({ code, stderr: junk })),
          Repository.Exited,
          { code },
          `mergeBases, exit ${code}`,
        );
      }

      unavailable(
        yield* failure(
          bases({
            code: 1,
            stdout: `${a}
`,
          }),
        ),
        Repository.Exited,
        { code: 1 },
        "exit 1 with output is no answer",
      );
      unavailable(yield* failure(ancestor("cannot start")), Repository.NotStarted, {}, "a spawn that fails");
      unavailable(
        yield* failure(
          bases({
            code: 0,
            stdout: `not an id ${junk}
`,
          }),
        ),
        Repository.Unreadable,
        {},
        "output that does not parse",
      );
    }),
  { arbitrary: { runs: 200, seed: 119120 } },
);

// Plant: drop the timeout from `Repository.make`; the law's own guard (the call has ended once the clock is
// past the limit) fails it, so the plant is seen red and never hangs.
it.effect.prop(
  "P3 the time limit: a child that never exits ends the call with TimedOut once the clock passes limits.time",
  { a: commitIdArb, seconds: int(1, 3600) },
  ({ a, seconds }) =>
    Effect.gen(function* () {
      const limit = Duration.seconds(seconds);
      const known = [a, `b${a.slice(1)}`];
      const mode = { hang: false };

      const { repo, stand } = yield* Effect.gen(function* () {
        const stand = yield* standIn((call) =>
          mode.hang && call.verb !== "version" ? "hang" : script(known, 200)(call),
        );

        const context = yield* Layer.build(
          ProcessRepository.layer({
            path: PATH,
            settings: Schema.decodeUnknownSync(Settings.Settings)({
              limits: { commits: 100, refs: 100, bytes: 100_000, time: `${seconds} seconds` },
            }),
          }).pipe(Layer.provide(stand.layer)),
        );

        return { repo: Context.get(context, Repository.Repository), stand };
      }).pipe(Effect.provide(ConfigProvider.layer(ConfigProvider.fromEnv({ env: { PATH: "/bin" } }))));

      mode.hang = true;
      const first = commitIdFrom(known[0] ?? a);
      const second = commitIdFrom(known[1] ?? a);
      const refName = Schema.decodeUnknownSync(Ref.RefName)("refs/heads/main");

      const calls: ReadonlyArray<readonly [string, Effect.Effect<unknown, unknown>]> = [
        ["readCommit", repo.readCommit(first)],
        ["readRefs", repo.readRefs(refName)],
        ["walk", repo.walk({ include: [first], exclude: [] })],
        ["mergeBases", repo.mergeBases(first, second)],
        ["isAncestor", repo.isAncestor(first, second)],
      ];

      for (const [name, call] of calls) {
        const before = yield* stand.ended;
        const fiber = yield* Effect.forkChild(call);
        yield* Effect.yieldNow;
        yield* TestClock.adjust(Duration.millis(1));
        yield* TestClock.adjust(limit);
        expect(fiber.pollUnsafe(), `${name}: the call has ended once the clock passed the limit`).toBeDefined();
        const error = yield* Effect.flip(Fiber.join(fiber)).pipe(Effect.orDie);
        expect(isTimedOut(error), `${name}: fails with TimedOut`).toBe(true);

        if (isTimedOut(error)) {
          expect(Duration.equals(error.after, limit), `${name}: names the limit`).toBe(true);
        }

        expect((yield* stand.ended) > before, `${name}: the child's scope ended`).toBe(true);
      }
    }),
  { arbitrary: { runs: 50, seed: 119120 } },
);

const LABELS = ["plain", "Apple", "Windows"] as const;

const versionText = (label: (typeof LABELS)[number], major: number, minor: number, patch: number): string => {
  const numbers = `${major}.${minor}.${patch}`;

  switch (label) {
    case "plain":
      return `git version ${numbers}\n`;
    case "Apple":
      return `git version ${numbers} (Apple Git-145)\n`;
    case "Windows":
      return `git version ${numbers}.windows.1\n`;
  }
};

const isNewEnough = (major: number, minor: number): boolean => major > 2 || (major === 2 && minor >= 38);

// Plant: compare the version as text: `2.100.0` reads as older than `2.38.0`.
it.effect.prop(
  "P4 git's version: 2.38 and newer opens, older fails with GitTooOld, versions compare as numbers, no version is GitUnavailable",
  { major: int(0, 12), minor: int(0, 150), patch: int(0, 20), junk: wordArb },
  ({ major, minor, patch, junk }) =>
    Effect.gen(function* () {
      const cases: ReadonlyArray<readonly [number, number, number]> = [
        [major, minor, patch],
        [2, 38, 0],
        [2, 37, 9],
        [2, 100, 0],
        [2, 9, 0],
        [10, 0, 0],
        [1, 99, 0],
      ];

      for (const [ma, mi, pa] of cases) {
        for (const label of LABELS) {
          const text = versionText(label, ma, mi, pa);
          const layer = open((call) => (call.verb === "version" ? { code: 0, stdout: text } : script([], 1)(call)));

          const result = yield* Effect.result(layer);
          const found = `${label} ${ma}.${mi}.${pa}`;
          expect(Result.isSuccess(result), `${found} opens exactly when it is 2.38 or newer`).toBe(isNewEnough(ma, mi));

          if (Result.isFailure(result)) {
            expectFailure(result.failure, Repository.GitTooOld, {}, `${found} is too old`);
            expect(JSON.stringify(result.failure), `${found}: names what it found`).toContain(`${ma}.${mi}.${pa}`);
          }
        }
      }

      const none = yield* failure(
        open((call) => (call.verb === "version" ? { code: 0, stdout: `${junk}\n` } : script([], 1)(call))),
      );

      expectFailure(none, Repository.GitUnavailable, {}, "text with no version");
    }),
  { arbitrary: { runs: 200, seed: 119120 } },
);

const PINNED = {
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_SYSTEM: "/dev/null",
  GIT_ATTR_NOSYSTEM: "1",
  GIT_TERMINAL_PROMPT: "0",
  GIT_OPTIONAL_LOCKS: "0",
  GIT_NO_REPLACE_OBJECTS: "1",
  LC_ALL: "C",
};

const upper = Arbitrary.array(Arbitrary.schema(Schema.Literals([..."ABCDEFGHIJKLMNOPQRSTUVWXYZ"])), {
  minLength: 1,
  maxLength: 8,
}).pipe(Arbitrary.map((letters) => letters.join("")));

// Plant: `extendEnv: true`; drop `--no-replace-objects`.
it.effect.prop(
  "P5 git's environment: every command has the same arguments' start, extendEnv false, and only PATH and the pinned set",
  { a: commitIdArb, path: wordArb, names: Arbitrary.array(upper, { minLength: 1, maxLength: 5 }), value: wordArb },
  ({ a, path, names, value }) =>
    Effect.gen(function* () {
      const inherited: Record<string, string> = {
        PATH: `/${path.replaceAll(" ", "")}/bin`,
        HOME: "/srv/x",
        GIT_DIR: "/elsewhere",
        GIT_OBJECT_DIRECTORY: "/elsewhere/objects",
        GIT_TRACE: "1",
        ...Object.fromEntries(names.map((name) => [`GIT_${name}`, value])),
      };

      const known = [a, `b${a.slice(1)}`];
      const { repo, stand } = yield* open(script(known, 200), {}, inherited);
      const first = commitIdFrom(a);
      const second = commitIdFrom(`b${a.slice(1)}`);
      const refName = Schema.decodeUnknownSync(Ref.RefName)("refs/heads/main");

      const calls: ReadonlyArray<Effect.Effect<unknown, unknown>> = [
        repo.readCommit(first),
        repo.readRefs(refName),
        repo.walk({ include: [first], exclude: [second] }),
        repo.mergeBases(first, second),
        repo.isAncestor(first, second),
      ];

      for (const call of calls) {
        yield* Effect.exit(call);
      }

      const seen = yield* stand.calls;
      expect(seen.length, "opening and five calls ran git").toBeGreaterThan(5);

      for (const call of seen) {
        expect(call.args.slice(0, 2), `${call.verb}: the start`).toEqual(["--no-replace-objects", `--git-dir=${PATH}`]);
        expect(call.extendEnv, `${call.verb}: nothing inherited`).toBe(false);
        expect(call.env, `${call.verb}: PATH and the pinned set only`).toEqual({ PATH: inherited["PATH"], ...PINNED });
      }
    }),
  { arbitrary: { runs: 100, seed: 119120 } },
);

// Plant: read the objects, then check their size.
it.effect.prop(
  "P6 size before reading: a size past limits.bytes is TooLarge and a walk of commits + 1 lines is TooMany, with no object read",
  { a: commitIdArb, commits: int(1, 40), bytes: int(1, 100_000) },
  ({ a, commits, bytes }) =>
    Effect.gen(function* () {
      const first = commitIdFrom(a);
      const ids = Array.from({ length: commits + 1 }, (_, i) => `${i.toString(16).padStart(40, "c")}`);
      const read = (call: Call): boolean => call.verb === "cat-file" && !call.rest.includes("--batch-check");

      const big = yield* open(script([a], bytes + 1), { bytes });
      expectFailure(
        yield* failure(big.repo.readCommit(first)),
        Repository.TooLarge,
        { most: bytes },
        "readCommit of a big commit",
      );
      expect((yield* big.stand.calls).filter(read), "no object was read").toEqual([]);

      const long = yield* open(
        script([a], 200, (call) =>
          call.verb === "rev-list" ? { code: 0, stdout: ids.map((id) => `${id}\n`).join("") } : { code: 0 },
        ),
        { commits },
      );

      expectFailure(
        yield* failure(long.repo.walk({ include: [first], exclude: [] })),
        Repository.TooMany,
        { limit: "commits", most: commits },
        "a walk of commits + 1",
      );
      const seen = yield* long.stand.calls;
      expect(seen.filter(read), "no object was read").toEqual([]);
      expect(
        seen
          .filter((call) => call.verb === "rev-list")
          .every((call) => call.args.includes(`--max-count=${commits + 1}`)),
        "git is asked for one more than the limit, and no more",
      ).toBe(true);
    }),
  { arbitrary: { runs: 100, seed: 119120 } },
);
