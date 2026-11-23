// K1 to K8, K18 and K19: what the `kalfa` command finds, loads, prints, answers and traces. Every law runs `main` on a repo
// held in memory behind `Packages`, with Effect's `TestConsole` for standard output and error and a recording tracer, so
// it runs on every pull request. The one real process is K12 (bin.integration.test.ts). Each law applies every class to
// each seed it draws and fails when a class it lists was not reached.
import { posix } from "node:path";
import { describe, expect, it } from "@effect/vitest";
import * as Diagnostic from "@kalfa/diagnostics/Diagnostic";
import { Effect, Formatter, Layer, Path, Predicate, Ref } from "effect";
import { endings, ENDING_IDS, GOING_ON, refusalIds, refusals, buildWorld } from "./run.cases.test-support.ts";
import {
  ancestors,
  at,
  type Dep,
  exporting,
  Broken,
  Call,
  LISTS,
  Step,
  repoFolder,
  holdsRaw,
  modelFailure,
  packageName,
  Probe,
  reachedAll,
  buildRepo,
  type Seed,
  runOn,
  type Run,
  SEED,
  seed,
  toSpecifier,
  SUBPATHS,
  subcommandSpec,
  buildSubcommand,
  unescape,
} from "./run.test-support.ts";

const check = { arbitrary: { seed: SEED, runs: 100 } };

/** The entries of `err` that are not help: the help is one entry that holds a line break and begins with `USAGE`. */
const isHelp = (entry: string): boolean => entry.startsWith("USAGE");

// K1. Plant: read only `dependencies`, and a devDependency's subcommand is missing from the loads; keep a name that two
// lists name twice, and it is loaded twice; read each dependency's own dependencies too, and the deeper entry is
// loaded; treat a `kalfa` field with no `cli` as a candidate, and a load is made for it; import every dependency's root
// to look for `subcommand`, and a package with no field is loaded; load before every manifest is read, and a load
// comes first in the calls.
describe("K1, only direct dependencies with kalfa.cli are loaded", () => {
  it.effect.prop(
    "K1 property: the loads are one for each direct dependency whose manifest has kalfa.cli, with its specifier, and every manifest is read before the first load",
    { seed },
    ({ seed: drawn }) =>
      Effect.gen(function* () {
        const reached = new Set<string>();

        const ran = yield* Ref.make(0);
        const sub = (index: number) => buildSubcommand(subcommandSpec(drawn, index, []), ran);
        const name = (index: number) => packageName(drawn, index);
        const subpath = at(SUBPATHS, drawn.nums[0] ?? 0);

        const deps: ReadonlyArray<Dep> = [
          // (a) in `dependencies`, with a drawn subpath; its own manifest lists a dependency of its own (c)
          {
            name: name(0),
            lists: ["dependencies"],
            installed: true,
            kalfa: { cli: subpath },
            entry: exporting(sub(0)),
            own: [name(5)],
          },
          // (a) in two lists
          {
            name: name(1),
            lists: ["devDependencies", "dependencies"],
            installed: true,
            kalfa: { cli: "./cli" },
            entry: exporting(sub(1)),
          },
          // (a) in `optionalDependencies`
          {
            name: name(2),
            lists: ["optionalDependencies"],
            installed: true,
            kalfa: { cli: "./cli" },
            entry: exporting(sub(2)),
          },
          // (b) a field with other keys only
          { name: name(3), lists: ["dependencies"], installed: true, kalfa: { other: 1 }, entry: exporting(sub(3)) },
          // (a) only in `devDependencies`
          {
            name: name(4),
            lists: ["devDependencies"],
            installed: true,
            kalfa: { cli: "./cli" },
            entry: exporting(sub(4)),
          },
          // (b) no field at all
          { name: name(7), lists: ["dependencies"], installed: true, entry: exporting(sub(7)) },
          // (c) a dependency of a dependency, and an installed package nothing lists
          { name: name(5), lists: [], installed: true, kalfa: { cli: "./cli" }, entry: exporting(sub(5)) },
          { name: name(6), lists: [], installed: true, kalfa: { cli: "./cli" }, entry: exporting(sub(6)) },
        ];

        // What the law expects, by the rule and not by the code: a dependency the root lists, whose manifest has `cli`.
        const wanted = deps.filter((dep) => dep.lists.length > 0 && Predicate.hasProperty(dep.kalfa, "cli"));
        const listed = deps.filter((dep) => dep.lists.length > 0).map((dep) => dep.name);

        const repos = [
          { id: "lists", repo: buildRepo(repoFolder(drawn), deps), expected: wanted },
          {
            id: "empty-lists",
            repo: buildRepo(repoFolder(drawn), [], { keep: LISTS }),
            expected: [],
          },
          { id: "no-lists", repo: buildRepo(repoFolder(drawn), []), expected: [] },
        ];

        for (const { id, repo, expected } of repos) {
          reached.add(id);

          const run = yield* runOn(repo, ["--help"]);
          const loads = run.calls.filter(Call.$is("Load"));
          const reads = run.calls.filter(Call.$is("Read"));

          expect(loads.map((call) => call.pkg).toSorted(), id).toEqual(expected.map((dep) => dep.name).toSorted());

          for (const call of loads) {
            const found = expected.find((dep) => dep.name === call.pkg);
            const cli = Predicate.hasProperty(found?.kalfa, "cli") ? found.kalfa.cli : undefined;

            expect(call.specifier, `${id}: the specifier of ${call.pkg}`).toBe(toSpecifier(call.pkg, String(cli)));
          }

          // Nothing but what the root lists is read: not a dependency's own dependency, not an installed package nothing lists.
          expect(
            reads.filter((call) => !listed.includes(call.name)),
            `${id}: a package nothing lists was read`,
          ).toEqual([]);

          // Every manifest is read before the first load.
          const firstLoad = run.calls.findIndex(Call.$is("Load"));

          if (firstLoad >= 0) {
            expect(run.calls.slice(firstLoad).some(Call.$is("Read")), `${id}: a manifest was read after a load`).toBe(
              false,
            );
          }
        }

        // A name that two lists name is loaded once.
        const twice = yield* runOn(buildRepo(repoFolder(drawn), deps), ["--help"]);

        expect(twice.calls.filter(Call.$is("Load")).filter((call) => call.pkg === name(1)).length).toBe(1);
        expect(reachedAll(reached, ["lists", "empty-lists", "no-lists"])).toEqual([]);
      }),
    check,
  );
});

