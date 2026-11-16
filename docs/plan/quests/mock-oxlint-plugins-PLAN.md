
Plancheck-Version: 3

# The mock sweep in `oxlint-plugins/`: its one `vi.fn` becomes a plain list, and the folder is locked at zero

```ts
// oxlint-plugins/no-question-word-key.test.ts:260, today
const report = vi.fn();
const context: Pick<Context, "report"> = { report };
// ...
expect(report.mock.calls).toEqual(keys.map((key) => [{ node: key, message }]));

// after: the test owns a plain list of what the rule reported
const reports: Array<Diagnostic> = [];
const context: Pick<Context, "report"> = { report: (diagnostic) => void reports.push(diagnostic) };
// ...
expect(reports).toEqual(keys.map((key) => ({ node: key, message })));
```

```jsonc
// .oxlintrc.json: one new override. The folder list grows as each folder reaches zero.
{
  // 0555, 0579: no test makes a stand-in or watches a call with vi. A folder joins `files` in the
  // slice that takes it to zero; the last one makes the list next/ and the three tooling folders.
  "files": ["oxlint-plugins/**"],
  "rules": {
    "vitest/no-restricted-vi-methods": [
      "error",
      {
        "fn": "Watch calls with a Recorder, or keep a plain list the test owns (0579).",
        "mock": "Give the code a service and provide a test layer (0555).",
        "doMock": "Give the code a service and provide a test layer (0555).",
        "spyOn": "Put the call behind a service and record it in the law's layer (0555).",
        "stubEnv": "Read through Config and provide a ConfigProvider layer (0555)."
      }
    ]
  }
}
```

All of this is our tooling, the `oxlint-plugins/` folder. Today's app is not touched, and `next/`
is not touched.

## The answer first

- **One pull request, about 45 lines, no product code.** It rewrites the folder's one `vi.fn`, adds
  the lock rule for the folder, plants it, and notes it in the folder's README.
- **The count, again on main at `f7169af`** with `nice -n 19 rg --hidden -g '!node_modules' -o`
  for `\bvi\.(fn|spyOn|mock|doMock|stubEnv)\(` and `toHaveBeenCalled\w*`: 1 `vi.fn(` call
  (`oxlint-plugins/no-question-word-key.test.ts:260`), 0 `toHaveBeenCalled*`, 0 `vi.spyOn(`.
  The other 2 matches are text in plants (`oxlint-plugins/builtin-plants.ts:699-700`), not calls.
  The recorder plan's row (1, 0, 0) holds.
- **What the `vi.fn` watches:** an oxlint `report` callback, the one `Context` member the rule
  calls. It is a callback handed to a rule, not a service, so there is nothing for the Recorder to
  wrap. The recorder plan's row says what replaces it: a plain list the rule test owns. No product
  change comes first.
- **The lock exists in oxlint, and no folder has it on yet.** `vitest/no-restricted-vi-methods` is
  the rule 0555 names. Probed in this session on the installed oxlint 1.90.0 (the lockfile): it
  refuses `vi.fn()` and `vi.spyOn(...)` with the given message, and it also refuses `v.fn()` after
  `import { vi as v } from "vitest"`, the gap 0555 said the lint pull request plants to find out.
- **Call, 85%: the lock bans `fn` too, beside 0555's four.** 0579 says the Recorder replaces the
  `vi.fn` uses, so a folder at zero keeps no `vi.fn`; banning it is that ruling applied, not a new
  one. The doubt: 0555's sketch lists only four methods. What would settle it: the lead reading
  0579's "It replaces" line as covering a callback with no service, which the recorder plan's row
  already does.
- **Open questions: none.**

## How others do it

- **oxlint and eslint-plugin-vitest.** `vitest/no-restricted-vi-methods` is a port of
  `vitest/no-restricted-vi-methods` in `eslint-plugin-vitest`, itself after Jest's
  `jest/no-restricted-jest-methods`: an object of method name to message. Read in this session by
  running it, not from its docs page (not fetched).
- **A plain list for a callback is how ESLint's own rule tests watch `report`.** ESLint's
  `RuleTester` collects every `context.report` into a list of messages and compares the list
  (`lib/rule-tester/rule-tester.js` in `eslint/eslint`, from memory, not fetched). This folder's
  own laws do the same through oxlint's `RuleTester` (`oxlint-plugins/plants.test.ts:310`).
- **Effect's own tests** use `vi.fn` in places (0555's Context counted their `vi.spyOn`); we are
  stricter, as 0555 says.

## The shape

The one law that changes is the `format` law at `oxlint-plugins/no-question-word-key.test.ts:259`.

