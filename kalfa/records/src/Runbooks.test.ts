// R11 of docs/plan/quests/sev-runbooks-PLAN.md (0611, after 0571): the runbooks check. Each tracked
// `.runbooks/*.md` has a frontmatter `summary` and a `follows` list; every id in `follows` names a record in
// `.decisions/` that is accepted; each `.runbooks/sev-*.md` has the five headings Trigger, Roles, Steps, Exit
// and Comms; and the sev skill, `.agents/skills/sev/SKILL.md`, links every `.runbooks/sev-*.md` and no
// runbook that is not there. Every law runs on a repo held in memory (Records.test-support.ts): none reads
// the repo's real `.runbooks/` or starts git.
//
// Assumed exports, which the build writes:
// - `Finding.ts`: a fifth case, `runbook`: `{ _tag: "runbook", path, line, rule, raw }`, `line` counted
//   from 1. The `rule` is one of
//   - `summary`: the runbook has no `summary` in its frontmatter;
//   - `follows`: it has no `follows` list;
//   - `unresolved`: an id in `follows` names no accepted record (no file, or a superseded one), `raw` that
//     id, `line` the line of `follows:`;
//   - `heading`: a sev runbook lacks `## <raw>`, `raw` one of the five heading names;
//   - `unlinked`: the sev skill does not link this sev runbook (`path` is the runbook);
//   - `dangling`: the sev skill links `.runbooks/sev-*.md`, `raw` that path from the root, which is not a
//     tracked file (`path` is the skill, `line` the line of the link).
// - `Runbooks.ts`: `check(root: string)`: `Effect<ReadonlyArray<Finding>, E, Tracked | FileSystem | Path>`.
// - `cli.ts`: `records check runbook`, the one check by its name; a runbook finding fails the command.
import { expect, it } from "@effect/vitest";
import { runsFor } from "@kampus/vitest";
import { Effect, Exit, Path, Schema } from "effect";
import { Command } from "effect/cli";
import { TestConsole } from "effect/testing";
import { records } from "./cli.ts";
import { Finding } from "./Finding.ts";
import { cliLayers, lineOf, pad, record, ROOT, slugOf, Words, world } from "./Records.test-support.ts";
import * as Runbooks from "./Runbooks.ts";

const check = { arbitrary: { seed: 119120, runs: runsFor({ fast: 50, full: 200 }) } };

const SKILL = ".agents/skills/sev/SKILL.md";

const HEADINGS = ["Trigger", "Roles", "Steps", "Exit", "Comms"] as const;

// Records the runbooks follow: two accepted, one superseded by the first, and a number with no file.
const ACCEPTED = ["0101", "0102"] as const;

const SUPERSEDED = "0103";

const GHOST = "0199";

const decisions = (): Record<string, string> => ({
  ".decisions/0101-a-rule.md": record({ id: "0101" }),
  ".decisions/0102-another-rule.md": record({ id: "0102" }),
  [`.decisions/${SUPERSEDED}-an-old-rule.md`]: record({ id: SUPERSEDED, status: "superseded", successor: "0101" }),
});

const SevFault = Schema.Literals(["none", "summary", "follows", "superseded", "ghost", "heading", "unlinked"]);

const PlainFault = Schema.Literals(["none", "summary", "follows", "superseded", "ghost"]);

const Sev = Schema.Struct({
  fault: SevFault,
  heading: Schema.Literals(HEADINGS),
  name: Words,
});

const Plain = Schema.Struct({ fault: PlainFault, name: Words });

