// Ticket 1840, kalfa/config (new work): F1 of the approved plan (.kalfa/quests/kalfa-config-flags-PLAN.md), the type
// law of `SettingGroup.flags`, written first. It settles the plan's 70% doubt: whether a record whose keys are all
// optional fits `Command.make`'s config (an index signature) through `Command.Config.Infer`, with no cast. Only the
// compiler judges it: Vitest does not typecheck, so each body holds type checks only, and each `@ts-expect-error` is a
// line that must not compile (a plant that lets it compile leaves the directive unused, which fails the typecheck).
// The runtime laws F2 to F12 are in SettingGroup.flags.test.ts.
//
// Plants (run once, never kept), F1: (a) give `Flags` the window for every group, so the group with no live setting holds it
// and its `keyof` line is red; (b) key `FlagValues` by the value's field in place of the setting's name, so the
// handler's input no longer fits `layer`'s `flags` option and the names are lost.
import { expectTypeOf, it } from "@effect/vitest";
import { Effect, Option, Schema } from "effect";
import * as Command from "effect/cli/Command";
import type * as Flag from "effect/cli/Flag";
import { Setting, SettingGroup } from "./index.ts";

const Port = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 65535 }));

const Rule = Schema.Literals(["people", "robots"]);

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

const secret = Setting.make("net.key-file", Schema.String).pipe(
  Setting.withDescription("Where the key is."),
  Setting.fileOnly,
);

const group = SettingGroup.make("demo", port, carry, secret);

type Settings = typeof group.settings;

// A group with a live setting is read with the quiet window too, so its flags and flag values hold that name beside the
// declared ones that a flag may set (ticket 1841). A group with no live setting holds exactly those. A file-only setting,
// `net.key-file` here, has no key at all (ticket 1842).
type Names = "instance.port" | "delivery.carry-rule" | "config.watch.debounce";

const quiet = SettingGroup.make("demo", port, secret);

type QuietNames = "instance.port";

const quietFlags = SettingGroup.flags(quiet);

const flags = SettingGroup.flags(group);

// The flags nested under `settings`, as the plan's sketch writes the command. The handler's input is written as the
// flag values and handed to the layer as they are: no cast on either line.
const command = Command.make(
  "demo",
  { settings: SettingGroup.flags(group) },
  ({ settings }: { readonly settings: SettingGroup.FlagValues<Settings> }) =>
    Effect.provide(Effect.void, SettingGroup.layer(group, { version: "1.2.3", flags: settings })),
);

// The same flags as a command's shared flags, so an app can give every subcommand the settings.
const shared = Command.make("demo").pipe(Command.withSharedFlags({ settings: SettingGroup.flags(group) }));

// A record written by hand, as a program with no command line writes it.
const written: SettingGroup.FlagValues<Settings> = { "instance.port": Option.none<string>() };

// A group whose names are not literal types, as a program that reads them at run time makes it: its flags are a plain
// record, and fit `Command.make` with no cast.
const wide: SettingGroup.SettingGroup<string, ReadonlyArray<Setting.Any>> = SettingGroup.make(
  "demo",
  ...group.settings,
);

const wideFlags = SettingGroup.flags(wide);

const wideCommand = Command.make(
  "demo",
  { settings: SettingGroup.flags(wide) },
  ({ settings }: { readonly settings: SettingGroup.FlagValues<ReadonlyArray<Setting.Any>> }) =>
    Effect.provide(Effect.void, SettingGroup.layer(wide, { version: "1.2.3", flags: settings })),
);

// A group made without flags, as 1839's laws write it.
const bare = SettingGroup.layer(group, { version: "1.2.3" });

const refusals = () => [
  // @ts-expect-error F1: a key that names no setting
  SettingGroup.layer(group, { version: "1.2.3", flags: { "instance.prot": Option.none<string>() } }),

  // @ts-expect-error F1: a flag's text is text, not a number
  SettingGroup.layer(group, { version: "1.2.3", flags: { "instance.port": 4200 } }),

  // @ts-expect-error F1: a key by value field, not by setting name
  SettingGroup.layer(group, { version: "1.2.3", flags: { port: Option.none<string>() } }),
];

it("F1 type: the flags fit a command's config and shared flags with no cast, the handler's input is the flag values keyed by setting name, and a layer with no flags is unchanged", () => {
  // The flags are one optional text flag per setting name.
  expectTypeOf(flags).toEqualTypeOf<SettingGroup.Flags<Settings>>();
  expectTypeOf(flags).toEqualTypeOf<{
    readonly [K in Names]?: Flag.Flag<Option.Option<string>>;
  }>();
  expectTypeOf<keyof typeof flags>().toEqualTypeOf<Names>();

  // A group with no live setting has exactly the flags a flag may set.
  expectTypeOf<keyof typeof quietFlags>().toEqualTypeOf<QuietNames>();
  expectTypeOf<keyof SettingGroup.FlagValues<typeof quiet.settings>>().toEqualTypeOf<QuietNames>();

  // The handler's input for the nested record is exactly the flag values, and it fits the layer's option as it is.
  type Input = Command.Command.Config.Infer<{ readonly settings: SettingGroup.Flags<Settings> }>["settings"];

  expectTypeOf<Input>().toEqualTypeOf<SettingGroup.FlagValues<Settings>>();
  expectTypeOf<SettingGroup.FlagValues<Settings>>().toEqualTypeOf<{
    readonly [K in Names]?: Option.Option<string>;
  }>();
  expectTypeOf<Input>().toExtend<NonNullable<Parameters<typeof SettingGroup.layer<"demo", Settings>>[1]["flags"]>>();

  // A command and shared flags made from them are commands.
  expectTypeOf(command).toExtend<Command.Command.Any>();
  expectTypeOf(shared).toExtend<Command.Command.Any>();
  expectTypeOf(written).toEqualTypeOf<SettingGroup.FlagValues<Settings>>();

  // A group of any settings has a plain record of flags, and its command takes them as they are.
  expectTypeOf(wideFlags).toEqualTypeOf<Readonly<Record<string, Flag.Flag<Option.Option<string>>>>>();
  expectTypeOf(wideCommand).toExtend<Command.Command.Any>();

  // The layer's type does not move when flags are given or left out.
  expectTypeOf(bare).toEqualTypeOf<ReturnType<typeof SettingGroup.layer<"demo", Settings>>>();
  expectTypeOf(refusals).toBeFunction();
});
