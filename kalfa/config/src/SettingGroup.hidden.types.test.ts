// Ticket 1310, slice 2: C3 of the approved plan (.kalfa/quests/kalfa-hidden-cause-PLAN.md), the types of Configuration's two hidden causes. A hidden cause is a
// `Redacted`, so a raw error, a text or a missing cause (where one is needed) is no cause. Only the compiler judges them (`tsc`, and the root `typecheck`): each
// `@ts-expect-error` is a mistake that must stay a compile error, and the body holds type checks only, so the file also runs under vitest by path.
//
// Plants: (a) keep `cause: Schema.optional(Schema.Defect())` on `SnapshotError` (Snapshot.ts): its cause is `unknown`, so the raw-error line compiles, its
// `@ts-expect-error` is unused, and the exact-type line fails; (b) type `SettingsError`'s cause as `Schema.optional(Schema.Defect())`: the same two failures.
import { expectTypeOf, it } from "@effect/vitest";
import { Redacted } from "effect";
import { SettingGroup } from "./index.ts";
import { SnapshotError } from "./Snapshot.ts";

const hiddenTypes = (raw: Error) => {
  expectTypeOf<SnapshotError["cause"]>().toEqualTypeOf<Redacted.Redacted<unknown> | undefined>();
  expectTypeOf<SettingGroup.SettingsError["cause"]>().toEqualTypeOf<Redacted.Redacted<unknown> | undefined>();

  // No cause, or a hidden one.
  const none = new SnapshotError({ message: "m" });
  const hidden = new SnapshotError({ message: "m", cause: Redacted.make(raw) });
  // @ts-expect-error a raw error is no cause: a cause is made hidden first
  const rawSnapshot = new SnapshotError({ message: "m", cause: raw });
  // @ts-expect-error a raw error is no cause of a settings error either
  const rawSettings = new SettingGroup.SettingsError({ reason: "read", message: "m", cause: raw });

  expectTypeOf([none, hidden, rawSnapshot, rawSettings]).toBeArray();
};

it("C3 type: a hidden cause of SnapshotError and SettingsError is a Redacted, and a raw error is no cause", () => {
  // These compile-time laws need tsc, which the lead runs after the build.
  expectTypeOf(hiddenTypes).toBeFunction();
});