// K2. Plant: skip a package whose entry exports no `subcommand`, and the run goes on; accept any command as
// `subcommand`; check only the mark, and a look-alike passes; take any string as the field, and a `..` subpath is
// loaded; read `subcommand` without `Object.hasOwn`, and an inherited one is taken; treat a resolve failure as no
// field; skip a missing regular dependency; refuse
// a missing optional one.
describe("K2, a refused start", () => {
  it.effect.prop(
    "K2 property: a refused start ends with exit code 2 and one line `kalfa: <message>` from the table, runs no handler and writes nothing else",
    { seed },
    ({ seed: drawn }) =>
      Effect.gen(function* () {
        const reached = new Set<string>();

        for (const found of yield* refusals(drawn)) {
          reached.add(found.id);

          const before = yield* Ref.get(found.ran);
          const run = yield* runOn(found.repo, found.args);
          const label = `${found.id}: ${JSON.stringify(found.repo.root)}`;

          if (!found.refused) {
            // The near misses that go on: a package that is not installed and optional, and a field that is a good subpath.
            expect(run.code, label).not.toBe(2);

            continue;
          }

          expect(run.code, label).toBe(2);
          expect(run.out, `${label}: standard output`).toEqual([]);
          expect(run.err.length, `${label}: one line on standard error`).toBe(1);
          expect(run.err[0]?.includes("\n"), label).toBe(false);
          expect((yield* Ref.get(found.ran)) - before, `${label}: no handler ran`).toBe(0);

          if (found.message !== undefined) {
            expect(run.err[0], label).toBe(modelFailure(found.message));
          } else {
            expect(run.err[0]?.startsWith("kalfa: "), label).toBe(true);
            expect(run.err[0]?.includes(found.names ?? ""), label).toBe(true);
          }
        }

        const made = buildSubcommand(subcommandSpec(drawn, 0, []), yield* Ref.make(0));

        expect(reachedAll(reached, refusalIds(made))).toEqual([]);
      }),
    check,
  );
});

