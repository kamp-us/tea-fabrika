
Plancheck-Version: 3

# `oxc/no-accumulating-spread` is on as an error in `next/` and our tooling, and its 11 hits are rewritten

```jsonc
// .oxlintrc.json: one new entry, the first in `overrides`. Today's app is not in `files`.
{
  // 0559: no reduce callback or loop spreads its running result back into itself. An error, with
  // no warn line and no inline ignore: a hit is rewritten, or it goes to the owner.
  "files": ["next/**", ".agents/**", "oxlint-plugins/**", ".github/ci/**"],
  "rules": { "oxc/no-accumulating-spread": "error" }
}
```

```ts
// A list that grows: it grows where it is (3 hits).
let out: ReadonlyArray<Command> = [];      // today
out = [...out, ...commands];
const out: Array<Command> = [];            // after
out.push(...commands);

// A record whose keys never change: the loop keeps only the part that changes (8 hits).
let current = baseFixture();               // today
current = { ...current, k: current.k + g(fc.integer, { min: 1, max: 9 }) };
let k = baseFixture().k;                   // after
k += g(fc.integer, { min: 1, max: 9 });
const current = { ...baseFixture(), k };
```

All of this is about `next/` and our tooling. Today's app (`packages/`, `programs/`, `apps/`) is not
touched, and keeps its 5 hits in 4 files.

## The answer first

- One pull request. It turns the rule on as an error for `next/` and our three tooling folders (the
  four globs above), adds its plant, and rewrites every hit. It ends at zero hits, with no list of
  leftovers, no warn line and no `oxlint-disable` line
  ([0559](../../../.decisions/0559-no-accumulating-spread-is-on.md),
  [0524](../../../.decisions/0524-no-list-lets-broken-code-pass.md)).
- **The count is 11, not 8.** The ticket's title says 8. Those are the 8 copies of a record with
  fixed keys that an earlier read called fine. The other 3 are lists or records that really grow.
  0559 counts all 11 as hits, and zero needs all 11 gone, so this plan rewrites all 11.
- **All 11 are in 5 test files.** No product file and no tooling file has a hit. So no product code
  changes: the tests step writes almost all of this pull request.
- **No rewrite reads plainly worse than today's line,** by this plan's read, so there is no open
  question. Each hit is below with today's code and the rewrite, so the lead and the owner can
  check that read.
- **The doubt, at 85%:** how the 8 fixed-key copies are rewritten. This plan makes the loop keep
  only the part that changes (a number, or five maps) and build the record fresh. The other way,
  one call such as Effect's `Struct.evolve(current, {...})`, is a smaller diff, and this plan
  refuses it: it copies the running value through a call the rule does not read, which is what
  0559's binding constraint forbids by example (`Object.assign({}, acc, x)`). What would settle it:
  the owner reading the two versions under [The 8 fixed-key hits](#the-8-fixed-key-hits).

## How others do it

- **The Effect team has this rule on, as an error, and their source is at zero.** Read this
  session, at the tag of the installed version (`effect@4.1.2`, from the lockfile), in the repo
  the installed package names as its repository (`Effect-TS/effect`):
  `packages/tools/oxc/oxlintrc.json` sets `"categories": { "correctness": "error", "suspicious":
  "error", "perf": "error" }`, and `oxc/no-accumulating-spread` is in oxlint's `perf` set (checked:
  a config with only `"perf": "error"` fires it in oxlint 1.90.0). They turn its neighbor
  `oxc/no-map-spread` off by name and leave this one on. Run alone over the 585 files of the
  installed `effect/src`, the rule finds 0 hits. So by
  [0560](../../../.decisions/0560-an-order-for-effect-code.md)'s first step, the rule and a tree at
  zero are what the Effect team does.
- **How the Effect team writes the loop.** A list that grows is a `const` array and a `push`:
  `node_modules/effect/src/Array.ts:2647` (`out.push(a)` inside a `for`). This plan's three growing
  hits take that shape.
