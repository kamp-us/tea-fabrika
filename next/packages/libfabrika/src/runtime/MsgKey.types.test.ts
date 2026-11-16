// Ticket 1061, slice 2, next/. Law K1: tea's types key a Msg, a Cmd and a Cmd's answer on `_tag`
// (demlik 949, patched in `patches/@demlik__tea@0.27.0.patch`, decision 0569). The type checker
// reads this law; Vitest does not typecheck, so the lead and CI run it with `pnpm typecheck`.
// Plants: (a) drop the patch's `.d.ts` hunks, and the tagged machine below fails to compile;
// (b) keep `Extract<M, { type: K }>` in core's `Reducer`, and a handler's Msg loses its fields;
// (c) keep `Cmd<T>`'s `readonly type`, and the answer's `cmd._tag` fails.
import { Cmd, Machine, type EffectRun } from "@demlik/tea/effect";
import { expectTypeOf, it } from "@effect/vitest";
import { Schema, type Types } from "effect";

const Model = Schema.Struct({ count: Schema.Int, stored: Schema.Int });

const Msg = Schema.TaggedUnion({
  inc: {},
  save: { n: Schema.Int },
});

const store = Cmd.make("store", {
  input: Schema.Struct({ n: Schema.Int }),
  ok: Schema.Int,
  err: ["disk"],
});

const machine = Machine.make({
  model: Model,
  msg: Msg,
  cmds: [store],
  init: (loaded) => [loaded ?? { count: 0, stored: 0 }, []],
  update: {
    inc: (s) => [{ ...s, count: s.count + 1 }, []],
    save: (s, m) => [s, [store({ n: m.n })]],
    store_ok: (s, m) => [{ ...s, stored: s.stored + m.value }, []],
    store_err: (s) => [s, []],
  },
});

type Handlers = typeof machine.update;
type Answer = Parameters<Extract<Handlers, { readonly store_ok: unknown }>["store_ok"]>[1];

it("type: K1 a TaggedUnion Msg is taken by Machine.make, and its cells and answers are keyed on _tag", () => {
  expectTypeOf(machine.msg).toEqualTypeOf<Schema.Schema<typeof Msg.Type>>();
  expectTypeOf<Types.Tags<typeof Msg.Type>>().toEqualTypeOf<"inc" | "save">();
  expectTypeOf<Parameters<Extract<Handlers, { readonly save: unknown }>["save"]>[1]>().toEqualTypeOf<
    Types.ExtractTag<typeof Msg.Type, "save">
  >();
  expectTypeOf<Answer["_tag"]>().toEqualTypeOf<"store_ok">();
  expectTypeOf<Answer["cmd"]["_tag"]>().toEqualTypeOf<"store">();
  expectTypeOf<Answer["cmd"]["n"]>().toEqualTypeOf<number>();
  expectTypeOf<ReturnType<typeof store>["_tag"]>().toEqualTypeOf<"store">();
  expectTypeOf<ReturnType<typeof store.err>["_tag"]>().toEqualTypeOf<"store_err">();
  expectTypeOf<ReturnType<typeof store.ok>["cmd"]["_tag"]>().toEqualTypeOf<"store">();
});

// Every refusal has a valid neighbor beside it. These functions are never called, even by Vitest.
function authoringTypeErrors() {
  Machine.make({
    model: Model,
    msg: Msg,
    cmds: [store],
    init: (loaded) => [loaded ?? { count: 0, stored: 0 }, []],
    // @ts-expect-error A cell for every Msg: `save` is missing, so the table does not compile.
    update: {
      inc: (s) => [s, []],
      store_ok: (s) => [s, []],
      store_err: (s) => [s, []],
    },
  });
  Machine.make({
    model: Model,
    msg: Msg,
    cmds: [store],
    init: (loaded) => [loaded ?? { count: 0, stored: 0 }, []],
    update: {
      inc: (s) => [s, []],
      save: (s) => [s, []],
      // @ts-expect-error A misspelled cell names no Msg's `_tag`.
      sav: (s: typeof Model.Type) => [s, []],
      store_ok: (s) => [s, []],
      store_err: (s) => [s, []],
    },
  });
  Machine.make({
    model: Model,
    // @ts-expect-error A Msg schema keyed `type` is not a tea Msg any more: tea reads `_tag`.
    msg: Schema.Union([Schema.Struct({ type: Schema.Literal("inc") })]),
    cmds: [],
    init: (loaded) => [loaded ?? { count: 0, stored: 0 }, []],
    update: { inc: (s) => [s, []] },
  });
  Cmd.make("tagged", {
    // @ts-expect-error A Cmd's input may not carry `_tag`: the def writes the key itself.
    input: Schema.TaggedStruct("tagged", { n: Schema.Int }),
    ok: Schema.Int,
    err: [],
  });
  Cmd.make("plain", { input: Schema.Struct({ n: Schema.Int }), ok: Schema.Int, err: [] });
}

function dispatchTypeErrors(run: EffectRun<typeof Model.Type, typeof Msg.Type>) {
  return [
    run.dispatch(Msg.cases.inc.make({})),
    run.dispatch(Msg.cases.save.make({ n: 1 })),
    // @ts-expect-error A misspelled Msg: `inq` is no case of the machine's Msg.
    run.dispatch(Schema.TaggedStruct("inq", {}).make({})),
    // @ts-expect-error A Msg keyed `type` is refused: `{ type: "inc" }` has no `_tag`.
    run.dispatch({ type: "inc" }),
  ];
}

void authoringTypeErrors;
void dispatchTypeErrors;
