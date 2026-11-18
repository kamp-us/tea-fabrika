// Every law a pull request adds or changes names its plant, and a run row the pull request adds
// records that plant as red (0093, 0580). A law's plant is an option of its declaration on the
// package's `it` (`{ plant: "<the break>" }`), and its record is `{ file, law, plant, result }` in a
// run row's `plants`. It blocks (0580: "the check is red").
//
// It reads the changed law files (changes.mjs's `lawFile`) at the merge base and at head, parsed with
// oxc-parser, never a regex, and finds each call rooted at `it` or `test` as law-shape.ts does. A law
// is keyed by its file and its title with any old label prefix taken off, and it changed when it is
// new or its body differs as parsed code: positions, comments and source text are left out, and so
// are its options and the comments above it. So `pnpm format`, a comment, moving a plant from a
// comment to an option or a label from the title to an option changes no law. A file moved with
// `git mv` is paired with its old self by git's rename detection. Only files whose `it` comes from
// the package are held; a file still on `@effect/vitest` cannot take the option, so its changed laws
// get one notice and no refusal, until the sweep moves it. A row's record is unclaimed when its file
// is on the package's `it` at head, changed or not, and no changed law there names it; a record of a
// file the head no longer has is not read, since run rows are never edited after a rename.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { Effect, Exit, Option, Predicate, Schema } from "effect";
import { parseSync } from "oxc-parser";
import { lawFile, validSha } from "./changes.mjs";
import { Plant } from "./field-schema.ts";

/** The package whose `it` takes the `plant` option: `@kampus/vitest` now, `@kalfa/vitest` once renamed (0585). */
const OURS = new Set(["@kampus/vitest", "@kalfa/vitest"]);
/** Calls that make a test from their own call, as law-shape.ts reads them. */
const MAKERS = new Set(["each", "for", "skipIf", "runIf"]);
/** An old label at the head of a title, after one optional id (`R3 format: `), which 0580 moves to an option. */
const PREFIX = /^((?:[A-Za-z0-9.]+ )?)(?:vector|format|pinned|scenario|type):\s*/;

/** One law as declared: where, its title as written, its body as parsed code, and its plant option. */
export interface Law {
  readonly file: string;
  readonly line: number;
  readonly title: string;
  readonly body: string;
  readonly plant: string | null;
}

/** One law file on one side: whether its `it` is the package's, and its laws in source order. */
export interface LawFile {
  readonly file: string;
  readonly ours: boolean;
  readonly laws: readonly Law[];
}

/** A plant record from a run row the pull request adds, and that row's path. */
export type Recorded = Plant & { readonly row: string };

export type Refusal =
  | { readonly _tag: "no_plant"; readonly law: Law }
  | { readonly _tag: "not_recorded"; readonly law: Law }
  | { readonly _tag: "green"; readonly law: Law }
  | { readonly _tag: "unclaimed"; readonly row: string; readonly plant: Plant };

export interface Outcome {
  readonly refusals: readonly Refusal[];
  /** Files still on `@effect/vitest` or `vitest` whose laws changed: one notice each. */
  readonly notices: readonly string[];
}

type Node = { readonly type: string; readonly [key: string]: unknown };

const isNode = (value: unknown): value is Node =>
  Predicate.hasProperty(value, "type") && typeof value.type === "string";

/** Every node under `root`, itself included, in source order. */
const nodes = function* (root: unknown): Generator<Node> {
  if (Array.isArray(root)) {
    for (const item of root) {
      yield* nodes(item);
    }
  } else if (isNode(root)) {
    yield root;

    for (const [key, value] of Object.entries(root)) {
      if (key !== "type" && typeof value === "object" && value !== null) {
        yield* nodes(value);
      }
    }
  }
};

