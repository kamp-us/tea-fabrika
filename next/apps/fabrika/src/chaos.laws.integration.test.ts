import { applyCell } from "@demlik/tea";
import { expect, it } from "@effect/vitest";
// next/, P17b. The app composes the real checklist and both suites (0062, amendment A2).
import * as RunnerTest from "@kampus/chaos/RunnerTest";
import * as TargetsTest from "@kampus/chaos/TargetsTest";
import { checklist } from "@kampus/checklist";
import * as ChaosTest from "@kampus/libfabrika/node/Chaos.test-support";
import { syncTest } from "@kampus/libfabrika/testing";
import { runsFor } from "@kampus/vitest";
import { Arbitrary, Schema } from "effect";
import * as RevokeHold from "../e2e/chaos-revoke.test-support.ts";

/** The key of each Msg, Cmd and answer these laws write or expect, made by a schema (0569, 0562).
 *  A law hands over only the fields it reads, so a case holds the key alone. */
const Tag = Schema.TaggedUnion({
  arm: {},
  arrive: {},
  release: {},
});

RunnerTest.suite(ChaosTest.open, checklist);
TargetsTest.suite(ChaosTest.open, checklist);

it.prop(
  "the hold controller admits one matching request and preserves every saved cut",
  [
    Arbitrary.array(Arbitrary.schema(Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 1000 }))), {
      minLength: 12,
      maxLength: 60,
    }),
  ],
  ([choices]) => {
    let [model] = RevokeHold.controller.init(null, {});
    const msgs: Array<typeof RevokeHold.Msg.Type> = [];
    let held = 0;

    for (const pick of choices) {
      const msg: typeof RevokeHold.Msg.Type =
        model._tag === "idle"
          ? { ...Tag.cases.arm.make({}), process: `process-${pick}` }
          : model._tag === "armed"
            ? pick % 7 === 0
              ? Tag.cases.release.make({})
              : {
                  ...Tag.cases.arrive.make({}),
                  process: pick % 3 === 0 ? "unrelated" : model.process,
                }
            : model._tag === "held"
              ? pick % 2 === 0
                ? Tag.cases.release.make({})
                : { ...Tag.cases.arrive.make({}), process: model.process }
              : { ...Tag.cases.arm.make({}), process: `later-${pick}` };
      const previous = model;
      [model] = applyCell(RevokeHold.controller, model, msg);
      msgs.push(msg);
      const enters = previous._tag === "armed" && msg._tag === "arrive" && previous.process === msg.process;

      if (previous._tag !== "held" && model._tag === "held") {
        held++;
      }

      expect(held).toBeLessThanOrEqual(1);

      if (enters) {
        expect(model).toEqual(RevokeHold.Model.cases.held.make({ process: msg.process }));
      } else if (previous._tag === "idle" && msg._tag === "arm") {
        expect(model).toEqual(RevokeHold.Model.cases.armed.make({ process: msg.process }));
      } else if (msg._tag === "release" && (previous._tag === "armed" || previous._tag === "held")) {
        expect(model).toEqual(RevokeHold.Model.cases.released.make({ process: previous.process }));
      } else if (previous._tag !== "idle") {
        expect(model).toEqual(previous);
      }
    }

    syncTest(
      RevokeHold.controller,
      {},
      {
        msgs,
        encode: Schema.encodeSync(RevokeHold.Model),
        decode: Schema.decodeUnknownSync(RevokeHold.Model),
        equals: (a, b) => JSON.stringify(a) === JSON.stringify(b),
        seed: 119120,
      },
    );
  },
  { arbitrary: { seed: 119120, runs: runsFor({ fast: 10, full: 100 }) } },
);
