// Alerts: the open `ci-scheduled` issues the sev script reads, which keep a sev1 on. Two checks
// open them: the full run when red (0534, "Scheduled CI is red on main") and the daily speed
// check when a number is over its goal (0541, "CI speed: a stage is over its goal"). Each closes its
// own. The script only reads them: it never opens, closes, labels or comments on one.
//
// This file is the contract only (0095): `AlertsGh.layer` asks GitHub through `gh`,
// `AlertsTest.layer` answers from a list in memory. Today's lead tooling; it is not product.
import { Context, Schema } from "effect";
import type { Effect } from "effect";
import type { Alert } from "./Level.ts";

/** GitHub could not be asked, refused, or answered in a shape we do not read. */
export class AlertsError extends Schema.TaggedError<AlertsError>()("AlertsError", { reason: Schema.String }) {}

export class Alerts extends Context.Service<
  Alerts,
  {
    /** Every open issue that carries the `ci-scheduled` label, oldest first. */
    readonly open: Effect.Effect<ReadonlyArray<Alert>, AlertsError>;
  }
>()("@tea-fabrika/agents/skills/sev/scripts/Alerts") {}
