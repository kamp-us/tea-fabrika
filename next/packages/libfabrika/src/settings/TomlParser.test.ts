// T664, P38 slice 1, next/: L9 of the approved plan, for the `Toml` service (`settings/Toml.ts`)
// and its first Layer on toml-eslint-parser 1.0.3 (`settings/TomlParser.ts`). Written before them.
//
// The shape these tests hold the modules to:
// - `Toml` is a `Context.Service` with `parse(text): Effect<TomlDocument, TomlError>`;
//   `TomlParser.layer` provides it.
// - `TomlDocument.value` is the document's values as plain tables. `TomlDocument.spans` holds one
//   entry per key/value and per table header: `{ path, line }`, where `path` is the key's segments
//   (`"a.b" = 1` is `["a.b"]`, `a.b = 1` is `["a", "b"]`) and `line` counts from 1.
// - Broken TOML fails with `TomlError`, carrying the parser's `line` and its `cause`.
import { describe, expect, it } from "@effect/vitest";
import { runsFor } from "@kampus/vitest";
import { Cause, Effect, Exit, Schema } from "effect";
import * as fc from "fast-check";
import { Toml, TomlError } from "./Toml.ts";
import * as TomlParser from "./TomlParser.ts";

const SEED = 119120; // the shared seed (AGENTS.md), so a red run repeats

const check = { seed: SEED, numRuns: 100 };

const parse = (text: string) =>
  Effect.runPromiseExit(
    Effect.gen(function* () {
      const toml = yield* Toml;

      return yield* toml.parse(text);
    }).pipe(Effect.provide(TomlParser.layer)),
  );

const segment = fc.stringMatching(/^[a-z][a-z0-9]{0,5}(-[a-z0-9]{1,3})?$/);

// One table and its keys, in one of the spellings TOML gives the same table.
const table = fc.record({
  name: segment,
  keys: fc.uniqueArray(segment, { minLength: 1, maxLength: 3 }),
  values: fc.array(fc.integer({ min: 0, max: 99999 }), { minLength: 3, maxLength: 3 }),
  spelling: fc.constantFrom("table", "dotted", "quoted-table", "quoted-key", "inline"),
});

it.effect.prop(
  "T877 L8 parse and both edits preserve the syntax line and the parser failure in a tagged reason",
  {
    padding: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 30 })),
    crlf: Schema.Boolean,
    variant: Schema.Int,
  },
  ({ padding, crlf, variant }) =>
    Effect.gen(function* () {
      const toml = yield* Toml;
      const eol = crlf ? "\r\n" : "\n";
      const broken = ['bad = "never closed', "bad = ]", "bad = 1 2"][Math.abs(variant) % 3]!;
      const text = Array.from({ length: padding }, (_, i) => `# prefix-${i}`).join(eol) + eol + broken + eol;

      const operations: ReadonlyArray<Effect.Effect<unknown, TomlError>> = [
        toml.parse(text),
        toml.set(text, ["missing"], 1),
        toml.remove(text, ["missing"]),
      ];

      for (const operation of operations) {
        const exit = yield* Effect.exit(operation);
        expect(Exit.isFailure(exit)).toBe(true);

        if (Exit.isSuccess(exit)) {
          return yield* Effect.die(new Error("Invalid TOML succeeded"));
        }

        const failure = exit.cause.reasons.find(Cause.isFailReason);
        expect(failure?._tag).toBe("Fail");

        if (failure?._tag !== "Fail") {
          return yield* Effect.die(new Error("The syntax failure was a defect"));
        }

        const error = failure.error;
        expect(error).toBeInstanceOf(TomlError);
        expect(error.line).toBe(padding + 1);
        expect(error.reason._tag).toBe("Syntax");
        expect(error.reason.cause).toBe(error.cause);
        expect(error.cause).toBeInstanceOf(Error);
        expect(error.cause).toMatchObject({ lineNumber: padding + 1 });
      }
    }).pipe(Effect.provide(TomlParser.layer)),
  { arbitrary: { seed: 119120, runs: 100 } },
);

const doc = fc.record({
  tables: fc.uniqueArray(table, { minLength: 1, maxLength: 3, selector: (t) => t.name }),
  // A key whose one segment holds a dot, beside the table it reads like.
  literal: fc.option(fc.integer({ min: 0, max: 99999 }), { nil: undefined }),
  // Before each line: blank lines or comment lines, and a trailing comment on the line itself.
  padding: fc.array(fc.record({ blank: fc.nat(2), comment: fc.boolean(), trailing: fc.boolean() }), {
    minLength: 16,
    maxLength: 16,
  }),
  crlf: fc.boolean(),
});

type Doc = typeof doc extends fc.Arbitrary<infer D> ? D : never;

