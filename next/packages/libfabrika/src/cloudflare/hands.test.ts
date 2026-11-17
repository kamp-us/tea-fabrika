// P39 slice 3 (ticket 1040), next/, C1: the Process-side `HandsTasks` over the Project RPC, at its RPC
// handles, as `mail.test.ts` exercises mail. A good reply decodes strictly into the same `Reply`; a
// lost, failed or undecodable reply, or one with a field the contract does not have, is
// `unavailable`, which leaves the Cmd dispatched for its retry, never a refusal the program would
// read. The layer is `handsLayer(env, project)` in `hands.ts`, beside `mailLayer`.
// Plant (after build): map an RPC failure to `refused no_hands`.
import { expect, it } from "@effect/vitest";
import { Effect, Result, Schema } from "effect";
import * as fc from "fast-check";
import type { From } from "../processes/Mailbox.ts";
import { HandsTasks, HandsTasksError, Reply } from "../runtime/HandsTasks.ts";
import { Command } from "../tasks/Task.ts";
import { fcResult } from "../tasks/TasksTest.ts";
import { handsLayer } from "./hands.ts";
import type { Env } from "./runtime.ts";

const ask = {
  id: "process_01jc9q4w7zfm8s5r2t6v0xkb4d/7/0",
  process: "process_01jc9q4w7zfm8s5r2t6v0xkb4d",
  name: "check:1",
  program: "fabrika/check",
  build: "hands-test",
  command: Command.cases.git_version.make({}),
  parent: null,
  traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
};

const from: From = {
  by: "SHA256:fixture",
  for: "fixture",
  sentAt: "2026-11-15T00:00:00Z",
  seen: 0,
  parent: null,
  traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
  build: "hands-test",
};

const rev = fc.integer({ min: 1, max: 1_000_000 });

const arrivedAt = fc.integer({ min: 1_700_000_000_000, max: 1_900_000_000_000 });

/** What the Project answers: a good reply of each case, or one of the ways an answer goes wrong. */
const Case = fc.oneof(
  fc.record({ rev, arrivedAt }).map((fields) => ({ shape: "good" as const, reply: Reply.cases.waiting.make(fields) })),
  fc
    .record({ result: fcResult, rev, arrivedAt })
    .map((fields) => ({ shape: "good" as const, reply: Reply.cases.finished.make(fields) })),
  fc
    .constantFrom("no_hands" as const, "id_reused" as const)
    .map((reason) => ({ shape: "good" as const, reply: Reply.cases.refused.make({ reason }) })),
  fc.constant({ shape: "transport" as const }),
  fc
    .constantFrom({ unexpected: true }, null, "waiting", { rev: 1 })
    .map((raw) => ({ shape: "undecodable" as const, raw })),
  fc
    .record({ rev, arrivedAt, word: fc.stringMatching(/^[a-z]{1,8}$/) })
    .map(({ word, ...fields }) => ({ shape: "extra" as const, fields, word })),
);

type Case = typeof Case extends fc.Arbitrary<infer A> ? A : never;

it.effect(
  "C1: a lost, failed or undecodable Project reply is unavailable, never a refusal; a good reply decodes strictly",
  () =>
    Effect.gen(function* () {
      const context = yield* Effect.context<never>();
      const reached = new Set<string>();

      const check = Effect.fnUntraced(function* (choice: Case) {
        const sent: Array<unknown> = [];

        // oxlint-disable-next-line fabrika/no-type-assertions -- edge: fake RPC handles supply only the methods this layer calls
        const env = {
          PROJECT: {
            getByName: () => ({
              hands: async (...args: ReadonlyArray<unknown>) => {
                sent.push(args);

                if (choice.shape === "transport") {
                  return Promise.reject(new Error("connection lost"));
                }

                if (choice.shape === "undecodable") {
                  return choice.raw;
                }

                if (choice.shape === "extra") {
                  return { ...Schema.encodeSync(Reply)(Reply.cases.waiting.make(choice.fields)), [choice.word]: 1 };
                }

                return Schema.encodeSync(Reply)(choice.reply);
              },
            }),
          },
        } as unknown as Env;

        const answer = yield* HandsTasks.use((hands) => hands.ask(ask, from)).pipe(
          Effect.provide(handsLayer(env, "hands-test")),
          Effect.result,
        );

        expect(sent, "the Project is asked once per ask").toHaveLength(1);
        reached.add(choice.shape === "good" ? `good:${choice.reply._tag}` : choice.shape);

        if (choice.shape === "good") {
          expect(Result.isSuccess(answer) && answer.success, "a good reply is the Project's own answer").toEqual(
            choice.reply,
          );

          return;
        }

        expect(Result.isFailure(answer), `${choice.shape}: no answer the program would read`).toBe(true);

        if (Result.isFailure(answer)) {
          expect(answer.failure).toBeInstanceOf(HandsTasksError);
          expect(answer.failure.reason, `${choice.shape}: the Cmd stays dispatched for its retry`).toBe("unavailable");
        }
      });
      const property = fc.asyncProperty(Case, (choice) => Effect.runPromiseWith(context)(check(choice)));
      yield* Effect.promise(() => fc.assert(property, { seed: 119120, numRuns: 60 }));
      // An empty run cannot pass: every case was answered at least once.
      expect([...reached].sort()).toEqual(
        ["extra", "good:finished", "good:refused", "good:waiting", "transport", "undecodable"].sort(),
      );
    }),
);
