// Each law in a `next/` or `.agents/` test file is a property, or an example whose title starts with
// `vector:`, `format:`, `pinned:`, `scenario:` or `type:` and its reason (0093, 0527). One ticket or
// law id may stand before the label (`T652 scenario: ...`, `R3 format: ...`): one token of letters,
// digits and dots, then a space. A label deeper in the title, or only in a comment, does not count.
// It blocks in every folder at zero, and advises where the config's warn override still names the
// folder (0523).
//
// A test is a call rooted at `it` or `test`: `it(...)`, `it.effect(...)`, `it.live(...)`,
// `it.skip(...)`, `it.only(...)`, `it.fails(...)`, and the ones a first call makes:
// `it.each(rows)(...)`, `it.skipIf(c)(...)`, `it.runIf(c)(...)`, `it.for(rows)(...)`. A `describe`
// is not a test, so the tests inside it are read one by one. `it.todo` is not read. `it.layer(L)` makes
// a group, not a test, so only the tests inside it are read. A test function a file makes for itself
// (`const t = test.extend(...)`) is not read.
//
// It is a property when its chain names `prop` (`it.prop`, `it.effect.prop`), or when its body
// calls fast-check's `assert` (through any local name an import of `fast-check` gives it) or one of
// `@demlik/tea/pbt`'s runners (`propertyTrace`, `propertyInvariant`, `propertyTerminates`), or the
// shared runner: `property` from a `Testing.test-support.ts` module (libfabrika's, which calls
// `fc.assert` itself), named, renamed or through a namespace. A body that calls a function this file
// declares counts as that function's body too, followed to any depth. Any other imported helper is
// not followed, a `property` from another module included.
//
// A `type:` law is one only the compiler checks, so its body is judged before the property shapes,
// and it gets its own message (0527). Each statement is an `expectTypeOf(...)` or `assertType(...)`
// chain, or a `type` or `interface` declaration, with one chain at least. No other call, `new`,
// `await`, `yield`, tagged template or `import()` stands anywhere in it, the chains' arguments and
// the functions written in them included. The two names count only from a value import of `vitest`
// or `@effect/vitest`, under any local name or through a namespace. A `type:` title on `it.prop`, or
// on a body that calls `fc.assert`, fails too: a property is a runtime check.
//
// A title is read only when it is written out: a string, or a template whose text before its first
// `${}` already decides it. Any other title (a helper's parameter, `name + x`) is not judged, so a
// helper that wraps `it` is read at its own `it` only when that one is a property. Under-reporting
// is the safe side for a rule that blocks.
import type { CreateRule, ESTree } from "@oxlint/plugins";
import { below, dotted, type Node } from "./match.ts";

const LABELS = ["vector", "format", "pinned", "scenario", "type"] as const;

type Label = (typeof LABELS)[number];

/** One leading ticket or law id, `T652 ` or `R3.1 `, may stand before the label (lead, 2026-11-11). */
const ID = /^[A-Za-z0-9.]+ /;

const LABELED = new RegExp(`^(?:${ID.source.slice(1)})?(${LABELS.join("|")}):\\s*\\S`);

const RUNNERS = new Set(["propertyTrace", "propertyInvariant", "propertyTerminates"]);

/** The shared runner's module, by its last path segment: `../Testing.test-support.ts`, and its one export. */
const SHARED = /(?:^|\/)Testing\.test-support\.ts$/;

const SHARED_RUNNER = "property";

/** Vitest's two compile-time checks, and the modules that give them. */
const CHECKS = new Set(["expectTypeOf", "assertType"]);

const VITEST = new Set(["vitest", "@effect/vitest"]);

/** What runs code with no call of its own written in the body. */
const RUNS = new Set([
  "NewExpression",
  "AwaitExpression",
  "YieldExpression",
  "TaggedTemplateExpression",
  "ImportExpression",
]);

/** Calls that make a test from their own call: `it.each(rows)` is not a test, `it.each(rows)(...)` is. */
const MAKERS = new Set(["each", "for", "skipIf", "runIf"]);

export const MESSAGE = `A law here is a property (it.prop, it.effect.prop, a body that calls fc.assert, or a @demlik/tea/pbt runner) or an example whose title starts with ${LABELS.map((l) => `${l}:`).join(", ")} and its reason (0093, 0527).`;

