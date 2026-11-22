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
// - T5: add `"person"` to `Setting.File`.
import { expectTypeOf, it } from "@effect/vitest";
import { Effect, type FileSystem, type Path, Schema } from "effect";
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

it("T5 type: the layer's only error is SettingsError with its seven reasons, and a file is the repo's or the user's", () => {
  expectTypeOf<Layer.Error<typeof demoLayer>>().toEqualTypeOf<SettingGroup.SettingsError>();
  expectTypeOf<Layer.Services<typeof demoLayer>>().toEqualTypeOf<FileSystem.FileSystem | Path.Path>();
  expectTypeOf<SettingGroup.SettingsError["reason"]>().toEqualTypeOf<
    "version" | "syntax" | "unknown" | "scope" | "invalid" | "missing" | "read"
  >();
  expectTypeOf<Setting.File>().toEqualTypeOf<"repo" | "user">();
});