```ts
import type { Context, Diagnostic, ESTree } from "@oxlint/plugins";
import { expect, it } from "vitest"; // `vi` leaves the import

it("format: diagnostic names the five words and offers no autofix", () => {
  const reports: Array<Diagnostic> = [];
  // This diagnostic check supplies only the Context method this rule calls.
  const context: Pick<Context, "report"> = { report: (diagnostic) => void reports.push(diagnostic) };
  const visitor = noQuestionWordKey.create(context as Context);
  // ... the same keys and the same loop as today ...
  expect(reports).toEqual(
    keys.map((key) => ({
      node: key,
      message:
        "Name this key with the noun for the value it holds: where, why, what, who and how are question words, never names (0081).",
    })),
  );
});
```

- `Diagnostic` is exported by `@oxlint/plugins` 1.90.0 (`index.d.ts:4114`), and `report` takes
  exactly one argument (`report(this: void, diagnostic: Diagnostic): void`, `index.d.ts:3891`). So
  the list of single values loses nothing that `mock.calls`' list of argument lists held.
- The law keeps every part it has: the five words reported once each, in order, the `Identifier`
  key `why` not reported, the exact message, and no `fix` or `suggest` field (`toEqual` on the
  whole object refuses an extra key).
- The `context as Context` cast stays as today, with its comment: the rule reads only `report`.
- The lock is the override in the second block at the top, placed after the `oxc/no-accumulating-spread`
  override (the first in `overrides`, `.oxlintrc.json:423`). It is an error, with no warn line and
  no list of leftovers ([0524](../../../.decisions/0524-no-list-lets-broken-code-pass.md)).
- **Is this a setting?** No: a lint rule's scope is the repo's own code rule, not a choice a
  person makes in `fabrika.toml` ([0069](../../../.decisions/0069-choices-are-settings.md)).

## One value traced

The key `"what"` goes through the rewritten law: the visitor's `Property` handler sees a `Literal`
key whose value is a question word, calls `context.report({ node, message })`, the arrow pushes
that one object, and `reports[2]` is `{ node: keys[2], message: "Name this key ..." }`. The
`Identifier` key `why` reaches the same handler, is left to `eslint(id-denylist)`, and adds
nothing, so `reports.length` is 5.

## Laws

| Law | Kind (lint, type or test?) | Generator | Plant | Where |
|---|---|---|---|---|
| M1, the `format` law: the rule reports each of the five question-word keys once, in order, with the one message and no autofix, and does not report an identifier key | test | format: the one exact message, over the five fixed words; the generated laws above it in the file stay as they are | in `oxlint-plugins/no-question-word-key.ts`, add `fix: () => null` to the report object, or skip the report for `"how"`: `reports` differs from the expected list and M1 is red | `oxlint-plugins/no-question-word-key.test.ts` |
| M2, the lock refuses `vi.fn`, `vi.spyOn`, `vi.mock`, `vi.doMock` and `vi.stubEnv`, and `v.fn` after `import { vi as v }`, in a test file under `oxlint-plugins/`, and takes a plain list | test, of a lint rule | scenario: the real oxlint over the planted file through the repo's own config, as every built-in plant runs | delete the new override: the six refused lines stop firing and M2 is red. Before the override exists M2 is red the same way | `oxlint-plugins/builtin-plants.ts` |
| M3, the lock is on only where the folder is at zero: it fires on a planted `vi.fn()` under `oxlint-plugins/` and not on the same line under `next/` or `packages/` | test, of a lint config | scenario: the "rules that apply by path" block's `plantIn` | (a) move the rule to the root `rules`: the `next/` and `packages/` rows turn red. (b) drop `oxlint-plugins/**` from `files`: its row turns red | `oxlint-plugins/plants.test.ts` |
| M4, the folder is at zero: `pnpm lint` passes with the lock an error, and no `oxlint-disable` line names it | lint | lint | put back `const report = vi.fn();`: `pnpm lint` exits 1 and names `no-question-word-key.test.ts` | `oxlint-plugins/no-question-word-key.test.ts` |

- **The plant entry for M2,** a sketch, in the `vitest` group of `BUILTIN_PLANTS`:

  ```ts
  {
    code: "vitest(no-restricted-vi-methods)",
    file: "planted.test.ts",
    prelude: [TEST, 'import { vi as v } from "vitest";'],
    lines: [
      ["const a = vi.fn();", true],
      ["const b = v.fn();", true],
      ['vi.spyOn(console, "log");', true],
      ['vi.mock("./c.ts");', true],
      ['vi.doMock("./d.ts");', true],
      ['vi.stubEnv("E", "f");', true],
      ["const g: Array<string> = []; g.push(\"h\");", false],
    ],
  },
  ```