- **Effect's `Struct.evolve`** (`node_modules/effect/src/Struct.ts:543`, "update specific fields
  while keeping the rest intact") is the shipped tool for the next value of a record. It was the
  first candidate for the 8 fixed-key hits, tried in a scratch copy, and it passes the rule. It is
  not used: see the doubt above.
- **Elm and Erlang/OTP.** Both build a list by adding to its front and reversing once at the end,
  because appending to a list inside a loop copies it each pass (Erlang's Efficiency Guide on `++`
  in a loop; not fetched this session). Elm's record update, `{ model | k = 1 }`, is the fixed-key
  copy. Elm has no loops, so it never sits in one: the update function gets the model as an
  argument. The rule reads loops and `reduce` callbacks only, and tea's `update` functions are
  neither.
- **oxlint's own notes on the rule** were not fetched. What the rule does comes from running it:
  it reports a spread of a `let` that is assigned back to the same `let` inside a loop, and a
  spread of the accumulator in a `reduce` callback. Its help text says "Consider using
  `Array.prototype.push()`" or "`Object.assign()` to mutate the accumulator instead". It reports
  once per `let`, at the first spread, so a file is only at zero when every such spread is gone.

## What is decided, in one place

- [0559](../../../.decisions/0559-no-accumulating-spread-is-on.md), on main since 2026-11-15: the
  rule is on as an error in `next/` and our tooling; all 11 hits are rewritten; no inline ignore,
  no list, no warn level; a fix does not move the same copy where the rule does not look; a rewrite
  that reads plainly worse goes to the owner with both versions; the plant lands with the config
  line. It leaves to this plan where the line goes in `.oxlintrc.json`.
- [0560](../../../.decisions/0560-an-order-for-effect-code.md): the Effect team's way first.
- [0524](../../../.decisions/0524-no-list-lets-broken-code-pass.md) and
  [0168](../../../.decisions/0168-old-lint-breaks-are-fixed.md): old breaks are fixed, never
  listed.
- [0093](../../../.decisions/0093-laws-walk-plants-run-once.md): a planted line is the rule's test
  input and stays.

Choices this plan makes, each with how sure it is:

- **The line is one override, not a root rule (90%).** The root `rules` also cover today's app,
  which has 5 hits and is out of 0559's scope. An override for the four folders is the smallest
  thing that says the scope.
- **It is the first entry in `overrides` (90%).** Order only matters between entries that set the
  same rule, and no other entry sets this one. Open pull requests 1331, 1301, 1099 and 1032 all
  change `.oxlintrc.json` between lines 735 and 1271. The start of `overrides` (line 422) is far
  from every one of them.
- **`kalfa/` is not in `files` yet (80%).** 0559 names three tooling folders. `kalfa/`
  ([0556](../../../.decisions/0556-kalfa-holds-our-tooling-packages.md)) does not exist on main, so a glob for
  it could not be planted, and a line with no plant has shown nothing. The pull request that makes
  the folder adds `kalfa/**` here and a row to law L2. The ticket body says so.
- **All 11 land with the config line, in one pull request (90%).** 0559 allows "before or with".
  One pull request means the rule never sits half on.
- **Is this a setting ([0069](../../../.decisions/0069-choices-are-settings.md))?** No. It is a lint
  rule on our own source, not a choice a person makes for their fabrika, so nothing goes in
  `fabrika.toml`.

## The shape

### The plant

One entry in the `oxc` list of `oxlint-plugins/builtin-plants.ts`. `plants.test.ts` already runs
every entry of that list through the repository's own `.oxlintrc.json`, so no test code is needed
for it. 0559's sketch has the two `reduce` lines. This plan adds four loop lines, because every hit
on the tree is a loop. All six were run through oxlint 1.90.0 for this plan, under an override
shaped like the one above, and answer as marked.

