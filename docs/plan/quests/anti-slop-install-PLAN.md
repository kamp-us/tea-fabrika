Approved by the lead agent, builds 0563, 0558, 0561, 0562, 0524, 0567; body 8b4b73b90ad6
Plancheck-Version: 3

# Plan: the anti-slop lint plugin comes in as it ships, pinned, and each rule the owner took goes on as an error folder by folder

This is `next/` and our tooling (`.agents/`, `oxlint-plugins/`, the CI scripts folder). Today's app
is not touched. The quest is one of the fixes of the sev0 the owner called on 2026-11-15: nothing
more is built on wrong code foundations.

This plan does three things. It plans pull request 1, the install, in full. It gives the count of
every taken rule in every folder, from a run of the plugin itself. And it sets the order and the
rules for the sweep pull requests that follow, each of which gets a short plan of its own from the
table here.

```jsonc
// The whole idea, a sketch of .oxlintrc.json after pull request 1.
"jsPlugins": [
  "./oxlint-plugins/index.ts",
  { "name": "anti-slop", "specifier": "./vendor/anti-slop/src/index.ts" },
  { "name": "anti-slop-effect", "specifier": "./vendor/anti-slop/src/effect/index.ts" }
],
"ignorePatterns": ["vendor/**" /* , the ones there today */],
"overrides": [
  // One block per taken rule, last in the file. It names the folders where the rule has zero hits.
  // A sweep pull request brings a folder to zero and adds one line here. Nothing is "off" or "warn".
  {
    "files": ["next/packages/libfabrika/src/packs/**", "next/programs/inbox/**" /* , ... */],
    "rules": { "anti-slop/max-ternary-depth": ["error", { "maxDepth": 2 }] }
  }
  // When every folder is on a rule's list, the list becomes the four globs of the whole scope.
]
```

## Doubts, first

- **The zero-lock check, 80%.** Pull request 1 adds a small check so a folder at zero cannot stay
  off a rule's list (law L4). It costs one more oxlint run in every whole `pnpm lint`, 2.5 seconds
  measured. Without it, a folder that reaches zero is only locked when someone remembers. The doubt
  is whether the lead wants this much tooling in the install. Cutting it loses nothing else in this
  plan.
- **How many sweep pull requests, 60%.** The table has 188 folder-and-rule cells with hits. One
  rule in one folder per pull request is the unit. How many cells a pull request may carry when the
  folders are small is the lead's call per batch, and this plan only gives the rule for it.
- **The false-alarm share of the cast rule, not measured.** Decision 0561's draft asks for a
  hand-read sample of the 987 before the rule blocks anywhere. This plan does not carry that
  sample. The first cast sweep, in the lead scripts folder, reads all of its own hits and reports
  the three shares. See "Where a draft is unclear".

## What was run for this plan

All on `origin/main` at `ca4444777`, in this quest's worktree, with the installed oxlint 1.90.0 and
Node 26.13.0. Nothing from these runs is in the branch: every trial file was removed.

- **The plugin was read at the fork's commit `5360c123dfe89a20edab7b277099dd423247a8dd`,**
  https://github.com/K-Mistele/anti-slop. That is still its `main` today. Its `src/` holds 70 files
  and about 6,100 lines without tests: 20 rules in `src/index.ts`, 7 in `src/effect/index.ts`, and
  a copy of ESLint Stylistic's padding rule under `src/vendor/`, with that project's license beside
  it. No rule file reads a file, the network or the environment. MIT.
- **The git tree of its `src/` is `e69eeeffb41e60d714f070ac4ed9474a5bb02cc9`.** Copied into the
  worktree and staged, git gave the same tree id for our folder. So stock git can say whether our
  copy is theirs, byte for byte.
- **A git dependency does not load.** `pnpm add -D github:K-Mistele/anti-slop#<commit>` was tried.
  pnpm refuses the install until the package's `prepare` script is allowed or refused by name
  (`ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED`). With it refused, the install works, and then oxlint
  cannot load the plugin: Node will not strip types from a `.ts` file under `node_modules`
  (`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`, the same on Node 22.22.3 and 26.13.0). The package
  ships only `.ts`.
- **The copied folder loads through the real config,** once `@oxlint/plugins` can be found from it.
  From a top-level folder it cannot (`ERR_MODULE_NOT_FOUND`), because only `oxlint-plugins/` names
  that package today. With it reachable, a planted 3-deep ternary in a folder on the rule's list
  fired `anti-slop(max-ternary-depth)` through `.oxlintrc.json`, and nothing fired elsewhere.
- **The other checks with the folder present:** `pnpm lint:dead`, `lint:layers`, `lint:boundaries`
  and `lint:reach` pass unchanged. oxlint with today's rules fires 722 times in their files, and
  oxfmt would rewrite 58 of them, so both need the folder in their ignore lists. The leak check
  passes on all of their text. Vitest's globs do not reach the folder, and no tsconfig includes it.
- **The spacing fixer was run over the whole scope and reverted.** One pass: 888 files, 15,200
  lines added, none removed. After it, `oxfmt --check` was clean and today's lint gave the same
  1,295 diagnostics as before it. So their fixer does not fight our padding rule or the formatter.
- **Open pull requests were listed** with `gh pr list` (16 open) to sort folders into cold and
  touched.

## How others do it

