/**
 * What `kalfa` writes of its own: the readable line of a diagnostic, the line of a failure, and the help.
 *
 * **Details**
 *
 * Standard output holds only what a handler prints through `Console`, and the help or version a person asked for. Every line `kalfa` writes itself goes to standard error.
 */
import * as Diagnostic from "@kalfa/diagnostics/Diagnostic";
import * as Diagnostics from "@kalfa/diagnostics/Diagnostics";
import { Console, Effect, Layer, Predicate, Ref } from "effect";
import { CliOutput } from "effect/cli";

/** How many errors and warnings a run reported so far. */
export interface Counts {
  readonly errors: number;
  readonly warnings: number;
}

// A control, format or surrogate character, U+2028, U+2029 and a backslash: the characters that could break a line or rewrite a terminal, and the one that undoes the escape.
const UNSAFE = /[\p{Cc}\p{Cf}\p{Cs}\u2028\u2029\\]/gu;

const SHORT: Readonly<Record<string, string>> = {
  "\b": "\\b",
  "\t": "\\t",
  "\n": "\\n",
  "\f": "\\f",
  "\r": "\\r",
  "\\": "\\\\",
};

// One `\uXXXX` for each UTF-16 unit, so a character outside the first plane is two.
const unicode = (character: string): string =>
  Array.from(
    { length: character.length },
    (_, unit) => `\\u${character.charCodeAt(unit).toString(16).padStart(4, "0")}`,
  ).join("");

/**
 * Writes each control, format and surrogate character, U+2028, U+2029 and backslash as JSON writes it, so nothing in a message can end its line and the escape can be undone.
 *
 * @category formatting
 */
export const escape = (text: string): string =>
  text.replace(UNSAFE, (character) => SHORT[character] ?? unicode(character));

/**
 * The readable line of a diagnostic: `<place>: <severity> <code>: <message> Hint: <hint>`, each text escaped.
 *
 * @category formatting
 */
export const line = (diagnostic: Diagnostic.Reported): string =>
  `${escape(Diagnostic.formatPlace(diagnostic.place))}: ${diagnostic.severity} ${diagnostic.code}: ${escape(diagnostic.message)} Hint: ${escape(diagnostic.hint)}`;

/**
 * The line of a failure: `kalfa: <message>`, the message escaped.
 *
 * @category formatting
 */
export const failure = (message: string): string => `kalfa: ${escape(message)}`;

const print = Effect.fn("cli.print")(function* (counts: Ref.Ref<Counts>, reported: Diagnostic.Reported) {
  // The code and the severity only: a message, a hint or a place may hold what a person typed.
  yield* Effect.annotateCurrentSpan({ "kalfa.cli.code": reported.code, "kalfa.cli.severity": reported.severity });
  yield* Console.error(line(reported));
  yield* Ref.update(counts, (seen) =>
    reported.severity === "error" ? { ...seen, errors: seen.errors + 1 } : { ...seen, warnings: seen.warnings + 1 },
  );
});

/**
 * The `Diagnostics` a run gives its handler: writes each report as its readable line to standard error at once, and counts it.
 *
 * @category layers
 */
export const diagnostics = (counts: Ref.Ref<Counts>): Layer.Layer<Diagnostics.Diagnostics> =>
  Layer.succeed(Diagnostics.Diagnostics, { report: (reported) => print(counts, reported) });

/**
 * Help a person asked for, and the version, go to standard output as effect/cli writes them; the help of a bad invocation goes to standard error.
 *
 * @category layers
 */
export const presenter: Layer.Layer<never> = CliOutput.layerPresenter({
  present: (event) => {
    const asked =
      Predicate.isTagged(event, "Version") || (Predicate.isTagged(event, "Help") && event.reason === "Requested");

    // effect/cli writes help with `Console.log`, so the same text goes to standard error through a console whose `log` is its `error`.
    return asked
      ? CliOutput.defaultPresenter.present(event)
      : Console.consoleWith((current) =>
          CliOutput.defaultPresenter
            .present(event)
            .pipe(
              Effect.provideService(Console.Console, Object.assign(Object.create(current), { log: current.error })),
            ),
        );
  },
});
