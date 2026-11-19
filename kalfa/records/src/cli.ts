/**
 * `./cli`: the `records` command, the root a future `kalfa` finds through this package's `kalfa.cli`
 * field (decision 0585). One subcommand so far:
 *
 *   records check [status|patch|link|map|runbook]
 *
 * `check` runs the four checks on the records, or the one named, in the folder it is run in (the repo's root).
 * The runbook check (0571, 0611) runs only by its name. It prints
 * each finding as a line that starts with its place, and may go on in indented lines that say what to
 * do instead and which decision says so, then the count. A status, patch or link finding fails the
 * command, so `pnpm lint` fails. A map finding is advice (0610): its last line ends in "(advice)" and it never
 * fails the command. With nothing to say, `check` prints nothing and succeeds.
 */
import { Console, Effect, Option, Path, Schema } from "effect";
import { Argument, Command } from "effect/cli";
import type { Finding } from "./Finding.ts";
import { Finding as Findings } from "./Finding.ts";
import * as Frontmatter from "./Frontmatter.ts";
import * as Links from "./Links.ts";
import * as MapSize from "./MapSize.ts";
import * as Patches from "./Patches.ts";
import * as Runbooks from "./Runbooks.ts";

/** The checks, in the order `check` runs them. */
const NAMES = ["status", "patch", "link", "map", "runbook"] as const;

/** The checks a bare `check` runs: the four on the records. The runbook check runs by its name. */
const ALL = ["status", "patch", "link", "map"] as const;

/** `check` ran and found something. The findings are already printed. */
class Failed extends Schema.TaggedError<Failed, { readonly brand: unique symbol }>()("Failed", {
  count: Schema.Int,
}) {
  override get message(): string {
    return `${this.count} finding${this.count === 1 ? "" : "s"}`;
  }
}

const checks = {
  status: Frontmatter.check,
  patch: Patches.check,
  link: Links.check,
  map: MapSize.check,
  runbook: Runbooks.check,
} as const;

/** The words of a finding: its place first, then what to do instead and the decision that says so. */
const words = (finding: Finding) =>
  Findings.match(finding, {
    status: ({ path, line, raw }) =>
      `${path}:${line}  ${raw === "" ? "a missing or empty value" : `\`${raw}\``} is not what a decision's frontmatter holds.\n` +
      "  The id is the file's number, and the status is `accepted`, or `superseded` with " +
      '`successor: "NNNN"` naming a record in .decisions/ (0606).',
    patch: ({ path, line, form }) =>
      `${path}:${line}  ${
        form === "amendments"
          ? "an `## Amendments` section"
          : form === "still-holds"
            ? "a line that says the rest of an older record still holds"
            : "a line that says a rule is carried forward"
      }.\n  Edit the rule where it lives and say why in the new record; no record patches another (0605).`,
    link: ({ path, line, target, live }) =>
      `${path}:${line}  links ${target}, which is superseded.\n  Link ${live}, or the rule's home (0607).`,
    map: ({ path, lines, max }) =>
      `${path}  ${lines} lines, over ${max}.\n  A shorter map is followed better: move text to its home, as 0610 says (advice)`,
    runbook: ({ path, line, rule, raw }) => {
      const at = `${path}:${line}  `;

      switch (rule) {
        case "summary":
          return `${at}the runbook has no \`summary\` in its frontmatter.\n  Say in one line what happened and when to open this file (0571).`;
        case "follows":
          return `${at}the runbook has no \`follows\` list in its frontmatter.\n  List the decisions it follows, as quoted ids; no rule here may be one no decision holds (0571).`;
        case "unresolved":
          return `${at}follows \`${raw}\`, which is no accepted record in .decisions/.\n  Name the accepted record that holds the rule, or leave the rule out (0571, 0606).`;
        case "heading":
          return `${at}the sev runbook has no \`## ${raw}\` heading.\n  A sev runbook has Trigger, Roles, Steps, Exit and Comms, each a level-two heading (0571).`;
        case "unlinked":
          return `${at}the sev skill does not link this runbook.\n  Add it to the list in \`.agents/skills/sev/SKILL.md\` (0611).`;
        case "dangling":
          return `${at}links ${raw}, which is no tracked runbook.\n  Link a runbook that is there, or write the one it names (0611).`;
      }
    },
  });

/** Path order: the place a finding starts at, then its line. A map finding has no line. */
const place = (finding: Finding) =>
  Findings.match(finding, {
    status: ({ path, line }) => [path, line] as const,
    patch: ({ path, line }) => [path, line] as const,
    link: ({ path, line }) => [path, line] as const,
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
      Argument.withDescription(
        "One check to run: status, patch, link, map or runbook. The four on the records when left out",
      ),
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
).pipe(
  Command.withDescription(
    "Check the decisions and the instruction files: status, patches, links and the map's size; the runbooks by name",
  ),
);

/**
 * The `records` command: the checks on our records.
 *
 * @category utils
 */
export const records = Command.make("records").pipe(
  Command.withDescription("The checks on our records (decisions 0605 to 0607, and 0610 for the map)"),
  Command.withSubcommands([check]),
);
