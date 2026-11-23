/**
 * `./cli`: the `records` command, the root a future `kalfa` will find once this package exports a `subcommand`
 * made with `@kalfa/cli/Subcommand`. One subcommand so far:
 *
 *   records check [map|runbook]
 *
 * `check` runs the map check, or the one named, in the folder it is run in (the repo's root). The runbook
 * check runs only by its name. It prints each finding as a line that starts with its place, and may go on in
 * indented lines that say what to do instead, then the count. A runbook finding fails the command, so
 * `pnpm lint` fails. A map finding is advice: its last line ends in "(advice)" and it never fails the
 * command. With nothing to say, `check` prints nothing and succeeds.
 */
import { Console, Effect, Option, Path, Schema } from "effect";
import { Argument, Command } from "effect/cli";
import type { Finding } from "./Finding.ts";
import { Finding as Findings } from "./Finding.ts";
import * as MapSize from "./MapSize.ts";
import * as Runbooks from "./Runbooks.ts";

/** The checks, in the order `check` runs them. */
const NAMES = ["map", "runbook"] as const;

/** The checks a bare `check` runs. The runbook check runs by its name. */
const ALL = ["map"] as const;

/** `check` ran and found something. The findings are already printed. */
class Failed extends Schema.TaggedError<Failed, { readonly brand: unique symbol }>()("Failed", {
  count: Schema.Int,
}) {
  override get message(): string {
    return `${this.count} finding${this.count === 1 ? "" : "s"}`;
  }
}

const checks = {
  map: MapSize.check,
  runbook: Runbooks.check,
} as const;

/** The words of a finding: its place first, then what to do instead. */
const words = (finding: Finding) =>
  Findings.match(finding, {
    map: ({ path, lines, max }) =>
      `${path}  ${lines} lines, over ${max}.\n  A shorter map is followed better: move text to its home (advice)`,
    runbook: ({ path, line, rule, raw }) => {
      const at = `${path}:${line}  `;

      switch (rule) {
        case "summary":
          return `${at}the runbook has no \`summary\` in its frontmatter.\n  Say in one line what happened and when to open this file`;
        case "heading":
          return `${at}the sev runbook has no \`## ${raw}\` heading.\n  A sev runbook has Trigger, Roles, Steps, Exit and Comms, each a level-two heading`;
        case "unlinked":
          return `${at}the sev skill does not link this runbook.\n  Add it to the list in \`.agents/skills/sev/SKILL.md\``;
        case "dangling":
          return `${at}links ${raw}, which is no tracked runbook.\n  Link a runbook that is there, or write the one it names`;
      }
    },
  });

/** Path order: the place a finding starts at, then its line. A map finding has no line. */
const place = (finding: Finding) =>
  Findings.match(finding, {
    map: ({ path }) => [path, 0] as const,
    runbook: ({ path, line }) => [path, line] as const,
  });

const order = (a: Finding, b: Finding) => {
  const [pathA, lineA] = place(a);
  const [pathB, lineB] = place(b);

  return pathA < pathB ? -1 : pathA > pathB ? 1 : lineA - lineB;
};

/** The count line: only the parts that are not zero, as "3 findings, 1 advice", "3 findings" or "1 advice". */
const count = (findings: number, advice: number) =>
  [
    ...(findings > 0 ? [`${findings} finding${findings === 1 ? "" : "s"}`] : []),
    ...(advice > 0 ? [`${advice} advice`] : []),
  ].join(", ");

const check = Command.make(
  "check",
  {
    name: Argument.Literals("name", NAMES).pipe(
      Argument.withDescription("One check to run: map or runbook. The map when left out"),
      Argument.optional,
    ),
  },
  Effect.fnUntraced(function* ({ name }) {
    const path = yield* Path.Path;
    const root = path.resolve();
    const chosen = Option.match(name, { onNone: () => ALL, onSome: (one) => [one] });
    const found = (yield* Effect.forEach(chosen, (each) => checks[each](root), { concurrency: 1 })).flat().sort(order);

    const advice = found.filter(Findings.guards.map).length;
    const failing = found.length - advice;

    if (found.length > 0) {
      yield* Console.log(found.map(words).join("\n"));
      yield* Console.log(count(failing, advice));
    }

    if (failing > 0) {
      return yield* new Failed({ count: failing });
    }
  }),
).pipe(Command.withDescription("Check the instruction files' size; the runbooks by name"));

/**
 * The `records` command: the checks on our records.
 *
 * @category utils
 */
export const records = Command.make("records").pipe(
  Command.withDescription("The checks on our records"),
  Command.withSubcommands([check]),
);
