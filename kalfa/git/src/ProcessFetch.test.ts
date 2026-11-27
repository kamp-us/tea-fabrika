// The laws of the git-binary adapter's fetch on a stand-in spawner and a recording file system (F10, F11, F13, F14): the commands one fetch
// runs and where each runs, what a named remote's config may say, how a ref at a tag is named, and that the temporary folder is released after
// every ending and never changes what the call answered. Real git answers the same call in ProcessRepository.integration.test.ts.
import { expect, it } from "@effect/vitest";
import {
  Arbitrary,
  Cause,
  ConfigProvider,
  Context,
  Duration,
  Effect,
  Fiber,
  Layer,
  Logger,
  PlatformError,
  Ref as Cell,
  References,
  Result,
  Schema,
} from "effect";
import * as FileSystem from "effect/FileSystem";
import { TestClock } from "effect/testing";
import * as Credentials from "./Credentials.ts";
import { ORIGIN, recorder } from "./Fetch.test-support.ts";
import { commitIdArb, partArb } from "./History.test-support.ts";
import { traced } from "./Laws.test-support.ts";
import * as ProcessRepository from "./ProcessRepository.ts";
import * as Ref from "./Ref.ts";
import * as Remote from "./Remote.ts";
import { expectFailure } from "./Repository.test-support.ts";
import * as Repository from "./Repository.ts";
import { settings } from "./RepositoryTest.ts";
import { standIn, type Call, type Reply } from "./StandIn.test-support.ts";

const int = (minimum: number, maximum: number): Arbitrary.Arbitrary<number> =>
  Arbitrary.schema(Schema.Int.check(Schema.isBetween({ minimum, maximum })));

const PATH = "repo.git";

const GIT_DIR = "/work/repo.git";

const OBJECTS = "/work/repo.git/objects";

const URL = "https://example.test/r.git";

const ID = "a".repeat(40);

const callAt = (calls: ReadonlyArray<Call>, index: number): Call => {
  const call = calls[index];

  if (call === undefined) {
    throw new Error(`the stand-in saw no command ${index}`);
  }

  return call;
};

const refName = (text: string): Ref.RefName => Schema.decodeUnknownSync(Ref.RefName)(text);

/** What the stand-in's git says to each command of a fetch. */
interface World {
  /** What `config --null --get-all remote.origin.url` does. */
  readonly config: Reply;
  /** Whether the repository reads as shallow, in the first command of the transfer. */
  readonly repositoryShallow: boolean;
  /** Whether the fresh directory reads as shallow after the transfer. */
  readonly fetchedShallow: boolean;
  /** What `fetch` does. */
  readonly fetch: Reply;
  /** What `for-each-ref` prints in the fresh directory. */
  readonly refs: string;
}

const GOOD: World = {
  config: { code: 0, stdout: `${URL}\0` },
  repositoryShallow: false,
  fetchedShallow: false,
  fetch: { code: 0 },
  refs: "",
};

const gitDirectory = (call: Call): string =>
  call.args.find((word) => word.startsWith("--git-dir="))?.slice("--git-dir=".length) ?? "";

const script =
  (world: World) =>
  (call: Call): Reply => {
    switch (call.verb) {
      case "version":
        return { code: 0, stdout: "git version 2.40.1\n" };
      case "config":
        return world.config;
      case "rev-parse":
        if (call.rest.includes("--show-object-format")) {
          return { code: 0, stdout: `${world.repositoryShallow}\nsha1\n${GIT_DIR}\n${OBJECTS}\n` };
        }

        return { code: 0, stdout: gitDirectory(call).endsWith("fetch.git") ? `${world.fetchedShallow}\n` : ".\n" };
      case "fetch":
        return world.fetch;
      case "for-each-ref":
        return { code: 0, stdout: world.refs };
      default:
        return { code: 0 };
    }
  };

/** One thing the call did to the file system, and how many commands had run by then. */
interface Event {
  readonly op: "makeTempDirectory" | "writeFileString" | "readDirectory" | "rename" | "remove";
  readonly path: string;
  readonly other?: string | undefined;
  readonly data?: string;
  readonly options?: unknown;
  readonly commands: number;
}

type Removal = "removes" | "fails" | "hangs";

/** The packs a fetch leaves in the fresh directory, in no helpful order, beside a half-written one. */
const LISTING = ["pack-1.idx", "tmp_pack_x", "pack-1.pack", "pack-1.rev"];