- **The `vitest(hoisted-apis-on-top)` plant** (`builtin-plants.ts:699`) plants `vi.mock("./b.ts")`
  as its allowed line. Its planted file sits under `oxlint-plugins/`, so the lock now fires on that
  line too. `plants.test.ts` reads each plant's lines under its own code only
  (`plants.test.ts:77`), so that plant stays as it is; 0555's "the plant changes when the lint rule
  lands" does not apply to a per-code read. The tests step checks this by running the file, and if
  it is wrong it reports it rather than weakening the plant.
- **The plants are this plan's expectation from reading and one probe, not a run** of
  `plants.test.ts`. The tests step runs each one, sees it red, and takes it out again.
- Lint, type or test? M4 is the shape check, and it is lint. M2 and M3 test that the config does
  what it says. M1 is a test. No type law.
- No host-only law, no `.integration.` or `.visual.` file, no secrets.

## Steps

1. **Tests:** writes M1 to M4: the rewritten law, the override, the plant, the path rows and the
   README line. Every changed file is an exam path or the lint config, so it owns them all.
2. **Build:** no product code to write. It runs the checks (`pnpm lint`, the two test paths) at the
   tests step's head and reports green, or sends back. Expected to change no file.
3. **Review:** the one review of the whole diff against this plan, 0555 and 0579.

## Files

| File | Owner | Product lines expected | Change |
|---|---|---|---|
| `oxlint-plugins/no-question-word-key.test.ts` | tests | tests | M1: the `vi.fn` becomes a plain list, `vi` leaves the import, about 6 lines |
| `.oxlintrc.json` | tests | none | M2 to M4: the one override after the `oxc/no-accumulating-spread` one, about 15 lines |
| `oxlint-plugins/builtin-plants.ts` | tests | tests | M2: the plant entry, about 14 lines |
| `oxlint-plugins/plants.test.ts` | tests | tests | M3: three rows in the "rules that apply by path" block, about 10 lines |
| `oxlint-plugins/README.md` | tests | docs | one paragraph after the `oxc/no-accumulating-spread` one: the lock went on for this folder on its slice (0555, 0579), by an override whose `files` grows per folder, with `fn` banned too, and the renamed-import probe result |
| `oxlint-plugins/**`, `oxlint-plugins/` | tests | none | not changed beyond the files above: named by the override's `files` and by the text |
| `oxlint-plugins/no-question-word-key.ts` | tests | none | not changed: M1's plant is made here and taken out again |

## Validation

- The tests step, under `nice -n 15 pnpm exec vitest run --maxWorkers=3`, one path at a time:
  `oxlint-plugins/no-question-word-key.test.ts`, then `oxlint-plugins/plants.test.ts`.
- `pnpm format`, then `pnpm lint` with `NODE_OPTIONS=--max-old-space-size=6144`. Lint is M4.
- The lead, not a step, runs the changed tests once at the end and the one type check, which
  covers the new `Diagnostic` type import.
- The lead reads the diff for any `oxlint-disable` line that names the lock. There must be none.

## Size

Confidence in the line counts: 90%; the doubt is how many path rows M3 needs.

1. The rewrite, the lock, its plants and its README line, one pull request: 0 product lines, about
   30 test lines, about 15 config lines and 3 lines of docs. 45 lines.

Priced from the rows in `field/runs/` for 2026-11-10 to 2026-11-15 at list price, as the recorder
plan priced them, scaled down for a slice this small: a tests step about $4, a build that only runs
checks about $2, a review about $2, and one likely send-back about $3.

Estimate: 4 steps, $11

## Records

- **What is lost if not written now:** the before count (1, 0, 0 at `f7169af`) and the probe that
  the lock catches a renamed `vi` import. Both go in the tests run row and the pull request body.
- `oxlint-plugins/README.md`, as in the files table.
- `field/runs/` rows for each step.
- No glossary row: no word is coined. No pattern doc: the Recorder pattern doc already covers the
  service case, and a plain list for a callback is too small a shape to need one.

## What this cannot tell us

- **Whether the rewrite type-checks.** It was read, not compiled. The likeliest miss is the arrow's
  `void reports.push(...)` against `report`'s `void` return, which should be fine.
- **The other two tooling folders.** The lead scripts' folder and the CI scripts' folder have 0 real calls on main too;
  their 6 and 0 matches are text in test data and a comment (0555's Context names them). Whether
  their own slices join the lock's `files` at once is the lead's call on those slices, not this plan.
- **Other ways around the lock:** `vi["fn"]()` or a `vi` passed through a variable. The probe did not
  try them, and M2 does not plant them.
- **When the hold moves:** 0555 says the ban may later be held by `@kalfa/vitest` exporting no `vi`,
  or by `anti-slop/no-module-mocking` (0563). This override is the hold until then.

## Open questions

None.

## Findings

None.
