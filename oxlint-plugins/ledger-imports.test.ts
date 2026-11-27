// L1, T2082: what the Ledger's source files may import, read through the repository's own `.oxlintrc.json`. The plan's lint law is the config itself, so this
// plants one import line of each kind in each kind of file under `kalfa/ledger/src` and asks the config which lines it refuses. It runs oxlint's built-in
// `no-restricted-imports` rule alone, as the config's blocks hold it.
//
// What the plan says (L1): a product file refuses every other package of this repository, but `@kalfa/diagnostics/Hidden` alone (not its root or another entry point), every Telemetry package, a platform package,
// `fast-check`, a Node module under both spellings and a path out of the package; the test tools (`vitest`, `@effect/vitest`) load in `LedgerTest.ts` only, and
// `LedgerTest.ts` takes nothing else of what the rest refuse; `fast-sha256` loads in `EntryId.ts` only.
import { expect, it } from "@effect/vitest";
import { Array as Arr } from "effect";
import { plant } from "./plant.ts";

const RULE = "eslint(no-restricted-imports)";

const DIR = "kalfa/ledger/src";

/** What no file of the package imports: each module with the kind it is of, so a failure says which kind slipped through. */
const REFUSED: ReadonlyArray<readonly [string, string]> = [
  ["@kalfa/config", "another kalfa package"],
  ["@kalfa/secrets", "another kalfa package, its root"],
  ["@kalfa/diagnostics", "Diagnostics' root: only its Hidden entry point is let in"],
  ["@kalfa/diagnostics/Diagnostic", "another entry point of Diagnostics"],
  ["@kampus/vitest", "a repository package"],
  ["@tea-fabrika/anything", "a repository package"],
  ["@demlik/tea", "a demlik package"],
  ["@opentelemetry/api", "Telemetry, the API"],
  ["@opentelemetry/sdk-trace-base", "Telemetry, an SDK package"],
  ["@effect/opentelemetry", "Telemetry, Effect's"],
  ["@effect/opentelemetry/Tracer", "Telemetry, Effect's subpath"],
  ["@effect/platform-node", "a platform package"],
  ["@effect/platform-node/NodeFileSystem", "a platform package's subpath"],
  ["fast-check", "a generator library"],
  ["node:crypto", "a Node module, with its prefix"],
  ["crypto", "a Node module, with no prefix"],
  ["node:fs/promises", "a Node module's subpath"],
  ["../../../next/packages/libfabrika/src/index.ts", "a path out of the package"],
];

/** What the test tools are: loaded in `LedgerTest.ts` and nowhere else of the package. */
const TEST_TOOLS: ReadonlyArray<readonly [string, string]> = [
  ["vitest", "the test runner"],
  ["@effect/vitest", "the test runner's Effect tools"],
];

/** What every file of the package may import. */
const ALLOWED: ReadonlyArray<readonly [string, string]> = [
  ["effect", "Effect's barrel"],
  ["effect/Schema", "an Effect module"],
  ["./Entry.ts", "a file of the package"],
  ["@kalfa/diagnostics/Hidden", "the hidden cause"],
];

/** `fast-sha256`: `EntryId.ts` alone. */
const HASH: readonly [string, string] = ["fast-sha256", "the hash"];

/** The files of the package that are neither tests nor test support, and what each refuses and allows. */
const FILES: ReadonlyArray<{
  readonly file: string;
  readonly refused: ReadonlyArray<readonly [string, string]>;
  readonly allowed: ReadonlyArray<readonly [string, string]>;
}> = [
  { file: "Entry.ts", refused: [...REFUSED, ...TEST_TOOLS, HASH], allowed: ALLOWED },
  { file: "Errors.ts", refused: [...REFUSED, ...TEST_TOOLS, HASH], allowed: ALLOWED },
  { file: "Ledger.ts", refused: [...REFUSED, ...TEST_TOOLS, HASH], allowed: ALLOWED },
  { file: "internal/checks.ts", refused: [...REFUSED, ...TEST_TOOLS, HASH], allowed: ALLOWED },
  { file: "MemoryLedger.ts", refused: [...REFUSED, ...TEST_TOOLS, HASH], allowed: ALLOWED },
  { file: "EntryId.ts", refused: [...REFUSED, ...TEST_TOOLS], allowed: [...ALLOWED, HASH] },
  // `LedgerTest.ts` is the one file that loads the test tools, and it takes nothing else that the rest refuse.
  { file: "LedgerTest.ts", refused: [...REFUSED, HASH], allowed: [...ALLOWED, ...TEST_TOOLS] },
];

/** One file of lines, one import each, so a fire's line says which module it was. */
const written = (modules: ReadonlyArray<readonly [string, string]>): string =>
  `${Arr.join(
    Arr.map(modules, ([module], at) => `import * as m${at} from ${JSON.stringify(module)};`),
    "\n",
  )}\n`;

// L1. Plant: leave `**/*Test.ts` out of the block's `excludeFiles` and give `LedgerTest.ts` no block of its own (an `@opentelemetry/api`, `@effect/opentelemetry`,
// `@kalfa/config` or `@effect/platform-node` import in `LedgerTest.ts` is not refused); drop one pattern group from the block; refuse `@kalfa/diagnostics/Hidden`
// with the rest of the `@kalfa/` group (the allowed line is refused); widen the exception to `!@kalfa/diagnostics/**` (the root and `/Diagnostic` lines pass); let `vitest` through in `Errors.ts`.
it("scenario: L1 each file of the package refuses exactly the imports it should, and LedgerTest.ts loads the test tools and nothing else the rest refuse", async () => {
  // scenario: the config at head and one planted line of each kind of import in each kind of file; no generated input says which package a config block refuses.
  const files = Object.fromEntries(
    Arr.map(FILES, ({ file, refused, allowed }) => [`${DIR}/${file}`, written([...refused, ...allowed])]),
  );

  const fires = await plant(files, undefined, "eslint/no-restricted-imports");

  for (const { file, refused, allowed } of FILES) {
    expect(
      // A module the config refuses twice (`@effect/platform-node` is named and in a group) is one line.
      [...new Set(fires(RULE, `${DIR}/${file}`))],
      `${file}: it refuses the ${refused.length} imports it should, and none of the ${allowed.length} it may hold (${Arr.join(
        Arr.map(refused, ([, kind]) => kind),
        ", ",
      )})`,
    ).toEqual(Arr.map(refused, (_, position) => position + 1));
  }
});