```ts
{
  code: "oxc(no-accumulating-spread)",
  prelude: [XS],
  lines: [
    ["export const a = xs.reduce((acc: number[], x) => [...acc, x], []);", true],
    ["export const b = xs.reduce((acc: number[], x) => { acc.push(x); return acc; }, []);", false],
    ["export const c = () => { let out: number[] = []; for (const x of xs) { out = [...out, x]; } return out; };", true],
    ["export const d = () => { const out: number[] = []; for (const x of xs) { out.push(x); } return out; };", false],
    ["export const e = () => { let m = { k: 1, v: 2 }; for (const x of xs) { m = { ...m, k: m.k + x }; } return m; };", true],
    ["export const f = () => { let k = 1; for (const x of xs) { k += x; } return { k, v: 2 }; };", false],
  ],
},
```

`plants.test.ts` writes its files into a temp folder beside itself, whose name starts with a dot.
The glob `oxlint-plugins/**` matches such a folder (checked in a scratch project).

### The 3 hits that grow

Each line number is on main at `a31798b20`. oxlint reports at the `let`; the second number is the
spread.

**1. `next/programs/pipeline/src/Merger.laws.test.ts:201`, spreads at `:254` and `:288`.** The
commands a walk has emitted so far. Up to 200 events, so today each pass copies the whole list.

```ts
// today
let out: ReadonlyArray<Command> = [];
// ... in the first loop (:254) and again in the tail loop (:288)
out = [...out, ...commands];

// after
const out: Array<Command> = [];
// ... both places
out.push(...commands);
```

`out.find` (`:221`) and `out.findLast` (`:273`) read it and do not change.

**2. `next/packages/libfabrika/src/settings/TomlEdit.test.ts:355`, spread at `:374`.** The comment
markers, which gain one at each end per nesting level.

```ts
// today
let markers = members.map((_, i) => `# member-${i}-雪`);
// ... in the loop over `depth`
markers = [before, ...markers, after];

// after
const markers = members.map((_, i) => `# member-${i}-雪`);
// ... in the loop over `depth`
markers.unshift(before);
markers.push(after);
```

The line that reads it after the loop (`:384`, `["# first-雪", ...markers, "# attached-雪"]`) does
not change.

**3. `next/packages/libfabrika/src/runtime/Built.test.ts:176`, spread at `:187`.** A table of
programs that gains one key on every even step.

```ts
// today
let programs: Record<string, Program> = Object.fromEntries(
  rows.map(({ name, source }) => [name, { hash: sha(source), source }]),
);
// ... in the loop
programs = { ...programs, [key]: { hash: sha(key), source: key } };

// after
const programs: Record<string, Program> = Object.fromEntries(
  rows.map(({ name, source }) => [name, { hash: sha(source), source }]),
);
// ... in the loop
programs[key] = { hash: sha(key), source: key };
```

The odd step (`:195`, `const { [key]: entry, ...rest } = programs`) builds a broken copy from the
table and never assigns it back. It does not change, and the rule does not report it.

### The 8 fixed-key hits

By the rule's own reason these 8 do not grow. 0559 counts them as hits anyway and asks that "the
value is not spread back into itself". The rewrite in each case: the loop keeps only what changes,
and the record is built fresh from its parts where it is used. No copy of the running record is
left, in the loop or in a helper.

**4 to 10. `next/packages/libfabrika/src/cloudflare/reload.laws.test.ts`, seven `let current`.**
`current` is a `Fixture`, six fixed keys. In five walks only `k` ever changes. In two, `k` changes
and both person-only flags turn over together. So the state is a number, or a number and a
boolean. One small helper is added beside `baseFixture` (`:446`) for the two policy walks:

```ts
/** The base fixture at `k` with both person-only policies set alike, as the policy walks install it. */
const policyFixture = (k: number, personOnly: boolean): Fixture => ({
  ...baseFixture(),
  k,
  inputPersonOnly: personOnly,
  eventPersonOnly: personOnly,
});
```

Hit 4, `:624`, spreads at `:629` and `:639` (boot pushes finish before a later install):

```ts
// today
let current = baseFixture();
// ... in the loop
current = { ...current, k: current.k + g(fc.integer, { min: 1, max: 9 }) };
i.refusing.add("counter:1");
const { digest: was } = yield* install(i, `before_boot_order_${n}`, current);
// ...
current = { ...current, k: current.k + g(fc.integer, { min: 1, max: 9 }) };
const digest = yield* hash(sourceFor(current));

