import { it, expect } from "@effect/vitest";
import { runsFor } from "@kampus/vitest";
import { Array as Arr, Record as Rec } from "effect";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { rolldown } from "rolldown";

const contract = new URL("../../../../packages/libfabrika/src/access/ClientManager.ts", import.meta.url).pathname;

const forbidden = /\/(ClientManagerLedger|AccessFold|Referee|RefereeSql|LedgerTransactionSql|ledgerStore)\.ts$/;

const inspect = Effect.fnUntraced(function* (names: readonly string[] | null) {
  const loaded = new Set<string>();

  const bundle = yield* Effect.acquireRelease(
    Effect.tryPromise(() =>
      rolldown({
        input: names === null ? contract : "contract-selection",
        platform: "browser",
        plugins: [
          {
            name: "contract-selection",
            resolveId(id) {
              return id === "contract-selection" ? "\0contract-selection" : null;
            },
            load(id) {
              loaded.add(id);

              return id === "\0contract-selection"
                ? `export { ${Arr.join(names ?? [], ", ")} } from ${JSON.stringify(contract)};`
                : null;
            },
          },
        ],
      }),
    ),
    (bundle) => Effect.promise(() => bundle.close()),
  );

  const result = yield* Effect.tryPromise(() => bundle.generate({ format: "esm" }));
  const kept = Arr.flatMap(result.output, (chunk) => (chunk.type === "chunk" ? Rec.keys(chunk.modules) : []));
  expect(Arr.filter([...loaded], (id) => forbidden.test(id))).toEqual([]);
  expect(Arr.filter(kept, (id) => forbidden.test(id))).toEqual([]);
});

// The direct entry takes no input, so one bundle of it serves every case.
let direct = false;

it.effect.prop(
  "the browser contract excludes the ledger implementation for every export selection",
  { names: Schema.Array(Schema.Literals(["Founder", "Written"])) },
  ({ names }) =>
    Effect.gen(function* () {
      if (!direct) {
        yield* inspect(null);
        direct = true;
      }

      yield* inspect(["ClientManager", ...new Set(names)]);
    }).pipe(Effect.scoped),
  { timeout: 60_000, arbitrary: { seed: 119120, runs: runsFor({ fast: 10, full: 100 }) } },
);