- **The plugin's authors: copy `src/` into your repository.** Their README says the project "is
  meant to be vendored", that there is no npm package, and gives `tools/oxlint/anti-slop/` as the
  place and `jsPlugins` with `name` and `specifier` as the wiring. It also says to add the folder
  to the lint ignore list, and to keep `@oxlint/plugins` at exactly oxlint's version. The README
  goes on to say "change them to match your team's standards". We do not: decision 0563 and the
  owner's ruling of 2026-11-15 keep the source unchanged.
- **The plugin does the same with its own upstream.** `src/vendor/eslint-stylistic/` is a copied
  rule with the upstream `LICENSE` and an `UPSTREAM.md` that names the source commit. Our folder
  follows that shape.
- **Go's `vendor/` folder and `go mod verify`.** Go keeps third-party source in a top-level
  `vendor/` folder and checks it against recorded hashes. From memory of the Go modules reference,
  not fetched for this plan.
- **Tools looked at for the "still unchanged" check** (0040): git itself, which already hashes a
  folder as a tree; `git subtree`, which records the upstream commit in a commit message and checks
  nothing later; Carvel's `vendir`, which syncs and locks a folder but is one more binary on every
  machine and in CI. Not fetched: `vendir`'s docs, named from memory. Git is used, since it is
  already everywhere this repo runs and its tree id is the one the fork itself reports.
- **Turning a new rule on in an old tree.** Google's Tricorder paper (CACM 2018) is this repo's
  source for "a check that blocks must be nearly free of false alarms". Decisions 0168, 0523 and
  0524 are our own answer for the old hits: fix them, folder by folder, with no list.

## The install: their `src/`, whole and unchanged

**The owner ruled on 2026-11-15:** their `src/` comes in whole and unchanged at one commit of the
fork, with the commit and license recorded, as the plugin's README says. Decision 0563 gets this as
an amendment in another pull request. "We do not copy" means we do not rewrite or hand-copy single
rules.

**Why not a git dependency.** It cannot run: Node refuses to strip types under `node_modules`, and
the package ships only `.ts`. It would also need `lint:versions` to pass a `github:` version, which
[exact npm versions only](../../direction/pin-exact-versions.md) refuses by name, a `prepare`
script refused by name in `pnpm-workspace.yaml`, an override to lift its `@oxlint/plugins` 1.86.0
to our 1.90.0, and every install and CI run would depend on one person's fork staying online.

```text
vendor/anti-slop/
  src/          the fork's src/ at the pinned commit, byte for byte (70 files)
  LICENSE       the fork's LICENSE at that commit, unchanged
  pin.json      { "repository", "commit", "tree" }: where it came from and what it must hash to
```

```json
{
  "repository": "https://github.com/K-Mistele/anti-slop",
  "commit": "5360c123dfe89a20edab7b277099dd423247a8dd",
  "tree": "e69eeeffb41e60d714f070ac4ed9474a5bb02cc9"
}
```

- **Where it lives: a top-level `vendor/anti-slop/`. 85%.**
  - Not `kalfa/`: decision 0556 makes that the home of `@kalfa` packages, which are ours, in the
    pnpm workspace, held to `next/`'s standards. This folder is someone else's code, is no
    workspace package and is held to none of our rules.
  - Not inside `oxlint-plugins/`: that folder is in the scope of every taken rule and of decision
    0562, its tsconfig would type-check their files, and 0563 says no rule of theirs is copied into
    it.
  - `vendor/` is the industry's word for this folder (Go, PHP, Rails).
  - The cost: the root `package.json` gains one dev dependency, `"@oxlint/plugins": "catalog:"`, so
    their import resolves. It is the catalog's 1.90.0, which is what their README asks for. No
    override and no second copy of that package.
- **How each check treats their files.** Their source is neither linted, formatted nor edited.

  | Check | What it does with `vendor/**` | What pull request 1 changes |
  |---|---|---|
  | oxlint | would fire 722 times | `"vendor/**"` in `ignorePatterns` of `.oxlintrc.json` |
  | oxfmt, in `pnpm format` and `pnpm lint` | would rewrite 58 files | `"vendor/**"` in `ignorePatterns` of `.oxfmtrc.json` |
  | the unused-export check, layers, boundaries, reach | pass as they are (run with the folder present) | nothing |
  | typecheck and vitest | do not reach the folder | nothing |
  | the leak check | passes on all of their text | nothing: it reads their files like any added text |
  | the unchanged check (law L1) | new | see Laws |

- **An ignore line for `vendor/**` is not a list of broken code** (0524). It names a class of files
  our rules do not apply to: code we do not own and may not edit. The same two files already ignore
  `**/fixtures/**` for the same kind of reason.
- **The unchanged check. Lint, type or test? None of the three: it is not a check on the shape of
  code.** It is a step of `pnpm lint`, next to the tracked-files check `lint.ts` already runs with
  git. It fails unless `git rev-parse HEAD:vendor/anti-slop/src` equals `tree` in `pin.json` and
  `git status --porcelain -- vendor/anti-slop` is empty. So an edit fails on the machine that made
  it and again in CI. Anyone can check `tree` against the fork with
  `git rev-parse <commit>:src`, so the number is theirs and not one we made up.
- **An update is a newer commit brought in whole:** replace `src/` and `LICENSE` from the new
  commit, and change `commit` and `tree` in `pin.json`. Nothing else. The diff of that pull request
  is their change, read like a version bump, and the pull request says which taken rules changed
  and what the count table does. No rule is updated alone.
