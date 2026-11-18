// `./cli`: the `quality` command, the root a future `kalfa` finds through this package's `kalfa.cli`
// field (decision 0585). Its one tool so far is `stryker`:
//
//   quality stryker plant <name> [--out <file>]
//   quality stryker survey <file> --law <test file> [--from <line>] [--to <line>] [--out <file>]
//
// `plant` runs one plant of the catalog and prints its record line; it exits 0 only when the answer
// is `killed`. `survey` lists every mutant Stryker makes on some lines, with its status and killers,
// to find the shape of a new plant. The catalog is a module the `catalog` setting names; the repo's
// own edge (`.github/ci/plants.ts` in this repo) supplies it and the other settings.
import { Console, Effect, FileSystem, Path, Predicate, Schema } from "effect";
import { Argument, Command, Flag } from "effect/cli";
import * as MutantsStryker from "./stryker/node/MutantsStryker.ts";
import { Catalog } from "./stryker/Plant.ts";
import * as Run from "./stryker/Run.ts";
import * as Settings from "./stryker/Settings.ts";

/** The catalog module could not be loaded, or did not default-export a catalog. */
class NoCatalog extends Schema.TaggedError<NoCatalog, { readonly brand: unique symbol }>()("NoCatalog", {
  catalog: Schema.String,
}) {
  override get message(): string {
    return `no catalog could be loaded from ${this.catalog}: it must be a module whose default export is a list of plants`;
  }
}

/** A plant ran and its law was not among the tests that killed it. The record line is already printed. */
class Unproven extends Schema.TaggedError<Unproven, { readonly brand: unique symbol }>()("Unproven", {
  plant: Schema.String,
  answer: Schema.String,
}) {
  override get message(): string {
    return `plant ${this.plant} answered ${this.answer}: its law does not kill it`;
  }
}

/** What every subcommand needs: the settings, the folder it runs in, and Stryker for that folder. */
const setup = Effect.gen(function* () {
  const path = yield* Path.Path;
  const settings = yield* Settings.all;
  const root = path.resolve();

  return { settings, root, stryker: MutantsStryker.layer({ root, nice: settings.nice }) };
});

/** The catalog the `catalog` setting names, loaded by one dynamic import and decoded. */
const catalogAt = Effect.fnUntraced(function* (root: string, catalog: string) {
  const path = yield* Path.Path;
  const url = yield* path.toFileUrl(path.resolve(root, catalog));
  const failed = () => new NoCatalog({ catalog });
  // Edge (a Promise API, marked as `next/` marks one): the catalog is a module the repo names, so it can only be imported by a path known at run time
  const loaded = yield* Effect.tryPromise({ try: () => import(url.href), catch: failed });

  return yield* Predicate.hasProperty(loaded, "default")
    ? Schema.decodeUnknownEffect(Catalog)(loaded.default).pipe(Effect.mapError(failed))
    : Effect.fail(failed());
});

/** `--out`: the same text the run prints, in a file, its folder made. */
const keep = Effect.fnUntraced(function* (out: string | undefined, text: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  if (out !== undefined) {
    yield* fs.makeDirectory(path.dirname(out), { recursive: true });
    yield* fs.writeFileString(out, `${text}\n`);
  }
});

const out = Flag.String("out").pipe(
  Flag.withDescription("Also write the output to this file"),
  Flag.withDefault(undefined),
);

const plant = Command.make(
  "plant",
  { name: Argument.String("name").pipe(Argument.withDescription("A plant of the catalog")), out },
  Effect.fnUntraced(function* ({ name, out }) {
    const { settings, root, stryker } = yield* setup;
    const catalog = yield* catalogAt(root, settings.catalog);
    const line = yield* Run.plant({ catalog, name, settings, root }).pipe(Effect.scoped, Effect.provide(stryker));
    const text = JSON.stringify(line);

    yield* Console.log(text);
    yield* keep(out, text);

    if (line.answer._tag !== "killed") {
      return yield* new Unproven({ plant: name, answer: line.answer._tag });
    }
  }),
).pipe(Command.withDescription("Run one plant against its law, and exit 0 only when the law kills it"));

const survey = Command.make(
  "survey",
  {
    file: Argument.String("file").pipe(Argument.withDescription("The product file")),
    law: Flag.String("law").pipe(Flag.withDescription("The test file to run against the mutants")),
    from: Flag.Int("from").pipe(Flag.withDescription("First line, from 1"), Flag.withDefault(1)),
    to: Flag.Int("to").pipe(Flag.withDescription("Last line"), Flag.withDefault(Number.MAX_SAFE_INTEGER)),
    out,
  },
  Effect.fnUntraced(function* ({ file, law, from, to, out }) {
    const { settings, root, stryker } = yield* setup;
    const rows = yield* Run.survey({ file, law, from, to, settings, root }).pipe(
      Effect.scoped,
      Effect.provide(stryker),
    );

    for (const row of rows) {
      yield* Console.log(JSON.stringify(row));
    }

    yield* keep(out, JSON.stringify(rows));
  }),
).pipe(Command.withDescription("List every mutant Stryker makes on some lines, with its status and killers"));

const stryker = Command.make("stryker").pipe(
  Command.withDescription("Plants: a Stryker mutant named by its code shape, with the law that must kill it"),
  Command.withSubcommands([plant, survey]),
);

export const quality = Command.make("quality").pipe(
  Command.withDescription("Our testing, linting and formatting tooling"),
  Command.withSubcommands([stryker]),
);
