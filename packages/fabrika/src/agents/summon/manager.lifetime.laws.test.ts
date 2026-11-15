import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Cause, Duration, Effect, Exit, Fiber, Option, type Scope, Stream } from "effect";
import * as fc from "fast-check";
import { afterEach, describe, expect, it } from "vitest";
import { fileStorage } from "../../program/storage-node.ts";
import type { Storage } from "../../program/storage.ts";
import { SummonManager, SummonRefused } from "../../shell/summon.ts";
import { summonManager } from "./manager.ts";
import { openNames } from "./names.ts";

// The agent helpers plan (docs/plan/quests/dock-PLAN.md), laws L4 to L6, today's version. A helper
// lives while its name is summoned and up. Down, cut off before it was kept, dismissed, or its host
// stopped: its process ends. A turn's end ends nothing (T1: the agent keeps running between turns).
//
//   summon fake as scout       the fake starts: `pid 4242` in <repo>/.fake-acp/pids
//   @scout hello               ... result; 4242 still answers, and the next turn is its
//   dismiss scout              4242 is gone within 4 s, and scout's run is gone from storage
//
// On the real manager and the fake ACP agent (../acp/fake-agent.ts), a child process with no model,
// in a fresh git repository and a fresh storage folder per run, both under the temp folder.
//
// Every process this file asks about is one a fake it started wrote into its own folder's `pids`
// file. It sends no signal: `process.kill(pid, 0)` only asks whether that pid is there (`alive`).
// The ending is the product's, through Effect's spawner, to the group of the child it spawned.

const PERSON = "user:owner";
const TIME = 300_000;
/** How long an ended helper may take to go: the spawner's SIGTERM, then its SIGKILL after 3 s. */
const GONE_WITHIN = Duration.seconds(4);
const made: string[] = [];

afterEach(() => {
  for (const folder of made.splice(0)) {
    rmSync(folder, { recursive: true, force: true });
  }
});

/** A fresh git repository with a file to read, and an empty folder beside it for the host's storage. */
const place = () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "summon-lifetime-")));
  made.push(root);
  const folder = join(root, "repo");
  mkdirSync(folder);
  execFileSync("git", ["init", "-q"], { cwd: folder });
  writeFileSync(join(folder, "a.txt"), "The river is called Kura.\n");
  const disk = join(root, "storage");
  return { folder, disk, storage: fileStorage(disk) };
};

/** The pid of each fake started in `folder`, in order, as each wrote its own. */
const pidsOf = (folder: string): readonly number[] => {
  const at = join(folder, ".fake-acp", "pids");
  return existsSync(at)
    ? readFileSync(at, "utf8")
        .split("\n")
        .flatMap((line) => {
          const m = /^pid (\d+)$/.exec(line);
          return m === null ? [] : [Number(m[1])];
        })
    : [];
};

/**
 * Whether the process `pid` is there. Signal 0 sends nothing; it only asks. The pid must be one a
 * fake wrote in this test's own folder (`pidsOf`), never this process or pid 1.
 */
const alive = (pid: number): boolean => {
  if (!Number.isInteger(pid) || pid <= 1 || pid === process.pid) {
    throw new Error(`not a pid a fake of this test wrote: ${pid}`);
  }

  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    // EPERM: a process is there, someone else's. ESRCH: none is.
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
};

/** The pids of `pids` still there once `GONE_WITHIN` has passed, or once none is. */
const leftAfter = (pids: readonly number[]) =>
  Effect.gen(function* () {
    const deadline = Date.now() + Duration.toMillis(GONE_WITHIN);

    while (Date.now() < deadline && pids.some(alive)) {
      yield* Effect.sleep(Duration.millis(50));
    }

    return pids.filter(alive);
  });

/** The acp runs that have a record in the storage folder: `run/<run>/record/<slot>`, each part encoded. */
const acpRunsIn = (disk: string): readonly string[] =>
  existsSync(disk)
    ? [
        ...new Set(
          readdirSync(disk).flatMap((file) => {
            const key = decodeURIComponent(decodeURIComponent(file));
            const m = /^run\/(acp:[^/]+)\/record\//.exec(key);
            return m?.[1] === undefined ? [] : [m[1]];
          }),
        ),
      ]
    : [];

