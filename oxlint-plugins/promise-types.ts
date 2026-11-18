// `pnpm lint:promise-types`, the typed lint command. Oxlint's JS plugins have no type checker and
// `oxlint-tsgolint` is refused, so the checks that need types run here, on the installed TypeScript
// 7.0.2 API, in one snapshot that opens every `next/` project, without emitting code or type
// diagnostics. It holds three checks:
//
//   fabrika(no-promises)     the typed half of no-promises: a Promise outside one marked edge line.
//   fabrika(secret-types)    P12: a secret read (entropy, an Authorization header, a control binding's
//                            token) enters `Redacted` at its source.
//   fabrika(tsconfig-scope)  every TypeScript file of a `next/` package is in the program its
//                            `typecheck` script checks (0524: no list lets broken code pass).
//
// The secret and scope checks were the exam's (`secret-types.integration.test.ts` and
// `tsconfig-scope.integration.test.ts`) until 0591 made them part of this command; their planted
// laws are in `promise-types.test.ts`.
import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Effect, FileSystem, Path, Schema, Stream } from "effect";
import { ChildProcess } from "effect/process";
import * as ts from "typescript/unstable/ast";
import {
  API,
  SignatureKind,
  SymbolFlags,
  TypeFlags,
  type Project,
  type Snapshot,
  type Symbol,
  type Type,
} from "typescript/unstable/sync";

interface PromiseFinding {
  readonly file: string;
  readonly line: number;
  readonly reason: string;
}

