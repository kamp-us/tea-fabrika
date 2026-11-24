// What the laws of the command (run.test.ts) share: drawn seeds, texts of every class the readable line must escape, an
// independent model of the escape and of each line the command prints, a repo held in memory behind `Packages`, the
// subcommands a drawn repo holds, a recording tracer, and one function that runs `main` and reads everything it did.
// Each law applies every class to each seed it draws, so each class a law must reach is in every run, and no run can pass
// on less.
import { NodeServices } from "@effect/platform-node";
import * as Diagnostic from "@kalfa/diagnostics/Diagnostic";
import * as Diagnostics from "@kalfa/diagnostics/Diagnostics";
import {
  Arbitrary,
  Cause,
  Console,
  Data,
  Effect,
  Exit,
  FileSystem,
  Layer,
  Option,
  Path,
  Predicate,
  Ref,
  Result,
  Schema,
  Tracer,
} from "effect";
import { Argument, CliError, Command, Flag } from "effect/cli";
import { TestConsole } from "effect/testing";
import { Refused } from "./internal/failure.ts";
import { Packages, Unloaded } from "./internal/packages.ts";
import { main } from "./internal/run.ts";
import { platform, Probe } from "./Subcommand.test-support.ts";
import * as Subcommand from "./Subcommand.ts";

export { platform, Probe };

/** The shared seed: a fixed seed makes a red run repeat. */
export const SEED = 119120;

// ---- the small tools the generators are built from

const pattern = (form: RegExp): Arbitrary.Arbitrary<string> =>
  Arbitrary.schema(Schema.String.check(Schema.isPattern(form)));

/** A whole number from `minimum` to `maximum`. */
const between = (minimum: number, maximum: number): Arbitrary.Arbitrary<number> =>
  Arbitrary.schema(Schema.Int.check(Schema.isBetween({ minimum, maximum })));

/** The item a drawn number points at, round and round. */
export const at = <A>(items: ReadonlyArray<A>, index: number): A => {
  const found = items[index % items.length];

  if (found === undefined) {
    throw new Error("a pick from an empty list");
  }

  return found;
};

// ---- texts

/** The code points of a class, in order. A lone surrogate is not a character a regex can test alone, so it is a range. */
const points = (test: (character: string) => boolean): ReadonlyArray<number> => {
  const found: Array<number> = [];

  for (let point = 0; point <= 0x10ffff; point++) {
    if (point >= 0xd800 && point <= 0xdfff) {
      continue;
    }

    if (test(String.fromCodePoint(point))) {
      found.push(point);
    }
  }

  return found;
};

const range = (first: number, last: number): ReadonlyArray<number> =>
  Array.from({ length: last - first + 1 }, (_, index) => first + index);

/**
 * Each class of character a printed line must treat on its own, as the Unicode property names it, so a class holds every
 * one of its members and no hand-picked few. The first five are written as an escape; the last two never are.
 */
const KINDS: Record<Kind, ReadonlyArray<number>> = {
  control: points((character) => /^\p{Cc}$/u.test(character)),
  format: points((character) => /^\p{Cf}$/u.test(character)),
  surrogate: range(0xd800, 0xdfff),
  separator: [0x2028, 0x2029],
  backslash: [0x5c],
  wide: [...range(0x4e00, 0x9fff), ...range(0x1f300, 0x1f64f)],
};

/** The classes, in order. */
const KIND_IDS = ["control", "format", "surrogate", "separator", "backslash", "wide"] as const;

type Kind = (typeof KIND_IDS)[number];

const ESCAPED_KINDS: ReadonlyArray<Kind> = ["control", "format", "surrogate", "separator", "backslash"];

const ESCAPED = new Set<number>(ESCAPED_KINDS.flatMap((kind) => KINDS[kind]));

/** What a text is drawn from: a plain word to start it, a plain tail, and a number that picks a member of each class. */
interface TextSeed {
  readonly head: string;
  readonly tail: string;
  readonly pick: number;
}

const textSeed: Arbitrary.Arbitrary<TextSeed> = Arbitrary.all({
  head: pattern(/^[a-z]{1,6}$/),
  tail: pattern(/^[a-z]{0,6}$/),
  pick: between(0, 1_000_000),
});

const member = (kind: Kind, pick: number): string => String.fromCodePoint(at(KINDS[kind], pick));

