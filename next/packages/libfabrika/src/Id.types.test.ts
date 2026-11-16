// T518, PR 1, next/. Compile the exact bad expressions; never execute them.
import { expectTypeOf, it } from "@effect/vitest";
import { Id } from "@kampus/libfabrika";
import type { IdError, IdSchema, IdValue } from "@kampus/libfabrika";
import type * as Public from "@kampus/libfabrika";
import type * as Context from "effect/Context";
import type * as SecureRandom from "effect/crypto/SecureRandom";
import * as Effect from "effect/Effect";
import type * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import type * as SchemaIssue from "effect/SchemaIssue";
import type * as Front from "./Id.ts";
import type { ProcessIdGenerator } from "./processes/ProcessIdGenerator.ts";
import type { ProcessId as TraceProcessId } from "./ProcessId.ts";

const checkTypes = (raw: string) => {
  const ProcessId = Id.make("process");
  const LetterId = Id.make("letter");
  const InputId = Id.make("input");
  const ChaosId = Id.make("chaos");
  expectTypeOf<typeof InputId.Type>().toEqualTypeOf<IdValue<"input">>();
  expectTypeOf<typeof ChaosId.Type>().toEqualTypeOf<IdValue<"chaos">>();
  expectTypeOf<typeof InputId.Type>().not.toEqualTypeOf<string>();
  expectTypeOf<typeof InputId.Type>().not.toEqualTypeOf<typeof ChaosId.Type>();
  const checkInput = (input: typeof InputId.Type, raw: string) => {
    // @ts-expect-error An input id cannot stand for a chaos experiment.
    const wrong: typeof ChaosId.Type = input;
    // @ts-expect-error An outside string is not a checked input id.
    const unchecked: typeof input = raw;
    return [wrong, unchecked];
  };
  expectTypeOf<IdSchema<"input">["Type"]>().toEqualTypeOf<typeof InputId.Type>();
  expectTypeOf<Id.IdSchema<"input">>().toEqualTypeOf<IdSchema<"input">>();
  expectTypeOf<Id.IdValue<"input">>().toEqualTypeOf<IdValue<"input">>();
  expectTypeOf<Front.IdSchema<"input">>().toEqualTypeOf<IdSchema<"input">>();
  expectTypeOf<Front.IdValue<"input">>().toEqualTypeOf<IdValue<"input">>();
  expectTypeOf<Front.IdError>().toEqualTypeOf<IdError>();
  expectTypeOf<Id.IdError>().toEqualTypeOf<IdError>();
  expectTypeOf<"IdGenerator" extends keyof typeof Public ? true : false>().toEqualTypeOf<false>();
  expectTypeOf<"IdGenerator" extends keyof typeof Front ? true : false>().toEqualTypeOf<false>();
  expectTypeOf<"IdGenerator" extends keyof typeof Id ? true : false>().toEqualTypeOf<false>();
  expectTypeOf<typeof Id.InputId.Type>().toEqualTypeOf<IdValue<"input">>();
  const takeProcess = (_id: typeof ProcessId.Type): void => {};
  const takeLetter = (_id: typeof LetterId.Type): void => {};
  const checkBrands = (process: typeof ProcessId.Type, letter: typeof LetterId.Type) => {
    expectTypeOf<typeof ProcessId.Type>().not.toBeAny();
    expectTypeOf<typeof LetterId.Type>().not.toBeAny();
    expectTypeOf<typeof ProcessId.Type>().not.toEqualTypeOf<typeof LetterId.Type>();
    takeProcess(process);
    // @ts-expect-error A letter cannot name a process.
    takeProcess(letter);
    takeLetter(letter);
    // @ts-expect-error A process cannot name a letter.
    takeLetter(process);
    takeProcess(ProcessId.make(raw));
    // @ts-expect-error An unchecked string has no process brand.
    takeProcess(raw);
    // A6 keeps the existing process API unbranded until PR 2.
    expectTypeOf<typeof TraceProcessId.Type>().toEqualTypeOf<string>();
    expectTypeOf<Context.Service.Shape<typeof ProcessIdGenerator>["next"]>().toEqualTypeOf<
      Effect.Effect<typeof TraceProcessId.Type>
    >();
  };
  const checkGenerator = Effect.gen(function* () {
    const generator = yield* Id.Generator;
    const process = generator.next(ProcessId);
    const letter = generator.next(LetterId);
    expectTypeOf(process).toEqualTypeOf<Effect.Effect<typeof ProcessId.Type, IdError>>();
    expectTypeOf(letter).toEqualTypeOf<Effect.Effect<typeof LetterId.Type, IdError>>();
    expectTypeOf(generator.next(InputId)).toEqualTypeOf<Effect.Effect<typeof InputId.Type, IdError>>();
    expectTypeOf(generator.next(ChaosId)).toEqualTypeOf<Effect.Effect<typeof ChaosId.Type, IdError>>();
    const value = yield* process;
    takeProcess(value);
    // @ts-expect-error next(ProcessId) preserves the process brand.
    takeLetter(value);
    return yield* letter;
  });
  const made = ProcessId.makeEffect(raw);
  const decoded = Schema.decodeUnknownEffect(ProcessId)(raw);
  expectTypeOf(made).toEqualTypeOf<Effect.Effect<typeof ProcessId.Type, SchemaIssue.Issue>>();
  expectTypeOf(decoded).toEqualTypeOf<Effect.Effect<typeof ProcessId.Type, Schema.SchemaError>>();
  expectTypeOf(Id.makeEffect("process")).toEqualTypeOf<Effect.Effect<typeof ProcessId, IdError>>();
  void checkBrands;
  void checkInput;
  return { checkGenerator, made, decoded };
};

it("type: the public Id module keeps its brands, schemas and generator types for generated client prefixes", () => {
  expectTypeOf(checkTypes).toBeFunction(); // CI's typecheck runs the uncalled function above.
});

// T1067 T5. Callers keep one layer that needs nothing (the 2026-11-16 ruling), and a caller that
// picks its own random source builds the service from SecureRandom.
// Plant: drop `Layer.provide(SecureRandom.layerWebCrypto)` from `Generator.layer`, and it needs SecureRandom.
const checkLayers = () => {
  expectTypeOf(Id.Generator.layer).toEqualTypeOf<Layer.Layer<Id.Generator>>();
  expectTypeOf(Id.makeGenerator).toEqualTypeOf<
    Effect.Effect<Context.Service.Shape<typeof Id.Generator>, never, SecureRandom.SecureRandom>
  >();
  expectTypeOf<typeof Front.makeGenerator>().toEqualTypeOf<typeof Id.makeGenerator>();
};

it("type: Generator.layer needs nothing, and makeGenerator needs only SecureRandom", () => {
  expectTypeOf(checkLayers).toBeFunction(); // CI's typecheck runs the uncalled function above.
});
