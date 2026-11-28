// Ticket 2000, kalfa/config (new work): P1 to P5, P10 and P11 of the approved plan (.kalfa/quests/kalfa-config-error-data-PLAN.md),
// for the root entry's `SettingsError` (`@kalfa/config`, `SettingGroup`). The type law P8 is in SettingGroup.types.test.ts, and
// P7 is the move of the older laws from `file` and `line` to `place` (Cli.refusals.test.ts and the laws that read an error).
// Written before the code. The file is named `Cli.places` because it runs the `config` command too, and `layer-rules.json`
// puts `Cli*.ts` in the layer that may import the command's own test support.
//
// What the code does, as these laws hold it to (the plan's "The shape" and "Where each place comes from"):
// - An error holds where its fault is as data, a `Diagnostic.Place` of the kind it is: the repo file, the user file, an
//   environment variable or a flag, built where the fault is found. A fault with no place (a snapshot stream that ends, a typed
//   name that is no setting) holds none, and carries no diagnostic.
// - An error with a place carries a diagnostic: the code its reason declares, its fault sentence as the message, its place,
//   and one fixed hint for its reason. Nothing private rides along.
// - The message stays today's text, made from `fault`, `place` and `closing`.
// - A running version that is not a version stops the program: a defect, no `SettingsError`.
//
// Every law is a property over generated cases (Cli.places.test-support.ts): each builds one case for each class it lists
// from the drawn seeds, and fails when a class was not reached. The places, the sentences, the codes and the hints a case
// must hold are written there from the plan's tables, never from the code under test.
import { expect, it } from "@effect/vitest";
import * as Diagnostic from "@kalfa/diagnostics/Diagnostic";
import * as Diagnostics from "@kalfa/diagnostics/Diagnostics";
import * as TestDiagnostics from "@kalfa/diagnostics/TestDiagnostics";
import { runsFor } from "@kampus/vitest";
import { Effect, Exit, Option, Schema } from "effect";
import {
  BAD_IDS,
  badPlaces,
  badVersionStart,
  CODES,
  forms,
  messageFor,
  PLACED_IDS,
  type PlaceCase,
  PlaceDraw,
  type PlacedId,
  placeCases,
  Reach,
  UNPLACED_IDS,
} from "./Cli.places.test-support.ts";
import { refusal } from "./Cli.refusals.test-support.ts";
import { SettingGroup } from "./index.ts";

const check = { arbitrary: { runs: runsFor({ fast: 25, full: 100 }), size: 100 } };

const ALL_IDS = [...PLACED_IDS, ...UNPLACED_IDS];

/** A case with a place. */
const isPlaced = (one: PlaceCase): one is PlaceCase & { readonly id: PlacedId } =>
  PLACED_IDS.some((id) => id === one.id);

/** The one error of a case's run, never two failures and never a defect beside it. */
const errorFor = Effect.fnUntraced(function* (one: PlaceCase) {
  return refusal(yield* one.run).error;
});

// ---------------------------------------------------------------------------------------------
// P1, each fault holds the place of its source
// ---------------------------------------------------------------------------------------------

// Plants, one at a time on the product, each seen red: (r) build a file's place as `repo` whatever the file: (h) is red; (h) name the
// user file by its real path: the constructor throws, red; (m) place `$<APP>_HOME` as `~/.<app>/<app>.toml`: red; (s) drop the parser's
// line: red; (u) take the line of the table, not the key: red; (v) place the version fault with no line: red; (q) leave `missing` with
// no place: red; (d) give a read fault the key's line: red; (w) place a held lock at the file, not the lock: red; (x) place an edit's
// refusal at the other file: red; (c) drop the conflict's line: red; (i) place `config set`'s refusal at the setting's first file
// whatever `--file` says: red; (j) leave an edit's `unknown` with no place: red; (e) give a refused variable no place: red; (f) place
// a refused flag as `environment`: red; (o) place a file-only variable at the repo file: red; (g) name the flag without `--`: the
// constructor throws, red; (n) place `HOME`'s failure at the setting's variable: red; (a) place the setting's variable as its setting
// name: the constructor throws, red.
it.effect.prop(
  "P1 each fault holds the place of its source: each run makes one fault of each class (r), (h), (m), (s), (u), (v), (q), (d), (w), (x), (c), (i), (j), (e), (f), (o), (g), (n) and (a) through its public entry, and each call fails with the one `SettingsError`, the class's reason and a `place` equal to the one the plan names: its kind, its path or its name, and its line where the class has one and no `line` key where it has none",
  { draw: PlaceDraw },
  ({ draw }) =>
    Effect.gen(function* () {
      const reach = new Reach<PlacedId>(PLACED_IDS);

      for (const one of placeCases(draw).filter(isPlaced)) {
        const error = yield* errorFor(one);

        expect(error.reason, `(${one.id}) the reason`).toBe(one.reason);
        expect(error.place, `(${one.id}) the place`).toStrictEqual(one.place);
        reach.mark(one.id);
      }

      reach.done();
    }),
  check,
);

