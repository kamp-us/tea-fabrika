// L3 and L4 of docs/plan/quests/rules-and-records-build-PLAN.md (slice 8, 0605): no record patches another.
// A `## Amendments` heading, a still-holds line and a carried-forward line in a decision are each one
// `patch` finding with their line and form. The same text in a fenced block or in inline code, a history
// line, and a plan file outside `.decisions/` are none.
//
// Assumed export, `Patches.ts`: `check(root: string)`: `Effect<ReadonlyArray<Finding>, E, Tracked |
// FileSystem | Path>`; a finding is `{ _tag: "patch", path, line, form }`, `line` counted from 1 in the whole
// file, frontmatter included, `form` one of "amendments", "still-holds" and "carried-forward". It reads the
// tracked `.decisions/NNNN-slug.md` files only.
//
// The still-holds and carried-forward forms are read as a sentence of a block (the lead's rule after the finding
// on .decisions/0414, and the two measured false alarms after it): a block is a heading, a paragraph, a list
// item's paragraph or a table cell, read as Markdown, outside fenced code, with inline code removed and each
// link replaced by its text. A sentence ends at `.`, `!` or `?` followed by a space or the block's end. A form
// fires only when its sentence, or the one before it in the same block, holds a record reference: a four-digit
// number that is not part of a date, or a link to a `NNNN-slug.md` record, written inline or reference-style.
// The finding's `line` is the file line where the match begins, the line that holds "rest" or "carried". The `## Amendments` heading stays a match of the heading alone.
//
// No law reads a committed record: another slice of this quest edits those, so each real shape is fixture text
// below, with the commit or finding it came from.
//
// Each run builds one record that holds every positive form, every form in a fence and in inline code, and
// a history line, in a generated order among generated prose, so each case is reached in every run.
import { expect, it } from "@effect/vitest";
import { runsFor } from "@kampus/vitest";
import { Effect, Schema } from "effect";
import { Finding } from "./Finding.ts";
import * as Patches from "./Patches.ts";
import {
  distinct,
  Number4,
  pad,
  Phrasing,
  record,
  ROOT,
  sentence,
  slugOf,
  Words,
  world,
} from "./Records.test-support.ts";

const check = { arbitrary: { seed: 119120, runs: runsFor({ fast: 50, full: 200 }) } };

type Form = "amendments" | "still-holds" | "carried-forward";

const FORMS: ReadonlyArray<Form> = ["amendments", "still-holds", "carried-forward"];

// Eight phrasings of each of 0605's three forms, as the regexes of the plan read them, each with a record
// reference in its sentence. The heading has two, since its form is the heading itself.
const PHRASINGS: Record<Form, ReadonlyArray<string>> = {
  amendments: ["## Amendments", "## Amendments "],
  "still-holds": [
    "The rest of 0066 still holds.",
    "The rest of 0066 holds.",
    "The rest of this record, 0066, still holds as written.",
    "the rest of the rule in 0066 holds",
    "The rest of 0049 (the budget numbers) still holds.",
    "Everything else in 0066 changes; the rest stays in force and holds.",
    "THE REST OF 0012 STILL HOLDS.",
    "- The rest of 0066, unchanged, still holds.",
  ],
  "carried-forward": [
    "The rule is carried forward from 0012.",
    "Carried forward unchanged from 0012.",
    "carried forward from the older record 0012: use it.",
    "- Carried forward: the budget of 0012 stays.",
    "This section is CARRIED FORWARD as written from 0012.",
    "The limit, carried forward from 0012, is 12.",
    "Rules carried forward from 0030 to 0031:",
    "(carried forward, 0012)",
  ],
};

// The same words with no record reference in their sentence: plain English, no finding. The first of each is
// the shape of .decisions/0227's false alarm; the others are the first phrasings above with the number gone.
const PLAIN: ReadonlyArray<string> = [
  "This walks back the old note for state carried forward.",
  "The rest of this record still holds as written.",
  "the rest of the rule holds",
  "Carried forward unchanged.",
  "carried forward from the older record: use it.",
  "- Carried forward: the budget stays.",
  "The owner ruled on 2026-11-18: the rest holds, for now.",
  "The limit, carried forward, is 12.5 and the rest holds.",
];