export const checkPromiseTypes = (
  project: Project,
  root: string,
  pathService: Path.Path,
): readonly PromiseFinding[] => {
  const { checker, program } = project;
  const found = new Map<string, PromiseFinding>();
  const memo = new Map<number, boolean>();

  const carries = (type: Type | undefined, seen = new Set<number>()): boolean => {
    if (type === undefined || type.isErrorType()) {
      return false;
    }

    if (seen.has(type.id)) {
      return false;
    }

    const saved = memo.get(type.id);

    if (saved !== undefined) {
      return saved;
    }

    seen.add(type.id);
    const then = checker.getPropertyOfType(type, "then");
    const thenType = then === undefined ? undefined : checker.getTypeOfSymbol(then);

    const yes =
      type.isUnionType() || type.isIntersectionType()
        ? (type.getTypes() ?? []).some((t) => carries(t, seen))
        : (thenType !== undefined && checker.getSignaturesOfType(thenType, SignatureKind.Call).length > 0) ||
          checker
            .getSignaturesOfType(type, SignatureKind.Call)
            .some((signature) => carries(checker.getReturnTypeOfSignature(signature), seen));

    memo.set(type.id, yes);

    return yes;
  };

  const unwrap = (expression: ts.Expression): ts.Expression => {
    while (
      ts.isParenthesizedExpression(expression) ||
      ts.isNonNullExpression(expression) ||
      ts.isSatisfiesExpression(expression) ||
      ts.isAsExpression(expression) ||
      ts.isTypeAssertion(expression)
    ) {
      expression = expression.expression;
    }

    return expression;
  };

  const keyNames = (type: Type | undefined): readonly string[] | undefined => {
    if (type?.isStringLiteralType()) {
      return [type.value];
    }

    if (!type?.isUnionType()) {
      return undefined;
    }

    const names = type.getTypes().map(keyNames);

    return names.every((name) => name !== undefined) ? names.flat() : undefined;
  };

  const bridgeProperty = (
    object: ts.Expression,
    names: readonly string[] | undefined,
    seen: ReadonlySet<number>,
  ): boolean => {
    const type = checker.getTypeAtLocation(object);

    // A key that may select anything else cannot prove this is an Effect bridge.
    // Promise-typed values are still checked; untyped/never calls get no guess.
    return (
      type !== undefined &&
      names !== undefined &&
      names.length > 0 &&
      names.every((name) => bridgeSymbol(checker.getPropertyOfType(type, name), seen))
    );
  };

  const bridgeSymbol = (symbol: Symbol | undefined, seen: ReadonlySet<number>): boolean => {
    if (symbol === undefined) {
      return false;
    }

    const target = (symbol.flags & SymbolFlags.Alias) !== 0 ? checker.getAliasedSymbol(symbol) : symbol;

    if (seen.has(target.id)) {
      return false;
    }

    const visited = new Set([...seen, target.id]);

    if (
      ["tryPromise", "promise"].includes(target.name) &&
      target.declarations.some((declaration) =>
        // TypeScript folds path case on case-insensitive file systems.
        /(?:^|\/)node_modules\/effect\/(?:dist\/Effect\.d\.ts|src\/Effect\.ts)$/i.test(
          declaration.path.replaceAll("\\", "/"),
        ),
      )
    ) {
      return true;
    }

    const declaration = target.valueDeclaration?.resolve();

    if (
      declaration !== undefined &&
      ts.isVariableDeclaration(declaration) &&
      ts.isVariableDeclarationList(declaration.parent) &&
      (declaration.parent.flags & ts.NodeFlags.Const) !== 0 &&
      declaration.initializer !== undefined
    ) {
      return isPromiseBridge(declaration.initializer, visited);
    }

    if (
      declaration !== undefined &&
      ts.isBindingElement(declaration) &&
      ts.isObjectBindingPattern(declaration.parent) &&
      ts.isVariableDeclaration(declaration.parent.parent)
    ) {
      const binding = declaration.parent.parent;
      const name = declaration.propertyName ?? declaration.name;

      if (
        binding.initializer !== undefined &&
        ts.isVariableDeclarationList(binding.parent) &&
        (binding.parent.flags & ts.NodeFlags.Const) !== 0 &&
        name !== undefined
      ) {
        return bridgeProperty(
          binding.initializer,
          ts.isIdentifier(name) || ts.isStringLiteral(name)
            ? [name.text]
            : ts.isComputedPropertyName(name)
              ? keyNames(checker.getTypeAtLocation(name.expression))
              : undefined,
          visited,
        );
      }
    }

    return false;
  };

  const isPromiseBridge = (expression: ts.Expression, seen: ReadonlySet<number> = new Set()): boolean => {
    const callee = unwrap(expression);

    if (ts.isElementAccessExpression(callee)) {
      return bridgeProperty(callee.expression, keyNames(checker.getTypeAtLocation(callee.argumentExpression)), seen);
    }

    return bridgeSymbol(
      checker.getSymbolAtLocation(ts.isPropertyAccessExpression(callee) ? callee.name : callee),
      seen,
    );
  };

  for (const path of program.getSourceFileNames()) {
    const file = pathService.relative(root, path).replaceAll("\\", "/");

    if (!file.startsWith("next/") || file.includes("node_modules/") || /\.(?:test|test-support|d)\.tsx?$/.test(file)) {
      continue;
    }

    const source = program.getSourceFile(path);

    if (source === undefined) {
      throw new Error(`Cannot read ${file}`);
    }

    const candidates = new Map<ts.Node, string>();
    const promiseInputs = new Set<ts.Node>();

    const visit = (node: ts.Node, inPromise = false): void => {
      if (inPromise) {
        promiseInputs.add(node);
      }

      const bridge = ts.isCallExpression(node) && isPromiseBridge(node.expression);

      if (ts.isCallExpression(node)) {
        candidates.set(node, "call returns a Promise or a Promise thunk");

        for (const argument of node.arguments) {
          candidates.set(argument, "call passes a Promise or a Promise thunk");
        }
      }

      if (
        (ts.isFunctionDeclaration(node) ||
          ts.isFunctionExpression(node) ||
          ts.isArrowFunction(node) ||
          ts.isMethodDeclaration(node) ||
          ts.isGetAccessorDeclaration(node) ||
          ts.isSetAccessorDeclaration(node) ||
          ts.isConstructorDeclaration(node)) &&
        node.body !== undefined
      ) {
        for (const parameter of node.parameters) {
          candidates.set(parameter.name, "function takes a Promise or a Promise thunk");
        }
      }

      if (ts.isReturnStatement(node) && node.expression !== undefined) {
        candidates.set(node.expression, "function returns a Promise or a Promise thunk");
      }

      if (ts.isArrowFunction(node) && !ts.isBlock(node.body)) {
        candidates.set(node.body, "function returns a Promise or a Promise thunk");
      }

      node.forEachChild((child) => visit(child, inPromise || (bridge && node.arguments.some((arg) => arg === child))));
    };

    visit(source);
    const nodes = [...candidates.keys()];
    const types = checker.getTypeAtLocation(nodes);
    const lines = source.text.split("\n");

    const marked = (line: number): boolean => {
      // A marker covers only the next physical line, even inside a wrapped statement.
      const edge = /^\s*\/\/ oxlint-disable-next-line (.+?) -- edge: \S/.exec(lines[line - 1] ?? "");
      const rules = new Set(edge?.[1]?.split(/[,\s]+/));

      // Oxlint separately checks that each comment is used.
      return rules.has("fabrika/no-promises") || rules.has("fabrika/no-effect-run-outside-edge");
    };

    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];

      if (node === undefined) {
        throw new Error("Missing Promise candidate");
      }

      const type = types[i];

      // Workers RPC can resolve to never. Only Effect's own Promise inputs provide
      // evidence that an untyped call needs an edge; ordinary throw helpers do not.
      const unresolved =
        ts.isCallExpression(node) &&
        promiseInputs.has(node) &&
        (type === undefined ||
          type.isErrorType() ||
          (type.flags &
            (TypeFlags.Any |
              TypeFlags.Unknown |
              TypeFlags.Never |
              TypeFlags.TypeParameter |
              TypeFlags.Conditional |
              TypeFlags.IndexedAccess |
              TypeFlags.Substitution)) !==
            0);

      if (!carries(type) && !unresolved) {
        continue;
      }

      const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line;

      if (marked(line)) {
        continue;
      }

      found.set(`${file}:${line + 1}`, {
        file,
        line: line + 1,
        reason: unresolved
          ? "Promise input has a type the check cannot resolve"
          : (candidates.get(node) ?? "Promise value outside a marked edge"),
      });
    }
  }

  return [...found.values()].sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
};