/** The names kept in `storage`, read once no host holds them. */
const keptIn = (storage: Storage) =>
  Effect.runPromise(Effect.scoped(Effect.map(openNames(storage), (names) => names.now().names)));

/** One host's life: the manager on `storage`, in `folder`, until `body` is done. */
const hosted = <A, E>(storage: Storage, folder: string, body: Effect.Effect<A, E, SummonManager | Scope.Scope>) =>
  Effect.runPromise(body.pipe(Effect.scoped, Effect.provide(summonManager({ storage, folder }))));

/** Wait until `check` holds, `seconds` at most. */
const until = (what: string, check: () => boolean, seconds = 15) =>
  Effect.gen(function* () {
    for (let i = 0; i < seconds * 50; i += 1) {
      if (check()) {
        return;
      }

      yield* Effect.sleep(Duration.millis(20));
    }

    return yield* Effect.die(`waited ${seconds} seconds for ${what}`);
  });

/** Wait until the manager lists `name` in `state`. */
const listedAs = (name: string, state: string) =>
  Effect.gen(function* () {
    const manager = yield* SummonManager;

    for (let i = 0; i < 750; i += 1) {
      if ((yield* manager.list).some((s) => s.name === name && s.state === state)) {
        return;
      }

      yield* Effect.sleep(Duration.millis(20));
    }

    return yield* Effect.die(`waited 15 seconds for ${name} to be ${state}`);
  });

const summon = (name: string, settings: readonly string[] = []) =>
  Effect.gen(function* () {
    const manager = yield* SummonManager;
    return yield* manager.summon({ agent: "fake", settings, name, by: PERSON });
  });

const turned = (name: string, prompt: string) =>
  Effect.gen(function* () {
    const manager = yield* SummonManager;
    return yield* manager.turn(name, prompt, null).pipe(Stream.runCollect);
  });

// ---------------------------------------------------------------- L4

/** A kept setting the fake no longer offers, by which one it is. */
const RETIRED = {
  model: { model: { typed: "fake-retired", resolved: "fake-retired" } },
  effort: { effort: { typed: "extreme", set: "extreme" } },
} as const;

describe("L4: a name that reopens down holds no process", () => {
  it(
    "is listed down with its why, its helper is gone within 4 s, its record stays, and a dismiss of it still works",
    async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            refused: fc.constantFrom("model" as const, "effort" as const),
            later: fc.integer({ min: 0, max: 300 }),
            turnWhileDown: fc.boolean(),
          }),
          async ({ refused, later, turnWhileDown }) => {
            const { folder, disk, storage } = place();
            await hosted(storage, folder, summon("scout", ["fake-large", "high"]));
            const [first] = await keptIn(storage);
            expect(first?.name).toBe("scout");

            // The next host finds a kept setting the fake no longer offers, as when a harness drops
            // a model between two host starts.
            await Effect.runPromise(
              Effect.scoped(
                Effect.gen(function* () {
                  const names = yield* openNames(storage);
                  yield* names.free("scout");
                  yield* names.take({ ...first!, ...RETIRED[refused] });
                }),
              ),
            );
            await Effect.runPromise(Effect.sleep(Duration.millis(later)));

            const down = await hosted(
              storage,
              folder,
              Effect.gen(function* () {
                yield* listedAs("scout", "down");
                yield* until("the reopened fake's pid", () => pidsOf(folder).length === 2);
                const turn = turnWhileDown
                  ? yield* Effect.exit(turned("scout", "read a.txt").pipe(Effect.timeout(Duration.seconds(15))))
                  : null;
                const left = yield* leftAfter(pidsOf(folder).slice(1));
                return { turn, left, record: yield* storage.record(first!.run) };
              }),
            );

            if (down.turn !== null) {
              const refusal = Exit.isFailure(down.turn) ? Cause.findErrorOption(down.turn.cause) : Option.none();
              expect(Option.getOrNull(refusal), "a turn to a down name is refused, with why").toBeInstanceOf(
                SummonRefused,
              );
            }

            expect(down.left, "the down name's helper still runs").toEqual([]);
            expect(down.record, "its acp session stays, for the next host to open").not.toBeNull();
            expect((await keptIn(storage)).map((n) => [n.name, n.run])).toEqual([["scout", first!.run]]);

            // A host after that finds it down again, and a dismiss of it works.
            const dismissed = await hosted(
              storage,
              folder,
              Effect.gen(function* () {
                const manager = yield* SummonManager;
                yield* listedAs("scout", "down");
                yield* manager.dismiss("scout", PERSON);
                return yield* manager.list;
              }),
            );
            expect(dismissed).toEqual([]);
            expect(await keptIn(storage)).toEqual([]);
            expect(acpRunsIn(disk)).toEqual([]);
            expect(await Effect.runPromise(leftAfter(pidsOf(folder)))).toEqual([]);
          },
        ),
        { numRuns: 20 },
      );
    },
    TIME,
  );
});

