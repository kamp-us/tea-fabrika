// AlertsTest.layer: the Alerts service in memory, on one list of open issues. It asks GitHub
// nothing, and it has no write to keep: the service has none.
import { Effect, Layer } from "effect";
import { Alerts, AlertsError } from "./Alerts.ts";
import type { Alert } from "./Level.ts";

/** The open issues, or the reason the read fails. */
export const layer = (issues: ReadonlyArray<Alert> | { readonly failing: string }): Layer.Layer<Alerts> =>
  Layer.succeed(
    Alerts,
    Alerts.of({
      open: "failing" in issues ? Effect.fail(AlertsError.make({ reason: issues.failing })) : Effect.succeed(issues),
    }),
  );
