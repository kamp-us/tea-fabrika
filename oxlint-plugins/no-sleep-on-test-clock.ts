// Ticket 1311. `it.effect` runs its body on Effect's `TestClock`, and that clock never moves by
// itself: a wait on it ends only when something calls `TestClock.adjust` or `TestClock.setTime`.
// A test that sleeps with no such call hangs until its timeout (60 s on CI; pull request 2311 lost
// two proof runs to one). This rule refuses a clock-driven wait inside a body that runs on the test
// clock, unless the same body moves the clock.
//
// The source says which helpers run on the test clock (`@effect/vitest` 4.1.3,
// `src/internal/internal.ts`): `it.effect` (line 490: `Effect.provide(TestEnv)`, with `TestEnv` at
// line 68 holding `TestClock.layer()`) and every `.effect` of a `layer(...)` block (lines 342 to 344:
// the block's layer is merged with `TestEnv` unless `excludeTestServices` is true). `it.live`
// (line 491) provides nothing, so it runs on the real clock. `@effect/vitest` 4.1.3 has no
// `it.scoped` or `it.scopedLive`.
//
// What counts as a test-clock body, resolved through the file's own scope, so a renamed import is
// seen and a local of the same name is not:
// - the function arguments of `it.effect(...)`, and of its `skip`, `only`, `fails`, `prop`, `each`,
//   `skipIf` and `runIf` forms (`it.effect.each(cases)(name, fn)` too), with `it` or `effect`
//   imported from `@effect/vitest` under any name, or taken from a namespace import of it;
// - the same on the parameter of a `layer(L)(name, (it) => ...)` or `it.layer(L)(...)` block,
//   unless that block, or one it sits in, sets `excludeTestServices: true`. A block whose options
//   are not an object written in the call is skipped, since the rule cannot tell.
//
// A clock-driven wait is a member (or, imported by name, a call) of one of these: `Effect.sleep`,
// `delay`, `timeout`, `timeoutOption`, `timeoutOrElse`; `Schedule.spaced`, `fixed`, `windowed`,
// `exponential`, `fibonacci`, `duration`, `cron`; `Stream.tick`, `debounce`, `throttle`,
// `throttleEffect`, `timeout`, `timeoutOrElse`, `groupedWithin`, `aggregateWithin`. Each one ends in
// `Clock.sleep` (`effect/src/internal/effect.ts` line 6476 and `Schedule.ts` line 413).
//
// What passes: a body with `TestClock.adjust` or `TestClock.setTime` anywhere in it (as a call or
// only referred to); a wait inside a call that also carries `TestClock.withLive`, as its callee or
// as one of its arguments (`TestClock.withLive(Effect.sleep(x))`, `Effect.sleep(x).pipe(TestClock.withLive)`);
// a body of `it.live` or of an `excludeTestServices` block; another object's `sleep`; a local or a
// parameter named `Effect`; an `Effect` imported from any other module; a comment, a string.
// Misses: a wait in a helper that the body calls but does not contain, a schedule passed in from
// another file, and an alias made at run time (`const e = Effect; e.sleep(x)`).
//
// A wait that ends by itself on the test clock (an `Effect.timeout` around an effect that finishes
// at once) takes `// oxlint-disable-next-line fabrika/no-sleep-on-test-clock -- <why it ends>`.
// no fixer: the fix is `it.live` or a `TestClock.adjust`, which needs the test's own judgment.
import type { CreateRule, ESTree, Scope, Variable } from "@oxlint/plugins";
import { below, type Node } from "./match.ts";

const MESSAGE =
  "`it.effect` runs on the test clock, which moves only when the test calls `TestClock.adjust` or `TestClock.setTime`, so this wait never ends and the test hangs until its timeout. Use `it.live` to wait in real time, or move the clock in the same test with `TestClock.adjust` (oxlint-plugins/no-sleep-on-test-clock.ts).";

/** The parts of Effect this rule reads. */
type Part = "Effect" | "Schedule" | "Stream" | "TestClock";

const WAITS: Readonly<Record<Part, ReadonlySet<string>>> = {
  Effect: new Set(["sleep", "delay", "timeout", "timeoutOption", "timeoutOrElse"]),
  Schedule: new Set(["spaced", "fixed", "windowed", "exponential", "fibonacci", "duration", "cron"]),
  Stream: new Set([
    "tick",
    "debounce",
    "throttle",
    "throttleEffect",
    "timeout",
    "timeoutOrElse",
    "groupedWithin",
    "aggregateWithin",
  ]),
  TestClock: new Set(),
};

const MOVES = new Set(["adjust", "setTime"]);

/** The forms of `it.effect` that make a test, and the ones that only make the function that does. */
const FORMS = new Set(["skip", "only", "fails", "prop"]);

const FACTORIES = new Set(["each", "skipIf", "runIf"]);

