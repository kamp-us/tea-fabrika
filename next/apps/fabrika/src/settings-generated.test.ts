// T730, P38 slice 2, next/: L1 and L9 of the approved plan. Written before the build.
//
// The shape these tests hold the app and libfabrika to:
// - The committed `next/apps/fabrika/person.json` and `repo.json` are, byte for byte,
//   `JsonSchema.format(JsonSchema.make(Files.schema(Declarations.all, file)))`: stable JSON with one
//   trailing newline. `docs/settings-reference.md` holds `Reference.markdown(Declarations.all)`
//   whole, with the docs step's own words around it. `settings-generate.ts` writes all three
//   through those functions, so regenerating changes nothing.
// - All three outputs depend on the declarations alone, never on their order, and a changed doc or
//   default reaches every output that shows that declaration.
// - L9, that only the start files import the TOML adapter and only the adapter imports its parser, is
//   oxlint's own `no-restricted-imports`; its law is oxlint-plugins/settings-imports.test.ts (0591).
import { NodeServices } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import * as Declarations from "@kampus/libfabrika/settings/Declarations";
import * as Files from "@kampus/libfabrika/settings/Files";
import * as JsonSchema from "@kampus/libfabrika/settings/JsonSchema";
import * as Reference from "@kampus/libfabrika/settings/Reference";
import * as Setting from "@kampus/libfabrika/settings/Setting";
import { Effect, FileSystem, Path, Result, Schema } from "effect";
import * as fc from "fast-check";

const SEED = 119120; // the shared seed (AGENTS.md), so a red run repeats
const check = { seed: SEED, numRuns: 100 };

/** The three generated outputs for a group, as the generation entry writes them. */
const outputs = <A>(group: Setting.Group<A>) => ({
  person: JsonSchema.format(JsonSchema.make(Files.schema(group, "person"))),
  repo: JsonSchema.format(JsonSchema.make(Files.schema(group, "repo"))),
  reference: Reference.markdown(group),
});

const committed = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem,
    path = yield* Path.Path;
  const app = path.resolve(import.meta.dirname, "..");
  return {
    person: yield* fs.readFileString(path.join(app, "person.json")),
    repo: yield* fs.readFileString(path.join(app, "repo.json")),
    reference: yield* fs.readFileString(path.resolve(app, "../../../docs/settings-reference.md")),
  };
}).pipe(Effect.provide(NodeServices.layer), Effect.runPromise);

const Port = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 65535 }));
const segment = fc.stringMatching(/^[a-z][a-z0-9]{0,5}$/);
const doc = fc.stringMatching(/^[A-Z][a-z |*_`#\n]{3,30}\.$/);

const declared = fc.uniqueArray(
  fc.record({
    table: segment,
    key: segment,
    doc,
    default: fc.integer({ min: 1, max: 65535 }),
    scope: fc.constantFrom<Setting.Scope>(["person"], ["repo"], ["person", "repo"]),
  }),
  { minLength: 1, maxLength: 5, selector: (d) => `${d.table}.${d.key}` },
);

type Declared = typeof declared extends fc.Arbitrary<infer D> ? D : never;

const grouped = (ds: Declared) =>
  Setting.group(
    Object.fromEntries(
      ds.map((d) => [
        `${d.table}_${d.key}`,
        Setting.make(`${d.table}.${d.key}`, {
          schema: Port,
          default: d.default,
          doc: d.doc,
          scope: d.scope,
          reload: "restart",
          since: "0.0.0",
        }),
      ]),
    ),
  );

describe("L1, the generated schemas and reference stay fresh and deterministic", () => {
  it.prop(
    "T843 generated settings: person scope carries both rate declarations and repo scope rejects them (50 runs)",
    {
      limit: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 1000 })),
      window: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 100_000 })),
    },
    ({ limit, window }) => {
      expect(
        Result.isSuccess(
          Schema.decodeUnknownResult(Files.schema(Declarations.all, "person"), { onExcessProperty: "error" })({
            gateway: { limit, window },
          }),
        ),
      ).toBe(true);

      for (const gateway of [{ limit }, { window }, { limit, window }]) {
        expect(
          Result.isFailure(
            Schema.decodeUnknownResult(Files.schema(Declarations.all, "repo"), { onExcessProperty: "error" })({
              gateway,
            }),
          ),
        ).toBe(true);
      }

      const generated = outputs(Declarations.all);
      expect(generated.reference).toContain("gateway.limit");
      expect(generated.reference).toContain("gateway.window");
    },
    { arbitrary: { seed: SEED, runs: 50 } },
  );
  it("format: the committed person.json, repo.json and reference are what generation writes", async () => {
    // format: editors read the two schemas and people read the reference exactly as committed, so
    // the committed bytes must be the generator's output for the shipped declarations.
    const files = await committed;
    const fresh = outputs(Declarations.all);
    expect(files.person).toBe(fresh.person);
    expect(files.repo).toBe(fresh.repo);
    expect(files.reference).toContain(fresh.reference);
    expect(fresh.person.endsWith("}\n") && !fresh.person.endsWith("\n\n")).toBe(true);
    expect(fresh.repo.endsWith("}\n") && !fresh.repo.endsWith("\n\n")).toBe(true);
  });

  it("outputs ignore declaration order, and a changed doc or default reaches each output that shows it", () => {
    fc.assert(
      fc.property(
        declared.chain((ds) =>
          fc.tuple(
            fc.constant(ds),
            fc.shuffledSubarray(
              ds.map((_, n) => n),
              { minLength: ds.length, maxLength: ds.length },
            ),
            fc.nat(ds.length - 1),
            fc.oneof(
              doc.map((d) => ({ _tag: "doc" as const, doc: d })),
              fc.integer({ min: 1, max: 65535 }).map((v) => ({ _tag: "default" as const, default: v })),
            ),
          ),
        ),
        ([ds, order, at, change]) => {
          const base = outputs(grouped(ds));
          expect(outputs(grouped(order.map((n) => ds[n]!)))).toEqual(base);

          const before = ds[at]!;
          const after = change._tag === "doc" ? { ...before, doc: change.doc } : { ...before, default: change.default };
          // A doc that differs only in spacing may read the same in Markdown, so the change is in its words.
          const words = (text: string) => text.replace(/\s+/g, " ").trim();
          fc.pre(change._tag === "doc" ? words(change.doc) !== words(before.doc) : change.default !== before.default);
          const changed = outputs(grouped(ds.map((d, n) => (n === at ? after : d))));
          expect(changed.reference).not.toBe(base.reference);
          expect(changed.person !== base.person).toBe(before.scope.includes("person"));
          expect(changed.repo !== base.repo).toBe(before.scope.includes("repo"));
        },
      ),
      check,
    );
  });
});

it.prop(
  "P21 L10: the person editor accepts desktop lifetimes and the repo editor rejects them",
  {
    lifetime: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER })),
  },
  ({ lifetime }) => {
    const value = { desktop: { "link-ttl": lifetime } };
    expect(
      Result.isSuccess(
        Schema.decodeUnknownResult(Files.schema(Declarations.all, "person"), {
          onExcessProperty: "error",
        })(value),
      ),
    ).toBe(true);
    expect(
      Result.isFailure(
        Schema.decodeUnknownResult(Files.schema(Declarations.all, "repo"), {
          onExcessProperty: "error",
        })(value),
      ),
    ).toBe(true);
  },
  { arbitrary: { seed: SEED, runs: 100 } },
);
