/**
 * A law's declaration (decisions 0579 and 0580): the package's `it`, with its members `it.effect`,
 * `it.live`, `it.prop`, `it.effect.prop` and `it.live.prop`, each taking its options last, as
 * `@effect/vitest`'s members do. The options are vitest's own plus a law's `plant`, the break that
 * turns it red (0093), and at most one label with its reason (0093, 0527). Both ride in vitest's
 * `meta`, so every reporter and vitest's Node API reads them.
 *
 * A property takes Effect inputs (a `Schema` or an Effect `Arbitrary`) with `arbitrary` options, run
 * by `@effect/vitest`, or fast-check inputs with `fastCheck` options, run by the package with each
 * case in a `Scope` of its own. Both engines run from seed 119120, set once when this module loads,
 * so it holds in every file that imports `it` and nowhere else.
 *
 * **Example** (A law and a property, each with its plant and label)
 *
 * ```ts
 * it.effect("a reply after the deadline is dropped", body, { plant: "drop the press row", scenario: "one deadline" });
 * it.effect.prop("the log reads back as written", { log: Log }, ({ log }) => law(log), {
 *   plant: "skip the last append on read",
 *   fastCheck: { numRuns: runsFor({ fast: 5, full: 50 }) },
 * });
 * ```
 *
 * @stability unstable
 */
import * as EffectVitest from "@effect/vitest";
import * as Arbitrary from "effect/Arbitrary";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";
import * as fc from "fast-check";
import type * as V from "vitest";
import * as FastCheck from "./internal/fastCheck.ts";

/** The shared fixed seed every law runs from, on both engines (0579). */
const SEED = 119120;

Arbitrary.configureGlobal({ check: { seed: SEED } });
fc.configureGlobal({ seed: SEED });

/** The five labels, each with the reason it requires. A pinned law names its bug's ticket. */
interface Reasons {
  /** Where the fixed input came from. */
  readonly vector: string;
  /** What text must read or write exactly. */
  readonly format: string;
  /** Why one case. */
  readonly scenario: string;
  /** What the compiler checks. */
  readonly type: string;
  /** The ticket of the bug it pins. */
  readonly pinned: number;
}

type Name = keyof Reasons;

/** One label: its own key with its reason, and each other label's key forbidden. */
type One<K extends Name> = { readonly [P in K]: Reasons[P] } & { readonly [P in Exclude<Name, K>]?: never };

/** No label at all. */
type Unlabeled = { readonly [P in Name]?: never };

/** At most one label, so `{ vector, format }` does not compile. */
type Labeled = One<"vector"> | One<"format"> | One<"scenario"> | One<"type"> | One<"pinned"> | Unlabeled;

/**
 * A law's options: vitest's own, less `meta` and the modes 0579 does not give (`skip`, `only`,
 * `todo`, `fails`), plus at most one label and the plant.
 *
 * @stability unstable
 * @category models
 */
export type LawOptions = Omit<V.TestOptions, "meta" | "skip" | "only" | "todo" | "fails"> &
  Labeled & {
    /** The break that turns this law red (0093): run once, recorded in the run row, never kept. */
    readonly plant?: string;
  };

/**
 * A law's label as `meta` carries it: the label's name as its tag, and its reason.
 *
 * @stability unstable
 * @category models
 */
export const Label = Schema.TaggedUnion({
  vector: { reason: Schema.String },
  format: { reason: Schema.String },
  scenario: { reason: Schema.String },
  type: { reason: Schema.String },
  pinned: { reason: Schema.Number },
});

/**
 * A law's label as `meta` carries it.
 *
 * @stability unstable
 * @category models
 */
export type Label = typeof Label.Type;

declare module "vitest" {
  interface TaskMeta {
    /** The law's plant, from its options. */
    plant?: string;
    /** The law's label, from its options. */
    label?: Label;
  }
}