const unsupported = PlatformError.badArgument({
  module: "FileSystem",
  method: "remove",
  description: "the recorder refuses",
});

// What a removal does once it is noted: it ends, it fails, or it never ends.
const ending = (removal: Removal): Effect.Effect<void, PlatformError.PlatformError> => {
  switch (removal) {
    case "removes":
      return Effect.void;
    case "fails":
      return Effect.fail(unsupported);
    case "hangs":
      return Effect.never;
  }
};

const recording = (stand: { readonly calls: Effect.Effect<ReadonlyArray<Call>> }, removal: Removal) =>
  Effect.gen(function* () {
    const events = yield* Cell.make<ReadonlyArray<Event>>([]);
    let made = 0;

    const note = (event: Omit<Event, "commands">) =>
      Effect.flatMap(stand.calls, (calls) =>
        Cell.update(events, (all) => [...all, { ...event, commands: calls.length }]),
      );

    const makeTempDirectory: FileSystem.FileSystem["makeTempDirectory"] = (options) => {
      const folder = `${options?.directory}/${options?.prefix}${(made += 1)}`;

      return Effect.as(
        note({ op: "makeTempDirectory", path: options?.directory ?? "", other: options?.prefix, data: folder }),
        folder,
      );
    };

    const remove: FileSystem.FileSystem["remove"] = (path, options) =>
      Effect.andThen(note({ op: "remove", path, options }), ending(removal));

    const layer = FileSystem.layerNoop({
      makeTempDirectory,
      // As the Node file system makes one: the release removes the folder, and dies when the removal fails, which no time limit can drop.
      makeTempDirectoryScoped: (options) =>
        Effect.acquireRelease(makeTempDirectory(options), (dir) => Effect.orDie(remove(dir, { recursive: true }))),
      writeFileString: (path, data) => note({ op: "writeFileString", path, data }),
      readDirectory: (path) => Effect.as(note({ op: "readDirectory", path }), [...LISTING]),
      rename: (from, to) => note({ op: "rename", path: from, other: to }),
      remove,
    });

    return { layer, events: Cell.get(events) };
  });

const open = (world: World, removal: Removal, limits: Parameters<typeof settings>[0] = {}) =>
  Effect.gen(function* () {
    const stand = yield* standIn(script(world));
    const disk = yield* recording(stand, removal);

    const context = yield* Layer.build(
      ProcessRepository.layer({ path: PATH, settings: settings(limits) }).pipe(
        Layer.provide(Layer.mergeAll(stand.layer, disk.layer)),
      ),
    );

    return { repo: Context.get(context, Repository.Repository), stand, disk };
  }).pipe(Effect.provide(ConfigProvider.layer(ConfigProvider.fromEnv({ env: { PATH: "/usr/bin:/bin" } }))));

type FetchFailure = Effect.Error<ReturnType<Repository.Repository["Service"]["fetch"]>>;

const named = Remote.named(ORIGIN);

const under = refName("refs/heads/main");

const ask = (repo: Repository.Repository["Service"], remote: Remote.Remote = named, wanted = under) =>
  Effect.result(repo.fetch({ remote, under: wanted }).pipe(Effect.provide(Credentials.none)));

const folderMade = (events: ReadonlyArray<Event>): string =>
  events.find((event) => event.op === "makeTempDirectory")?.data ?? "";