// after
let k = baseFixture().k;
// ... in the loop
k += g(fc.integer, { min: 1, max: 9 });
i.refusing.add("counter:1");
const { digest: was } = yield* install(i, `before_boot_order_${n}`, { ...baseFixture(), k });
// ...
k += g(fc.integer, { min: 1, max: 9 });
const current = { ...baseFixture(), k };
const digest = yield* hash(sourceFor(current));
```

Hit 5, `:697`, spread at `:701` (saves that land while starts are pending):

```ts
// today
let current = baseFixture();
let selected = i.builtHash;

for (let n = g(fc.integer, { min: 1, max: 3 }); n > 0; n--) {
  current = { ...current, k: current.k + g(fc.integer, { min: 1, max: 9 }) };
  yield* Effect.exit(install(i, `pending_save_${n}`, current));
  selected = yield* hash(sourceFor(current));
}

// after
let k = baseFixture().k;
let selected = i.builtHash;

for (let n = g(fc.integer, { min: 1, max: 3 }); n > 0; n--) {
  k += g(fc.integer, { min: 1, max: 9 });
  const current = { ...baseFixture(), k };
  yield* Effect.exit(install(i, `pending_save_${n}`, current));
  selected = yield* hash(sourceFor(current));
}
```

Hit 6, `:808`, spread at `:824` (first starts choose the current selection), and hit 7, `:879`,
spread at `:886` (a swapped fact publishes the running build and policy). Both have this block:

```ts
// today, at :823 and :885
let current = baseFixture();
// ... in the loop
current = {
  ...current,
  k: current.k + g(fc.integer, { min: 1, max: 9 }),
  inputPersonOnly: !current.inputPersonOnly,
  eventPersonOnly: !current.eventPersonOnly,
};
selected = (yield* install(i, `start_install_${n}`, current)).digest; // hit 6
const digest = yield* hash(sourceFor(current)); // hit 7

// after
let k = baseFixture().k;
let personOnly = false;
// ... in the loop
k += g(fc.integer, { min: 1, max: 9 });
personOnly = !personOnly;
selected = (yield* install(i, `start_install_${n}`, policyFixture(k, personOnly))).digest; // hit 6
const current = policyFixture(k, personOnly); // hit 7, read again at :912
const digest = yield* hash(sourceFor(current));
```

Both flags start `false` in `baseFixture` and turn over on the same line, so they are always equal:
one boolean holds them.

Hit 8, `:1038`, spread at `:1043` (an install waiting for a process turn):

```ts
// today
let current = baseFixture();
// ... in the loop
current = { ...current, k: current.k + g(fc.integer, { min: 1, max: 9 }) };
const digest = yield* hash(sourceFor(current));

// after
let k = baseFixture().k;
// ... in the loop
k += g(fc.integer, { min: 1, max: 9 });
const current = { ...baseFixture(), k };
const digest = yield* hash(sourceFor(current));
```

Hit 9, `:1094`, spread at `:1101` (reopening with changed built-ins). `:1107` also reads `current`:

```ts
// today
let current = baseFixture();
// ... in the loop
if (g(fc.boolean)) {
  i.refusing.add("counter:1");
  current = { ...current, k: current.k + g(fc.integer, { min: 1, max: 9 }) };
  const next = yield* install(i, `before_reopen_${n}`, current);
  // ...
}

const replacement = { ...current, k: current.k + g(fc.integer, { min: 10, max: 99 }) };

// after
let k = baseFixture().k;
// ... in the loop
if (g(fc.boolean)) {
  i.refusing.add("counter:1");
  k += g(fc.integer, { min: 1, max: 9 });
  const next = yield* install(i, `before_reopen_${n}`, { ...baseFixture(), k });
  // ...
}

