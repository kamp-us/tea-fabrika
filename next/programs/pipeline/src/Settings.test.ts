import { expect, it } from "@effect/vitest";
import {
  Array as Arr,
  Record as Rec,
  String as Str,
  ConfigProvider,
  Effect,
  Exit,
  Match,
  Option,
  Predicate,
  type Schema,
  SchemaIssue,
} from "effect";
import * as fc from "fast-check";
import { merger } from "./Merger.ts";
import * as Settings from "./Settings.ts";

const positive = fc.oneof(fc.integer({ min: 1, max: 300 }), fc.integer({ min: 1, max: Number.MAX_SAFE_INTEGER }));

const invalid = fc.oneof(
  fc.integer({ max: 0 }),
  fc.constantFrom(0.5, Number.NaN, Infinity, -Infinity, "no", false, []),
);

const name = fc.string({ unit: "binary", minLength: 1, maxLength: 24 });

const checks = fc.array(fc.record({ name, source: name }), { maxLength: 5 });

it("L11: a person's nested table supplies values or defaults and refuses only bad keys", () => {
  const values = fc.record({
    wait: positive,
    poll: positive,
    backoff: positive,
    rounds: positive,
    most: positive,
    rows: checks,
    docs: checks,
    code: checks,
    glob: fc.constantFrom("docs/**", "rows/*.json", ".hidden/**"),
  });

  fc.assert(
    fc.property(
      values,
      fc.array(fc.boolean(), { minLength: 7, maxLength: 7 }),
      fc.nat(),
      invalid,
      (values, omitted, pick, bad) => {
        const read = (settings: Schema.Json) =>
          Effect.runSyncExit(
            Settings.all.parse(
              ConfigProvider.fromUnknown({ pack: { pipeline: { settings } } }, { preserveEmptyStrings: true }).pipe(
                ConfigProvider.nested("settings"),
                ConfigProvider.nested("pipeline"),
                ConfigProvider.nested("pack"),
              ),
            ),
          );

        const table = {
          queue: {
            ...(omitted[5] === true ? {} : { most: values.most }),
            ...(omitted[0] === true ? {} : { kinds: { rows: [values.glob], docs: [values.glob] } }),
            ...(omitted[1] === true ? {} : { checks: { rows: values.rows, docs: values.docs, code: values.code } }),
          },
          merger: {
            ...(omitted[2] === true ? {} : { wait: values.wait }),
            ...(omitted[3] === true ? {} : { poll: values.poll }),
            ...(omitted[4] === true ? {} : { backoff: values.backoff }),
            ...(omitted[6] === true ? {} : { rounds: values.rounds }),
          },
        };

        const defaults = Rec.fromEntries(
          Arr.map(Rec.toEntries(Settings.all.settings), ([key, setting]) => [key, setting.default]),
        );

        const empty = read({});
        expect(Exit.isSuccess(empty)).toBe(true);

        if (Exit.isSuccess(empty)) {
          expect(empty.value).toEqual(defaults);
          // pinned: the approved settings table starts with five rounds and a 256-entry line.
          expect(empty.value).toMatchObject({ rounds: 5, most: 256 });

          const checksDeclaration = Option.getOrThrow(
            Arr.findFirst(Settings.all.declarations, (d) => d.path === "queue.checks"),
          );

          expect(checksDeclaration.default).toEqual({ rows: [], docs: [], code: [] });
        }

        const decoded = read(table);
        expect(Exit.isSuccess(decoded)).toBe(true);

        if (Exit.isSuccess(decoded)) {
          const actual: Readonly<Record<string, unknown>> = decoded.value;

          for (const [key, setting] of Rec.toEntries(Settings.all.settings)) {
            const start: unknown = table;

            const from = Arr.reduce(setting.segments, start, (value, segment) =>
              Predicate.hasProperty(value, segment) ? value[segment] : undefined,
            );

            expect(actual[key]).toEqual(from ?? setting.default);
          }

          expect(merger(decoded.value).machine).toBeDefined();
        }

        for (const declaration of Settings.all.declarations) {
          expect(declaration.scope).toEqual(["repo"]);
          expect(declaration.reload).toBe("restart");
          expect(declaration.doc.length).toBeGreaterThan(0);
        }

        const broken = structuredClone(table) as {
          queue: Record<string, Schema.Json>;
          merger: Record<string, Schema.Json>;
        };

        const paths = [
          "merger.wait",
          "merger.poll",
          "merger.backoff",
          "merger.rounds",
          "queue.most",
          "queue.kinds",
          "queue.checks",
        ];

        const path = paths[pick % paths.length]!;

        if (Str.startsWith("merger.")(path)) {
          broken.merger[Str.split(path, ".")[1]!] = bad;
        } else if (path === "queue.most") {
          broken.queue.most = bad;
        } else if (path === "queue.kinds") {
          broken.queue.kinds = {
            rows: [
              Match.value(pick % 3).pipe(
                Match.when(0, () => ""),
                Match.when(1, () => "!docs/**"),
                Match.orElse(() => Str.repeat(65_537)("x")),
              ),
            ],
            docs: [],
          };
        } else {
          broken.queue.checks = {
            rows: [],
            docs: [],
            code: [pick % 2 === 0 ? { name: "" } : { name: "check", source: "" }],
          };
        }

        // A zero poll was once missed by this generated table's invalid-value draw.
        expect(Exit.isFailure(read({ ...table, merger: { ...table.merger, poll: 0 } }))).toBe(true);
        expect(Exit.isFailure(read({ ...table, merger: { ...table.merger, rounds: 0 } }))).toBe(true);
        expect(Exit.isFailure(read({ ...table, queue: { ...table.queue, most: 0 } }))).toBe(true);
        const refused = read(broken);
        expect(Exit.isFailure(refused)).toBe(true);

        if (Exit.isFailure(refused)) {
          const keys = Arr.flatMap(refused.cause.reasons, (reason) =>
            reason._tag === "Fail" && reason.error.cause._tag === "SchemaError"
              ? Arr.map(SchemaIssue.makeFormatterStandardSchemaV1()(reason.error.cause.issue).issues, (issue) =>
                  Arr.join(
                    Arr.map(issue.path ?? [], (part) => String(Predicate.isObject(part) ? part.key : part)),
                    ".",
                  ),
                )
              : [],
          );

          expect(keys.length).toBeGreaterThan(0);

          for (const key of keys) {
            expect(key).toContain(path);

            for (const good of Arr.filter(paths, (p) => p !== path)) {
              expect(key).not.toContain(good);
            }
          }
        }
      },
    ),
    { seed: 119120, numRuns: 100 },
  );
});

