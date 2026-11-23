// What the laws of Subcommand.ts share: root names good and broken, an independent model of the rule that tells them
// apart, a service for a subcommand's Layer to give, the stand-in for Node's platform, and values that look like a
// subcommand and are not one. Each law applies every break and every look-alike to each value it draws, so each
// class it must reach is in every run, and no run can pass on less.
import {
  Arbitrary,
  Array as Arr,
  Context,
  Effect,
  FileSystem,
  Layer,
  Path,
  Ref,
  Schema,
  Stdio,
  Terminal,
} from "effect";
import { Command } from "effect/cli";
import { ChildProcessSpawner } from "effect/process";
import * as fc from "fast-check";
import type * as Subcommand from "./Subcommand.ts";

/** The shared seed: a fixed seed makes a red run repeat. */
export const SEED = 119120;

const pattern = (form: RegExp): Arbitrary.Arbitrary<string> =>
  Arbitrary.schema(Schema.String.check(Schema.isPattern(form)));

// ---- root names

// A root name by the rule: lowercase words joined by single hyphens, the first starting with a letter.
const GOOD_NAME = /^[a-z][a-z0-9]{0,4}(?:-[a-z0-9]{1,4}){0,2}$/;

/** Root names, as Effect's Arbitrary draws them. */
export const goodName: Arbitrary.Arbitrary<string> = pattern(GOOD_NAME);

/** The same names, as fast-check draws them, for a law that runs `fc.assert` itself. */
export const goodNameFc: fc.Arbitrary<string> = fc.stringMatching(GOOD_NAME);

// Any short text from the characters a name is made of and the ones that break it. Most of what it draws is no root
// name, and some is, so the model decides each one.
const ANY_TEXT = /^[a-zA-Z0-9\- /_\n]{0,8}$/;

/** Texts of the characters a name is made of and the ones that break it, as fast-check draws them. */
export const anyTextFc: fc.Arbitrary<string> = fc.stringMatching(ANY_TEXT);

/**
 * Any short text at all, lone surrogates, control characters and every script included: what the patterns above cannot
 * draw. Effect's Arbitrary has no generator for a lone surrogate, so this one is fast-check's.
 */
export const wildText: fc.Arbitrary<string> = fc.string({ unit: "binary", maxLength: 8 });

const LOWER = "abcdefghijklmnopqrstuvwxyz";

const DIGITS = "0123456789";

/**
 * The rule, written a second way: split on hyphens, and judge each word by its characters, where the product holds one
 * pattern. A name is a root name when it starts with a letter and every word between hyphens is made of lowercase
 * letters and digits, none empty.
 */
export const isRootName = (name: string): boolean =>
  name.length > 0 &&
  LOWER.includes(name.charAt(0)) &&
  name
    .split("-")
    .every(
      (word) => word !== "" && [...word].every((character) => LOWER.includes(character) || DIGITS.includes(character)),
    );

/** A break: a name, and what it makes of a good root name. */
interface Break {
  readonly name: string;
  readonly apply: (good: string) => string;
}

/** Every way to break a good root name that the rule refuses. */
export const NAME_BREAKS: ReadonlyArray<Break> = [
  { name: "a capital first letter", apply: (good) => good.charAt(0).toUpperCase() + good.slice(1) },
  { name: "a capital letter at the end", apply: (good) => `${good}X` },
  { name: "a leading digit", apply: (good) => `7${good}` },
  { name: "a leading hyphen", apply: (good) => `-${good}` },
  { name: "a trailing hyphen", apply: (good) => `${good}-` },
  { name: "two hyphens in a row", apply: (good) => `${good}--a` },
  { name: "a slash", apply: (good) => `${good}/x` },
  { name: "a scope", apply: (good) => `@x/${good}` },
  { name: "a space", apply: (good) => `${good} x` },
  { name: "an underscore", apply: (good) => `${good}_x` },
  { name: "a dot", apply: (good) => `${good}.x` },
  { name: "a trailing line break", apply: (good) => `${good}\n` },
  { name: "a letter outside a to z", apply: (good) => `${good}é` },
  { name: "a character from another script", apply: (good) => `${good}雪` },
  { name: "the empty name", apply: () => "" },
];

// ---- a service, and the platform a command runs on

/** A service a subcommand's Layer gives and its handler reads, so a handler that ran without the Layer is seen. */
export class Probe extends Context.Service<Probe, { readonly value: string }>()("@kalfa/cli/Subcommand.test/Probe") {}

