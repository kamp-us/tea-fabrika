// The cases the laws of the command draw: from one seed, one case for each class of how a run ends and each class of
// refused start, each with what `kalfa` must print and answer, worked out here from the seed and never from the code
// under test. A law applies every case to each seed it draws and fails when a class it lists was not reached.
import { Effect, Predicate, Ref } from "effect";
import {
  at,
  type Dep,
  exporting,
  repoFolder,
  LISTS,
  modelFailure,
  modelLine,
  NO_MESSAGE,
  NO_MESSAGE_TEXT,
  packageName,
  parseMessage,
  drawPlaces,
  type Ran,
  packageVersion,
  reference,
  type Repo,
  buildRepo,
  type ReportSpec,
  type Seed,
  subcommandSpec,
  type SubcommandSpec,
  buildSubcommand,
  textVariants,
  Broken,
  Entry,
  Step,
  type Stop,
  TEXT_IDS,
  placeWith,
} from "./run.test-support.ts";
import { candidates } from "./Subcommand.test-support.ts";
import type * as Subcommand from "./Subcommand.ts";

// ---- a world: two subcommands installed in one repo

type World = Effect.Success<ReturnType<typeof buildWorld>>;

/** A repo with two subcommands installed, the first running `script` and the second `other`, which logs its Layer's value. */
export const buildWorld = (seed: Seed, script: ReadonlyArray<Step>, other: ReadonlyArray<Step> = [Step.Probe()]) =>
  Effect.gen(function* () {
    const ran: Ran = yield* Ref.make(0);
    const specs: ReadonlyArray<SubcommandSpec> = [subcommandSpec(seed, 0, script), subcommandSpec(seed, 1, other)];
    const subs = specs.map((spec) => buildSubcommand(spec, ran));

    const deps: ReadonlyArray<Dep> = subs.map((sub, index) => ({
      name: packageName(seed, index),
      lists: [at(LISTS, index)],
      installed: true,
      kalfa: { cli: "./cli" },
      entry: exporting(sub),
    }));

    return { ran, specs, subs, deps, repo: buildRepo(repoFolder(seed), deps) };
  });

// ---- what a script does, worked out

/** What a script writes and how it ends, by following its steps. */
interface Followed {
  readonly out: ReadonlyArray<string>;
  readonly diag: ReadonlyArray<string>;
  /** The code and severity of each report, in order. */
  readonly printed: ReadonlyArray<{ readonly code: string; readonly severity: string }>;
  readonly errors: number;
  readonly warnings: number;
  /** The message the run stops with, when it does not finish. */
  readonly stop: string | undefined;
}

/** The message a stopping value gives: its own `message`, or the one text for a value with none. */
const stopMessage = (value: Stop): string =>
  Predicate.hasProperty(value, "message") && Predicate.isString(value.message) ? value.message : NO_MESSAGE_TEXT;

/** The effect of each step on what is printed and counted, in order, up to the step that stops the run. */
const follow = (spec: SubcommandSpec, script: ReadonlyArray<Step>): Followed => {
  const out: Array<string> = [];
  const diag: Array<string> = [];
  const printed: Array<{ code: string; severity: string }> = [];
  let errors = 0;
  let warnings = 0;

  for (const step of script) {
    const stop = Step.$match(step, {
      Log: ({ text }) => {
        out.push(text);

        return undefined;
      },
      Probe: () => {
        out.push(spec.probe);

        return undefined;
      },
      Resolve: () => undefined,
      Report: ({ name, report }) => {
        diag.push(modelLine(name, report));
        printed.push({ code: name, severity: report.severity });

        if (report.severity === "error") {
          errors++;
        } else {
          warnings++;
        }

        return undefined;
      },
      Fail: ({ value }) => stopMessage(value),
      Die: ({ value }) => stopMessage(value),
      Interrupt: () => "kalfa was stopped.",
    });

    if (stop !== undefined) {
      return { out, diag, printed, errors, warnings, stop };
    }
  }

  return { out, diag, printed, errors, warnings, stop: undefined };
};

// ---- the classes of how a run ends

