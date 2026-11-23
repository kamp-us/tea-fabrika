// Ticket 1839, kalfa/config (new work): T1 to T5 of the approved plan (.kalfa/quests/kalfa-config-declare-PLAN.md),
// the type laws, written first. They settle the plan's riskiest doubt: whether a live setting stays a different type
// from a restart setting through `.pipe`. Only the compiler judges them: the lead's one `pnpm typecheck` reads this
// file, and Vitest does not typecheck, so each body holds type checks only. Each `@ts-expect-error` is a line that
// must not compile; a plant that lets it compile leaves the directive unused, which fails the typecheck.
//
// Plants, one per law (run once, never kept):
// - T1: type `Setting.withDescription` as `(text) => (self: Setting.Any) => Setting.Any`, so the name and the mark
//   are lost.
// - T2: make `SettingGroup.Read` give `A` for a live setting, or make `Live<A>` an intersection with `A`.
// - T3: make the group a `Config` that reads the current provider, so its requirements are `never`.
// - T4: type `Setting.files` as `(files: ReadonlyArray<string>)`.
// - T5: add `"person"` to `Setting.File`; ticket 1843 slice 2 (the reasons are eight, `edit` added): leave `"edit"` out
//   of `SettingsError`'s literals.
// - T7 (ticket 1843, slice 2): type `SettingGroup.edit`'s `set` as taking `setting: Setting.Any`, so the
//   `@ts-expect-error` for another group's setting is unused.
// - T6, one at a time, each on `Declaration.ts`: (a) type `make`'s schema as `C` again; (b) drop the brand line of
//   `NotPlain`; (c) drop its "met before" check; (d) compare with "assignable one way" in place of `Same`; (e) answer
//   `T` whole at the record line.
import { expectTypeOf, it } from "@effect/vitest";
import { Effect, type FileSystem, Option, type Path, Schema } from "effect";
import type * as Duration from "effect/Duration";
import type * as Layer from "effect/Layer";
import { Setting, SettingGroup } from "./index.ts";

const Rule = Schema.Literals(["people", "robots"]);

type Rule = typeof Rule.Type;

const Port = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 65535 }));

const base = Setting.make("delivery.carry-rule", Rule);

// T1: the same four combinators, in several orders.
const restartA = base.pipe(
  Setting.withDefault("people"),
  Setting.withDescription("Who carries a rule over."),
  Setting.files(["user"]),
  Setting.fileOnly,
);

const restartB = base.pipe(
  Setting.fileOnly,
  Setting.files(["repo", "user"]),
  Setting.withDescription("Who carries a rule over."),
  Setting.withDefault("robots"),
);

const restartC = base.pipe(
  Setting.files(["repo"]),
  Setting.withDefault("people"),
  Setting.fileOnly,
  Setting.withDescription("Who carries a rule over."),
);

const restartD = base.pipe(
  Setting.withDescription("Who carries a rule over."),
  Setting.fileOnly,
  Setting.withDefault("people"),
  Setting.files(["user"]),
);

// T1: `live` first, in the middle and last.
const liveFirst = base.pipe(
  Setting.live,
  Setting.withDefault("people"),
  Setting.withDescription("Who carries a rule over."),
  Setting.files(["user"]),
  Setting.fileOnly,
);

const liveMiddle = base.pipe(
  Setting.withDefault("people"),
  Setting.withDescription("Who carries a rule over."),
  Setting.live,
  Setting.files(["user"]),
  Setting.fileOnly,
);

const liveLast = base.pipe(
  Setting.fileOnly,
  Setting.files(["repo", "user"]),
  Setting.withDefault("people"),
  Setting.withDescription("Who carries a rule over."),
  Setting.live,
);

// T2, T3, T5: one group with a restart setting, a live setting, and a name with a hyphen and a digit.
const port = Setting.make("instance.port", Port).pipe(
  Setting.withDefault(18800),
  Setting.withDescription("The port the bot listens on."),
  Setting.files(["user"]),
);

const carry = Setting.make("delivery.carry-rule", Rule).pipe(
  Setting.withDefault("people"),
  Setting.withDescription("Who carries a rule over."),
  Setting.live,
);

