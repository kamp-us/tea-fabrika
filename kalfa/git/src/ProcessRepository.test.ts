// The laws of the git-binary adapter on a stand-in spawner (P2 to P8, P11): what each exit code means, the time
// limit, git's version, the command's environment, the arguments of each call, that sizes are read before objects,
// how much stderr an error keeps, and the commands of a patch id. The real binary answers the shared laws in ProcessRepository.integration.test.ts.
import { expect, it } from "@effect/vitest";
import { Arbitrary, ConfigProvider, Context, Duration, Effect, Fiber, Layer, Option, Result, Schema } from "effect";
import { TestClock } from "effect/testing";
import * as CommitId from "./CommitId.ts";
import { commitIdArb, partArb, wordArb } from "./History.test-support.ts";
import * as ProcessRepository from "./ProcessRepository.ts";
import * as Ref from "./Ref.ts";
import { expectFailure } from "./Repository.test-support.ts";
import * as Repository from "./Repository.ts";
import { settings } from "./RepositoryTest.ts";
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
  limits: Parameters<typeof settings>[0] = {},
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
              limits: {
                commits: 100,
                refs: 100,
                bytes: 100_000,
                files: 100,
                diff: 100_000,
                time: `${seconds} seconds`,
              },
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

// Plant: no `forceKillAfter` in the spawn. A child that ignores the first signal is then never killed, so its scope
// never ends and the call never ends; the law's own guard (the call has ended once the clock is past the limit plus
// the kill time) fails it, so the plant is seen red and never hangs. The call runs detached: a child that is never
// killed would otherwise hold the test's own scope open.
it.effect.prop(
  "P3 the time limit: a child that ignores the first signal is killed a short, fixed time later, and the call still ends",
  { a: commitIdArb, seconds: int(1, 3600) },
  ({ a, seconds }) =>
    Effect.gen(function* () {
      const limit = Duration.seconds(seconds);
      const known = [a, `b${a.slice(1)}`];
      const mode = { hang: false };

      const { repo, stand } = yield* Effect.gen(function* () {
        const stand = yield* standIn((call) =>
          mode.hang && call.verb !== "version" ? "hang, ignores the first signal" : script(known, 200)(call),
        );

        const context = yield* Layer.build(
          ProcessRepository.layer({
            path: PATH,
            settings: Schema.decodeUnknownSync(Settings.Settings)({
              limits: {
                commits: 100,
                refs: 100,
                bytes: 100_000,
                files: 100,
                diff: 100_000,
                time: `${seconds} seconds`,
              },
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
        const fiber = yield* Effect.forkDetach(call);
        yield* Effect.yieldNow;
        yield* TestClock.adjust(Duration.millis(1));

        const hanging = (yield* stand.calls).at(-1);
        const killAfter = hanging?.forceKillAfter;
        expect(killAfter, `${name}: the spawn says when to kill a child that ignores the first signal`).toBeDefined();

        if (killAfter === undefined) {
          return;
        }

        expect(Duration.isFinite(killAfter), `${name}: the kill time is finite`).toBe(true);
        expect(Duration.isGreaterThan(killAfter, Duration.zero), `${name}: the kill time is above zero`).toBe(true);
        expect(
          Duration.isLessThanOrEqualTo(killAfter, Duration.minutes(1)),
          `${name}: the kill time is short, not a wait of the call's own`,
        ).toBe(true);

        yield* TestClock.adjust(limit);
        yield* TestClock.adjust(killAfter);
        expect(
          fiber.pollUnsafe(),
          `${name}: the call has ended once the clock passed the limit and the kill time`,
        ).toBeDefined();
        const error = yield* Effect.flip(Fiber.join(fiber)).pipe(Effect.orDie);
        expect(isTimedOut(error), `${name}: fails with TimedOut`).toBe(true);
        expect((yield* stand.ended) > before, `${name}: the child was killed`).toBe(true);
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

const START = [
  "--no-replace-objects",
  `--git-dir=${PATH}`,
  "-c",
  "core.hooksPath=/dev/null",
  "-c",
  "gc.auto=0",
  "-c",
  "maintenance.auto=false",
];

// Plant: swap the two ids given to `merge-base`; drop `--not` from `rev-list`.
it.effect.prop(
  "P7 git's arguments: each call asks git for exactly its plumbing command, with its ids and counts in order",
  { a: commitIdArb, commits: int(1, 40), refs: int(1, 40), withExclude: Arbitrary.schema(Schema.Boolean) },
  ({ a, commits, refs, withExclude }) =>
    Effect.gen(function* () {
      const ids = [1, 2, 3, 4].map((n) => `${n}${a.slice(1)}`);
      const [one, two, three, four] = ids.map(commitIdFrom);
      const refName = Schema.decodeUnknownSync(Ref.RefName)("refs/kalfa/candidates");

      if (one === undefined || two === undefined || three === undefined || four === undefined) {
        return;
      }

      const exclude = withExclude ? [three, four] : [];
      const OPEN = [["version"], ["rev-parse", "--git-dir"]];
      const CHECK = ["cat-file", "--batch-check"];
      const SHALLOW = ["rev-parse", "--is-shallow-repository"];

      const cases: ReadonlyArray<
        readonly [string, (repo: Repository.Repository["Service"]) => Effect.Effect<unknown, unknown>, string[][]]
      > = [
        ["readCommit", (repo) => repo.readCommit(one), [CHECK, ["cat-file", "--batch"]]],
        [
          "readRefs",
          (repo) => repo.readRefs(refName),
          [
            [
              "for-each-ref",
              `--count=${refs + 1}`,
              "--format=%(objectname) %(objecttype) %(symref) %(refname)",
              refName,
            ],
          ],
        ],
        [
          "walk",
          (repo) => repo.walk({ include: [one, two], exclude }),
          [
            CHECK,
            SHALLOW,
            [
              "rev-list",
              "--topo-order",
              "--reverse",
              `--max-count=${commits + 1}`,
              ids[0] ?? "",
              ids[1] ?? "",
              ...(withExclude ? ["--not", ids[2] ?? "", ids[3] ?? ""] : []),
            ],
          ],
        ],
        [
          "mergeBases",
          (repo) => repo.mergeBases(one, two),
          [CHECK, SHALLOW, ["merge-base", "--all", ids[0] ?? "", ids[1] ?? ""]],
        ],
        [
          "isAncestor",
          (repo) => repo.isAncestor(one, two),
          [CHECK, SHALLOW, ["merge-base", "--is-ancestor", ids[0] ?? "", ids[1] ?? ""]],
        ],
      ];

      for (const [name, call, expected] of cases) {
        const { repo, stand } = yield* open(script(ids, 200), { commits, refs });
        yield* Effect.exit(call(repo));

        expect(
          (yield* stand.calls).map((seen) => seen.args),
          `${name}: every command, in order`,
        ).toEqual([...OPEN, ...expected].map((rest) => [...START, ...rest]));
      }
    }),
  { arbitrary: { runs: 100, seed: 119120 } },
);

// Plant: keep the whole of stderr, or its last `limits.bytes` bytes.
it.effect.prop(
  "P8 the stderr cap: an error keeps the first limits.bytes bytes of stderr, and a shorter stderr whole",
  { bytes: int(1, 200), code: int(2, 255), shift: int(0, 25), more: int(1, 300), cut: int(0, 400) },
  ({ bytes, code, shift, more, cut }) =>
    Effect.gen(function* () {
      const a = "a".repeat(40);
      const b = "b".repeat(40);

      const text = (length: number): string =>
        Array.from({ length }, (_, i) => String.fromCharCode(97 + ((i * 7 + shift) % 26))).join("");

      for (const length of [bytes - 1, bytes, bytes + 1, bytes + more]) {
        const said = text(length);

        const ways: ReadonlyArray<readonly [string, string | ReadonlyArray<string>]> = [
          ["in one chunk", said],
          [`cut at ${cut}`, [said.slice(0, cut), said.slice(cut)]],
        ];

        for (const [way, stderr] of ways) {
          const { repo } = yield* open(
            script([a, b], 200, (call) => (call.verb === "merge-base" ? { code, stderr } : { code: 0 })),
            { bytes },
          );

          const error = yield* failure(repo.isAncestor(commitIdFrom(a), commitIdFrom(b)));
          unavailable(
            error,
            Repository.Exited,
            { code, stderr: said.slice(0, bytes) },
            `${length} bytes of stderr, ${way}`,
          );
        }
      }
    }),
  { arbitrary: { runs: 100, seed: 119120 } },
);

const ZEROS = "0".repeat(40);

type Status = "A" | "D" | "M" | "T";

interface Entry {
  readonly status: Status;
  readonly path: string;
  readonly mode: { readonly before: string; readonly after: string };
  readonly id: { readonly before: string; readonly after: string };
  /** What `cat-file --batch-check` says of each blob, 0 for a side the file lacks. */
  readonly size: { readonly before: number; readonly after: number };
}

const blobId = (n: number): string => n.toString(16).padStart(40, "d");

// git's raw list, as `diff-tree -r -z --no-renames` prints it: `:<mode> <mode> <id> <id> <status>`, a NUL, the path, a NUL.
const rawList = (entries: ReadonlyArray<Entry>): string =>
  entries
    .map((e) => `:${e.mode.before} ${e.mode.after} ${e.id.before} ${e.id.after} ${e.status}\0${e.path}\0`)
    .join("");

/** What the stand-in is made to say for one `patchId` call: the raw list, the blob sizes, the patch and label `patch-id` prints. */
interface Script {
  readonly from: string;
  readonly to: string;
  readonly entries: ReadonlyArray<Entry>;
  readonly patch: Uint8Array;
  readonly printed: string;
}

// The sizes of the blobs git is asked about, and the commits it is asked about, as `cat-file --batch-check` answers.
const checking = (script: Script, call: Call): Reply => {
  const sizes = new Map(
    script.entries.flatMap((e) => [[e.id.before, e.size.before] as const, [e.id.after, e.size.after] as const]),
  );

  const asked = new TextDecoder()
    .decode(call.input)
    .split("\n")
    .filter((line) => line !== "");

  return {
    code: 0,
    stdout: asked.map((id) => (sizes.has(id) ? `${id} blob ${sizes.get(id)}\n` : `${id} commit 200\n`)).join(""),
  };
};

const patchScript =
  (script: Script, rest: (call: Call) => Reply | undefined = () => undefined) =>
  (call: Call): Reply => {
    const mine = rest(call);

    if (mine !== undefined) {
      return mine;
    }

    switch (call.verb) {
      case "version":
        return { code: 0, stdout: "git version 2.40.1\n" };
      case "rev-parse":
        return { code: 0, stdout: ".\n" };
      case "cat-file":
        return checking(script, call);
      case "diff-tree":
        return call.rest.includes("-z")
          ? { code: 0, stdout: rawList(script.entries) }
          : { code: 0, stdout: script.patch };
      case "patch-id":
        return { code: 0, stdout: script.printed };
      default:
        return { code: 0 };
    }
  };

const STATUSES: ReadonlyArray<Status> = ["A", "D", "M", "T"];

const entryFor = (status: Status, n: number, part: string, before: number, after: number): Entry => {
  const gone = { mode: "000000", id: ZEROS };

  switch (status) {
    case "A":
      return {
        status,
        path: `a${part}`,
        mode: { before: gone.mode, after: "100644" },
        id: { before: gone.id, after: blobId(2 * n + 1) },
        size: { before: 0, after },
      };
    case "D":
      return {
        status,
        path: `d${part}`,
        mode: { before: "100644", after: gone.mode },
        id: { before: blobId(2 * n), after: gone.id },
        size: { before, after: 0 },
      };
    case "M":
      return {
        status,
        path: `m${part}`,
        mode: { before: "100644", after: "100755" },
        id: { before: blobId(2 * n), after: blobId(2 * n + 1) },
        size: { before, after },
      };
    case "T":
      return {
        status,
        path: `t${part}`,
        mode: { before: "100644", after: "120000" },
        id: { before: blobId(2 * n), after: blobId(2 * n + 1) },
        size: { before, after },
      };
  }
};

const GITLINK: Entry = {
  status: "A",
  path: "sub-module",
  mode: { before: "000000", after: "160000" },
  id: { before: ZEROS, after: `${"c".repeat(39)}1` },
  size: { before: 0, after: 0 },
};

const SPEC = {
  from: commitIdArb,
  parts: Arbitrary.array(partArb, { minLength: 8, maxLength: 8 }),
  sizes: Arbitrary.array(int(1, 40), { minLength: 16, maxLength: 16 }),
  count: int(4, 6),
  shift: int(0, 3),
  patch: Arbitrary.array(int(0, 255), { minLength: 1, maxLength: 60 }).pipe(
    Arbitrary.map((octets) => Uint8Array.from(octets)),
  ),
  printed: commitIdArb,
};

const CHECK = ["cat-file", "--batch-check"];

const OPENING = [["version"], ["rev-parse", "--git-dir"]];

const commandsSeen = (calls: ReadonlyArray<Call>): ReadonlyArray<ReadonlyArray<string>> =>
  calls.map((seen) => seen.args);

// The lines a command was given on stdin, as a set.
const asked = (call: Call | undefined): ReadonlySet<string> =>
  new Set(
    new TextDecoder()
      .decode(call?.input)
      .split("\n")
      .filter((line) => line !== ""),
  );

// Plant: read empty `patch-id` output as none, red; add `--stable`, red; run `diff-tree -p` before the size check, red; pipe
// `diff-tree` into `patch-id`: the stand-in sees one piped command, red; ask `cat-file` the size of a gitlink's id, (j) red;
// ignore the exit code of `diff-tree -r -z` or of `diff-tree -p`, so a failure answers none, red; count `>=` for `>` on `files`,
// red; delete the files check or the size check, (h) red; run the later commands after an empty raw list, red; delete the check
// that both commits are known, (i) red.
it.effect.prop(
  "P11 a patch id's commands: known, the raw list, the sizes, the patch and `patch-id --verbatim`, in that order, with the limits checked before the content is read",
  SPEC,
  ({ from, parts, sizes, count, shift, patch, printed }) =>
    Effect.gen(function* () {
      const first = commitIdFrom(from);
      const second = commitIdFrom(`b${from.slice(1)}`);

      const real = Array.from({ length: count }, (_, i) =>
        entryFor(
          STATUSES[(shift + i) % STATUSES.length] ?? "M",
          i,
          parts[i] ?? "p",
          sizes[2 * i] ?? 1,
          sizes[2 * i + 1] ?? 1,
        ),
      );

      const entries = [...real, GITLINK];
      const script: Script = { from: first, to: second, entries, patch, printed: `${printed} ${ZEROS}\n` };
      const files = entries.length;
      const bytes = real.reduce((total, e) => total + e.size.before + e.size.after, 0);
      expect(
        real.map((e) => e.status),
        "every status of the raw list is read",
      ).toEqual(expect.arrayContaining([...STATUSES]));

      const RAW = ["diff-tree", "-r", "-z", "--no-renames", first, second];

      const PATCH = [
        "diff-tree",
        "-r",
        "-p",
        "-U0",
        "--no-renames",
        "--no-ext-diff",
        "--no-textconv",
        "--full-index",
        first,
        second,
      ];

      const PATCH_ID = ["patch-id", "--verbatim"];

      const ask = (limits: Parameters<typeof settings>[0], rest?: (call: Call) => Reply | undefined) =>
        Effect.gen(function* () {
          const { repo, stand } = yield* open(patchScript(script, rest), limits);

          return { result: yield* Effect.result(repo.patchId(first, second)), seen: yield* stand.calls };
        });

      // Exactly at both limits: every command, in order, and the patch reaches `patch-id` byte for byte.
      const whole = yield* ask({ files, diff: bytes });
      expect(Result.isSuccess(whole.result), "at both limits it answers").toBe(true);

      if (Result.isSuccess(whole.result)) {
        expect(whole.result.success, "label patch-id printed").toEqual(Option.some(printed));
      }

      expect(commandsSeen(whole.seen), "every command, in order").toEqual(
        [...OPENING, CHECK, RAW, CHECK, PATCH, PATCH_ID].map((rest) => [...START, ...rest]),
      );
      expect(
        whole.seen.some((seen) => seen.piped),
        "no command is a pipe",
      ).toBe(false);
      const [known, , sizesCall, , idCall] = whole.seen.slice(2);

      expect(asked(known), "known is asked about both commits").toEqual(new Set([first, second]));
      expect(idCall?.input, "the patch reaches patch-id byte for byte").toEqual(patch);
      expect(asked(sizesCall), "the sizes are asked of each blob of the raw list, and of no gitlink").toEqual(
        new Set(real.flatMap((e) => [e.id.before, e.id.after]).filter((id) => id !== ZEROS)),
      );

      // One entry more than `files`: TooMany, and no size is asked.
      const crowded = yield* ask({ files: files - 1, diff: bytes });
      expect(Result.isFailure(crowded.result), "one file too many fails").toBe(true);

      if (Result.isFailure(crowded.result)) {
        expectFailure(
          crowded.result.failure,
          Repository.TooMany,
          { limit: "files", most: files - 1 },
          "the files limit",
        );
      }

      expect(commandsSeen(crowded.seen), "no size is asked before the files limit is checked").toEqual(
        [...OPENING, CHECK, RAW].map((rest) => [...START, ...rest]),
      );

      // One byte more than `diff`: DiffTooLarge, and no patch is printed.
      const heavy = yield* ask({ files, diff: bytes - 1 });
      expect(Result.isFailure(heavy.result), "one byte too many fails").toBe(true);

      if (Result.isFailure(heavy.result)) {
        expectFailure(heavy.result.failure, Repository.DiffTooLarge, { most: bytes - 1 }, "the diff limit");
      }

      expect(commandsSeen(heavy.seen), "no patch is printed before the size limit is checked").toEqual(
        [...OPENING, CHECK, RAW, CHECK].map((rest) => [...START, ...rest]),
      );

      // Nothing changed: the raw list is empty, the answer is none, and no later command runs.
      const quiet = yield* Effect.gen(function* () {
        const { repo, stand } = yield* open(patchScript({ ...script, entries: [] }), { files, diff: bytes });

        return { result: yield* Effect.result(repo.patchId(first, second)), seen: yield* stand.calls };
      });

      expect(Result.isSuccess(quiet.result), "an empty raw list answers").toBe(true);

      if (Result.isSuccess(quiet.result)) {
        expect(Option.isNone(quiet.result.success), "an empty raw list is none").toBe(true);
      }

      expect(commandsSeen(quiet.seen), "nothing runs after an empty raw list").toEqual(
        [...OPENING, CHECK, RAW].map((rest) => [...START, ...rest]),
      );

      // A raw list with entries and a `patch-id` that prints nothing is no answer, never none.
      const silent = yield* ask({ files, diff: bytes }, (call) =>
        call.verb === "patch-id" ? { code: 0, stdout: "" } : undefined,
      );

      expect(Result.isFailure(silent.result), "an id that is missing after changes fails").toBe(true);

      if (Result.isFailure(silent.result)) {
        unavailable(silent.result.failure, Repository.Unreadable, {}, "patch-id printed nothing");
      }

      // A command that fails is never no change: its exit code ends the call.
      const fails: ReadonlyArray<readonly [string, (call: Call) => boolean]> = [
        ["the raw list", (call) => call.verb === "diff-tree" && call.rest.includes("-z")],
        ["the patch", (call) => call.verb === "diff-tree" && call.rest.includes("-p")],
        ["patch-id", (call) => call.verb === "patch-id"],
      ];

      for (const [label, is] of fails) {
        const failing = yield* ask({ files, diff: bytes }, (call) =>
          is(call) ? { code: 128, stderr: "fatal" } : undefined,
        );

        expect(Result.isFailure(failing.result), `${label} that exits 128 fails the call`).toBe(true);

        if (Result.isFailure(failing.result)) {
          unavailable(failing.result.failure, Repository.Exited, { code: 128 }, `${label} exits 128`);
        }
      }
    }),
  { arbitrary: { runs: 100, seed: 119120 } },
);
