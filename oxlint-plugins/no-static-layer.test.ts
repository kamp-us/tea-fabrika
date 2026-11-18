import { readFileSync } from "node:fs";
import { join } from "node:path";
import { it } from "@effect/vitest";
// Ticket 911, B1.0. `fabrika/no-static-layer` refuses every static member of a class that extends
// `Context.Service` (0095; owner, 2026-11-13). Law 2 runs generated classes in process through
// oxlint's RuleTester. Laws 3 and 6 read the repo's own `.oxlintrc.json`: one real lint run over a
// planted file per listed folder and per left-out kind, and the saved list of the folders listed on
// the day the rule landed, which may only grow.
import { Array as Arr, Effect, pipe, Record as Rec, Schema } from "effect";
import * as fc from "fast-check";
import { parseSync } from "oxc-parser";
import { RuleTester } from "oxlint/plugins-dev";
import { expect } from "vitest";
import { plant } from "../next/apps/fabrika/src/exam/plant.ts";
import { noStaticLayer } from "./no-static-layer.ts";

/** A promise the test waits on rejected: the test's own failure, with the rejection as its cause. */
class TestFailure extends Schema.TaggedError<TestFailure, { readonly brand: unique symbol }>()("TestFailure", {
  cause: Schema.Unknown,
}) {}

/** Waits on a promise inside the test's Effect, as `Effect.tryPromise` in its object form. */
const promised = <A>(run: () => PromiseLike<A>) =>
  Effect.tryPromise({ try: run, catch: (cause) => TestFailure.make({ cause }) });

// RuleTester runs each case at once, so a failure throws into fast-check, which shrinks it.
RuleTester.describe = (_name, fn) => fn();

RuleTester.it = (_name, fn) => fn();

const root = join(import.meta.dirname, "..");

const tester = new RuleTester({ cwd: root });

const CODE = "fabrika(no-static-layer)";

const RULE = "fabrika/no-static-layer";

/** How the file reaches `Context.Service`: its import line, and the callee it writes. */
const SPELLINGS = {
  named: { line: 'import { Context } from "effect";', callee: "Context.Service" },
  renamed: { line: 'import { Context as Ctx } from "effect";', callee: "Ctx.Service" },
  namespace: { line: 'import * as Ctx from "effect/Context";', callee: "Ctx.Service" },
  barrel: { line: 'import * as Fx from "effect";', callee: "Fx.Context.Service" },
  service: { line: 'import { Service } from "effect/Context";', callee: "Service" },
} as const;

type Spelling = keyof typeof SPELLINGS;

/**
 * What the class extends. Only `service` makes it a service class (B1's cases 2 and 3). The four
 * look-alikes reach a `.Service` or a `Service` that is not Effect's `Context`: a `Context` from
 * another package (alchemy's `Plugin.Service` in `node/dev/ControlPlugin.ts` is the real one), a
 * `Service` from a module other than `effect/Context`, another member of the `effect` barrel, and a
 * local `Context`.
 */
type Base =
  | "service"
  | "taggedError"
  | "opaque"
  | "none"
  | "local"
  | "foreignContext"
  | "foreignService"
  | "barrelOther"
  | "localContext";

/** A class's `extends` clause, and the import line that stands in for the spelling's, if any. */
const heritage = (base: Base, spelling: Spelling, name: string): { readonly line?: string; readonly text: string } => {
  const shape = `<${name}, { readonly n: number }>()("t/${name}")`;

  switch (base) {
    case "service":
      return { text: ` extends ${SPELLINGS[spelling].callee}${shape}` };
    case "taggedError":
      return { text: ` extends Schema.TaggedError<${name}>()("${name}", {})` };
    case "opaque":
      return { text: ` extends Schema.Opaque<${name}>()(Schema.Struct({}))` };
    case "none":
      return { text: "" };
    // A local `Local.Service` that is not Effect's: the same shape, bound to nothing imported.
    case "local":
      return { text: ` extends Local.Service${shape}` };
    case "foreignContext":
      return { line: 'import { Context } from "alchemy";', text: ` extends Context.Service${shape}` };
    case "foreignService":
      return { line: 'import { Service } from "alchemy/Context";', text: ` extends Service${shape}` };
    case "barrelOther":
      return { line: 'import * as Fx from "effect";', text: ` extends Fx.Schema.Service${shape}` };
    case "localContext":
      return { line: "declare const Context: any;", text: ` extends Context.Service${shape}` };
  }
};