/** The runs of every ending for a seed, with what each must be. */
const endingRuns = (drawn: Parameters<typeof endings>[0]) =>
  Effect.gen(function* () {
    const cases = yield* endings(drawn);

    return yield* Effect.forEach(
      cases,
      (found) => Effect.map(runOn(found.repo, found.args), (run) => ({ found, run })),
      {
        concurrency: 1,
      },
    );
  });

// K3. Plant: count warnings as errors, and a warnings-only run ends 1; map a typed failure to 1; map implicit help to 0;
// map `--help` to 2; let a defect after a report end 1.
it.effect.prop(
  "K3 property: the exit code is 0 when no error was reported and the handler finished, 1 when an error was and it finished, and 2 for every way of not finishing",
  { seed },
  ({ seed: drawn }) =>
    Effect.gen(function* () {
      const reached = new Set<string>();

      for (const { found, run } of yield* endingRuns(drawn)) {
        reached.add(found.id);

        expect(run.code, `${found.id}: ${found.args.join(" ")}`).toBe(found.code);
      }

      expect(reachedAll(reached, ENDING_IDS)).toEqual([]);
    }),
  check,
);

/** True when a line holds a break the line must not have. */
const broken = (line: string): boolean => line.includes("\n") || line.includes("\r") || holdsRaw(line);

// K4. Plant: write the message raw, and a line break splits the line; leave `\` as it is, and the undone escape
// differs; escape LF only, and a lone CR stays; escape Cc only, and U+202E stays; leave out the hint; print the lines at
// the end, and the report before a defect is lost.
it.effect.prop(
  "K4 property: each report is one line `<place>: <severity> <code>: <message> Hint: <hint>` on standard error, in report order, with every control, format and surrogate character, U+2028, U+2029 and backslash escaped",
  { seed },
  ({ seed: drawn }) =>
    Effect.gen(function* () {
      const reached = new Set<string>();

      for (const { found, run } of yield* endingRuns(drawn)) {
        reached.add(found.id);

        const lines = run.err.slice(0, found.diag.length);

        expect(lines, `${found.id}: the diagnostic lines`).toEqual(found.diag);

        for (const line of lines) {
          expect(broken(line), `${found.id}: a line breaks or holds a raw control character`).toBe(false);
          expect(line.endsWith(" Hint: ") || / Hint: /.test(line), found.id).toBe(true);
        }
      }

      expect(reachedAll(reached, ENDING_IDS)).toEqual([]);
    }),
  check,
);

// K5. Plant: print diagnostics with `Console.log`; trim the handler's text; keep effect/cli's default presenter, and an
// unknown flag puts help on standard output.
it.effect.prop(
  "K5 property: standard output holds only what the handler logged, as it was, and the help or the version a person asked for",
  { seed },
  ({ seed: drawn }) =>
    Effect.gen(function* () {
      const reached = new Set<string>();

      for (const { found, run } of yield* endingRuns(drawn)) {
        reached.add(found.id);

        if (found.id === "version") {
          expect(run.out.length, "the version is one line").toBe(1);
          expect(run.err, "nothing else is written").toEqual([]);

          continue;
        }

        expect(run.out, `${found.id}: standard output`).toEqual(found.out);
      }

      expect(reachedAll(reached, ENDING_IDS)).toEqual([]);
    }),
  check,
);

// K6. Plant: print `Cause.pretty`, and several lines come out; print `ShowHelp`'s own message, and `Help requested` is
// the line; print a value with no message as `[object Object]`; print a failure message raw, and a break in it splits it.
it.effect.prop(
  "K6 property: a run that could not finish ends standard error with one line `kalfa: <message>`, the message by the table, with no break, severity word, code or place",
  { seed },
  ({ seed: drawn }) =>
    Effect.gen(function* () {
      const reached = new Set<string>();

      for (const { found, run } of yield* endingRuns(drawn)) {
        reached.add(found.id);

        expect(run.err, `${found.id}: standard error`).toEqual(found.err);

        if (found.failure === undefined) {
          expect(
            run.err.some((entry) => entry.startsWith("kalfa: ")),
            `${found.id}: no failure line`,
          ).toBe(false);

          continue;
        }

        const last = run.err.at(-1) ?? "";

        expect(last.startsWith("kalfa: "), found.id).toBe(true);
        expect(broken(last), `${found.id}: the failure line breaks`).toBe(false);
        expect(run.err.filter((entry) => entry.startsWith("kalfa: ")).length, found.id).toBe(1);
        // Undoing the escape gives the message back, byte for byte.
        expect(unescape(last.slice("kalfa: ".length)), found.id).toBe(found.failure);
        expect(run.err.filter((entry) => !isHelp(entry)).length, found.id).toBe(found.diag.length + 1);
      }

      expect(reachedAll(reached, ENDING_IDS)).toEqual([]);
    }),
  check,
);