export const TYPE_MESSAGE =
  "A law titled type: holds only compile-time checks: expectTypeOf or assertType from vitest, and type declarations, with no other call. A runtime check makes it a property or one of the other four labels (0527).";

type Fn = ESTree.ArrowFunctionExpression | ESTree.Function;

const isFn = (node: Node | null | undefined): node is Fn =>
  node != null &&
  (node.type === "ArrowFunctionExpression" ||
    node.type === "FunctionExpression" ||
    node.type === "FunctionDeclaration");

/** The member names from `it` or `test` to the call, `["effect", "prop"]`, or `null` for any other call. */
const chainOf = (callee: Node): readonly string[] | null => {
  const names: string[] = [];
  let at: Node = callee;

  for (;;) {
    if (at.type === "Identifier") {
      return at.name === "it" || at.name === "test" ? names.reverse() : null;
    }

    if (at.type === "MemberExpression" && !at.computed && at.property.type === "Identifier") {
      names.push(at.property.name);
      at = at.object;
      continue;
    }

    if (
      at.type === "CallExpression" &&
      at.callee.type === "MemberExpression" &&
      !at.callee.computed &&
      at.callee.property.type === "Identifier" &&
      MAKERS.has(at.callee.property.name)
    ) {
      at = at.callee;
      continue;
    }

    return null;
  }
};

/** The label a text starts with, after one optional id, when its reason follows: `type` for `T652 type: x`. */
const leading = (text: string): Label | "none" => {
  const found = LABELED.exec(text)?.[1];

  return LABELS.find((label) => label === found) ?? "none";
};

/** The label a written title starts with, `"none"`, or `null` when the source does not say. */
const labelOf = (title: Node | undefined): Label | "none" | null => {
  if (title?.type === "Literal" && typeof title.value === "string") {
    return leading(title.value);
  }

  if (title?.type !== "TemplateLiteral") {
    return null;
  }

  const head = title.quasis[0]?.value.cooked ?? "";

  if (title.expressions.length === 0 || leading(head) !== "none") {
    return leading(head);
  }

  // `format: ${x}` is labeled, with its reason in `x`. `${x}`, `form${x}` and `T652 ${x}` could
  // still become a label, so the source does not say. `the window ${x}` cannot.
  const rest = head.replace(ID, "");
  const started = LABELS.find((label) => head.startsWith(`${label}:`) || rest.startsWith(`${label}:`));

  if (started !== undefined) {
    return started;
  }

  return LABELS.some((label) => `${label}:`.startsWith(head) || `${label}:`.startsWith(rest)) ? null : "none";
};

/** The calls of one `expectTypeOf(...)...` or `assertType(...)` chain, or `null` for any other expression. */
const assertion = (expression: Node, checks: ReadonlySet<string>): ReadonlySet<Node> | null => {
  const calls = new Set<Node>();
  let at: Node = expression;

  for (;;) {
    if (at.type === "CallExpression") {
      calls.add(at);
      const name = dotted(at.callee);

      if (name !== null && checks.has(name)) {
        return calls;
      }

      at = at.callee;
      continue;
    }

    if (at.type === "MemberExpression" && !at.computed) {
      at = at.object;
      continue;
    }

    return null;
  }
};

/** Whether a body asserts types and runs nothing else: 0527's body. */
const typeOnly = (fn: Fn, checks: ReadonlySet<string>): boolean => {
  if (fn.body == null) {
    return false;
  }

  const statements: readonly Node[] = fn.body.type === "BlockStatement" ? fn.body.body : [fn.body];
  const calls = new Set<Node>();
  let chains = 0;

  for (const statement of statements) {
    if (statement.type === "TSTypeAliasDeclaration" || statement.type === "TSInterfaceDeclaration") {
      continue;
    }

    const chain = assertion(statement.type === "ExpressionStatement" ? statement.expression : statement, checks);

    if (chain === null) {
      return false;
    }

    chains++;

    for (const call of chain) {
      calls.add(call);
    }
  }

  for (const node of below(fn)) {
    if (RUNS.has(node.type) || (node.type === "CallExpression" && !calls.has(node))) {
      return false;
    }
  }

  return chains > 0;
};

