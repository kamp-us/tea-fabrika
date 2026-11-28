// What the rule laws share: one `RuleTester` wired to run each case at once, so a failure throws into fast-check and
// shrinks; a way to state a generated file as lines, each with the number of reports the rule makes on it; a way to
// read the messages a rule writes; and one firing line for each of the eleven rules. It holds no law: vitest runs no
// `*.test-support.ts` file, so the laws that read the messages are in `index.test.ts`.
import type { Context, CreateRule } from "@oxlint/plugins";
import { Array as Arr } from "effect";
import { RuleTester } from "oxlint/plugins-dev";

RuleTester.describe = (_name, fn) => fn();

RuleTester.it = (_name, fn) => fn();

/** A neutral place to run from: a rule reads a path as oxlint gives it from where oxlint runs, so `src/a.ts` is the file `src/a.ts`. */
const tester = new RuleTester({ cwd: import.meta.dirname });

/** The file a case lints when it names none. */
const SAMPLE = "src/a.ts";

/** One line of a generated file, and how many reports the rule makes on it. */
export type Line = readonly [text: string, reports: number];

/** What a config can hold: JSON. */
export type Json = string | number | boolean | null | Array<Json> | { [key: string]: Json };

/** Where a case runs and what the rule is told: a file, and the options an oxlint config would give it. */
interface Setting {
  readonly filename?: string | undefined;
  readonly options?: ReadonlyArray<Json> | undefined;
}

/** Any message: the laws that use it hold what a rule does, not what it says. */
const ANY = /[\s\S]/;

/**
 * Lints a file made of lines, and fails when the rule's reports are not exactly the lines that say so: the file
 * with every reporting line left out reports nothing, and the whole file reports on each line as many times as
 * its line says. Oxlint names the rule `rule-to-test/<name>` here.
 */
export const check = (name: string, rule: CreateRule, lines: ReadonlyArray<Line>, setting: Setting = {}): void => {
  const at = {
    filename: setting.filename ?? SAMPLE,
    ...(setting.options === undefined ? {} : { options: [...setting.options] }),
  };

  const kept = Arr.flatMap(lines, ([text, reports]) => (reports === 0 ? [text] : []));
  const reported = Arr.flatMap(lines, ([, reports], i) => Arr.replicate({ line: i + 1, message: ANY }, reports));

  tester.run(name, rule, {
    valid: kept.length === 0 ? [] : [{ code: Arr.join(kept, "\n"), ...at }],
    invalid:
      reported.length === 0
        ? []
        : [
            {
              code: Arr.join(
                Arr.map(lines, ([text]) => text),
                "\n",
              ),
              ...at,
              errors: reported,
            },
          ],
  });
};

/** What the context holds under a key a proxy is asked for: the member of that name, or nothing. */
// SAFETY: a proxy is asked for any key, and reading a key the context lacks gives undefined, which is what the proxy hands back.
const held = (context: Context, key: string | symbol) => context[key as keyof Context];

/**
 * Every message a rule writes on one file. The file must report exactly `reports` times, which the tester holds;
 * the rule is run under a name of `rule-to-test/<name>`, the id a rule reads from its context here.
 */
export const messages = (name: string, rule: CreateRule, code: string, reports: number, setting: Setting = {}) => {
  const seen: Array<string> = [];

  const watched: CreateRule = {
    ...rule,
    create: (context) =>
      rule.create(
        new Proxy(context, {
          get: (target, key) =>
            key === "report"
              ? (diagnostic: Parameters<typeof target.report>[0]) => {
                  seen.push(String("message" in diagnostic ? diagnostic.message : ""));
                  target.report(diagnostic);
                }
              : held(target, key),
        }),
      ),
  };

  tester.run(name, watched, {
    valid: [],
    invalid: [
      {
        code,
        filename: setting.filename ?? SAMPLE,
        ...(setting.options === undefined ? {} : { options: [...setting.options] }),
        errors: reports,
      },
    ],
  });

  return seen;
};

/** The eleven rules, by the name each has in a config. */
export const RULES = [
  "effect-functions",
  "no-cause-squash",
  "no-context-tag",
  "no-data-taggederror",
  "no-effect-promise",
  "no-effect-run-outside-edge",
  "no-hand-tag",
  "no-promises",
  "no-raw-try-catch",
  "no-throw-in-effect-gen",
  "no-type-assertions",
] as const;

type RuleName = (typeof RULES)[number];

/** One file that makes the rule report, and how many times. */
interface Firing {
  readonly code: string;
  readonly reports: number;
}

/** A firing line for each rule, written from its top comment: the smallest file the rule refuses. */
export const FIRING: Readonly<Record<RuleName, Firing>> = {
  "effect-functions": {
    code: 'import { Effect } from "effect";\nexport const f = () => Effect.void.pipe(Effect.withSpan("s"));',
    reports: 1,
  },
  "no-cause-squash": {
    code: 'import { Cause } from "effect";\nexport const f = (c: Cause.Cause<unknown>) => Cause.squash(c);',
    reports: 1,
  },
  "no-context-tag": {
    code: 'import { Context } from "effect";\nexport const A = Context.Tag("a");',
    reports: 1,
  },
  "no-data-taggederror": {
    code: 'import { Data } from "effect";\nexport class A extends Data.TaggedError("A") {}',
    reports: 1,
  },
  "no-effect-promise": {
    code: 'import { Effect } from "effect";\nexport const a = Effect.promise(() => Promise.resolve(1));',
    reports: 1,
  },
  "no-effect-run-outside-edge": {
    code: 'import { Effect } from "effect";\nexport const a = Effect.runPromise(Effect.void);',
    reports: 1,
  },
  "no-hand-tag": { code: 'export const a = { _tag: "x" };', reports: 1 },
  "no-promises": { code: "export const a = async () => 1;", reports: 1 },
  "no-raw-try-catch": {
    code: 'import { Effect } from "effect";\nexport const e = Effect.void;\ntry { e; } catch { e; }',
    reports: 1,
  },
  "no-throw-in-effect-gen": {
    code: 'import { Effect } from "effect";\nexport const a = Effect.gen(function* () { throw new Error("a"); });',
    reports: 1,
  },
  "no-type-assertions": { code: "declare const x: number;\nexport const a = x as unknown as string;", reports: 1 },
};
