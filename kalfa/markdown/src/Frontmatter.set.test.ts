// Ticket 1927: setting values in a Markdown file's frontmatter and keeping every other byte. Laws E1 to E9.
//
// A property law takes the cases of one run (see Frontmatter.set.test-support.ts), one for each class of input the plan names, so every class is
// reached in every run. A law keeps the forms of the cases it checked and fails when a class it must reach has a form missing. Each plant below is
// one wrong rule in Frontmatter.ts, run once by hand against a copy of the product and never kept.
import { expect, it } from "@effect/vitest";
import { deepStrictEqual, strictEqual } from "@effect/vitest/utils";
import { Arbitrary, Effect, Equal, Exit, Option, Predicate, Result, Schema, Tracer } from "effect";
import * as Support from "./Frontmatter.set.test-support.ts";
import * as Base from "./Frontmatter.test-support.ts";
import * as Frontmatter from "./Frontmatter.ts";

const runs = (count: number) => ({ arbitrary: { runs: count } });

type Failure = Frontmatter.NoFrontmatter | Frontmatter.BadFrontmatter;

// The reason of a BadFrontmatter, or the tag of what else it was.
const tagOrReason = (error: Failure): string =>
  Predicate.isTagged(error, "BadFrontmatter") ? error.reason : error._tag;

// A call that failed names which case it was, since a property run only reports the drawn input.
const labeled = <A, R>(label: string, effect: Effect.Effect<A, Failure, R>) =>
  Effect.mapError(
    effect,
    (error) => new Error(`${label}: ${tagOrReason(error)} ${"message" in error ? error.message : ""}`),
  );

const answerFrontmatter = (answer: string, label: string): string => {
  const cut = Frontmatter.split(answer);

  return Option.isSome(cut.frontmatter)
    ? cut.frontmatter.value
    : expect.unreachable(`${label}: the answer has no frontmatter`);
};

// A value as JSON text, cut short, for a message. A number JSON cannot hold (`NaN`, `Infinity`) is shown by name.
const short = (value: Support.Json): string =>
  (
    JSON.stringify(value, (_key, item: Support.Json) =>
      Number.isFinite(item) || !Predicate.isNumber(item) ? item : String(item),
    ) ?? ""
  ).slice(0, 300);

const OLD_AND_VALUES = [...Support.OLD_CLASSES, "m", "n", "o", "p", "q", "r", "s", "u", "v"];

// ---------------------------------------------------------------------------------------------------------------------

// E1. Plant: write the edited yaml Document with its own `toString`, so the folded block and `[one, two]` reflow, red.
it.effect("scenario: E1 the ticket's file: only the one value changes, every other line is the same bytes", () =>
  Effect.gen(function* () {
    const Shape = Schema.Struct({
      number: Schema.Int,
      status: Schema.Literals(["proposed", "accepted"]),
      summary: Schema.String,
      tags: Schema.Array(Schema.String),
    });

    const lines = [
      "---",
      "number: 87",
      "status: proposed   # waits for a yes",
      "summary: >",
      "  Data on top",
      "  and free text below.",
      "tags: [one, two]",
      "---",
      "# A title",
      "",
    ];

    const text = lines.join("\n");
    const next = yield* Frontmatter.set(text, { status: "accepted" }, Shape);

    strictEqual(next, text.replace("proposed", "accepted"));
    strictEqual(
      next,
      "---\nnumber: 87\nstatus: accepted   # waits for a yes\nsummary: >\n  Data on top\n  and free text below.\ntags: [one, two]\n---\n# A title\n",
    );

    const tags = yield* Frontmatter.set(text, { tags: ["one", "two", "three"] }, Shape);

    strictEqual(tags, text.replace("[one, two]", "[one, two, three]"));

    const summary = yield* Frontmatter.set(text, { summary: "Short" }, Shape);

    strictEqual(summary, text.replace("summary: >\n  Data on top\n  and free text below.\n", "summary: Short\n"));

    const refused = yield* Effect.flip(Frontmatter.set(text, { number: 1.5 }, Shape));

    strictEqual(tagOrReason(refused), "schema");
  }),
);