- **Is the pin a setting (0069)?** No. It is a dependency's version, like a catalog line: nobody
  flips it per project, and `pin.json` is its one place. `maxDepth: 2` and the marker word `SAFETY`
  are their defaults, written once in `.oxlintrc.json`, and decisions 0558 and 0561 fix both.
- **Their `LICENSE` holds its author's name.** The MIT license asks that the notice stays with
  every copy. "No personal names" in this repo is about our own people and accounts, so the notice
  stays as written. 90%.

## The config shape

One block per taken rule, at the end of `overrides`, so nothing after it can turn the rule down.

```jsonc
// a sketch: two of the eight blocks
{
  // anti-slop/max-ternary-depth (0558). On where the count is zero; a sweep adds its folder.
  "files": ["next/packages/libfabrika/src/access/**", "next/packages/libfabrika/src/packs/**"],
  "rules": { "anti-slop/max-ternary-depth": ["error", { "maxDepth": 2 }] }
},
{
  // anti-slop/require-safety-comment-for-type-assertion (0561). Marker SAFETY, their default.
  "files": ["next/packages/libfabrika/src/packs/**", "next/programs/inbox/**"],
  "rules": { "anti-slop/require-safety-comment-for-type-assertion": ["error", { "markers": ["SAFETY"] }] }
}
```

- **A rule is named nowhere else.** Not in the root `rules`, never `"off"`, never `"warn"` (0563 D,
  0524). A folder not on a rule's list is simply not under it yet.
- **A folder is one row of the count table:** each tooling folder, each module of libfabrika, each
  other package, each program, the app. Its glob is the folder with `/**`. Tests and product code
  of a folder go on together: decision 0562 says "it is a test" is no reason to leave a file out.
- **Pull request 1 lists every folder whose cell is `0/0`,** busy folders included. Nothing is
  edited there, so no open branch gets a conflict. A branch that adds a hit in such a folder goes
  red when it merges main, which is the rule working.
- **The end state of a rule** is its list replaced by the four globs of the scope: `next/**`,
  `.agents/**`, `oxlint-plugins/**` and the CI scripts folder's glob. The pull request that brings
  the last folder to zero does that.
- **An ignore line can only be added when its folder goes on.** The config has
  `reportUnusedDisableDirectives` at `error`, and a disable comment that names a rule not on in
  that file counts as unused. So the 156 right `unknown` parameters of ticket 1053 get their lines
  in the sweep of their own folder, not before.
- **The spacing rule's fix runs in `pnpm format`** from the moment a folder is on its list, because
  `format` already runs `lint.ts --fix` with this config. Nobody adds a blank line by hand (0021).
- **The eight rules,** by their real names: `anti-slop/max-ternary-depth`,
  `anti-slop/require-safety-comment-for-type-assertion`, `anti-slop/require-readable-spacing`,
  `anti-slop/no-unknown-parameters`, `anti-slop/no-unknown-returns`, `anti-slop/no-runtime-typeof`,
  `anti-slop-effect/no-manual-tagged-construction` and `anti-slop-effect/no-manual-tagged-type`.
  The last two are in the second plugin, so their prefix is `anti-slop-effect`.
- **Not turned on, in any folder:** every other rule of the two plugins. They wait on the owner,
  one by one, and `no-reprovide-ambient-service` is refused (0560, 0563).

**The zero-lock check (law L4).** A whole `pnpm lint` run does one more oxlint run, with a config it
builds in memory: the two plugins, the eight rules at `error`, over the scope. For each rule and
each folder, a folder with no hit that is not on the rule's list fails the run and says which line
to add. This is the same idea as the `stale` check `oxlint-plugins/advice.ts` has for the six
advice rules, without the warn level. It keeps no list: the folders still waiting are the scope's
folders minus the rule's list, read from the config and the disk.

- What it holds: a folder that reaches zero is locked in the same pull request, and a new folder
  with clean code is on every list from its first file.
- What it does not hold: a new folder born with a hit. Review reads for that until the rule's list
  is the whole scope.

## One value, traced

A cast in a cold folder, from today to locked.

1. Today: `next/packages/libfabrika/src/schedules/` has one cast with no reason. The cast rule's
   block does not list the folder, so `pnpm lint` passes.
2. Pull request 1 lands. Still passes: the folder has a hit, so the zero-lock check asks nothing
   of it.
3. A sweep pull request for "cast, schedules" reads that one cast. Either the cast goes away (a
   decode, a real type, `satisfies`), or it stays with `// SAFETY: <the fact, and where it comes
   from>` on the line above. It adds `"next/packages/libfabrika/src/schedules/**"` to the cast
   rule's block.
4. If the sweep forgets that line, the zero-lock check fails its `pnpm lint`:
   "anti-slop/require-safety-comment-for-type-assertion has no hit left in
   next/packages/libfabrika/src/schedules: add the folder to its block".
5. After the merge, a new bare cast in that folder fails `pnpm lint` in its pull request and in
   the merge line.

## The count

Each cell is product hits, then test hits, from one run of the plugin's eight rules over the scope
(1,038 files; `**/fixtures/**` left out, as the real config does). "Tests" are `*.test.ts(x)`,
`*Test.ts` and `*test-support*` files. "tag value" is `no-manual-tagged-construction`, "tag type"
is `no-manual-tagged-type`. The rows named "lead scripts" and "CI scripts" are the `.agents/` tree
and the scripts folder under `.github/`.