/** A member form, as one line, and whether it is static and not a `declare` field (B1's cases 1 and 4). */
const FORMS: ReadonlyArray<readonly [(n: string) => string, boolean]> = [
  [(n) => `static readonly ${n} = 1;`, true],
  [(n) => `static ${n} = 1;`, true],
  [(n) => `static ${n}: number;`, true],
  [(n) => `static ${n}(): number { return 1; }`, true],
  [(n) => `static get ${n}(): number { return 1; }`, true],
  [(n) => `static set ${n}(_v: number) {}`, true],
  [(n) => `static accessor ${n} = 1;`, true],
  [() => "static {}", true],
  [(n) => `declare static ${n}: number;`, false],
  [(n) => `readonly ${n} = 1;`, false],
  [(n) => `${n}(): number { return 1; }`, false],
  [(n) => `get ${n}(): number { return 1; }`, false],
  [(n) => `declare ${n}: number;`, false],
];

const NAMES = ["layer", "make", "sign", "memory", "sql", "withLoader"] as const;

const generated = fc.record({
  base: fc.constantFrom<Base>(
    "service",
    "taggedError",
    "opaque",
    "none",
    "local",
    "foreignContext",
    "foreignService",
    "barrelOther",
    "localContext",
  ),
  spelling: fc.constantFrom<Spelling>("named", "renamed", "namespace", "barrel", "service"),
  // B1's case 5: a class expression is read as a declaration is.
  expression: fc.boolean(),
  members: fc.array(fc.record({ form: fc.nat(FORMS.length - 1), name: fc.constantFrom(...NAMES) }), {
    maxLength: 8,
  }),
});

it("fires exactly on the static members of a class that extends Context.Service, in every import spelling", () => {
  fc.assert(
    fc.property(generated, ({ base, spelling, expression, members }) => {
      const extended = heritage(base, spelling, "Retries");
      const open = `class Retries${extended.text} {`;

      const head = [
        extended.line ?? SPELLINGS[spelling].line,
        'import { Schema } from "effect";',
        "declare const Local: any;",
        expression ? `export const Retries = ${open}` : `export ${open}`,
      ];

      // An index after each name keeps two members of one name apart.
      const body = Arr.map(members, ({ form, name }, i) => {
        const [text, fires] = FORMS[form] ?? FORMS[0]!;

        return { text: `  ${text(`${name}${i === 0 ? "" : i}`)}`, fires: fires && base === "service" };
      });

      const code = Arr.join([...head, ...Arr.map(body, (b) => b.text), expression ? "};" : "}", ""], "\n");
      const lines = Arr.flatMap(body, (b, i) => (b.fires ? [head.length + i + 1] : []));
      const filename = "next/packages/libfabrika/src/tasks/Retries.ts";

      if (lines.length === 0) {
        tester.run("no-static-layer", noStaticLayer, { valid: [{ code, filename }], invalid: [] });

        return;
      }

      tester.run("no-static-layer", noStaticLayer, {
        valid: [],
        invalid: [{ code, filename, errors: Arr.map(lines, (line) => ({ line, message: /holds only its contract/ })) }],
      });
    }),
    { seed: 119120, numRuns: 100 },
  );
});