// E2's check on a list of cases, for the property's runs and for the pinned run.
const keepsBytes = (cases: ReadonlyArray<Support.SetCase>, classes: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const seen = new Set<string>();

    for (const c of cases) {
      const text = Support.fileText(c.typed, c.body);
      const changed = Support.changedKeys(c.typed, c.values);
      const added = Support.addedKeys(c.typed, c.values);
      const answer = yield* labeled(c.name, Support.setOnce(text, c.values));
      const kept = Support.keeps(c.typed, answerFrontmatter(answer, c.name), changed, added.length > 0);

      if (Result.isFailure(kept)) {
        return expect.unreachable(`${c.name}: ${kept.failure}`);
      }

      // New keys are written as `write` writes them, at the first key's column, and nothing else is added.
      const adding = kept.success.find((written) => written.keys.length === 0);

      if (adding !== undefined && !c.typed.flow) {
        strictEqual(adding.text, Support.appendedText(c.typed, c.values, added), `${c.name}: the added keys' lines`);
      }

      strictEqual(answer.startsWith(c.typed.fence), true, `${c.name}: the opening fence`);
      strictEqual(Frontmatter.split(answer).body, c.body, `${c.name}: the body`);

      for (const form of c.forms) {
        seen.add(form);
      }
    }

    deepStrictEqual(Support.unreached(seen, classes), [], "classes never checked in this run");
  });

// E2. Plants, each one wrong rule in Frontmatter.ts (run once, never kept): start a later-line value's text at the end of its key's `:`, so
// `  # note` goes, (h) red; end a value's text at yaml's node end, so ` # c` goes, (i) red; rebuild the frontmatter from the pairs' own texts, so
// comment and blank lines go, (j) red. The other classes' plants are E3's.
// Each group of classes is a law of its own with 300 runs (Support.CASE_GROUPS), so a law holds a third of a run's work.
for (const group of Support.CASE_GROUPS) {
  it.effect.prop(
    `E2 every other byte kept: only each changed value's text is replaced and the new keys' lines are added at the end, for ${group.name}`,
    { run: Base.run },
    ({ run }) => keepsBytes(Support.groupCases(run, group), group.classes),
    runs(300),
  );
}

// E3's read-back of a list of cases, for the property's runs and for the pinned run.
const readsBack = (cases: ReadonlyArray<Support.SetCase>, classes: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const seen = new Set<string>();

    for (const c of cases) {
      const answer = yield* labeled(c.name, Support.setOnce(Support.fileText(c.typed, c.body), c.values));
      const file = yield* labeled(`${c.name}, read again`, Frontmatter.read(answer, Base.S1));
      const expected = { ...Support.dataRead(c.typed), ...c.values };

      // The message is made only on a failure: cut to JSON for every case, it was a tenth of the law's time.
      if (!Equal.equals(file.data, expected)) {
        expect.unreachable(`${c.name}: ${short(file.data)} is not ${short(expected)}`);
      }

      strictEqual(file.body, c.body, `${c.name}: body`);

      for (const form of c.forms) {
        seen.add(form);
      }
    }

    deepStrictEqual(Support.unreached(seen, classes), [], "classes never checked in this run");
  });

