// S3, next/. Saved.upgrade(saved, state, build) returns {saved, ran}; no I/O.
import { describe, expect, it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import * as Formatter from "effect/Formatter";
import * as Match from "effect/Match";
import * as Predicate from "effect/Predicate";
import { Saved } from "./State.ts";

const Model = Schema.Struct({ count: Schema.Int, step: Schema.Int });

const old = { v: 1, model: { n: 7 }, build: "old-build", after: 12 };

const N = Schema.Struct({ n: Schema.Int });

const Count = Schema.Struct({ count: Schema.Int });

const state = (calls: string[] = []) => ({
  v: 3,
  schema: Model,
  upgrades: [
    {
      name: "n_to_count",
      from: 1,
      run: (raw: unknown) => {
        calls.push("n_to_count");

        return { count: Schema.decodeUnknownSync(N)(raw).n };
      },
    },
    {
      name: "add_step",
      from: 2,
      run: (raw: unknown) => {
        calls.push("add_step");

        return { ...Schema.decodeUnknownSync(Count)(raw), step: 1 };
      },
    },
  ],
});

describe("S3 saved state and named upgrades", () => {
  for (const [v, model, ran] of [
    [1, { n: 7 }, ["n_to_count", "add_step"]],
    [2, { count: 7 }, ["add_step"]],
    [3, { count: 7, step: 1 }, []],
  ] as const) {
    it(`plant, skip an upgrade: version ${v} follows exactly the remaining named chain`, () => {
      const calls: string[] = [];
      const result = Saved.upgrade({ ...old, v, model }, state(calls), "new-build");
      expect(result).toEqual({
        saved: { v: 3, model: { count: 7, step: 1 }, build: "new-build", after: 12 },
        ran,
      });
      expect(calls).toEqual(ran);
    });
  }

  for (const fault of ["gap", "duplicate", "future", "throw", "decode", "zero"] as const) {
    it.effect.prop(
      `plant, accept ${fault}: failed upgrades leave the original saved bytes intact`,
      { generated: Schema.Int },
      ({ generated }) =>
        Effect.forEach(
          [7, generated],
          (value) =>
            Effect.sync(() => {
              const raw = {
                ...old,
                model: { n: value },
                v: Match.value(fault).pipe(
                  Match.when("future", () => 4),
                  Match.when("zero", () => 0),
                  Match.orElse(() => 1),
                ),
              };

              const before = Formatter.formatJson(raw);
              const normal = state();

              const upgrades = Match.value(fault).pipe(
                Match.when("gap", () => normal.upgrades.slice(1)),
                Match.when("duplicate", () => [...normal.upgrades, normal.upgrades[0]!]),
                Match.when("throw", () => [
                  {
                    name: "broken",
                    from: 1,
                    run: () => {
                      throw new Error("upgrade detail");
                    },
                  },
                  normal.upgrades[1]!,
                ]),
                Match.when("decode", () => [
                  normal.upgrades[0]!,
                  { name: "bad_model", from: 2, run: () => ({ count: "bad", step: 1 }) },
                ]),
                Match.orElse(() => normal.upgrades),
              );

              expect(() => Saved.upgrade(raw, { ...normal, upgrades }, "new-build")).toThrowError(
                expect.objectContaining({ _tag: "ProgramDown", reason: "saved_state" }),
              );
              expect(Formatter.formatJson(raw)).toBe(before);
            }),
          { concurrency: 1, discard: true },
        ),
      { arbitrary: { seed: 119120, runs: 12 } },
    );
  }

  it("plant, upgrade in place: even a mutating failed upgrade cannot destroy saved bytes", () => {
    const raw = JSON.parse(JSON.stringify(old));

    const upgrades = [
      {
        name: "mutating",
        from: 1,
        run: (value: unknown) => {
          Object.assign(Schema.decodeUnknownSync(Schema.Struct({ n: Schema.Int }))(value), { n: 99 });

          if (Predicate.isObjectOrArray(value)) {
            Object.assign(value, { n: 99 });
          }

          throw new Error("upgrade failed");
        },
      },
    ];

    expect(() => Saved.upgrade(raw, { ...state(), upgrades }, "new-build")).toThrow();
    expect(raw).toEqual(old);
  });
  it("plant, omit a save field: version, build and inbox cursor survive JSON text", () => {
    const current = { v: 3, model: { count: 7, step: 1 }, build: "b-123", after: 29 };
    const text = Schema.encodeSync(Schema.fromJsonString(Saved))(current);
    expect(Schema.decodeUnknownSync(Schema.fromJsonString(Saved))(text)).toEqual(current);

    for (const bad of [
      { ...current, v: 0 },
      { ...current, build: "" },
      { ...current, after: -1 },
    ]) {
      expect(() => Schema.decodeUnknownSync(Saved)(bad)).toThrow();
    }
  });
});
