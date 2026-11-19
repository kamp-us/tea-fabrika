// The runbooks check. Each tracked `.kalfa/runbooks/*.md` has a frontmatter `summary`; each `.kalfa/runbooks/sev-*.md` has the
// five headings Trigger, Roles, Steps, Exit and Comms; and the sev skill, `.agents/skills/sev/SKILL.md`, links every
// `.kalfa/runbooks/sev-*.md` and no runbook that is not there. Every law runs on a repo held in memory
// (Records.test-support.ts): none reads the repo's real `.kalfa/runbooks/` or starts git.
import { expect, it } from "@effect/vitest";
import { runsFor } from "@kampus/vitest";
import { Effect, Exit, Path, Schema } from "effect";
import { Command } from "effect/cli";
import { TestConsole } from "effect/testing";
import { records } from "./cli.ts";
import { Finding } from "./Finding.ts";
import { cliLayers, ROOT, slugOf, Words, world } from "./Records.test-support.ts";
import * as Runbooks from "./Runbooks.ts";

const check = { arbitrary: { seed: 119120, runs: runsFor({ fast: 50, full: 200 }) } };

const SKILL = ".agents/skills/sev/SKILL.md";

const HEADINGS = ["Trigger", "Roles", "Steps", "Exit", "Comms"] as const;

const SevFault = Schema.Literals(["none", "summary", "heading", "unlinked"]);

const PlainFault = Schema.Literals(["none", "summary"]);

const Sev = Schema.Struct({
  fault: SevFault,
  heading: Schema.Literals(HEADINGS),
  name: Words,
});

const Plain = Schema.Struct({ fault: PlainFault, name: Words });

/** A runbook's text: the frontmatter keys it keeps, and the headings it holds. */
const runbook = (fault: string, headings: ReadonlyArray<string>, heading: string) =>
  `${[
    "---",
    ...(fault === "summary" ? [] : ["summary: what happened and when to open this file"]),
    "---",
    "",
    "# A runbook",
    "",
    ...headings.flatMap((h) => (fault === "heading" && h === heading ? [] : [`## ${h}`, "", "- [ ] a step", ""])),
  ].join("\n")}\n`;

type Expected = { readonly path: string; readonly rule: string; readonly raw: string };

const order = (a: Expected, b: Expected) =>
  a.path + a.rule + a.raw < b.path + b.rule + b.raw ? -1 : a.path + a.rule + a.raw > b.path + b.rule + b.raw ? 1 : 0;

// Plants: ask for the headings of every
// runbook, not the sev ones; read the skill for only the first link; skip the skill's dangling links.
it.effect.prop(
  "R11 property: a runbook with no summary, a sev runbook that lacks one of its five headings, a sev runbook the skill does not link and a link in the skill to a sev runbook that is not there are each one finding, and a runbook with none of these is none",
  {
    sev: Schema.Array(Sev).check(Schema.isBetweenLength(1, 5)),
    plain: Schema.Array(Plain).check(Schema.isBetweenLength(0, 3)),
    dangling: Schema.Boolean,
    padding: Words,
  },
  ({ sev, plain, dangling, padding }) =>
    Effect.gen(function* () {
      const files: Record<string, string> = {
        // Not a runbook, and not read as one: a file that is not Markdown, and a page outside the folder.
        ".kalfa/runbooks/notes.txt": "no frontmatter here\n",
        "docs/plan/README.md": "---\nid: 7\n---\n\nA plan.\n",
        "AGENTS.md": "# Working here\n",
      };

      const expected: Array<Expected> = [];
      const linked: Array<string> = [];

      sev.forEach(({ fault, heading, name }, i) => {
        const path = `.kalfa/runbooks/sev-${i}-${slugOf(name)}.md`;
        const text = runbook(fault, HEADINGS, heading);
        files[path] = text;

        if (fault === "summary") {
          expected.push({ path, rule: fault, raw: "" });
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
        const path = `.kalfa/runbooks/${i}-${slugOf(name)}.md`;
        // A runbook that is not a sev one needs no headings at all.
        files[path] = runbook(fault, [], "");

        if (fault === "summary") {
          expected.push({ path, rule: fault, raw: "" });
        }

        // A link from the skill to a runbook that is there is no finding, whatever its name.
        linked.push(path);
      });

      const lines = [
        "# The sev skill",
        "",
        ...padding.map((w) => `${w}.`),
        ...linked.map((path, i) => `- [runbook ${i}](../../../${path})`),
        ...(dangling ? ["- [gone](../../../.kalfa/runbooks/sev-gone.md)"] : []),
        "- [a page](../../../docs/plan/README.md)",
      ];

      files[SKILL] = `${lines.join("\n")}\n`;

      if (dangling) {
        expected.push({ path: SKILL, rule: "dangling", raw: ".kalfa/runbooks/sev-gone.md" });
      }

      const all = yield* Runbooks.check(ROOT).pipe(Effect.provide(world(ROOT, files)));
      const found = all.filter(Finding.guards.runbook);

      expect(found, "only runbook findings").toHaveLength(all.length);

      expect(found.map(({ path, rule, raw }) => ({ path, rule, raw })).sort(order), JSON.stringify(found)).toEqual(
        expected.sort(order),
      );

      // The line of a dangling link is the link's.
      for (const finding of found) {
        if (finding.rule === "dangling") {
          expect(finding.line).toBe(
            (files[SKILL] ?? "").split("\n").findIndex((line) => line.startsWith("- [gone]")) + 1,
          );
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
        ".kalfa/runbooks/sev-x.md": sev,
        [SKILL]: "[x](../../../.kalfa/runbooks/sev-x.md)\n",
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
  { name: Words },
  ({ name }) =>
    Effect.gen(function* () {
      const path = `.kalfa/runbooks/${slugOf(name)}.md`;
      const good = runbook("none", [], "");

      const dirty = yield* run(["check", "runbook"], { [path]: runbook("summary", [], "") });

      expect(Exit.isFailure(dirty.exit), "a runbook finding fails the command").toBe(true);
      expect(dirty.printed[0]?.startsWith(path), dirty.printed.join("\n")).toBe(true);
      expect(dirty.printed.at(-1)).toMatch(/\b1 finding\b/);

      const clean = yield* run(["check", "runbook"], { [path]: good });

      expect(Exit.isSuccess(clean.exit)).toBe(true);
      expect(clean.printed).toEqual([]);
    }),
  check,
);