const phrase = (form: Form, phrasing: number) => PHRASINGS[form][phrasing % PHRASINGS[form].length]!;

/** The first line of a record's body, counted from 1. */
const BODY_AT =
  record({ id: "0001", body: ["BODY"] })
    .split("\n")
    .indexOf("BODY") + 1;

type Block =
  | { readonly _tag: "prose"; readonly text: string }
  | { readonly _tag: "hit"; readonly form: Form; readonly phrasing: number }
  | {
      readonly _tag: "fence";
      readonly fence: string;
      readonly info: string;
      readonly inside: ReadonlyArray<{ readonly form: Form; readonly phrasing: number }>;
    }
  | { readonly _tag: "inline"; readonly form: Form; readonly phrasing: number; readonly lead: string }
  | { readonly _tag: "history"; readonly id: string; readonly date: string }
  | { readonly _tag: "plain"; readonly phrasing: number }
  | {
      readonly _tag: "text";
      readonly lines: ReadonlyArray<string>;
      readonly hit: { readonly at: number; readonly form: Form } | undefined;
    };

/** Shapes of a still-holds or carried-forward line over a line break, with Markdown links in them. */
const MULTI = 14;

const multi = (variant: number, a: string, b: string, name: string): Block => {
  const one = `[${a}](${a}-${name}.md)`;
  const two = `[${b}](./${b}-${name}.md)`;
  const still = { at: 0, form: "still-holds" } as const;

  switch (variant % MULTI) {
    case 0:
      // 0414's shape: the second link opens the next line.
      return { _tag: "text", lines: [`The rest of ${one} and`, `${two} holds: a floor per question.`], hit: still };
    case 1:
      return { _tag: "text", lines: [`The rest of [${a}](./${a}-${name}.md) still`, "holds as written."], hit: still };
    case 2:
      // The break falls inside a link's text.
      return { _tag: "text", lines: [`The rest of [${a} and`, `${b}](${a}-${name}.md) holds.`], hit: still };
    case 3:
      // A reference-style link, its definition after a blank line.
      return {
        _tag: "text",
        lines: [`The rest of [${a}][r${a}] and the`, "other record holds.", "", `[r${a}]: ./${a}-${name}.md`],
        hit: still,
      };
    case 4:
      // 0414 itself: a list item whose second line holds "rest".
      return {
        _tag: "text",
        lines: [
          "- It is measured against hand labels, for the",
          `  false alarms. The rest of ${one} and`,
          `  ${two} holds: a floor per question.`,
        ],
        hit: { at: 1, form: "still-holds" },
      };
    case 5:
      return {
        _tag: "text",
        lines: ["The rule is carried", `forward from ${one}.`],
        hit: { at: 0, form: "carried-forward" },
      };
    case 6:
      return { _tag: "text", lines: [`1. The rest of ${one} and`, `   ${two} still holds.`], hit: still };
    case 7:
      // A heading's own text is a block: the finding is on the heading's line.
      return { _tag: "text", lines: [`## The rest of ${a} still holds`], hit: still };
    case 8:
      // A cell is a block: the match and its record reference are in one cell, a later row is another.
      return {
        _tag: "text",
        lines: ["| rule | note |", "| --- | --- |", `| ${name} | The rest of ${one} holds. |`],
        hit: { at: 2, form: "still-holds" },
      };
    case 9:
      // A `1)` item, which .decisions/0093 uses.
      return { _tag: "text", lines: [`1) The rest of ${one} and`, `   ${two} still holds.`], hit: still };
    case 10:
      // The only record reference is a link with word text: no number is written, in the same sentence.
      return { _tag: "text", lines: [`The rest of [the merge rule](${a}-${name}.md) still holds.`], hit: still };
    case 11:
      // The same, written reference-style: the reference is in the definition's target.
      return {
        _tag: "text",
        lines: [`The rest of [the merge rule][m${a}] still`, "holds.", "", `[m${a}]: ./${a}-${name}.md`],
        hit: still,
      };
    case 12:
      // The link with word text is in the sentence before the one that says the rest holds.
      return {
        _tag: "text",
        lines: [`[the merge rule](${a}-${name}.md) adds one change.`, "The rest of the file still holds."],
        hit: { at: 1, form: "still-holds" },
      };
    default:
      return {
        _tag: "text",
        lines: [
          `[the merge rule][n${a}] adds one change to the file.`,
          "The rest of the file still holds.",
          "",
          `[n${a}]: ./${a}-${name}.md`,
        ],
        hit: { at: 1, form: "still-holds" },
      };
  }
};

