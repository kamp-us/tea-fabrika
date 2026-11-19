---
id: 0554
title: In next/ and our tooling, no code calls Reflect.get, Reflect.set or Reflect.has, so a field is read through its type or a decode, never past it
status: accepted
date: 2026-11-15
tags: [lint, oxlint, reflect, types, schema, predicate, laws, next, tooling]
---

# 0554: In next/ and our tooling, no code calls Reflect.get, Reflect.set or Reflect.has, so a field is read through its type or a decode, never past it

```ts
// before: each call answers `any`, so the type checker sees nothing
const rev: unknown = Reflect.get(Object(raw), "rev");
const ref = Reflect.get(monitor, "ref");

// after (a sketch, not compiled): decode a loose value once, then read plain fields
const Seen = Schema.Struct({ rev: Schema.Number, by: Schema.String });
const entry = Schema.decodeUnknownOption(Seen)(raw);

// after: a typed value is read plainly, even before the build adds the field
const ref = monitor.ref;
```

**What this decides:** which `Reflect` calls are banned in `next/` and our tooling, what replaces
each kind of call, and how the ban is held.

## Context

- `Reflect.get` answers `any`. Our lint rules stop `as any` and `as unknown as T`
  (`fabrika/no-type-assertions`, `typescript/consistent-type-assertions`), so code reads a field
  through `Reflect.get` and gets the same blind spot with no lint fire.
- Counted on `origin/main` at `d564b996f` with `rg --hidden -g '!node_modules' -o` for
  `\bReflect\.(get|set|has)\(`, one pass per method, over `next/`, `.agents/`, `oxlint-plugins/`
  and `.github/ci/`:

  | Call | Matches | Files | Where |
  |---|---|---|---|
  | `Reflect.get` | 157 | 40 | all in `next/` |
  | `Reflect.set` | 6 | 6 | all in `next/` tests |
  | `Reflect.has` | 4 | 4 | all in `next/` tests, each inside a `Proxy` trap |

- Two `Reflect.get` matches are text inside a string that writes code
  (`next/apps/fabrika/src/exam/twin.integration.test.ts:95` and
  `next/apps/fabrika/src/instance-records.integration.test.ts:288`), so 155 are real calls. 150 are
  in test files. 2 are in test layers (`CodeHostTest.ts`, `QueueRunnerTest.ts`). 3 are in product
  code: `next/packages/libfabrika/src/cloudflare/control.ts:124`,
  `next/packages/libfabrika/src/settings/TomlParser.ts:35` and
  `next/packages/libfabrika/src/settings/internal/edit.ts:63`.
- The tooling folders have none.
- `next/` has 33 `new Proxy(` calls in 18 files, each read with its next two lines:
  - 11 are stubs that answer any method name, as a Cloudflare stub does;
  - 7 are guards that fail the law on any use the law did not expect;
  - 10 wrap a real object to count or change one member, one of them inside a string of generated
    code;
  - 4 are hostile inputs in property tests, where the `Proxy` is the value under test;
  - 1 is product code, the local dev client at `next/packages/libfabrika/src/node/dev/dev.ts:551`.
- 14 `Reflect.get` calls and all 4 `Reflect.has` calls are the pass-through inside a trap: 9
  `Reflect.get` in the wrappers, 2 `Reflect.get` and 1 `Reflect.has` in the stubs, 3 of each in
  the hostile inputs. A 15th `Reflect.get` pass-through is the one in a string at
  `instance-records.integration.test.ts:288`.
- The dev client is typed as a bare record of functions (`dev.ts:52`), so it carries no method
  names. A test cannot write `instance.project(p).start(...)` and writes
  `Reflect.get(instance.project(p), "start")(...)`. A one-line search for that shape finds 14 such
  calls in 7 test files; calls split over two lines are not in that number.
- The installed Effect was 4.1.2 on 2026-11-15 (`pnpm-workspace.yaml`'s catalog entry for `effect`
  says what it is now; `node_modules/effect/package.json` names `Effect-TS/effect` as its
  repository). Its `AGENTS.md` says to use `Schema` to parse untrusted
  data, and to use the `Predicate` module's checks over hand-written ones. In `Effect-TS/effect`,
  GitHub's code search finds `Reflect.get(` in 18 files: mostly tests, where it is the pass-through
  in a `Proxy` trap or a swapped global, plus a few source files such as
  `packages/effect/src/Formatter.ts`. Their own `Layer.mock` is a `Proxy` inside
  (`node_modules/effect/src/Layer.ts:4250`), and it forwards with `target[prop as keyof S]`, a cast
  our lint rules refuse.