/** One text for each class, from one seed: plain, one member of each class, a line break pair, and every class at once. */
export const textVariants = (seed: TextSeed, only: ReadonlyArray<Kind> = KIND_IDS) => {
  const withKind = (kind: Kind) => ({
    id: kind,
    text: `${seed.head}${member(kind, seed.pick)}${seed.tail}`,
  });

  return [
    { id: "plain", text: `${seed.head} ${seed.tail}` },
    ...only.map(withKind),
    // A carriage return and a line feed, and a lone carriage return: members of the control class in the order a text uses them.
    { id: "crlf", text: `${seed.head}\r\n${seed.tail}` },
    {
      id: "mixed",
      text: only.map((kind) => `${seed.head}${member(kind, seed.pick)}`).join("") + seed.tail,
    },
  ];
};

/** Every class id `textVariants` gives when it is not narrowed. */
export const TEXT_IDS: ReadonlyArray<string> = ["plain", ...KIND_IDS, "crlf", "mixed"];

// ---- the escape, written a second way

const SHORT: Readonly<Record<string, string>> = {
  "\b": "\\b",
  "\t": "\\t",
  "\n": "\\n",
  "\f": "\\f",
  "\r": "\\r",
  "\\": "\\\\",
};

const hex = (unit: number): string => `\\u${unit.toString(16).padStart(4, "0")}`;

/**
 * The escape by the plan's rule: a character of the five classes is written as JSON writes it (`\n`, `\t`, `\u001b`, a
 * lone surrogate as `\ud800`), one code unit at a time, and a backslash is written `\\`. Judged by the class tables
 * above, label the product holds one pattern.
 */
const modelEscape = (text: string): string =>
  [...text]
    .map((character) => {
      const point = character.codePointAt(0) ?? 0;

      if (!ESCAPED.has(point)) {
        return character;
      }

      return (
        SHORT[character] ??
        Array.from({ length: character.length }, (_, unit) => hex(character.charCodeAt(unit))).join("")
      );
    })
    .join("");

/** Undoes `modelEscape`: a backslash and one of `bfnrt\` or `u` and four hex digits is the character it names. */
export const unescape = (text: string): string =>
  text.replace(/\\(?:u([0-9a-f]{4})|([bfnrt\\]))/g, (_, digits: string | undefined, short: string | undefined) => {
    if (digits !== undefined) {
      return String.fromCharCode(Number.parseInt(digits, 16));
    }

    const found = Object.entries(SHORT).find(([, written]) => written === `\\${short}`);

    return found?.[0] ?? "";
  });

/** True when a line holds a character of the classes a line must never hold raw. */
export const holdsRaw = (line: string): boolean =>
  [...line].some((character) => ESCAPED.has(character.codePointAt(0) ?? 0) && character !== "\\");

// ---- reports

/** One report a handler makes, in the fields `Diagnostics.report` takes. */
export interface ReportSpec {
  readonly severity: "error" | "warning";
  readonly message: string;
  readonly hint: string;
  readonly place: Diagnostic.Place;
}

/** The line the command prints for a report under a code, written apart from the code that prints it. */
export const modelLine = (code: string, report: ReportSpec): string =>
  `${modelEscape(Diagnostic.formatPlace(report.place))}: ${report.severity} ${code}: ${modelEscape(report.message)} Hint: ${modelEscape(report.hint)}`;

/** A message that failed a run: the line the command prints for it. */
export const modelFailure = (message: string): string => `kalfa: ${modelEscape(message)}`;

// A path part that is plain, then the same part with a member of a class put in. A repo path holds no backslash.
const placeKinds: ReadonlyArray<Kind> = ["control", "format", "surrogate", "separator", "wide"];

/** A place whose path holds one text class, or a plain one when no path can hold it (a repo path holds no backslash). */
export const placeWith = (seed: TextSeed, id: string): Diagnostic.Place => {
  const found =
    textVariants(seed, placeKinds).find((variant) => variant.id === id) ?? textVariants(seed, placeKinds)[0];

  return Diagnostic.Place.cases.repo.make({ path: `src/${found?.text ?? "x"}`, line: (seed.pick % 90) + 1 });
};