const SPLITS = ["bullets", "heading", "paragraphs", "cells", "far"] as const;

/** "rest" in one block and "holds" in the next, or a record reference two sentences back: no finding, whatever separates them. */
const split = (kind: (typeof SPLITS)[number], marker: string, id: string): Block => ({
  _tag: "text",
  lines:
    kind === "bullets"
      ? [`${marker} The rest of ${id} is small`, `${marker} the next rule holds as written.`]
      : kind === "heading"
        ? [`The rest of ${id} is small,`, "### Later", "holds as written."]
        : kind === "cells"
          ? // Rows of a table are not one sentence: the cell with "rest" and the cell with "holds" are two blocks.
            ["| a | b |", "| --- | --- |", `| the rest of ${id} | x |`, "| y | holds as written. |"]
          : kind === "far"
            ? // The record reference is two sentences before the one that says the rest holds: too far.
              [`See [the merge rule](${id}-x.md) for it.`, "A plain sentence.", "The rest of the file still holds."]
            : [`The rest of ${id} is small,`, "", "holds as written."],
  hit: undefined,
});

/** Lines of a body, and the hits among them, counted from the body's first line. */
const render = (blocks: ReadonlyArray<Block>) => {
  const lines: Array<string> = [];
  const hits: Array<{ line: number; form: Form }> = [];

  for (const block of blocks) {
    switch (block._tag) {
      case "prose":
        lines.push(block.text);
        break;
      case "hit":
        hits.push({ line: lines.length, form: block.form });
        lines.push(phrase(block.form, block.phrasing));
        break;
      case "fence":
        lines.push(`${block.fence}${block.info}`);

        for (const inside of block.inside) {
          lines.push(phrase(inside.form, inside.phrasing));
        }

        lines.push(block.fence);
        break;
      case "inline":
        lines.push(`${block.lead} \`${phrase(block.form, block.phrasing)}\` in a line.`);
        break;
      case "history":
        lines.push(`${block.id} was superseded on ${block.date}.`);
        break;
      case "plain":
        lines.push(PLAIN[block.phrasing % PLAIN.length]!);
        break;
      case "text":
        if (block.hit !== undefined) {
          hits.push({ line: lines.length + block.hit.at, form: block.hit.form });
        }

        lines.push(...block.lines);
        break;
    }

    lines.push("");
  }

  return { lines, hits };
};

/** The required blocks of `arrange`: three hits, three inline, a fence, a history line, four prose, and each shape below. */
const SPOTS = 3 + 3 + 1 + 1 + 4 + MULTI + SPLITS.length + PLAIN.length;

/** The ways a list item starts. */
const MARKERS = ["-", "*", "+", "1.", "1)"] as const;

const Extra = Schema.Struct({
  at: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 40 })),
  kind: Schema.Literals(["prose", "hit", "inline", "history", "fence", "multi", "split", "plain"]),
  form: Schema.Literals(FORMS),
  phrasing: Phrasing,
  words: Words,
});

const Blocks = Schema.Struct({
  phrasings: Schema.Array(Phrasing).check(Schema.isBetweenLength(SPOTS, SPOTS)),
  // The required blocks go in the order of these keys: a permutation, different in each run.
  keys: Schema.Array(Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 999 }))).check(
    Schema.isBetweenLength(SPOTS, SPOTS),
  ),
  fence: Schema.Literals(["```", "~~~", "````"]),
  info: Schema.Literals(["", "md", "text", "ts"]),
  words: Words,
  date: Schema.Literals(["2026-11-12", "2026-11-16", "2026-11-18"]),
  number: Number4,
  extras: Schema.Array(Extra).check(Schema.isBetweenLength(0, 6)),
});