/** One run of `main`, and everything it must print and answer. */
interface Case {
  /** The class of how the run ends, or of how a start is refused. */
  readonly id: string;
  readonly repo: Repo;
  readonly args: ReadonlyArray<string>;
  readonly ran: Ran;
  /** The packages whose subcommands are loaded: the root names of the repo and the packages they live in. */
  readonly packages: ReadonlyArray<string>;
  readonly roots: ReadonlyArray<string>;
  readonly code: 0 | 1 | 2;
  /** Exactly what standard output holds, in order. */
  readonly out: ReadonlyArray<string>;
  /** Exactly what standard error holds, in order. */
  readonly err: ReadonlyArray<string>;
  /** The diagnostic lines among `err`, and the last line when it is a failure's. */
  readonly diag: ReadonlyArray<string>;
  /** The code and severity of each report that was printed, in order. */
  readonly printed: ReadonlyArray<{ readonly code: string; readonly severity: string }>;
  readonly failure: string | undefined;
  readonly errors: number;
  readonly warnings: number;
  /** True when the handler of the first subcommand's `act` ran from its start. */
  readonly handled: boolean;
  /** How many refusals effect/cli gave for a bad invocation: several are joined on one line. */
  readonly parseErrors: number;
}

/** Each way a handler may end, as the classes of the plan's (l) and (u). */
export const ENDING_IDS: ReadonlyArray<string> = [
  "finish/none",
  "finish/warnings",
  "finish/errors",
  "finish/mixed",
  "fail/message",
  "die/message",
  "fail/no-message",
  "die/no-message",
  "report-then-die",
  "interrupt",
  ...TEXT_IDS.map((id) => `text/${id}`),
  "parse/unknown-flag",
  "parse/unknown-subcommand",
  "parse/missing-argument",
  "parse/no-subcommand-root",
  "parse/no-subcommand-sub",
  "parse/many-flags",
  "help/root",
  "help/sub",
  "help/leaf",
  "version",
];

const drawReport = (seed: Seed, index: number, severity: "error" | "warning", variant: number): ReportSpec => {
  const texts = textVariants(at(seed.texts, index));
  const places = drawPlaces(at(seed.texts, index + 1));

  return {
    severity,
    message: at(texts, variant).text,
    hint: at(texts, variant + 3).text,
    place: at(places, seed.nums[index] ?? 0),
  };
};

/** The reports of a script: one for each severity pattern, naming the first code the subcommand declared. */
const reportsFor = (
  seed: Seed,
  spec: SubcommandSpec,
  severities: ReadonlyArray<"error" | "warning">,
): ReadonlyArray<Step> =>
  severities.map((severity, index) =>
    Step.Report({
      name: at(spec.codes, index),
      report: drawReport(seed, index, severity, (seed.nums[index + 4] ?? 0) + index),
    }),
  );

/** The texts a handler logs: each class of text, and the empty one, so each is meant to come out as it went in. */
const logsFor = (seed: Seed): ReadonlyArray<string> => [
  "",
  ...textVariants(at(seed.texts, 4)).map(({ text }) => text),
  `${at(seed.words, 6)}\nline two\n`,
];

/** The logs and reports of a handler that finishes, the reports spread among the logs. */
const interleave = (logs: ReadonlyArray<string>, reports: ReadonlyArray<Step>): ReadonlyArray<Step> => {
  const out: Array<Step> = [];
  const every = Math.max(1, Math.ceil(logs.length / (reports.length + 1)));

  logs.forEach((text, index) => {
    out.push(Step.Log({ text }));

    const report = reports[Math.floor(index / every)];

    if (index % every === every - 1 && report !== undefined && Math.floor(index / every) < reports.length) {
      out.push(report);
    }
  });

  // Any report that the spacing left out goes at the end.
  for (const report of reports) {
    if (!out.includes(report)) {
      out.push(report);
    }
  }

  return out;
};

const SEVERITIES: Readonly<Record<string, ReadonlyArray<"error" | "warning">>> = {
  none: [],
  warnings: ["warning", "warning"],
  errors: ["error", "error", "error"],
  mixed: ["warning", "error", "warning", "error"],
};

/** What a script that stops by itself prints and answers, as one case. */
const scripted = (id: string, world: World): Case => {
  const spec = at(world.specs, 0);
  const followed = follow(spec, spec.script);

  const diag = followed.diag;
  const failure = followed.stop;

  return {
    id,
    repo: world.repo,
    args: [spec.root, "act"],
    ran: world.ran,
    packages: world.deps.map((dep) => dep.name),
    roots: world.specs.map((each) => each.root),
    code: failure !== undefined ? 2 : followed.errors > 0 ? 1 : 0,
    out: followed.out,
    err: [...diag, ...(failure === undefined ? [] : [modelFailure(failure)])],
    diag,
    printed: followed.printed,
    failure,
    errors: followed.errors,
    warnings: followed.warnings,
    handled: true,
    parseErrors: 0,
  };
};