/** The text, its values, and the line every leaf and every table header must have. */
const write = (d: Doc) => {
  const lines: Array<string> = [];
  const value: Record<string, unknown> = {};
  const leaves: Array<{ path: ReadonlyArray<string>; line: number }> = [];
  const headers: Array<{ path: ReadonlyArray<string>; line: number }> = [];
  let pad = 0;

  const put = (text: string) => {
    const p = d.padding[pad++ % d.padding.length]!;

    for (let n = 0; n < p.blank; n++) {
      lines.push("");
    }

    if (p.comment) {
      lines.push("# a comment, with = and [brackets] and a.dotted key");
    }

    lines.push(p.trailing ? `${text} # trailing` : text);

    return lines.length;
  };

  // TOML puts top-level keys before the first header, so headers come last.
  const top = d.tables.filter((t) => t.spelling !== "table" && t.spelling !== "quoted-table");
  const headed = d.tables.filter((t) => t.spelling === "table" || t.spelling === "quoted-table");
  const first = d.tables[0]!;

  if (d.literal !== undefined) {
    const key = `${first.name}.${first.keys[0]!}`;
    leaves.push({ path: [key], line: put(`"${key}" = ${d.literal}`) });
    value[key] = d.literal;
  }

  for (const t of top) {
    const inner: Record<string, unknown> = {};
    value[t.name] = inner;

    if (t.spelling === "inline") {
      const line = put(`${t.name} = { ${t.keys.map((k, n) => `${k} = ${t.values[n]}`).join(", ")} }`);
      t.keys.forEach((k, n) => {
        inner[k] = t.values[n];
        leaves.push({ path: [t.name, k], line });
      });
    } else {
      t.keys.forEach((k, n) => {
        const key = t.spelling === "dotted" ? `${t.name}.${k}` : `"${t.name}".'${k}'`;
        inner[k] = t.values[n];
        leaves.push({ path: [t.name, k], line: put(`${key} = ${t.values[n]}`) });
      });
    }
  }

  for (const t of headed) {
    const inner: Record<string, unknown> = {};
    value[t.name] = inner;
    headers.push({ path: [t.name], line: put(t.spelling === "table" ? `[${t.name}]` : `[ "${t.name}" ]`) });
    t.keys.forEach((k, n) => {
      inner[k] = t.values[n];
      leaves.push({ path: [t.name, k], line: put(`${k} = ${t.values[n]}`) });
    });
  }

  return { text: lines.join(d.crlf ? "\r\n" : "\n") + (d.crlf ? "\r\n" : "\n"), value, leaves, headers };
};

const same = (a: ReadonlyArray<string>, b: ReadonlyArray<string>) =>
  a.length === b.length && a.every((s, n) => s === b[n]);

describe("L9, TOML paths and lines stay right for every spelling", () => {
  it("values, and one span per leaf and header with its segments and line", async () => {
    await fc.assert(
      fc.asyncProperty(doc, async (d) => {
        const w = write(d);
        const exit = await parse(w.text);
        expect(Exit.isSuccess(exit), w.text).toBe(true);

        if (Exit.isSuccess(exit)) {
          expect(exit.value.value).toEqual(w.value);

          for (const want of [...w.leaves, ...w.headers]) {
            const found = exit.value.spans.filter((s) => same(s.path, want.path));
            expect(
              found.map((s) => s.line),
              `${JSON.stringify(want.path)} in\n${w.text}`,
            ).toEqual([want.line]);
          }
        }
      }),
      check,
    );
  });

  it("broken TOML fails with TomlError at the broken line, even beside a version line", async () => {
    // Both forms are ones toml-eslint-parser 1.0.3 reports on their own line: a missing value is
    // reported on the next line, so it is not used here.
    const broken = fc.constantFrom('bad = "never closed', "bad = ]", "bad = 1 2");
    await fc.assert(
      fc.asyncProperty(doc, broken, fc.nat(), async (d, line, at) => {
        const w = write(d);
        const eol = d.crlf ? "\r\n" : "\n";
        const lines = [`fabrika-version = "9.9.9"`, ...w.text.split(eol).slice(0, -1)];
        const n = 1 + (at % lines.length);
        lines.splice(n, 0, line);
        const exit = await parse(lines.join(eol) + eol);
        expect(exit._tag).toBe("Failure");

        if (Exit.isFailure(exit)) {
          const error = exit.cause.reasons.find(Cause.isFailReason);
          expect(error?._tag === "Fail" ? error.error._tag : "none").toBe("TomlError");
          expect(error?._tag === "Fail" ? error.error.line : 0).toBe(n + 1);
        }
      }),
      check,
    );
  });
});