const names = (spans: Run["spans"], name: string) => spans.filter((span) => span.name === name);

// K7. Plant: print without a `cli.print` span; pick the exit code after `cli.run` ends, and `cli.exit` is outside it;
// skip `cli.exit` on a failure.
it.effect.prop(
  "K7 property: each step is a span: cli.run is the root, and cli.find, one cli.load for each candidate, cli.command, one cli.print for each report and cli.exit are inside it, with the handler's own spans inside cli.command",
  { seed },
  ({ seed: drawn }) =>
    Effect.gen(function* () {
      const reached = new Set<string>();

      for (const { found, run } of yield* endingRuns(drawn)) {
        reached.add(found.id);

        const label = `${found.id}`;
        const [root, ...others] = run.spans.filter((span) => span.parent === undefined);

        expect(root?.name, label).toBe("cli.run");
        expect(others, `${label}: a second root`).toEqual([]);
        expect(
          run.spans.every((span) => span.ended),
          `${label}: every span ended`,
        ).toBe(true);

        for (const span of run.spans.filter((each) => each !== root)) {
          expect(
            ancestors(run.spans, span).some((above) => above === root),
            `${label}: ${span.name} is inside cli.run`,
          ).toBe(true);
        }

        expect(names(run.spans, "cli.find").length, label).toBe(1);
        expect(names(run.spans, "cli.exit").length, label).toBe(1);
        expect(names(run.spans, "cli.command").length, label).toBe(1);
        expect(
          names(run.spans, "cli.load")
            .map((span) => span.attributes.get("kalfa.cli.package"))
            .toSorted(),
          label,
        ).toEqual(found.packages.toSorted());

        const [command] = names(run.spans, "cli.command");
        const [exit] = names(run.spans, "cli.exit");

        expect(exit?.attributes.get("process.exit.code"), label).toBe(found.code);
        expect(exit?.attributes.get("kalfa.cli.reported.errors"), label).toBe(found.errors);
        expect(exit?.attributes.get("kalfa.cli.reported.warnings"), label).toBe(found.warnings);

        if (found.roots.includes(found.args[0] ?? "")) {
          expect(command?.attributes.get("kalfa.cli.root"), label).toBe(found.args[0]);
        }

        const prints = names(run.spans, "cli.print");

        expect(prints.length, `${label}: one cli.print for each report`).toBe(found.diag.length);

        // Each print span says which report it is: its code and its severity are among its attributes.
        found.printed.forEach((report, index) => {
          const values = [...(prints[index]?.attributes.values() ?? [])];

          expect(values, `${label}: cli.print ${index} holds the code`).toContain(report.code);
          expect(values, `${label}: cli.print ${index} holds the severity`).toContain(report.severity);
        });

        for (const print of prints) {
          expect(
            ancestors(run.spans, print).some((above) => above === command),
            `${label}: cli.print is inside cli.command`,
          ).toBe(true);
        }

        for (const handler of names(run.spans, "handler.act")) {
          expect(
            ancestors(run.spans, handler).some((above) => above === command),
            `${label}: the handler's span is inside cli.command`,
          ).toBe(true);
        }

        expect(Predicate.isString(root?.attributes.get("kalfa.cli.version")), label).toBe(true);
      }

      expect(reachedAll(reached, ENDING_IDS)).toEqual([]);
    }),
  check,
);