const arrange = (d: typeof Blocks.Type): ReadonlyArray<Block> => {
  const lead = sentence(d.words);
  const id = pad(d.number);
  const other = pad((d.number % 9999) + 1);
  const name = slugOf(d.words);

  const wanted: ReadonlyArray<Block> = [
    ...FORMS.map((form, i): Block => ({ _tag: "hit", form, phrasing: d.phrasings[i]! })),
    ...FORMS.map((form, i): Block => ({ _tag: "inline", form, phrasing: d.phrasings[3 + i]!, lead })),
    {
      _tag: "fence",
      fence: d.fence,
      info: d.info,
      inside: FORMS.map((form, i) => ({ form, phrasing: d.phrasings[6 + i]! })),
    },
    { _tag: "history", id, date: d.date },
    { _tag: "prose", text: lead },
    { _tag: "prose", text: lead },
    { _tag: "prose", text: lead },
    { _tag: "prose", text: lead },
    // Every shape over a line break, each in every run, and every way to keep "rest" and "holds" apart.
    ...Array.from({ length: MULTI }, (_, i) => multi(i, id, other, name)),
    ...SPLITS.map((kind, i) => split(kind, MARKERS[d.phrasings[12 + i]! % MARKERS.length]!, id)),
    // The words of a form with no record reference, each in every run.
    ...PLAIN.map((_, i): Block => ({ _tag: "plain", phrasing: i })),
  ];

  const placed = d.keys
    .map((key, i) => ({ key, i }))
    .sort((a, b) => a.key - b.key || a.i - b.i)
    .map(({ i }) => wanted[i]!);

  for (const extra of d.extras) {
    const block: Block =
      extra.kind === "prose"
        ? { _tag: "prose", text: sentence(extra.words) }
        : extra.kind === "hit"
          ? { _tag: "hit", form: extra.form, phrasing: extra.phrasing }
          : extra.kind === "inline"
            ? { _tag: "inline", form: extra.form, phrasing: extra.phrasing, lead: sentence(extra.words) }
            : extra.kind === "history"
              ? { _tag: "history", id, date: d.date }
              : extra.kind === "multi"
                ? multi(extra.phrasing, id, other, name)
                : extra.kind === "split"
                  ? split(SPLITS[extra.phrasing % SPLITS.length]!, MARKERS[extra.at % MARKERS.length]!, id)
                  : extra.kind === "plain"
                    ? { _tag: "plain", phrasing: extra.phrasing }
                    : {
                        _tag: "fence",
                        fence: d.fence,
                        info: d.info,
                        inside: [{ form: extra.form, phrasing: extra.phrasing }],
                      };

    placed.splice(extra.at % (placed.length + 1), 0, block);
  }

  return placed;
};

// Plants: stop skipping fenced code, so the fenced forms (0605's own opening block) are findings; or match line
// by line again, so every shape over a line break is missed.
it.effect.prop(
  "L3 an Amendments heading, a still-holds line and a carried-forward line are patch findings; the same text in fenced or inline code, a history line, and a plan file outside .decisions are none",
  {
    drawn: Blocks,
    numbers: Schema.Array(Number4).check(Schema.isBetweenLength(2, 2)),
    names: Schema.Array(Words).check(Schema.isBetweenLength(2, 2)),
    lone: Schema.Struct({ form: Schema.Literals(FORMS), phrasing: Phrasing, before: Words, after: Words }),
  },
  ({ drawn, numbers, names, lone }) =>
    Effect.gen(function* () {
      const body = render(arrange(drawn));
      const ids = distinct(numbers).map(pad);
      const first = `.decisions/${ids[0]}-${slugOf(names[0]!)}.md`;
      const second = `.decisions/${ids[1]}-${slugOf(names[1]!)}.md`;

      // The same text where the check does not read: a plan file, whose `###` heading is the plan's own form.
      const outside = [
        "# A plan",
        "",
        "### Amendments",
        "## Amendments",
        ...FORMS.filter((form) => form !== "amendments").map((form) => phrase(form, drawn.phrasings[0]!)),
        "",
      ].join("\n");

      const all = yield* Patches.check(ROOT).pipe(
        Effect.provide(
          world(ROOT, {
            [first]: record({ id: ids[0]!, body: body.lines }),
            [second]: record({
              id: ids[1]!,
              body: [sentence(lone.before), phrase(lone.form, lone.phrasing), sentence(lone.after)],
            }),
            "docs/plan/a-plan.md": outside,
            "docs/plan/README.md": "### Amendments\n",
          }),
        ),
      );

      const found = all.filter(Finding.guards.patch);

      expect(found, "only patch findings").toHaveLength(all.length);

      const expected = [
        ...body.hits.map(({ line, form }) => ({ _tag: "patch", path: first, line: BODY_AT + line, form })),
        { _tag: "patch", path: second, line: BODY_AT + 1, form: lone.form },
      ];

      const order = (a: { path: string; line: number }, b: { path: string; line: number }) =>
        a.path < b.path ? -1 : a.path > b.path ? 1 : a.line - b.line;

      // Each form is found in the first record in every run: the three plain hits are there by construction.
      expect(new Set(body.hits.map(({ form }) => form))).toEqual(new Set(FORMS));
      expect([...found].sort(order)).toEqual(expected.sort(order));
    }),
  check,
);