/** Whether `callee` is rooted at `it` or `test`, and the member names on the way: `["effect", "prop"]`. */
const chain = (callee: Node): readonly string[] | null => {
  const names: string[] = [];
  let at: Node = callee;

  for (;;) {
    if (at.type === "Identifier") {
      return at["name"] === "it" || at["name"] === "test" ? names : null;
    }

    const property = at["property"];
    const object = at["object"];

    if (at.type === "MemberExpression" && at["computed"] === false && isNode(property) && isNode(object)) {
      names.push(String(property["name"]));
      at = object;
      continue;
    }

    const inner = at["callee"];
    const made = isNode(inner) ? inner["property"] : undefined;

    if (at.type === "CallExpression" && isNode(inner) && isNode(made) && MAKERS.has(String(made["name"]))) {
      at = inner;
      continue;
    }

    return null;
  }
};

/** A string written out: a literal, or a template with no `${}`. */
const text = (node: unknown): string | null => {
  if (!isNode(node)) {
    return null;
  }

  if (node.type === "Literal" && typeof node["value"] === "string") {
    return node["value"];
  }

  const quasis = node["quasis"];
  const expressions = node["expressions"];

  if (node.type === "TemplateLiteral" && Array.isArray(expressions) && expressions.length === 0) {
    const cooked = Array.isArray(quasis) && isNode(quasis[0]) ? quasis[0]["value"] : undefined;
    return Predicate.hasProperty(cooked, "cooked") && typeof cooked.cooked === "string" ? cooked.cooked : null;
  }

  return null;
};

/** The tree as text with positions and source spellings dropped: two formattings of one code are equal. */
const shape = (tree: unknown) =>
  JSON.stringify(tree, (key, value: unknown) =>
    key === "start" || key === "end" || key === "range" || key === "loc" || key === "raw"
      ? undefined
      : typeof value === "bigint"
        ? String(value)
        : value,
  );

/** The `plant` key of an options object written at the call, when its value is written out. */
const plantOf = (options: Node | undefined): string | null => {
  for (const property of Array.isArray(options?.["properties"]) ? options["properties"] : []) {
    const key = isNode(property) ? property["key"] : undefined;

    if (
      isNode(property) &&
      isNode(key) &&
      property["computed"] === false &&
      (key["name"] ?? key["value"]) === "plant"
    ) {
      return text(property["value"]);
    }
  }

  return null;
};

/** The laws of one file, and whether its `it` is the package's. A file that does not parse holds none. */
export const lawsOf = (file: string, source: string): LawFile => {
  const parsed = parseSync(file, source, { sourceType: "module", preserveParens: false });
  const ours = parsed.program.body.some(
    (statement) =>
      statement.type === "ImportDeclaration" &&
      statement.importKind !== "type" &&
      OURS.has(statement.source.value) &&
      statement.specifiers.some(
        (spec) =>
          spec.type === "ImportSpecifier" &&
          spec.importKind !== "type" &&
          spec.imported.type === "Identifier" &&
          (spec.imported.name === "it" || spec.imported.name === "test"),
      ),
  );
  const laws: Law[] = [];

  for (const node of parsed.errors.length > 0 ? [] : nodes(parsed.program)) {
    const callee = node["callee"];
    const args = node["arguments"];

    if (node.type !== "CallExpression" || !isNode(callee) || !Array.isArray(args) || args.length < 2) {
      continue;
    }

    const names = chain(callee);
    const title = text(args[0]);

    if (names === null || names.includes("todo") || title === null) {
      continue;
    }

    const last: unknown = args.at(-1);
    const options = args.length >= 3 && isNode(last) && last.type === "ObjectExpression" ? last : undefined;
    const start = typeof node["start"] === "number" ? node["start"] : 0;
    laws.push({
      file,
      line: source.slice(0, start).split("\n").length,
      title,
      body: shape(options === undefined ? args.slice(1) : args.slice(1, -1)),
      plant: plantOf(options),
    });
  }

  return { file, ours, laws };
};

const keyOf = (law: Law) => `${law.file}\0${law.title.replace(PREFIX, "$1")}`;