// Plant (F10): run the transfer with the repository's `--git-dir`; leave the alternates file out; init with no `--object-format`; rename the
// `.idx` first; rename after a HistoryTooShort; drop `--update-shallow`; drop `--`; drop `protocol.allow=never`; ask the slot after `fetch`.
it.effect.prop(
  "F10 scenario: a fetch by name reads the configured URL in the repository, then runs the transfer in a fresh git directory inside the repository's own, with the flags and the environment the plan gives, renames the pack in only after a good answer, and runs no transfer when the slot fails or the repository is shallow",
  { id: commitIdArb, part: partArb },
  ({ id, part }) =>
    Effect.gen(function* () {
      const branch = refName(`refs/heads/${part}`);
      const world: World = { ...GOOD, refs: `${id} commit  refs/fetched/refs/heads/${part}\n` };
      const { repo, stand, disk } = yield* open(world, "removes");
      const result = yield* ask(repo, named, branch);

      expect(Result.isSuccess(result), "the call answers").toBe(true);

      if (Result.isSuccess(result)) {
        expect(result.success.map((ref) => [ref.name, ref.commit])).toEqual([[branch, id]]);
      }

      const commands = (yield* stand.calls).slice(2);
      const events = yield* disk.events;
      const tmp = folderMade(events);
      const fresh = `${tmp}/fetch.git`;

      expect(
        commands.map((call) => call.verb),
        "the commands, in order",
      ).toEqual(["config", "rev-parse", "init", "fetch", "rev-parse", "for-each-ref"]);

      const config = callAt(commands, 0);
      const probe = callAt(commands, 1);
      const init = callAt(commands, 2);
      const transfer = callAt(commands, 3);
      const shallow = callAt(commands, 4);
      const listing = callAt(commands, 5);
      expect(gitDirectory(config), "the config is read in the repository").toBe(PATH);
      expect(config.rest).toEqual(["--null", "--get-all", "remote.origin.url"]);
      expect(gitDirectory(probe), "the four questions are asked in the repository").toBe(PATH);

      expect(probe.rest).toEqual([
        "--is-shallow-repository",
        "--show-object-format",
        "--absolute-git-dir",
        "--path-format=absolute",
        "--git-path",
        "objects",
      ]);

      for (const call of [init, transfer, shallow, listing]) {
        expect(gitDirectory(call), `${call.verb} runs in the fresh directory, never in the repository`).toBe(fresh);
      }

      expect(
        tmp.startsWith(`${GIT_DIR}/kalfa-fetch-`),
        "the folder is made inside the repository's git directory",
      ).toBe(true);
      expect(events.find((event) => event.op === "makeTempDirectory")?.path).toBe(GIT_DIR);
      expect(events.find((event) => event.op === "makeTempDirectory")?.other).toBe("kalfa-fetch-");
      expect(init.rest, "init takes the repository's hash format").toEqual([
        "--bare",
        "--quiet",
        "--template=",
        "--object-format=sha1",
      ]);

      const pins = (call: Call): ReadonlyArray<string> =>
        call.args.flatMap((word, at) => (call.args[at - 1] === "-c" ? [word] : []));

      for (const pin of [
        "protocol.allow=never",
        "protocol.file.allow=always",
        "protocol.https.allow=always",
        "transfer.unpackLimit=1",
      ]) {
        expect(pins(transfer), `the transfer pins ${pin}`).toContain(pin);
      }

      expect(transfer.rest, "the flags, the URL as read and one refspec").toEqual([
        "--quiet",
        "--no-tags",
        "--no-write-fetch-head",
        "--no-recurse-submodules",
        "--update-shallow",
        "--no-auto-gc",
        "--no-auto-maintenance",
        "--no-write-commit-graph",
        "--",
        URL,
        `+${branch}*:refs/fetched/${branch}*`,
      ]);

      expect(shallow.rest).toEqual(["--is-shallow-repository"]);

      expect(listing.rest.slice(0, 2)).toEqual([
        "--count=1001",
        "--format=%(objectname) %(objecttype) %(symref) %(refname)",
      ]);
      expect(listing.rest.at(-1), "the scratch refs are listed under the scratch prefix").toBe(
        `refs/fetched/${branch}`,
      );

      // The environment: what every other command gets, and `GIT_ASKPASS` set to nothing for the transfer alone.
      const ordinary = config.env;
      expect(Object.keys(ordinary).length, "an ordinary command has an environment").toBeGreaterThan(2);
      expect(transfer.env, "the transfer").toEqual({ ...ordinary, GIT_ASKPASS: "" });

      for (const call of [init, shallow, listing, probe]) {
        expect(call?.env, `${call.verb} gets the ordinary environment`).toEqual(ordinary);
      }

      expect(transfer.extendEnv).toBe(false);

      // The folder, in order: made, the alternates file written after `init`, the packs listed, the pack's files renamed `.pack`, `.rev`, `.idx`
      // into the repository's object folder, and the folder removed.
      expect(
        events.map((event) => event.op),
        "the file system, in order",
      ).toEqual(["makeTempDirectory", "writeFileString", "readDirectory", "rename", "rename", "rename", "remove"]);

      const written = events[1];
      expect(written?.path).toBe(`${fresh}/objects/info/alternates`);
      expect(written?.data, "the alternates file names the repository's object folder").toBe(`${OBJECTS}\n`);
      const everyCall = yield* stand.calls;
      expect(everyCall[(written?.commands ?? 0) - 1]?.verb, "the file is written right after `init`").toBe("init");
      expect(everyCall[written?.commands ?? 0]?.verb, "and before `fetch`").toBe("fetch");
      expect(events[2]?.path).toBe(`${fresh}/objects/pack`);

      expect(events.slice(3, 6).map((event) => [event.path, event.other])).toEqual([
        [`${fresh}/objects/pack/pack-1.pack`, `${OBJECTS}/pack/pack-1.pack`],
        [`${fresh}/objects/pack/pack-1.rev`, `${OBJECTS}/pack/pack-1.rev`],
        [`${fresh}/objects/pack/pack-1.idx`, `${OBJECTS}/pack/pack-1.idx`],
      ]);

      expect(events[6]).toMatchObject({ op: "remove", path: tmp, options: { recursive: true } });

      // A fetch by URL reads no config: the URL goes to git as it is.
      const byUrl = yield* open(world, "removes");
      const given = Schema.decodeUnknownSync(Remote.Url)("file:///some/where.git");
      yield* ask(byUrl.repo, Remote.url(given), branch);
      const verbs = (yield* byUrl.stand.calls).slice(2).map((call) => call.verb);
      expect(verbs, "no config is read for a URL").toEqual(["rev-parse", "init", "fetch", "rev-parse", "for-each-ref"]);
      expect((yield* byUrl.stand.calls).find((call) => call.verb === "fetch")?.rest).toContain(given);
    }),
  { arbitrary: { runs: 20, seed: 119120 } },
);