/** The places a seed makes, one of each kind, the two with paths carrying a member of each class in turn. */
export const drawPlaces = (seed: TextSeed): ReadonlyArray<Diagnostic.Place> => {
  const parts = textVariants(seed, placeKinds).map(({ text }) => text);

  return [
    ...parts.flatMap((part) => [
      Diagnostic.Place.cases.repo.make({ path: `src/${part}`, line: (seed.pick % 90) + 1 }),
      Diagnostic.Place.cases.repo.make({ path: part, line: 3, column: (seed.pick % 7) + 1 }),
      Diagnostic.Place.cases.home.make({ path: `~/${part}` }),
      Diagnostic.Place.cases.home.make({ path: `$HOME/${part}`, line: 2 }),
    ]),
    Diagnostic.Place.cases.repo.make({ path: "." }),
    Diagnostic.Place.cases.environment.make({ name: `KALFA_${seed.head.toUpperCase()}` }),
    Diagnostic.Place.cases.flag.make({ name: `--${seed.head}` }),
  ];
};

// ---- what a handler does

/** What a handler may stop with: a failure that carries a message, or a value that carries none. */
export type Stop = Broken | Error | { readonly code: number } | { readonly message: number } | string | number | null;

/** A failure that carries a message, as a tagged error does. */
export class Broken extends Schema.TaggedError<Broken, { readonly brand: unique symbol }>()("Broken", {
  message: Schema.String,
}) {}

/** One step of a handler, in the order it runs. */
export type Step = Data.TaggedEnum<{
  Log: { readonly text: string };
  Report: { readonly name: string; readonly report: ReportSpec };
  Probe: Record<never, never>;
  Resolve: { readonly segments: ReadonlyArray<string> };
  Fail: { readonly value: Stop };
  Die: { readonly value: Stop };
  Interrupt: Record<never, never>;
}>;

export const Step = Data.taggedEnum<Step>();

/** What a handler counted: how many times its steps ran from the start. */
export type Ran = Ref.Ref<number>;

const interpret = Effect.fn("handler.act")(function* (
  steps: ReadonlyArray<Step>,
  codes: ReadonlyMap<string, Diagnostic.Declared>,
  ran: Ran,
) {
  yield* Ref.update(ran, (count) => count + 1);

  yield* Effect.forEach(
    steps,
    (step) =>
      Step.$match(step, {
        Log: ({ text }) => Console.log(text),
        Report: ({ name, report }) => {
          const declared = codes.get(name);

          return declared === undefined
            ? Effect.die(`a script reports a code its subcommand did not declare: ${name}`)
            : Diagnostics.report(declared, report);
        },
        Probe: () => Effect.flatMap(Probe, (probe) => Console.log(probe.value)),
        Resolve: ({ segments }) => Effect.flatMap(Path.Path, (path) => Console.log(path.resolve(...segments))),
        Fail: ({ value }) => Effect.fail(value),
        Die: ({ value }) => Effect.die(value),
        Interrupt: () => Effect.interrupt,
      }),
    { concurrency: 1, discard: true },
  );
});

/** What a subcommand is made of: its root name, its `act` script, the codes it declares and the value its Layer gives. */
export interface SubcommandSpec {
  readonly root: string;
  readonly script: ReadonlyArray<Step>;
  readonly codes: ReadonlyArray<string>;
  readonly probe: string;
}

/**
 * The subcommand a spec stands for: `<root> act` runs the script, taking one optional flag `--label` and one optional
 * argument; `<root> need` takes one required argument; `<root> bare` is a command with no handler of its own below it.
 */
export const buildSubcommand = (spec: SubcommandSpec, ran: Ran): Subcommand.Subcommand => {
  const declared = spec.codes.map((code) => Diagnostic.make(code, { explain: "A code made to fill a list." }));
  const byName = new Map(declared.map((one): [string, Diagnostic.Declared] => [one.code, one]));

  const act = Command.make(
    "act",
    { label: Flag.optional(Flag.String("label")), target: Argument.optional(Argument.String("target")) },
    () => interpret(spec.script, byName, ran),
  );

  const need = Command.make("need", { file: Argument.String("file") }, () => Effect.void);

  return Subcommand.make(Command.make(spec.root).pipe(Command.withSubcommands([act, need])), {
    layer: Layer.succeed(Probe, { value: spec.probe }),
    diagnostics: declared,
  });
};

// ---- a repo in memory

/** What an entry point is when `kalfa` loads it. */
export type Entry = Data.TaggedEnum<{
  Module: { readonly exports: Record<string, unknown> };
  NoDefault: Record<never, never>;
  Throws: Record<never, never>;
}>;

export const Entry = Data.taggedEnum<Entry>();