// ---------------------------------------------------------------- L5

describe("L5: a turn's end ends nothing", () => {
  it(
    "after each of one to four turns the same helper answers, and the next turn is its",
    async () => {
      await fc.assert(
        fc.asyncProperty(fc.integer({ min: 1, max: 4 }), async (turns) => {
          const { folder, storage } = place();
          const seen = await hosted(
            storage,
            folder,
            Effect.gen(function* () {
              yield* summon("scout");
              const [pid] = pidsOf(folder);
              const after: { readonly pids: readonly number[]; readonly alive: boolean; readonly stop: unknown }[] = [];

              for (let n = 1; n <= turns; n += 1) {
                // A turn to a helper that went away may never answer: it fails here, not at the test's limit.
                const news = yield* turned("scout", `turn ${n}: read a.txt`).pipe(
                  Effect.timeout(Duration.seconds(15)),
                  Effect.exit,
                );
                const stop = Exit.isSuccess(news) ? news.value.at(-1) : `no result: ${String(news.cause)}`;
                after.push({ pids: pidsOf(folder), alive: alive(pid!), stop });

                if (!Exit.isSuccess(news)) {
                  break;
                }
              }

              return { pid, after };
            }),
          );

          for (const [n, one] of seen.after.entries()) {
            expect(one.stop, `turn ${n + 1} ended`).toMatchObject({ _tag: "result", stop: "end_turn" });
            expect(one.pids, `after turn ${n + 1}, no second helper was started`).toEqual([seen.pid]);
            expect(one.alive, `after turn ${n + 1}, the helper still runs`).toBe(true);
          }

          // Every turn went to the one session that one helper opened.
          const prompts = readFileSync(join(folder, ".fake-acp", "log"), "utf8")
            .split("\n")
            .filter((l) => l.startsWith("prompt "))
            .map((l) => l.split(" "));
          expect(prompts.map((p) => p[2])).toEqual(Array.from({ length: turns }, (_, i) => String(i + 1)));
          expect(new Set(prompts.map((p) => p[1])).size).toBe(1);
        }),
        { numRuns: 20 },
      );
    },
    TIME,
  );
});

// ---------------------------------------------------------------- L6

/** Where a summon is cut off: once its helper started, once its session opened, or a moment later, through its settings and its keep. */
const cutAt$ = fc.constantFrom("open" as const, "opening" as const, "settle" as const);

/** Setting words the fake refuses, each refused once the session is open (`sorted`). */
const refusedWords$ = fc.constantFrom<readonly string[]>(
  ["fake-gone"],
  ["fake-large", "extreme"],
  ["fake-gone", "high"],
);

const exit$ = fc.oneof(
  fc.record({ _tag: fc.constant("interrupt" as const), at: cutAt$, later: fc.integer({ min: 0, max: 150 }) }),
  fc.record({ _tag: fc.constant("refuse" as const), words: refusedWords$ }),
  fc.record({ _tag: fc.constant("dismiss" as const), state: fc.constantFrom("opening", "idle", "turn", "asking") }),
  fc.record({ _tag: fc.constant("stop" as const), up: fc.integer({ min: 1, max: 3 }) }),
);

type Exit6 = typeof exit$ extends fc.Arbitrary<infer A> ? A : never;

/** The sessions the fake opened, one file each. */
const sessionsIn = (folder: string) => {
  const at = join(folder, ".fake-acp");
  return existsSync(at) ? readdirSync(at).filter((f) => f.endsWith(".jsonl")) : [];
};