/** A runbook's text: the frontmatter keys it keeps, and the headings it holds. */
const runbook = (fault: string, headings: ReadonlyArray<string>, heading: string) => {
  const ids = [...ACCEPTED, ...(fault === "superseded" ? [SUPERSEDED] : []), ...(fault === "ghost" ? [GHOST] : [])];

  return `${[
    "---",
    ...(fault === "summary" ? [] : ["summary: what happened and when to open this file"]),
    ...(fault === "follows" ? [] : [`follows: [${ids.map((id) => `"${id}"`).join(", ")}]`]),
    "---",
    "",
    "# A runbook",
    "",
    ...headings.flatMap((h) => (fault === "heading" && h === heading ? [] : [`## ${h}`, "", "- [ ] a step", ""])),
  ].join("\n")}\n`;
};

type Expected = { readonly path: string; readonly rule: string; readonly raw: string };

const order = (a: Expected, b: Expected) =>
  a.path + a.rule + a.raw < b.path + b.rule + b.raw ? -1 : a.path + a.rule + a.raw > b.path + b.rule + b.raw ? 1 : 0;

// Plants: do not read `follows`; count a superseded record as resolved; ask for the headings of every
// runbook, not the sev ones; read the skill for only the first link; skip the skill's dangling links.
it.effect.prop(
  "R11 property: a runbook with no summary or no follows, a follows id that is not an accepted record, a sev runbook that lacks one of its five headings, a sev runbook the skill does not link and a link in the skill to a sev runbook that is not there are each one finding, and a runbook with none of these is none",
  {
    sev: Schema.Array(Sev).check(Schema.isBetweenLength(1, 5)),
    plain: Schema.Array(Plain).check(Schema.isBetweenLength(0, 3)),
    dangling: Schema.Boolean,
    padding: Words,
  },
  ({ sev, plain, dangling, padding }) =>
    Effect.gen(function* () {
      const files: Record<string, string> = {
        ...decisions(),
        // Not a runbook, and not read as one: a file that is not Markdown, and a page outside the folder.
        ".runbooks/notes.txt": "no frontmatter here\n",
        "docs/plan/README.md": "---\nid: 7\n---\n\nA plan.\n",
        "AGENTS.md": "# Working here\n",
      };

      const expected: Array<Expected> = [];
      const linked: Array<string> = [];

      sev.forEach(({ fault, heading, name }, i) => {
        const path = `.runbooks/sev-${i}-${slugOf(name)}.md`;
        const text = runbook(fault, HEADINGS, heading);
        files[path] = text;

        if (fault === "summary" || fault === "follows") {
          expected.push({ path, rule: fault, raw: "" });
        }

        if (fault === "superseded" || fault === "ghost") {
          expected.push({ path, rule: "unresolved", raw: fault === "ghost" ? GHOST : SUPERSEDED });
        }

        if (fault === "heading") {
          expected.push({ path, rule: "heading", raw: heading });
        }

        if (fault === "unlinked") {
          expected.push({ path, rule: "unlinked", raw: "" });
        } else {
          linked.push(path);
        }
      });

      plain.forEach(({ fault, name }, i) => {
        const path = `.runbooks/${i}-${slugOf(name)}.md`;
        // A runbook that is not a sev one needs no headings at all.
        files[path] = runbook(fault, [], "");

        if (fault === "summary" || fault === "follows") {
          expected.push({ path, rule: fault, raw: "" });
        }

        if (fault === "superseded" || fault === "ghost") {
          expected.push({ path, rule: "unresolved", raw: fault === "ghost" ? GHOST : SUPERSEDED });
        }

        // A link from the skill to a runbook that is there is no finding, whatever its name.
        linked.push(path);
      });

      const lines = [
        "# The sev skill",
        "",
        ...padding.map((w) => `${w}.`),
        ...linked.map((path, i) => `- [runbook ${i}](../../../${path})`),
        ...(dangling ? ["- [gone](../../../.runbooks/sev-gone.md)"] : []),
        "- [a decision](../../../.decisions/0101-a-rule.md)",
      ];

      files[SKILL] = `${lines.join("\n")}\n`;

      if (dangling) {
        expected.push({ path: SKILL, rule: "dangling", raw: ".runbooks/sev-gone.md" });
      }

      const all = yield* Runbooks.check(ROOT).pipe(Effect.provide(world(ROOT, files)));
      const found = all.filter(Finding.guards.runbook);

      expect(found, "only runbook findings").toHaveLength(all.length);

      expect(found.map(({ path, rule, raw }) => ({ path, rule, raw })).sort(order), JSON.stringify(found)).toEqual(
        expected.sort(order),
      );

      // The line of an id that resolves to nothing is its `follows:` line, and of a dangling link, the link's.
      for (const finding of found) {
        if (finding.rule === "unresolved") {
          expect(finding.line).toBe(lineOf(files[finding.path] ?? "", "follows:"));
        }

        if (finding.rule === "dangling") {
          expect(finding.line).toBe(lineOf(files[SKILL] ?? "", "- [gone]"));
        }
      }
    }),
  check,
);

// Plant: ask for `## Roles` only when `## Trigger` is there; accept `### Exit` as a heading.
it.effect(
  "R11 scenario: a heading is a level-two heading of its own, so a deeper one and a mention in a sentence do not count",
  () =>
    Effect.gen(function* () {
      const sev = [
        "---",
        "summary: s",
        'follows: ["0101"]',
        "---",
        "",
        "# A sev runbook",
        "",
        "## Trigger",
        "## Roles",
        "## Steps",
        "### Exit",
        "The Comms are told in a sentence.",
        "",
      ].join("\n");

      const files = {
        ...decisions(),
        ".runbooks/sev-x.md": sev,
        [SKILL]: "[x](../../../.runbooks/sev-x.md)\n",
      };

      const found = yield* Runbooks.check(ROOT).pipe(Effect.provide(world(ROOT, files)));

      expect(
        found.filter(Finding.guards.runbook).map(({ rule, raw }) => [rule, raw]),
        JSON.stringify(found),
      ).toEqual(
        expect.arrayContaining([
          ["heading", "Exit"],
          ["heading", "Comms"],
        ]),
      );
      expect(found).toHaveLength(2);
    }),
);