/** A secret read outside `Redacted`, as the checker sees its type. */
interface SecretFinding {
  readonly file: string;
  readonly line: number;
  readonly reason: string;
}

/**
 * P12's type proof at the three secret sources the whole-change sweep found: a `randomBytes` call,
 * an Authorization header read and a control binding's `props.token`. A read passes when it, or an
 * expression around it inside its statement, has a type that carries `~effect/Redacted`. This reads
 * types, not spellings of `Redacted.make` or a particular helper's name.
 */
export const checkSecretTypes = (project: Project, root: string, pathService: Path.Path): readonly SecretFinding[] => {
  const { program, checker } = project;
  const findings: Array<SecretFinding> = [];

  for (const path of program.getSourceFileNames()) {
    const file = pathService.relative(root, path).replaceAll("\\", "/");

    if (!file.startsWith("next/") || /\/(?:exam|e2e)\//.test(file) || /\.(?:test|test-support|d)\.tsx?$/.test(file)) {
      continue;
    }

    const source = program.getSourceFile(path);

    if (!source) {
      continue;
    }

    const entropy = new Set<string>();

    for (const statement of source.statements) {
      if (
        !ts.isImportDeclaration(statement) ||
        !ts.isStringLiteral(statement.moduleSpecifier) ||
        !["node:crypto", "crypto"].includes(statement.moduleSpecifier.text)
      ) {
        continue;
      }

      const bindings = statement.importClause?.namedBindings;

      if (bindings && ts.isNamedImports(bindings)) {
        for (const spec of bindings.elements) {
          if ((spec.propertyName ?? spec.name).text === "randomBytes") {
            entropy.add(spec.name.text);
          }
        }
      }
    }

    const reads: Array<{ node: ts.Node; reason: string; ancestors: Array<ts.Node> }> = [];

    const visit = (node: ts.Node): void => {
      let reason: string | undefined;

      if (ts.isCallExpression(node)) {
        const argument = node.arguments[0];

        if (ts.isIdentifier(node.expression) && entropy.has(node.expression.text)) {
          reason = "random secret";
        }

        if (
          ts.isPropertyAccessExpression(node.expression) &&
          node.expression.name.text === "get" &&
          argument !== undefined &&
          ts.isStringLiteral(argument) &&
          argument.text.toLowerCase() === "authorization"
        ) {
          reason = "Authorization read";
        }
      }

      if (
        ts.isPropertyAccessExpression(node) &&
        node.name.text === "token" &&
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === "props"
      ) {
        reason = "control binding read";
      }

      if (reason) {
        const ancestors: Array<ts.Node> = [];

        for (let parent: ts.Node = node; !ts.isStatement(parent); parent = parent.parent) {
          ancestors.push(ts.isVariableDeclaration(parent) ? parent.name : parent);

          if (parent === source) {
            break;
          }
        }

        reads.push({ node, reason, ancestors });
      }

      node.forEachChild(visit);
    };

    visit(source);
    const nodes = reads.flatMap((read) => read.ancestors);
    const types = checker.getTypeAtLocation(nodes);
    let index = 0;

    for (const read of reads) {
      const protectedRead = read.ancestors
        .map(() => types[index++])
        .some((type) => type !== undefined && checker.getPropertyOfType(type, "~effect/Redacted") !== undefined);

      if (!protectedRead) {
        findings.push({
          file,
          line: source.getLineAndCharacterOfPosition(read.node.getStart(source)).line + 1,
          reason: `${read.reason} must enter Redacted at its source`,
        });
      }
    }
  }

  return findings;
};

