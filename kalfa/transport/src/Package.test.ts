// P1 and E1: what the package's own files say. It stands alone (decision on small libraries usable alone): it names no other package of
// this repository, it has no dependencies, and it has one error of its own, `FormatError`, with no `Unreachable` and no
// `TransportUnavailable` (a socket that cannot be reached is the socket Layer's `SocketError`, never Transport's word).
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, it } from "@effect/vitest";
import { Predicate, Schema } from "effect";
import manifest from "../package.json" with { type: "json" };
import * as Root from "./index.ts";
import * as MemorySocket from "./MemorySocket.ts";

const Manifest = Schema.Struct({
  name: Schema.String,
  dependencies: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  devDependencies: Schema.Record(Schema.String, Schema.String),
  peerDependencies: Schema.Record(Schema.String, Schema.String),
  peerDependenciesMeta: Schema.optional(Schema.Record(Schema.String, Schema.Struct({ optional: Schema.Boolean }))),
  optionalDependencies: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  exports: Schema.Record(Schema.String, Schema.String),
});

// The names are written in two halves so this file does not hold them whole.
const OTHERS = [`@kal${"fa"}/`, `@kam${"pus"}/`, `@tea-fab${"rika"}/`, `@dem${"lik"}/`];

const EXPORTS = [".", "./memory", "./package.json"];

// Plant: add a package of the repository (`@kalfa/config`) to the dependencies; add a tea package (`@demlik/tea`) to the dev
// dependencies; drop `./memory` from the exports; point `./memory` at a file that is not there.
it("P1 scenario: the manifest names no workspace package, has no dependencies, one peer (effect), exports exactly the plan's list, and each export is a file", () => {
  const parsed = Schema.decodeUnknownSync(Manifest)(manifest);

  const names = [
    ...Object.keys(parsed.devDependencies),
    ...Object.keys(parsed.peerDependencies),
    ...Object.keys(parsed.dependencies ?? {}),
    ...Object.keys(parsed.optionalDependencies ?? {}),
    ...Object.keys(parsed.peerDependenciesMeta ?? {}),
  ];

  expect(
    names.filter((name) => OTHERS.some((other) => name.startsWith(other))),
    "no package of this repository and no tea package",
  ).toEqual([]);
  expect(parsed.dependencies ?? {}, "no dependencies").toEqual({});
  expect(parsed.optionalDependencies ?? {}, "no optional dependencies").toEqual({});
  expect(Object.keys(parsed.peerDependencies), "effect is the one peer").toEqual(["effect"]);
  expect(parsed.peerDependenciesMeta ?? {}, "and it is not optional").toEqual({});
  expect(Object.keys(parsed.exports).sort()).toEqual([...EXPORTS].sort());

  for (const [name, target] of Object.entries(parsed.exports)) {
    expect(
      existsSync(fileURLToPath(new URL(target, new URL("../", import.meta.url)))),
      `${name} is the file ${target}`,
    ).toBe(true);
  }
});

const FORBIDDEN = ["Unreachable", "TransportUnavailable"];

/** Every name a module gives: its exports, and the members of each export that is an object or a class. */
const namesIn = (module: object): ReadonlyArray<string> =>
  Object.entries(module).flatMap(([name, value]) => [
    name,
    ...(Predicate.isObject(value) || Predicate.isFunction(value) ? Object.getOwnPropertyNames(value) : []),
  ]);

/** The exports that are error classes: a function whose instances are errors. */
const errorClasses = (module: object): ReadonlyArray<string> =>
  Object.entries(module)
    .filter(([, value]) => Predicate.isFunction(value) && value.prototype instanceof Error)
    .map(([name]) => name);

// Plant: rename `FormatError` to `TransportUnavailable`; export an `Unreachable` class from `Format.ts`.
it("E1 scenario: no export or member of either entry point is named Unreachable or TransportUnavailable, and FormatError is the one error class", () => {
  const names = [...namesIn(Root), ...namesIn(MemorySocket)];

  for (const word of FORBIDDEN) {
    expect(names, `no name is ${word}`).not.toContain(word);
  }

  expect([...errorClasses(Root), ...errorClasses(MemorySocket)], "the one error class of the package").toEqual([
    "FormatError",
  ]);
  expect(new Root.FormatError({ reason: "text" })._tag, "its tag").toBe("FormatError");
});