/** Every class of how a run ends, for a seed: one case each, and one for each value that carries no message. */
export const endings = (seed: Seed): Effect.Effect<ReadonlyArray<Case>> =>
  Effect.gen(function* () {
    const cases: Array<Case> = [];

    const build = (script: (spec: SubcommandSpec) => ReadonlyArray<Step>) =>
      buildWorld(seed, script(subcommandSpec(seed, 0, [])));

    const message = (index: number) => at(textVariants(at(seed.texts, index)), seed.nums[index] ?? 0).text;

    for (const [name, severities] of Object.entries(SEVERITIES)) {
      const world = yield* build((spec) => interleave(logsFor(seed), reportsFor(seed, spec, severities)));

      cases.push(scripted(`finish/${name}`, world));
    }

    const stops: ReadonlyArray<readonly [string, Step]> = [
      ["fail/message", Step.Fail({ value: new Broken({ message: message(0) }) })],
      ["die/message", Step.Die({ value: new Error(message(1)) })],
      ["interrupt", Step.Interrupt()],
      ...NO_MESSAGE.flatMap((value): ReadonlyArray<readonly [string, Step]> => [
        ["fail/no-message", Step.Fail({ value })],
        ["die/no-message", Step.Die({ value })],
      ]),
    ];

    for (const [id, stop] of stops) {
      const world = yield* build((spec) => [
        Step.Log({ text: "before" }),
        ...reportsFor(seed, spec, ["warning"]),
        stop,
      ]);

      cases.push(scripted(id, world));
    }

    // (t) Each class of text, in a message, in a hint and in a place, each by itself.
    for (const variant of textVariants(at(seed.texts, 0))) {
      const world = yield* build((spec) => [
        Step.Report({
          name: at(spec.codes, 0),
          report: {
            severity: "error",
            message: variant.text,
            hint: "Plain hint.",
            place: placeWith(at(seed.texts, 1), "plain"),
          },
        }),
        Step.Report({
          name: at(spec.codes, 0),
          report: {
            severity: "warning",
            message: "Plain message.",
            hint: variant.text,
            place: placeWith(at(seed.texts, 1), "plain"),
          },
        }),
        Step.Report({
          name: at(spec.codes, 1),
          report: {
            severity: "error",
            message: "Plain message.",
            hint: "Plain hint.",
            place: placeWith(at(seed.texts, 0), variant.id),
          },
        }),
      ]);

      cases.push(scripted(`text/${variant.id}`, world));
    }

    // (u) A report, then a defect, in one handler.
    {
      const world = yield* build((spec) => [
        ...reportsFor(seed, spec, ["error", "warning"]),
        Step.Die({ value: new Error(message(2)) }),
      ]);

      cases.push(scripted("report-then-die", world));
    }

    // The version `kalfa` is to print is the one its package's manifest gives, never a copy of it.
    const version = yield* packageVersion;

    // Arguments that effect/cli refuses or answers itself, on the same tree.
    const world = yield* build((spec) => reportsFor(seed, spec, ["error"]));
    const roots = world.specs.map((spec) => spec.root);
    const [first = ""] = roots;
    const flag = `--zz${at(seed.words, 8)}`;
    const wrong = `${at(seed.words, 10)}x${at(seed.words, 11)}`;

    // Two or three unknown flags, each with a name of its own.
    const manyFlags = Array.from(
      { length: 2 + ((seed.nums[3] ?? 0) % 2) },
      (_, index) => `--zz${index}${at(seed.words, index + 8)}`,
    );

    const parsed: ReadonlyArray<readonly [string, ReadonlyArray<string>]> = [
      ["parse/unknown-flag", [first, "act", flag]],
      ["parse/unknown-subcommand", [wrong]],
      ["parse/missing-argument", [first, "need"]],
      ["parse/no-subcommand-root", []],
      ["parse/no-subcommand-sub", [first]],
      // Two or more refusals at once: effect/cli gives each its own message, and they are printed on one line.
      ["parse/many-flags", [first, "act", ...manyFlags]],
    ];

    for (const [id, args] of parsed) {
      const ref = yield* reference(world.subs, args, version);
      const refused = parseMessage(ref.refusal);

      cases.push({
        id,
        repo: world.repo,
        args,
        ran: world.ran,
        packages: world.deps.map((dep) => dep.name),
        roots,
        code: 2,
        out: [],
        err: [...ref.log.slice(0, 1), modelFailure(refused ?? "the reference refused nothing")],
        diag: [],
        printed: [],
        failure: refused,
        errors: 0,
        warnings: 0,
        handled: false,
        parseErrors: ref.refusal?.errors.length ?? 0,
      });
    }

    const asked: ReadonlyArray<readonly [string, ReadonlyArray<string>]> = [
      ["help/root", ["--help"]],
      ["help/sub", [first, "--help"]],
      ["help/leaf", [first, "act", "--help"]],
    ];

    for (const [id, args] of asked) {
      const ref = yield* reference(world.subs, args, version);

      cases.push({
        id,
        repo: world.repo,
        args,
        ran: world.ran,
        packages: world.deps.map((dep) => dep.name),
        roots,
        code: 0,
        out: ref.log,
        err: [],
        diag: [],
        printed: [],
        failure: undefined,
        errors: 0,
        warnings: 0,
        handled: false,
        parseErrors: 0,
      });
    }

    cases.push({
      id: "version",
      repo: world.repo,
      args: ["--version"],
      ran: world.ran,
      packages: world.deps.map((dep) => dep.name),
      roots,
      code: 0,
      // What effect/cli prints for the version of this package's own manifest, and nothing else.
      out: (yield* reference(world.subs, ["--version"], version)).log,
      err: [],
      diag: [],
      printed: [],
      failure: undefined,
      errors: 0,
      warnings: 0,
      handled: false,
      parseErrors: 0,
    });

    return cases;
  });

