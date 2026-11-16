// P18 slice 2, next/ (ticket 979): T2. A tile's reach makes the invalid states unrepresentable: an
// `opening` or `open` tile always holds the ref of the watch it made, and an `ended` tile always
// holds the exit reason it shows. The type checker reads the law; Vitest does not typecheck, so the
// lead and CI run it with `pnpm typecheck`.
// Plant: make `ref` optional on `opening` or `open`, or type `ended`'s `reason` as a string.
import { expectTypeOf, it } from "@effect/vitest";
import type { Types } from "effect";
import type { ExitReason } from "../processes/ExitReason.ts";
import type { WindowModel } from "./WindowMachine.ts";

type Reach = WindowModel["tiles"][number]["reach"];
type Case<Tag extends string> = Types.ExtractTag<Reach, Tag>;

it("type: opening and open require their ref, and ended requires its ExitReason", () => {
  expectTypeOf<Pick<Case<"opening">, "ref">>().toEqualTypeOf<{ readonly ref: string }>();
  expectTypeOf<Pick<Case<"open">, "ref">>().toEqualTypeOf<{ readonly ref: string }>();
  expectTypeOf<Pick<Case<"ended">, "reason">>().toEqualTypeOf<{ readonly reason: ExitReason }>();
  expectTypeOf<Case<"ended">["pid"]>().toEqualTypeOf<string>();
});
