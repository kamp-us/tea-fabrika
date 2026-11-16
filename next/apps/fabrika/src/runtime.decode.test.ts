// T737 D7, next/. The app names a door input by its `type` with Predicate now. This law takes the
// callback the runtime hands the Gateway as `inputs.name`, which runtime.ts exports as `inputName`
// (0555: a value handed in, where the law once captured it through mocks of the project runtime and
// the door). An independent copy of the guard before that change is the oracle: the same name, and
// the same reads of `type` in the same order.
import * as StartsTest from "@kampus/libfabrika/settings/StartsTest";
import { Effect, Exit, Result } from "effect";
import { Digest } from "effect/crypto";
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { settings as decodeSettings, inputName } from "./runtime.ts";

const decode = (env: unknown): ReturnType<typeof decodeSettings> => Reflect.apply(decodeSettings, undefined, [env]);

StartsTest.law(
  "T753 L3 the app reads the shared snapshot and derives its port",
  fc.tuple(StartsTest.recipe),
  ([recipe]) =>
    Effect.gen(function* () {
      const input = yield* StartsTest.input(recipe);
      const config = yield* decode({ INSTANCE: JSON.stringify(input) });
      expect(config.port).toBe(recipe.port);
      expect(config.build).toBe(recipe.build);
      const bad = yield* Effect.exit(decode({ INSTANCE: JSON.stringify(StartsTest.corrupt(input, 6)) }));
      expect(Exit.isFailure(bad)).toBe(true);
    }).pipe(Effect.provide(Digest.layerWebCrypto)),
);

const oldName = (m: unknown) =>
  typeof m === "object" && m !== null && "type" in m && typeof m.type === "string" ? m.type : undefined;

class Sent {
  readonly extra = 1;
}

const Message = fc.record({
  container: fc.constantFrom(
    "plain",
    "plain",
    "array",
    "function",
    "instance",
    "inherited",
    "null",
    "undefined",
    "string",
    "number",
    "symbol",
  ),
  type: fc.oneof(
    { arbitrary: fc.string({ maxLength: 6 }), weight: 4 },
    { arbitrary: fc.constant(""), weight: 2 },
    { arbitrary: fc.constantFrom<unknown>(7, null, undefined, {}, "absent"), weight: 2 },
  ),
  extra: fc.option(fc.dictionary(fc.string({ maxLength: 3 }), fc.jsonValue({ maxDepth: 1 }), { maxKeys: 2 }), {
    nil: undefined,
  }),
  proxy: fc.boolean(),
  throwOn: fc.constantFrom("none", "none", "has", "get"),
});
type Message = typeof Message extends fc.Arbitrary<infer A> ? A : never;

/** A fresh message from its recipe; a proxy logs each read of `type` in `trace`. */
const message = (r: Message, trace: Array<string>): unknown => {
  const fields: Record<string, unknown> = r.type === "absent" ? {} : { type: r.type };
  const target: unknown = (() => {
    switch (r.container) {
      case "plain":
        return { ...r.extra, ...fields };
      case "array":
        return Object.assign([], r.extra, fields);
      case "function":
        return Object.assign(() => 0, r.extra, fields);
      case "instance":
        return Object.assign(new Sent(), fields);
      case "inherited":
        return Object.assign(Object.create(fields), r.extra);
      case "null":
        return null;
      case "undefined":
        return undefined;
      case "string":
        return String(r.type);
      case "number":
        return 7;
      case "symbol":
        return Symbol("type");
    }
  })();

  if (!r.proxy || (typeof target !== "object" && typeof target !== "function") || target === null) {
    return target;
  }

  return new Proxy(target, {
    has: (t, key) => {
      if (key === "type") {
        trace.push("has");

        if (r.throwOn === "has") {
          throw new Error("planted has trap");
        }
      }

      return Reflect.has(t, key);
    },
    get: (t, key, receiver) => {
      if (key === "type") {
        trace.push("get");

        if (r.throwOn === "get") {
          throw new Error("planted get trap");
        }
      }

      return Reflect.get(t, key, receiver);
    },
  });
};

const answer = (f: (m: unknown) => string | undefined, r: Message) => {
  const trace: Array<string> = [];
  const got = Result.try({ try: () => f(message(r, trace)), catch: () => "thrown" as const });
  return { name: Result.isSuccess(got) ? got.success : ("thrown" as const), trace };
};

describe("T737 D7 the app's message-name callback equals its old guard, next/", () => {
  // Plant (run once): in runtime.ts, have `inputName` read `m.type` before its guard; the trace differs.
  it("names generated messages as the old guard did, with the same reads of type", () => {
    const name: (m: unknown) => string | undefined = inputName;
    const seen = new Set<string>();
    fc.assert(
      fc.property(Message, (r) => {
        const old = answer(oldName, r);
        expect(answer(name, r)).toEqual(old);
        seen.add(`${r.container}:${old.name === undefined ? "none" : old.name === "thrown" ? "thrown" : "named"}`);
      }),
      { seed: 119120, numRuns: 1_000 },
    );

    for (const side of [
      "plain:named",
      "plain:none",
      "array:named",
      "function:none",
      "instance:named",
      "inherited:named",
      "null:none",
      "string:none",
      "plain:thrown",
    ]) {
      expect(seen, side).toContain(side);
    }
  });
});