// K7, the start that is refused: the steps that ran are still spans, and the exit is one of them.
// Plant: skip `cli.exit` on a failure, and a refused start has no `cli.exit` span.
it.effect.prop(
  "K7 property: a refused start still has cli.run as its root with cli.find and cli.exit inside it, and no cli.command",
  { seed },
  ({ seed: drawn }) =>
    Effect.gen(function* () {
      const reached = new Set<string>();

      for (const found of (yield* refusals(drawn)).filter((one) => one.refused)) {
        reached.add(found.id);

        const run = yield* runOn(found.repo, found.args);
        const label = found.id;
        const [root] = run.spans.filter((span) => span.parent === undefined);
        const [exit] = names(run.spans, "cli.exit");

        expect(root?.name, label).toBe("cli.run");
        expect(
          run.spans.every((span) => span.ended),
          `${label}: every span ended`,
        ).toBe(true);
        expect(names(run.spans, "cli.find").length, label).toBe(1);
        expect(names(run.spans, "cli.command").length, `${label}: nothing ran`).toBe(0);
        expect(exit?.attributes.get("process.exit.code"), label).toBe(2);
        expect(
          exit === undefined || root === undefined ? false : ancestors(run.spans, exit).includes(root),
          `${label}: cli.exit is inside cli.run`,
        ).toBe(true);
      }

      const made = buildSubcommand(subcommandSpec(drawn, 0, []), yield* Ref.make(0));

      expect(
        reachedAll(
          reached,
          refusalIds(made).filter((id) => !GOING_ON.includes(id)),
        ),
      ).toEqual([]);
    }),
  check,
);

/** Characters that change when written as JSON or in a URL: a quote, a backslash, a space, a slash, `&`, `%`, `+`, `?`, `#`, `=`, a line break, a tab, and what is past ASCII. */
const CHANGING: ReadonlyArray<string> = [
  '"',
  "\\",
  " ",
  "/",
  "&",
  "%",
  "+",
  "?",
  "#",
  "=",
  "\n",
  "\t",
  "é",
  "雪",
  "\u{1F600}",
];

/** A secret-looking text: a made-up key with three characters that change in JSON or in a URL. */
const drawSecret = (drawn: Seed): string =>
  `k9${at(drawn.words, 0)}${at(CHANGING, drawn.nums[0] ?? 0)}${at(drawn.words, 1)}${at(CHANGING, drawn.nums[1] ?? 0)}${at(CHANGING, drawn.nums[2] ?? 0)}7q${at(drawn.words, 2)}`;

/** Every text a span holds: its name, each attribute's name and value, each event's name and attributes. */
const spanTexts = (span: Run["spans"][number]): ReadonlyArray<string> => [
  // A text is taken as it is, anything else as Effect writes it.
  span.name,
  ...[...span.attributes].flatMap(([key, value]) => [key, Predicate.isString(value) ? value : Formatter.format(value)]),
  ...span.events.flatMap((event) => [
    event.name,
    ...Object.entries(event.attributes ?? {}).flatMap(([key, value]) => [
      key,
      Predicate.isString(value) ? value : Formatter.format(value),
    ]),
  ]),
];

/** The forms a secret may take in a span: as it is, as JSON writes it, and in a URL, whole and by part. */
const secretForms = (secret: string): ReadonlyArray<string> => [
  secret,
  JSON.stringify(secret).slice(1, -1),
  encodeURIComponent(secret),
  encodeURI(secret),
];

