// L5 of the Reflect ban (decision 0554, docs/plan/quests/reflect-ban-PLAN.md): no ignore comment
// lets a Reflect call through `no-restricted-properties` outside the plan's 6 named lines. Generated
// files at next/ and tooling paths, linted with the repository's own config, so the counts the
// config allows are the ones read. A file's ignore comments that cover a Reflect line count, in each
// form and spelling oxlint honors; one that covers only a JSON.parse, a string or a comment does not.
// Plant: make the rule count no comment (`used` never grows), or raise a named file's count in
// `.oxlintrc.json`, and the extra comments pass.
import * as fc from "fast-check";
import { expect, it } from "vitest";
import { plant } from "./plant.ts";

const CODE = "fabrika(reflect-disables)";

const runs = { seed: 119120, numRuns: 12 };

// The plan's named files and the count each may hold, and paths it names no line in.
const NAMED: ReadonlyMap<string, number> = new Map([
  ["next/packages/libfabrika/src/runtime/Program.test.ts", 2],
  ["next/packages/libfabrika/src/transport/Connection.test.ts", 2],
  ["next/apps/fabrika/src/runtime.decode.test.ts", 2],
]);

const OTHER = [
  "next/packages/libfabrika/src/cloudflare/planted.test.ts",
  "next/apps/fabrika/e2e/planted.test-support.ts",
  "next/packages/libfabrika/src/node/dev/planted.ts",
  ".github/ci/planted.ts",
  ".agents/skills/lead/scripts/planted.ts",
] as const;

const call = fc.constantFrom(
  'Reflect.get(x, "a");',
  'Reflect.set(x, "a", 1);',
  'Reflect.has(x, "a");',
  'Reflect["get"](x, "a");',
  'globalThis.Reflect.get(x, "a");',
  "{ const { has } = Reflect; }",
);

// How a comment names the rule: with or without `eslint/`, beside another rule, or naming none.
const names = fc.constantFrom(
  " eslint/no-restricted-properties --",
  " no-restricted-properties --",
  " fabrika/no-of, eslint/no-restricted-properties --",
  " --",
);

const tool = fc.constantFrom("oxlint", "eslint");

/** One block of lines, and how many ignore comments in it let a Reflect call through. */
type Block = { readonly lines: readonly string[]; readonly counted: number };

// Counted: the next line, the same line, and a range to its enable or to the end of the file.
const counted: fc.Arbitrary<Block> = fc.oneof(
  fc
    .record({ tool, names, call })
    .map(({ tool, names, call }) => ({ lines: [`// ${tool}-disable-next-line${names} why`, call], counted: 1 })),
  fc
    .record({ tool, names, call })
    .map(({ tool, names, call }) => ({ lines: [`${call} // ${tool}-disable-line${names} why`], counted: 1 })),
  fc.record({ tool, names, call }).map(({ tool, names, call }) => ({
    lines: [`/* ${tool}-disable${names} why */`, "a();", call, `/* ${tool}-enable${names.replace(/ --$/, "")} */`],
    counted: 1,
  })),
);

// Half the blocks count, so a named file over its count of 2 is drawn in most runs.
const block: fc.Arbitrary<Block> = fc.oneof(
  { arbitrary: counted, weight: 6 },
  // Not counted: a JSON.parse oracle, Reflect only in a string or a comment, another rule's comment,
  // a range that ends before its Reflect line, and a Reflect call under no comment.
  names.map((names) => ({ lines: [`// oxlint-disable-next-line${names} oracle`, "JSON.parse(s);"], counted: 0 })),
  names.map((names) => ({
    lines: [`// oxlint-disable-next-line${names} why`, 's.concat("Reflect.get");'],
    counted: 0,
  })),
  call.map((call) => ({ lines: ["// oxlint-disable-next-line fabrika/no-of -- why", call], counted: 0 })),
  call.map((call) => ({
    lines: [
      "/* oxlint-disable eslint/no-restricted-properties -- why */",
      "a();",
      "/* oxlint-enable eslint/no-restricted-properties */",
      call,
    ],
    counted: 0,
  })),
  call.map((call) => ({ lines: [call], counted: 0 })),
  fc.constant({ lines: ["a();", "// Reflect.get in a comment"], counted: 0 }),
);

it("L5: a file's ignore comments that let a Reflect call through fail past its named count, and none else counts", async () => {
  const seen = { over: false, within: false, unnamed: false, ignored: false };

  await fc.assert(
    fc.asyncProperty(
      fc.uniqueArray(fc.constantFrom(...NAMED.keys(), ...OTHER), { minLength: 1, maxLength: 4 }),
      fc.array(fc.array(block, { maxLength: 6 }), { minLength: 4, maxLength: 4 }),
      async (paths, bodies) => {
        const files: Record<string, string> = {};
        const want: Record<string, number> = {};

        for (const [i, path] of paths.entries()) {
          const blocks = bodies[i] ?? [];
          const counted = blocks.reduce((sum, b) => sum + b.counted, 0);
          const allowed = NAMED.get(path) ?? 0;
          files[path] = [
            "declare const x: object;",
            "declare const s: string;",
            ...blocks.flatMap((b) => b.lines),
            "",
          ].join("\n");
          want[path] = Math.max(0, counted - allowed);
          seen.over ||= counted > allowed && allowed > 0;
          seen.within ||= counted > 0 && counted <= allowed;
          seen.unnamed ||= counted > 0 && allowed === 0;
          seen.ignored ||= blocks.some((b) => b.counted === 0 && b.lines.length > 1);
        }

        const result = await plant(files);

        for (const path of paths) {
          expect(result(CODE, path).length, files[path]).toBe(want[path]);
        }
      },
    ),
    runs,
  );

  // Coverage: a named file over and within its count, a file the plan names no line in, and a
  // comment that does not count were each drawn.
  expect(seen).toEqual({ over: true, within: true, unnamed: true, ignored: true });
}, 300_000);
