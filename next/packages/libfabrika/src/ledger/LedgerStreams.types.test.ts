// A13, next/. Type checks keep the ledger discovery contract independent of its callers.
import { expectTypeOf, it } from "@effect/vitest";
import type * as Context from "effect/Context";
import type * as Stream from "effect/Stream";
import type { BadRow, LedgerStreams, LedgerStreamsError, Storage } from "./LedgerStreams.ts";

it("type: A13 discovery lists names, and its errors keep their tagged reason and cause", () => {
  expectTypeOf<Context.Service.Shape<typeof LedgerStreams>>().toEqualTypeOf<{
    readonly list: (prefix: string) => Stream.Stream<string, LedgerStreamsError>;
  }>();
  expectTypeOf<LedgerStreamsError["reason"]>().toEqualTypeOf<Storage | BadRow>();
  expectTypeOf<Storage["cause"]>().toEqualTypeOf<unknown>();
  expectTypeOf<BadRow["cause"]>().toEqualTypeOf<unknown>();
  expectTypeOf<typeof LedgerStreams>().not.toHaveProperty("layer");
});
