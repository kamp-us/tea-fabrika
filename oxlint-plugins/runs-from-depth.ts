// A heavy law reads its case count from the test depth (decision 0535): few cases on a pull request
// and in the merge queue, the full count on the 3-hour schedule. 0535 cuts cases only in a law over
// real IO, so in a `next/` test file a law may not write its case count as a number when it reaches
// real IO. A law in memory keeps its own count, whatever it is, on every pull request:
//
//   fc.assert(property, { seed, numRuns: 100 })                                // refused over real IO
//   fc.assert(pure, { seed, numRuns: 3000 })                                   // passes in memory
//   fc.assert(property, { seed, numRuns: runsFor({ fast: 10, full: 100 }) })   // passes
//
// Real-IO laws leave the merge line for the schedule's integration files (0536); this holds the ones
// still written with a bare count, and the depth setting stays for them.
//
// A case count is the value of a `numRuns` key (fast-check's and `@demlik/tea/pbt`'s option), or of
// a `runs` key inside an `arbitrary` object (`@effect/vitest`'s `it.prop` option). A `numRuns` handed
// to fast-check's `sample` or `statistics` is how many values to draw, so it stays. It is refused when
// it is a number literal, or a name the same file declares only as `const NAME = <number>`.
//
// Real IO is a name imported from a module in `IO` below (SQLite, a child process, a socket, a
// bundler, workerd, Alchemy's local state, a browser), a `node:fs` function that writes (`WRITES`),
// a dynamic `import()` of such a module, or, in a file that imports Effect's Node services
// (`@effect/platform-node`), a call of a FileSystem method that writes (`EFFECT_WRITES`). Reading a
// file or asking whether it exists is not real IO here: a law that checks a module is built before it
// loads it stays a law in memory.
//
// A law reaches real IO when the test call around the count (`it`, `it.effect`, `it.prop`, `test` and
// their forms) uses such a name, directly or through a declaration of the same file that does: a
// function, a const or a class at the top level or inside a `describe` or a loop. Names resolve
// through the file's scopes, so a parameter or a local that shares a name with an IO helper is its
// own name. A count outside any test call is held when a declaration around it reaches IO (a helper
// that runs the property), or when a test call that reaches IO uses it (a shared
// `const CHECK = { numRuns: 40 }`). A spread whose count a later key replaces, as in
// `{ ...options, numRuns: 60 }`, does not use the spread's count.
//
// It cannot see:
// - a shared suite (`*Test.ts`) whose driver its caller hands in;
// - real IO reached only through a helper module of its own (`./workerd.test-support.ts`);
// - a count passed as a plain argument to a helper (`prop(name, ..., 200)`, `runs(25)`);
// - a count built by an expression (`numRuns: n * 2`) or read from another file.
import type { CreateRule, ESTree, Scope, Variable } from "@oxlint/plugins";
import * as Arr from "effect/Array";
import * as Option from "effect/Option";
import { ancestors, below, pathIn, type Node } from "./match.ts";

/** Modules whose every name is real IO. */
const IO =
  /^(?:(?:node:)?(?:sqlite|child_process|net|http|https|worker_threads)|@effect\/sql-sqlite-node(?:\/.*)?|effect\/(?:unstable\/)?process(?:\/.*)?|rolldown(?:\/.*)?|miniflare|workerd|wrangler|@alchemy\.run\/cloudflare-runtime(?:\/.*)?|alchemy\/State(?:\/.*)?|playwright(?:-core)?(?:\/.*)?|@playwright\/test|@kampus\/libfabrika\/sqlite|.*\/NodeSqlite(?:\.ts)?)$/;

/** The file system: only a write is real IO, so reads and `existsSync` stay out. */
const FS = /^(?:node:)?fs(?:\/promises)?$/;

const WRITES =
  /^(?:mkdtemp|mkdir|writeFile|appendFile|rm|rmdir|unlink|cp|copyFile|symlink|link|rename|open|truncate|createWriteStream)(?:Sync)?$/;

/** Effect's Node services: real IO only where a FileSystem method that writes is called. */
const EFFECT_NODE = /^@effect\/platform-node(?:\/.*)?$/;

const EFFECT_WRITES =
  /^(?:makeTempDirectory|makeTempDirectoryScoped|makeTempFile|makeTempFileScoped|makeDirectory|writeFile|writeFileString|copyFile|symlink)$/;

/** A file a law may sit in: a test, a test kit or a shared suite. */
const TEST_FILE = /(?:\.test\.tsx?|\.test-support\.tsx?|Test\.tsx?)$/;

const MESSAGE = `A law over real IO reads its case count from the test depth (decision 0535): write \`runsFor({ fast, full })\` from \`@kampus/vitest\`, with \`fast\` the fewest cases that still prove the law on a pull request and \`full\` the count it had.`;

type Parented = Node & { readonly parent?: Node | null };

const parentOf = (node: Node): Node | null => (node as Parented).parent ?? null;

