---
id: 0562
title: Nothing in next/ or our tooling may show an agent a banned shape, so a rule about code shape covers test files and tooling too, and the first is that no _tag is written by hand anywhere
status: accepted
date: 2026-11-15
tags: [lint, oxlint, tests, laws, tooling, tag, schema, agents, copy, next]
---

# 0562: Nothing in next/ or our tooling may show an agent a banned shape, so a rule about code shape covers test files and tooling too, and the first is that no _tag is written by hand anywhere

**Before:**

```jsonc
// .oxlintrc.json on main: the rule is on for product code and off for tests.
{ "files": ["next/**"], "rules": { "fabrika/no-hand-tag": "error" } }
{ "files": [".agents/**/*.ts", ".agents/**/*.mjs"], "rules": { "fabrika/no-hand-tag": "error" } }
{ "files": ["next/**/*.test.ts", "next/**/*.test.tsx"], "rules": { "fabrika/no-hand-tag": "off" } }
{ "files": ["next/.../RecordPartTest.ts", "next/.../RunnerTest.ts"], "rules": { "fabrika/no-hand-tag": "off" } }
{ "files": [".agents/**/*.test.ts"], "rules": { "fabrika/no-hand-tag": "off" } }
// .github/ci and oxlint-plugins: no block names the rule.
```

**After (a sketch, not run):**

```jsonc
// The two trusted rules at "error" for all four folders, tests included (0573 names them).
{ "files": ["next/**", ".agents/**", ".github/ci/**", "oxlint-plugins/**"],
  "rules": {
    "anti-slop-effect/no-manual-tagged-construction": "error",
    "anti-slop-effect/no-manual-tagged-type": "error"
  } }
// no "off" line is left
```

```ts
// before: next/packages/libfabrika/src/telemetry/RecordPartTest.ts:73, a tagged value by hand
const part: Part = recordPart(sql, { _tag: "spans" }, 0, 1_000_000_000);

// after (a sketch, not compiled): the schema's maker writes the key
const part: Part = recordPart(sql, Chain.cases.spans.make({}), 0, 1_000_000_000);
```

The three "off" lines go, and the two tooling folders come under the rule. In "before", each
line stands for one block of `.oxlintrc.json`, cut down to this rule, and two paths are cut short
with `...`.

**What this decides:** whether a rule about the shape of code may leave test files and tooling out,
and what happens to the hand-written `_tag` first.

## Context

- An agent writes new code by copying what it reads. A shape that is banned in product code and
  left in the tests beside it is still in the tree, and it is copied into new code from there.
- [0214](0214-unions-are-tagged-with-tag.md) says every union we define gets its `_tag` from
  Effect Schema, never by hand. The lint rule `fabrika/no-hand-tag`
  (`oxlint-plugins/no-hand-tag.ts`) holds it until the swap below: it fires on an object key, a
  class field or a type member named `_tag`, and a read passes.
- Where the rule is set today, in `.oxlintrc.json` on `origin/main` at `98bcdfa22`:
  - on, at line 648 for `next/**` and at line 965 for `.agents/**/*.ts` and `.agents/**/*.mjs`;
  - off, at line 1141 for `next/`'s `*.test.ts` and `*.test.tsx` files, at line 1160 for the two
    shared law suites, and at line 1171 for `.agents/`'s test files;
  - not named at all for `.github/ci/` and `oxlint-plugins/`.
- **Counted with the rule itself,** on `origin/main` at `98bcdfa22`. A throwaway copy of
  `.oxlintrc.json` got one last block that sets the rule to `error` for `next/**`, `.agents/**`,
  `.github/ci/**` and `oxlint-plugins/**`. Oxlint 1.90.0 ran once with it over those four folders,
  and the copy was deleted. Nothing in the repo changed. "Test files" here are `*.test.ts(x)` and
  `*Test.ts`.

  | Folder | Test files | Other files |
  |---|---|---|
  | `next/` | 1,861 fires in 179 files | 0 |
  | `.agents/` | 134 in 20 files | 1 in 1 file |
  | `.github/ci/` | 25 in 3 files | 16 in 3 files |
  | `oxlint-plugins/` | 8 in 2 files | 25 in 3 files |

- That is 2,070 fires. Of `next/`'s 1,861, 1,845 are in `*.test.ts(x)` files and 16 in the two
  shared law suites. The 41 in the other files of the two tooling folders are in
  `.github/ci/scheduled.mjs` (9), `time-table.ts` (5) and `field-schema.ts` (2), and in
  `oxlint-plugins/effect-jsdocs.ts` (12), `parallel.ts` (9) and `advice.ts` (4). The one in
  `.agents/` is `skills/lead/scripts/chain.ts:1345`, where the rule is already on and
  `agents-ledger.json` names the line, a list 0524 already empties.
- An earlier read on the same day counted about 1,870 in `next/`'s tests and 41 in those two
  tooling folders, by syntax and not with the rule. Both numbers hold.
- **The clash.** [0135](0135-a-laws-file-pins-its-shapes-to-the-schema.md) lets a laws file restate a
  program's shapes by hand, so that the exam does not change when the build changes the shape. A
  restated type with a `_tag` member is a hand-written `_tag`. Tests also feed raw frames on
  purpose, which is the reason `.oxlintrc.json` gives for leaving them out. This decision amends
  0135 in part.
