// Ticket 1843, slice 1, kalfa/config (new work): T8 of the approved plan (.kalfa/quests/kalfa-config-edit-PLAN.md), the
// type law, written first. The file format (how an app's configuration files are written; TOML is the only one) lives
// inside the package, and no name of the root entry's `Setting` or `SettingGroup` is one. Only the compiler judges it:
// the lead's one `pnpm typecheck` reads this file, and Vitest does not typecheck, so each body holds type checks only.
// Each `@ts-expect-error` is a line that must not compile; a plant that lets it compile leaves the directive unused,
// which fails the typecheck.
//
// Two halves, so the law is not an empty "nothing is exported" that holds with no format at all: the first pins that
// the inner format exists with the calls the plan gives it, the second that no public name reaches it.
//
// Plant, run once and never kept: in `SettingGroup.ts` add `export { toml } from "./internal/toml.ts"` (or export the
// `Format` type), and the matching `@ts-expect-error` below is unused, and `Leaked` is no longer `never`: tsc red.
import { expectTypeOf, it } from "@effect/vitest";
import type { Setting, SettingGroup } from "./index.ts";
import type { Format } from "./internal/format.ts";

// The names the plan gives the format and its parts. None may be a name of either public namespace.
type FormatName = "Format" | "format" | "toml" | "Document" | "Fault";

type Leaked = Extract<keyof typeof Setting | keyof typeof SettingGroup, FormatName>;

const contract = () => {
  // The inner format exists, says its name and its file ending, and parses, sets and removes.
  expectTypeOf<Format["name"]>().toEqualTypeOf<string>();
  expectTypeOf<Format["extension"]>().toEqualTypeOf<string>();
  expectTypeOf<Format["parse"]>().toExtend<(...args: never) => unknown>();
  expectTypeOf<Format["set"]>().toExtend<(...args: never) => unknown>();
  expectTypeOf<Format["remove"]>().toExtend<(...args: never) => unknown>();

  // No value of the root entry's two namespaces is a format.
  expectTypeOf<Leaked>().toEqualTypeOf<never>();
};

// A type is not a key of `typeof`, so each type name is a line that must not compile.
// @ts-expect-error T8: the format is not a type of SettingGroup
export type NoGroupFormat = SettingGroup.Format;

// @ts-expect-error T8: the format is not a type of Setting
export type NoSettingFormat = Setting.Format;

// @ts-expect-error T8: the format's fault is not a type of SettingGroup
export type NoGroupFault = SettingGroup.Fault;

// @ts-expect-error T8: the format's document is not a type of SettingGroup
export type NoGroupDocument = SettingGroup.Document;

it("T8 type: the format is inside the package, and no name of Setting or SettingGroup is one", () => {
  // These compile-time laws need tsc, which the lead runs after build.
  expectTypeOf(contract).toBeFunction();
});