/** The label the options name, if any. */
const labelIn = (options: LawOptions): Label | undefined =>
  options.vector !== undefined
    ? Label.cases.vector.make({ reason: options.vector })
    : options.format !== undefined
      ? Label.cases.format.make({ reason: options.format })
      : options.scenario !== undefined
        ? Label.cases.scenario.make({ reason: options.scenario })
        : options.type !== undefined
          ? Label.cases.type.make({ reason: options.type })
          : options.pinned !== undefined
            ? Label.cases.pinned.make({ reason: options.pinned })
            : undefined;

/**
 * A law's options as vitest takes them: the plant and the label go into `meta`, and every other
 * key passes through unchanged. Options with neither give no `meta`.
 *
 * @stability unstable
 * @category options
 */
export const toTestOptions = (options: LawOptions = {}): V.TestOptions => {
  const {
    plant,
    vector: _vector,
    format: _format,
    scenario: _scenario,
    type: _type,
    pinned: _pinned,
    ...rest
  } = options;
  const label = labelIn(options);
  const meta = { ...(plant === undefined ? {} : { plant }), ...(label === undefined ? {} : { label }) };
  return plant === undefined && label === undefined ? rest : { ...rest, meta };
};

/** An Effect input: a `Schema` or an Effect `Arbitrary`, as `@effect/vitest`'s `it.prop` takes. */
type EffectInput = Schema.Top | Arbitrary.Arbitrary<unknown>;

/**
 * A property's Effect inputs, by name.
 *
 * @stability unstable
 * @category models
 */
export type EffectInputs = { readonly [name: string]: EffectInput };

/**
 * The values one case draws from Effect inputs, by the input's name.
 *
 * @stability unstable
 * @category models
 */
export type EffectValues<Arbs> = {
  [K in keyof Arbs]: Arbs[K] extends Schema.Top
    ? Arbs[K]["Type"]
    : Arbs[K] extends Arbitrary.Arbitrary<infer A>
      ? A
      : never;
};

/** A property's inputs, by name: all Effect or all fast-check, never a mix. */
type Inputs = EffectInputs | FastCheck.Inputs;

/** The values a case hands the body, for either kind of input. */
type Drawn = { readonly [name: string]: unknown };

/**
 * A property's options on fast-check inputs: a law's, plus fast-check's own parameters.
 *
 * @stability unstable
 * @category models
 */
export type FastCheckOptions = LawOptions & { readonly fastCheck?: fc.Parameters<unknown> };

/**
 * A property's options on Effect inputs: a law's, plus Effect's own check options.
 *
 * @stability unstable
 * @category models
 */
export type ArbitraryOptions = LawOptions & { readonly arbitrary?: Arbitrary.CheckOptions };

/** A property whose body answers `B`: fast-check inputs take `fastCheck`, Effect inputs `arbitrary`. */
interface Prop<B> {
  <const Arbs extends FastCheck.Inputs>(
    name: string,
    inputs: Arbs,
    self: (values: FastCheck.Values<Arbs>, ctx: V.TestContext) => B,
    options?: FastCheckOptions,
  ): void;
  <const Arbs extends EffectInputs>(
    name: string,
    inputs: Arbs,
    self: (values: EffectValues<Arbs>, ctx: V.TestContext) => B,
    options?: ArbitraryOptions,
  ): void;
}

/** An Effect law's members: the law itself and its property. */
interface EffectLaw {
  <A, E>(name: string, self: (ctx: V.TestContext) => Effect.Effect<A, E, Scope.Scope>, options?: LawOptions): void;
  readonly prop: Prop<Effect.Effect<unknown, unknown, Scope.Scope>>;
}

/**
 * The package's `it`: a plain law, its property, and its Effect members.
 *
 * @stability unstable
 * @category models
 */