const numberIn = (node: Node | null | undefined): number | null =>
  node?.type === "Literal" && typeof node.value === "number" ? node.value : null;

/** A key and its value as the parser hands it: in an object literal, a pattern or an assignment target. */
type Pair = Extract<Node, { readonly type: "Property" }>;

const keyName = (property: Pair): string | null =>
  property.computed
    ? null
    : property.key.type === "Identifier"
      ? property.key.name
      : property.key.type === "Literal" && typeof property.key.value === "string"
        ? property.key.value
        : null;

/** The written module name of an import's source, or null when it is built at run time. */
const moduleName = (source: Node | null | undefined): string | null =>
  source?.type === "Literal" && typeof source.value === "string"
    ? source.value
    : source?.type === "TemplateLiteral" && source.expressions.length === 0
      ? (source.quasis[0]?.value.cooked ?? null)
      : null;

/** Whether an identifier reads a name, not a property key or a member's name. */
const isReference = (node: Node): boolean => {
  const parent = parentOf(node);

  if (parent === null) {
    return false;
  }

  if (parent.type === "MemberExpression" && parent.property === node && !parent.computed) {
    return false;
  }

  if ((parent.type === "Property" || parent.type === "MethodDefinition") && parent.key === node && !parent.computed) {
    return parent.type === "Property" && parent.shorthand;
  }

  return !(parent.type === "ImportSpecifier" || parent.type === "ImportDefaultSpecifier");
};

/** `it`, `test` and their forms: `it.effect`, `it.effect.prop`, `it.each(rows)`, `test.skip`. */
const isTestCall = (node: Node): boolean => {
  if (node.type !== "CallExpression") {
    return false;
  }

  let callee: Node = node.callee;

  while (callee.type === "MemberExpression" || callee.type === "CallExpression") {
    callee = callee.type === "MemberExpression" ? callee.object : callee.callee;
  }

  return callee.type === "Identifier" && (callee.name === "it" || callee.name === "test");
};

/** `{ ...options, numRuns: 60 }`: a spread whose case count a later key replaces, so its own count is unused. */
const overridden = (node: Node): boolean => {
  const spread = parentOf(node);
  const object = spread?.type === "SpreadElement" ? parentOf(spread) : null;

  if (spread === null || object?.type !== "ObjectExpression") {
    return false;
  }

  const after = object.properties.slice(object.properties.indexOf(spread as ESTree.SpreadElement) + 1);
  return Arr.some(after, (property) => property.type === "Property" && keyName(property) === "numRuns");
};

/** fast-check's `sample` and `statistics` take `numRuns` as how many values to draw, not a law's cases. */
const isDraw = (property: Node): boolean => {
  const object = parentOf(property);
  const call = object === null ? null : parentOf(object);

  if (call?.type !== "CallExpression" || call.arguments[0] === object) {
    return false;
  }

  const callee = call.callee.type === "MemberExpression" ? call.callee.property : call.callee;
  return callee.type === "Identifier" && (callee.name === "sample" || callee.name === "statistics");
};

/** Whether a `runs` key's object is the value of an `arbitrary` key: `{ arbitrary: { runs } }`. */
const inArbitrary = (property: Node): boolean => {
  const object = parentOf(property);
  const holder = object === null ? null : parentOf(object);
  return holder?.type === "Property" && holder.value === object && keyName(holder) === "arbitrary";
};

