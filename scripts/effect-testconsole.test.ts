// Shared Effect patch: today's version and next/. Ticket 1067, law L3: `TestConsole.warnLines`,
// `infoLines` and `debugLines`, the readers patches/effect@4.1.3.patch adds for the `Console.warn`,
// `Console.info` and `Console.debug` calls TestConsole already keeps.
import { Console, Effect } from "effect";
import { TestConsole } from "effect/testing";
import fc from "fast-check";
import { expect, it } from "vitest";

const METHODS = ["warn", "log", "error", "info", "debug"] as const;

/** A program's console calls, in order: each a method and its parameters. */
const Calls = fc.array(
  fc.record({ method: fc.constantFrom(...METHODS), parameters: fc.array(fc.string(), { maxLength: 4 }) }),
  { maxLength: 24 },
);

const print = {
  warn: Console.warn,
  log: Console.log,
  error: Console.error,
  info: Console.info,
  debug: Console.debug,
};

// Plants L3: filter `warnLines` on "error", `infoLines` on "warn" or `debugLines` on "log" in the
// patch's TestConsole: L3 red.
it("L3 warnLines, infoLines and debugLines give every parameter of their method in order, and logLines and errorLines answer as before", () => {
  const seen = new Set<string>();
  fc.assert(
    fc.property(Calls, (calls) => {
      const read = Effect.runSync(
        Effect.gen(function* () {
          for (const { method, parameters } of calls) {
            yield* print[method](...parameters);
          }

          return {
            warn: yield* TestConsole.warnLines,
            log: yield* TestConsole.logLines,
            error: yield* TestConsole.errorLines,
            info: yield* TestConsole.infoLines,
            debug: yield* TestConsole.debugLines,
          };
        }).pipe(Effect.provide(TestConsole.layer)),
      );
      const of = (method: (typeof METHODS)[number]) =>
        calls.flatMap((call) => (call.method === method ? call.parameters : []));
      expect(read).toEqual({
        warn: of("warn"),
        log: of("log"),
        error: of("error"),
        info: of("info"),
        debug: of("debug"),
      });

      for (const { method, parameters } of calls) {
        seen.add(`${method}:${parameters.length > 0 ? "some" : "none"}`);
      }
    }),
    { seed: 119120, numRuns: 100 },
  );

  // Coverage: every method was called with parameters, so a reader that takes another method's is seen.
  for (const method of METHODS) {
    expect(seen, method).toContain(`${method}:some`);
  }
});
