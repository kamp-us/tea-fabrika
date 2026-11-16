// 0584, in `pnpm lint`: a test's kind follows what it uses, held from the side the per-file rule
// cannot see. `fabrika/integration-test-name` fails a plain test whose own code starts a real thing;
// this fails an `*.integration.test.ts` file that reaches no starter at all, through its own code or
// any chain of imports, so a file named `.integration.` that runs on stand-ins moves back to the
// pull request check. A starter is a module whose own code opens a real thing (starters.ts).
//
//   node oxlint-plugins/test-kind.ts            # this repo
//   node oxlint-plugins/test-kind.ts <folder>   # another tree, as the test does
//
// The imports come from `code-graph <scope> --graph --edges` (0040), which resolves relative paths
// and our workspace packages' `exports` maps, `*` patterns included; a type-only import is no use.
// An import is not a use, so this errs toward passing: any starter reached counts, and a call that
// needs Node's platform layer counts wherever the layer comes from.
//
// A plain test that reaches a starter only through helpers is printed as an `advice:` line and
// never fails: an import is not a use, and most such helpers are imported for something else. The
// review names the real ones (README.md, "integration-test-name", says what code cannot tell).
//
// Exit 0 at zero, 1 on an `.integration.` file that opens nothing, 2 when it could not read.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Match, Option, Schema } from "effect";
import { type Argument, type Expression, parseSync, Visitor } from "oxc-parser";
import { DRIVES, reader, type Open, type Receiver } from "./starters.ts";

/** The folders whose test files this check holds. Each tooling slice of ticket 1073 adds its own. */
const SCOPE = ["next"];

/** One import, as code-graph resolves it: the module it reaches, or `null` outside the tree. */
type Edge = { readonly target: string | null; readonly typeOnly: boolean };

/** One module of the tree, by its path from the top: its text, and its imports. */
export type Module = { readonly source: string; readonly imports: ReadonlyArray<Edge> };

/** What the check says of one test file: a failure, or advice. */
type Finding =
  | { readonly _tag: "integration_opens_nothing"; readonly file: string }
  | {
      readonly _tag: "plain_opens";
      readonly file: string;
      readonly via: ReadonlyArray<string>;
      readonly opens: Pick<Open<null>, "_tag" | "call">;
    };

const INTEGRATION = /\.integration\.test\.tsx?$/;

const TEST = /\.test\.tsx?$/;

const NAMED = /\.(?:integration|visual)\.test\.tsx?$/;

/** A callee as written in oxc-parser's tree, `cp.spawn`, or `null` for any other shape. */
const written = (node: Expression): string | null => {
  if (node.type === "Identifier") {
    return node.name;
  }

  if (node.type !== "MemberExpression" || node.optional || node.property.type !== "Identifier") {
    return null;
  }

  const object = written(node.object);

  return object === null || node.computed ? null : `${object}.${node.property.name}`;
};

/** An expression without the parentheses oxc-parser keeps around it. */
const bare = (node: Expression): Expression => (node.type === "ParenthesizedExpression" ? bare(node.expression) : node);

/** The service a `yield*` hands over, as written: `ChildProcessSpawner.ChildProcessSpawner`. */
const yielded = (node: Expression | null): string | null => {
  const at = node === null ? null : bare(node);

  return at?.type === "YieldExpression" && at.delegate && at.argument !== null ? written(at.argument) : null;
};

/** What a method is called on, or `null` for a call that is not a method's. */
const receiver = (callee: Expression): Receiver | null => {
  if (callee.type !== "MemberExpression") {
    return null;
  }

  const service = yielded(callee.object);
  const name = written(bare(callee.object));

  return service !== null
    ? { _tag: "yield", written: service }
    : name === null
      ? null
      : { _tag: "name", written: name };
};

/** A string literal, or a template's text before its first placeholder. */
const literal = (node: Argument | undefined): string | null =>
  node?.type === "Literal" && typeof node.value === "string"
    ? node.value
    : node?.type === "TemplateLiteral"
      ? (node.quasis[0]?.value.cooked ?? null)
      : null;

/** What one module's own code opens: oxc-parser's tree, fed to starters.ts's reader. */
const read = (file: string, source: string) => {
  const each = reader<null>();
  new Visitor({
    ImportDeclaration(node) {
      if (node.importKind === "type") {
        return;
      }

      each.imports(
        node.source.value,
        node.specifiers.flatMap((spec) =>
          spec.type === "ImportSpecifier" && spec.importKind === "type"
            ? []
            : [
                {
                  local: spec.local.name,
                  imported:
                    spec.type !== "ImportSpecifier"
                      ? null
                      : spec.imported.type === "Identifier"
                        ? spec.imported.name
                        : spec.imported.value,
                },
              ],
        ),
      );
    },
    VariableDeclarator(node) {
      if (node.id.type === "Identifier") {
        each.yields(node.id.name, yielded(node.init));
      }
    },
    NewExpression(node) {
      each.constructs(null, written(node.callee), literal(node.arguments[0]));
    },
    CallExpression(node) {
      const { callee } = node;

      const method =
        callee.type === "MemberExpression" && !callee.computed && callee.property.type === "Identifier"
          ? callee.property.name
          : null;

      each.calls(null, written(callee), method, receiver(callee), literal(node.arguments[0]));
    },
  }).visit(parseSync(file, source).program);

  return { alone: each.opens("alone"), any: each.opens("any") };
};

/** What each module's own code opens, read once per module. */
const opener = (modules: ReadonlyMap<string, Module>) => {
  const known = new Map<string, ReturnType<typeof read>>();

  return (file: string) => {
    const found = known.get(file) ?? read(file, modules.get(file)?.source ?? "");
    known.set(file, found);

    return found;
  };
};