| Folder | ternary | cast | unknown parameter | unknown return | typeof | tag value | tag type | spacing |
|---|---|---|---|---|---|---|---|---|
| lead scripts | 4/8 | 32/102 | 9/7 | 2/0 | 23/2 | 3/133 | 0/1 | 774/1105 |
| CI scripts | 2/4 | 2/76 | 14/2 | 1/3 | 77/8 | 14/25 | 2/0 | 165/301 |
| oxlint-plugins | 6/4 | 21/17 | 19/7 | 3/3 | 64/5 | 17/5 | 8/3 | 290/458 |
| libfabrika, files outside a module | 0/0 | 1/0 | 3/7 | 1/0 | 0/2 | 0/4 | 0/0 | 66/94 |
| libfabrika access | 0/0 | 0/1 | 0/3 | 0/1 | 0/4 | 0/89 | 0/11 | 50/177 |
| libfabrika ci | 0/2 | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 | 0/20 |
| libfabrika codehost | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 | 0/20 |
| libfabrika coordination | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 | 20/0 |
| libfabrika desktop | 0/0 | 2/5 | 0/2 | 0/0 | 0/0 | 0/10 | 0/1 | 68/91 |
| libfabrika ledger | 0/0 | 1/2 | 5/3 | 4/2 | 6/7 | 3/58 | 1/0 | 60/235 |
| libfabrika packs | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 | 23/71 |
| libfabrika permissions | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 | 15/43 |
| libfabrika presence | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 | 0/2 | 0/0 | 9/20 |
| libfabrika repositories | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 | 3/3 |
| libfabrika schedules | 0/0 | 1/0 | 0/0 | 0/0 | 1/0 | 0/7 | 0/0 | 1/5 |
| libfabrika settings | 0/6 | 0/26 | 15/13 | 3/3 | 2/9 | 0/22 | 0/0 | 66/238 |
| libfabrika tasks | 0/1 | 0/15 | 0/0 | 0/2 | 0/0 | 0/0 | 0/0 | 27/122 |
| libfabrika telemetry | 0/0 | 0/4 | 5/1 | 1/0 | 7/7 | 0/56 | 0/2 | 107/192 |
| libfabrika tezgah | 1/2 | 0/5 | 0/1 | 0/0 | 3/13 | 0/0 | 0/0 | 24/35 |
| libfabrika transport | 0/2 | 0/9 | 3/8 | 0/3 | 1/17 | 0/47 | 0/16 | 109/253 |
| tuval package | 2/0 | 1/10 | 3/1 | 0/0 | 8/9 | 0/1 | 0/1 | 73/36 |
| vitest package | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 | 0/1 |
| program chaos | 0/0 | 0/0 | 0/13 | 0/0 | 0/0 | 0/0 | 0/0 | 0/72 |
| program checklist | 0/0 | 0/0 | 0/7 | 0/6 | 0/1 | 0/14 | 0/4 | 8/82 |
| program counter | 0/0 | 0/1 | 0/4 | 0/1 | 0/2 | 0/6 | 0/1 | 1/38 |
| program inbox | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 | 0/1 | 0/0 | 1/9 |
| program pipeline | 3/4 | 0/5 | 1/8 | 0/2 | 0/5 | 0/15 | 0/4 | 41/203 |
| program tezgah | 0/0 | 1/5 | 0/6 | 0/0 | 0/6 | 0/26 | 0/4 | 11/50 |
| busy: libfabrika runtime | 2/25 | 7/119 | 109/139 | 23/27 | 23/57 | 0/319 | 0/36 | 375/1544 |
| busy: libfabrika processes | 0/8 | 1/63 | 5/8 | 0/8 | 3/13 | 0/110 | 0/5 | 139/629 |
| busy: libfabrika cloudflare | 1/8 | 11/84 | 68/41 | 4/6 | 10/6 | 0/84 | 0/1 | 272/605 |
| busy: libfabrika gateway | 0/5 | 2/1 | 15/9 | 0/1 | 6/3 | 0/32 | 0/6 | 196/248 |
| busy: libfabrika node | 0/10 | 3/59 | 4/48 | 1/5 | 7/24 | 0/151 | 0/18 | 338/1099 |
| busy: libfabrika client | 2/16 | 6/153 | 10/23 | 1/2 | 0/37 | 0/126 | 0/24 | 215/474 |
| busy: the app | 2/15 | 5/128 | 7/141 | 1/19 | 8/89 | 0/548 | 0/10 | 198/2882 |
| All | 25/120 | 97/890 | 295/502 | 45/94 | 249/326 | 37/1891 | 11/148 | 3745/11455 |

- **Against the decision drafts.** Ternary (145), cast (987), unknown returns (139) and typeof (575)
  match the drafts' numbers exactly. Unknown parameters: 253 in `next/` product code, as ticket
  1053 says, and 797 in all. The two tag rules fire 2,087 times, where our own
  `fabrika/no-hand-tag` fired 2,070 for decision 0562. Spacing is 15,200, not the "about 12,000,
  rough" of 0563's draft.