/** A summon cut off by an interrupt or refused: what was listed after, the helpers left, the runs kept. */
const cut = (folder: string, disk: string, storage: Storage, how: Extract<Exit6, { _tag: "interrupt" | "refuse" }>) =>
  hosted(
    storage,
    folder,
    Effect.gen(function* () {
      const manager = yield* SummonManager;
      /** A refused summon fails as a refusal, never another way. A cut one has nothing to say here. */
      let refusedAsOne = true;

      if (how._tag === "refuse") {
        refusedAsOne = (yield* Effect.flip(summon("scout", how.words))) instanceof SummonRefused;
      } else {
        const fiber = yield* summon("scout", ["fake-large", "high"]).pipe(Effect.forkChild);

        if (how.at === "open") {
          yield* until("the fake to start", () => pidsOf(folder).length > 0);
        } else {
          yield* until("the fake's session", () => sessionsIn(folder).length > 0);
          yield* Effect.sleep(Duration.millis(how.at === "settle" ? how.later : 0));
        }

        yield* Fiber.interrupt(fiber);
      }

      const listed = (yield* manager.list).map((s) => s.name);
      // A summon that was kept before the cut came is listed, and its helper runs: that is no leak.
      const own = listed.includes("scout") ? pidsOf(folder).slice(0, 1) : [];
      const left = yield* leftAfter(pidsOf(folder).filter((pid) => !own.includes(pid)));
      return { refusedAsOne, listed, left, runs: acpRunsIn(disk) };
    }),
  );

/** Dismiss scout while it is in `state`. */
const dismissIn = (folder: string, disk: string, storage: Storage, state: string) =>
  Effect.gen(function* () {
    if (state === "opening") {
      // A name is listed while it opens only as a host starts again: the host before kept it.
      yield* Effect.promise(() => hosted(storage, folder, summon("scout")));
    }

    return yield* Effect.promise(() =>
      hosted(
        storage,
        folder,
        Effect.gen(function* () {
          const manager = yield* SummonManager;

          if (state !== "opening") {
            yield* summon("scout");
          }

          if (state === "turn" || state === "asking") {
            yield* manager
              .turn("scout", state === "turn" ? "slowly read a.txt" : "write", null)
              .pipe(Stream.runDrain, Effect.ignore, Effect.forkChild);
            yield* listedAs("scout", state);
          }

          yield* manager.dismiss("scout", PERSON);
          const left = yield* leftAfter(pidsOf(folder));
          return { listed: (yield* manager.list).map((s) => s.name), left, runs: acpRunsIn(disk) };
        }),
      ),
    );
  });

describe("L6: every exit ends the helper and leaves none", () => {
  it(
    "a summon cut off or refused, a dismiss in any state, and the host stopping each leave no helper and no unlisted run",
    async () => {
      await fc.assert(
        fc.asyncProperty(exit$, async (how) => {
          const { folder, disk, storage } = place();

          if (how._tag === "interrupt" || how._tag === "refuse") {
            const seen = await cut(folder, disk, storage, how);
            expect(seen.refusedAsOne, "a refused summon fails as a refusal").toBe(true);
            expect(seen.left, "a helper of a summon that was not kept still runs").toEqual([]);
            expect(seen.runs, "only a listed name has a run in storage").toHaveLength(seen.listed.length);
            return;
          }

          if (how._tag === "dismiss") {
            const seen = await Effect.runPromise(dismissIn(folder, disk, storage, how.state));
            expect(seen.listed).toEqual([]);
            expect(seen.left, `a helper dismissed while ${how.state} still runs`).toEqual([]);
            expect(seen.runs, "a dismissed name's run is gone from storage").toEqual([]);
            return;
          }

          // The host stops with one to three names up: its scope closes every name's.
          const names = Array.from({ length: how.up }, (_, i) => `scout-${i + 1}`);
          await hosted(
            storage,
            folder,
            Effect.gen(function* () {
              for (const name of names) {
                yield* summon(name);
              }

              yield* until("every helper's pid", () => pidsOf(folder).length === names.length);
            }),
          );
          expect(await Effect.runPromise(leftAfter(pidsOf(folder))), "a helper outlived its host").toEqual([]);
          const kept = await keptIn(storage);
          expect(kept.map((n) => n.name).sort()).toEqual(names);
          // Each kept name keeps its run for the next host, and no run is kept that no name holds.
          expect([...acpRunsIn(disk)].sort()).toEqual(kept.map((n) => n.run).sort());
        }),
        { numRuns: 30 },
      );
    },
    TIME,
  );
});
