/**
 * `cli.load`: the subcommand a package's `kalfa.cli` entry exports.
 */
import { Effect } from "effect";
import * as Subcommand from "../Subcommand.ts";
import { Refused } from "./failure.ts";
import type { Found } from "./find.ts";
import { specifier } from "./manifest.ts";
import { Packages } from "./packages.ts";

/** Loads one package's entry and takes its `subcommand` export, which must be an own key and one that `Subcommand.make` built. */
export const load = Effect.fn("cli.load")(function* (found: Found) {
  yield* Effect.annotateCurrentSpan("kalfa.cli.package", found.name);

  const packages = yield* Packages;
  const entry = { packages: [found.name], field: "cli", subpath: found.cli } as const;

  const exports = yield* packages
    .load(found.name, specifier(found.name, found.cli))
    .pipe(Effect.mapError((refused) => new Refused({ ...entry, reason: refused.reason })));

  const exported = Object.hasOwn(exports, "subcommand") ? exports.subcommand : undefined;

  return Subcommand.isSubcommand(exported) ? exported : yield* new Refused({ ...entry, reason: "no-subcommand" });
});