/** The import an identifier is bound to: its source and the name it imports (`*` for a namespace). */
const imported = (variable: Variable | undefined): { readonly from: string; readonly name: string } | null => {
  const def = variable?.defs[0];

  if (def === undefined || def.type !== "ImportBinding" || def.parent?.type !== "ImportDeclaration") {
    return null;
  }

  if (def.parent.importKind === "type") {
    return null;
  }

  const from = def.parent.source.value;
  const spec = def.node;

  if (spec.type === "ImportNamespaceSpecifier") {
    return { from, name: "*" };
  }

  if (spec.type === "ImportSpecifier" && spec.importKind !== "type") {
    return { from, name: spec.imported.type === "Identifier" ? spec.imported.name : String(spec.imported.value) };
  }

  return null;
};

/** A member's name, written plainly or as a string literal. */
const written = (node: ESTree.MemberExpression): string | null => {
  if (!node.computed && node.property.type === "Identifier") {
    return node.property.name;
  }

  return node.property.type === "Literal" && typeof node.property.value === "string" ? node.property.value : null;
};

const unchained = (node: Node): Node => (node.type === "ChainExpression" ? node.expression : node);

const isFunction = (node: Node): node is ESTree.ArrowFunctionExpression | ESTree.Function =>
  node.type === "ArrowFunctionExpression" || node.type === "FunctionExpression";

/** What a name resolves to in the test API: the clock the body runs on. */
type Clock = "test" | "live" | "unknown";

