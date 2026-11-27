// D3, the settings' types: what a `Settings` holds and every way one can be written. They are checked by the compiler (`tsc`, and the root `typecheck`),
// not by a test run: each `@ts-expect-error` below is a mistake the plan names, and it must stay a compile error. The helper holds the law's lines and
// takes its values as parameters, and its `it` only names it, so the file also runs under vitest by path.
import { expectTypeOf, it } from "@effect/vitest";
import type * as Settings from "./Settings.ts";

// A place that asks for settings, the way a layer's constructor does.
const asked = (settings: Settings.Settings): Settings.Settings => settings;

// D3. Plant: make `limits` optional (the `{}` line compiles); make `bytes` `Schema.optional` (the `undefined` line compiles); type `bytes` as `string` (the
// text line compiles); drop `bytes` from `limits` (the `{ limits: {} }` line compiles); add a second required limit (the literal line fails).
const settingsTypes = (written: Settings.Settings, count: number) => {
  // Every way settings can be written and be right: a literal, a variable of the type, and a widened number.
  const ok = [asked({ limits: { bytes: 64 } }), asked(written), asked({ limits: { bytes: count } })];

  // Every way they can be written and be wrong.
  // @ts-expect-error settings have limits
  const none = asked({});
  // @ts-expect-error limits have bytes
  const noBytes = asked({ limits: {} });
  // @ts-expect-error bytes is a number, never text
  const textBytes = asked({ limits: { bytes: "64" } });
  // @ts-expect-error bytes is given, or the settings are not
  const undefinedBytes = asked({ limits: { bytes: undefined } });

  expectTypeOf<Settings.Settings>().toEqualTypeOf<{ readonly limits: { readonly bytes: number } }>();

  return [ok, none, noBytes, textBytes, undefinedBytes];
};

it("D3 type: Settings is limits with a number of bytes, written as a literal, a variable or a widened number, and no other way", () => {
  // These compile-time laws need tsc, which the lead runs after build.
  expectTypeOf(settingsTypes).toBeFunction();
});
