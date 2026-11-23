/**
 * The shape a package exports for the `kalfa` command: its subcommand, made with `make`, and the check that tells one from anything else.
 *
 * **Details**
 *
 * A package's entry exports `subcommand`, its effect/cli command named by its root name, with the Layer it needs and the codes it declared. `kalfa` runs it on Node's platform and the `Diagnostics` service, and nothing else. This file runs no command, prints nothing and picks no exit code.
 */
import type { NodeServices } from "@effect/platform-node/NodeServices";
import * as Diagnostic from "@kalfa/diagnostics/Diagnostic";
import type * as Diagnostics from "@kalfa/diagnostics/Diagnostics";
import { Predicate, Schema, type Layer } from "effect";
import { Command } from "effect/cli";

/**
 * What `kalfa` gives every subcommand: Node's platform, and nothing else.
 *
 * @category models
 */
export type Platform = NodeServices;

// Only `make` builds a Subcommand, and `isSubcommand` reads this key. `Symbol.for`, as Diagnostics marks its own values,
// so a second copy of this package reads the same key.
const TypeId: unique symbol = Symbol.for("@kalfa/cli/Subcommand");

/**
 * One package's subcommand: its command with its Layer already given, and the codes it declared.
 *
 * **Details**
 *
 * `Name` is only read, so a subcommand named `"leak"` is a `Subcommand`. The command is held under the wide name `string`, since effect/cli's `Command` is invariant in its name. `name` is the one that keeps the literal.
 *
 * @category models
 */
export interface Subcommand<out Name extends string = string> {
  readonly [TypeId]: typeof TypeId;
  readonly name: Name;
  readonly command: Command.Command<string, never, unknown, unknown, Diagnostics.Diagnostics | Platform>;
  readonly diagnostics: ReadonlyArray<Diagnostic.Declared>;
}

// What the command still needs once the Layer, Diagnostics and Node's platform are given: nothing, or a compile error
// that names the missing service.
type Covered<R, A> = [Exclude<R, A | Diagnostics.Diagnostics | Platform>] extends [never]
  ? unknown
  : { readonly "the layer does not give": Exclude<R, A | Diagnostics.Diagnostics | Platform> };

/**
 * Makes a package's subcommand from an effect/cli command named by its root name.
 *
 * **When to use**
 *
 * Use to make the `subcommand` that a package's `./cli` entry exports.
 *
 * **Details**
 *
 * The command is stored with its Layer given, so it cannot run without it. A service the command needs that the Layer, Diagnostics and Node's platform do not give is a compile error. The throw is at the import, where the name is written.
 *
 * **Gotchas**
 *
 * Throws an Error when the name is not a root name: lowercase words joined by single hyphens, starting with a letter. A command whose name is typed as the wide `string` compiles, and is checked here.
 *
 * @category constructors
 */
export function make<const Name extends string, Input, Parent, E, R, A, LE, LR extends Platform>(
  command: Command.Command<Name, Input, Parent, E, R>,
  options: {
    readonly layer: Layer.Layer<A, LE, LR>;
    readonly diagnostics: ReadonlyArray<Diagnostic.Declared>;
  } & Covered<R, A>,
): Subcommand<Name>;
export function make(
  command: Command.Command<string, never, unknown, unknown, unknown>,
  options: {
    readonly layer: Layer.Layer<unknown, unknown, Platform>;
    readonly diagnostics: ReadonlyArray<Diagnostic.Declared>;
  },
): Subcommand {
  // The rule of a code's root, asked of the code this name would start, so the two cannot drift.
  if (!Schema.is(Diagnostic.Code)(`${command.name}/x`)) {
    throw new Error(
      `"${command.name}" is not a root name: write lowercase words joined by single hyphens, the first starting with a letter, as "config" or "my-tool".`,
    );
  }

  return {
    [TypeId]: TypeId,
    name: command.name,
    command: Command.provide(command, options.layer),
    diagnostics: options.diagnostics,
  };
}

/**
 * True for a value `make` built, in this copy of the package or another.
 *
 * **Details**
 *
 * Reads its mark, that its command is an effect/cli command, that its name is the command's name, and that its codes are a list. A look-alike that breaks any one is false.
 *
 * @category guards
 */
export const isSubcommand = (value: unknown): value is Subcommand =>
  Predicate.hasProperty(value, TypeId) &&
  Predicate.hasProperty(value, "command") &&
  Command.isCommand(value.command) &&
  Predicate.hasProperty(value, "name") &&
  value.name === value.command.name &&
  Predicate.hasProperty(value, "diagnostics") &&
  Array.isArray(value.diagnostics);