- **By group.** Tooling: 3,831 hits in 24 cells. Cold and touched `next/` folders: 3,668 in 108
  cells. Busy folders: 12,431 in 56 cells. Spacing is 15,200 of the 19,930.

## The sweeps

**The unit is one rule in one folder per pull request.** Each ends at zero with its folder added to
that rule's block.

- **No list of leftovers, no rule turned down, no path narrowed** (0168, 0524). An inline ignore
  goes only where the code is right, and its reason is a fact about its own line. The same sentence
  down a folder is a bulk disable (0523, 0563).
- **A fix does not hide the shape from the rule:** no ternary pushed into a call or an `&&` to
  restart its count (0558), no cast swapped for `Reflect` or `Object(x)[key]` (0561, 0554), no
  computed `["_tag"]` key (0562).
- **Each sweep reports** the hits it met, each fix, and each ignore line with its reason, in its
  pull request (0523). For the cast rule it also reports the three shares 0561 asks for: the cast
  went away, it stayed with a real fact, it stayed and the comment is noise.
- **Batching.** The lead may put several folders of one rule in one pull request when each lands
  whole and all are cold. Never two rules in one pull request, and never a busy folder with a cold
  one.
- **One sweep at a time per folder.** A folder is taken by one sweep branch at a time, whatever the
  rule, since two sweeps of one folder touch the same files.
- **Who writes.** A sweep changes no law: same assertions, same generators (0168). Test files and
  the config line are the tests step's, product files the build's.

**Order of folders.**

1. **Tooling:** the lead scripts, `oxlint-plugins/`, the CI scripts. Open pull request 1301 touches
   `oxlint-plugins/`, so that folder goes last of the three.
2. **Cold `next/` folders,** which no open pull request touches today: libfabrika's ci, codehost,
   coordination, desktop, packs, presence, repositories, schedules, tasks and tezgah modules, the
   files outside a module, and the chaos, checklist and inbox programs.
3. **Touched folders,** each in one or two open pull requests today: libfabrika's access, ledger,
   permissions, settings, telemetry and transport, the tuval and vitest packages, and the counter,
   pipeline and tezgah programs. A sweep here reads the open list again when it starts and waits
   for a pull request that edits the same files.
4. **Busy folders wait,** and are named so: libfabrika's runtime, processes, cloudflare, gateway,
   node and client modules, and the app. Each starts when the lead says its open work has landed.

Open pull requests are at https://github.com/kamp-us/tea-fabrika/pulls, read on 2026-11-15.

**Order of rules inside a folder.**

1. **Spacing first.** It is one pass of the fixer and adds lines only. Once it is on, `pnpm format`
   spaces every later fix as it is written, so no later sweep is re-spaced. It also conflicts with
   every other diff in the folder, so it must not run beside one.
2. **Ternary, then unknown returns, then typeof.** Small counts, each fix local.
3. **Unknown parameters,** where ticket 1053 allows (below).
4. **The cast rule.** Many casts go away when a decode or a real type arrives with the rules
   above, so it is cheaper after them.
5. **The two tag rules, together last.** They are one decision (0562) and the largest count after
   spacing. They are two rules, so two blocks, but one sweep may carry both in a folder: a
   hand-written tagged type and its hand-written values change together.

**The first spacing pull request carries the amendment to decision 0021:** the places that need a
blank line gain "before a `return`" and "around a multi-line binding in any block", and its line
that Effect does not enforce blank lines gains the measure 0563 records. The lead writes it with
the adr skill, in that pull request, as 0563 says.

**How this meets ticket 1053 (the 97 faulty `unknown` parameters).**

- Ticket 1053's nine slices fix the 97 by wire value, across folders. This quest turns the rule on
  by folder. A folder's `no-unknown-parameters` sweep starts only when every 1053 slice that has a
  hit in that folder has merged.
- What the sweep then does: the test-file hits (502 in all), the tooling hits (58), and one ignore
  line on each of the 156 right ones in that folder, then the folder goes on the list.
- The reason line for a right one says what its own line does. Two kinds are known, and each line
  still names its own schema or program:
  `-- this door decodes <name> with <Schema> on the next line` and
  `-- <program>'s own model: the runtime carries it and never reads it`.
- Ticket 1053's plan is `docs/plan/quests/t1053-PLAN.md` on branch `fabrikalfa/unknown-params`. It
  plans no lint rule, which fits: the rule comes from here.

**How this meets the Effect checker's sweep (decision 0565's draft, 135 checks).** Both go folder by
folder over the same scope. They share the folder lock above: one sweep branch per folder at a
time, either kind. Where both are ready for a folder, spacing goes first, then the checker's sweeps
that rewrite calls (`preferEffectArray` and the like), then this quest's other rules, since a
rewritten call can remove a `typeof` or a cast.

**Our own rules that theirs may cover: the place for the audit.** Rule E of 0563 says a rule of ours
that theirs covers is replaced and deleted, and a separate audit names them. This plan deletes
none. The three it will meet, with what was seen here:

- `fabrika/no-hand-tag` beside the two tag rules: theirs fire 2,087 times where ours fires 2,070,
  and theirs also read a quoted or computed `"_tag"` key, which ours skips. Likely covered.
- `fabrika/padding-line-between-statements` beside their spacing rule: theirs asks for more inside
  blocks, but it does not read class members, which ours does. Not fully covered.
