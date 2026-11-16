// AlertsGh.layer: the Alerts service on `gh issue list`, read only. Every call names the repo, so
// the checkout it runs in does not pick it.
import { Effect, Layer, Schema } from "effect";
import { ChildProcessSpawner } from "effect/process";
import { lastLine, run } from "../../lead/scripts/pr/command.ts";
import { Alerts, AlertsError } from "./Alerts.ts";
import type { Alert } from "./Level.ts";

/**
 * The label both checks put on their issue: `LABEL` in `.github/ci/scheduled.mjs` and `LABEL_NAME`
 * in `lead/scripts/ci/Speed.ts`. Written here again so this script's typecheck does not take in
 * Speed.ts; the reader law in AlertsGh.test.ts holds the three equal.
 */
export const LABEL = "ci-scheduled";

/** The most issues one list reads; two checks open at most one each, so this is never reached. */
const LIMIT = 100;

const Listed = Schema.fromJsonString(
  Schema.Array(Schema.Struct({ number: Schema.Number, title: Schema.String, createdAt: Schema.String })),
);

/** `gh issue list --json`'s rows, as `Alert`s, oldest first. */
export const alertsIn = (out: string): Effect.Effect<ReadonlyArray<Alert>, Schema.SchemaError> =>
  Effect.map(Schema.decodeEffect(Listed)(out.trim() || "[]"), (rows) =>
    rows
      .map((r): Alert => ({ number: r.number, title: r.title, since: r.createdAt }))
      .toSorted((a, b) => a.number - b.number),
  );

/** `repo` is `owner/name`; `cwd` is any folder gh may start in. */
export const layer = (repo: string, cwd: string): Layer.Layer<Alerts, never, ChildProcessSpawner.ChildProcessSpawner> =>
  Layer.effect(
    Alerts,
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
      const args = ["issue", "list", "-R", repo, "--label", LABEL, "--state", "open"];

      const open = Effect.gen(function* () {
        const ran = yield* run("gh", [...args, "--json", "number,title,createdAt", "-L", String(LIMIT)], cwd);

        if (ran.code !== 0) {
          return yield* new AlertsError({ reason: `gh issue list exited ${ran.code}: ${lastLine(ran)}` });
        }

        return yield* alertsIn(ran.out).pipe(
          Effect.mapError(() => new AlertsError({ reason: "gh issue list answered a shape we do not read" })),
        );
      }).pipe(
        Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
        Effect.catchTag("PlatformError", (e) =>
          Effect.fail(new AlertsError({ reason: `gh could not start: ${e.message}` })),
        ),
      );

      return Alerts.of({ open });
    }),
  );
