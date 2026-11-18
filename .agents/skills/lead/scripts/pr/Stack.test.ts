// Today's lead tooling. The laws of `land.ts stack` (ticket 1115) on the test layers: nothing here
// asks GitHub. The selected prefix is pinned while GitHub handles the native stack merge. And since
// merge when ready is not offered for a stacked pull request
// (github/gh-stack#591), each layer passes `arm`'s gates here or the stack is not merged at all.
import { describe, expect, it } from "@effect/vitest";
import { Recorder } from "@kampus/vitest";
import { Effect, Layer, Option } from "effect";
import { Checks, type Job } from "../ci/Checks.ts";
import * as PullRequestsTest from "./PullRequestsTest.ts";
import { LeakGrepRefused, Pushes } from "./Pushes.ts";
import * as Stack from "./Stack.ts";

/** A head for layer `n`: forty hex digits, one per layer. */
const head = (n: number) => String(n % 10).repeat(40);

const NAMED = "## What this does\n\n- A layer.\n\n## New names\n\n- None.\n";

type World = {
  /** The queue's `max_entries_to_build` on main; none means main has no queue. */
  readonly build?: number;
  /** The layer whose net change the leak grep refuses. */
  readonly leaky?: number;
  /** The layer left as a draft. */
  readonly draft?: number;
  /** The layer that exports a new name with no `## New names` section. */
  readonly unnamed?: number;
  /** How `ci-required` stands at a layer's head, by layer: a finished success when absent. */
  readonly required?: ReadonlyMap<number, Option.Option<Job>>;
};

const GREEN: Job = { id: 1, status: "completed", conclusion: "success" };

/** A three-layer stack: layers 11, 12 and 13, bottom first, each open, ready and named. */
const memory = (w: World = {}) => {
  const github = PullRequestsTest.world(
    [11, 12, 13].map((number) => ({
      number,
      head: `fabrikalfa/layer-${number}`,
      oid: head(number),
      state: "OPEN",
      draft: number === w.draft,
    })),
  );

  github.stacks.push({
    number: 1522,
    base: "main",
    prs: [11, 12, 13].map((number) => ({ number, oid: head(number) })),
  });

  if (w.build !== undefined) {
    github.queues.set("main", { build: w.build, merge: 3, method: "SQUASH" });
  }

  for (const number of [11, 12, 13]) {
    const exports = number === w.unnamed;
    github.more.set(number, {
      base: number === 11 ? "main" : `fabrikalfa/layer-${number - 1}`,
      title: `Layer ${number}`,
      body: exports ? "## What this does\n\n- A layer.\n" : NAMED,
    });
    github.patches.set(number, [
      {
        path: `src/layer${number}.ts`,
        patch: `@@ -0,0 +1,1 @@\n+${exports ? "export const Leaked = 1" : "const x = 1"}`,
      },
    ]);
  }

  // A Layer.mock stand-in that refuses only the leaky layer's head, as leakgrep.sh would.
  const leakyHead = w.leaky === undefined ? "" : head(w.leaky);

  const refuse = (at: string) =>
    at === leakyHead ? Effect.fail(new LeakGrepRefused({ reason: "leakgrep.sh exited 1" })) : Effect.void;

  const pushes = Recorder.layer(Pushes, {
    leakGrep: (_dir, at) => refuse(at),
    leakChange: (_dir, at) => refuse(at),
    leakText: () => Effect.void,
    push: () => Effect.void,
  });

  // A Layer.mock stand-in for the required check, answering by head as GitHub's check runs do.
  const byHead = new Map([11, 12, 13].map((n) => [head(n), w.required?.get(n) ?? Option.some(GREEN)]));

  const checks = Recorder.layer(Checks, {
    job: (at) => Effect.succeed(byHead.get(at) ?? Option.none()),
    log: () => Effect.succeed(""),
  });

  return { github, layer: Layer.mergeAll(PullRequestsTest.layer(github), pushes, checks) };
};