// ---------------------------------------------------------------------------------------------
// P2, a fault with no place carries none
// ---------------------------------------------------------------------------------------------

// Plants: (k) give a snapshot fault the repo file's place: red; (t) give a typed name the place `.`: red; carry a diagnostic with the
// place `.` when there is none: (k) red; the getter answers `undefined` always: P1's classes red.
it.effect.prop(
  "P2 a fault with no place carries none: for (k) a snapshot stream that ends before its first item and (t) a typed name that is no setting, the error has no `place` key and `Diagnostic.fromError(error)` is `None`; for every class of P1 it is `Some`",
  { draw: PlaceDraw },
  ({ draw }) =>
    Effect.gen(function* () {
      const reach = new Reach<string>(ALL_IDS);

      for (const one of placeCases(draw)) {
        const error = yield* errorFor(one);
        const carried = Diagnostic.fromError(error);

        const placed = isPlaced(one);

        expect(Option.isSome(carried), `(${one.id}) carries a diagnostic exactly when it has a place`).toBe(placed);
        expect(Object.hasOwn(error, "place"), `(${one.id}) holds a place key exactly when it has a place`).toBe(placed);
        expect(error.place === undefined, `(${one.id}) no place when it has none`).toBe(!placed);
        reach.mark(one.id);
      }

      reach.done();
    }),
  check,
);

// ---------------------------------------------------------------------------------------------
// P3, what a fault carries is reported as is
// ---------------------------------------------------------------------------------------------

// Plants: carry `error.message` as the message: it opens with the place and ends with the closing, red; carry the hint of `invalid` for
// every reason: (s) red; carry the code of `read` for a `write`: (w) red; carry `config/unknown` for `unknown`: (u) red; carry a place
// built from `origin` and not `place`: (h) red.
it.effect.prop(
  "P3 what a fault carries is reported as is: for every class of P1, `Diagnostics.report(carried.declared, carried.fields)` under `TestDiagnostics.layer` succeeds, and what was reported is exactly one item: the code the plan gives the reason, severity `error`, the fault sentence as the message, the error's place, and the hint the plan gives the reason",
  { draw: PlaceDraw },
  ({ draw }) =>
    Effect.gen(function* () {
      const reach = new Reach<PlacedId>(PLACED_IDS);

      for (const one of placeCases(draw).filter(isPlaced)) {
        const error = yield* errorFor(one);
        const carried = Diagnostic.fromError(error);
        const wanted = CODES[one.reason === "snapshot" ? "invalid" : one.reason];

        expect(error.fault, `(${one.id}) the fault sentence`).toBe(one.fault);
        expect(error.closing, `(${one.id}) the closing sentence`).toBe(one.closing);

        if (Option.isNone(carried)) {
          return expect.fail(`(${one.id}) the error carries no diagnostic`);
        }

        const reported = yield* Effect.gen(function* () {
          yield* Diagnostics.report(carried.value.declared, carried.value.fields);

          return yield* TestDiagnostics.reported;
        }).pipe(Effect.provide(TestDiagnostics.layer));

        expect(reported, `(${one.id}) one item, as the plan says it`).toEqual([
          { code: wanted.code, severity: "error", message: one.fault, place: error.place, hint: wanted.hint },
        ]);
        reach.mark(one.id);
      }

      reach.done();
    }),
  check,
);

// ---------------------------------------------------------------------------------------------
// P4 [secrets], nothing private in a place or a diagnostic
// ---------------------------------------------------------------------------------------------

// Plants: write the refused value into `fault` for (e): red; name the user file by `~<login>` in place of `~`: the constructor throws in
// (h), red; write the real path into the hint for (d): red.
it.effect.prop(
  "P4 [secrets] nothing private in a place or a diagnostic: for every class of P1, with the drawn secret as the refused value where the class refuses one and the drawn login in the home folder, the repo folder and the moved folder, no needle (the secret, the login, each folder) appears raw, JSON-escaped or URL-encoded in the place, the carried fields, the reported item or the JSON codec's text of the error",
  { draw: PlaceDraw },
  ({ draw }) =>
    Effect.gen(function* () {
      const reach = new Reach<PlacedId>(PLACED_IDS);

      for (const one of placeCases(draw).filter(isPlaced)) {
        const error = yield* errorFor(one);
        const carried = Diagnostic.fromError(error);

        if (Option.isNone(carried)) {
          return expect.fail(`(${one.id}) the error carries no diagnostic`);
        }

        const reported = yield* Effect.gen(function* () {
          yield* Diagnostics.report(carried.value.declared, carried.value.fields);

          return yield* TestDiagnostics.reported;
        }).pipe(Effect.provide(TestDiagnostics.layer));

        const texts = [
          JSON.stringify(error.place),
          JSON.stringify(carried.value.fields),
          JSON.stringify(reported),
          JSON.stringify(Schema.encodeSync(Schema.toCodecJson(SettingGroup.SettingsError))(error)),
        ];

        for (const text of texts) {
          for (const needle of one.needles) {
            for (const form of forms(needle)) {
              expect(text, `(${one.id}) no ${form}`).not.toContain(form);
            }
          }
        }

        reach.mark(one.id);
      }

      reach.done();
    }),
  check,
);