// ---- the classes of a refused start

/** What a refusal looks like from the outside: the id of its class, a repo and the one line `kalfa` must print. */
interface Refusal {
  readonly id: string;
  readonly repo: Repo;
  readonly args: ReadonlyArray<string>;
  readonly ran: Ran;
  /** Whether the start is refused, or the class is a near miss that must go on. */
  readonly refused: boolean;
  /** The message of the table, before it is escaped; none when the plan fixes only that the line names a package. */
  readonly message: string | undefined;
  /** The package the line must name, for a class whose message the plan does not fix. */
  readonly names: string | undefined;
}

/** The text of a manifest that is not a JSON object `kalfa` can read, in each way the plan names. */
const unreadable = (seed: Seed): ReadonlyArray<string> => [
  `{ "dependencies": ${at(seed.words, 0)}`,
  "null",
  "[]",
  JSON.stringify(at(seed.words, 1)),
  JSON.stringify({ dependencies: 7 }),
  JSON.stringify({ devDependencies: { [at(seed.words, 2)]: 7 } }),
  "",
];

/** The plan's rule for a field's subpath, written a second way: `.`, or `./` and parts that are not empty, `.` or `..`. */
const isSubpath = (text: string): boolean =>
  text === "." ||
  (text.startsWith("./") &&
    text
      .slice(2)
      .split("/")
      .every((part) => part !== "" && part !== "." && part !== ".."));

/** Subpaths of words with an empty part, `.` or `..` put among them, and some that do not start right. */
const subpaths = (seed: Seed): ReadonlyArray<string> => {
  const words = [0, 1, 2].map((index) => at(seed.words, index));
  const pick = seed.nums[0] ?? 0;

  const broken = ["", ".", ".."].map((part) => `./${words.toSpliced(pick % (words.length + 1), 0, part).join("/")}`);

  return [
    ".",
    `./${words[0]}`,
    `./${words.join("/")}`,
    ...broken,
    words.join("/"),
    `/${words[0]}`,
    `../${words[0]}`,
    `.${words[0]}`,
    "./",
  ];
};

const FIELD = (name: string, field: string) =>
  `${name}'s kalfa.${field} field must be "." or a "./" path inside the package.`;

/** The classes that go on: a start that is not refused, though it looks like one that is. */
export const GOING_ON: ReadonlyArray<string> = [
  "field/valid",
  "not-installed/optionalDependencies",
  "look-alike/own",
  "look-alike/copy",
];

/** The class ids a run of `refusals` must reach. */
export const refusalIds = (made: Subcommand.Subcommand): ReadonlyArray<string> => [
  "no-manifest",
  "bad-manifest/root",
  "bad-manifest/dep",
  "not-installed/dependencies",
  "not-installed/devDependencies",
  "not-installed/optionalDependencies",
  "field/valid",
  "bad-field/cli",
  "bad-field/kalfa",
  "not-exported",
  "load",
  "no-subcommand/no-key",
  "no-subcommand/inherited",
  ...candidates(made).map((one) => `look-alike/${one.id}`),
];