const land = (m: ReturnType<typeof memory>, top: number) =>
  Effect.result(Stack.land({ dir: ".", top })).pipe(Effect.provide(m.layer));

const stackCalls = (m: ReturnType<typeof memory>) => m.github.calls.filter((call) => call._tag === "stack");

describe("Stack.land: gates and pins the selected native stack prefix (ticket 1115)", () => {
  it.effect("scenario: three open layers reach the adapter when the queue builds two", () =>
    Effect.gen(function* () {
      const m = memory({ build: 2 });
      const answer = yield* land(m, 13);
      expect(answer).toEqual(
        expect.objectContaining({
          _tag: "Success",
          success: Stack.Landed.cases.pending.make({
            top: 13,
            base: "main",
            prs: [11, 12, 13],
            uuid: "fixture-merge-request",
            expectedHeadSha: head(13),
            mergeAction: "merge_queue",
            mergeMethod: "default",
          }),
        }),
      );
      expect(stackCalls(m).map((call) => call.heads.map((pin) => pin.number))).toEqual([[11, 12, 13]]);
    }),
  );

  it.effect("scenario: a ready prefix through the middle layer excludes an upper draft", () =>
    Effect.gen(function* () {
      const m = memory({ build: 2, draft: 13 });
      const answer = yield* land(m, 12);
      expect(answer).toEqual(
        expect.objectContaining({
          _tag: "Success",
          success: Stack.Landed.cases.pending.make({
            top: 12,
            base: "main",
            prs: [11, 12],
            uuid: "fixture-merge-request",
            expectedHeadSha: head(12),
            mergeAction: "merge_queue",
            mergeMethod: "default",
          }),
        }),
      );
      expect(stackCalls(m)).toEqual([
        PullRequestsTest.Call.cases.stack.make({
          top: 12,
          heads: [
            { number: 11, oid: head(11) },
            { number: 12, oid: head(12) },
          ],
        }),
      ]);
    }),
  );

  it.effect("scenario: a merged bottom layer skips gates while the two open layers stay selected", () =>
    Effect.gen(function* () {
      const m = memory({ build: 2 });
      m.github.prs.splice(0, 1, {
        number: 11,
        head: "fabrikalfa/layer-11",
        oid: head(11),
        state: "MERGED",
        draft: false,
      });
      const answer = yield* land(m, 13);
      expect(answer._tag).toBe("Success");
      expect(stackCalls(m).map((call) => call.heads.map((pin) => pin.number))).toEqual([[12, 13]]);
    }),
  );

  it.effect("scenario: a merged top without a merge commit is not reported as landed", () =>
    Effect.gen(function* () {
      const m = memory();
      m.github.prs.splice(
        0,
        3,
        ...[11, 12, 13].map((number) => ({
          number,
          head: `fabrikalfa/layer-${number}`,
          oid: head(number),
          state: "MERGED" as const,
          draft: false,
        })),
      );
      const answer = yield* land(m, 13);

      expect(answer._tag).toBe("Failure");
      expect(answer._tag === "Failure" ? answer.failure.reason : "").toContain("returned no merge commit");
      expect(stackCalls(m)).toEqual([]);
    }),
  );

  it.effect("scenario: a merged top with open lower layers is not reported as a complete stack", () =>
    Effect.gen(function* () {
      const m = memory();
      m.github.prs.splice(2, 1, {
        number: 13,
        head: "fabrikalfa/layer-13",
        oid: head(13),
        state: "MERGED",
        draft: false,
      });
      m.github.more.set(13, {
        base: "fabrikalfa/layer-12",
        title: "Layer 13",
        body: NAMED,
        mergeCommit: "f".repeat(40),
      });
      const answer = yield* land(m, 13);

      expect(answer._tag).toBe("Failure");
      expect(answer._tag === "Failure" ? answer.failure.reason : "").toContain("selected lower layers 11, 12 are not");
      expect(stackCalls(m)).toEqual([]);
    }),
  );

  // Plant: skip the leak gate on the layers, and the leaky middle layer's stack is asked for.
  it.effect("scenario: a layer with a leak hit refuses the whole stack, and nothing is merged", () =>
    Effect.gen(function* () {
      const m = memory({ build: 3, leaky: 12 });
      const answer = yield* land(m, 13);
      expect(answer._tag).toBe("Failure");
      expect(answer._tag === "Failure" ? answer.failure._tag : "").toBe("LeakGrepRefused");
      expect(stackCalls(m)).toEqual([]);
    }),
  );

  // Plant: skip the names check on the layers, and the top layer's new export is merged unnamed.
  it.effect("scenario: a layer that exports a new name with no ## New names section refuses the whole stack", () =>
    Effect.gen(function* () {
      const m = memory({ build: 3, unnamed: 13 });
      const answer = yield* land(m, 13);
      expect(answer._tag).toBe("Failure");
      const reason = answer._tag === "Failure" ? answer.failure.reason : "";
      expect(reason).toContain("pr 13:");
      expect(reason).toContain("Leaked");
      expect(stackCalls(m)).toEqual([]);
    }),
  );

  it.effect("scenario: with no merge queue, a large stack still reaches the direct merge adapter", () =>
    Effect.gen(function* () {
      const m = memory();
      const answer = yield* land(m, 13);
      expect(answer._tag).toBe("Success");
      expect(stackCalls(m)).toHaveLength(1);
    }),
  );

  // Plant: drop the ci-required read, and the middle layer's stack is asked for and this law goes red.
  it.effect(
    "scenario: a stack whose middle layer has no ci-required at its head is refused, naming that layer, and nothing is merged",
    () =>
      Effect.gen(function* () {
        const m = memory({ build: 3, required: new Map([[12, Option.none()]]) });
        const answer = yield* land(m, 13);
        expect(answer._tag).toBe("Failure");
        const failure = answer._tag === "Failure" ? answer.failure : undefined;
        expect(failure).toEqual(new Stack.RequiredNotGreen({ top: 13, pr: 12, oid: head(12), state: "missing" }));
        expect(failure?.reason).toBe(
          `stack of pr 13: pr 12: ci-required is missing at ${head(12)}, not a success; nothing was merged`,
        );
        expect(stackCalls(m)).toEqual([]);
      }),
  );

  it.effect("scenario: a layer whose ci-required has not ended, or ended red, refuses with pending or failed", () =>
    Effect.gen(function* () {
      const pending = memory({
        build: 3,
        required: new Map([[11, Option.some({ ...GREEN, status: "in_progress", conclusion: null })]]),
      });

      const failed = memory({ build: 3, required: new Map([[13, Option.some({ ...GREEN, conclusion: "failure" })]]) });
      const first = yield* land(pending, 13);
      const second = yield* land(failed, 13);
      expect(first._tag === "Failure" ? first.failure : undefined).toEqual(
        new Stack.RequiredNotGreen({ top: 13, pr: 11, oid: head(11), state: "pending" }),
      );
      expect(second._tag === "Failure" ? second.failure : undefined).toEqual(
        new Stack.RequiredNotGreen({ top: 13, pr: 13, oid: head(13), state: "failed" }),
      );
      expect([...stackCalls(pending), ...stackCalls(failed)]).toEqual([]);
    }),
  );

  it.effect("scenario: a stack with ci-required success at every layer's head reaches the adapter", () =>
    Effect.gen(function* () {
      const m = memory({ build: 3 });
      const answer = yield* land(m, 13);
      expect(answer._tag).toBe("Success");
      expect(stackCalls(m).map((call) => call.heads.map((pin) => pin.oid))).toEqual([[head(11), head(12), head(13)]]);
    }),
  );
});