- No earlier decision names `Reflect`. This builds on
  [0524](0524-no-list-lets-broken-code-pass.md): the ban gets no list of leftovers.
- It adds one thing to what [0538](0538-kampus-vitest-holds-the-test-primitives.md) puts in the
  test package, `@kalfa/quality/vitest` ([0557](0557-kalfa-vitest-is-the-test-toolbox.md),
  [0600](0600-kalfa-quality-holds-test-lint-format.md)): the fakes of Cloudflare objects. The
  package imports no service of ours (0538), and such a fake imports none either.

## Decision

**In `next/` and our tooling, no code calls `Reflect.get`, `Reflect.set` or `Reflect.has`: each
reads or writes past the types (owner, 2026-11-15).**

- **Scope:** `next/`, and our tooling: the lead and step scripts under `.agents/`,
  `oxlint-plugins/` and `.github/ci/`. Today's app (`packages/`, `programs/`, `apps/`) is not
  covered.
- **What replaces each kind of call.** Each API below was read in the installed source. None of the
  replacements was compiled for this file.

  | The call reads or writes | Use | Where it is in the installed Effect |
  |---|---|---|
  | fields of a loose or `unknown` value | one schema, decoded once, then plain fields: `Schema.decodeUnknownOption`, `decodeUnknownResult`, `decodeUnknownExit` or `decodeUnknownEffect` | `node_modules/effect/src/Schema.ts` |
  | one field in a check | `Predicate.hasProperty(x, "name") && x.name === ...`; for `_tag`, `Predicate.isTagged` | `node_modules/effect/src/Predicate.ts` |
  | a field of one of our own classes or errors | `Schema.is(TheClass)(x)`, then the typed field | `node_modules/effect/src/Schema.ts` |
  | a field on one case of a union | narrow on the case first, then read the field | plain TypeScript |
  | a field the type already has | read it: `model.handshake` | plain TypeScript |
  | a value on `globalThis` | declare the global once with its type, then read and assign it by name | plain TypeScript |

  There is no bare `Schema.decodeUnknown` in the installed Effect. Use one of the four named ones.
  `decodeUnknownSync` is not a replacement: `schemaSync` is an error in `next/` and our tooling
  ([0576](0576-schema-sync-error-result-in-plain-code.md)).
- **A law that reads a field the build has not added yet writes the field plainly:** `monitor.ref`,
  never `Reflect.get(monitor, "ref")`. The type error is the law's red until the build adds the
  field. It is the ordinary red then green loop. The tests step reports it the way
  [the tests skill](../.agents/skills/tests/SKILL.md) already says: a type law is red only in a
  typecheck, the report says so, and the build runs it.
- **`Proxy` itself is not banned.** The fakes of Cloudflare objects live in one place, `next/`'s
  shared test tooling, `@kalfa/quality/vitest`
  ([0538](0538-kampus-vitest-holds-the-test-primitives.md),
  [0557](0557-kalfa-vitest-is-the-test-toolbox.md),
  [0600](0600-kalfa-quality-holds-test-lint-format.md)), read through its module
  ([0029](0029-format-and-names-follow-effect.md)). A law calls the helper and does not write the
  fake by hand. The helper's shape and file name are the plan step's to decide.
