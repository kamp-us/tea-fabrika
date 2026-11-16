// T1062 slice 1, next/: L3 of docs/plan/quests/error-cause-PLAN.md (decision 0568). The transport's
// one WebCrypto edge makes `WebCryptoError` from what WebCrypto rejected with (`internal/binary.ts:85`),
// so its cause is required and no site can leave it out. The compiler checks these lines
// (`pnpm typecheck`); Vitest does not typecheck, so the body holds type assertions only (0527).
// Plant: make `internal/binary.ts:68` optional again; the `@ts-expect-error` goes unused and the
// typecheck fails.
import { expectTypeOf, it } from "@effect/vitest";
import { WebCryptoError } from "./internal/binary.ts";

/** A WebCryptoError made without a cause, and one made with it. Never called. */
const uncaused = (cause: unknown) => {
  // @ts-expect-error every caller of WebCryptoError has a cause, so the field is required (0568).
  const bare = new WebCryptoError({});
  const kept = new WebCryptoError({ cause });
  return { bare, kept };
};

it("type: T1062 L3 a WebCryptoError is never made without its cause, and its cause is any value", () => {
  expectTypeOf<WebCryptoError["cause"]>().toEqualTypeOf<unknown>();
  expectTypeOf<ReturnType<typeof uncaused>["kept"]>().toEqualTypeOf<WebCryptoError>();
  expectTypeOf(uncaused).toBeFunction();
});