/** .decisions/0605, as of commit 604bbcf0b, cut to the shape that matters: its forbidden forms quoted in a fence, and named in inline code. */
const RECORD_0605 = [
  "---",
  "id: 0605",
  "title: A rule changes where it lives, and no record patches another with an Amendments section, a still-holds line or a carried-forward copy, held by a records check in pnpm lint",
  "status: accepted",
  "date: 2026-11-18",
  "tags: [records, decisions, amendments, rules, lint, kalfa-records]",
  "---",
  "",
  "# 0605: A rule changes where it lives, and no record patches another",
  "",
  "```text",
  "a ruling that changes a rule",
  "  -> one edit to the rule's home (a check, a config file, the instruction read for that job,",
  "     or the record itself while it is still the home), in the same pull request",
  "  -> one new record that says why, and in its context what it changed",
  "never",
  "  ## Amendments                         a heading in a record",
  '  "the rest of 0534 still holds"        a line that patches a record from outside',
  '  "carried forward from 0023: ..."      a copy of another record\'s rule',
  "```",
  "",
  "## Decision",
  "",
  "**A change to a rule edits the rule's home in the same pull request as the record of why, and no",
  "record holds an `## Amendments` heading, a still-holds line or a carried-forward copy of another",
  "record's rule.**",
  "",
  "- A record whose why was reversed whole is superseded whole ([0606](0606-a-record-is-accepted-or-superseded.md)).",
  "- A line that only tells history (`0146 was superseded on 2026-11-12`) is not a patch and stays.",
  "",
].join("\n");

/** .decisions/0414, as of commit 7b63f09b0: the one still-holds line, in a list item, over a line break, in two links. */
const RECORD_0414 = [
  "---",
  "id: 0414",
  "title: A new Jev question asked at volume is measured against hand labels written before the run and controls, and a saved agent turn counts the person's plan quota as well as dollars",
  "status: accepted",
  "date: 2026-10-28",
  "tags: [jev, judge, measurement, cost]",
  "---",
  "",
  "# 0414: A new Jev question asked at volume is measured against hand labels written before the run and controls, and a saved agent turn counts the person's plan quota as well as dollars",
  "",
  "```ts",
  "// A sketch, from the note: the duplicate hint, asked on every filing.",
  "const scores = yield* scoresOf(filed, candidatesOf(filed, openOf(tickets, filed.number)));",
  "hintsOf(scores); // [{of: 6, yes: 0.78}]: advice, with accept and dismiss",
  "```",
  "",
  "**What this decides:** how a Jev use that no agent ever asked is measured, and what an agent turn",
  "costs.",
  "",
  "## Context",
  "",
  "From [Jev, changed 2026-10-28](../docs/direction/jev-same-answer-cheaper.md#changed-2026-10-28),",
  "decided with the first live use, the duplicate hint ([experiment 167](../experiments/167-duplicate-hint.md)):",
  "1,638 calls for $0.05.",
  "",
  "## Decision",
  "",
  "**A question asked only because a call is cheap has no agent answer to agree with.**",
  "",
  "- It is measured against hand labels written before the run, for the hits, and controls, for the",
  "  false alarms. The rest of [0412](0412-jev-is-measured-by-agreement.md) and",
  "  [0413](0413-a-jev-question-is-narrow.md) holds: a floor per question, advice not an action, never",
  "  a person removed.",
  "- Each person runs agents on their own plan, so a saved agent turn counts twice: the dollars, and",
  "  the turns left in that person's plan quota.",
  "",
  "## Consequences",
  "",
  "- How much a turn costs in quota is not measured; providers set and change plan limits.",
].join("\n");

