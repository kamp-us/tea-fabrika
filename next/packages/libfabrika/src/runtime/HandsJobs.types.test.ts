// P39 slice 3 (ticket 1040), next/, T1 (0095, 0043): `HandsJobs.ts` holds the contract the runner
// talks to, in the runtime module's own types and error and the shared names. The jobs module's
// `JobsError` and the ledger's `LedgerError` are translated at the service, never part of it, and
// its one layer is the sibling `HandsJobsLive.ts`, read through its module. CI's typecheck is this
// law's runner. Plant (after build): put `JobsError` in `ask`'s error channel.
import { expectTypeOf, it } from "@effect/vitest";
import type { Context, Effect, Layer } from "effect";
import type { Jobs, JobsError } from "../jobs/Jobs.ts";
import type { From } from "../processes/Mailbox.ts";
import type * as HandsJobsFront from "./HandsJobs.ts";
import type { Ask, HandsJobs, HandsJobsError, Reply } from "./HandsJobs.ts";
import type * as HandsJobsLive from "./HandsJobsLive.ts";

it("type: T1 HandsJobs speaks its own error and shared names only, never JobsError or LedgerError", () => {
  // The one call, as the contract writes it. A jobs or ledger error in its error channel fails here.
  expectTypeOf<Context.Service.Shape<typeof HandsJobs>>().toEqualTypeOf<{
    readonly ask: (ask: typeof Ask.Type, from: From) => Effect.Effect<typeof Reply.Type, HandsJobsError>;
  }>();
  expectTypeOf<Extract<HandsJobsError, JobsError>>().toEqualTypeOf<never>();
  // Its reasons are its own, and each may pass: a lost or failed call, or a failed read or write.
  expectTypeOf<HandsJobsError["reason"]>().toEqualTypeOf<"storage" | "unavailable">();
  // The answer is one of three cases, each the runner's to read.
  expectTypeOf<(typeof Reply.Type)["_tag"]>().toEqualTypeOf<"waiting" | "finished" | "refused">();
  // A refusal is for good, and an answer: no hands key, or a job under the id that is not this process's.
  expectTypeOf<Extract<typeof Reply.Type, { _tag: "refused" }>["reason"]>().toEqualTypeOf<"no_hands" | "conflict">();
  // The layer serves HandsJobs over the jobs service, and fails with nothing of its own while built.
  type Live = ReturnType<typeof HandsJobsLive.layer>;
  expectTypeOf<Layer.Success<Live>>().toEqualTypeOf<HandsJobs>();
  expectTypeOf<Layer.Error<Live>>().toEqualTypeOf<never>();
  expectTypeOf<Layer.Services<Live>>().toEqualTypeOf<Jobs>();
  // No static layer on the class, and the contract module exports no layer.
  expectTypeOf<"layer" extends keyof typeof HandsJobs ? true : false>().toEqualTypeOf<false>();
  expectTypeOf<"layer" extends keyof typeof HandsJobsFront ? true : false>().toEqualTypeOf<false>();
  // The error is a schema value of its own, so it crosses the Project RPC as the module wrote it.
  expectTypeOf<typeof HandsJobsError.Type>().toEqualTypeOf<HandsJobsError>();
});