// ---------------------------------------------------------------------------------------------
// P5, the constructor refuses a bad place
// ---------------------------------------------------------------------------------------------

// Plants: type `place` as a plain struct of strings in place of `Diagnostic.Place`: the absolute path is kept, red; construct with
// `disableValidation`: red.
it.effect.prop(
  "P5 the constructor refuses a bad place: for a home place with an absolute path, a home place that names a login, a repo place that starts with `~/` and an environment place with a line, `new SettingsError({ reason, fault, closing, place })` throws; the same call with the class's good twin does not, and keeps the place",
  { draw: PlaceDraw },
  ({ draw }) =>
    Effect.sync(() => {
      const reach = new Reach<string>(BAD_IDS);

      for (const one of badPlaces(draw)) {
        // SAFETY: none, on purpose. The cast is the law: `Place`'s `path` is a plain `string` in the type, so a place that is bad only in its text compiles, and the constructor must refuse it when it runs.
        const bad = () =>
          new SettingGroup.SettingsError({ reason: "invalid", fault: "f", closing: "c", place: one.bad as never });

        expect(bad, `(${one.id}) the bad place is refused`).toThrow();

        const kept = new SettingGroup.SettingsError({ reason: "invalid", fault: "f", closing: "c", place: one.good });

        expect(kept.place, `(${one.id}) the good twin is kept`).toStrictEqual(one.good);
        reach.mark(one.id);
      }

      reach.done();
    }),
  check,
);

// ---------------------------------------------------------------------------------------------
// P10, every message is today's text
// ---------------------------------------------------------------------------------------------

// Plants: open `missing` with its file place: (q) red; open a variable's fault with `<NAME>: `: (e) red; drop `, line <n>`: (r) red;
// drop the closing: every class red.
it.effect.prop(
  "P10 every message is today's text: for every class of P1 and P2, `error.message` equals the text written here from today's wording: the opening `<file>, line <n>: ` for a fault found in a file (none for a missing setting, a variable or a flag), the fault sentence, a line break, two spaces and the closing",
  { draw: PlaceDraw },
  ({ draw }) =>
    Effect.gen(function* () {
      const reach = new Reach<string>(ALL_IDS);

      for (const one of placeCases(draw)) {
        const error = yield* errorFor(one);

        expect(error.message, `(${one.id}) the message`).toBe(messageFor(one));
        reach.mark(one.id);
      }

      reach.done();
    }),
  check,
);

// ---------------------------------------------------------------------------------------------
// P11, the running app's own bad version stops the program
// ---------------------------------------------------------------------------------------------

// Plants: (b) keep today's `stop(app, "invalid", ...)`: the failure is a `SettingsError`, red; put the version text in the `Error`'s
// message: red.
it.effect.prop(
  "P11 the running app's own bad version stops the program: a start whose repo file asks for a minimum version, run with a running version that is not a version, ends in a failure whose cause holds one defect, an `Error` whose message names the version's rule (`as 1.2.3`) and holds none of the drawn version text, and no `SettingsError`",
  { draw: PlaceDraw },
  ({ draw }) =>
    Effect.gen(function* () {
      const observed = yield* badVersionStart(draw);

      if (Exit.isSuccess(observed.exit)) {
        return expect.fail("the start was to stop, and it ended");
      }

      const { cause } = observed.exit;
      const defects = cause.reasons.flatMap((reason) => (reason._tag === "Die" ? [reason.defect] : []));

      expect(cause.reasons, "one defect and nothing beside it").toHaveLength(1);
      expect(defects, "the one failure is a defect").toHaveLength(1);
      expect(
        cause.reasons.some((reason) => reason._tag === "Fail"),
        "no typed error beside it",
      ).toBe(false);

      const [defect] = defects;

      expect(defect).toBeInstanceOf(Error);

      const said = defect instanceof Error ? defect.message : "";

      expect(said, "it names the rule a version has").toContain("as 1.2.3");

      for (const form of forms(draw.secret)) {
        expect(said, `it holds none of the version text ${form}`).not.toContain(form);
      }
    }),
  check,
);
