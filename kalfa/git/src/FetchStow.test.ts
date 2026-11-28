// F18: what `make` does with the two parts of an adapter's fetch, on a stand-in `Raw` whose `fetch` and `stow` hold at a gate. The read (`fetch`) runs inside
// the time limit; the `stow` it hands back runs once, after the read answered, outside the limit and with interrupts held off, so no fetch is cut between
// its files. The stand-in writes each step it takes to a log, and the scope it was given closes after the stow. No git runs here: the laws of what a real
// adapter's stow does are in ProcessFetch.test.ts and, on real git, in ProcessRepository.integration.test.ts.
import { expect, it } from "@effect/vitest";
import { Arbitrary, Deferred, Duration, Effect, Exit, Fiber, Ref as Cell, Result, Schema, type Scope } from "effect";
import { TestClock } from "effect/testing";
import { CommitId } from "./CommitId.ts";
import * as Credentials from "./Credentials.ts";
import { ORIGIN } from "./Fetch.test-support.ts";
import { commitIdArb } from "./History.test-support.ts";
import * as Ref from "./Ref.ts";
import * as Remote from "./Remote.ts";
import { expectFailure } from "./Repository.test-support.ts";
import * as Repository from "./Repository.ts";
import { settings } from "./RepositoryTest.ts";

const int = (minimum: number, maximum: number): Arbitrary.Arbitrary<number> =>
  Arbitrary.schema(Schema.Int.check(Schema.isBetween({ minimum, maximum })));

const URL = Schema.decodeUnknownSync(Remote.Url)("https://example.test/r.git");

const under = Schema.decodeUnknownSync(Ref.RefName)("refs/heads/main");

// Lets every fiber that can run, run, before the clock moves.
const settle = Effect.forEach(Array.from({ length: 50 }), () => Effect.yieldNow, { concurrency: 1, discard: true });

/** A step that waits where a law says: it tells the law it is there, and goes on when the law opens it. */
const gate = Effect.gen(function* () {
  const reached = yield* Deferred.make<void>();
  const opened = yield* Deferred.make<void>();

  return { reached, opened, hold: Effect.andThen(Deferred.succeed(reached, undefined), Deferred.await(opened)) };
});

/** What the stand-in's read does, and what its stow does. */
interface Script {
  readonly read: "answers" | "holds" | "fails";
  readonly stow: "ends" | "holds" | "fails";
}

const unused = (): Effect.Effect<never> => Effect.die("this law calls nothing but a fetch");

const refused = new Repository.GitUnavailable({ reason: new Repository.Unreadable({ cause: new Error("refused") }) });

/** A repository made by `make` on a stand-in adapter that logs each step it takes. */
const open = (script: Script, time: number, id: string) =>
  Effect.gen(function* () {
    const log = yield* Cell.make<ReadonlyArray<string>>([]);
    const note = (step: string) => Cell.update(log, (all) => [...all, step]);
    const reading = yield* gate;
    const stowing = yield* gate;
    const answered = [new Ref.Ref({ name: under, commit: Schema.decodeUnknownSync(CommitId)(id) })];

    const stow: Effect.Effect<void, Repository.GitUnavailable> = Effect.gen(function* () {
      yield* note("stow started");

      if (script.stow === "holds") {
        yield* stowing.hold;
      }

      if (script.stow === "fails") {
        return yield* refused;
      }

      yield* note("stow ended");
    });

    const raw: Repository.Raw = {
      readCommit: unused,
      readRefs: unused,
      walk: unused,
      mergeBases: unused,
      isAncestor: unused,
      patchId: unused,
      readFile: unused,
      diff: unused,
      editTree: unused,
      writeCommit: unused,
      moveRef: unused,
      mergeTrees: unused,
      remoteUrl: () => Effect.succeed(URL),
      fetch: (): Effect.Effect<Repository.Fetched, Remote.FetchFailed, Scope.Scope> =>
        Effect.gen(function* () {
          yield* note("read started");
          yield* Effect.addFinalizer(() => note("scope closed"));

          if (script.read === "holds") {
            yield* reading.hold;

            return yield* Effect.never;
          }

          if (script.read === "fails") {
            return yield* new Remote.FetchFailed({ url: URL, code: 128, stderr: "fatal" });
          }

          yield* note("read answered");

          return { refs: answered, stow };
        }),
    };

    const repo = Repository.make(raw, settings({ time: `${time} seconds` }));

    return { repo, log: Cell.get(log), reading, stowing, answered };
  });

const ask = (repo: Repository.Repository["Service"]) =>
  Effect.result(repo.fetch({ remote: Remote.named(ORIGIN), under }).pipe(Effect.provide(Credentials.none)));

const STEPS = {
  clean: ["read started", "read answered", "stow started", "stow ended", "scope closed"],
  cutInRead: ["read started", "scope closed"],
  refusedStow: ["read started", "read answered", "stow started", "scope closed"],
} as const;