export interface Law {
  (name: string, self: (ctx: V.TestContext) => void, options?: LawOptions): void;
  readonly prop: Prop<void>;
  /** A law whose body is an Effect, with Effect's test services (`TestClock`, `TestConsole`). */
  readonly effect: EffectLaw;
  /** A law whose body is an Effect, on the live services. */
  readonly live: EffectLaw;
}

/** Whether every input is fast-check's, so the package's own path runs the property. */
const isFastCheck = (inputs: Inputs): inputs is FastCheck.Inputs =>
  Object.values(inputs).every((input) => input instanceof fc.Arbitrary);

/** The property's own options apart from the law's. */
const split = (options: FastCheckOptions & ArbitraryOptions = {}) => {
  const { fastCheck, arbitrary, ...law } = options;
  return { fastCheck, arbitrary, test: toTestOptions(law) };
};

/** One Effect member over `@effect/vitest`'s tester. */
const effectLaw = (tester: EffectVitest.Vitest.Tester<Scope.Scope>): EffectLaw => {
  function prop<const Arbs extends FastCheck.Inputs>(
    name: string,
    inputs: Arbs,
    self: (values: FastCheck.Values<Arbs>, ctx: V.TestContext) => Effect.Effect<unknown, unknown, Scope.Scope>,
    options?: FastCheckOptions,
  ): void;
  function prop<const Arbs extends EffectInputs>(
    name: string,
    inputs: Arbs,
    self: (values: EffectValues<Arbs>, ctx: V.TestContext) => Effect.Effect<unknown, unknown, Scope.Scope>,
    options?: ArbitraryOptions,
  ): void;
  function prop(
    name: string,
    inputs: Inputs,
    self: (values: Drawn, ctx: V.TestContext) => Effect.Effect<unknown, unknown, Scope.Scope>,
    options?: FastCheckOptions & ArbitraryOptions,
  ): void {
    const { fastCheck, arbitrary, test } = split(options);

    if (isFastCheck(inputs)) {
      return tester(name, (ctx) => FastCheck.check(inputs, (values) => self(values, ctx), ctx.signal, fastCheck), test);
    }

    return tester.prop(name, inputs, self, arbitrary === undefined ? test : { ...test, arbitrary });
  }

  return Object.assign(
    <A, E>(name: string, self: (ctx: V.TestContext) => Effect.Effect<A, E, Scope.Scope>, options?: LawOptions) =>
      tester(name, self, toTestOptions(options)),
    { prop },
  );
};

function prop<const Arbs extends FastCheck.Inputs>(
  name: string,
  inputs: Arbs,
  self: (values: FastCheck.Values<Arbs>, ctx: V.TestContext) => void,
  options?: FastCheckOptions,
): void;
function prop<const Arbs extends EffectInputs>(
  name: string,
  inputs: Arbs,
  self: (values: EffectValues<Arbs>, ctx: V.TestContext) => void,
  options?: ArbitraryOptions,
): void;
function prop(
  name: string,
  inputs: Inputs,
  self: (values: Drawn, ctx: V.TestContext) => void,
  options?: FastCheckOptions & ArbitraryOptions,
): void {
  const { fastCheck, arbitrary, test } = split(options);

  if (isFastCheck(inputs)) {
    return EffectVitest.it.live(
      name,
      (ctx) => FastCheck.check(inputs, (values) => Effect.sync(() => self(values, ctx)), ctx.signal, fastCheck),
      test,
    );
  }

  return EffectVitest.it.prop(name, inputs, self, arbitrary === undefined ? test : { ...test, arbitrary });
}

/**
 * A law, with its plant and label as options: `it(name, body, { plant, scenario })`.
 *
 * @stability unstable
 * @category testing
 */
export const it: Law = Object.assign(
  (name: string, self: (ctx: V.TestContext) => void, options?: LawOptions) =>
    EffectVitest.it(name, toTestOptions(options), self),
  { prop, effect: effectLaw(EffectVitest.it.effect), live: effectLaw(EffectVitest.it.live) },
);