// E3. Plants: end a value's text at its first space, (a) red; for a quoted value, end its text at its start plus its read text's length, (b) red;
// for a block scalar, end its text at the end of its header line, (c) red (the plan's wording, before its last line break, gives the same bytes
// in every place a block scalar's new text goes, so that plant stays green: see the report); for a flow collection, end its text at its first `]` or `}`, (d) red;
// write a new map at a compact list's column with no added indent, (e) red; end a block map's text at the end of its first line, (f) red; insert at
// an empty value's place with no space, (g) red; start a value's text after its tag or anchor, (k) red; find a key by its source text, not its read
// text, (l) red; put new keys at column 0, (m) red; append a new key as a new line in a flow top map, (n) red; take new keys' column from the first
// pair and fail when there is none (not for a flow map), (p) red; write a new text plain when the old value was plain `old`, (q) red; skip a key the file lacks, (u) red; apply
// the edits from the first offset to the last without moving later ones when two to five values change, (v) red.
for (const group of Support.CASE_GROUPS) {
  it.effect.prop(
    `E3 it reads back: the answer reads as the old data with the set values over it, for ${group.name}`,
    { run: Base.run },
    ({ run }) => readsBack(Support.groupCases(run, group), group.classes),
    runs(300),
  );
}

it.effect.prop(
  "E3 it reads back under S2, S3 and S5: the answer reads as the old data with the set values over it",
  { run: Base.run },
  ({ run }) =>
    Effect.gen(function* () {
      for (const schema of Support.schemaSets(run)) {
        const back = yield* labeled(schema.name, schema.check);

        strictEqual(back.same, true, `${schema.name}: ${back.detail}`);
        strictEqual(back.bodyKept, true, `${schema.name}: body`);
      }
    }),
  runs(300),
);

// E2 and E3 on the wide cases. A run takes three of the collection grid's nine old forms, six of the mix's nineteen, and the scalar and key texts it
// draws; this run takes every one, with the first texts and keys every run draws alike (one key is 19,000 characters long). Plant (run once, restored):
// `set` returns the text as it was past 60 changed keys: the wide grid changes 180 and goes red, a run's 60 does not reach it.
it.effect("pinned: E2 and E3 over the wide cases, the whole grid and the first texts and keys", () =>
  Effect.gen(function* () {
    const [run] = yield* Arbitrary.sampleEffect(Base.run, { count: 1, seed: 119120 });
    const cases = Support.typedSets(run ?? expect.unreachable("no run"), true);

    yield* keepsBytes(cases, OLD_AND_VALUES);
    yield* readsBack(cases, OLD_AND_VALUES);
  }),
);

// E4. Plant: find the closing fence by the last fence line, not the next, (z) red.
it.effect.prop(
  "E4 the body for any body: the text after the closing fence is the body byte for byte, and both fence lines are the old ones",
  { run: Base.run },
  ({ run }) =>
    Effect.gen(function* () {
      const cases = Support.bodySets(run);
      const seen = new Set<string>();

      for (const c of cases) {
        const answer = yield* labeled(c.name, Frontmatter.set(Support.fileText(c.typed, c.body), c.values, Base.S1));

        strictEqual(answer.startsWith(c.typed.fence), true, `${c.name}: the opening fence`);
        strictEqual(answer.endsWith(`${c.typed.fence}${c.body}`), true, `${c.name}: the closing fence and the body`);
        strictEqual(Frontmatter.split(answer).body, c.body, `${c.name}: the body by the next fence`);

        for (const form of c.forms) {
          seen.add(form);
        }
      }

      deepStrictEqual(Support.unreached(seen, ["z"]), [], "body groups never checked in this run");
    }),
  runs(300),
);

// E5. Plant: edit every key in `values`, changed or not, so `'x'` becomes `x`, (t) red.
it.effect.prop(
  "E5 no change gives the same text: values the file already holds give the input back byte for byte, under S1 and S3",
  { run: Base.run },
  ({ run }) =>
    Effect.gen(function* () {
      const same = Support.sameSets(run);
      const seen = new Set<string>();

      for (const c of same.s1) {
        const text = Support.fileText(c.typed, c.body);
        const answer = yield* labeled(c.name, Frontmatter.set(text, c.values, Base.S1));

        strictEqual(answer, text, `${c.name}: the text changed`);

        for (const form of c.forms) {
          seen.add(form);
        }
      }

      const s3 = yield* labeled(same.s3.name, same.s3.check);

      strictEqual(s3.answer, same.s3.text, "S3: the text of a number the Schema reads the same changed");

      for (const form of same.s3.forms) {
        seen.add(form);
      }

      deepStrictEqual(Support.unreached(seen, ["t"]), [], "classes never checked in this run");
    }),
  runs(200),
);

