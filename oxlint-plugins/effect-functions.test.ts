// T285, PR 1, next/. Plants are source fixtures, as in the other rules' tests here. They were the exam's
// (next/apps/fabrika/src/exam/effect-functions.integration.test.ts) until 0591 moved them here; the span
// law on CI's `edges` step went to next/apps/fabrika/src/exam/edges.integration.test.ts. Plant: skip the
// curried wrapper (an arrow returned by an arrow is not named), and line 7 stops firing.
import { Array as Arr } from "effect";
import { describe, expect, it } from "vitest";
import { plant } from "./plant.ts";

const CODE = "fabrika(effect-functions)";

const FILE = "next/packages/libfabrika/src/data/tracing.ts";

const source = Arr.join(
  [
    'import {Effect, Stream} from "effect";',
    "declare const append: () => Effect.Effect<void>;",
    'export const wrapped = () => append().pipe(Effect.withSpan("ledger.append"));',
    'export function blocked() { return append().pipe(Effect.withSpan("ledger.append")); }',
    'const service = { append: () => append().pipe(Effect.withSpan("ledger.append")) };',
    'const ring = () => append().pipe(Effect.withSpan("ledger.ring"), Effect.catchCause(() => Effect.void));',
    'const cmdSpan = (job: string) => (work: Effect.Effect<void>) => work.pipe(Effect.withSpan("runner.cmd"));',
    'const direct = () => Effect.withSpan(append(), "ledger.append");',
    'const chained = () => append().pipe(Effect.withSpan("ledger.append")).pipe(Effect.asVoid);',
    'const inner = Effect.fnUntraced(function* () { yield* append().pipe(Effect.withSpan("part")); yield* append(); });',
    'const consumed = () => Stream.runCollect(Stream.empty.pipe(Stream.withSpan("mailbox.receive")));',
    'const traced = Effect.fn("ledger.append")(function* () { return yield* append(); });',
    "const helper = Effect.fnUntraced(function* () { return yield* append(); });",
    "const plain = () => append();",
    'const outer = () => Effect.gen(function* () { yield* append().pipe(Effect.withSpan("part")); yield* append(); });',
    'const callback = Effect.forEach([], () => append().pipe(Effect.withSpan("item")), {concurrency: 1});',
  ],
  "\n",
);

const all = await plant({
  [FILE]: source,
  "next/packages/libfabrika/src/data/tracing.test.ts": source,
  "packages/fabrika/src/tracing.ts": source,
  "next/packages/libfabrika/src/data/alias.ts": Arr.join(
    ['import {Effect as E} from "effect";', 'const append = () => E.void.pipe(E.withSpan("ledger.append"));'],
    "\n",
  ),
  "next/packages/libfabrika/src/data/namespace.ts": Arr.join(
    ['import * as E from "effect/Effect";', 'const append = () => E.void.pipe(E.withSpan("ledger.append"));'],
    "\n",
  ),
});

describe("effect-functions", () => {
  it("scenario: rejects function spans, including append, recovery, curried and direct wrappers", () => {
    expect(all(CODE, FILE)).toEqual([3, 4, 5, 6, 7, 8, 9]);
  });

  it("scenario: accepts inner spans, consumed stream spans, named fn, untraced helpers and callbacks", () => {
    expect(Arr.filter(all(CODE, FILE), (line) => line >= 10)).toEqual([]);
  });

  it("scenario: recognizes Effect imports under another name", () => {
    expect(all(CODE, "next/packages/libfabrika/src/data/alias.ts")).toEqual([2]);
    expect(all(CODE, "next/packages/libfabrika/src/data/namespace.ts")).toEqual([2]);
  });

  it("scenario: leaves today's version alone", () => {
    expect(all(CODE, "packages/fabrika/src/tracing.ts")).toEqual([]);
  });

  it("scenario: accepts test helpers that manufacture spans as sink input", () => {
    expect(all(CODE, "next/packages/libfabrika/src/data/tracing.test.ts")).toEqual([]);
  });
});