const replacement = { ...baseFixture(), k: k + g(fc.integer, { min: 10, max: 99 }) };
```

Hit 10, `:1156`, spread at `:1160` (a home whose process lost its code row). `:1174`, after the
loop, also reads `current`:

```ts
// today
let current = baseFixture();
// ... in the loop
current = { ...current, k: current.k + g(fc.integer, { min: 1, max: 9 }) };
const next = yield* install(i, `refused_${n}`, current);
// ... after the loop
const replacement = { ...current, k: current.k + g(fc.integer, { min: 10, max: 99 }) };

// after
let k = baseFixture().k;
// ... in the loop
k += g(fc.integer, { min: 1, max: 9 });
const next = yield* install(i, `refused_${n}`, { ...baseFixture(), k });
// ... after the loop
const replacement = { ...baseFixture(), k: k + g(fc.integer, { min: 10, max: 99 }) };
```

What stays the same in all seven: the order and number of generated draws, and every source text.
`sourceFor` writes `JSON.stringify(f)`, and `{ ...baseFixture(), k }` keeps `baseFixture`'s key
order, as `{ ...current, k }` did. So each walk installs the same bytes, with the same hashes, as
today. The walk at `:481` (`const next = { ...current, ... }` then `current = next`) is not a hit
and does not change.

**11. `next/packages/libfabrika/src/processes/internal/processTable.laws.test.ts:137`, first spread
at `:180`, and six more at `:194`, `:226`, `:235`, `:243`, `:268` and `:278`.** `s` is the law's own
fold of the process table: five maps under fixed keys. Each step keeps the fold it reached
(`after: s`), so the law can compare it with the machine's model. The rewrite keeps the five maps
as five `let`s and builds the kept value where a step keeps it.

```ts
// today
let s = empty;
// ... in the loop
const lives = [...s.lives.keys()];
const watches = [...s.watches.values()];
const unused = PIDS.filter((pid) => !s.lives.has(pid));
const life = s.lives.get(target);
// ...
s = { ...s, names: put(s.names, name, event) };
steps.push({ effect: "applied", entry, after: s });
// ...
s = { ...s, lives: put(s.lives, process, started), current: put(s.current, name, process) };
// ...
s = {
  ...s,
  lives: put(s.lives, target, { ...life, request }),
  restarts: put(s.restarts, event.name, [...(s.restarts.get(event.name) ?? []), entry.arrivedAt]),
};
// ...
s =
  event._tag === "exited"
    ? { ...s, lives: put(s.lives, target, { ...life, exited: event.reason, state: /* ended */ }) }
    : { ...s, lives: put(s.lives, target, { ...life, state: /* down */ }) };
// ...
const round = (s.watches.get(key)?.round ?? 0) + 1;
s = { ...s, watches: put(s.watches, key, { tag: "live", ref, process: watched, to, round }) };
// ...
s = { ...s, watches: put(s.watches, keyFor(to, ref), { ...old, tag: "canceled" }) };