/** A service a Layer does not give: a command or a Layer that needs it is refused. */
export class Other extends Context.Service<Other, { readonly value: string }>()("@kalfa/cli/Subcommand.test/Other") {}

/**
 * The stand-in for Node's platform: a file system that does nothing, Effect's own Path, silent standard streams, and a
 * terminal and a process spawner that die when used, since no subcommand under test may use them.
 */
export const platform = Layer.mergeAll(
  FileSystem.layerNoop({}),
  Path.layer,
  Stdio.layerTest({}),
  Layer.succeed(
    Terminal.Terminal,
    Terminal.make({
      columns: Effect.succeed(80),
      rows: Effect.succeed(24),
      size: Effect.die("unused"),
      readInput: Effect.die("unused"),
      readLine: Effect.die("unused"),
      display: () => Effect.void,
    }),
  ),
  Layer.succeed(
    ChildProcessSpawner.ChildProcessSpawner,
    ChildProcessSpawner.make(() => Effect.die("unused")),
  ),
);

/** A command named `name` whose handler records the value of the `Probe` it reads, each time it runs. */
export const probing = (name: string, seen: Ref.Ref<ReadonlyArray<string>>) =>
  Command.make(name, {}, () => Effect.flatMap(Probe, (probe) => Ref.update(seen, Arr.append(probe.value))));

// ---- declared codes

/** A code by the rule of Diagnostics: a root, a slash and a name. These are made only to fill a list. */
export const goodCodes: Arbitrary.Arbitrary<ReadonlyArray<string>> = Arbitrary.schema(
  Schema.Array(Schema.String.check(Schema.isPattern(/^[a-z]{1,4}\/[a-z]{1,4}$/))).check(Schema.isMaxLength(3)),
);

// ---- what looks like a subcommand and is not one

/** A value, the class it belongs to, and whether `isSubcommand` must hold for it. */
interface Candidate {
  readonly id: string;
  readonly name: string;
  readonly value: unknown;
  readonly holds: boolean;
}

/**
 * The classes (f): each carries what the checks before its own accept and breaks the one that is its own. The mark is
 * copied from a made subcommand by spreading it, which copies the symbol key, so a class is no more than one edit away
 * from the real thing. `made` must be built by `make`.
 */
export const candidates = (made: Subcommand.Subcommand): ReadonlyArray<Candidate> => [
  { id: "own", name: "what make built", value: made, holds: true },
  { id: "copy", name: "a plain copy that carries the same mark", value: { ...made }, holds: true },
  { id: "none", name: "nothing", value: undefined, holds: false },
  { id: "null", name: "null", value: null, holds: false },
  { id: "text", name: "a text", value: made.name, holds: false },
  { id: "number", name: "a number", value: 7, holds: false },
  { id: "array", name: "an array", value: [made], holds: false },
  {
    id: "no-mark",
    name: "the same fields and no mark",
    value: { name: made.name, command: made.command, diagnostics: made.diagnostics },
    holds: false,
  },
  { id: "bare-command", name: "an effect/cli command", value: made.command, holds: false },
  { id: "no-command", name: "the mark and no command", value: { ...made, command: undefined }, holds: false },
  {
    id: "not-a-command",
    name: "the mark and a command that is no command, with the right name",
    value: { ...made, command: { name: made.name } },
    holds: false,
  },
  {
    id: "other-name",
    name: "the mark, a command and another name",
    value: { ...made, name: `${made.name}x` },
    holds: false,
  },
  {
    id: "no-list",
    name: "the mark, a command and a name, and no list of codes",
    value: { ...made, diagnostics: undefined },
    holds: false,
  },
  {
    id: "list-is-text",
    name: "the mark, a command and a name, and a text where the list of codes goes",
    value: { ...made, diagnostics: "a/b" },
    holds: false,
  },
  {
    id: "list-is-object",
    name: "the mark, a command and a name, and an object where the list of codes goes",
    value: { ...made, diagnostics: {} },
    holds: false,
  },
];

/** The class ids a run must reach: the ones of `candidates`, in order. */
export const CANDIDATE_IDS: ReadonlyArray<string> = [
  "own",
  "copy",
  "none",
  "null",
  "text",
  "number",
  "array",
  "no-mark",
  "bare-command",
  "no-command",
  "not-a-command",
  "other-name",
  "no-list",
  "list-is-text",
  "list-is-object",
];