/** The one script each `next/` package's `typecheck` runs, so the tsconfig opened here is the one checked. */
const TYPECHECK = "tsc --noEmit -p .";

const TYPESCRIPT = /\.(?:ts|tsx|mts|cts)$/;

/** A `next/<group>/<name>` folder that holds a package manifest, with its `typecheck` script. */
interface NextPackage {
  readonly dir: string;
  readonly typecheck: string | undefined;
}

const Manifest = Schema.Struct({ scripts: Schema.optional(Schema.Record(Schema.String, Schema.String)) });

const readManifest = Schema.decodeUnknownEffect(Schema.fromJsonString(Manifest));

/** Every `next/**` `tsconfig.json` under `root`, as absolute paths: the projects this command opens. */
export const typedProjects = Effect.fnUntraced(function* (root: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  return (yield* fs.glob("next/**/tsconfig.json", { root, exclude: ["**/node_modules/**"] }))
    .filter((file) => !file.includes("node_modules/"))
    .sort()
    .map((file) => path.join(root, file));
});

/** Every `next/<group>/<name>` folder under `root` that holds a package manifest. */
export const nextPackages = Effect.fnUntraced(function* (root: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const found: Array<NextPackage> = [];

  for (const group of (yield* fs.readDirectory(path.join(root, "next"))).sort()) {
    const groupDir = path.join(root, "next", group);

    if ((yield* fs.stat(groupDir)).type !== "Directory") {
      continue;
    }

    for (const name of (yield* fs.readDirectory(groupDir)).sort()) {
      const manifest = path.join(groupDir, name, "package.json");

      if (!(yield* fs.exists(manifest))) {
        continue;
      }

      const { scripts } = yield* readManifest(yield* fs.readFileString(manifest));
      found.push({ dir: `next/${group}/${name}`, typecheck: scripts?.["typecheck"] });
    }
  }

  return found;
});

/** What is wrong with a file of the tsconfig scope, as the command prints it. */
const SCOPE_REASONS = {
  script: `its typecheck script is not "${TYPECHECK}"`,
  stray: "the file sits in no next/ package, so no typecheck checks it",
  outside: "the file is not in the program its package's tsconfig.json checks",
} as const;