// Plant: match the still-holds pattern on the raw text, fenced and inline code included.
it.effect(
  "L4 scenario: a record that quotes the forbidden forms in a fence and in code (0605, as of 604bbcf0b) has no patch finding",
  () =>
    Effect.gen(function* () {
      const found = yield* Patches.check(ROOT).pipe(
        Effect.provide(world(ROOT, { ".decisions/0605-no-record-patches-another.md": RECORD_0605 })),
      );

      expect(found).toEqual([]);
    }),
);

/** The line of the one still-holds finding in 0414: "The rest of [0412](...) and", in a list item. */
const LINE_0414 = 31;

// Plant: match line by line again, so the line break and the `.md` dots of the links hide the match.
it.effect(
  'L3 scenario: .decisions/0414 as of 7b63f09b0 has exactly one still-holds finding, at the line that holds "rest"',
  () =>
    Effect.gen(function* () {
      const path = ".decisions/0414-jev-at-volume-uses-hand-labels.md";
      const found = yield* Patches.check(ROOT).pipe(Effect.provide(world(ROOT, { [path]: RECORD_0414 })));

      expect(found).toEqual([{ _tag: "patch", path, line: LINE_0414, form: "still-holds" }]);
    }),
);

/**
 * The measured false alarms of the first run of the check on main (finding 2026-11-18-patch-regex-misses-rest-holds-across-links
 * and the records' own text), each as it is written there: no sentence holds a record reference.
 */
const FALSE_ALARMS = {
  // .decisions/0227, lines 37-40: "carried forward" over a line break, and a link to a note, not a record.
  "0227-saved-state-carries-shape-number": [
    "Every engine that carries state forward",
    "numbers it (Minecraft, Unreal, Erlang's `vsn`, Factorio, Temporal), and hot reload makes a shape",
    'change an everyday event. This walks back "no version number on each machine" for state carried',
    "forward. See [saved state](../docs/direction/saved-state.md).",
  ],
  // .decisions/0281, line 38: the same words about a note, and a link to a note.
  "0281-a-saved-job-is-decoded-not-trusted": [
    '- The note\'s "no version number on each machine" no longer holds where state is carried forward: a',
    "  saved model carries its shape's number and a chain of named upgrades",
    "  ([saved state, S3](../docs/direction/saved-state.md)). The schema is still the last check.",
  ],
  // .decisions/0603, line 38: a date is not a record reference.
  "0603-no-stacks-and-sev0-admin-merges": [
    "The owner ruled on 2026-11-18: stacks go for good,",
    "since they fight the merge queue, and the rest holds in a sev0, for now.",
  ],
} as const;

// Plant: let any number in the sentence count as a reference, dates included; or drop the reference rule.
it.effect("L3 scenario: the measured false alarms of the first run (0227, 0281, 0603) have no patch finding", () =>
  Effect.gen(function* () {
    const files = Object.fromEntries(
      Object.entries(FALSE_ALARMS).map(([name, body]) => [
        `.decisions/${name}.md`,
        record({ id: name.slice(0, 4), body: [...body] }),
      ]),
    );

    const found = yield* Patches.check(ROOT).pipe(Effect.provide(world(ROOT, files)));

    expect(found).toEqual([]);
  }),
);

/**
 * Seven real patches of the first run of the check on main, each as written in the record at commit 604bbcf0b,
 * with the line where "rest" is (counted from the first line given): the record reference is in the sentence
 * before the one that says the rest holds, or in its own sentence.
 */
