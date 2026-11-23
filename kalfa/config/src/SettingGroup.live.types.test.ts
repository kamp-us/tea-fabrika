// Ticket 1841, kalfa/config (new work): TL1 to TL3 of the approved plan (.kalfa/quests/kalfa-config-live-PLAN.md, with its
// Amendment 1), the type laws, written first. Only the compiler judges them: the lead's one `pnpm typecheck` reads this
// file, and Vitest does not typecheck, so each body holds type checks only. Each `@ts-expect-error` is a line that must not
// compile; a plant that lets it compile leaves the directive unused, which fails the typecheck. Until `Live` has `changes`,
// the lines below that read it are the red.
//
// Plants, one per law (run once, never kept):
// - TL1: type `changes` as `Stream.Stream<unknown>`.
// - TL2: give `Read` a `changes` for a restart setting too, so the `@ts-expect-error` lines compile.
// - TL3: add `readonly ref: SubscriptionRef<A>` to `Live`.
// - TL4: put the window in `Values`, so its field is a key of what a program reads.
import { expectTypeOf, it } from "@effect/vitest";
import type { Effect } from "effect";
import { type FileSystem, type Path, Schema, type Stream } from "effect";
import type * as Layer from "effect/Layer";
import { Setting, SettingGroup } from "./index.ts";

const Rule = Schema.Literals(["people", "robots"]);

type Rule = typeof Rule.Type;

const Pair = Schema.Struct({ a: Schema.optionalKey(Schema.Int), b: Schema.optionalKey(Schema.Int) });

type Pair = typeof Pair.Type;

const described = Setting.withDescription("A setting.");

// One live setting of a text, a literal, a table and an array kind, and one restart setting of a number, a text, a
// boolean, an array and a table kind.
const group = SettingGroup.make(
  "demo",
  Setting.make("live.text", Schema.String).pipe(Setting.withDefault(""), described, Setting.live),
  Setting.make("live.rule", Rule).pipe(Setting.withDefault("people"), described, Setting.live),
  Setting.make("live.pair", Pair).pipe(Setting.withDefault({}), described, Setting.live),
  Setting.make("live.tags", Schema.Array(Schema.String)).pipe(Setting.withDefault([]), described, Setting.live),
  Setting.make("rest.count", Schema.Int).pipe(Setting.withDefault(1), described),
  Setting.make("rest.name", Schema.String).pipe(Setting.withDefault(""), described),
  Setting.make("rest.on", Schema.Boolean).pipe(Setting.withDefault(false), described),
  Setting.make("rest.list", Schema.Array(Schema.Int)).pipe(Setting.withDefault([]), described),
  Setting.make("rest.table", Pair).pipe(Setting.withDefault({}), described),
);

type Values = Effect.Success<typeof group>;

const demoLayer = SettingGroup.layer(group, { version: "1.2.3" });

// TL2: a restart field is the plain value, so `changes` is a line that must not compile. This function is never called, and
// it hands every expression back, so none is a dropped Effect.
const refusals = (values: Values) => [
  // @ts-expect-error TL2: a number is not a stream
  values.count.changes,

  // @ts-expect-error TL2: a text is not a stream
  values.name.changes,

  // @ts-expect-error TL2: a boolean is not a stream
  values.on.changes,

  // @ts-expect-error TL2: an array is not a stream
  values.list.changes,

  // @ts-expect-error TL2: a table is not a stream
  values.table.changes,
];

it("TL1 type: for a live setting of a text, a literal, a table and an array kind, `changes` is exactly a Stream of the value", () => {
  expectTypeOf<Values["text"]["changes"]>().toEqualTypeOf<Stream.Stream<string>>();
  expectTypeOf<Values["rule"]["changes"]>().toEqualTypeOf<Stream.Stream<Rule>>();
  expectTypeOf<Values["pair"]["changes"]>().toEqualTypeOf<Stream.Stream<Pair>>();
  expectTypeOf<Values["tags"]["changes"]>().toEqualTypeOf<Stream.Stream<ReadonlyArray<string>>>();
  expectTypeOf<SettingGroup.Live<number>["changes"]>().toEqualTypeOf<Stream.Stream<number>>();
});

it("TL2 type: a restart setting has no `changes`, for a number, a text, a boolean, an array and a table kind", () => {
  expectTypeOf(refusals).toBeFunction();
  expectTypeOf<Values["count"]>().toEqualTypeOf<number>();
  expectTypeOf<Values["name"]>().toEqualTypeOf<string>();
  expectTypeOf<Values["on"]>().toEqualTypeOf<boolean>();
  expectTypeOf<Values["list"]>().toEqualTypeOf<ReadonlyArray<number>>();
  expectTypeOf<Values["table"]>().toEqualTypeOf<Pair>();
  expectTypeOf<Values["count"]>().not.toHaveProperty("changes");
  expectTypeOf<Values["name"]>().not.toHaveProperty("changes");
  expectTypeOf<Values["table"]>().not.toHaveProperty("changes");
});

it("TL3 type: a live value holds nothing beyond an Effect and `changes`, and the layer keeps its error and requirements", () => {
  // The type id and `changes` are all a `Live` adds to an Effect, so there is no reference, no setter and no `set`.
  expectTypeOf<Exclude<keyof SettingGroup.Live<number>, keyof Effect.Effect<number>>>().toEqualTypeOf<
    "~@kalfa/config/SettingGroup/Live" | "changes"
  >();
  expectTypeOf<SettingGroup.Live<number>>().toExtend<Effect.Effect<number>>();
  expectTypeOf<Layer.Error<typeof demoLayer>>().toEqualTypeOf<SettingGroup.SettingsError>();
  expectTypeOf<Layer.Services<typeof demoLayer>>().toEqualTypeOf<FileSystem.FileSystem | Path.Path>();
  expectTypeOf<Layer.Success<typeof demoLayer>>().toEqualTypeOf<
    SettingGroup.Identifier<"demo", typeof group.settings>
  >();
});

// TL4: the window `config.watch.debounce` is a setting the package adds to a group with a live setting. It is a flag and
// an origin, so `SettingGroup.flags(group)`, the `flags` the layer takes and `SettingGroup.origins(group)` hold its name in
// their types. It is not the program's: `values` holds only what the program declared. A group with no live setting has
// none of it.
const restart = SettingGroup.make(
  "plain",
  Setting.make("rest.count", Schema.Int).pipe(Setting.withDefault(1), described),
);

const flagsOfGroup = SettingGroup.flags(group);

const flagsOfRestart = SettingGroup.flags(restart);

const originsRead = SettingGroup.origins(group);

const originsOfRestart = SettingGroup.origins(restart);

it("TL4 type: a group with a live setting holds the window in its flags and origins, never in its values, and a restart-only group holds it nowhere", () => {
  expectTypeOf<"config.watch.debounce">().toExtend<keyof typeof flagsOfGroup>();
  expectTypeOf<"config.watch.debounce">().toExtend<keyof SettingGroup.FlagValues<typeof group.settings>>();
  expectTypeOf<"config.watch.debounce">().toExtend<keyof Effect.Success<typeof originsRead>>();
  expectTypeOf<"debounce">().not.toExtend<keyof Values>();
  expectTypeOf<keyof Values>().toEqualTypeOf<
    "text" | "rule" | "pair" | "tags" | "count" | "name" | "on" | "list" | "table"
  >();
  expectTypeOf<"config.watch.debounce">().not.toExtend<keyof typeof flagsOfRestart>();
  expectTypeOf<"config.watch.debounce">().not.toExtend<keyof Effect.Success<typeof originsOfRestart>>();
});
