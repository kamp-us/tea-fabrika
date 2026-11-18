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
// Each run builds one record that holds every positive form, every form in a fence and in inline code, and
// a history line, in a generated order among generated prose, so each case is reached in every run.
import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { runsFor } from "@kampus/vitest";
import { Effect, FileSystem, Layer, Path, Schema } from "effect";
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
  | { readonly _tag: "history"; readonly id: string; readonly date: string };

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
    }

    lines.push("");
  }

  return { lines, hits };
};

const SPOTS = 12;

const Extra = Schema.Struct({
  at: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 40 })),
  kind: Schema.Literals(["prose", "hit", "inline", "history", "fence"]),
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

// Plant: stop skipping fenced code, so the fenced forms (0605's own opening block) are findings.
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

      const found = yield* Patches.check(root).pipe(
        Effect.provide(Layer.succeed(Tracked, { files: Effect.succeed(tracked) })),
      );

      expect(found).toEqual([]);
    }).pipe(Effect.provide(NodeServices.layer)),
);
