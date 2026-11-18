// Test-owned sibling Layer. Exhaustion fails closed instead of inventing another checked person.
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { Answer, PersonCheck, PersonCheckError, Unavailable } from "./PersonCheck.ts";

/**
 * Creates a `PersonCheck` layer that gives one scripted answer per ask, in order. An `unavailable` entry, or an
 * ask past the end of the list, fails with `PersonCheckError`.
 *
 * @category layers
 */
export const layer = (
  answers: ReadonlyArray<"touch" | "click" | "declined" | "unavailable">,
): Layer.Layer<PersonCheck> =>
  Layer.sync(PersonCheck, () => {
    let next = 0;

    return PersonCheck.of({
      ask: Effect.fn("PersonCheckTest.ask")(function* (_reason: string) {
        const answer = answers[next++];

        if (answer === "touch" || answer === "click") {
          return Answer.cases.checked.make({ check: answer });
        }

        if (answer === "declined") {
          return Answer.cases.declined.make({});
        }

        return yield* PersonCheckError.make({
          reason: Unavailable.make({ cause: new Error("No test check available") }),
        });
      }),
    });
  });