// pinned: the folders listed on the day the rule landed (B1.0, at zero in the replay of
// oxlint-plugins/README.md). A folder dropped in a merge is silent, so this list only grows, until
// the last slice replaces it with `next/**`.
const LISTED = [
  "next/apps/**",
  "next/programs/**",
  "next/packages/libfabrika/src/ci/**",
  "next/packages/libfabrika/src/codehost/**",
  "next/packages/libfabrika/src/coordination/**",
  "next/packages/libfabrika/src/tasks/**",
  "next/packages/libfabrika/src/ledger/**",
  "next/packages/libfabrika/src/node/**",
  "next/packages/libfabrika/src/packs/**",
  "next/packages/libfabrika/src/repositories/**",
  "next/packages/libfabrika/src/schedules/**",
  "next/packages/libfabrika/src/settings/**",
  "next/packages/libfabrika/src/transport/**",
];

// oxc-parser's tree, read loosely: `.oxlintrc.json` is JSON with comments, so only literals, arrays
// and objects are walked.
type Tree = any;

const toValue = (node: Tree): Schema.Json => {
  if (node.type === "ObjectExpression") {
    return Rec.fromEntries(node.properties.map((p: Tree) => [p.key.value ?? p.key.name, toValue(p.value)]));
  }

  if (node.type === "ArrayExpression") {
    return node.elements.map(toValue);
  }

  if (node.type === "Literal") {
    return node.value;
  }

  throw new Error(`.oxlintrc.json holds a ${node.type}`);
};

/** The `files` of every override that turns the rule on: today one block. */
const configured = (): readonly string[] => {
  const text = readFileSync(join(root, ".oxlintrc.json"), "utf8");
  const tree: Tree = parseSync("oxlintrc.ts", `export default ${text}`).program;

  // SAFETY: `.oxlintrc.json` holds an `overrides` list whose blocks each carry `files` and `rules`.
  const config = toValue(tree.body[0].declaration) as {
    readonly overrides: ReadonlyArray<{ readonly files: readonly string[]; readonly rules: Record<string, unknown> }>;
  };

  return pipe(
    config.overrides,
    Arr.filter((o) => o.rules[RULE] === "error"),
    Arr.flatMap((o) => o.files),
  );
};

it("pinned: every folder listed the day the rule landed is still listed, or the list is next/**", () => {
  const files = configured();

  if (files.includes("next/**")) {
    return;
  }

  expect(Arr.filter(LISTED, (folder) => !files.includes(folder))).toEqual([]);
});

const SERVICE = Arr.join(
  [
    'import { Context, Layer } from "effect";',
    "",
    'export class Planted extends Context.Service<Planted, { readonly n: number }>()("t/Planted") {',
    "  static readonly layer = Layer.succeed(Planted, { n: 1 });",
    "}",
    "",
  ],
  "\n",
);

it.live(
  "scenario: the real config holds a static layer in each listed folder, and leaves tests and today's version out",
  () =>
    Effect.gen(function* () {
      // Only the real config holds the list, so one real lint run reads one planted file per listed
      // folder, saved or added since, and per left-out kind.
      const folders = Arr.filter([...new Set([...LISTED, ...configured()])], (f) => f !== "next/**");
      const on = Arr.map(folders, (folder) => folder.replace(/\*\*$/, "planted/Planted.ts"));

      const off = [
        "next/packages/libfabrika/src/tasks/Planted.test.ts",
        "next/packages/libfabrika/src/tasks/Planted.test.tsx",
        "next/packages/libfabrika/src/tasks/PlantedTest.ts",
        "next/packages/libfabrika/src/tasks/Planted.test-support.ts",
        "next/apps/fabrika/src/Planted.test.ts",
        "packages/fabrika/src/Planted.ts",
      ];

      const linted = yield* promised(() => plant(Rec.fromEntries(Arr.map([...on, ...off], (path) => [path, SERVICE]))));

      expect(Arr.map(on, (path) => [path, linted(CODE, path)])).toEqual(Arr.map(on, (path) => [path, [4]]));
      expect(Arr.map(off, (path) => [path, linted(CODE, path)])).toEqual(Arr.map(off, (path) => [path, []]));
    }),
);
