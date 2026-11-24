// P1, P2 and E1: what the package's own files say. It stands alone (decision on small libraries usable alone): it names no other package of
// this repository, it has no dependencies, and it has one error of its own, `FormatError`, with no `Unreachable` and no
// `TransportUnavailable` (a socket that cannot be reached is the socket Layer's `SocketError`, never Transport's word). The two
// Cloudflare entry points are loaded by `import()` inside the test, so a Cloudflare file that is not there fails its own laws
// and no other.
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, it } from "@effect/vitest";
import { Effect, Predicate, Schema } from "effect";
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

const EXPORTS = [".", "./memory", "./cloudflare", "./cloudflare/memory", "./package.json"];

/** The two peers that only the Cloudflare entry points need: a project that never imports them installs neither. */
const OPTIONAL_PEERS = ["@alchemy.run/cloudflare", "alchemy"];

// Plant: add a package of the repository (`@kalfa/config`) to the dependencies; add a tea package (`@demlik/tea`) to the dev
// dependencies; make `@alchemy.run/cloudflare` a required peer; add it to the dependencies; drop `./cloudflare/memory` from the exports;
// point `./memory` at a file that is not there.
it("P1 scenario: the manifest names no workspace package, has no dependencies, effect as the one required peer and the two Alchemy peers optional, exports exactly the plan's list, and each export is a file", () => {
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
  expect(Object.keys(parsed.peerDependencies).sort(), "the peers are effect and the two Alchemy packages").toEqual(
    ["effect", ...OPTIONAL_PEERS].sort(),
  );
  expect(
    Object.entries(parsed.peerDependenciesMeta ?? {})
      .filter(([, meta]) => meta.optional)
      .map(([name]) => name)
      .sort(),
    "the Alchemy peers are optional, and effect is not",
  ).toEqual([...OPTIONAL_PEERS].sort());
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

/** A module of the package that would not load: a fault of the file under test, so it fails the law that asked for it. */
class ModuleNotLoaded extends Schema.TaggedError<ModuleNotLoaded, { readonly brand: unique symbol }>()(
  "ModuleNotLoaded",
  { cause: Schema.Defect() },
) {}

const loaded = <A>(module: () => Promise<A>) =>
  Effect.orDie(Effect.tryPromise({ try: module, catch: (cause) => new ModuleNotLoaded({ cause }) }));

const cloudflare = Effect.all(
  [loaded(() => import("./cloudflare/index.ts")), loaded(() => import("./cloudflare/MemoryGateway.ts"))],
  { concurrency: "unbounded" },
);

// Plant: export a `challenge` helper from `Gateway.ts` and re-export it from the index; export a second name (`Held`) from
// `MemoryGateway.ts`; export a `route` helper from the index.
it.effect(
  "P2 scenario: the Cloudflare entry points give exactly the slice's exports, and no name of a route, a sign-in or a challenge",
  () =>
    Effect.gen(function* () {
      const [index, memory] = yield* cloudflare;

      // The type `HeldSocket` has no value, so it is not here: `Gateway.types.test.ts` (D4) holds it.
      expect(Object.keys(index).sort(), "/cloudflare gives Gateway and Hibernation").toEqual([
        "Gateway",
        "Hibernation",
      ]);
      expect(Object.keys(memory).sort(), "/cloudflare/memory gives make").toEqual(["make"]);

      for (const name of [...namesIn(index), ...namesIn(memory)]) {
        expect(name, `${name} names no route, no sign-in and no challenge`).not.toMatch(/route|sign.?in|challenge/i);
      }
    }),
);

// Plant: rename `FormatError` to `TransportUnavailable`; export an `Unreachable` class from `Format.ts`; add a `RefusedError` class to
// `Gateway.ts` and export it from the index.
it.effect(
  "E1 scenario: no export or member of any of the four entry points is named Unreachable or TransportUnavailable, and FormatError is the one error class",
  () =>
    Effect.gen(function* () {
      const [index, memory] = yield* cloudflare;
      const entries = [Root, MemorySocket, index, memory];

      for (const word of FORBIDDEN) {
        expect(entries.flatMap(namesIn), `no name is ${word}`).not.toContain(word);
      }

      expect(entries.flatMap(errorClasses), "the one error class of the package").toEqual(["FormatError"]);
      expect(new Root.FormatError({ reason: "text" })._tag, "its tag").toBe("FormatError");
    }),
);