export const lawShape: CreateRule = {
  create(context) {
    return {
      Program(program) {
        const asserts = new Set<string>();
        const runners = new Set<string>();
        const checks = new Set<string>();
        const local = new Map<string, Fn[]>();

        for (const statement of program.body) {
          if (statement.type !== "ImportDeclaration" || statement.importKind === "type") {
            continue;
          }

          const from = statement.source.value;
          const fastCheck = from === "fast-check";
          const pbt = from === "@demlik/tea/pbt";
          const shared = SHARED.test(from);
          const vitest = VITEST.has(from);

          for (const spec of statement.specifiers) {
            const name = spec.local.name;

            const imported =
              spec.type === "ImportSpecifier" && spec.imported.type === "Identifier" ? spec.imported.name : null;

            if (fastCheck && spec.type !== "ImportSpecifier") {
              asserts.add(`${name}.assert`);
            } else if (fastCheck && imported === "assert") {
              asserts.add(name);
            } else if (pbt && spec.type === "ImportNamespaceSpecifier") {
              for (const runner of RUNNERS) {
                runners.add(`${name}.${runner}`);
              }
            } else if (pbt && imported !== null && RUNNERS.has(imported)) {
              runners.add(name);
            } else if (shared && spec.type === "ImportNamespaceSpecifier") {
              runners.add(`${name}.${SHARED_RUNNER}`);
            } else if (shared && imported === SHARED_RUNNER) {
              runners.add(name);
            } else if (vitest && spec.type === "ImportNamespaceSpecifier") {
              for (const check of CHECKS) {
                checks.add(`${name}.${check}`);
              }
            } else if (
              vitest &&
              spec.type === "ImportSpecifier" &&
              spec.importKind !== "type" &&
              imported !== null &&
              CHECKS.has(imported)
            ) {
              checks.add(name);
            }
          }
        }

        for (const node of below(program)) {
          const named =
            node.type === "FunctionDeclaration" && node.id
              ? { name: node.id.name, fn: node }
              : node.type === "VariableDeclarator" && node.id.type === "Identifier" && isFn(node.init)
                ? { name: node.id.name, fn: node.init }
                : null;

          if (named !== null) {
            local.set(named.name, [...(local.get(named.name) ?? []), named.fn]);
          }
        }

        const proves = (fn: Node, seen: Set<Node>): boolean => {
          if (seen.has(fn)) {
            return false;
          }

          seen.add(fn);

          for (const node of below(fn)) {
            if (node.type !== "CallExpression") {
              continue;
            }

            const name = dotted(node.callee);

            if (name !== null && (asserts.has(name) || runners.has(name))) {
              return true;
            }

            if (node.callee.type === "Identifier" && (local.get(node.callee.name) ?? []).some((f) => proves(f, seen))) {
              return true;
            }
          }

          return false;
        };

        for (const node of below(program)) {
          if (node.type !== "CallExpression") {
            continue;
          }

          const { callee } = node;

          if (
            callee.type === "MemberExpression" &&
            callee.property.type === "Identifier" &&
            MAKERS.has(callee.property.name)
          ) {
            continue;
          }

          const chain = chainOf(callee);

          if (chain === null || chain.includes("todo") || node.arguments.length < 2) {
            continue;
          }

          const title = node.arguments[0];
          const label = labelOf(title);

          const bodies = node.arguments.flatMap((arg): Fn[] =>
            isFn(arg) ? [arg] : arg.type === "Identifier" ? (local.get(arg.name) ?? []) : [],
          );

          if (label === "type") {
            const kept = !chain.includes("prop") && bodies.length > 0 && bodies.every((body) => typeOnly(body, checks));

            if (!kept) {
              context.report({ node: title ?? node, message: TYPE_MESSAGE });
            }

            continue;
          }

          const seen = new Set<Node>();

          if (chain.includes("prop") || bodies.some((body) => proves(body, seen))) {
            continue;
          }

          if (label === "none") {
            context.report({ node: title ?? node, message: MESSAGE });
          }
        }
      },
    };
  },
};
