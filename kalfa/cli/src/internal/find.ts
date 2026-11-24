/**
 * `cli.find`: which direct dependencies of the repo give a subcommand, found from manifests alone.
 *
 * **Details**
 *
 * No package's code runs here, and no dependency's own dependencies are read.
 */
import { Array as Arr, Effect, Option } from "effect";
import { Refused } from "./failure.ts";
import * as Manifest from "./manifest.ts";
import { Packages } from "./packages.ts";

/** A direct dependency whose manifest has a `kalfa.cli` field: its name and the subpath that field names. */
export interface Found {
  readonly name: string;
  readonly cli: string;
}

// A dependency that is not installed stops the start, unless the repo lists it only as optional, which a package manager may leave out on purpose.
const read = Effect.fnUntraced(function* (packages: Packages["Service"], name: string, optional: boolean) {
  const text = yield* packages.manifest(name);

  if (Option.isNone(text)) {
    return optional ? Option.none() : yield* new Refused({ reason: "not-installed", packages: [name] });
  }

  const manifest = yield* Manifest.read(text.value, name);

  return Option.map(yield* Manifest.cli(manifest, name), (cli): Found => ({ name, cli }));
});

/** The direct dependencies of the repo's root manifest that have `kalfa.cli`, by name. */
export const find = Effect.fn("cli.find")(function* () {
  const packages = yield* Packages;
  const root = yield* Effect.flatMap(packages.root, (text) => Manifest.read(text));

  const candidates = yield* Effect.forEach(
    Manifest.direct(root),
    ({ name, optional }) => read(packages, name, optional),
    {
      concurrency: "unbounded",
    },
  );

  return Arr.getSomes(candidates);
});