// Plant (F10): ask the slot after `fetch`; make the folder before the slot is asked; read the shallow answer after making the folder.
it.effect(
  "F10b scenario: a slot that fails, and a repository that is shallow, leave the folder unmade and the transfer unrun, and a failed transfer renames no pack",
  () =>
    Effect.gen(function* () {
      // (p) the slot fails: the configured URL is read, the slot is asked, and nothing else runs.
      const refused = yield* open(GOOD, "removes");
      const slot = yield* recorder("fails");

      const failed = yield* Effect.result(
        refused.repo.fetch({ remote: named, under }).pipe(Effect.provide(slot.layer)),
      );

      expect(Result.isFailure(failed), "a slot that fails fails the call").toBe(true);

      if (Result.isFailure(failed)) {
        expectFailure(failed.failure, Credentials.NoCredential, { url: URL }, "NoCredential names the URL");
      }

      expect(
        (yield* refused.stand.calls).slice(2).map((call) => call.verb),
        "only the config was read",
      ).toEqual(["config"]);
      expect(yield* refused.disk.events, "no folder was made").toEqual([]);

      // (q) the repository is shallow: the first question says so, and no folder is made and nothing is fetched.
      const shallow = yield* open({ ...GOOD, repositoryShallow: true }, "removes");
      const answer = yield* ask(shallow.repo);
      expect(Result.isFailure(answer) && Schema.is(Repository.HistoryTooShort)(answer.failure), "HistoryTooShort").toBe(
        true,
      );
      const verbs = (yield* shallow.stand.calls).slice(2).map((call) => call.verb);
      expect(verbs, "no transfer").toEqual(["config", "rev-parse"]);
      expect(yield* shallow.disk.events, "no folder was made").toEqual([]);

      // (v) a transfer that exits 1 or 128 fails with the code and what git said, and never answers `[]`.
      for (const code of [1, 128]) {
        const exited = yield* open({ ...GOOD, fetch: { code, stderr: `git said ${code}` } }, "removes");
        const result = yield* ask(exited.repo);
        expect(Result.isFailure(result), `exit ${code}: the call fails`).toBe(true);

        if (Result.isFailure(result)) {
          expectFailure(
            result.failure,
            Remote.FetchFailed,
            { url: URL, code, stderr: `git said ${code}` },
            `exit ${code}`,
          );
        }
      }

      // A failure after the transfer renames no pack, whatever it is.
      const endings: ReadonlyArray<readonly [string, World, Parameters<typeof settings>[0]]> = [
        ["a fetch that exits 128", { ...GOOD, fetch: { code: 128, stderr: "fatal: no repository" } }, {}],
        ["a cut remote", { ...GOOD, fetchedShallow: true }, {}],
        ["a ref at a tag", { ...GOOD, refs: `${ID} tag  refs/fetched/refs/heads/main\n` }, {}],
        [
          "more refs than the limit",
          {
            ...GOOD,
            refs: `${ID} commit  refs/fetched/refs/heads/main\n${ID} commit  refs/fetched/refs/heads/main/x\n`,
          },
          { refs: 1 },
        ],
      ];

      for (const [label, world, limits] of endings) {
        const failing = yield* open(world, "removes", limits);
        const result = yield* ask(failing.repo);
        expect(Result.isFailure(result), `${label}: the call fails`).toBe(true);
        const events = yield* failing.disk.events;
        expect(
          events.filter((event) => event.op === "rename"),
          `${label}: no pack is renamed`,
        ).toEqual([]);
        expect(events.at(-1)?.op, `${label}: the folder is removed last`).toBe("remove");
      }
    }),
);