/** The head laws that are new or whose body changed, each base body consumed once by its key. */
const changedLaws = (base: readonly LawFile[], head: LawFile): readonly Law[] => {
  const left = new Map<string, string[]>();

  for (const law of base.find((side) => side.file === head.file)?.laws ?? []) {
    left.set(keyOf(law), [...(left.get(keyOf(law)) ?? []), law.body]);
  }

  return head.laws.filter((law) => {
    const bodies = left.get(keyOf(law)) ?? [];
    const at = bodies.indexOf(law.body);

    if (at === -1) {
      return true;
    }

    bodies.splice(at, 1);
    return false;
  });
};

/**
 * What the check says of a pull request: its changed files on both sides, the base ones under their
 * head paths, and `untouched`, the head files outside the diff that an added row's record names.
 */
export const check = (
  input: {
    readonly base: readonly LawFile[];
    readonly head: readonly LawFile[];
    readonly untouched: readonly LawFile[];
  },
  rows: readonly Recorded[],
): Outcome => {
  const refusals: Refusal[] = [];
  const notices: string[] = [];
  const held: Law[] = [];

  for (const file of input.head) {
    const changed = changedLaws(input.base, file);

    if (!file.ours) {
      if (changed.length > 0) {
        notices.push(file.file);
      }

      continue;
    }

    for (const law of changed) {
      const records = rows.filter((r) => r.file === law.file && r.law === law.title && r.plant === law.plant);
      held.push(law);

      if (law.plant === null) {
        refusals.push({ _tag: "no_plant", law });
      } else if (records.length === 0) {
        refusals.push({ _tag: "not_recorded", law });
      } else if (!records.some((r) => r.result === "red")) {
        refusals.push({ _tag: "green", law });
      }
    }
  }

  // A record is held against every head file on the package's `it`, changed or not: a record of an
  // untouched file is unclaimed, since no changed law is there. A file still on another `it`, or one
  // the head no longer has (renamed or deleted after the row was written), is not read.
  const owned = new Set([...input.head, ...input.untouched].filter((file) => file.ours).map((file) => file.file));

  for (const { row, ...plant } of rows) {
    if (plant.file === undefined || !owned.has(plant.file)) {
      continue;
    }

    if (!held.some((law) => law.file === plant.file && law.title === plant.law && law.plant === plant.plant)) {
      refusals.push({ _tag: "unclaimed", row, plant });
    }
  }

  return { refusals, notices };
};

// GitHub annotation escaping applies to property values as well as message text.
const escape = (value: string) =>
  value
    .replaceAll("%", "%25")
    .replaceAll("\r", "%0D")
    .replaceAll("\n", "%0A")
    .replaceAll(":", "%3A")
    .replaceAll(",", "%2C");

const message = (refusal: Refusal): string => {
  switch (refusal._tag) {
    case "no_plant":
      return 'this law is new or changed and names no plant: give it the option { plant: "<the break>" } (0093, 0580)';
    case "not_recorded":
      return "the law's plant is not recorded red in a run row this pull request adds (0093, 0580)";
    case "green":
      return "a run row this pull request adds records the law's plant as green: the law did not catch its break (0093, 0580)";
    case "unclaimed":
      return `this row records a plant for "${refusal.plant.law}" in ${refusal.plant.file ?? ""}, and no law this pull request adds or changes names it (0093, 0580)`;
  }
};

/** The annotations to print, one per refusal and one per notice, and the exit code: 1 on any refusal. */
export const report = (outcome: Outcome): { readonly lines: readonly string[]; readonly exitCode: 0 | 1 } => ({
  lines: [
    ...outcome.refusals.map((r) =>
      r._tag === "unclaimed"
        ? `::error file=${escape(r.row)},line=1::${escape(message(r))}`
        : `::error file=${escape(r.law.file)},line=${r.law.line}::${escape(message(r))}`,
    ),
    ...outcome.notices.map(
      (file) =>
        `::notice file=${escape(file)}::${escape("this file's laws move to the package's it, which takes the plant option; until then they are not held (0580)")}`,
    ),
  ],
  exitCode: outcome.refusals.length > 0 ? 1 : 0,
});

type Runner = (args: string[]) => { status: number | null; stdout: string };
const git: Runner = (args) => spawnSync("git", args, { encoding: "utf8", maxBuffer: 2 ** 28 });