/** Runs `records ...args` on the repo and answers its exit and the lines it printed. */
const run = (args: ReadonlyArray<string>, files: Record<string, string>) =>
  Effect.gen(function* () {
    const path = yield* Path.Path;
    const root = path.resolve();
    // The console keeps every line of the test: this run's are those after what was already there.
    const already = (yield* TestConsole.logLines).length;

    const exit = yield* Effect.exit(
      Command.runWith(records, { version: "0.0.0" })(args).pipe(Effect.provide(cliLayers(root, files))),
    );

    const printed = (yield* TestConsole.logLines).slice(already).flatMap((line) => String(line).split("\n"));

    return { exit, printed };
  }).pipe(Effect.provide(Path.layer));

// Plant: leave `runbook` out of the names `check` takes, or run it with `check status`.
it.effect.prop(
  "R11 property: `records check runbook` runs only the runbook check, prints a block that starts with the runbook's path and a count, and fails on a finding; a clean repo prints nothing and succeeds",
  // The number stays clear of the records the runbooks follow (0101 to 0103) and of the one that does not exist.
  { name: Words, n: Schema.Int.check(Schema.isBetween({ minimum: 200, maximum: 9998 })) },
  ({ name, n }) =>
    Effect.gen(function* () {
      const path = `.runbooks/${slugOf(name)}.md`;
      const good = runbook("none", [], "");

      // A decision whose status is wrong too: the status check would report it, the runbook check must not.
      const status = {
        ...decisions(),
        [`.decisions/${pad(n)}-a-rule.md`]: record({ id: pad(n), status: "amended" }),
      };

      const dirty = yield* run(["check", "runbook"], { ...status, [path]: runbook("summary", [], "") });

      expect(Exit.isFailure(dirty.exit), "a runbook finding fails the command").toBe(true);
      expect(dirty.printed[0]?.startsWith(path), dirty.printed.join("\n")).toBe(true);
      expect(dirty.printed.join("\n")).not.toContain(".decisions/");
      expect(dirty.printed.at(-1)).toMatch(/\b1 finding\b/);

      const clean = yield* run(["check", "runbook"], { ...status, [path]: good });

      expect(Exit.isSuccess(clean.exit)).toBe(true);
      expect(clean.printed).toEqual([]);
    }),
  check,
);