// The array-of-tables law (ticket 1056, slice 5 of the Reflect ban, its fix round). A `[[name]]`
// header adds one table to the array `name`, and a `[name.sub]` or `[[name.items]]` after it lands
// in that array's last table. The names include keys every object inherits, so each step down a
// path must read an own key, and must step into an array as it steps into a table.
// Plants: step into the next value only when it is a table and not an array (`Predicate.isObject`
// in `put`); write a header's table onto the parent instead of into the array. Each turns it red.
const Name = Schema.Literals(["__proto__", "constructor", "toString", "starts", "rows"]);

const Leaves = Schema.Array(
  Schema.Struct({ key: Name, value: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 99999 })) }),
).check(Schema.isMaxLength(3));

const Element = Schema.Struct({
  leaves: Leaves,
  sub: Schema.optional(Schema.Struct({ name: Name, leaves: Leaves })),
  items: Schema.optional(
    Schema.Struct({ name: Name, elements: Schema.Array(Leaves).check(Schema.isBetweenLength(1, 3)) }),
  ),
});

const Group = Schema.Struct({ name: Name, elements: Schema.Array(Element).check(Schema.isBetweenLength(1, 3)) });

// Every run holds these as array names, each with a table and an array inside its last element.
const hostile = ["__proto__", "constructor", "toString"] as const;
const prototype = Object.getOwnPropertyNames(Object.prototype).sort();

// The model keeps every key as an own key, as a parsed document must.
const own = <A>(table: object, key: string, value: A): A => {
  Object.defineProperty(table, key, { value, enumerable: true, writable: true, configurable: true });
  return value;
};

/** The text of arrays of tables, and the value a parse must give. A repeated name is left out. */
const arrays = (groups: ReadonlyArray<typeof Group.Type>) => {
  const lines: Array<string> = [];
  const value = {};
  const names = new Set<string>();
  const seen = { elements: 0, subs: 0, items: 0 };

  // One header and its keys. Returns the keys the table now holds.
  const fill = (table: object, header: string, leaves: typeof Leaves.Type): Set<string> => {
    const keys = new Set<string>();
    lines.push(header);

    for (const leaf of leaves) {
      if (!keys.has(leaf.key)) {
        keys.add(leaf.key);
        lines.push(`${leaf.key} = ${leaf.value}`);
        own(table, leaf.key, leaf.value);
      }
    }

    return keys;
  };

  for (const group of groups) {
    if (names.has(group.name)) {
      continue;
    }

    names.add(group.name);
    const list = own(value, group.name, new Array<object>());

    for (const element of group.elements) {
      const table = {};
      list.push(table);
      seen.elements++;
      const taken = fill(table, `[[${group.name}]]`, element.leaves);

      if (element.sub && !taken.has(element.sub.name)) {
        taken.add(element.sub.name);
        fill(own(table, element.sub.name, {}), `[${group.name}.${element.sub.name}]`, element.sub.leaves);
        seen.subs++;
      }

      if (element.items && !taken.has(element.items.name)) {
        const items = own(table, element.items.name, new Array<object>());

        for (const leaves of element.items.elements) {
          const item = {};
          items.push(item);
          fill(item, `[[${group.name}.${element.items.name}]]`, leaves);
        }

        seen.items++;
      }
    }
  }

  return { text: `${lines.join("\n")}\n`, value, names, seen };
};

it.effect.prop(
  "T1056 an array of tables parses into its array, hostile names and tables inside an element included",
  { groups: Schema.Array(Group).check(Schema.isBetweenLength(1, 3)), leaves: Leaves },
  ({ groups, leaves }) =>
    Effect.gen(function* () {
      const toml = yield* Toml;
      const nested = {
        leaves: [],
        sub: { name: "toString", leaves },
        items: { name: "constructor", elements: [leaves, leaves] },
      } as const;
      // The hostile arrays come first, so a drawn group of the same name is the one left out.
      const w = arrays([...hostile.map((name) => ({ name, elements: [{ leaves }, nested] })), ...groups]);
      const parsed = yield* toml.parse(w.text);

      expect(parsed.value, w.text).toEqual(w.value);
      expect([...w.names], "every run holds each hostile array name").toEqual(expect.arrayContaining([...hostile]));
      expect(w.seen.subs, "a table inside an element in every hostile array").toBeGreaterThanOrEqual(hostile.length);
      expect(w.seen.items, "an array inside an element in every hostile array").toBeGreaterThanOrEqual(hostile.length);
      expect(Object.getOwnPropertyNames(Object.prototype).sort(), "Object.prototype keeps its members").toEqual(
        prototype,
      );
    }).pipe(Effect.provide(TomlParser.layer)),
  { arbitrary: { seed: 119120, runs: runsFor({ fast: 200, full: 1000 }) } },
);