export const noSleepOnTestClock: CreateRule = {
  create(context) {
    const resolve = (node: Node & { readonly name: string }): Variable | undefined => {
      let scope: Scope | null = context.sourceCode.getScope(node);

      while (scope !== null) {
        const variable = scope.set.get(node.name);

        if (variable !== undefined) {
          return variable;
        }

        scope = scope.upper;
      }

      return undefined;
    };

    /** The part of Effect a node is: `Effect`, `E.Effect` (the barrel as a namespace), `Stream`, `TestClock`. */
    const partOf = (given: Node): Part | null => {
      const node = unchained(given);

      if (node.type === "Identifier") {
        const at = imported(resolve(node));

        if (at === null) {
          return null;
        }

        if (at.from === "effect" && (at.name === "Effect" || at.name === "Schedule" || at.name === "Stream")) {
          return at.name;
        }

        if (at.from === "effect/testing" && at.name === "TestClock") {
          return "TestClock";
        }

        if (at.name === "*") {
          return at.from === "effect/Effect"
            ? "Effect"
            : at.from === "effect/Schedule"
              ? "Schedule"
              : at.from === "effect/Stream"
                ? "Stream"
                : at.from === "effect/testing/TestClock"
                  ? "TestClock"
                  : null;
        }

        return null;
      }

      if (node.type === "MemberExpression" && node.object.type === "Identifier") {
        const at = imported(resolve(node.object));
        const name = written(node);

        if (at === null || at.name !== "*") {
          return null;
        }

        if (at.from === "effect" && (name === "Effect" || name === "Schedule" || name === "Stream")) {
          return name;
        }

        return at.from === "effect/testing" && name === "TestClock" ? "TestClock" : null;
      }

      return null;
    };

    /** The part and member a node names: `Effect.sleep`, or `sleep` imported by name from `effect/Effect`. */
    const memberOf = (given: Node): { readonly part: Part; readonly member: string } | null => {
      const node = unchained(given);

      if (node.type === "MemberExpression") {
        const part = partOf(node.object);
        const member = written(node);

        return part === null || member === null ? null : { part, member };
      }

      if (node.type === "Identifier") {
        const at = imported(resolve(node));

        if (at === null) {
          return null;
        }

        const part: Part | null =
          at.from === "effect/Effect"
            ? "Effect"
            : at.from === "effect/Schedule"
              ? "Schedule"
              : at.from === "effect/Stream"
                ? "Stream"
                : at.from === "effect/testing/TestClock"
                  ? "TestClock"
                  : null;

        return part === null ? null : { part, member: at.name };
      }

      return null;
    };

    const isWait = (node: Node): boolean => {
      const at = memberOf(node);

      return at !== null && WAITS[at.part].has(at.member);
    };

    const isMove = (node: Node): boolean => {
      const at = memberOf(node);

      return at !== null && at.part === "TestClock" && MOVES.has(at.member);
    };

    const isLive = (node: Node): boolean => {
      const at = memberOf(node);

      return at !== null && at.part === "TestClock" && at.member === "withLive";
    };

    /** Whether a name is the one `@effect/vitest` exports under `name`, or `name` on a namespace import of it. */
    const fromVitest = (given: Node, name: string): boolean => {
      const node = unchained(given);

      if (node.type === "Identifier") {
        const at = imported(resolve(node));

        return at !== null && at.from === "@effect/vitest" && at.name === name;
      }

      if (node.type === "MemberExpression" && node.object.type === "Identifier") {
        const at = imported(resolve(node.object));

        return at !== null && at.from === "@effect/vitest" && at.name === "*" && written(node) === name;
      }

      return false;
    };

    /** The clock the tests of a test API (`it`, or the parameter of a `layer` block) run on. */
    const clockOf = (given: Node): Clock => {
      const node = unchained(given);

      if (fromVitest(node, "it")) {
        return "test";
      }

      if (node.type !== "Identifier") {
        return "unknown";
      }

      const def = resolve(node)?.defs[0];

      if (def === undefined || def.type !== "Parameter" || !isFunction(def.node) || def.node.params[0] !== def.name) {
        return "unknown";
      }

      return blockClock(def.node);
    };

    /** The clock the tests of a `layer(L, options)(name, (it) => ...)` block run on. */
    const blockClock = (block: Node): Clock => {
      const made = (block as Node & { readonly parent: Node }).parent;

      if (made.type !== "CallExpression" || made.callee.type !== "CallExpression") {
        return "unknown";
      }

      const layer = made.callee;
      const named = unchained(layer.callee);

      const outer: Clock = fromVitest(named, "layer")
        ? "test"
        : named.type === "MemberExpression" && written(named) === "layer"
          ? clockOf(named.object)
          : "unknown";

      if (outer !== "test") {
        return outer;
      }

      const options = layer.arguments[1];

      if (options === undefined) {
        return "test";
      }

      if (options.type !== "ObjectExpression") {
        return "unknown";
      }

      for (const property of options.properties) {
        if (property.type !== "Property") {
          return "unknown";
        }

        const key = property.key;

        if (!property.computed && key.type === "Identifier" && key.name === "excludeTestServices") {
          const value = property.value;

          return value.type === "Literal" && value.value === false
            ? "test"
            : value.type === "Literal" && value.value === true
              ? "live"
              : "unknown";
        }
      }

      return "test";
    };

    /** Whether a callee is `it.effect`, or one of its forms that makes a test. */
    const isEffectTest = (given: Node): boolean => {
      const node = unchained(given);

      if (node.type === "CallExpression") {
        // `it.effect.each(cases)(name, fn)`: the call that made the function.
        return node.callee.type === "MemberExpression" && isEffectTest(node.callee);
      }

      if (fromVitest(node, "effect")) {
        return true;
      }

      if (node.type !== "MemberExpression") {
        return false;
      }

      const name = written(node);

      if (name === "effect") {
        return clockOf(node.object) === "test";
      }

      return name !== null && (FORMS.has(name) || FACTORIES.has(name)) && isEffectTest(node.object);
    };

    /** Whether a callee only makes the function that registers tests (`it.effect.each`), and runs none. */
    const isFactory = (given: Node): boolean => {
      const node = unchained(given);

      return node.type === "MemberExpression" && FACTORIES.has(written(node) ?? "");
    };

    /** Whether a call sits inside another call that carries `TestClock.withLive`, as its callee or an argument. */
    const isLiveCall = (node: Node, body: Node): boolean => {
      // SAFETY: oxlint sets `parent` on every node it visits, null only on the Program.
      let at = (node as Node & { readonly parent?: Node | null }).parent;

      while (at != null) {
        if (at.type === "CallExpression" && (isLive(at.callee) || at.arguments.some((argument) => isLive(argument)))) {
          return true;
        }

        if (at === body) {
          return false;
        }

        // SAFETY: each ancestor oxlint hands back carries its own `parent`.
        at = (at as Node & { readonly parent?: Node | null }).parent;
      }

      return false;
    };

    const check = (body: Node) => {
      const waits: Node[] = [];
      let moves = false;

      for (const node of below(body)) {
        if (node.type === "MemberExpression") {
          moves = moves || isMove(node);

          if (isWait(node)) {
            waits.push(node);
          }
        } else if (node.type === "CallExpression" && node.callee.type === "Identifier") {
          moves = moves || isMove(node.callee);

          if (isWait(node.callee)) {
            waits.push(node);
          }
        } else if (node.type === "Identifier") {
          // `run(adjust)`: a move named by import and handed on, with no call of its own.
          // SAFETY: oxlint sets `parent` on every node it visits, and an identifier in a body always has one.
          const { parent } = node as Node & { readonly parent: Node };

          moves = moves || (parent.type === "CallExpression" && parent.callee !== node && isMove(node));
        }
      }

      if (moves) {
        return;
      }

      for (const wait of waits) {
        if (!isLiveCall(wait, body)) {
          context.report({ node: wait, message: MESSAGE });
        }
      }
    };

    return {
      CallExpression(node) {
        if (isFactory(node.callee) || !isEffectTest(node.callee)) {
          return;
        }

        for (const argument of node.arguments) {
          if (isFunction(argument) && argument.body !== null) {
            check(argument.body);
          }
        }
      },
    };
  },
};
