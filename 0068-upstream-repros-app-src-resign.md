# 0068: both upstream repros in full; app-src plan amendment pushed for your re-sign

## App-src plan amendment (A5 moves to the Alchemy plan)

`fabrikalfa/mock-plans` is at `1bbc9c8ca3234d64b938eeebdb6bc7bb12948dbe`. It is one commit on top of
`14e9b3134`, and it changes only `docs/plan/quests/mock-app-src-PLAN.md`.

- **What changed:** under "Slice 1", a dated amendment says A5 moves to the 0042 Alchemy mocks plan
  as a normal row, with the TS2322 and TS2589 reasons and your ruling. The count table, the
  replacement row, the A5 row, the files row and the Size line all say the same.
- **Checks:**
  - plain `plancheck` exits 0;
  - `plancheck --approved` exits 1, as expected, since the body hash changed;
  - `pnpm lint` passes;
  - leakgrep is clean.
- **The merge session re-signs it.**
- **Date:** it is dated 2026-11-15, the Pacific date when it was written (about 23:45), not the
  2026-11-16 I asked for. That is right as it stands.
- **Next:** group 1's chained-`vi` amendment lands on top of this commit. I send its head too.
- app-src s1's review (A1 to A4) starts at group 3's next free seat.

## Repro (a), oxc: ready to paste

**Title:** linter: `vitest/no-restricted-vi-methods` does not report `vi.spyOn(...).mockImplementation(...)` or `vi.fn().mockReturnValue(...)`

**Versions:** oxlint 1.90.0 and 1.93.0 (the newest release today). Both give the same output.

`.oxlintrc.json`:
```json
{
  "plugins": ["vitest"],
  "rules": {
    "vitest/no-restricted-vi-methods": ["error", { "spyOn": "no spyOn", "fn": "no fn", "mock": "no mock" }]
  }
}
```

`repro.test.ts`:
```ts
import { vi } from "vitest";

vi.spyOn(console, "warn"); // 1. refused, as expected
(vi.spyOn(console, "warn")).mockImplementation(() => {}); // 2. refused, as expected
vi.spyOn(console, "warn").mockImplementation(() => {}); // 3. NOT refused
vi.fn(); // 4. refused, as expected
vi.fn().mockReturnValue(1); // 5. NOT refused
vi.mock("./a.ts").valueOf(); // 6. NOT refused
```

**Command:** `oxlint -c .oxlintrc.json repro.test.ts`

**Actual output** (1.90.0 and 1.93.0 alike):
```
repro.test.ts:3:4: error vitest(no-restricted-vi-methods): no spyOn
repro.test.ts:4:5: error vitest(no-restricted-vi-methods): no spyOn
repro.test.ts:6:4: error vitest(no-restricted-vi-methods): no fn
repro.test.ts:6:4: warning vitest(require-mock-type-parameters): Missing type parameters on mock function call ...
repro.test.ts:7:4: warning vitest(require-mock-type-parameters): Missing type parameters on mock function call ...
```

**Expected:** an error on lines 5, 7 and 8 as well. The restricted method is called there exactly as
on lines 3 and 6; only another call is chained onto its result. Line 4 is the same chain wrapped in
parentheses, and it IS reported. So the rule seems to look only at the outermost call of an
expression statement, not at a restricted `vi.<method>(...)` call that sits inside a member chain.

**Workaround, for the issue's context:** core `no-restricted-properties` with
`{ "object": "vi", "property": "spyOn" }` (and `fn`, `mock`) on the same file reports all six lines
(1:1, 2:2, 3:1, 6:1, 7:1, 8:1). So the member access is matched correctly there.

## Repro (b), Effect: ready to paste

**Title:** `TestConsole`: add `warnLines` (and `infoLines` / `debugLines`), since `warn` calls are recorded but cannot be read

**Versions:** effect 4.1.3, as installed. effect 4.1.4 and `main`'s
`packages/effect/src/testing/TestConsole.ts` were also checked: both have only `logLines` and
`errorLines`, and no issue or pull request names `warnLines`.

**Repro:**
```ts
import { Console, Effect } from "effect";
import { TestConsole } from "effect/testing";

const program = Effect.gen(function* () {
  yield* Console.log("a log");
  yield* Console.warn("a warning");
  yield* Console.error("an error");
  return {
    logLines: yield* TestConsole.logLines,
    errorLines: yield* TestConsole.errorLines,
    warnLines: "warnLines" in TestConsole ? "exported" : "not exported",
  };
}).pipe(Effect.provide(TestConsole.layer));

console.log(JSON.stringify(Effect.runSync(program)));
```

**Actual output:**
```
{"logLines":["a log"],"errorLines":["an error"],"warnLines":"not exported"}
```

**Expected:** a way to read `"a warning"` back. `TestConsole.make` already records every method as
`{ method, parameters }` (`src/testing/TestConsole.ts`, `createEntryUnsafe`), but the service and
the module expose only `logLines` and `errorLines`. So a test that checks what code warns cannot use
`TestConsole`, and has to spy on the global console instead.

**What our local patch adds** (with `pnpm patch`, in `src/`, `dist/` and `.d.ts`, shaped like
`errorLines`):
```ts
export interface TestConsole extends Console.Console {
  readonly logLines: Effect.Effect<ReadonlyArray<unknown>>
  readonly errorLines: Effect.Effect<ReadonlyArray<unknown>>
  /** The parameters of every `Console.warn` call, in order. */
  readonly warnLines: Effect.Effect<ReadonlyArray<unknown>>
}

// in make:
const warnLines = Effect.sync(() => Array.flatMap(entries, (entry) => entry.method === "warn" ? entry.parameters : []))
// ...returned beside logLines and errorLines

export const warnLines: Effect.Effect<ReadonlyArray<unknown>, never, never> = testConsoleWith(
  (console) => console.warnLines
)
```

The pipeline plan's slice adds `infoLines` and `debugLines` the same way, so the issue may want to
ask for all three at once. The patch is `patches/effect@4.1.3.patch`, on
`fabrikalfa/mock-app-e2e-s1` at `f02b31948`.

Both repros were run in a cloud box today. Group 1's coordinator wrote them.