/** A repo: its folder, its root manifest's text (none when there is no file), each installed manifest, each entry. */
export interface Repo {
  readonly folder: string;
  readonly root: string | undefined;
  readonly installed: Readonly<Record<string, string>>;
  readonly entries: Readonly<Record<string, Entry>>;
}

/** What the stand-in saw `kalfa` ask of it, in order. */
export type Call = Data.TaggedEnum<{
  Read: { readonly name: string };
  Load: { readonly pkg: string; readonly specifier: string };
}>;

export const Call = Data.taggedEnum<Call>();

/** The specifier for a package and the subpath its field names, as Node would be asked for it. */
export const toSpecifier = (name: string, subpath: string): string =>
  subpath === "." ? name : `${name}/${subpath.slice(2)}`;

/**
 * `Packages` on a repo in memory. A resolve that refuses and an import that throws are what Node gives, so the stand-in
 * fails as `layerNode` does: with an `Unloaded` that holds only its reason. The field and the subpath are put to it by `load.ts`.
 */
const standIn = (repo: Repo): { readonly layer: Layer.Layer<Packages>; readonly calls: Array<Call> } => {
  const calls: Array<Call> = [];

  const layer = Layer.succeed(Packages, {
    folder: repo.folder,
    root:
      repo.root === undefined
        ? Effect.fail(new Refused({ reason: "no-manifest", packages: [] }))
        : Effect.succeed(repo.root),
    manifest: (name) =>
      Effect.sync(() => {
        calls.push(Call.Read({ name }));

        return Option.fromNullishOr(Object.hasOwn(repo.installed, name) ? repo.installed[name] : undefined);
      }),
    load: (pkg, specifier) =>
      Effect.suspend(() => {
        calls.push(Call.Load({ pkg, specifier }));

        const entry = Object.hasOwn(repo.entries, specifier) ? repo.entries[specifier] : undefined;

        return entry === undefined
          ? Effect.fail(new Unloaded({ reason: "load" }))
          : Entry.$match(entry, {
              Module: ({ exports }) => Effect.succeed(exports),
              NoDefault: () => Effect.fail(new Unloaded({ reason: "not-exported" })),
              Throws: () => Effect.fail(new Unloaded({ reason: "load" })),
            });
      }),
  });

  return { layer, calls };
};

// ---- a recording tracer

/** A span as the tracer saw it: its name, attributes, events, parent and whether it ended. */
interface SpanRecord {
  readonly name: string;
  readonly spanId: string;
  readonly parent: string | undefined;
  readonly attributes: ReadonlyMap<string, unknown>;
  readonly events: ReadonlyArray<{ readonly name: string; readonly attributes: Record<string, unknown> | undefined }>;
  readonly ended: boolean;
}

/** A tracer that keeps every span it makes, modeled on the one the Door's span laws use. */
const recording = () => {
  const made: Array<Tracer.NativeSpan> = [];

  const tracer = Tracer.make({
    span(options) {
      const span = new Tracer.NativeSpan(options);

      made.push(span);

      return span;
    },
  });

  const spans = (): ReadonlyArray<SpanRecord> =>
    made.map((span) => ({
      name: span.name,
      spanId: span.spanId,
      parent: Option.getOrUndefined(Option.map(span.parent, (found) => found.spanId)),
      attributes: span.attributes,
      events: span.events.map(([name, , attributes]) => ({ name, attributes })),
      ended: Predicate.isTagged(span.status, "Ended"),
    }));

  return { tracer, spans };
};

/** Every span between a span and the root, nearest first. */
export const ancestors = (spans: ReadonlyArray<SpanRecord>, span: SpanRecord): ReadonlyArray<SpanRecord> => {
  const found: Array<SpanRecord> = [];
  let next = span.parent;

  while (next !== undefined) {
    const parent = spans.find((candidate) => candidate.spanId === next);

    if (parent === undefined) {
      break;
    }

    found.push(parent);
    next = parent.parent;
  }

  return found;
};

// ---- running the command

/** What one run of `main` did. */
export interface Run {
  readonly code: 0 | 1 | 2;
  /** Each text written to standard output, in order. */
  readonly out: ReadonlyArray<string>;
  /** Each text written to standard error, in order. */
  readonly err: ReadonlyArray<string>;
  readonly calls: ReadonlyArray<Call>;
  readonly spans: ReadonlyArray<SpanRecord>;
}

