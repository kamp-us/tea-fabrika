/**
 * The adapter that gives today's callers the `Toml` service. The grammar lives in `internal/toml.ts`; this file only turns each of its results back into an Effect and each fault into a `TomlError`.
 */
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Result from "effect/Result";

import { type Fault } from "./internal/format.ts";
import { toml } from "./internal/toml.ts";
import { Conflict, Syntax, Toml, TomlError, Value } from "./Toml.ts";

const reason = (fault: Fault, path: ReadonlyArray<string>): Syntax | Value | Conflict => {
  switch (fault._tag) {
    case "Syntax":
      return new Syntax({ cause: fault.cause });
    case "Value":
      return new Value({ cause: fault.cause });
    case "Conflict":
      return new Conflict({ path, cause: fault.cause });
  }
};

const failure = (fault: Fault, path: ReadonlyArray<string>): TomlError =>
  new TomlError({
    reason: reason(fault, path),
    message: fault.cause instanceof Error ? fault.cause.message : "The TOML operation failed.",
    line: fault._tag === "Value" ? 1 : fault.line,
    cause: fault.cause,
  });

const lift = <A>(run: () => Result.Result<A, Fault>, path: ReadonlyArray<string>): Effect.Effect<A, TomlError> =>
  Effect.suspend(() => Effect.fromResult(Result.mapError(run(), (fault) => failure(fault, path))));

/**
 * Layer that provides `Toml` from the TOML parser and serializer.
 *
 * **Details**
 *
 * `parse` reads a document with the parser. `set` and `remove` first parse the text, then edit it by source position, and parse the edited text again before returning it. `set` also checks that the value can be written as TOML.
 *
 * @category layers
 */
export const layer = Layer.succeed(
  Toml,
  Toml.of({
    parse: (text) => lift(() => toml.parse(text), []),
    set: (text, path, value) => lift(() => toml.set(text, path, value), path),
    remove: (text, path) => lift(() => toml.remove(text, path), path),
  }),
);