// K8 [secrets]. Plant: annotate `cli.command` with the arguments; put the failure message on `cli.exit`, and an unknown
// flag's echoed value leaks; annotate `cli.print` with the message; annotate `cli.command` with the first argument
// whether or not it is a root name.
it.effect.prop(
  "K8 [secrets] property: a secret-looking text given as an argument, a flag's value or in a message or hint never appears in a span, raw, JSON-escaped or URL-encoded, whether the run succeeds, reports or fails",
  { seed },
  ({ seed: drawn }) =>
    Effect.gen(function* () {
      const reached = new Set<string>();
      const secret = drawSecret(drawn);
      const spec = subcommandSpec(drawn, 0, []);

      const reporting: ReadonlyArray<Step> = [
        Step.Log({ text: secret }),
        Step.Report({
          name: at(spec.codes, 0),
          report: {
            severity: "error",
            message: secret,
            hint: secret,
            place: Diagnostic.Place.cases.flag.make({ name: "--label" }),
          },
        }),
      ];

      const flows: ReadonlyArray<{
        readonly id: string;
        readonly script: ReadonlyArray<Step>;
        readonly args: ReadonlyArray<string>;
      }> = [
        { id: "argument", script: reporting, args: [spec.root, "act", secret] },
        { id: "flag-value", script: reporting, args: [spec.root, "act", "--label", secret] },
        { id: "unknown-flag", script: reporting, args: [spec.root, "act", `--zz=${secret}`] },
        { id: "unknown-subcommand", script: reporting, args: [secret] },
        {
          id: "failure-message",
          script: [...reporting, Step.Fail({ value: new Broken({ message: secret }) })],
          args: [spec.root, "act", secret],
        },
        {
          id: "defect-message",
          script: [...reporting, Step.Die({ value: new Error(secret) })],
          args: [spec.root, "act", "--label", secret],
        },
      ];

      for (const flow of flows) {
        reached.add(flow.id);

        const world = yield* buildWorld(drawn, flow.script);
        const run = yield* runOn(world.repo, flow.args);

        expect(run.spans.length, `${flow.id}: the run is traced`).toBeGreaterThan(0);

        for (const span of run.spans) {
          for (const text of spanTexts(span)) {
            for (const form of secretForms(secret)) {
              expect(text.includes(form), `${flow.id}: ${span.name} holds the secret as ${JSON.stringify(form)}`).toBe(
                false,
              );
            }
          }
        }
      }

      expect(
        reachedAll(reached, [
          "argument",
          "flag-value",
          "unknown-flag",
          "unknown-subcommand",
          "failure-message",
          "defect-message",
        ]),
      ).toEqual([]);
    }),
  check,
);

// K18. Plant: provide every subcommand's Layer at the root, and one value wins in both handlers.
it.effect.prop(
  "K18 property: each subcommand gets its own Layer, so each handler prints its own Layer's value, and a value given at the root is never seen",
  { seed },
  ({ seed: drawn }) =>
    Effect.gen(function* () {
      const world = yield* buildWorld(drawn, [Step.Probe()], [Step.Probe()]);
      const rootValue = `root-${at(drawn.words, 5)}`;
      const environment = Layer.succeed(Probe, { value: rootValue });

      expect(new Set([...world.specs.map((spec) => spec.probe), rootValue]).size, "three different values").toBe(3);

      for (const spec of world.specs) {
        const run = yield* runOn(world.repo, [spec.root, "act"], environment);

        expect(run.code).toBe(0);
        expect(run.out, spec.root).toEqual([spec.probe]);
      }
    }),
  check,
);

/** The segments a handler may ask the current folder about: none, a relative path, a path up, an absolute one. */
const asks = (drawn: Seed): ReadonlyArray<ReadonlyArray<string>> => [
  [],
  [at(drawn.words, 0)],
  [at(drawn.words, 1), at(drawn.words, 2)],
  ["..", at(drawn.words, 3)],
  [".", at(drawn.words, 4)],
  [`/${at(drawn.words, 5)}`, at(drawn.words, 6)],
];

// K19. Plant: leave Node's Path as it is, and `path.resolve()` is the folder the test runs in, not the repo's.
it.effect.prop(
  "K19 property: kalfa decides the repo's root and hands it to every subcommand, so a handler's path.resolve() starts at that folder and not at the folder the process runs in",
  { seed },
  ({ seed: drawn }) =>
    Effect.gen(function* () {
      const folder = repoFolder(drawn);
      const script = asks(drawn).map((segments) => Step.Resolve({ segments }));
      const world = yield* buildWorld(drawn, script, script);

      expect((yield* Path.Path).resolve(), "the test's own folder is not the repo's").not.toBe(folder);

      for (const spec of world.specs) {
        const run = yield* runOn(world.repo, [spec.root, "act"]);

        expect(run.code, spec.root).toBe(0);
        expect(run.out, spec.root).toEqual(asks(drawn).map((segments) => posix.resolve(folder, ...segments)));
      }
    }).pipe(Effect.provide(Path.layer)),
  check,
);