/** The first module `file`'s imports reach that opens something, with the chain to it. */
const reach = (
  modules: ReadonlyMap<string, Module>,
  file: string,
  opens: (file: string) => ReadonlyArray<Open<null>>,
): { readonly via: ReadonlyArray<string>; readonly open: Open<null> } | null => {
  const from = new Map<string, string | null>([[file, null]]);
  const queue = [file];

  for (let at = queue.shift(); at !== undefined; at = queue.shift()) {
    const [open] = opens(at);

    if (open !== undefined) {
      const via: Array<string> = [];

      for (let step: string | null | undefined = at; step !== null && step !== undefined; step = from.get(step)) {
        via.unshift(step);
      }

      return { via, open };
    }

    // A type-only import is erased before the code runs, so it reaches nothing.
    for (const { target, typeOnly } of modules.get(at)?.imports ?? []) {
      if (target !== null && !typeOnly && !from.has(target) && modules.has(target)) {
        from.set(target, at);
        queue.push(target);
      }
    }
  }

  return null;
};

/** Every finding on the tree's test files: the failures, then the advice. */
export const judge = (modules: ReadonlyMap<string, Module>): ReadonlyArray<Finding> => {
  const read = opener(modules);
  const tests = [...modules.keys()].filter((file) => TEST.test(file)).sort();

  const failures = tests
    .filter((file) => INTEGRATION.test(file) && reach(modules, file, (at) => read(at).any) === null)
    .map((file): Finding => ({ _tag: "integration_opens_nothing", file }));

  // A plain test whose own code opens something is the per-file rule's; this names the rest.
  const advice = tests
    .filter((file) => !NAMED.test(file) && read(file).alone.length === 0)
    .flatMap((file): ReadonlyArray<Finding> => {
      const found = reach(modules, file, (at) => (at === file ? [] : read(at).alone));

      return found === null
        ? []
        : [{ _tag: "plain_opens", file, via: found.via, opens: { _tag: found.open._tag, call: found.open.call } }];
    });

  return [...failures, ...advice];
};

/** The part of code-graph's `--graph` answer this reads. */
const Graph = Schema.Struct({
  modules: Schema.Array(
    Schema.Struct({
      file: Schema.String,
      importEdges: Schema.Array(Schema.Struct({ target: Schema.NullOr(Schema.String), typeOnly: Schema.Boolean })),
    }),
  ),
});

/** This tool's own code-graph, so another tree needs no install of its own. */
const CODE_GRAPH = join(import.meta.dirname, "..", "node_modules/.bin/code-graph");

const readGraph = Schema.decodeUnknownOption(Schema.fromJsonString(Graph));

/** The modules of one scope folder, by path from the top of `root`, or why code-graph could not say. */
const tree = (
  root: string,
  scope: string,
):
  | { readonly _tag: "read"; readonly modules: ReadonlyArray<readonly [string, Module]> }
  | { readonly _tag: "unread"; readonly why: string } => {
  // The edge pass resolves imports; without it code-graph answers no targets.
  const graph = spawnSync(CODE_GRAPH, [scope, "--graph", "--edges"], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 2 ** 30,
  });

  const read = graph.status === 0 ? readGraph(graph.stdout) : Option.none();

  if (Option.isNone(read)) {
    return { _tag: "unread", why: `code-graph ${scope} gave no graph (exit ${graph.status}):\n${graph.stderr}` };
  }

  const modules = read.value.modules.map(({ file, importEdges }): readonly [string, Module] => [
    `${scope}/${file}`,
    {
      source: readFileSync(join(root, scope, file), "utf8"),
      imports: importEdges.map(({ target, typeOnly }) => ({
        target: target === null ? null : `${scope}/${target}`,
        typeOnly,
      })),
    },
  ]);

  return { _tag: "read", modules };
};

const line = (finding: Finding): string =>
  Match.valueTags(finding, {
    integration_opens_nothing: ({ file }) =>
      `${file}: named .integration. but reaches no real thing through its code or its imports (0584). It runs on stand-ins, so name it \`.test.ts\` and it runs on every pull request; or, if it does start a real thing this check cannot see, say what in oxlint-plugins/README.md's integration-test-name section.`,
    plain_opens: ({ file, opens, via }) =>
      `advice: ${file} reaches ${DRIVES[opens._tag]} through ${via.slice(1).join(" -> ")} (\`${opens.call}\`). If the law calls it, name the file \`.integration.test.ts\` (0584).`,
  });

if (import.meta.main) {
  const root = process.argv[2] ?? join(import.meta.dirname, "..");
  const trees = SCOPE.map((scope) => tree(root, scope));
  const unread = trees.flatMap((each) => Match.valueTags(each, { unread: ({ why }) => [why], read: () => [] }));

  if (unread.length > 0) {
    console.error(`test-kind: could not read:\n${unread.join("\n")}`);
    process.exit(2);
  }

  const findings = judge(
    new Map(trees.flatMap((each) => Match.valueTags(each, { read: ({ modules }) => modules, unread: () => [] }))),
  );

  const failed = findings.filter((each) =>
    Match.valueTags(each, { integration_opens_nothing: () => true, plain_opens: () => false }),
  );

  for (const finding of findings) {
    Match.valueTags(finding, { plain_opens: () => console.log, integration_opens_nothing: () => console.error })(
      line(finding),
    );
  }

  if (failed.length > 0) {
    console.error(`test-kind: ${failed.length} .integration. files reach no real thing.`);
    process.exit(1);
  }

  console.log(`test-kind: every .integration. file in ${SCOPE.join(", ")} reaches a real thing`);
}