// Plant (F11): read the value with `--get`, the last one, so two URLs read as one; put the configured text in the failure.
it.effect.prop(
  "F11 a named remote's config: exit 1 fails NoSuchRemote, two URLs fail BadRemoteUrl several, and a URL with a user and a password fails BadRemoteUrl refused, with no field, span or log holding any part of what was configured, and no transfer run",
  { part: partArb },
  ({ part }) =>
    Effect.gen(function* () {
      const secret = `s3cret-${part}-canary`;
      const logs: Array<string> = [];

      const logger = Logger.make((entry) => {
        logs.push(JSON.stringify([entry.message, Cause.pretty(entry.cause)]));
      });

      const cases: ReadonlyArray<readonly [string, Reply, (error: FetchFailure) => void]> = [
        [
          "no such remote",
          { code: 1 },
          (error) => expectFailure(error, Remote.NoSuchRemote, { remote: ORIGIN }, "exit 1 is NoSuchRemote"),
        ],
        [
          "two URLs",
          { code: 0, stdout: `https://a.test/${secret}.git\0https://b.test/${secret}.git\0` },
          (error) => expectFailure(error, Remote.BadRemoteUrl, { remote: ORIGIN, reason: "several" }, "two URLs"),
        ],
        [
          "a user and a password",
          { code: 0, stdout: `https://user:${secret}@host.test/r.git\0` },
          (error) => expectFailure(error, Remote.BadRemoteUrl, { remote: ORIGIN, reason: "refused" }, "a password"),
        ],
      ];

      for (const [label, config, expected] of cases) {
        const { repo, stand, disk } = yield* open({ ...GOOD, config }, "removes");

        const made = yield* traced(
          ask(repo).pipe(
            Effect.provide(Logger.layer([logger])),
            Effect.provideService(References.MinimumLogLevel, "All"),
          ),
        );

        expect(Result.isFailure(made.answer), `${label}: the call fails`).toBe(true);

        if (Result.isFailure(made.answer)) {
          expected(made.answer.failure);

          const text = [
            String(made.answer.failure),
            JSON.stringify(made.answer.failure),
            Cause.pretty(Cause.fail(made.answer.failure)),
            JSON.stringify(made.spans.map((span) => [span.name, [...span.attributes], span.events])),
            ...logs,
          ].join("\n");

          for (const hidden of [secret, "user:", "host.test", "a.test", "b.test"]) {
            expect(text.includes(hidden), `${label}: no output holds "${hidden}"`).toBe(false);
          }
        }

        const read = (yield* stand.calls).slice(2);
        expect(
          read.map((call) => call.verb),
          `${label}: only the config was read`,
        ).toEqual(["config"]);
        expect(read[0]?.rest, `${label}: it asks for every value of the key, with each ended by a NUL`).toEqual([
          "--null",
          "--get-all",
          "remote.origin.url",
        ]);
        expect(yield* disk.events, `${label}: no folder was made`).toEqual([]);
      }
    }),
  { arbitrary: { runs: 50, seed: 119120 } },
);

// Plant (F13): name the scratch ref in the failure.
it.effect.prop(
  "F13 a remote ref at a tag object fails RefNotCommit naming the remote's ref, never the scratch ref",
  { id: commitIdArb, part: partArb },
  ({ id, part }) =>
    Effect.gen(function* () {
      const branch = refName(`refs/heads/${part}`);
      const { repo } = yield* open({ ...GOOD, refs: `${id} tag  refs/fetched/${branch}\n` }, "removes");
      const result = yield* ask(repo, named, branch);

      expect(Result.isFailure(result), "the call fails").toBe(true);

      if (Result.isFailure(result)) {
        expectFailure(
          result.failure,
          Repository.RefNotCommit,
          { ref: branch, points: "tag" },
          "the remote's ref is named",
        );
      }
    }),
  { arbitrary: { runs: 50, seed: 119120 } },
);