/** A run row's plant records, from its JSON text: none when the row does not parse, which field-check.ts reports. */
const decodePlants = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Struct({ plants: Schema.Array(Plant) })));

/**
 * The check's inputs from git: the changed law files on both sides, a renamed one's base read at its
 * old path, the plant records of the run rows the change adds, and each record's file outside the
 * diff that the head still has. A pull request starts at its merge
 * base, as field-check.ts reads it. Unreadable history is an error, never an empty input.
 */
export const readInputs = (base: string, head: string, event: string, run: Runner = git) => {
  const read = (args: string[]) => {
    const result = run(args);

    if (result.status !== 0) {
      throw new Error("plant check: Git could not read the requested history");
    }

    return result.stdout;
  };

  if (!validSha(base) || !validSha(head)) {
    throw new Error("plant check: valid base and head SHAs are required");
  }

  const from = event === "pull_request" ? read(["merge-base", base, head]).trim() : base;

  if (!validSha(from)) {
    throw new Error("plant check: the merge base could not be read");
  }

  const words = read(["diff", "-M", "--name-status", "-z", from, head, "--"]).split("\0");
  const changes: { status: string; old: string | null; path: string }[] = [];

  for (let at = 0; at < words.length - 1;) {
    const status = words[at] ?? "";
    const renamed = status.startsWith("R") || status.startsWith("C");
    const first = words[at + 1] ?? "";
    changes.push({
      status: status[0] ?? "",
      old: status.startsWith("R") ? first : null,
      path: renamed ? (words[at + 2] ?? "") : first,
    });
    at += renamed ? 3 : 2;
  }

  const live = changes.filter((c) => c.status !== "D");
  const laws = live.filter((c) => lawFile(c.path));
  const rows = live.filter((c) => c.status === "A" && /^field\/runs\/[^/]+\.json$/.test(c.path));
  const recorded = rows.flatMap((c) =>
    Option.match(decodePlants(read(["show", `${head}:${c.path}`])), {
      onNone: (): Recorded[] => [],
      onSome: ({ plants }) => plants.map((plant) => ({ ...plant, row: c.path })),
    }),
  );
  // A record's law file outside the diff is read at head when the head has it, so its `it` is known.
  const outside = new Set(
    recorded.flatMap((r) =>
      r.file === undefined || !lawFile(r.file) || laws.some((c) => c.path === r.file) ? [] : [r.file],
    ),
  );
  return {
    base: laws.flatMap((c) => (c.status === "A" ? [] : [lawsOf(c.path, read(["show", `${from}:${c.old ?? c.path}`]))])),
    head: laws.map((c) => lawsOf(c.path, read(["show", `${head}:${c.path}`]))),
    untouched: [...outside].flatMap((file) =>
      read(["ls-tree", "--name-only", head, "--", file]).split("\n").includes(file)
        ? [lawsOf(file, read(["show", `${head}:${file}`]))]
        : [],
    ),
    rows: recorded,
  };
};

/** Git history or a row that could not be read: the check did not finish, which is not a pass. */
class Unread extends Schema.TaggedError<Unread, { readonly brand: unique symbol }>()("Unread", {
  cause: Schema.Defect(),
}) {}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  // A history that cannot be read stops the check with exit 2, never an empty pass.
  const ran = Effect.runSync(
    Effect.exit(
      Effect.try({
        try: () => readInputs(process.env["BASE"] ?? "", process.env["HEAD"] ?? "", process.env["EVENT"] ?? ""),
        catch: (cause) => Unread.make({ cause }),
      }),
    ),
  );

  if (Exit.isSuccess(ran)) {
    const outcome = report(check(ran.value, ran.value.rows));

    for (const line of outcome.lines) {
      console.log(line);
    }

    console.log(`plant check: ${ran.value.head.length} law files read`);
    process.exitCode = outcome.exitCode;
  } else {
    console.error("plant check: history or input could not be read; the check did not finish");
    process.exitCode = 2;
  }
}