// after
let { names, lives, watches, current, restarts } = empty;
/** The fold reached so far, as the one value a step keeps. */
const reached = (): Folded => ({ names, lives, watches, current, restarts });
// ... in the loop
const known = [...lives.keys()];
const watching = [...watches.values()];
const unused = PIDS.filter((pid) => !lives.has(pid));
const life = lives.get(target);
// ...
names = put(names, name, event);
steps.push({ effect: "applied", entry, after: reached() });
// ...
lives = put(lives, process, started);
current = put(current, name, process);
// ...
lives = put(lives, target, { ...life, request });
restarts = put(restarts, event.name, [...(restarts.get(event.name) ?? []), entry.arrivedAt]);
// ...
lives = put(
  lives,
  target,
  event._tag === "exited"
    ? { ...life, exited: event.reason, state: /* ended, as today */ }
    : { ...life, state: /* down, as today */ },
);
// ...
const round = (watches.get(key)?.round ?? 0) + 1;
watches = put(watches, key, { tag: "live", ref, process: watched, to, round });
// ...
watches = put(watches, keyFor(to, ref), { ...old, tag: "canceled" });
```

The loop's two lists are renamed (`lives` to `known`, `watches` to `watching`) so they do not hide
the maps. All seven `after: s` become `after: reached()`. `empty` stays: `:733` reads it. The
`{ ...life, ... }` and `{ ...old, ... }` spreads are of a `const` read from a map, never assigned
back, and stay.

### Checked for this plan

The 5 files were copied outside the repo, rewritten as above, and the rule was run alone over the
copies with oxlint 1.90.0: 0 hits, where the same run over the unchanged copies gives 11. The
rewrites were not type-checked and no test was run: the plan step runs neither.

## One value traced

Hit 5, with the generator giving 2 passes and the draws 3 then 7.

1. `k = baseFixture().k`, so `k` is 1. `selected` is the built-in hash.
2. Pass 1: `k += 3`, so `k` is 4. `current` is `{ name: PROGRAM, v: 1, k: 4, throws: false,
   inputPersonOnly: false, eventPersonOnly: false }`. Today's line gives the same six keys in the
   same order, so `sourceFor(current)` is the same text and `hash` gives the same digest. The
   install runs, and `selected` is that digest.
3. Pass 2: `k += 7`, so `k` is 11. `current` is the base with `k: 11`. Same text and digest as
   today.
4. After the loop the law reads `selected` only. Nothing reads a fixture.

What the rule sees: `k += ...` has no spread. `{ ...baseFixture(), k }` spreads a call, not a `let`
of the loop. No report.

## Laws

| Law | Kind (lint, type or test?) | Generator | Plant | Where |
|---|---|---|---|---|
| L1, the rule refuses a self-spread in a `reduce` callback, in a loop over a list and in a loop over a record, and takes the three forms that replace them | test, of a lint rule | scenario: the real oxlint, run by `plants.test.ts` through the repository's own config over the planted file | delete the new override from the config: the three refused lines stop firing and L1 is red. Before the config line exists L1 is red the same way | `oxlint-plugins/builtin-plants.ts` |
| L2, the rule fires on a planted self-spread in a folder under each of the override's four globs, and does not fire on the same line under `packages`, `programs` and `apps` | test, of a lint config | scenario: the real oxlint over one planted file per folder, as the "rules that apply by path" block already does | (a) move the rule to the root `rules`: the three rows for today's app turn red. (b) drop one folder from `files`: that folder's row turns red | `oxlint-plugins/plants.test.ts` |
| L3, the tree is at zero: `pnpm lint` passes with the rule an error, and no `oxlint-disable` line names it | lint | lint | put back any one of the 11 self-spreads, for example `out = [...out, ...commands]`: `pnpm lint` exits 1 and names the file | the five test files below |
| L4a, the merger's laws hold on the rewritten walk generator, 200 runs each, as today | test | @demlik/tea/pbt.arbGuidedSequence: the file's own `guided`, unchanged but for `out` | push to a fresh list in the tail loop in place of `out`: `out.findLast` finds no command for the current attempt and the walks stop short, so the laws that need a finished job are red | `next/programs/pipeline/src/Merger.laws.test.ts` |
| L4b, the nested inline comment law holds, 100 runs, as today | test | Effect Arbitrary: Schema.Struct | `markers.push(before, after)` in place of `unshift` then `push`: the comments are checked in order, so the law is red | `next/packages/libfabrika/src/settings/TomlEdit.test.ts` |
| L4c, a table with one bad key fails whole and a good table keeps every key, 100 runs, as today | test | fc.array: the file's own `rows` and `tape`, unchanged | assign the added program under an unqualified key (`programs[key.split("/")[1]!] = ...`): `decodeBuilt` fails on the even step and the law is red | `next/packages/libfabrika/src/runtime/Built.test.ts` |
| L4d, the process table's fold laws hold on the rewritten `walk`, 100 runs each, and the pinned case of ticket 979 still passes | test | fc.record: the file's own `Walk`, unchanged | drop `current = put(current, name, process)`: the machine's `current` differs from the step's `after`, and the fold laws are red | `next/packages/libfabrika/src/processes/internal/processTable.laws.test.ts` |
| L4e, the seven reload laws hold with the same installed sources as today, at their own counts (100 runs, and 50 runs for the last) | test | fc.gen: the file's own `law(g)`, unchanged | drop one `k += g(...)`: the install sends the selected source again and answers `same`, so `expect(...).toBe("loaded")` is red in hits 4, 9 and 10 | `next/packages/libfabrika/src/cloudflare/reload.laws.test.ts` |

- L1 to L3 are the new laws. L4a to L4e are laws that exist: the rewrite is in their generators, so
  the proof it kept them is that they pass at their fixed seed (119120) with the same number of
  laws as before, and that each plant above turns its file red.
- **The plants for L4a to L4e are this plan's expectation from reading, not from a run.** The test
  writer runs each one, sees it red, and takes it out again. A plant that stays green is one
  finding row (`missing_test`), never a reason to change the rewrite.
- **Hits 6 and 7 have no plant of their own.** A fixture's policy is read back from its own
  installed source, so a wrong flag still agrees with itself. What holds them is that the installed
  bytes are the same as today's, which the section above shows by construction, and which the test
  writer checks once: print the `gateway/code` hashes of one run of each of those two laws at seed
  119120 before and after, and see the same list. The two lists go in the run row.
- Lint, type or test? L3 is the shape check, and it is lint. L1 and L2 test that the lint config
  does what it says, as every other rule's plant does. No law here is a type law.
- No host-only law: nothing here needs the real machine. No file named `.integration.` or `.visual.`
  is changed or run. No secrets are involved.

## Busy folders

Three hits sit in folders the brief calls busy: `runtime` (hit 3), `processes` (hit 11) and
`cloudflare` (hits 4 to 10). Checked on 2026-11-15 against the changed-file lists of pull request
1341 (`fabrikalfa/program-watch`), pull request 1331 (`fabrikalfa/p39-s5`) and branch
`fabrikalfa/p34c-s4`:

- **None of the three touches any of the five test files.** No clash in the rewrites.
- **Pull request 1331 changes `.oxlintrc.json`,** one line near line 1180. This plan's override is
  at line 422. Git merges the two without a clash.
- **Other open pull requests on the shared files:** 1301 changes `.oxlintrc.json` (lines 735 to
  1024), `next/AGENTS.md` (near line 51), `oxlint-plugins/README.md` (lines 907 and 1021) and
  `plants.test.ts` (line 414); 1099 and 1032 change `.oxlintrc.json` (lines 987 to 1271). This plan
  writes at `.oxlintrc.json:422`, `next/AGENTS.md:43`, `oxlint-plugins/README.md:205` and
  `plants.test.ts` after line 660. No two of those are within three lines of each other, so none
  should clash.
- **Would the rule fire on those branches' new code?** No. The rule was run alone over every file
  each of the three branches adds or changes in scope (23, 22 and 51 files): 0 hits.

## Files

| File | Owner | Product lines expected | Change |
|---|---|---|---|
| `.oxlintrc.json` | tests | none | the one override, first in `overrides` |
| `oxlint-plugins/builtin-plants.ts` | tests | tests | the plant entry, in the `oxc` list (L1) |
| `oxlint-plugins/plants.test.ts` | tests | tests | L2: seven rows in the "rules that apply by path" block, about 20 lines |
| `oxlint-plugins/README.md` | tests | docs | in the `builtin-plants.ts` paragraph: the rule went on 2026-11-15 with 11 hits rewritten (0559), scoped by an override, and the Effect team has it on |
| `next/programs/pipeline/src/Merger.laws.test.ts` | tests | tests | hit 1, 3 lines |
| `next/packages/libfabrika/src/settings/TomlEdit.test.ts` | tests | tests | hit 2, 3 lines |
| `next/packages/libfabrika/src/runtime/Built.test.ts` | tests | tests | hit 3, 2 lines |
| `next/packages/libfabrika/src/cloudflare/reload.laws.test.ts` | tests | tests | hits 4 to 10 and `policyFixture`, about 45 lines |
| `next/packages/libfabrika/src/processes/internal/processTable.laws.test.ts` | tests | tests | hit 11, about 45 lines |
| `.github/ci/**`, `.github/ci/`, `.github/ci` | tests | none | not changed: named by the override's `files`, and L2 plants a temp file there that it removes |
| `oxlint-plugins/**`, `oxlint-plugins/` | tests | none | not changed beyond the three files above: named by the override's `files` |
| `next/AGENTS.md` | build | docs | one row in "What lint holds", after the `fabrika/no-hand-tag` row: "No loop or `reduce` callback spreads its running result back into itself (0559)", check `oxc/no-accumulating-spread` |

Every changed file but `next/AGENTS.md` is an exam path, so the tests step owns it. The build step
has one row of docs and the checks. That is thin on purpose: there is no product code to write.

## Validation

- The tests step, in its worktree, with `nice -n 19` and `--maxWorkers=1`, one path at a time:
  `oxlint-plugins/plants.test.ts`, then each of the five test files. `reload.laws.test.ts` is the
  slow one: its laws run on SQLite with live timers.
- `pnpm format`, then `pnpm lint`. Lint is L3.
- The lead, not a step, runs the changed tests once at the end and the one type check.
- The lead reads the diff for any `oxlint-disable` line that names the rule. There must be none.

## Size

One pull request that lands whole.

1. The rule on, its plant and by-path rows, and the 11 rewrites: about 130 lines changed in 5 test
   files, about 35 lines in the two plant files, 5 lines of config and about 6 lines of docs. 0 lines
   of product code.

Priced from this week's rows in `field/runs/` (list dollars): a tests step has a median of $5.58
over 4 rows, a build $1.01 over 5, a review $4.28 over 5, a fix round $4.18 over 2. This tests step
is mostly edits already written out here, plus two slow test files to run, so about $6. Build about
$1, review about $4, and one fix round about $4 if a rewrite does not type-check as written.
Confidence 75%: the doubt is that the rewrites were checked against the rule but not against the
compiler.

Estimate: 4 steps, $15

## Records

- **What is lost if not written now:** the count before and after (11 to 0, by file), the plant
  runs of L4a to L4e, and the two hash lists for hits 6 and 7. All go in the tests run row and the
  pull request body. Main moves, and the before count cannot be read again once this lands.
- **The pull request body reports each of the 8 fixed-key rewrites,** with today's line and the new
  one, as 0559 asks, so the owner can call any of them worse.
- `oxlint-plugins/README.md` and `next/AGENTS.md`, as in the files table.
- `field/runs/` rows for each step, written by the lead.
- No glossary row: no word is coined. No pattern doc: no product shape changes.

## What this cannot tell us

- **Whether the rewrites type-check.** They were run through the rule only. The likeliest miss is
  `let { names, lives, watches, current, restarts } = empty` in hit 11, which should take each
  map's type from `Folded`.
- **Whether the rule's false alarms stay low on new code.** All 11 hits are old, and 8 of them did
  not grow. 0559 says the next pull requests will show it.
- **The rule reads spreads only.** A copy made by a call passes it: `new Map(map).set(key, value)`
  in the process table law's `put` copies a growing map on every step, and the product's fold
  (`processes/internal/processTable.ts:132`) does the same. Both are how an immutable model is
  kept today, and both are outside this rule and this plan.
- **Today's app.** Its 5 hits in 4 files stay, by 0559.
- **`kalfa/`.** Not covered until the folder exists.

## Open questions

None.

## Findings

None. The copy in `put` named above fits none of the finding rules, so it is said here and in the
report, and no row is written.