/** The ways a fetch ends, each by what the stand-in says, and what the call then is. */
const ENDINGS: ReadonlyArray<
  readonly [label: string, world: World, limits: Parameters<typeof settings>[0], is: (error: FetchFailure) => boolean]
> = [
  ["an answer", { ...GOOD, refs: `${ID} commit  refs/fetched/refs/heads/main\n` }, {}, () => false],
  ["FetchFailed, exit 1", { ...GOOD, fetch: { code: 1, stderr: "error" } }, {}, Schema.is(Remote.FetchFailed)],
  ["FetchFailed, exit 128", { ...GOOD, fetch: { code: 128, stderr: "fatal" } }, {}, Schema.is(Remote.FetchFailed)],
  [
    "TooMany",
    { ...GOOD, refs: `${ID} commit  refs/fetched/refs/heads/main\n${ID} commit  refs/fetched/refs/heads/main/x\n` },
    { refs: 1 },
    Schema.is(Repository.TooMany),
  ],
  ["HistoryTooShort", { ...GOOD, fetchedShallow: true }, {}, Schema.is(Repository.HistoryTooShort)],
  [
    "RefNotCommit",
    { ...GOOD, refs: `${ID} tag  refs/fetched/refs/heads/main\n` },
    {},
    Schema.is(Repository.RefNotCommit),
  ],
];

// Lets every fiber that can run, run, before the clock moves.
const settle = Effect.forEach(Array.from({ length: 50 }), () => Effect.yieldNow, { concurrency: 1, discard: true });

const REMOVALS: ReadonlyArray<Removal> = ["removes", "fails", "hangs"];

// Plant (F14): read exit 1 as an answer; remove the folder only after an answer; use `makeTempDirectoryScoped`, whose release dies on a failing
// remove; let the removal's failure replace the call's own; leave the release unbounded, so a hanging removal holds the call.
it.effect.prop(
  "F14 the folder is released after every ending: an answer, FetchFailed with exit 1 and with exit 128, TooMany, HistoryTooShort, RefNotCommit and TimedOut; a removal that fails or hangs past limits.kill never changes the call's own answer or failure, and the call ends within limits.time plus limits.kill",
  { time: int(2, 3600), share: int(0, 3600) },
  ({ time, share }) =>
    Effect.gen(function* () {
      // The kill wait is shorter than the time limit, so an answer that waits for a hanging removal is still inside its limit.
      const kill = 1 + (share % (time - 1));
      const reached: Array<string> = [];
      const limit = Duration.seconds(time);
      const wait = Duration.seconds(kill);

      for (const removal of REMOVALS) {
        for (const [label, world, limits, is] of [
          ...ENDINGS,
          ["TimedOut", { ...GOOD, fetch: "hang" as const }, {}, Schema.is(Repository.TimedOut)] as const,
        ]) {
          const place = `${label}, a removal that ${removal}`;

          const { repo, disk } = yield* open(world, removal, {
            time: `${time} seconds`,
            kill: `${kill} seconds`,
            ...limits,
          });

          const fiber = yield* Effect.forkDetach(ask(repo));
          yield* settle;
          yield* TestClock.adjust(Duration.millis(1));
          yield* settle;

          if (label === "TimedOut") {
            yield* TestClock.adjust(limit);
            yield* settle;
          }

          if (removal === "hangs") {
            expect(fiber.pollUnsafe(), `${place}: the release holds the call`).toBeUndefined();
            yield* TestClock.adjust(wait);
            yield* settle;
          }

          expect(fiber.pollUnsafe(), `${place}: the call has ended within limits.time plus limits.kill`).toBeDefined();
          const result = yield* Fiber.join(fiber);
          reached.push(place);

          if (label === "an answer") {
            expect(Result.isSuccess(result), `${place}: it answers`).toBe(true);
          } else {
            expect(Result.isFailure(result) && is(result.failure), `${place}: it fails as the ending says`).toBe(true);
          }

          const removed = (yield* disk.events).filter((event) => event.op === "remove");
          expect(removed.length, `${place}: the folder is removed once`).toBe(1);
          expect(removed[0], `${place}: the folder that was made, with everything in it`).toMatchObject({
            path: folderMade(yield* disk.events),
            options: { recursive: true },
          });
        }
      }

      expect(reached.length, "every ending and every removal").toBe(REMOVALS.length * (ENDINGS.length + 1));
    }),
  { arbitrary: { runs: 20, seed: 119120 } },
);