- `fabrika/no-type-assertions` beside the cast rule: different jobs. Ours refuses `as any` and the
  double cast outright; theirs asks a reason of every cast. Their `no-chained-type-assertions`
  would cover part of ours, and it waits on the owner.

Until the audit lands, both stay on and do not clash: the spacing trial left today's lint unchanged.
The sweep that brings a tag rule to the whole scope is where the audit's deletion of
`fabrika/no-hand-tag`, and of its three "off" blocks for tests, is expected to land.

## Where a draft is unclear

Read at the branch heads on 2026-11-15: 0563 at `358a67468`, 0558 at `492809e85`, 0561 at
`b7c57aa4b`, 0559 at `e2307d0c0`, 0560 at `02e6f0d23`.

- **0563 says spacing "lands through `pnpm format`'s fixer, as its own pull request".** One pull
  request would touch 888 files, the busy folders included. This plan lands it folder by folder, as
  0563's own rule D and the brief say. 0563's line should say "its own pull requests".
- **0563's Context still says neither install route was tried,** and its "Not decided here" still
  lists the route and the version. The owner's ruling and this plan's trial settle both; the
  amendment another agent writes should replace those lines.
- **0563's hit column is a syntax count for four rules.** The plugin's own run gives 797 unknown
  parameters (0563: 253 / 486 / 58, which matches), 15,200 for spacing (0563: about 12,000), and
  1,928 and 159 for the two tag rules (0563: 3 / 1,728 / 197 and 1 / 144 / 14, from another
  script).
- **0561 asks for a hand-read sample of the 987 casts "before the rule blocks anywhere",** and
  says the cleanup's plan carries it. Pull request 1 turns the cast rule on in folders with zero
  casts, which blocks there with nothing to sample. This plan reads that as allowed, and makes the
  first cast sweep the sample. If the draft means a sample before even a zero-hit folder blocks,
  the cast block leaves pull request 1.
- **0561 leaves "one comment or two" for a chain cast that stays.** Call: one. The disable line
  that `fabrika/no-type-assertions` already needs carries the reason, written
  `-- SAFETY: <the fact>`. Their rule reads any comment before the statement and looks for
  `SAFETY:` in it, so the one line serves both. Read from their source, not run. 80%.
- **0562 and 0563 both leave "which lint rule holds the hand-written `_tag`" to this plan.** Call:
  their two rules, by 0563's rule E. 90%.
- **0559's built-in rule, `oxc/no-accumulating-spread`, is not in this quest.** It is not a rule of
  the plugin and has its own decision and 11 rewrites. It is named here only so nobody looks for it
  in the table.
- **0558 and 0563 name the scope's third tooling folder as the CI scripts folder only.** Workflow
  files beside it hold no TypeScript, so this plan reads the scope the same way.

## Laws

The lint rules are the exam, so each taken rule is seen to fail through the real config.

| Law | Kind (lint, type or test?) | Generator | Plant | Where |
|---|---|---|---|---|
| L1, the vendored folder is the pinned commit: the tree id of `vendor/anti-slop/src` at HEAD equals `tree` in `pin.json`, and the folder has no uncommitted change. In a small git tree of its own, as `exact-versions.test.ts` does: a copy with one byte changed, one file added or one file removed is refused, and an untouched copy passes. 20 runs | test | fc.constantFrom: change a byte, add a file, remove a file, change `tree` | make the check read `pin.json` only: every edit passes, L1 red | oxlint-plugins/vendored.test.ts |
| L2, each of the eight taken rules fires through the repository's own config: for a rule and a folder on its list, a planted file with one refused line gets that rule's code on that line, and a taken line beside it gets none. One oxlint run for all plants | test | scenario: one refused and one taken line per rule, from the plugin's own README examples | drop the second `jsPlugins` entry: the two tag rules' plants load no rule, L2 red | oxlint-plugins/anti-slop.test.ts |
| L3, a rule holds only where its block lists the folder: the same refused line planted in a folder not on the rule's list gets no diagnostic of that rule, and no rule of the two plugins outside the eight is named anywhere in the config | test | scenario: the eight rules against the config's own lists, read from `.oxlintrc.json` | name a taken rule in the root `rules`: it fires in an unlisted folder, L3 red | oxlint-plugins/anti-slop.test.ts |
| L4, the zero lock: given the folders, each rule's list and the hits per folder, the check names exactly the folders with no hit that are not listed; a listed glob that is not a folder of the scope or one of its four whole-scope globs is refused. 100 runs | test | fc.record: fc.uniqueArray of folder names, a subset on the list, fc.nat hits per folder | answer "nothing to add" for every input: L4 red | oxlint-plugins/anti-slop.test.ts |
| L5, no block for a taken rule says `"off"` or `"warn"` | test | scenario: every override of `.oxlintrc.json` that names a rule with the `anti-slop` prefix | add `{ "files": ["next/**"], "rules": { "anti-slop/no-runtime-typeof": "off" } }`: L5 red | oxlint-plugins/anti-slop.test.ts |

- L1's real-repo half, the check on this repository's own folder, runs in every `pnpm lint`. Its
  plant: change one character in a file under `vendor/anti-slop/src`, and `pnpm lint` fails with
  the two tree ids.
- No host-only law. Nothing here needs launchd, the real Electron app or the owner's Mac. The
  tests spawn oxlint and git, as `plants.test.ts` and `exact-versions.test.ts` already do in the
  tooling project.