export const runsFromDepth: CreateRule = {
  create(context) {
    const file = pathIn(context);

    if (!file.startsWith("next/") || !TEST_FILE.test(file)) {
      return {};
    }

    /** The variable a name resolves to from where it is written. */
    const resolve = (node: Node & { readonly name: string }): Variable | undefined => {
      for (let scope: Scope | null = context.sourceCode.getScope(node); scope !== null; scope = scope.upper) {
        const variable = scope.set.get(node.name);

        if (variable !== undefined) {
          return variable;
        }
      }

      return undefined;
    };

    return {
      "Program:exit"(program) {
        const nodes = [...below(program)];
        const inTest = (node: Node): boolean => Arr.some([...ancestors(node)], (above) => isTestCall(above));

        // The variables that are real IO: the file's imports from an IO module.
        const io = new Set<Variable>();
        let effectNode = false;

        for (const node of nodes) {
          if (node.type === "ImportExpression") {
            effectNode ||= EFFECT_NODE.test(moduleName(node.source) ?? "");
          }

          if (node.type !== "ImportDeclaration") {
            continue;
          }

          const from = moduleName(node.source) ?? "";
          effectNode ||= EFFECT_NODE.test(from);

          for (const specifier of node.specifiers) {
            const imported =
              specifier.type === "ImportSpecifier"
                ? specifier.imported.type === "Identifier"
                  ? specifier.imported.name
                  : String(specifier.imported.value)
                : null;
            const variable = resolve(specifier.local);

            if (variable && (IO.test(from) || (FS.test(from) && (imported === null || WRITES.test(imported))))) {
              io.add(variable);
            }
          }
        }

        // Each declaration outside a test call (top level, or in a `describe` or a loop), by its
        // variable: what a law can reach through.
        const declared = new Map<Variable, Node>();

        for (const node of nodes) {
          const id =
            node.type === "VariableDeclarator" ||
            node.type === "FunctionDeclaration" ||
            node.type === "ClassDeclaration"
              ? node.id
              : null;

          if (id?.type === "Identifier" && !inTest(node)) {
            const variable = resolve(id);

            if (variable) {
              declared.set(variable, node);
            }
          }
        }

        const uses = new Map<Node, { readonly through: ReadonlySet<Variable>; readonly direct: boolean }>();
        const usesOf = (root: Node) => {
          const known = uses.get(root);

          if (known !== undefined) {
            return known;
          }

          const through = new Set<Variable>();
          let direct = false;

          for (const node of below(root)) {
            if (node.type === "Identifier" && isReference(node)) {
              const variable = resolve(node);

              if (variable !== undefined) {
                direct ||= io.has(variable);

                if (declared.has(variable) && declared.get(variable) !== root && !overridden(node)) {
                  through.add(variable);
                }
              }
            } else if (node.type === "ImportExpression") {
              direct ||= IO.test(moduleName(node.source) ?? "");
            } else if (node.type === "MemberExpression" && !node.computed && node.property.type === "Identifier") {
              direct ||= effectNode && EFFECT_WRITES.test(node.property.name);
            }
          }

          const found = { through, direct };
          uses.set(root, found);
          return found;
        };

        // A declaration reaches IO when it uses an IO name, or a declaration that does: a fixpoint.
        const reaching = new Set<Variable>();

        for (let grew = true; grew;) {
          grew = false;

          for (const [variable, node] of declared) {
            const { through, direct } = usesOf(node);

            if (!reaching.has(variable) && (direct || Arr.some([...through], (used) => reaching.has(used)))) {
              reaching.add(variable);
              grew = true;
            }
          }
        }

        const reaches = (root: Node): boolean => {
          const { through, direct } = usesOf(root);
          return direct || Arr.some([...through], (used) => reaching.has(used));
        };

        /** The declarations a node uses, followed through the declarations they use. */
        const usedThrough = (root: Node): ReadonlySet<Variable> => {
          const seen = new Set<Variable>();
          const queue = [...usesOf(root).through];

          for (let variable = queue.pop(); variable !== undefined; variable = queue.pop()) {
            const node = declared.get(variable);

            if (!seen.has(variable) && node !== undefined) {
              seen.add(variable);
              queue.push(...usesOf(node).through);
            }
          }

          return seen;
        };

        const tests = Arr.filter(nodes, (node) => isTestCall(node) && !inTest(node));

        // The number a name holds when the file declares it as `const NAME = <number>` and never as
        // anything else.
        const numbers = new Map<string, number>();
        const others = new Set<string>();

        for (const node of nodes) {
          if (node.type === "VariableDeclarator" && node.id.type === "Identifier") {
            const constant = (node as Node & { readonly parent: ESTree.VariableDeclaration }).parent.kind === "const";
            const value = numberIn(node.init);

            if (constant && value !== null) {
              numbers.set(node.id.name, value);
            } else {
              others.add(node.id.name);
            }
          }
        }

        /** The count as written: a number, or a const that holds one. */
        const written = (value: Node): number | null =>
          numberIn(value) ??
          (value.type === "Identifier" && !others.has(value.name) ? (numbers.get(value.name) ?? null) : null);

        /** Whether the law around a count reaches real IO. */
        const held = (count: Node): boolean => {
          const around = [...ancestors(count)];
          const test = Arr.findLast(around, (node) => isTestCall(node));

          if (Option.isSome(test)) {
            return reaches(test.value);
          }

          // Outside a test call: the declarations around the count (`const CHECK = {...}`, a helper
          // function), or else the helper call it is handed to.
          const enclosing = Arr.filter([...declared], ([, node]) => around.includes(node));
          const call = Arr.findFirst(around, (node) => node.type === "CallExpression");
          const own =
            enclosing.length > 0 ? Arr.some(enclosing, ([, node]) => reaches(node)) : Option.exists(call, reaches);
          return (
            own ||
            Arr.some(
              tests,
              (call) => reaches(call) && Arr.some(enclosing, ([variable]) => usedThrough(call).has(variable)),
            )
          );
        };

        for (const node of nodes) {
          if (node.type !== "Property" || node.kind !== "init") {
            continue;
          }

          const name = keyName(node);
          const count = (name === "numRuns" && !isDraw(node)) || (name === "runs" && inArbitrary(node));

          const value = count ? written(node.value) : null;

          if (value !== null && held(node)) {
            context.report({ node: node.value, message: MESSAGE });
          }
        }
      },
    };
  },
};