- **One narrow exception: a pass-through `Reflect` line inside a `Proxy` trap, in two places only.**
  The shared helper above, and the 4 hostile-input `Proxy` objects in property tests. Nowhere else.
  `Reflect.get(target, key, receiver)` is the language's own way to forward a trap. Each such line
  takes `// oxlint-disable-next-line <rule> -- <why>` with its reason in plain words, as
  [`AGENTS.md`](../AGENTS.md#checks) allows where the code is right and the rule does not fit.
- **Held at zero by a lint rule oxlint already has:** `eslint/no-restricted-properties`, which
  `.oxlintrc.json` uses today for `JSON.parse`, `Effect.retry` and `setBounds`.

  ```jsonc
  // a sketch, not run
  "eslint/no-restricted-properties": [
    "error",
    { "object": "Reflect", "property": "get", "message": "Decode with Schema, or narrow first (0554)." },
    { "object": "Reflect", "property": "set", "message": "Assign through the type (0554)." },
    { "object": "Reflect", "property": "has", "message": "Narrow with Predicate.hasProperty (0554)." }
  ]
  ```

  An override replaces a rule's options, so each block that already sets this rule repeats the
  three entries.

**Binding constraints**

- No list of allowed leftovers, and no warn level ([0524](0524-no-list-lets-broken-code-pass.md)).
  The old calls are fixed, never listed.
- A fix does not swap one way past the types for another: no `Object(x)[key]`, no single `as` to a
  loose record, no `Object.getOwnPropertyDescriptor(x, k)?.value`.
- A disable line is only for a `Proxy` trap's pass-through in the shared helper or a hostile-input
  `Proxy`, one line each, with its reason.
- No law writes a fake of a Cloudflare object by hand.

## Consequences

- This file records the ban and how it is held: `.oxlintrc.json`'s `eslint/no-restricted-properties`
  sets the three entries. The cleanup of the old calls is a later pull request.
- **The cost:** 167 matches in 40 files of `next/`. Most are one-line changes in tests. The loops
  that read many fields off one entry each need a schema, and a schema that refuses a whole entry
  drops fields the old loop still read, so each is checked by hand.
- **Stricter than the makers.** The Effect team keeps `Reflect.get` for swapped globals in its own
  tests and in a few source files. We do not.
- **Work the cleanup must do, beside the line-by-line fixes:**
  - **One or two helpers in `@kalfa/quality/vitest`** take the place of the 11 stubs that answer any
    method name and the 7 guards that fail on any use, and the laws call them. Those 18 sit in 9
    test files today.
  - **The 9 wrappers a plain object can replace are swapped for one,** as
    `next/packages/libfabrika/src/node/launchd/Launchd.test-support.ts:294` already does for the
    file system: `{ ...fs, open: ... }`. Their 9 pass-through `Reflect.get` lines go with them.
    The 10th wrapper is the one in a string.
  - **The dev client gets real types.** `project` and `process` in `dev.ts` answer a typed client,
    so the calls made through it by name become plain calls: at least 14 in 7 test files. That is
    product code, so it is its own planned pull request.
- **Three product lines have no line-for-line fix.** `control.ts:124` calls a method by a name held
  in a variable, which needs a table of typed functions or a tagged request. `TomlParser.ts:35`
  and `edit.ts:63` walk a path by key and need a narrow per step.
- **Places on main that teach these calls, for the cleanup to fix:**
  - `oxlint-plugins/README.md:541`, a table row that names `Reflect.get` in `dev.ts`. The call is
    gone from that file, so the row is stale.
  - `next/apps/fabrika/src/exam/twin.integration.test.ts:95` and
    `next/apps/fabrika/src/instance-records.integration.test.ts:288` write `Reflect.get(...)` into
    generated code. The lint rule cannot see inside a string, so the cleanup reads both by hand.
  - `.patterns/effect-platform-wrapped-once.md:38` and
    `.patterns/effect-errors-keep-their-cause.md:39` show `Reflect.apply(stub[name], stub, args)`.
    `Reflect.apply` is not decided here, so they stand, but the cleanup reads them again.
- **What the lint rule may miss, untested:** `globalThis.Reflect.get`, `const R = Reflect`, and a
  destructured `const { get } = Reflect`. The lint pull request plants each to find out.
- **The hold moves to the test package later.** `next/`'s test package is `@kalfa/quality/vitest`
  ([0538](0538-kampus-vitest-holds-the-test-primitives.md),
  [0557](0557-kalfa-vitest-is-the-test-toolbox.md),
  [0600](0600-kalfa-quality-holds-test-lint-format.md)). 0557 records the owner's rule: a mechanism
  that package does not export is not used, and one we need is built in that package. The shared
  helper for Cloudflare fakes lives there. The lead's reading of what follows here: once tests get
  their tools only from that package, the ban in test code is held by what the package does not
  export, plus one lint rule that no file outside it imports `vitest` or `@effect/vitest` directly.
  Until tests get their tools only from that package, the oxlint rule named above holds the ban.
- **Not decided here:**
  - `Reflect.apply`, `Reflect.construct` and `Reflect.deleteProperty`.
  - What replaces a law that hands a typed function a value its type refuses, which today goes
    through `Reflect.apply(Reflect.get(...))`.
- [0563](0563-anti-slop-plugin-as-it-ships.md): the hold named above may move to the plugin's own
  `anti-slop/no-reflect-get` when the plugin is installed. The ban itself does not change.