- No secret is near this work.


## Amendment, 2026-11-15: what the tests step found

- **Spacing has no block in pull request 1.** No folder is at 0/0 for
  `anti-slop/require-readable-spacing`, so pull request 1 has seven blocks, not eight. Spacing's L2
  case starts with its first sweep. No list is kept by hand: the zero lock adds the block when a
  folder reaches zero.
- **One vendored file runs a process.** Their test
  `vendor/anti-slop/src/rules/require-readable-spacing-cli.test.ts` runs `pnpm exec oxlint` as a
  child process and writes temp files. It stays, unchanged: the pinned tree id needs it, and the
  owner ruled their `src/` comes in whole. Nothing here runs it: vitest's globs, every tsconfig and
  oxlint's plugin entries (`src/index.ts`, `src/effect/index.ts`) leave it out. **Law L6, test:**
  no vitest project and no tsconfig of the repo includes a path under `vendor/`. Plant: add
  `vendor/**` to one project's `include`. Where: `oxlint-plugins/vendored.test.ts`.
- **More files change** (one line each, tests step): every temp repo that copies the real config
  needs a `vendor/` link: `oxlint-plugins/advice.test.ts`, `oxlint-plugins/plants.test.ts`,
  `oxlint-plugins/prefer-schema-arbitrary.test.ts`, `oxlint-plugins/program-package-layout.test.ts`,
  `next/apps/fabrika/src/exam/plant.ts` and
  `next/apps/fabrika/src/exam/one-store-hook.integration.test.ts`. And
  `next/apps/fabrika/src/exam/commits.test.ts` pins the bytes of `exam-paths.json`, which gains
  the `vendor/**` row. New files: `oxlint-plugins/anti-slop.ts` and `oxlint-plugins/vendored.ts`
  with their tests.

- **The review's round (2026-11-15).** Decision 0567, merged after this plan was approved, took the two
  Match rules (`anti-slop-effect/no-manual-tag-comparison`, `anti-slop-effect/prefer-effect-match`),
  so pull request 1 takes ten rules: each gets its own block, with its 0/0 folders (5 and 13 today),
  and L2, L3 and the zero lock cover them. **Law L7, test:** the config loads `anti-slop` and
  `anti-slop-effect` only from their vendored paths. Plant: point one entry at an edited copy under
  another folder. Where: `oxlint-plugins/anti-slop.test.ts`.
## Files

Pull request 1 only. The lint rules, their config and everything under `oxlint-plugins/` are exam
paths, so the tests step writes them. Their source in `vendor/` is the exam's rules too: the tests
step brings it in, and `exam-paths.json` gains `vendor/**`, so no build step can ever edit a rule.
That leaves the build one docs row, and the job of showing the tree green under the new config.

