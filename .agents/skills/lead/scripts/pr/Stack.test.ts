// Today's lead tooling. The laws of `land.ts stack` (ticket 1115) on the test layers: nothing here
// asks GitHub. A stack lands whole through the merge queue only if its open layers fit what the
// queue builds at once; on 2026-11-16 a 4-layer stack entered a queue that builds 2 and lost its
// upper layers. And since merge when ready is not offered for a stacked pull request
// (github/gh-stack#591), each layer passes `arm`'s gates here or the stack is not merged at all.
import { describe, expect, it } from "@effect/vitest";
import { Recorder } from "@kampus/vitest";
import { Effect, Layer } from "effect";
import * as PullRequestsGh from "./PullRequestsGh.ts";
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
  /** The layer that exports a new name with no `## New names` section. */
  readonly unnamed?: number;
};

/** Stack 1522's shape: layers 11, 12 and 13, bottom first, each open, ready and named. */
const memory = (w: World = {}) => {
  const github = PullRequestsTest.world(
    [11, 12, 13].map((number) => ({
      number,
      head: `fabrikalfa/layer-${number}`,
      oid: head(number),
      state: "OPEN",
      draft: false,
    })),
  );

  github.stacks.push({ number: 1522, base: "main", prs: [11, 12, 13] });

  if (w.build !== undefined) {
    github.queues.set("main", { build: w.build, merge: 3 });
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

  return { github, layer: Layer.mergeAll(PullRequestsTest.layer(github), pushes) };
};

const land = (m: ReturnType<typeof memory>, top: number) =>
  Effect.result(Stack.land({ dir: ".", top })).pipe(Effect.provide(m.layer));

const stackCalls = (m: ReturnType<typeof memory>) => m.github.calls.filter((call) => call._tag === "stack");

describe("Stack.land: a stack lands only if it fits one merge group (ticket 1115)", () => {
  // Plant: drop the size check, and the stack of 3 is asked for and this law goes red.
  it.effect(
    "scenario: a stack of 3 open layers on a queue that builds 2 is refused, naming 3 and 2, and nothing is merged",
    () =>
      Effect.gen(function* () {
        const m = memory({ build: 2 });
        const answer = yield* land(m, 13);
        expect(answer._tag).toBe("Failure");
        const reason = answer._tag === "Failure" ? answer.failure.reason : "";
        expect(reason).toContain("3 open pull requests (11, 12, 13)");
        expect(reason).toContain("more than the 2 the main merge queue builds at once");
        expect(reason).toContain("Split the stack, or land it layer by layer");
        expect(stackCalls(m)).toEqual([]);
      }),
  );

  it.effect(
    "scenario: a stack of 2 open layers on a queue that builds 2 is asked for, pinned to each layer's head",
    () =>
      Effect.gen(function* () {
        const m = memory({ build: 2 });
        const answer = yield* land(m, 12);
        expect(answer).toEqual(
          expect.objectContaining({
            _tag: "Success",
            success: Stack.Landed.cases.asked.make({ top: 12, base: "main", prs: [11, 12] }),
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

  it.effect("scenario: a merged bottom layer does not count: 2 open layers of 3 fit a queue that builds 2", () =>
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

  it.effect("scenario: with no merge queue on the base, the stack merges directly, whatever its size", () =>
    Effect.gen(function* () {
      const m = memory();
      const answer = yield* land(m, 13);
      expect(answer._tag).toBe("Success");
      expect(stackCalls(m)).toHaveLength(1);
    }),
  );

  // Plant: let moved() answer null, and a layer pushed after its gates ran is merged unread.
  it("scenario: the stack merge refuses a layer that is not at the head its gates read", () => {
    const pinned = [
      { number: 11, oid: head(11) },
      { number: 12, oid: head(12) },
    ];

    expect(PullRequestsGh.moved(pinned, pinned)).toBeNull();
    expect(
      PullRequestsGh.moved(
        [
          { number: 11, oid: head(11) },
          { number: 12, oid: head(9) },
        ],
        pinned,
      ),
    ).toContain("pr 12");
  });
});