// Plant (F18): keep `stow` inside `limited`, wrapped in `Effect.uninterruptible`, so the limit firing in the stow answers `TimedOut` after it ran, "the limit fires
// in the stow" red; run `stow` interruptibly outside the limit, so a caller's interrupt cuts it, "the caller interrupts in the stow" red; run `stow` in a finalizer
// after every ending, so the limit firing in the read, and a read that fails, run it, "the limit fires in the read" and "the read fails" red; run it with `Effect.ignore`,
// so a refused stow answers the refs, "the stow fails" red; run it before the read's answer or twice, the log's order or count red.
it.effect.prop(
  "F18 make stows once and never cuts it: the limit firing in fetch answers TimedOut and stow never runs; the limit firing in stow lets it end and the call answers the refs; a caller interrupt in stow lets it end; stow runs once, only after fetch answered; the scope fetch was given closes after stow ends, and on every failure",
  { time: int(2, 3600), id: commitIdArb },
  ({ time, id }) =>
    Effect.gen(function* () {
      const reached: Array<string> = [];

      // The limit fires while the read holds: the call fails `TimedOut`, the stow never ran, and the scope closed.
      {
        const { repo, log, reading } = yield* open({ read: "holds", stow: "ends" }, time, id);
        const fiber = yield* Effect.forkDetach(ask(repo));
        yield* Deferred.await(reading.reached);
        yield* settle;
        yield* TestClock.adjust(Duration.seconds(time));
        yield* settle;
        const result = yield* Fiber.join(fiber);

        expect(Result.isFailure(result), "the limit fires in the read: the call fails").toBe(true);

        if (Result.isFailure(result)) {
          expectFailure(
            result.failure,
            Repository.TimedOut,
            { after: Duration.seconds(time) },
            "the limit fires in the read",
          );
        }

        expect(yield* log, "the limit fires in the read: stow never runs, and the scope closes").toEqual(
          STEPS.cutInRead,
        );
        reached.push("the limit fires in the read");
      }

      // The limit fires while the stow holds: nothing cuts it, so it ends and the call answers the refs.
      {
        const { repo, log, stowing, answered } = yield* open({ read: "answers", stow: "holds" }, time, id);
        const fiber = yield* Effect.forkDetach(ask(repo));
        yield* Deferred.await(stowing.reached);
        yield* settle;
        yield* TestClock.adjust(Duration.seconds(time));
        yield* settle;
        yield* TestClock.adjust(Duration.seconds(time));
        yield* settle;

        expect(fiber.pollUnsafe(), "the limit fires in the stow: the call is still in it").toBeUndefined();
        expect(yield* log, "the scope stays open while the stow runs").not.toContain("scope closed");

        yield* Deferred.succeed(stowing.opened, undefined);
        const result = yield* Fiber.join(fiber);

        expect(Result.isSuccess(result), "the limit fires in the stow: the call answers").toBe(true);

        if (Result.isSuccess(result)) {
          expect(result.success, "the limit fires in the stow: it answers the read's refs").toEqual(answered);
        }

        expect(yield* log, "the read answered, the stow ran once to its end, then the scope closed").toEqual(
          STEPS.clean,
        );
        reached.push("the limit fires in the stow");
      }

      // A caller interrupts while the stow holds: it ends, and only then does the interrupt land.
      {
        const { repo, log, stowing } = yield* open({ read: "answers", stow: "holds" }, time, id);
        const fiber = yield* Effect.forkDetach(ask(repo));
        yield* Deferred.await(stowing.reached);
        const interrupting = yield* Effect.forkDetach(Fiber.interrupt(fiber));
        yield* settle;

        expect(fiber.pollUnsafe(), "the caller interrupts in the stow: the call is still in it").toBeUndefined();

        yield* Deferred.succeed(stowing.opened, undefined);
        yield* Fiber.join(interrupting);
        const exit = yield* Fiber.await(fiber);

        expect(
          Exit.isFailure(exit) && Exit.hasInterrupts(exit),
          "the caller interrupts in the stow: it answers nothing",
        ).toBe(true);
        expect(yield* log, "the stow ran to its end, then the scope closed").toEqual(STEPS.clean);
        reached.push("the caller interrupts in the stow");
      }

      // The read fails: the stow never runs and the scope closes.
      {
        const { repo, log } = yield* open({ read: "fails", stow: "ends" }, time, id);
        const result = yield* ask(repo);

        expect(Result.isFailure(result), "the read fails: the call fails").toBe(true);

        if (Result.isFailure(result)) {
          expectFailure(result.failure, Remote.FetchFailed, { url: URL, code: 128 }, "the read fails");
        }

        expect(yield* log, "the read fails: stow never runs, and the scope closes").toEqual(STEPS.cutInRead);
        reached.push("the read fails");
      }

      // The stow fails: the call fails with it, never answering the refs, and the scope closes.
      {
        const { repo, log } = yield* open({ read: "answers", stow: "fails" }, time, id);
        const result = yield* ask(repo);

        expect(Result.isFailure(result), "the stow fails: the call fails").toBe(true);

        if (Result.isFailure(result)) {
          expect(result.failure, "the stow fails: with the stow's own failure").toEqual(refused);
        }

        expect(yield* log, "the stow fails: it ran once, never ended, and the scope closes").toEqual(STEPS.refusedStow);
        reached.push("the stow fails");
      }

      expect(reached, "the law reached every hold").toEqual([
        "the limit fires in the read",
        "the limit fires in the stow",
        "the caller interrupts in the stow",
        "the read fails",
        "the stow fails",
      ]);
    }),
  { arbitrary: { runs: 50, seed: 119120 } },
);