/** Runs `main` on a repo, under the recording tracer, and reads what it wrote and asked for. */
export const runOn = (repo: Repo, args: ReadonlyArray<string>, environment: Layer.Layer<never> = Layer.empty) =>
  Effect.gen(function* () {
    const world = standIn(repo);
    const tracer = recording();
    const outBefore = (yield* TestConsole.logLines).length;
    const errBefore = (yield* TestConsole.errorLines).length;

    const code = yield* main(args).pipe(
      Effect.provide(Layer.mergeAll(world.layer, platform, environment)),
      Effect.withTracer(tracer.tracer),
    );

    const lines = (all: ReadonlyArray<unknown>, before: number) => all.slice(before).map(String);

    return {
      code,
      out: lines(yield* TestConsole.logLines, outBefore),
      err: lines(yield* TestConsole.errorLines, errBefore),
      calls: world.calls,
      spans: tracer.spans(),
    } satisfies Run;
  });

// ---- dependencies and repos

type List = "dependencies" | "devDependencies" | "optionalDependencies";

export const LISTS: ReadonlyArray<List> = ["dependencies", "devDependencies", "optionalDependencies"];

/** One dependency of a repo: what its manifest says, label it is listed, whether it is installed and what its entry is. */
export interface Dep {
  readonly name: string;
  readonly lists: ReadonlyArray<List>;
  readonly installed: boolean;
  /** The `kalfa` field of its manifest as a JSON value; `undefined` leaves the key out. */
  readonly kalfa?: unknown;
  /** Its manifest as text, instead of the one made from its parts. */
  readonly text?: string;
  /** The packages its own manifest lists as dependencies. */
  readonly own?: ReadonlyArray<string>;
  /** What the specifier of its `kalfa.cli` field gives. */
  readonly entry?: Entry;
}

/** The repo these dependencies make. `lists` names the lists the root manifest has, even when empty. */
export const buildRepo = (
  folder: string,
  deps: ReadonlyArray<Dep>,
  options: {
    readonly keep?: ReadonlyArray<List>;
    readonly root?: string | undefined;
    readonly extra?: Record<string, Entry>;
  } = {},
): Repo => {
  const listed = (list: List): Record<string, string> =>
    Object.fromEntries(deps.filter((dep) => dep.lists.includes(list)).map((dep) => [dep.name, "1.0.0"]));

  const lists = Object.fromEntries(
    LISTS.map((list) => [list, listed(list)] as const).filter(
      ([list, found]) => Object.keys(found).length > 0 || (options.keep ?? []).includes(list),
    ),
  );

  const own = (dep: Dep): Record<string, unknown> =>
    dep.own === undefined ? {} : { dependencies: Object.fromEntries(dep.own.map((name) => [name, "1.0.0"])) };

  const manifestText = (dep: Dep): string =>
    dep.text ??
    JSON.stringify({
      name: dep.name,
      version: "1.0.0",
      ...own(dep),
      ...(dep.kalfa === undefined ? {} : { kalfa: dep.kalfa }),
    });

  const cliPath = (dep: Dep): string | undefined => {
    const field = dep.kalfa;

    return Predicate.hasProperty(field, "cli") && Predicate.isString(field.cli) ? field.cli : undefined;
  };

  return {
    folder,
    root: "root" in options ? options.root : JSON.stringify({ name: "demo-repo", ...lists }),
    installed: Object.fromEntries(deps.filter((dep) => dep.installed).map((dep) => [dep.name, manifestText(dep)])),
    entries: {
      ...Object.fromEntries(
        deps.flatMap((dep) => {
          const subpath = cliPath(dep);

          return subpath !== undefined && dep.entry !== undefined
            ? [[toSpecifier(dep.name, subpath), dep.entry] as const]
            : [];
        }),
      ),
      ...options.extra,
    },
  };
};

/** The `module` entry that exports a subcommand, and whatever else is given beside it. */
export const exporting = (subcommand: Subcommand.Subcommand, beside: Record<string, unknown> = {}): Entry =>
  Entry.Module({ exports: { ...beside, subcommand } });

// ---- a whole drawn world

/** What every law draws from: names, numbers and texts, and nothing else. A law builds each case from it. */
export interface Seed {
  readonly words: ReadonlyArray<string>;
  readonly nums: ReadonlyArray<number>;
  readonly texts: ReadonlyArray<TextSeed>;
}

const word = pattern(/^[a-z]{2,5}$/);