const REAL_PATCHES = {
  // .decisions/0279, line 35: the reference is in the two sentences before; the sentence before has links.
  "0279-tuval-is-a-package-desk-in-tier-2": {
    lines: [
      '- 2026-11-13: The Tier 1 clause "one fixed layout at wiring, each window keeps its own focus, and there is no desk process" ended with [0159](0159-fabsh-pipes-summon-join-first.md). The desk program comes now, and focus and layout live in its process in the brain, one focus per workspace ([0274](0274-the-desktop-is-a-platform-free-core.md), [0277](0277-size-belongs-to-the-viewer.md)). The rest of this file still holds: Tuval is the `@kampus/tuval` package, and the desk is `fabrika/tezgah`.',
    ],
    rest: 0,
  },
  // .decisions/0532, lines 15-16: a self-patch.
  "0532-a-sev0-freezes-ci": {
    lines: [
      "[0542](0542-two-sev-levels-one-skill.md) adds a second level, the sev1, and changes how a sev0 ends: nothing is",
      "rerun, and the script is `sev.ts`. The rest of this file still holds.",
    ],
    rest: 1,
  },
  // .decisions/0549, lines 55-56.
  "0549-a-pipe-carries-the-whole-value": {
    lines: [
      "- [0553](0553-a-pipe-sends-one-way.md) settles the first: every value travels as a list underneath,",
      "  and no program sees it. The rest of this file still holds.",
    ],
    rest: 1,
  },
  // .decisions/0551, lines 57-58.
  "0551-the-brain-checks-and-records-pipes": {
    lines: [
      "- [0553](0553-a-pipe-sends-one-way.md) says one thing about the record: it holds both declared",
      "  shapes, the writer's output and the reader's input. The rest of this file still holds.",
    ],
    rest: 1,
  },
  // .decisions/0569, lines 81-82.
  "0569-tea-msgs-are-keyed-on-tag": {
    lines: [
      "- 2026-11-15, later (owner): [0578](0578-tea-cell-answers-a-step.md) adds one change to this",
      "  patch, a pipeable `Step` for a cell's answer in place of the tuple. The rest of this file holds.",
    ],
    rest: 1,
  },
  // .decisions/0585, lines 61-64: "ruled on the rest ... holds" in the first sentence is plain English, and
  // the real patch, "The rest of 0556 holds", is the one at the end.
  "0585-kalfa-is-six-domain-packages": {
    lines: [
      "On 2026-11-15 the owner ruled on the rest: which packages, what each holds, the one command that",
      "calls them, how tooling is configured, where the record folders go, and the order the builds land",
      'in. This amends 0556 in part: it settles the first item under its "Not decided here". The rest of',
      "0556 holds.",
    ],
    rest: 2,
  },
  // .decisions/0600, lines 82-83.
  "0600-kalfa-quality-holds-test-lint-format": {
    lines: [
      "- 0557, 0579 and 0585 are amended in part: the package name and 0585's count of six. The rest",
      "  each holds. 0585's build order changes only in that `/stryker` starts now, beside `@kalfa/config`.",
    ],
    rest: 0,
  },
} as const;

// Plant: a form fires only when its own sentence holds the reference, with no sentence before it counted.
it.effect(
  "L3 scenario: seven real patches of main (0279, 0532, 0549, 0551, 0569, 0585, 0600, as of 604bbcf0b) are still-holds findings",
  () =>
    Effect.gen(function* () {
      const files = Object.fromEntries(
        Object.entries(REAL_PATCHES).map(([name, { lines }]) => [
          `.decisions/${name}.md`,
          record({ id: name.slice(0, 4), body: [...lines] }),
        ]),
      );

      const found = yield* Patches.check(ROOT).pipe(Effect.provide(world(ROOT, files)));

      expect(found.map(({ path, line }) => ({ path, line }))).toEqual(
        Object.entries(REAL_PATCHES).map(([name, { rest }]) => ({
          path: `.decisions/${name}.md`,
          line: BODY_AT + rest,
        })),
      );
      expect(found.map((finding) => finding._tag === "patch" && finding.form)).toEqual(
        Object.keys(REAL_PATCHES).map(() => "still-holds"),
      );
    }),
);