const hasLoneLineFeed = (text: string): boolean => /(?<!\r)\n/u.test(text);

// E6. Plant: write `\n` in new lines whatever the file uses, (o) red.
it.effect.prop(
  "E6 line breaks: a CRLF file gets only CRLF, and an LF file's frontmatter gets no \\r",
  { run: Base.run },
  ({ run }) =>
    Effect.gen(function* () {
      const cases = Support.crlfSets(run);
      const seen = new Set<string>();

      for (const c of cases) {
        const answer = yield* labeled(c.name, Frontmatter.set(Support.fileText(c.typed, c.body), c.values, Base.S1));

        if (c.typed.fence === "---\r\n") {
          strictEqual(hasLoneLineFeed(answer), false, `${c.name}: a line feed with no carriage return before it`);
        } else {
          strictEqual(
            answerFrontmatter(answer, c.name).includes("\r"),
            false,
            `${c.name}: a carriage return in an LF file`,
          );
        }

        for (const form of c.forms) {
          seen.add(form);
        }
      }

      deepStrictEqual(Support.unreached(seen, ["o"]), [], "classes never checked in this run");
    }),
  runs(200),
);

// E7. Plants: encode after the edit, so a refused value still gives text, (w) red; merge onto the file's raw data without decoding it, so a file S2
// refuses gets text, (w) red; drop the re-read in the check after the edit, so the anchor case answers a text that does not read, (x) red; drop the data check after it (`Equal.equals(reread, ...)`), so two anchors of one name with an alias after each answers a text that reads as other data, (x) red; treat a file with no
// frontmatter as an empty one, (y) red; read a file that is not YAML or not data as an empty map, (y) red again, for the broken and unread files.
it.effect.prop(
  "E7 refusals give no text: a Schema refusal is schema, a change that cannot keep other data is edit, and a bad file is what read says",
  { run: Base.run },
  ({ run }) =>
    Effect.gen(function* () {
      const refused = Support.refusedSets(run);
      const seen = new Set<string>();

      for (const r of refused) {
        const outcome = yield* Effect.result(r.call);

        if (Result.isSuccess(outcome)) {
          return expect.unreachable(`${r.form} ${r.name}: gave the text ${short(outcome.success.slice(0, 80))}`);
        }

        const error = outcome.failure;

        const wanted =
          r.expect === "read" ? tagOrReason(yield* Effect.flip(Frontmatter.read(r.text, Base.S1))) : r.expect;

        strictEqual(tagOrReason(error), wanted, `${r.form} ${r.name}`);
        seen.add(r.form);
      }

      deepStrictEqual(Support.unreached(seen, ["w", "x", "y"]), [], "classes never checked in this run");
    }),
  runs(200),
);