/** A tsconfig-scope fault: the file, and which of the three it is. */
interface ScopeFinding {
  readonly file: string;
  readonly reason: keyof typeof SCOPE_REASONS;
}

/**
 * Every fault of the tsconfig scope under `root`: a package whose `typecheck` is not the one script,
 * a tracked TypeScript file (repo-relative, from `tracked`) in no package, and one its package's own
 * `tsconfig.json` program does not hold. A package whose project the snapshot did not open reports
 * every file it has, never none.
 */
export const scopeGaps = (
  snapshot: Snapshot,
  root: string,
  packages: ReadonlyArray<NextPackage>,
  tracked: ReadonlyArray<string>,
  pathService: Path.Path,
): readonly ScopeFinding[] => [
  ...packages
    .filter((p) => p.typecheck !== TYPECHECK)
    .map((p) => ({ file: `${p.dir}/package.json`, reason: "script" as const })),
  ...tracked
    .filter((f) => !packages.some((p) => f.startsWith(`${p.dir}/`)))
    .map((file) => ({ file, reason: "stray" as const })),
  ...packages.flatMap((p) => {
    const project = snapshot.getProject(pathService.join(root, p.dir, "tsconfig.json"));
    const held = new Set(project?.program.getSourceFileNames().map((f) => pathService.relative(root, f)) ?? []);

    return tracked
      .filter((f) => f.startsWith(`${p.dir}/`) && !held.has(f))
      .map((file) => ({ file, reason: "outside" as const }));
  }),
];

/** `git ls-files` exited with a code other than 0. */
class GitFailed extends Schema.TaggedError<GitFailed, { readonly brand: unique symbol }>()("GitFailed", {
  code: Schema.Finite,
}) {}

/** Every TypeScript file git tracks under `next/`, or would track: untracked files not ignored count too. */
const trackedTypeScript = Effect.fnUntraced(function* (root: string) {
  const run = yield* ChildProcess.make(
    "git",
    ["ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", "next/"],
    { cwd: root },
  );

  const [out, code] = yield* Effect.all([run.stdout.pipe(Stream.decodeText(), Stream.mkString), run.exitCode], {
    concurrency: 2,
  });

  if (code !== 0) {
    return yield* GitFailed.make({ code });
  }

  return out.split("\0").filter((f) => TYPESCRIPT.test(f));
}, Effect.scoped);

const main = Effect.gen(function* () {
  const path = yield* Path.Path;
  const fs = yield* FileSystem.FileSystem;
  // The real path, so a linked checkout compares equal to the program's file names.
  const root = yield* fs.realPath(path.resolve(import.meta.dirname, ".."));
  const configs = yield* typedProjects(root);
  const packages = yield* nextPackages(root);
  const tracked = yield* trackedTypeScript(root);
  const api = new API({ cwd: root });

  try {
    const snapshot = api.updateSnapshot({ openProjects: configs });

    try {
      const lines = new Map<string, string>();

      for (const project of snapshot.getProjects()) {
        for (const f of checkPromiseTypes(project, root, path)) {
          lines.set(`${f.file}:${f.line} no-promises`, `${f.file}:${f.line} fabrika(no-promises): ${f.reason}`);
        }

        for (const f of checkSecretTypes(project, root, path)) {
          lines.set(`${f.file}:${f.line} secret-types`, `${f.file}:${f.line} fabrika(secret-types): ${f.reason}`);
        }
      }

      for (const f of scopeGaps(snapshot, root, packages, tracked, path)) {
        lines.set(`${f.file} tsconfig-scope`, `${f.file} fabrika(tsconfig-scope): ${SCOPE_REASONS[f.reason]}`);
      }

      for (const line of lines.values()) {
        console.error(line);
      }

      console.info(`lint:promise-types: ${lines.size} findings`);
      process.exitCode = lines.size === 0 ? 0 : 1;
    } finally {
      snapshot.dispose();
    }
  } finally {
    api.close();
  }
});

if (import.meta.main) {
  NodeRuntime.runMain(main.pipe(Effect.provide(NodeServices.layer)));
}