- **What the Effect team's own tests do.** The order for Effect code
  ([pull request 1359](https://github.com/kamp-us/tea-fabrika/pull/1359), not on main yet) puts
  what the Effect team does first. The installed Effect is the one `pnpm-workspace.yaml`'s catalog
  entry for `effect` names, and its `package.json` names <https://github.com/Effect-TS/effect> as
  its repository. Four of its test files were read on 2026-11-15 at the tag `effect@4.1.2`, under
  `packages/effect/test/`:
  - **A tagged value is made by its maker or its class.**
    `cluster/MessageStorage.test.ts:377-392` builds a request with `Envelope.makeRequest(...)`
    inside `new Message.OutgoingRequest(...)`, and `:419-421` builds a reply with
    `new Reply.ReplyWithContext(...)` and `new Reply.WithExit(...)`.
    `eventlog/EventLogMessage.test.ts:44` and `:50` use `new ChunkedMessage(...)`. None of these
    writes `_tag`.
  - **A raw wire frame is a plain object literal, typed as the encoded side.** It is the input, or
    the bytes expected back, never a tagged value of the program. `rpc/RpcSerialization.test.ts`
    writes `{ _tag: "Exit", requestId, exit: { _tag: "Success", value } }` at `:9-16` and types one
    as `RpcMessage.ResponseExitEncoded` at `:186-190`. `cluster/MessageStorage.test.ts:36-43`
    writes `const envelope: Envelope.PartialRequestEncoded = { _tag: "Request", ... }`.
  - **One place does neither.** `cluster/Envelope.test.ts:7-18` writes a decoded request by hand
    and casts it, `{ _tag: "Request", ... } as Envelope.PartialRequest`. So their tests are not at
    zero either.
- [0524](0524-no-list-lets-broken-code-pass.md) keeps an override for a class of files where a
  rule does not apply, and names tests. What this file settles is that "it is a test" is not, by
  itself, a reason a rule about code shape does not apply.

## Decision

**Nothing in `next/` or our tooling may show an agent a banned or wrong shape. A rule about the
shape of code covers test files and tooling too (owner, 2026-11-15).**

- **The principle.** An agent copies what it reads. A banned shape that stays in the tree, tests
  and tooling included, is copied into new code. So the tree holds no example of it.
- **Its first use: no `_tag` is written by hand anywhere in `next/` and our tooling,** tests and
  tooling included. Today the rule that holds this is off in test files and does not cover
  `.github/ci/` and `oxlint-plugins/`. Both gaps close.
- **One exception, and nothing else:** an inline ignore on the line, with its reason,
  `// oxlint-disable-next-line <rule> -- <why>`. No list, and no named wrapper type that lets a
  hand-written `_tag` through.
- **A tagged value in a test is made with the schema's maker,** as in product code:
  `X.cases.a.make(...)`, or the tagged class.
- **Scope:** `next/`, and our tooling: the lead and step scripts under `.agents/`,
  `oxlint-plugins/` and `.github/ci/`. Today's app (`packages/`, `programs/`, `apps/`) is not
  covered.
- **How it is held.** By two trusted lint rules, at `error`, in every folder of the scope:
  `anti-slop-effect/no-manual-tagged-construction` for a `_tag` written into a value, and
  `anti-slop-effect/no-manual-tagged-type` for a `_tag` declared in a type or interface
  ([0573](0573-trusted-lint-rule-replaces-ours.md); the plugin is used as it ships,
  [0563](0563-anti-slop-plugin-as-it-ships.md)). They are turned on in this cleanup, folder by
  folder when each reaches zero ([0168](0168-old-lint-breaks-are-fixed.md)), and `fabrika/no-hand-tag`
  and its test are deleted in the pull request that turns them on where it ran.

**Binding constraints**

- No list of allowed leftovers, and no warn level ([0524](0524-no-list-lets-broken-code-pass.md)).
  The old fires are fixed, never listed.
- A fix does not weaken the rule, narrow its paths or switch it off (0168).
- A fix does not hide the key from the rule, such as a computed `["_tag"]` key, which the rule
  skips.

## Consequences

- This file records the rule and how it is held. The cleanup and the lint change are later pull
  requests, folder by folder to zero. Until a folder's lint change lands, nothing stops a new
  hand-written `_tag` in its tests.
- **0135 is amended in part.** A laws file may still restate a shape by hand and pin it to the
  schema's type. What ends is the hand-written `_tag` inside such a copy: it fires like any other.
- **The cost.** 2,070 fires in 211 files, 1,861 of them in `next/`'s tests. The exam's own copy of
  a tagged shape was independent of the build under 0135. For the tag, that independence is
  given up.
- **A lint rule sees syntax, so it cannot tell a wire frame from a tagged value.** Both are an
  object with a `_tag` key. A frame that stays takes the inline ignore above, one line each.
- **An expected value in an assertion fires too,** such as
  `expect(answer).toEqual({ _tag: "written" })`. The plan reads these as a group.
- **Places on main that say tests are left out, for the cleanup to fix:** the comment over the
  rule in `oxlint-plugins/no-hand-tag.ts`, the comments over the three "off" blocks in
  `.oxlintrc.json`, and the `no-hand-tag` row and the `.agents/` paragraph in
  `oxlint-plugins/README.md`.
- **Not decided here:**
  - **The counts above are `fabrika/no-hand-tag`'s.** The two trusted rules may count
    differently, and the cleanup's plan reads their own counts.
  - **Which hand-written `_tag` in a test is a wire frame and stays.** The cleanup's plan decides,
    by what the Effect team's own tests do for each of the two cases above. A case where a
    hand-written `_tag` is a test's whole point goes to the owner with the code.
  - How a laws file states a tagged shape once the hand-written `_tag` is gone: the schema's own
    type, or its maker. The plan decides.
  - The other rules that are off in test files today, such as `fabrika/no-promises`,
    `fabrika/effect-functions` and `fabrika/one-machine-per-file`. The principle reaches each one
    that is about code shape. Each needs its own count and its own plan, and none changes with
    this file.
  - Today's app.