const tries = Setting.make("quality.max-2-tries", Schema.Int).pipe(
  Setting.withDefault(3),
  Setting.withDescription("How many times a mutation run tries."),
);

const group = SettingGroup.make("demo", port, carry, tries);

type Values = Effect.Success<typeof group>;

const program = Effect.gen(function* () {
  const values = yield* group;

  return values.port;
});

const provided = program.pipe(Effect.provide(SettingGroup.layer(group, { version: "1.2.3" })));

const demoLayer = SettingGroup.layer(group, { version: "1.2.3" });

// T4: a value-level refusal is a line that must not compile. This function is never called, and it hands every
// expression back, so none is a dropped Effect.
const refusals = () => [
  // @ts-expect-error T4: a default of the wrong type
  Setting.make("instance.port", Port).pipe(Setting.withDefault("eighteen")),

  // @ts-expect-error T4: a file list is never empty
  Setting.make("instance.port", Port).pipe(Setting.files([])),

  // @ts-expect-error T4: the user's file is "user", never "person"
  Setting.make("instance.port", Port).pipe(Setting.files(["person"])),

  // @ts-expect-error T4: a live setting is not made live twice
  carry.pipe(Setting.live),

  Effect.gen(function* () {
    // @ts-expect-error T4: a setting is not an Effect, it is read only through its group
    const value = yield* port;

    return value;
  }),
];

it("T1 type: a setting piped through any of the four combinators, in any order, keeps its name, its type and its mark", () => {
  expectTypeOf(restartA).toEqualTypeOf<Setting.Setting<"delivery.carry-rule", Rule, false>>();
  expectTypeOf(restartB).toEqualTypeOf<Setting.Setting<"delivery.carry-rule", Rule, false>>();
  expectTypeOf(restartC).toEqualTypeOf<Setting.Setting<"delivery.carry-rule", Rule, false>>();
  expectTypeOf(restartD).toEqualTypeOf<Setting.Setting<"delivery.carry-rule", Rule, false>>();
  expectTypeOf(base).toEqualTypeOf<Setting.Setting<"delivery.carry-rule", Rule, false>>();
  expectTypeOf(liveFirst).toEqualTypeOf<Setting.Setting<"delivery.carry-rule", Rule, true>>();
  expectTypeOf(liveMiddle).toEqualTypeOf<Setting.Setting<"delivery.carry-rule", Rule, true>>();
  expectTypeOf(liveLast).toEqualTypeOf<Setting.Setting<"delivery.carry-rule", Rule, true>>();
  expectTypeOf(liveLast.live).toEqualTypeOf<true>();
  expectTypeOf(restartA.live).toEqualTypeOf<false>();
});

it("T2 type: a restart setting reads as its plain value, a live setting as a different type, and the field is the last word of the name", () => {
  expectTypeOf<Values>().toEqualTypeOf<{
    readonly port: number;
    readonly carryRule: SettingGroup.Live<Rule>;
    readonly max2Tries: number;
  }>();
  expectTypeOf<keyof Values>().toEqualTypeOf<"port" | "carryRule" | "max2Tries">();
  expectTypeOf<Values["port"]>().toEqualTypeOf<number>();
  expectTypeOf<Values["carryRule"]>().toEqualTypeOf<SettingGroup.Live<Rule>>();
  expectTypeOf<Values["carryRule"]>().not.toExtend<Rule>();
  expectTypeOf<Rule>().not.toExtend<Values["carryRule"]>();
  expectTypeOf<SettingGroup.Live<number>>().not.toExtend<number>();
  expectTypeOf<number>().not.toExtend<SettingGroup.Live<number>>();
  expectTypeOf<Values["port"]>().not.toExtend<Effect.Effect<unknown, unknown, unknown>>();
  expectTypeOf<Values["carryRule"]>().toExtend<Effect.Effect<Rule>>();
});

it("T3 type: yielding a group needs its layer, and the layer leaves only the file system and the path", () => {
  expectTypeOf<Effect.Services<typeof program>>().toEqualTypeOf<
    SettingGroup.Identifier<"demo", typeof group.settings>
  >();
  expectTypeOf<typeof program>().not.toExtend<Effect.Effect<unknown, unknown, never>>();
  expectTypeOf<Effect.Services<typeof provided>>().toEqualTypeOf<FileSystem.FileSystem | Path.Path>();
  expectTypeOf<Effect.Error<typeof provided>>().toEqualTypeOf<SettingGroup.SettingsError>();
  expectTypeOf<Layer.Success<typeof demoLayer>>().toEqualTypeOf<
    SettingGroup.Identifier<"demo", typeof group.settings>
  >();
});