export const seed: Arbitrary.Arbitrary<Seed> = Arbitrary.all({
  words: Arbitrary.array(word, { minLength: 12, maxLength: 12 }),
  nums: Arbitrary.array(between(0, 1_000_000), { minLength: 12, maxLength: 12 }),
  texts: Arbitrary.array(textSeed, { minLength: 6, maxLength: 6 }),
});

/** A distinct package name for the i-th word: some are scoped. */
export const packageName = (s: Seed, index: number): string =>
  index % 3 === 2 ? `@${at(s.words, index + 5)}/p${index}${at(s.words, index)}` : `p${index}${at(s.words, index)}`;

/** A distinct root name for the i-th word, as the rule of a root name allows. */
// Counted down, so that the root names sort the other way round from the packages that hold them (a package's name is
// counted up): a command that lists its subcommands in the order it found them is seen.
const rootName = (s: Seed, index: number): string => `r${9 - index}${at(s.words, index + 7)}`;

/** The spec of a subcommand: its root, a script, and a code of its own. */
export const subcommandSpec = (s: Seed, index: number, script: ReadonlyArray<Step>): SubcommandSpec => ({
  root: rootName(s, index),
  script,
  codes: [`${rootName(s, index)}/${at(s.words, index + 1)}`, `${rootName(s, index)}/${at(s.words, index + 2)}x`],
  probe: `probe-${index}-${at(s.words, index + 3)}`,
});

/** The folder a drawn repo lives in: never the one the test runs in. */
export const repoFolder = (s: Seed): string => `/kalfa-test/${at(s.words, 4)}/${at(s.words, 9)}`;

/** The subpaths a field may name: the package's root and two entry points. */
export const SUBPATHS: ReadonlyArray<string> = [".", "./cli", "./a/b"];

/** The class ids a law reached, and the ones it must reach. */
export const reachedAll = (reached: ReadonlySet<string>, required: ReadonlyArray<string>) =>
  required.filter((id) => !reached.has(id));

// ---- failures, by the table of messages

/** Each way a handler may stop with a value that has no message of its own. */
export const NO_MESSAGE: ReadonlyArray<Stop> = [{ code: 7 }, "plain text", 7, null, { message: 7 }];

export const NO_MESSAGE_TEXT = "the subcommand stopped with a value that has no message.";

// ---- the reference: what effect/cli itself says about the same tree, with kalfa's wording left out

const tree = (subs: ReadonlyArray<Subcommand.Subcommand>) =>
  Command.make("kalfa").pipe(
    Command.withSubcommands(subs.toSorted((a, b) => (a.name < b.name ? -1 : 1)).map((sub) => sub.command)),
  );

/** What effect/cli alone does on these arguments over the subcommands' tree: what it printed to its log, and its refusal. */
export const reference = (subs: ReadonlyArray<Subcommand.Subcommand>, args: ReadonlyArray<string>, version: string) =>
  Effect.gen(function* () {
    const before = (yield* TestConsole.logLines).length;
    const exit = yield* Effect.exit(Command.runWith(tree(subs), { version, renderErrors: false })(args));
    const log = (yield* TestConsole.logLines).slice(before).map(String);

    const found = Exit.isFailure(exit) ? Cause.findError(exit.cause) : undefined;

    const refusal =
      found !== undefined && Result.isSuccess(found) && Schema.is(CliError.ShowHelp)(found.success)
        ? found.success
        : undefined;

    return { log, refusal };
  }).pipe(Effect.provide(Layer.mergeAll(TestConsole.layer, platform, TestDiagnosticsOff)));

/** Diagnostics that discards what is reported: a reference run takes no handler's report to its output. */
const TestDiagnosticsOff = Layer.succeed(Diagnostics.Diagnostics, { report: () => Effect.void });

/** The message a refusal of effect/cli reads as on `kalfa`'s one line, by the table of the plan. */
export const parseMessage = (refusal: CliError.ShowHelp | undefined): string | undefined =>
  refusal !== undefined
    ? refusal.errors.length === 0
      ? `\`${refusal.commandPath.join(" ")}\` needs a subcommand.`
      : refusal.errors.map((error) => error.message).join(" ")
    : undefined;

/** The version this package's own manifest gives. */
export const packageVersion: Effect.Effect<string> = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const text = yield* fs.readFileString(path.resolve(import.meta.dirname, "..", "package.json"));

  return (yield* Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Struct({ version: Schema.String })))(text))
    .version;
}).pipe(Effect.provide(NodeServices.layer), Effect.orDie);
