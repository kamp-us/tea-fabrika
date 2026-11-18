/**
 * `./cli`: the `records` command, the root a future `kalfa` finds through this package's `kalfa.cli`
 * field (decision 0585). One subcommand so far:
 *
 *   records check [status|patch|link|map]
 *
 * `check` runs all four checks, or the one named, in the folder it is run in (the repo's root). It prints
 * each finding as a line that starts with its place, and may go on in indented lines that say what to
 * do instead and which decision says so, then the count. It prints nothing and succeeds when there is
 * no finding. With findings it fails, so `pnpm lint` fails.
 */
import * as Load from "@kalfa/config/Load";
import { Config, Console, Effect, Option, Path, Schema } from "effect";
import { Argument, Command } from "effect/cli";
import type { Finding } from "./Finding.ts";
import { Finding as Findings } from "./Finding.ts";
import * as Frontmatter from "./Frontmatter.ts";
import * as Links from "./Links.ts";
import * as MapSize from "./MapSize.ts";
import * as Patches from "./Patches.ts";
import * as Settings from "./Settings.ts";

/** The checks, in the order `check` runs them. */
const NAMES = ["status", "patch", "link", "map"] as const;

/** `check` ran and found something. The findings are already printed. */
class Failed extends Schema.TaggedError<Failed, { readonly brand: unique symbol }>()("Failed", {
  count: Schema.Int,
}) {
  override get message(): string {
    return `${this.count} finding${this.count === 1 ? "" : "s"}`;
  }
}

/** The limit, from the environment and the repo's `.kalfa/kalfa.toml`, as every setting is loaded (0086). */
const limit = Effect.fnUntraced(function* (root: string) {
  const app = Settings.maxBytes.app;
  const read = (name: string) => Config.option(Config.String(name));

  const [moved, set, home] = yield* Effect.all([read(app.home), read(Settings.maxBytes.env), read("HOME")], {
    concurrency: 1,
  });

  const env = {
    ...Option.match(moved, { onNone: () => ({}), onSome: (value) => ({ [app.home]: value }) }),
    ...Option.match(set, { onNone: () => ({}), onSome: (value) => ({ [Settings.maxBytes.env]: value }) }),
  };

  const loaded = yield* Load.load(app.Setting.group({ maxBytes: Settings.maxBytes }), {
    repo: root,
    home: Option.getOrElse(home, () => "/"),
    flags: {},
    env,
    version: "0.0.0",
  });

  return loaded.values.maxBytes;
});

const checks = {
  status: Frontmatter.check,
  patch: Patches.check,
  link: Links.check,
  map: (root: string) => limit(root).pipe(Effect.flatMap((max) => MapSize.check(root, max))),
} as const;

const number = (value: number) => value.toLocaleString("en-US");

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
    map: ({ chain, bytes, max }) =>
      `${chain.join(" + ")}  ${number(bytes)} bytes, over records.map.max-bytes ${number(max)}.\n` +
      "  An agent stops adding instruction files at this size (0608).",
  });

/** Path order: the place a finding starts at, its line, then the shorter chain first. */
const place = (finding: Finding) =>
  Findings.match(finding, {
    status: ({ path, line }) => [path, line, 0] as const,
    patch: ({ path, line }) => [path, line, 0] as const,
    link: ({ path, line }) => [path, line, 0] as const,
    map: ({ chain }) => [chain[0] ?? "", 0, chain.length] as const,
  });

const order = (a: Finding, b: Finding) => {
  const [pathA, lineA, sizeA] = place(a);
  const [pathB, lineB, sizeB] = place(b);

  return pathA < pathB ? -1 : pathA > pathB ? 1 : lineA - lineB || sizeA - sizeB;
};

const check = Command.make(
  "check",
  {
    name: Argument.Literals("name", NAMES).pipe(
      Argument.withDescription("One check to run: status, patch, link or map. All four when left out"),
      Argument.optional,
    ),
  },
  Effect.fnUntraced(function* ({ name }) {
    const path = yield* Path.Path;
    const root = path.resolve();
    const chosen = Option.match(name, { onNone: () => NAMES, onSome: (one) => [one] });
    const found = (yield* Effect.forEach(chosen, (each) => checks[each](root), { concurrency: 1 })).flat().sort(order);

    if (found.length > 0) {
      yield* Console.log(found.map(words).join("\n"));
      yield* Console.log(new Failed({ count: found.length }).message);

      return yield* new Failed({ count: found.length });
    }
  }),
).pipe(
  Command.withDescription("Check the decisions and the instruction files: status, patches, links and the map's size"),
);

/**
 * The `records` command: the checks on our records.
 *
 * @category utils
 */
export const records = Command.make("records").pipe(
  Command.withDescription("The checks on our records (decisions 0605 to 0608)"),
  Command.withSubcommands([check]),
);