/** Refusals, and the near misses that go on, for a seed. Each repo also holds a good subcommand that must not run. */
export const refusals = (seed: Seed): Effect.Effect<ReadonlyArray<Refusal>> =>
  Effect.gen(function* () {
    const world = yield* buildWorld(seed, [Step.Log({ text: "must not run" })]);
    const good = at(world.deps, 0);
    const bad = packageName(seed, 5);
    const folder = repoFolder(seed);
    const subpath = "./cli";

    const found: Array<Refusal> = [];

    const add = (id: string, repo: Repo, refused: boolean, extra: Partial<Refusal> = {}) =>
      found.push({
        id,
        repo,
        args: [at(world.specs, 0).root, "act"],
        ran: world.ran,
        refused,
        message: undefined,
        names: undefined,
        ...extra,
      });

    const withBad = (dep: Omit<Dep, "name" | "installed">, options: { installed?: boolean } = {}) =>
      buildRepo(folder, [good, { name: bad, installed: options.installed ?? true, ...dep }]);

    add("no-manifest", buildRepo(folder, [good], { root: undefined }), true, {
      message: "There is no package.json in this folder. Run kalfa from the repo's root.",
    });

    for (const text of unreadable(seed)) {
      add("bad-manifest/root", buildRepo(folder, [good], { root: text }), true, {
        message: "This folder's package.json is not a JSON object kalfa can read.",
      });
    }

    for (const text of unreadable(seed).filter((each) => each !== "")) {
      add("bad-manifest/dep", withBad({ lists: ["dependencies"], text }), true, {
        message: `${bad}'s package.json is not a JSON object kalfa can read.`,
      });
    }

    for (const list of LISTS) {
      const required = list !== "optionalDependencies";

      add(
        `not-installed/${list}`,
        withBad({ lists: [list], kalfa: { cli: subpath } }, { installed: false }),
        required,
        {
          message: required
            ? `${bad} is listed in package.json but not installed. Run your package manager's install.`
            : undefined,
        },
      );
    }

    for (const text of subpaths(seed)) {
      const valid = isSubpath(text);

      add(
        valid ? "field/valid" : "bad-field/cli",
        withBad({ lists: ["dependencies"], kalfa: { cli: text }, entry: exporting(at(world.subs, 1)) }),
        !valid,
        { message: valid ? undefined : FIELD(bad, "cli") },
      );
    }

    for (const value of [7, ["./cli"], null, {}]) {
      add("bad-field/cli", withBad({ lists: ["dependencies"], kalfa: { cli: value } }), true, {
        message: FIELD(bad, "cli"),
      });
    }

    // `kalfa` itself is not an object: the field that is off is not one of its own, so the line need only name the package.
    for (const value of ["./cli", ["./cli"], 7, null]) {
      add("bad-field/kalfa", withBad({ lists: ["dependencies"], kalfa: value }), true, { names: bad });
    }

    add("not-exported", withBad({ lists: ["dependencies"], kalfa: { cli: subpath }, entry: Entry.NoDefault() }), true, {
      message: `${bad} names ${subpath} in its kalfa.cli field, but its exports give that path no "default" condition, so kalfa cannot load it.`,
    });

    add("load", withBad({ lists: ["dependencies"], kalfa: { cli: subpath }, entry: Entry.Throws() }), true, {
      message: `${bad}'s kalfa.cli entry ${subpath} failed to load.`,
    });

    const noSubcommand = `${bad} names ${subpath} in its kalfa.cli field, but that entry exports no subcommand. Expected: export const subcommand = Subcommand.make(command, { layer, diagnostics }), from @kalfa/cli/Subcommand.`;

    const lookingAlike = (id: string, entry: Entry, refused = true) =>
      add(id, withBad({ lists: ["dependencies"], kalfa: { cli: subpath }, entry }), refused, {
        message: refused ? noSubcommand : undefined,
      });

    lookingAlike("no-subcommand/no-key", Entry.Module({ exports: { other: 1 } }));
    lookingAlike(
      "no-subcommand/inherited",
      Entry.Module({ exports: Object.create({ subcommand: at(world.subs, 1) }) }),
    );

    // (f) Each value that is not a subcommand, as the slice's own list of look-alikes has it, under an own key.
    for (const one of candidates(at(world.subs, 1))) {
      lookingAlike(`look-alike/${one.id}`, Entry.Module({ exports: { subcommand: one.value } }), !one.holds);
    }

    return found;
  });
