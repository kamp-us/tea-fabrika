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
// The still-holds and carried-forward forms are read as a block, not a line (the lead's rule after the finding
// on .decisions/0414): prose outside fenced code with inline code removed, each Markdown link replaced by its
// text, consecutive lines joined with single spaces, a block ending at a blank line, a heading line and the
// start of a list item (`- `, `* `, `+ `, `1. `). The finding's `line` is the file line where the match
// begins, the line that holds "rest" or "carried". The `## Amendments` heading stays a per-line match.
//
// Each run builds one record that holds every positive form, every form in a fence and in inline code, and
// a history line, in a generated order among generated prose, so each case is reached in every run.
import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { runsFor } from "@kampus/vitest";
import { Effect, FileSystem, Path, Schema } from "effect";
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
import { Tracked } from "./Tracked.ts";

const check = { arbitrary: { seed: 119120, runs: runsFor({ fast: 50, full: 200 }) } };

type Form = "amendments" | "still-holds" | "carried-forward";

const FORMS: ReadonlyArray<Form> = ["amendments", "still-holds", "carried-forward"];

// Eight phrasings of each of 0605's three forms, as the regexes of the plan read them. The heading has two,
// since its form is the heading itself.
const PHRASINGS: Record<Form, ReadonlyArray<string>> = {
  amendments: ["## Amendments", "## Amendments "],
  "still-holds": [
    "The rest of 0066 still holds.",
    "The rest of 0066 holds.",
    "The rest of this record still holds as written.",
    "the rest of the rule holds",
    "The rest of 0049 (the budget numbers) still holds.",
    "Everything else changes; the rest stays in force and holds.",
    "THE REST OF 0012 STILL HOLDS.",
    "- The rest of the file, unchanged, still holds.",
  ],
  "carried-forward": [
    "The rule is carried forward from 0012.",
    "Carried forward unchanged.",
    "carried forward from the older record: use it.",
    "- Carried forward: the budget stays.",
    "This section is CARRIED FORWARD as written.",
    "The limit, carried forward, is 12.",
    "Rules carried forward from 0030 to 0031:",
    "(carried forward)",
  ],
};

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
  | {
      readonly _tag: "text";
      readonly lines: ReadonlyArray<string>;
      readonly hit: { readonly at: number; readonly form: Form } | undefined;
    };

/** Shapes of a still-holds or carried-forward line over a line break, with Markdown links in them. */
const MULTI = 7;

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
    default:
      return { _tag: "text", lines: [`1. The rest of ${one} and`, `   ${two} still holds.`], hit: still };
  }
};

const SPLITS = ["bullets", "heading", "paragraphs"] as const;

/** "rest" in one block and "holds" in the next: no finding, whatever separates them. */
const split = (kind: (typeof SPLITS)[number], marker: string): Block => ({
  _tag: "text",
  lines:
    kind === "bullets"
      ? [`${marker} The rest of the table is small`, `${marker} the next rule holds as written.`]
      : kind === "heading"
        ? ["The rest of the table is small,", "### Later", "holds as written."]
        : ["The rest of the table is small,", "", "holds as written."],
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

const SPOTS = 22;

/** The ways a list item starts. */
const MARKERS = ["-", "*", "+", "1."] as const;

const Extra = Schema.Struct({
  at: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 40 })),
  kind: Schema.Literals(["prose", "hit", "inline", "history", "fence", "multi", "split"]),
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
    ...SPLITS.map((kind, i) => split(kind, MARKERS[d.phrasings[12 + i]! % MARKERS.length]!)),
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
                  ? split(SPLITS[extra.phrasing % SPLITS.length]!, MARKERS[extra.at % MARKERS.length]!)
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

// Plant: match the still-holds pattern on the raw text, fenced and inline code included.
it.effect(
  "L4 scenario: the records 0605 to 0608, which quote the forbidden forms in fences and code, have no patch finding",
  () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = path.resolve(import.meta.dirname, "../../..");
      const names = (yield* fs.readDirectory(path.join(root, ".decisions"))).filter((name) => /^060[5-8]-/.test(name));

      expect(names).toHaveLength(4);

      const tracked = names.map((name) => ({ path: `.decisions/${name}`, symlink: false }));

      const found = yield* Patches.check(root).pipe(Effect.provideService(Tracked, { files: Effect.succeed(tracked) }));

      expect(found).toEqual([]);
    }).pipe(Effect.provide(NodeServices.layer)),
);

/** The line of the one still-holds finding in .decisions/0414, "The rest of [0412](...) and", in a list item. */
const LINE_0414 = 31;

// Plant: match line by line again, so the line break and the `.md` dots of the links hide the match.
it.effect(
  'L3 scenario: the committed .decisions/0414 has exactly one still-holds finding, at the line that holds "rest"',
  () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = path.resolve(import.meta.dirname, "../../..");
      const names = (yield* fs.readDirectory(path.join(root, ".decisions"))).filter((name) => /^0414-/.test(name));

      expect(names).toHaveLength(1);

      const tracked = names.map((name) => ({ path: `.decisions/${name}`, symlink: false }));

      const found = yield* Patches.check(root).pipe(Effect.provideService(Tracked, { files: Effect.succeed(tracked) }));

      expect(found).toEqual([{ _tag: "patch", path: tracked[0]!.path, line: LINE_0414, form: "still-holds" }]);
    }).pipe(Effect.provide(NodeServices.layer)),
);
