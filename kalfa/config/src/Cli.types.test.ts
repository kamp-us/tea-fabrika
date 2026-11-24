// Ticket 1846, kalfa/config (new work), slice 2: C9 of the approved plan (.kalfa/quests/kalfa-config-command-PLAN.md), the
// command's type. Only the compiler judges the `@ts-expect-error` lines and the exact types: a plant that lets a line
// compile leaves its directive unused, which fails the typecheck. The lines are in a function that is never called, so no
// call is made when Vitest loads this file, and the types are those of the real calls on real groups, with no `declare const`.
//
// The command's root is handed in (issue 2076): `kalfa` is the one place that decides the repo's root, so `repo` is not
// optional and the command never takes the current folder on its own (C11 holds the run).
//
// Plants, one at a time:
// - C9 (a): type `groups` as `SettingGroup<string, ...>`: the other-app line of the type check fails. Dropping `NoInfer`
//   alone is not seen by a compiler line: see `Groups` below.
// - C9 (b): widen the command's error to `unknown`: the exact-error line fails.
// - C9 (c): add a service to the command's requirements: the exact-services line fails.
// - C9 (d): make `repo` optional in the options: the line with no `repo` compiles, so its directive is unused.
// - C9 (e): type the command's name as `string`: the exact-name line fails.
import { expectTypeOf, it } from "@effect/vitest";
import { type FileSystem, type Path, Schema } from "effect";
import type { Command } from "effect/cli";
import { config } from "./Cli.ts";
import { Setting, SettingGroup } from "./index.ts";

const approver = Setting.make("delivery.approver", Schema.Literals(["people", "owner"])).pipe(
  Setting.withDefault("people"),
  Setting.withDescription("Who may approve a change request."),
  Setting.live,
);

const main = Setting.make("reconciliation.main", Schema.String).pipe(
  Setting.withDefault("main"),
  Setting.withDescription("The branch the repo's settings are kept on."),
  Setting.files(["repo"]),
  Setting.fileOnly,
);

// Two groups of one app with different settings.
const Delivery = SettingGroup.make("kalfa", approver);

const Reconciliation = SettingGroup.make("kalfa", main);

// A group of another app.
const Elsewhere = SettingGroup.make("other", approver);

const options = { version: "0.0.0", repo: "/work" };

const command = config("kalfa", [Delivery, Reconciliation], options);

// A line is a call that must not compile. None is run.
const refused = () => [
  // @ts-expect-error C9: the root is handed in, never taken from the current folder
  config("kalfa", [Delivery], { version: "0.0.0" }),
  // @ts-expect-error C9: the version is the running app's own, and has no default
  config("kalfa", [Delivery], { repo: "/work" }),
];

// A line that must compile: an app known only as text takes a group of any app. The join holds it at run time (C5), so the
// call is made in a function that is never called.
const accepted = () => [config<string>("kalfa", [Elsewhere, Delivery], options)];

// What a call of the app "kalfa" takes as its groups. A group of another app is held out here, in the parameter's own type,
// and not by a call with one: a group passed in place is an Effect whose context the call lacks, which the Effect plugin
// reports on that line beside the compile error, and a directive cannot hold the plugin's report.
type Groups = Parameters<typeof config<"kalfa">>[1];

it('C9 type: `config(app, groups, options)` is a `Command<"config", ...>` whose error is exactly `SettingsError` and whose requirements are exactly `FileSystem | Path`; it takes groups with different settings; a group of another literal app is not one of its groups, while `config<string>(...)` takes it; the root is handed in', () => {
  expectTypeOf(refused).toBeFunction();
  expectTypeOf(accepted).toBeFunction();
  expectTypeOf<ReturnType<typeof accepted>[number]["name"]>().toEqualTypeOf<"config">();
  expectTypeOf(command.name).toEqualTypeOf<"config">();
  expectTypeOf<Command.Error<typeof command>>().toEqualTypeOf<SettingGroup.SettingsError>();
  expectTypeOf<Command.Services<typeof command>>().toEqualTypeOf<FileSystem.FileSystem | Path.Path>();
  expectTypeOf<ReadonlyArray<typeof Delivery | typeof Reconciliation>>().toExtend<Groups>();
  expectTypeOf<ReadonlyArray<typeof Elsewhere>>().not.toExtend<Groups>();
});