it("T4 type: a default of the wrong type, an empty or misnamed file list, a second live and a yield of a bare setting do not compile", () => {
  // The refusals are in `refusals`; the file lists are also checked as types here.
  expectTypeOf(refusals).toBeFunction();
  expectTypeOf<readonly []>().not.toExtend<Setting.Files>();
  expectTypeOf<readonly ["person"]>().not.toExtend<Setting.Files>();
  expectTypeOf<readonly ["repo", "user"]>().toExtend<Setting.Files>();
  expectTypeOf<typeof Setting.files>().parameter(0).toEqualTypeOf<Setting.Files>();
});

it("T5 type: the layer's only error is SettingsError with its eight reasons, and a file is the repo's or the user's", () => {
  expectTypeOf<Layer.Error<typeof demoLayer>>().toEqualTypeOf<SettingGroup.SettingsError>();
  expectTypeOf<Layer.Services<typeof demoLayer>>().toEqualTypeOf<FileSystem.FileSystem | Path.Path>();
  expectTypeOf<SettingGroup.SettingsError["reason"]>().toEqualTypeOf<
    "version" | "syntax" | "unknown" | "scope" | "invalid" | "missing" | "read" | "edit"
  >();
  expectTypeOf<Setting.File>().toEqualTypeOf<"repo" | "user">();
});

// T6: a setting's value is plain data. The lines that must compile are in `plain`, the lines that must not are in
// `notPlain`. Neither is called, and each hands every expression back, so none is a dropped Effect.
const Slug = Schema.String.pipe(Schema.brand("Slug"));

// A struct with a brand has no index signature left, so it is the case that needs the brand line of `NotPlain`; a
// record with an index signature keeps its own.
const Marked = Schema.Struct({ a: Schema.String, b: Schema.Array(Schema.Int) }).pipe(Schema.brand("Marked"));

const Weights = Schema.Record(Schema.String, Schema.Finite).pipe(Schema.brand("Weights"));

// A length of time as text, checked when the app starts: the form the README gives.
const Wait = Schema.String.check(
  Schema.makeFilter(
    (text: string) =>
      Option.isSome(Schema.decodeUnknownOption(Schema.DurationFromString)(text)) || "a length of time, as 10 seconds",
  ),
);

type Tree = { readonly name: string; readonly children: ReadonlyArray<Tree> };

const Tree: Schema.Codec<Tree> = Schema.Struct({
  name: Schema.String,
  children: Schema.Array(Schema.suspend((): Schema.Codec<Tree> => Tree)),
});

type Dated = { readonly at: Date; readonly later: ReadonlyArray<Dated> };

const Dated: Schema.Codec<Dated> = Schema.Struct({
  at: Schema.Date,
  later: Schema.Array(Schema.suspend((): Schema.Codec<Dated> => Dated)),
});

// The outer record is assignable to the inner one (both may hold `x`), which is the case that tells "the same type"
// from "assignable one way": the inner record must still be read for its `Date`.
const Deep = Schema.Struct({
  x: Schema.optionalKey(Schema.Int),
  y: Schema.optionalKey(Schema.Struct({ x: Schema.optionalKey(Schema.Int), z: Schema.optionalKey(Schema.Date) })),
});

class Box extends Schema.Class<Box, { readonly brand: unique symbol }>("Box")({ size: Schema.Finite }) {}

const plain = () => [
  Setting.make("plain.slug", Slug),
  Setting.make("plain.weights", Weights),
  Setting.make("plain.marked", Marked),
  Setting.make("plain.table", Schema.Record(Schema.String, Schema.Finite)),
  Setting.make("plain.pair", Schema.Struct({ a: Schema.optionalKey(Schema.Int), b: Schema.optionalKey(Schema.Int) })),
  Setting.make("plain.wait", Wait),
  Setting.make("plain.tree", Tree),
];

