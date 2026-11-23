// The laws of the git-binary adapter on a stand-in spawner (P2 to P16): what each exit code means, the time
// limit, git's version, the command's environment, the arguments of each call, that sizes are read before objects,
// how much stderr an error keeps, what a failed `update-ref` means, the bytes a commit is written from, that no
// call reaches a remote, what `merge-tree` printed, the version a merge needs and the commands of a patch id and of a diff. The real binary answers the shared laws in ProcessRepository.integration.test.ts.
import { expect, it } from "@effect/vitest";
import {
  Arbitrary,
  ConfigProvider,
  Context,
  Duration,
  Effect,
  Fiber,
  Layer,
  Option,
  Predicate,
  Result,
  Schema,
} from "effect";
import { TestClock } from "effect/testing";
import * as Commit from "./Commit.ts";
import * as CommitId from "./CommitId.ts";
import * as Diff from "./Diff.ts";
import mergeTreeRows from "./fixtures/merge-tree-2.40.1.json" with { type: "json" };
import {
  commitIdArb,
  committerFrom,
  flatSignatureArb,
  messageVariants,
  ModelDiff,
  partArb,
  wordArb,
} from "./History.test-support.ts";
import { byBytes, bytes as objectBytes } from "./internal/object.ts";
import * as ProcessRepository from "./ProcessRepository.ts";
import * as Ref from "./Ref.ts";
import { COMMITTER, expectFailure } from "./Repository.test-support.ts";
import * as Repository from "./Repository.ts";
import { settings } from "./RepositoryTest.ts";
import * as Settings from "./Settings.ts";
import { gitTable, mergeTreeOutput, standIn, type Call, type Reply, type Table } from "./StandIn.test-support.ts";
import * as Tree from "./Tree.ts";

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
  config: Settings.Settings = settings(limits),
) =>
  Effect.gen(function* () {
    const stand = yield* standIn(run);

    const context = yield* Layer.build(
      ProcessRepository.layer({ path: PATH, settings: config }).pipe(Layer.provide(stand.layer)),
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
              committer: COMMITTER,
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
              committer: COMMITTER,
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
            expectFailure(result.failure, Repository.GitTooOld, { needs: "2.38" }, `${found} is too old`);
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

/** What git's merge reads from a repository's own config, written out at git's defaults, so no config steers a merge. */
const MERGE_PINS = ["merge.renames=true", "merge.directoryRenames=conflict", "merge.renormalize=false"];

/** The `-c` settings in the start of a command's arguments. */
const startConfigs = (args: ReadonlyArray<string>): ReadonlyArray<string> =>
  args.flatMap((word, i) => (args[i - 1] === "-c" ? [word] : []));

// Plant: `extendEnv: true`; drop `--no-replace-objects`; drop `merge.renames=true` from the start of the commands.
it.effect.prop(
  "P5 git's environment: every command has the same arguments' start with the three merge pins, extendEnv false, and only PATH and the pinned set",
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
        repo.mergeTrees({ mergeBase: first, ours: first, theirs: second }),
      ];

      for (const call of calls) {
        yield* Effect.exit(call);
      }

      const seen = yield* stand.calls;
      expect(seen.length, "opening and six calls ran git").toBeGreaterThan(5);
      expect(
        seen.map((call) => call.verb),
        "the merge ran git too",
      ).toContain("merge-tree");

      for (const call of seen) {
        expect(call.args.slice(0, 2), `${call.verb}: the start`).toEqual(["--no-replace-objects", `--git-dir=${PATH}`]);
        expect(startConfigs(call.args), `${call.verb}: the merge pins`).toEqual(expect.arrayContaining(MERGE_PINS));
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
  ...MERGE_PINS.flatMap((pin) => ["-c", pin]),
];

// Plant: swap the two ids given to `merge-base`; drop `--not` from `rev-list`; swap ours and theirs given to `merge-tree`;
// drop `--name-only` or `-z` from it.
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
        [
          "mergeTrees",
          (repo) => repo.mergeTrees({ mergeBase: one, ours: two, theirs: three }),
          [
            CHECK,
            [
              "merge-tree",
              "--write-tree",
              "--no-messages",
              "--name-only",
              "-z",
              `--merge-base=${ids[0] ?? ""}`,
              ids[1] ?? "",
              ids[2] ?? "",
            ],
          ],
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

/** What the stand-in is made to say for one `patchId` call: the raw list, the blob sizes, the patch and what `patch-id` prints. */
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

// A file made a submodule and a submodule made a file: one `T` entry each, with a file on one side and a submodule on the other.
// The file's bytes count against `limits.diff`, and the submodule's id is never asked about.
const submodules = (before: number, after: number): ReadonlyArray<Entry> => [
  {
    status: "T",
    path: "file-made-submodule",
    mode: { before: "100644", after: "160000" },
    id: { before: blobId(1001), after: `${"c".repeat(39)}2` },
    size: { before, after: 0 },
  },
  {
    status: "T",
    path: "submodule-made-file",
    mode: { before: "160000", after: "100755" },
    id: { before: `${"c".repeat(39)}3`, after: blobId(1002) },
    size: { before: 0, after },
  },
];

// The sides of an entry that hold a file: the blobs git is asked the size of, and the bytes that count against `limits.diff`.
const fileSides = (entry: Entry): ReadonlyArray<{ readonly id: string; readonly size: number }> => [
  ...(entry.mode.before === "000000" || entry.mode.before === "160000"
    ? []
    : [{ id: entry.id.before, size: entry.size.before }]),
  ...(entry.mode.after === "000000" || entry.mode.after === "160000"
    ? []
    : [{ id: entry.id.after, size: entry.size.after }]),
];

interface Spec {
  readonly from: string;
  readonly parts: ReadonlyArray<string>;
  readonly sizes: ReadonlyArray<number>;
  readonly count: number;
  readonly shift: number;
  readonly patch: Uint8Array;
  readonly printed: string;
}

// One `patchId` call to make: two commits, the raw list git prints for them, which holds files, a submodule added and a file and a
// submodule made each other, and the limits that fit it exactly.
const scene = ({ from, parts, sizes, count, shift, patch, printed }: Spec) => {
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

  const entries = [...real, GITLINK, ...submodules(sizes[12] ?? 1, sizes[13] ?? 1)];
  const script: Script = { from: first, to: second, entries, patch, printed: `${printed} ${ZEROS}\n` };
  const sides = entries.flatMap(fileSides);

  return {
    first,
    second,
    real,
    entries,
    script,
    files: entries.length,
    bytes: sides.reduce((total, side) => total + side.size, 0),
    blobs: new Set(sides.map((side) => side.id)),
  };
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
  "P14 a patch id's commands: known, the raw list, the sizes, the patch and `patch-id --verbatim`, in that order, with the limits checked before the content is read",
  SPEC,
  (spec) =>
    Effect.gen(function* () {
      const { first, second, real, script, files, bytes, blobs } = scene(spec);
      const { patch, printed } = spec;
      expect(
        real.map((e) => e.status),
        "every status of the raw list is read",
      ).toEqual(expect.arrayContaining([...STATUSES]));

      const RAW = ["diff-tree", "-r", "-z", "--no-renames", first, second];

      // The two pins before the command: no file passes the content limit, and no attributes file marks a file binary.
      const PATCH = [
        "-c",
        `core.bigFileThreshold=${bytes + 1}`,
        "-c",
        "core.attributesFile=/dev/null",
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
        expect(whole.result.success, "what patch-id printed").toEqual(Option.some(printed));
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
      expect(asked(sizesCall), "the sizes are asked of each blob of the raw list, and of no submodule").toEqual(blobs);

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

      // A raw list of submodules only holds no blob: git is asked no size, and the patch goes on to `patch-id`.
      const linked = yield* Effect.gen(function* () {
        const { repo, stand } = yield* open(patchScript({ ...script, entries: [GITLINK] }), { files, diff: bytes });

        return { result: yield* Effect.result(repo.patchId(first, second)), seen: yield* stand.calls };
      });

      expect(Result.isSuccess(linked.result), "a list of submodules answers").toBe(true);
      expect(commandsSeen(linked.seen), "no size is asked of a list with no blob").toEqual(
        [...OPENING, CHECK, RAW, PATCH, PATCH_ID].map((rest) => [...START, ...rest]),
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

// A call to `patchId` on the stand-in, with the limits and the answers that the scene's script is told to change.
const patching = (
  made: ReturnType<typeof scene>,
  limits: Parameters<typeof settings>[0],
  rest?: (call: Call) => Reply | undefined,
) =>
  Effect.gen(function* () {
    const { repo, stand } = yield* open(patchScript(made.script, rest), limits);

    return { result: yield* Effect.result(repo.patchId(made.first, made.second)), seen: yield* stand.calls };
  });

// Plant: delete the check that each blob of the raw list is a blob git found (a missing one counts as 0 bytes); accept any type
// of object as a blob.
it.effect.prop(
  "P14b a blob git cannot size: a blob it does not find, or finds as another object, fails the call and no patch is printed",
  SPEC,
  (spec) =>
    Effect.gen(function* () {
      const made = scene(spec);

      const sizing = (call: Call): boolean =>
        call.verb === "cat-file" && [...made.blobs].some((id) => asked(call).has(id));

      for (const found of ["missing", "tree", "tag"] as const) {
        // The first blob asked is the one git cannot size as a blob; every other is a small blob. The limits leave room.
        const answer = (call: Call): Reply | undefined =>
          sizing(call)
            ? {
                code: 0,
                stdout: [...asked(call)]
                  .map((id, i) => (i === 0 ? `${id} ${found}${found === "missing" ? "" : " 1"}\n` : `${id} blob 1\n`))
                  .join(""),
              }
            : undefined;

        const { result, seen } = yield* patching(made, { files: made.files, diff: made.bytes + 1000 }, answer);
        expect(Result.isFailure(result), `a blob that is ${found} fails the call`).toBe(true);

        if (Result.isFailure(result)) {
          unavailable(result.failure, Repository.Unreadable, {}, `a blob that is ${found}`);
        }

        expect(
          seen.some((each) => each.verb === "diff-tree" && each.rest.includes("-p")),
          `a blob that is ${found}: no patch is printed`,
        ).toBe(false);
      }
    }),
  { arbitrary: { runs: 100, seed: 119120 } },
);

// Plant: accept a `patch-id` line with no commit id after the patch id, or with more than one; accept a text that is no patch id.
it.effect.prop(
  "P14c a patch-id line: a patch id, a space and one commit id is read; any other line is no answer",
  SPEC,
  (spec) =>
    Effect.gen(function* () {
      const made = scene(spec);
      const limits = { files: made.files, diff: made.bytes };
      const id = spec.printed;

      const good = yield* patching(made, limits);
      expect(Result.isSuccess(good.result), "a patch id and a commit id are read").toBe(true);

      const lines: ReadonlyArray<readonly [string, string]> = [
        ["a patch id alone", `${id}\n`],
        ["a patch id and two more words", `${id} ${ZEROS} ${ZEROS}\n`],
        ["a patch id and an empty word", `${id}  ${ZEROS}\n`],
        ["a text that is no patch id", `z${id.slice(1)} ${ZEROS}\n`],
        ["a space and nothing before it", ` ${ZEROS}\n`],
      ];

      for (const [label, printed] of lines) {
        const { result } = yield* patching(made, limits, (call) =>
          call.verb === "patch-id" ? { code: 0, stdout: printed } : undefined,
        );

        expect(Result.isFailure(result), `${label} is no answer`).toBe(true);

        if (Result.isFailure(result)) {
          unavailable(result.failure, Repository.Unreadable, {}, label);
        }
      }
    }),
  { arbitrary: { runs: 100, seed: 119120 } },
);

// Built when it is called, so this file loads before the product names exist.
const encodeDiff = (files: Diff.Diff) => Schema.encodeSync(Schema.Array(Diff.FileChange))(files);

const encoder = new TextEncoder();

const concat = (...parts: ReadonlyArray<string | Uint8Array>): Uint8Array => {
  const chunks = parts.map((part) => (Predicate.isString(part) ? encoder.encode(part) : part));
  const out = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.length, 0));
  let at = 0;

  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }

  return out;
};

/** The line an entry's section holds, as bytes: text, or the one byte that is no UTF-8 for the entries a law marks. */
type Lines = (index: number) => Uint8Array | string;

// One entry's sections of `diff-tree -p -U0`, as git prints them: a new file, a deleted file, a changed file that is binary (a
// mode change and `Binary files`), and a type change, which is a deleted section and a new one with no newline on its last line.
const sectionText = (entry: Entry, index: number, line: Lines): Uint8Array => {
  const { path } = entry;
  const head = `diff --git a/${path} b/${path}\n`;

  switch (entry.status) {
    case "A":
      return concat(
        head,
        `new file mode ${entry.mode.after}\nindex ${ZEROS}..${entry.id.after}\n--- /dev/null\n+++ b/${path}\n@@ -0,0 +1 @@\n+`,
        line(index),
        "\n",
      );
    case "D":
      return concat(
        head,
        `deleted file mode ${entry.mode.before}\nindex ${entry.id.before}..${ZEROS}\n--- a/${path}\n+++ /dev/null\n@@ -1 +0,0 @@\n-`,
        line(index),
        "\n",
      );
    case "M":
      return concat(
        head,
        `old mode ${entry.mode.before}\nnew mode ${entry.mode.after}\nindex ${entry.id.before}..${entry.id.after}\nBinary files a/${path} and b/${path} differ\n`,
      );
    case "T":
      return concat(
        head,
        `deleted file mode ${entry.mode.before}\nindex ${entry.id.before}..${ZEROS}\n--- a/${path}\n+++ /dev/null\n@@ -1 +0,0 @@\n-`,
        line(index),
        "\n",
        head,
        `new file mode ${entry.mode.after}\nindex ${ZEROS}..${entry.id.after}\n--- /dev/null\n+++ b/${path}\n@@ -0,0 +1 @@\n+target\n\\ No newline at end of file\n`,
      );
  }
};

const patchText = (entries: ReadonlyArray<Entry>, line: Lines): Uint8Array =>
  concat(...entries.map((entry, index) => sectionText(entry, index, line)));

/** What `diff` must answer for the entries of a scene, as plain data. */
const expectedFiles = (entries: ReadonlyArray<Entry>) =>
  entries.map((entry, index) => {
    const before = { mode: entry.mode.before, blob: entry.id.before };
    const after = { mode: entry.mode.after, blob: entry.id.after };
    const removed = ModelDiff.Removed.make({ at: 1, text: `line${index}\n` });
    const added = ModelDiff.Added.make({ at: 1, text: `line${index}\n` });

    if (entry.status === "A") {
      return ModelDiff.New.make({ path: entry.path, after, content: ModelDiff.Text.make({ lines: [added] }) });
    }

    if (entry.status === "D") {
      return ModelDiff.Deleted.make({ path: entry.path, before, content: ModelDiff.Text.make({ lines: [removed] }) });
    }

    // A changed file is binary in the scene, and a type change holds the old line and a link with no newline.
    const content =
      entry.status === "M"
        ? ModelDiff.Binary.make({})
        : ModelDiff.Text.make({ lines: [removed, ModelDiff.Added.make({ at: 1, text: "target" })] });

    return ModelDiff.Modified.make({ path: entry.path, before, after, content });
  });

const lineText: Lines = (index) => `line${index}`;

// The scene of P14 without its submodules: the files the raw list names, in path order as git prints them, one of each status.
const diffScene = (spec: Spec) => {
  const made = scene(spec);

  const real = [...made.real]
    .map((entry, i) => ({ ...entry, path: `${entry.path}-${i}` }))
    .sort((a, b) => byBytes(a.path, b.path));

  const sides = real.flatMap(fileSides);

  return {
    ...made,
    real,
    files: real.length,
    bytes: sides.reduce((total, side) => total + side.size, 0),
    blobs: new Set(sides.map((side) => side.id)),
  };
};

// Plant: run `patch-id` after the patch, red; run `diff-tree -p` before the size check, red; delete the submodule check, or check it after
// the size, (j) red; delete the size check, or count `>=` for `>` on it, (h) red; run the later commands after an empty raw list, red;
// ignore the exit code of the patch, red; delete the check that both commits are known, (i) red; answer a gitlink as a file, (j) red;
// in the reader: delete the section count check, decode a line with replacement, (e) red, or name the last file and not the first, red.
it.effect.prop(
  "P16 a diff's commands: known, the raw list, a files limit, a submodule, the sizes, a size limit, the patch and its lines, in that order and each before the next command; an empty raw list is [] and nothing runs after it",
  SPEC,
  (spec) =>
    Effect.gen(function* () {
      const { first, second, real, script: made, files, bytes, blobs } = diffScene(spec);
      expect(real.map((e) => e.status).sort(), "every status of the raw list is read").toEqual(
        expect.arrayContaining([...STATUSES]),
      );

      const withPatch = (entries: ReadonlyArray<Entry>, patch: Uint8Array) => ({ ...made, entries, patch });
      const good = withPatch(real, patchText(real, lineText));

      const RAW = ["diff-tree", "-r", "-z", "--no-renames", first, second];

      // The two pins before the command: no file passes the content limit, and no attributes file marks a file binary.
      const PATCH = [
        "-c",
        `core.bigFileThreshold=${bytes + 1}`,
        "-c",
        "core.attributesFile=/dev/null",
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

      const ask = (
        scripted: Script,
        limits: Parameters<typeof settings>[0],
        rest?: (call: Call) => Reply | undefined,
      ) =>
        Effect.gen(function* () {
          const { repo, stand } = yield* open(patchScript(scripted, rest), limits);

          return { result: yield* Effect.result(repo.diff(first, second)), seen: yield* stand.calls };
        });

      const ran = (...commands: ReadonlyArray<ReadonlyArray<string>>) =>
        [...OPENING, ...commands].map((rest) => [...START, ...rest]);

      // Exactly at both limits: every command in order, no `patch-id`, and the answer is what the raw list and the patch say.
      const whole = yield* ask(good, { files, diff: bytes });
      expect(Result.isSuccess(whole.result), "at both limits it answers").toBe(true);

      if (Result.isSuccess(whole.result)) {
        expect(encodeDiff(whole.result.success), "the raw list's entries and the patch's lines").toEqual(
          expectedFiles(real),
        );
      }

      expect(commandsSeen(whole.seen), "every command, in order").toEqual(ran(CHECK, RAW, CHECK, PATCH));
      expect(
        whole.seen.some((seen) => seen.piped),
        "no command is a pipe",
      ).toBe(false);
      expect(asked(whole.seen[4]), "the sizes are asked of each blob of the raw list").toEqual(blobs);

      // One entry more than `files`: TooMany, and nothing after the raw list runs.
      const crowded = yield* ask(good, { files: files - 1, diff: bytes });
      expect(Result.isFailure(crowded.result), "one file too many fails").toBe(true);

      if (Result.isFailure(crowded.result)) {
        expectFailure(
          crowded.result.failure,
          Repository.TooMany,
          { limit: "files", most: files - 1 },
          "the files limit",
        );
      }

      expect(commandsSeen(crowded.seen), "no size is asked before the files limit").toEqual(ran(CHECK, RAW));

      // A submodule in the raw list: NotAFile naming its path, before any size is asked, and after the files limit.
      const gitlinks: ReadonlyArray<readonly [string, Entry]> = [
        ["a submodule added", GITLINK],
        ...submodules(1, 1).map((entry): readonly [string, Entry] => [`${entry.path}`, entry]),
      ];

      for (const [label, gitlink] of gitlinks) {
        const entries = [...real, gitlink];
        const scripted = withPatch(entries, patchText(real, lineText));

        const named = yield* ask(scripted, { files: entries.length, diff: 1 });
        expect(Result.isFailure(named.result), `${label} fails`).toBe(true);

        if (Result.isFailure(named.result)) {
          expectFailure(
            named.result.failure,
            Repository.NotAFile,
            { path: gitlink.path },
            `${label} is named, before the size limit`,
          );
        }

        expect(commandsSeen(named.seen), `${label}: no size is asked and no patch is printed`).toEqual(ran(CHECK, RAW));

        const crowdedToo = yield* ask(scripted, { files: entries.length - 1, diff: 1 });
        expect(Result.isFailure(crowdedToo.result), `${label}: over the files limit it fails`).toBe(true);

        if (Result.isFailure(crowdedToo.result)) {
          expectFailure(
            crowdedToo.result.failure,
            Repository.TooMany,
            { limit: "files", most: entries.length - 1 },
            `${label}: the files limit comes first`,
          );
        }
      }

      // Two submodules in one raw list: the first in the list is named, whichever order they come in.
      const other: Entry = { ...GITLINK, path: "sub-module-two", id: { before: ZEROS, after: `${"c".repeat(39)}4` } };

      for (const pair of [
        [GITLINK, other],
        [other, GITLINK],
      ]) {
        const entries = [...real, ...pair];
        const both = yield* ask(withPatch(entries, patchText(real, lineText)), { files: entries.length, diff: bytes });
        expect(Result.isFailure(both.result), "two submodules fail").toBe(true);

        if (Result.isFailure(both.result)) {
          expectFailure(
            both.result.failure,
            Repository.NotAFile,
            { path: pair[0]?.path },
            "the first submodule in the list is named",
          );
        }
      }

      // One byte more than `diff`: DiffTooLarge, and no patch is printed.
      const heavy = yield* ask(good, { files, diff: bytes - 1 });
      expect(Result.isFailure(heavy.result), "one byte too many fails").toBe(true);

      if (Result.isFailure(heavy.result)) {
        expectFailure(heavy.result.failure, Repository.DiffTooLarge, { most: bytes - 1 }, "the diff limit");
      }

      expect(commandsSeen(heavy.seen), "no patch is printed before the size limit").toEqual(ran(CHECK, RAW, CHECK));

      // Nothing changed: the answer is [], and nothing runs after the raw list.
      const quiet = yield* ask(withPatch([], new Uint8Array()), { files, diff: bytes });
      expect(Result.isSuccess(quiet.result) ? quiet.result.success : undefined, "an empty raw list is []").toEqual([]);
      expect(commandsSeen(quiet.seen), "nothing runs after an empty raw list").toEqual(ran(CHECK, RAW));

      // Lines that are not UTF-8: the first file in path order that holds one is named, and a binary file never fails.
      const odd =
        (marked: ReadonlySet<number>): Lines =>
        (index) =>
          marked.has(index) ? Uint8Array.of(0x78, 0xe9) : `line${index}`;

      // The last two files that hold a line are marked, so the first of them is not the first file: it is named, and no later one is.
      const lined = real.flatMap((entry, i) => (entry.status === "M" ? [] : [i]));
      const marked = new Set(lined.slice(-2));
      const firstMarked = real[Math.min(...marked)];
      expect(marked.size, "two files hold lines that are not UTF-8").toBe(2);

      const broken = yield* ask(withPatch(real, patchText(real, odd(marked))), { files, diff: bytes });
      expect(Result.isFailure(broken.result), "lines that are not UTF-8 fail").toBe(true);

      if (Result.isFailure(broken.result)) {
        expectFailure(
          broken.result.failure,
          Repository.NotUtf8,
          { path: firstMarked?.path },
          "the first file in path order is named",
        );
      }

      // A patch with a section more or fewer than the raw list has is no answer, and a failed command is never no change.
      const patched = patchText(real, lineText);
      const fewer = yield* ask(withPatch(real, patchText(real.slice(0, -1), lineText)), { files, diff: bytes });

      const more = yield* ask(withPatch(real, concat(patched, sectionText(real[0] ?? GITLINK, 0, lineText))), {
        files,
        diff: bytes,
      });

      for (const [label, outcome] of [
        ["a section fewer", fewer],
        ["a section more", more],
      ] as const) {
        expect(Result.isFailure(outcome.result), `${label} fails`).toBe(true);

        if (Result.isFailure(outcome.result)) {
          unavailable(outcome.result.failure, Repository.Unreadable, {}, label);
        }
      }

      const fails: ReadonlyArray<readonly [string, (call: Call) => boolean]> = [
        ["the raw list", (call) => call.verb === "diff-tree" && call.rest.includes("-z")],
        ["the patch", (call) => call.verb === "diff-tree" && call.rest.includes("-p")],
      ];

      for (const [label, is] of fails) {
        const failing = yield* ask(good, { files, diff: bytes }, (call) =>
          is(call) ? { code: 128, stderr: "fatal" } : undefined,
        );

        expect(Result.isFailure(failing.result), `${label} that exits 128 fails the call`).toBe(true);

        if (Result.isFailure(failing.result)) {
          unavailable(failing.result.failure, Repository.Exited, { code: 128 }, `${label} exits 128`);
        }
      }

      // The commits are asked about before anything: an unknown id is NoSuchCommit and no other command runs.
      const unknown = yield* ask(good, { files, diff: bytes }, (call) =>
        call.verb === "cat-file" ? { code: 0, stdout: `${first} missing\n` } : undefined,
      );

      expect(Result.isFailure(unknown.result), "an unknown commit fails").toBe(true);

      if (Result.isFailure(unknown.result)) {
        expectFailure(unknown.result.failure, Repository.NoSuchCommit, { id: first }, "the unknown commit is named");
      }

      expect(commandsSeen(unknown.seen), "nothing runs after the commits are found unknown").toEqual(ran(CHECK));
    }),
  { arbitrary: { runs: 100, seed: 119120 } },
);

/** The failure of a call that must fail: an answer is a defect that says so. */
const mustFail = <A, E>(effect: Effect.Effect<A, E>, place: string): Effect.Effect<E> =>
  Effect.flatMap(Effect.result(effect), (result) =>
    Result.isFailure(result)
      ? Effect.succeed(result.failure)
      : Effect.die(new Error(`${place}: the call answered, and it must fail`)),
  );

const treeIdFrom = (text: string): Tree.TreeId => Schema.decodeUnknownSync(Tree.TreeId)(text);

const refNameFrom = (text: string): Ref.RefName => Schema.decodeUnknownSync(Ref.RefName)(text);

const NO_ID = "0".repeat(40);

// Plant: read every failed `update-ref` as `RefMoved` (a ref in the way and an exit with the ref where it was are red);
// read none as `RefInTheWay`; check the clash before the compare, so a ref that moved with a ref below it is the wrong
// error; drop `--no-deref` or put the ids in another order, so the recorded arguments differ; run `update-ref` before
// asking that `to` is a commit; ask `to` as any object, so a tree's id goes through.
it.effect.prop(
  "P9 a failed update-ref: exit 0 is done, and a failed one is RefMoved when the ref is not where from says, RefInTheWay when it is and a ref is in its way, else Exited with the code",
  { a: commitIdArb, part: partArb, code: int(1, 255), junk: wordArb },
  ({ a, part, code, junk }) =>
    Effect.gen(function* () {
      const id = (letter: string): CommitId.CommitId => commitIdFrom(`${letter}${a.slice(1)}`);
      const [to, x, y] = [id("b"), id("c"), id("d")];
      const ref = `refs/kalfa/candidates/c${part}`;
      const inside = `refs/heads/${part}/x`;
      const table = (refs: Table["refs"]): Table => ({ commits: [to, x, y], trees: [id("e")], refs });

      const moved = { label: "RefMoved" } as const;
      const way = (other: string) => ({ label: "RefInTheWay", other }) as const;
      const exited = { label: "Exited" } as const;

      const cases: ReadonlyArray<{
        readonly label: string;
        readonly ref: string;
        readonly from: Option.Option<CommitId.CommitId>;
        readonly refs: Table["refs"];
        readonly expected: typeof moved | ReturnType<typeof way> | typeof exited;
      }> = [
        { label: "from none while the ref exists", ref, from: Option.none(), refs: [[ref, x]], expected: moved },
        {
          label: "from a commit while the ref is at another",
          ref,
          from: Option.some(x),
          refs: [[ref, y]],
          expected: moved,
        },
        { label: "from a commit while the ref is gone", ref, from: Option.some(x), refs: [], expected: moved },
        {
          label: "from a commit while the ref is at another, and a ref is below it",
          ref,
          from: Option.some(x),
          refs: [
            [ref, y],
            [`${ref}/sub`, x],
          ],
          expected: moved,
        },
        {
          label: "from none, the ref gone, a ref below it",
          ref,
          from: Option.none(),
          refs: [[`${ref}/sub`, x]],
          expected: way(`${ref}/sub`),
        },
        {
          label: "from none, the ref gone, a ref at a folder of it",
          ref: inside,
          from: Option.none(),
          refs: [[`refs/heads/${part}`, x]],
          expected: way(`refs/heads/${part}`),
        },
        { label: "from none, the ref gone, nothing in the way", ref, from: Option.none(), refs: [], expected: exited },
        {
          label: "from a commit, the ref at it, nothing in the way",
          ref,
          from: Option.some(x),
          refs: [[ref, x]],
          expected: exited,
        },
      ];

      const updates = (calls: ReadonlyArray<Call>) => calls.filter((call) => call.verb === "update-ref");

      for (const { label, ref: name, from, refs, expected } of cases) {
        const { repo, stand } = yield* open(
          gitTable(table(refs), (call) => (call.verb === "update-ref" ? { code, stderr: junk } : { code: 0 })),
        );

        const error = yield* mustFail(repo.moveRef({ ref: refNameFrom(name), from, to }), label);

        switch (expected.label) {
          case "RefMoved":
            expectFailure(error, Repository.RefMoved, { ref: name }, label);
            break;
          case "RefInTheWay":
            expectFailure(error, Repository.RefInTheWay, { ref: name, other: expected.other }, label);
            break;
          case "Exited":
            unavailable(error, Repository.Exited, { code }, label);
            break;
        }

        expect(
          updates(yield* stand.calls).map((call) => call.rest),
          `${label}: one update-ref, with its ref and both ids`,
        ).toEqual([["--no-deref", name, to, Option.getOrElse(from, () => NO_ID)]]);
      }

      for (const from of [Option.none<CommitId.CommitId>(), Option.some(x)]) {
        const { repo, stand } = yield* open(gitTable(table([[ref, x]]), () => ({ code: 0 })));
        yield* repo.moveRef({ ref: refNameFrom(ref), from, to });

        expect(
          updates(yield* stand.calls).map((call) => call.rest),
          "exit 0 is done: one update-ref, with its ref and both ids",
        ).toEqual([["--no-deref", ref, to, Option.getOrElse(from, () => NO_ID)]]);
      }

      // A `to` that is no commit stops the call before `update-ref` runs.
      for (const [label, absent] of [
        ["a commit the repository lacks", id("f")],
        ["a tree's id", commitIdFrom(id("e"))],
      ] as const) {
        const { repo, stand } = yield* open(gitTable(table([]), () => ({ code: 0 })));

        expectFailure(
          yield* mustFail(repo.moveRef({ ref: refNameFrom(ref), from: Option.none(), to: absent }), label),
          Repository.NoSuchCommit,
          { id: absent },
          label,
        );
        expect(updates(yield* stand.calls), `${label}: nothing was updated`).toEqual([]);
      }
    }),
  { arbitrary: { runs: 200, seed: 119120 } },
);

// Plant: add a newline at the message's end; drop `-w`; put `-t commit` after `--stdin`; hash before asking that the
// tree is a tree and each parent a commit, so a refused write has run `hash-object`; accept any text git printed, so
// output that is no commit id comes back as a commit.
it.effect.prop(
  "P10 the bytes written: writeCommit hands `hash-object -t commit -w --stdin` the bytes of internal/object.ts for the same fields, once the tree and the parents are known; output that is not one commit id is Unreadable",
  {
    a: commitIdArb,
    author: flatSignatureArb,
    person: flatSignatureArb,
    word: wordArb,
    seconds: int(0, 4_000_000_000),
    many: int(0, 3),
  },
  ({ a, author, person, word, seconds, many }) =>
    Effect.gen(function* () {
      const id = (letter: string): CommitId.CommitId => commitIdFrom(`${letter}${a.slice(1)}`);
      const tree = treeIdFrom(`b${a.slice(1)}`);
      const parents = ["c", "d", "e"].slice(0, many).map(id);
      const answer = id("f");
      const committer = committerFrom(person);
      const table: Table = { commits: [...parents, id("a")], trees: [tree], refs: [] };

      const hashes = (calls: ReadonlyArray<Call>) => calls.filter((call) => call.verb === "hash-object");

      const hashing = (stdout: string) =>
        gitTable(table, (call) => (call.verb === "hash-object" ? { code: 0, stdout } : { code: 0 }));

      const signed = new Commit.Signature({
        name: author.name,
        email: author.email,
        at: { seconds: author.seconds, offset: author.offset },
      });

      yield* TestClock.setTime(seconds * 1000 + 999);

      const { repo, stand } = yield* open(hashing(`${answer}\n`), {}, undefined, settings({}, committer));

      for (const [label, message] of messageVariants(word)) {
        if (label === "a NUL") {
          continue;
        }

        const commit = yield* repo.writeCommit({ tree, parents, author: signed, message });
        const call = hashes(yield* stand.calls).at(-1);
        expect(call?.rest, `${label}: the arguments`).toEqual(["-t", "commit", "-w", "--stdin"]);

        expect(call?.input, `${label}: the bytes`).toEqual(
          objectBytes({
            tree,
            parents,
            author: signed,
            committer: new Commit.Signature({ ...committer, at: { seconds, offset: "+0000" } }),
            message,
          }),
        );

        expect(commit.id, `${label}: the id git printed`).toBe(answer);
      }

      for (const [label, stdout] of [
        ["no output", ""],
        ["text that is no id", `not an id ${word}\n`],
        ["two ids", `${answer}\n${answer}\n`],
        ["an id in capitals", `${answer.toUpperCase()}\n`],
      ] as const) {
        const { repo: odd } = yield* open(hashing(stdout), {}, undefined, settings({}, committer));

        unavailable(
          yield* mustFail(odd.writeCommit({ tree, parents, author: signed, message: "m\n" }), label),
          Repository.Unreadable,
          {},
          label,
        );
      }

      // A tree or a parent that is not there, or is an object of another kind, stops the call before anything is written.
      const gone = id("9");

      for (const [label, fields, kind, held] of [
        ["a tree the repository lacks", { tree: treeIdFrom(gone), parents }, Repository.NoSuchTree, { id: gone }],
        ["a commit's id as the tree", { tree: treeIdFrom(id("a")), parents }, Repository.NoSuchTree, { id: id("a") }],
        ["a parent the repository lacks", { tree, parents: [id("a"), gone] }, Repository.NoSuchCommit, { id: gone }],
        [
          "a tree's id as a parent",
          { tree, parents: [id("a"), commitIdFrom(tree)] },
          Repository.NoSuchCommit,
          { id: tree },
        ],
      ] as const) {
        const refused = yield* open(hashing(`${answer}\n`), {}, undefined, settings({}, committer));
        expectFailure(
          yield* mustFail(refused.repo.writeCommit({ ...fields, author: signed, message: "m\n" }), label),
          kind,
          held,
          label,
        );
        expect(hashes(yield* refused.stand.calls), `${label}: nothing was hashed`).toEqual([]);
      }
    }),
  { arbitrary: { runs: 100, seed: 119120 } },
);

const ALLOWED = [
  "version",
  "rev-parse",
  "cat-file",
  "for-each-ref",
  "rev-list",
  "merge-base",
  "merge-tree",
  "hash-object",
  "update-ref",
];

// Plant: run `push` after `update-ref`; run `fetch` after `merge-tree`.
it.effect(
  "P11 scenario: across every call, the git commands that run are plumbing that reads and writes this repository, and none reaches a remote",
  () =>
    Effect.gen(function* () {
      const [a, b] = ["a", "b"].map((letter) => commitIdFrom(letter.repeat(40)));
      const tree = treeIdFrom("c".repeat(40));
      const written = "d".repeat(40);
      const ref = refNameFrom("refs/kalfa/candidates/p11");

      if (a === undefined || b === undefined) {
        return yield* Effect.die("the scenario made no ids");
      }

      const table: Table = { commits: [a, b], trees: [tree], refs: [[ref, a]] };

      const { repo, stand } = yield* open(
        gitTable(table, (call) => {
          switch (call.verb) {
            case "hash-object":
              return { code: 0, stdout: `${written}\n` };
            case "merge-tree":
              return { code: 0, stdout: mergeTreeOutput(tree) };
            default:
              return { code: 0 };
          }
        }),
      );

      const author = new Commit.Signature({
        name: "Ada",
        email: "ada@example.test",
        at: { seconds: 1, offset: "+0000" },
      });

      const calls: ReadonlyArray<Effect.Effect<unknown, unknown>> = [
        repo.readCommit(a),
        repo.readRefs(ref),
        repo.walk({ include: [a], exclude: [b] }),
        repo.mergeBases(a, b),
        repo.isAncestor(a, b),
        repo.writeCommit({ tree, parents: [a], author, message: "m\n" }),
        repo.moveRef({ ref, from: Option.some(a), to: b }),
        repo.mergeTrees({ mergeBase: a, ours: a, theirs: b }),
      ];

      for (const call of calls) {
        yield* Effect.exit(call);
      }

      const verbs = new Set((yield* stand.calls).map((call) => call.verb));
      expect(
        [...verbs].filter((verb) => !ALLOWED.includes(verb)),
        "no command outside the plumbing list",
      ).toEqual([]);
      expect(verbs.has("hash-object") && verbs.has("update-ref"), "the scenario reaches both write commands").toBe(
        true,
      );
      expect(verbs.has("merge-tree"), "the scenario reaches the merge command").toBe(true);
    }),
);

/** The failure of an answer that must be one: an answer is a thrown mistake with the law's words. */
const answerFailure = <A, E>(answer: Result.Result<A, E>, place: string): E => {
  if (Result.isFailure(answer)) {
    return answer.failure;
  }

  throw new Error(`${place}: the call answered, and it must fail`);
};

const RecordedMerges = Schema.Struct({
  git: Schema.String,
  command: Schema.String,
  rows: Schema.Array(
    Schema.Struct({
      note: Schema.String,
      code: Schema.Int,
      output: Schema.String,
      expect: Schema.Struct({ tree: Schema.String, paths: Schema.Array(Schema.String) }),
    }),
  ),
});

/** The paths a conflict names: each once, sorted by their UTF-8 bytes. */
const onceByBytes = (paths: ReadonlyArray<string>): ReadonlyArray<string> => [...new Set(paths)].sort(byBytes);

// vector: git 2.40.1's `merge-tree -z` printed the exit code and the bytes of each row below, and the reader gives the tree
// of a clean merge and the paths of a conflict, each once, sorted by bytes, from the recorded bytes and from the same paths
// listed in another order with one of them twice.
// Plant: delete the check that the output ends in a NUL, so a path with no ending NUL is a path; skip the check of each
// path, so an empty path, `.git` or `a/../b` is a path; split the output on line breaks, so the path with a line break is cut; read exit 1 with no paths as a clean
// merge; keep the paths in the order git printed them, or twice; read any other code as a merge; skip the check that the
// three are commits, so `merge-tree` runs on a commit the repository lacks.
it.effect.prop(
  "P12 merge-tree's output: exit 0 is the tree, exit 1 is a Conflict with its paths once each and sorted by bytes, any other code is Exited, output with no tree is Unreadable, and a commit that is none stops it",
  { a: commitIdArb, junk: wordArb, other: int(2, 255), turn: int(0, 50), repeat: int(0, 50) },
  ({ a, junk, other, turn, repeat }) =>
    Effect.gen(function* () {
      const id = (letter: string): CommitId.CommitId => commitIdFrom(`${letter}${a.slice(1)}`);
      const [base, ours, theirs] = [id("b"), id("c"), id("d")];
      const tree = `e${a.slice(1)}`;
      const table: Table = { commits: [base, ours, theirs], trees: [], refs: [] };

      const ask = (reply: Reply, held: Table = table) =>
        Effect.gen(function* () {
          const { repo, stand } = yield* open(
            gitTable(held, (call) => (call.verb === "merge-tree" ? reply : { code: 0 })),
          );

          return { answer: yield* Effect.result(repo.mergeTrees({ mergeBase: base, ours, theirs })), stand };
        });

      const recorded = Schema.decodeUnknownSync(RecordedMerges)(mergeTreeRows);
      expect(recorded.git).toContain("git version");
      expect(recorded.rows.length, "the list is not empty").toBeGreaterThan(6);
      expect(recorded.rows.filter((row) => row.code === 0).length, "the list holds clean merges").toBeGreaterThan(1);
      expect(recorded.rows.filter((row) => row.code === 1).length, "the list holds conflicts").toBeGreaterThan(4);

      for (const row of recorded.rows) {
        const text = Buffer.from(row.output, "base64").toString("utf8");
        const { answer } = yield* ask({ code: row.code, stdout: text });

        if (row.code === 0) {
          expect(Result.isSuccess(answer) ? answer.success : answer, row.note).toBe(row.expect.tree);

          continue;
        }

        expectFailure(
          answerFailure(answer, row.note),
          Repository.Conflict,
          { paths: onceByBytes(row.expect.paths) },
          row.note,
        );

        // The same paths, in another order and one of them twice: still each once, sorted.
        const paths = row.expect.paths;
        const turned = [...paths.slice(turn % paths.length), ...paths.slice(0, turn % paths.length)];
        const again = mergeTreeOutput(row.expect.tree, [...turned, turned[repeat % turned.length] ?? ""]);
        const scrambled = yield* ask({ code: 1, stdout: again });

        expectFailure(
          answerFailure(scrambled.answer, `${row.note}, scrambled`),
          Repository.Conflict,
          { paths: onceByBytes(paths) },
          `${row.note}, scrambled`,
        );
      }

      // Any other code is no answer, whatever it printed.
      for (const code of [other, 2, 128, 255]) {
        const { answer } = yield* ask({ code, stdout: mergeTreeOutput(tree, ["x"]), stderr: junk });

        unavailable(answerFailure(answer, `exit ${code}`), Repository.Exited, { code }, `exit ${code}`);
      }

      // Output with no tree is unreadable, with either code; so is a conflict that names no path.
      for (const [label, code, stdout] of [
        ["no output, exit 0", 0, ""],
        ["text that is no tree, exit 0", 0, `not a tree ${junk}\0`],
        ["no output, exit 1", 1, ""],
        ["text that is no tree, exit 1", 1, `not a tree ${junk}\0path\0`],
        ["a tree and no ending NUL, exit 0", 0, tree],
        ["a path with no ending NUL, exit 1", 1, `${tree}\0ab`],
        ["an empty path, exit 1", 1, `${tree}\0\0`],
        ["a path that names .git, exit 1", 1, `${tree}\0.git\0`],
        ["a path with a part `..`, exit 1", 1, `${tree}\0a/../b\0`],
      ] as const) {
        const { answer } = yield* ask({ code, stdout });

        unavailable(answerFailure(answer, label), Repository.Unreadable, {}, label);
      }

      const none = yield* ask({ code: 1, stdout: mergeTreeOutput(tree) });
      expectFailure(
        answerFailure(none.answer, "a conflict with no path"),
        Repository.GitUnavailable,
        {},
        "a conflict with no path",
      );

      // A commit that is missing, or an object that is no commit, stops the call before `merge-tree` runs.
      for (const [label, lacking] of [
        ["the merge base", base],
        ["ours", ours],
        ["theirs", theirs],
      ] as const) {
        for (const [kind, held] of [
          ["missing", { ...table, commits: table.commits.filter((commit) => commit !== lacking) }],
          ["a tree", { ...table, commits: table.commits.filter((commit) => commit !== lacking), trees: [lacking] }],
        ] as const) {
          const { answer, stand } = yield* ask({ code: 0, stdout: mergeTreeOutput(tree) }, held);

          expectFailure(
            answerFailure(answer, `${label} ${kind}`),
            Repository.NoSuchCommit,
            { id: lacking },
            `${label} ${kind}`,
          );
          expect(
            (yield* stand.calls).filter((call) => call.verb === "merge-tree"),
            `${label} ${kind}: merge-tree did not run`,
          ).toEqual([]);
        }
      }
    }),
  { arbitrary: { runs: 100, seed: 119120 } },
);

// Plant: delete the gate, so `merge-tree` is recorded on git 2.39; compare the version as text, so 2.100 reads as older;
// run `cat-file` before the gate, so the call has run a command; name no `needs`, or "2.38".
it.effect.prop(
  "P13 the version for merges: a layer opened on git below 2.40 fails mergeTrees with GitTooOld needing 2.40 before it runs a command, and git 2.40 and newer runs merge-tree",
  { major: int(2, 12), minor: int(0, 150), patch: int(0, 20) },
  ({ major, minor, patch }) =>
    Effect.gen(function* () {
      const id = (letter: string): CommitId.CommitId => commitIdFrom(letter.repeat(40));
      const [base, ours, theirs] = [id("a"), id("b"), id("c")];
      const tree = "d".repeat(40);

      const cases: ReadonlyArray<readonly [number, number, number]> = [
        [major, minor, patch],
        [2, 38, 0],
        [2, 39, 3],
        [2, 40, 0],
        [2, 40, 1],
        [2, 100, 0],
        [3, 0, 0],
        [10, 0, 0],
      ];

      for (const [ma, mi, pa] of cases.filter(([x, y]) => isNewEnough(x, y))) {
        for (const label of LABELS) {
          const text = versionText(label, ma, mi, pa);
          const found = `${label} ${ma}.${mi}.${pa}`;

          const { repo, stand } = yield* open((call) =>
            call.verb === "version"
              ? { code: 0, stdout: text }
              : script([base, ours, theirs], 200, (inner) =>
                  inner.verb === "merge-tree" ? { code: 0, stdout: mergeTreeOutput(tree) } : { code: 0 },
                )(call),
          );

          const opened = (yield* stand.calls).length;
          const answer = yield* Effect.result(repo.mergeTrees({ mergeBase: base, ours, theirs }));
          const ran = (yield* stand.calls).slice(opened);

          const merges = ma > 2 || mi >= 40;
          expect(Result.isSuccess(answer), `${found}: merges exactly when it is 2.40 or newer`).toBe(merges);

          if (merges) {
            expect(Result.isSuccess(answer) ? answer.success : answer, `${found}: merges`).toBe(tree);
            expect(
              ran.map((call) => call.verb),
              `${found}: ran merge-tree`,
            ).toContain("merge-tree");
          } else {
            const error = answerFailure(answer, `${found} is too old to merge`);
            unavailable(error, Repository.GitTooOld, { needs: "2.40" }, `${found} is too old to merge`);
            expect(JSON.stringify(error), `${found}: names what it found`).toContain(`${ma}.${mi}.${pa}`);
            expect(ran, `${found}: no command ran`).toEqual([]);
          }
        }
      }
    }),
  { arbitrary: { runs: 200, seed: 119120 } },
);