| File | Owner | Product lines expected | What |
|---|---|---|---|
| vendor/anti-slop/src | tests | tests | new: the fork's `src/` at the pinned commit, brought in with `git archive` or a plain copy, never typed or edited. 70 files, about 11,000 lines of theirs |
| vendor/anti-slop/LICENSE | tests | tests | new: the fork's `LICENSE` at that commit |
| vendor/anti-slop/pin.json | tests | tests | new: `repository`, `commit`, `tree` |
| exam-paths.json | tests | tests | one row: `vendor/**`, the lint rules we take as they ship |
| package.json | tests | tests | the root gains `"@oxlint/plugins": "catalog:"` in `devDependencies` |
| pnpm-lock.yaml | tests | tests | what that one line writes |
| .oxlintrc.json | tests | tests | the two `jsPlugins` entries, `"vendor/**"` in `ignorePatterns`, and eight blocks at the end of `overrides`, each with its `0/0` folders. About 90 lines |
| .oxfmtrc.json | tests | tests | `"vendor/**"` in `ignorePatterns` |
| oxlint-plugins/vendored.ts | tests | tests | new: the unchanged check, with its doc block. About 40 lines |
| oxlint-plugins/anti-slop.ts | tests | tests | new: the eight rule names, the scope's folders, and the zero-lock function. About 80 lines |
| oxlint-plugins/lint.ts | tests | tests | a whole run calls both checks. About 25 lines |
| oxlint-plugins/vendored.test.ts | tests | tests | new: L1 |
| oxlint-plugins/anti-slop.test.ts | tests | tests | new: L2 to L5 |
| oxlint-plugins/README.md | tests | tests | a section: the vendored plugin, the pin, how a rule goes on in a folder, how an update arrives |
| oxlint-plugins/advice.test.ts oxlint-plugins/plants.test.ts oxlint-plugins/prefer-schema-arbitrary.test.ts oxlint-plugins/program-package-layout.test.ts | tests | tests | each temp repo that copies the real config gains a `vendor/` link (amendment) |
| next/apps/fabrika/src/exam/plant.ts next/apps/fabrika/src/exam/one-store-hook.integration.test.ts | tests | tests | the same `vendor/` link in their temp repos (amendment) |
| next/apps/fabrika/src/exam/commits.test.ts | tests | tests | the pinned bytes of `exam-paths.json` gain the `vendor/**` row (amendment) |
| oxlint-plugins/advice.ts oxlint-plugins/index.ts pnpm-workspace.yaml | tests | tests | read for this plan, not changed |
| oxlint-plugins/ oxlint-plugins/** .github/ | tests | tests | named in this plan as folders of the scope; pull request 1 changes no file in them beyond the rows above |
| next/AGENTS.md | build | docs | "What lint holds" gains one row that points at the README section |

`AGENTS.md` at the root is not changed: its Checks section already points at
`oxlint-plugins/README.md`.

## Calls taken

- **The folder is `vendor/anti-slop/`. 85%.** Reasons under "The install".
- **Git's tree id is the digest, checked in `pnpm lint`. 85%.** No new tool, and the number can be
  checked against the fork by anyone. The cost: the check needs git, which `lint.ts` already does.
- **One block per rule, listing clean folders, with no "off" line. 85%.** It is what 0562's sketch
  shows and what 0524 allows. The cost is the hole for a new folder born dirty, which L4 narrows
  and review covers.
- **Pull request 1 turns each rule on in every `0/0` folder, busy ones included. 85%.** No file
  there changes.
- **Tests and product code of a folder go on together. 85%.** 0562's principle. The cost: a folder
  with clean product code and dirty tests waits for its tests.
- **Spacing goes first in each folder. 85%.**
- **The two tag rules are swept together, last. 80%.**
- **The pin is not a setting, and neither are `maxDepth` and the marker. 90%.**
- **The amendment to 0021 rides in the first spacing pull request, written by the lead. 90%.** 0563
  says so.

## What this cannot tell us

- The false-alarm share of any of the eight rules on new code. All hits counted are old.
- Whether a `SAFETY:` reason is true. Their rule cannot see that, and review reads each one.
- How long the busy folders wait. That is set by the open work, not by this plan.
- Whether their rules count the same after an update of the fork. The pull request that moves the
  pin runs the count again.

## Validation

The tests step runs its two new files with
`nice -n 15 pnpm exec vitest run --maxWorkers=3 oxlint-plugins/vendored.test.ts oxlint-plugins/anti-slop.test.ts`.
The tests step also runs `pnpm format`, then `pnpm lint`, and
`oxlint-plugins/plants.test.ts`, which reads the same config. The build runs `pnpm lint` after its
docs row. After `pnpm format`, the tests step checks
that `git status --porcelain -- vendor` is empty, so the formatter did not touch their files. The
lead runs the one type check and CI the rest. No file named `.integration.` or `.visual.` is run on
the laptop.

## Size

Pull request 1 is planned here in full. The sweeps are sized from the table and each gets its own
short plan.

1. The install: about 245 lines of ours in config and lint tooling, plus their 70 files unchanged,
   and about 300 lines of laws. All of it is exam paths but one docs row.
2. Spacing, tooling and the cold and touched folders: 0 lines by hand, 5,986 blank lines by the
   fixer.
3. Ternary, the same folders: 51 hits, about 400 lines.
4. Unknown returns, the same folders: 41 hits, about 250 lines.
5. Typeof, the same folders: 289 hits, about 1,500 lines.
6. Unknown parameters, the same folders, after ticket 1053's slices: 170 hits, about 700 lines.
7. Cast, the same folders: 345 hits, about 700 lines.
8. The two tag rules, the same folders: 617 hits, about 1,900 lines.
9. The busy folders, all eight rules, when their open work has landed: 12,431 hits, 9,214 of them
   blank lines by the fixer, about 9,000 lines by hand.

Items 2 to 9 are groups of pull requests, not one each: 188 folder-and-rule cells in all, fewer
pull requests where the lead batches. Confidence 85% on item 1, 50% on the line counts of items 3
to 9, which are a guess of lines per hit and not a measure.

The budget below is item 1's: tests, build, review, one fix round and its recheck. Priced as the
plan of ticket 1053 priced its first slice, from the list prices in `field/runs.jsonl` (tests median
$1.14, build $1.24, review $1.18) and ticket 971's lane (tests $8.41, build $0.87, review $2.70).
Those figures are taken from that plan, not recounted here.

Estimate: 5 steps, $19

## Records

- **What is lost if it is not recorded now:** which commit of the fork our copy is. Without
  `pin.json` in the first commit, no later check can say whether the folder was ever theirs.
- **Each sweep's report** of hits met, fixes and ignore lines is in its pull request, which is the
  record 0523 asks for. Nothing counts hits on a schedule (0563 B).
- No ledger entry, span or stored row changes.

## Open questions

None.

The install route was the owner's one call, and he made it on 2026-11-15.

## Findings

```json
{"_tag":"finding","id":"2026-11-15-publish-takes-a-flag-as-a-branch","date":"2026-11-15","by":"plan","model":"claude-fable-5-2","rule":"bug","location":{"path":".agents/skills/lead/scripts/publish.ts","line":45},"says":"Today's lead tooling: publish.ts reads its first argument as the branch name without checking it, so a flag such as --help is pushed to origin as a branch of that name before the pull request step refuses.","proof":"Run in a worktree at this head: `node .agents/skills/lead/scripts/publish.ts --help` printed `publish: refused: gh pr create exited 1: pull request create failed: GraphQL: No commits between main and --help (createPullRequest)`, and `git ls-remote origin` then listed `refs/heads/--help` at this head. The stray branch was deleted the same minute.","cost":"A mistyped call leaves a junk branch on the public remote, and the tool's one line reads as a refusal though the push went through.","head":"ca4444777b622f9e599d6eeb128de7c374aefb2d","ticket":null,"pr":null}
```