const notPlain = () => [
  // @ts-expect-error T6: a Date is not plain data
  Setting.make("plain.since", Schema.Date),

  // @ts-expect-error T6: a Map is not plain data
  Setting.make("plain.map", Schema.ReadonlyMap(Schema.String, Schema.Finite)),

  // @ts-expect-error T6: a class instance is not plain data
  Setting.make("plain.box", Box),

  // @ts-expect-error T6: a DateTime is not plain data
  Setting.make("plain.moment", Schema.DateTimeUtc),

  // @ts-expect-error T6: a Duration is not plain data
  Setting.make("plain.time", Schema.Duration),

  // @ts-expect-error T6: null is not plain data
  Setting.make("plain.nothing", Schema.Null),

  // @ts-expect-error T6: any says nothing about its value
  Setting.make("plain.any", Schema.Any),

  // @ts-expect-error T6: an optional value may be undefined, which is not plain data
  Setting.make("plain.maybe", Schema.Struct({ a: Schema.optional(Schema.Int) })),

  // @ts-expect-error T6: a Date deep inside nested records is not plain data
  Setting.make("plain.deep", Deep),

  // @ts-expect-error T6: a Date inside a recursive type is not plain data
  Setting.make("plain.dated", Dated),
];

it("T6 type: a setting's value is plain data, and the part that is not is named", () => {
  expectTypeOf(plain).toBeFunction();
  expectTypeOf(notPlain).toBeFunction();
  expectTypeOf<Setting.NotPlain<Date>>().toEqualTypeOf<Date>();
  expectTypeOf<
    Setting.NotPlain<{ readonly commits: number; readonly time: Duration.Duration }>
  >().toEqualTypeOf<Duration.Duration>();
  expectTypeOf<Setting.NotPlain<{ readonly a: number; readonly b: ReadonlyArray<string> }>>().toEqualTypeOf<never>();
});

// T7: the edit in memory. `SettingGroup.edit(group, text, file)` answers a `set` and a `remove`, each an Effect of the
// new text that fails only with `SettingsError` and needs nothing (Amendment 1: an Effect, as Markdown's set is, in place
// of a `Result`). A setting of another group, a value of the wrong type and a file that is not the repo's or the user's
// are lines that must not compile; this function is never called, and it hands every expression back.
const editing = SettingGroup.edit(group, "", "repo");

const elsewhere = Setting.make("elsewhere.port", Port).pipe(
  Setting.withDefault(1),
  Setting.withDescription("A port of another group."),
);

const edits = () => [
  // @ts-expect-error T7: a setting of another group is not set through this group's edit
  editing.set(elsewhere, 1),

  // @ts-expect-error T7: a setting of another group is not removed through this group's edit
  editing.remove(elsewhere),

  // @ts-expect-error T7: a port is a number, not text
  editing.set(port, "eighteen"),

  // @ts-expect-error T7: a live setting of the group takes its own value type
  editing.set(carry, "owner"),

  // @ts-expect-error T7: a file is the repo's or the user's, never a person's
  SettingGroup.edit(group, "", "person"),
];

it("T7 type: a set and a remove each answer an Effect of the text, failing only with SettingsError and needing nothing, and the wrong setting, value or file does not compile", () => {
  expectTypeOf(edits).toBeFunction();
  expectTypeOf<ReturnType<typeof editing.set<typeof port>>>().toEqualTypeOf<
    Effect.Effect<string, SettingGroup.SettingsError>
  >();
  expectTypeOf<ReturnType<typeof editing.set<typeof carry>>>().toEqualTypeOf<
    Effect.Effect<string, SettingGroup.SettingsError>
  >();
  expectTypeOf<ReturnType<typeof editing.remove>>().toEqualTypeOf<Effect.Effect<string, SettingGroup.SettingsError>>();
  expectTypeOf<Effect.Services<ReturnType<typeof editing.set<typeof port>>>>().toEqualTypeOf<never>();
  expectTypeOf<Effect.Services<ReturnType<typeof editing.remove>>>().toEqualTypeOf<never>();
  expectTypeOf<ReturnType<typeof SettingGroup.edit<"demo", typeof group.settings>>>().toEqualTypeOf<
    SettingGroup.Edit<typeof group.settings>
  >();
});