// E8. Plants: call `read` inside `set`, so two spans, red; annotate the set keys on the span, red.
it.effect.prop(
  "E8 the span: set ends exactly one span named markdown.frontmatter.set, on success and on each failure, with no file text in it",
  { run: Base.run },
  ({ run }) =>
    Effect.gen(function* () {
      const traced = Support.tracedSets(run);

      for (const t of traced) {
        const spans: Array<Tracer.NativeSpan> = [];

        const tracer = Tracer.make({
          span(options) {
            const span = new Tracer.NativeSpan(options);

            spans.push(span);

            return span;
          },
        });

        const exit = yield* Effect.exit(t.call).pipe(Effect.withTracer(tracer));

        strictEqual(Exit.isSuccess(exit), t.name.startsWith("success"), `${t.name}: the call's outcome`);
        strictEqual(spans.length, 1, `${t.name}: spans made: ${spans.map((span) => span.name).join(", ")}`);

        const span = spans[0] ?? expect.unreachable("a span");

        strictEqual(span.name, "markdown.frontmatter.set", t.name);
        strictEqual(span.status._tag, "Ended", `${t.name}: ended`);

        for (const [attribute, value] of span.attributes) {
          strictEqual(
            `${attribute}=${String(value)}`.includes(t.marker),
            false,
            `${t.name}: attribute ${attribute} holds file text`,
          );
        }

        for (const [event, , attributes] of span.events) {
          strictEqual(
            `${event} ${JSON.stringify(attributes)}`.includes(t.marker),
            false,
            `${t.name}: an event holds file text`,
          );
        }
      }
    }),
  runs(100),
);

const nonEmptyCollection = (value: Support.Json): boolean =>
  Array.isArray(value) ? value.length > 0 : Predicate.isObject(value) && Object.keys(value).length > 0;

const leading = (line: string): number => line.length - line.trimStart().length;

// E9. Plants: leave yaml's flow padding on, so `[ a, b ]`, (r) red; indent only the first line of a new block map, (s) red.
it.effect.prop(
  "E9 how a new value is written: one line in flow style with no padding where the old value was on its key's line, block style where it was below",
  { run: Base.run },
  ({ run }) =>
    Effect.gen(function* () {
      const placed = Support.placedSets(run);
      const text = Support.fileText(placed.typed, placed.body);
      const answer = yield* labeled("placed", Frontmatter.set(text, placed.values, Base.S1));
      const changed = Support.changedKeys(placed.typed, placed.values);
      const kept = Support.keeps(placed.typed, answerFrontmatter(answer, "placed"), changed, false);

      if (Result.isFailure(kept)) {
        return expect.unreachable(`placed: ${kept.failure}`);
      }

      for (const written of kept.success) {
        const key = written.keys[0] ?? expect.unreachable("a key");
        const slot = Support.slotOfKey(placed.typed, key) ?? expect.unreachable(`no pair ${key}`);
        const value = placed.values[key] ?? null;
        const place = Support.placeFor(placed.typed, slot);
        const label = `${slot.form} set to ${short(value)}: ${short(written.text)}`;
        const one = written.text.replace(/\n$/u, "");

        strictEqual(written.text.endsWith("\n"), slot.value.endsWith("\n"), `${label}: the line break after the value`);

        if (place.kind === "empty") {
          strictEqual(one, ` ${Support.flowText(value)}`, label);
        } else if (place.kind === "inline" || !nonEmptyCollection(value)) {
          const indent = place.kind === "below" && place.compact ? 2 : 0;

          strictEqual(one, `${" ".repeat(indent)}${Support.flowText(value)}`, label);
        } else {
          // Block style: the first line starts where the old value did, the others at the column or deeper.
          const column = place.compact && !Array.isArray(value) ? 2 : place.column;
          const lines = one.split("\n");

          strictEqual(leading(lines[0] ?? ""), Math.max(0, column - place.column), `${label}: first line`);
          strictEqual(
            Array.isArray(value) ? (lines[0] ?? "").trimStart().startsWith("- ") : /^ *[a-z]+:/u.test(lines[0] ?? ""),
            true,
            `${label}: block style`,
          );

          for (const line of lines.slice(1)) {
            strictEqual(
              leading(line) >= column,
              true,
              `${label}: line ${JSON.stringify(line)} is left of column ${column}`,
            );
          }
        }
      }

      const seen = new Set(placed.forms);

      deepStrictEqual(Support.unreached(seen, ["r"]), [], "lists never checked in this run");
      deepStrictEqual(
        ["s:empty", "s:three deep"].filter((form) => !seen.has(form)),
        [],
        "maps never checked in this run",
      );
    }),
  runs(200),
);