it("L11: every declared numeric setting refuses zero, negatives and fractions at its own path", () => {
  fc.assert(
    fc.property(invalid, fc.nat(), (bad, pick) => {
      const declarations = Arr.filter(Settings.all.declarations, (d) => Predicate.isNumber(d.default));
      expect(declarations.length).toBeGreaterThan(0);
      const declaration = declarations[pick % declarations.length]!;
      const [group, key] = Str.split(declaration.path, ".") as [string, string];

      const parse = (value: Schema.Json) =>
        Effect.runSyncExit(Settings.all.parse(ConfigProvider.fromUnknown({ [group]: { [key]: value } })));

      for (const value of [bad, 0]) {
        const refused = parse(value);
        expect(Exit.isFailure(refused)).toBe(true);

        if (Exit.isFailure(refused)) {
          const paths = Arr.flatMap(refused.cause.reasons, (reason) =>
            reason._tag === "Fail" && reason.error.cause._tag === "SchemaError"
              ? Arr.map(SchemaIssue.makeFormatterStandardSchemaV1()(reason.error.cause.issue).issues, (issue) =>
                  Arr.join(
                    Arr.map(issue.path ?? [], (part) => String(Predicate.isObject(part) ? part.key : part)),
                    ".",
                  ),
                )
              : [],
          );

          expect(Arr.some(paths, (path) => Str.includes(declaration.path)(path))).toBe(true);
        }
      }
    }),
    { seed: 119120, numRuns: 100 },
  );
});
