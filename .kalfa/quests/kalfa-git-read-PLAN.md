Approved by the lead agent, builds 0047, 0048, 0049, 0063, 0076, 0079; body f555157145d2
Plancheck-Version: 3

# Plan: @kalfa/git, read commits and refs from a repository, in memory and with the git binary (ticket 1932)

This is the kalfa packages (`kalfa/`), new work. It is not today's frozen version and not `next/`. The
ticket is https://github.com/kamp-us/tea-fabrika/issues/1932, a GitHub issue, so its pull request says
`Closes #1932` and carries no `fabrika close ticket` line. One pull request, one slice. It makes a new
package, `kalfa/git/`, which holds only a glossary today.

```ts
// The whole idea, a sketch. A caller yields the store and reads history. No working copy, no HEAD.
import * as Repository from "@kalfa/git/Repository";
import * as CommitId from "@kalfa/git/CommitId";
import * as Ref from "@kalfa/git/Ref";

const program = Effect.gen(function* () {
  const repo = yield* Repository.Repository;
  const [main] = yield* repo.readRefs(Ref.RefName.makeUnsafe("refs/heads/main"));   // [{ name, commit }] or []
  const branch = CommitId.makeUnsafe("d944ba0024149807151b00b4f819c9d16f454bc1");
  const own = yield* repo.walk({ include: [branch], exclude: [main.commit] });       // Commit[], oldest first
  const bases = yield* repo.mergeBases(branch, main.commit);                         // CommitId[], [] = unrelated
  const landed = yield* repo.isAncestor(branch, main.commit);                        // boolean
  return { own, bases, landed };
});

// Two adapters answer the same calls; /test holds the laws both pass.
ProcessRepository.layer({ path: "repo.git", settings }) // Layer<Repository, GitTooOld | NoRepository | GitUnavailable | TimedOut, ChildProcessSpawner>
MemoryRepository.layer(store, settings)                      // Layer<Repository | MemoryStore, BadStore>
RepositoryTest.suite("memory", subject, { runs: 100 })       // the shared laws, run by each adapter's own test file
```

## Doubts, read first

The owner is away, so every call below is taken. These three are under 80%:

- **The name `Signature` for a commit's author or committer, 70%.** It is the industry's word (libgit2's
  `git_signature`, go-git's `object.Signature`, gitoxide's `gix_actor::Signature`), but git also says
  "signature" for a signed commit. `Person` is taken (Delivery's approver type) and `Identity` is a context.
  The glossary entry says it is not a cryptographic signature. A rename later is a search and replace with
  no saved data.
- **`readRefs` fails, and does not skip, when a ref under the asked name points at a tag object, a tree, a
  blob, or is a symbolic ref, 75%.** Skipping would answer a list that leaves out a ref git holds. No
  caller reads tags, and our repositories are bare clones kalfa fetches into, so the error should be rare.
  The doubt is a repo where a person ran `git remote set-head`, which makes a symbolic ref.
- **Real git's walk under clock skew, 65% that the shared walk law stays green on real git.** `git rev-list
  A --not B` uses commit dates to stop early when the repository has no commit-graph, and git's own
  history says skewed dates can make it list a commit B reaches (from memory, not fetched). The history
  generator draws skewed dates on purpose, so the integration run settles it. If only the skewed class is
  red, that is a real limit of git, not a bug to hide: the build reports it, the seeder does not change to
  make it pass, and the lead files a ticket (likely: `/process` writes or needs a commit-graph).

## What changes, in one paragraph

A new private workspace package, `@kalfa/git`. Its core holds the values (`CommitId`, `RefName`,
`BranchName`, `Ref`, `Signature`, `Commit`), the settings (`Limits`), the errors, and the `Repository`
service with five read calls: `readCommit`, `readRefs`, `walk`, `mergeBases`, `isAncestor`.
`Repository.make` wraps an adapter's calls once with the span and the time limit, as Effect's
`ChildProcessSpawner.make` derives its helpers. `/memory` keeps the store as a plain value of commits,
refs and shallow commits, with commit ids computed the way git computes them. `/process` runs the git
binary on a bare repository through Effect's `ChildProcessSpawner`, so no file in the package imports a
Node module. `/test` holds the shared laws and the history generators. The package imports no kalfa
package, ranks lowest, and has no GitHub entry point. Out of scope: diff and patch id (1933), merge trees,
write a commit and move a ref (1934), read a file and edit a tree (1935), rebase (1936), squash (1937),
fetch and the credential slot (1938), the push plan and the pre-push hook (1939), push (1940).

## Searched first

- The ticket and its parent, https://github.com/kamp-us/tea-fabrika/issues/1750, with every comment (a
  later one wins), and the siblings 1933 to 1940 whole, so this plan leaves them their calls.
- `kalfa/git/GLOSSARY.md`, `kalfa/AGENTS.md`, `.kalfa/glossary/GLOSSARY-MAP.md`, and the Identity
  glossary's words (for the author type's name).
- Decisions 0047, 0048, 0049, 0050, 0063 and 0075 to 0088. Only 0063 (span form), 0079 (the commit id as
  `vcs.ref.head.revision`; where spans go) and 0076 (the Ledger's own failure names) touch this package.
  Issue https://github.com/kamp-us/tea-fabrika/issues/1870 holds the rule on failure names:
  `<Package>Unavailable` with a tagged `reason`, and plain `Unreachable` belongs to the Ledger alone.
- The callers' protocols and gap answers: Delivery
  (https://github.com/kamp-us/tea-fabrika/issues/1760 and its gaps answer on
  https://github.com/kamp-us/tea-fabrika/issues/1896), Reconciliation
  (https://github.com/kamp-us/tea-fabrika/issues/1758, with
  https://github.com/kamp-us/tea-fabrika/issues/1869 and
  https://github.com/kamp-us/tea-fabrika/issues/1895), Code hosting
  (https://github.com/kamp-us/tea-fabrika/issues/1755) and CI
  (https://github.com/kamp-us/tea-fabrika/issues/1756), and the push answer
  https://github.com/kamp-us/tea-fabrika/issues/1908.
- `rg -il` over `.kalfa/decisions`, `.kalfa/glossary`, `.kalfa/patterns`, `.kalfa/runbooks` and every kalfa
  glossary for "TaggedError|named error|failure name", "time limit|size limit", "shallow", "signature|
  person|ident", "Timeout|TooMany|TooLarge|Unavailable". Code hosting's `TooMany` (a list past its
  setting) is the one precedent for an over-limit name; Program's glossary owns **Timeout** as a message,
  so this package says `TimedOut`.
- Patterns: `effect-errors-keep-their-cause.md`, `effect-pure-domain-returns-result.md`,
  `effect-services-and-layers.md`, `doc-comments.md` (`fabrika/jsdocs` covers `kalfa/*/src/**`).
- `node_modules/effect/AGENTS.md`, whole, for Effect 4.1.3 (the lockfile's version; its patch touches only
  `TestConsole` and the arbitrary model). Read in the installed source: `effect/process`
  (`ChildProcess.make` options `env` and `extendEnv`, where `extendEnv: false` with `env` replaces the
  child's environment; `ChildProcessSpawner.make` and its handle, whose `string` and `lines` helpers do not
  check the exit code), `effect/crypto/Digest` (`sha1`, `layerWebCrypto`), `Schema.brand`,
  `Schema.TaggedError`, `Schema.Duration`, `Arbitrary` (`array`, `map`, `filter`, `flatMap`, `all`,
  `schema`), and `@effect/vitest`'s `prop`.
- Installed versions in `pnpm-lock.yaml`: `effect`, `@effect/platform-node` and `@effect/vitest` 4.1.3,
  `vitest` 5.0.5, `fast-check` 4.10.2 (not used here).
- The built kalfa packages for layout: `kalfa/config`, `kalfa/ci`, `kalfa/quality` (its
  `node/MutantsStryker.integration.test.ts` is the one kalfa law on a real process), `kalfa/records`; and
  the plan with its first amendment on branch `fabrikalfa/kalfa-diagnostics-declare`, read only.
- The lint and test wiring a new package meets: `.oxlintrc.json` (the `kalfa/**` blocks, `kalfa/config`'s
  Effect block at its `files: ["kalfa/config/src/**", "kalfa/config/*.ts"]`, its import override), the rule
  sources for `fabrika/no-node-imports`, `fabrika/integration-test-name` and the shared `heldToNext`,
  `vitest.config.ts` (the `kalfa/**/*.integration.test.{ts,tsx}` glob, and "a test that drives ... git,
  a spawned process ... temp files is `*.integration.test.ts`"), `vitest.hostrun.ts` (an integration file
  is refused on the laptop by name; CI and a Linux cloud box are allowed), `layer-rules.json`,
  `boundary-rules.json`.
- Today's and `next/`'s git code, as lessons only: `next/packages/libfabrika/src/node/repositories/`
  (`RepositoriesGit.ts` runs git with `extendEnv: false`, PATH read through Effect's `Config`, and
  `--no-replace-objects`; `Git.ts` and `internal/gitMemory.ts` answer the git command line in memory) and
  the lead's `.agents/skills/lead/scripts/box/BoxGitProcess.ts` (every `GIT_` variable dropped, then a
  pinned set). Nothing is copied: `kalfa/` may not import `next/`, and this package's memory adapter holds
  data, not a command line.
- Facts from git 2.40.1, run by hand in a scratch folder outside the repo, not a test: `merge-base --all`
  of unrelated commits exits 1 with no output, of a missing commit exits 128; `merge-base --is-ancestor`
  exits 0, 1 or 128, and a commit is its own ancestor; `for-each-ref <name>` matches that ref and the refs
  below `<name>/`, never `<name>-x`, and sorts by bytes (`设` U+8BBE, then `ｚ` U+FF5A, then `😀`); git
  refuses `refs/heads/a/b` beside `refs/heads/a`; `fast-import` keeps an empty name, a leading space, two
  spaces before `<`, a CR and a NUL in a message, and the offset `-0000`, and refuses the offset `+9999`;
  `cat-file --batch` answers `<id> missing` for an unknown id; `check-ref-format` answers as the table under
  "The values" says.
- OpenTelemetry's VCS attribute registry, fetched
  (https://opentelemetry.io/docs/specs/semconv/registry/attributes/vcs/): `vcs.ref.head.revision`,
  `vcs.ref.base.revision`, `vcs.ref.head.name` and the rest. None names a walk, a count, an ancestor answer
  or a ref prefix.

## How others do it

- **git's own plumbing** is the known way to read a store with no working copy: `cat-file --batch` for
  objects with their sizes, `for-each-ref` for refs, `rev-list A --not B` for a walk, `merge-base --all`
  and `merge-base --is-ancestor`. Each reads the object store and never HEAD. Run by hand above.
- **libgit2**: `git_revwalk_push` and `git_revwalk_hide` (include these, exclude those),
  `git_merge_bases`, `git_graph_descendant_of`, and a commit with parents, `git_signature` author and
  committer (name, email, time with its offset), message. From memory, not fetched.
- **JGit**: `RevWalk.markStart` and `markUninteresting`, `RevFilter.MERGE_BASE`, `PersonIdent`. From
  memory, not fetched.
- **go-git**: `object.Commit` with `Author` and `Committer` `Signature`s, `MergeBase`, `IsAncestor`. From
  memory, not fetched.
- **isomorphic-git** (git in JavaScript): `readCommit`, `log`, `findMergeBase`, and `isDescendent`, which
  fails with `MaxDepthError` instead of guessing in a shallow clone. That is the owner's "never a guess".
  From memory, not fetched.
- **Effect**: `ChildProcessSpawner.make(spawn)` takes the one call an adapter must write and derives the
  rest; `Repository.make` does the same for the span and the time limit. `effect/process` is how Effect
  code runs a program, and `@effect/platform-node`'s `NodeServices.layer` provides it at the top.
- **Elm and Erlang/OTP** have nothing to say here: no state lives between calls, so no process and no
  update loop.

## The shape

### The package

```text
kalfa/git/
  package.json          @kalfa/git, private; exports below; effect a peer, @effect/vitest and vitest optional peers
  README.md             what the store is, the five calls, the two adapters, the laws, what it never does
  GLOSSARY.md           exists; gains the terms under Records
  tsconfig.json         as kalfa/ci's
  src/
    CommitId.ts         CommitId, the one length check, from
    Ref.ts              RefName, BranchName, Ref, from, toRef, fromRef
    Commit.ts           Offset, Time, Signature, Commit
    Settings.ts         Limits, Settings
    Repository.ts       the Repository service (contract only), the errors, make
    MemoryRepository.ts Store, empty, commit, add, point, MemoryStore, layer
    ProcessRepository.ts layer: the git binary through ChildProcessSpawner
    internal/object.ts  git's commit object bytes, for /memory's ids
    internal/parse.ts   reads cat-file, for-each-ref and git version output
    HistoryTest.ts      the history value and its generators (exported in /test)
    RepositoryTest.ts   the shared laws, RepositoryTest.suite (exported in /test)
```

```jsonc
// kalfa/git/package.json, a sketch.
{
  "name": "@kalfa/git", "version": "0.0.0", "private": true, "type": "module",
  "scripts": { "typecheck": "tsc --noEmit" },
  "exports": {
    "./CommitId": "./src/CommitId.ts", "./Ref": "./src/Ref.ts", "./Commit": "./src/Commit.ts",
    "./Settings": "./src/Settings.ts", "./Repository": "./src/Repository.ts",
    "./memory": "./src/MemoryRepository.ts", "./process": "./src/ProcessRepository.ts",
    "./test": "./src/RepositoryTest.ts", "./test/History": "./src/HistoryTest.ts",
    "./package.json": "./package.json"
  },
  "peerDependencies": { "effect": "catalog:", "@effect/vitest": "catalog:", "vitest": "catalog:" },
  "peerDependenciesMeta": { "@effect/vitest": { "optional": true }, "vitest": { "optional": true } },
  "devDependencies": { "@effect/platform-node, @effect/vitest, @types/node, effect, typescript, vitest": "catalog:" },
  "engines": { "node": ">=26" }
}
```

No `dependencies`, no `@kampus/vitest`, no `fast-check`: generators use Effect's own `Arbitrary`, so `/test`
needs nothing but Effect and `@effect/vitest`. `@effect/vitest` is an optional peer, needed only by
`/test`, as decision 0048 makes a vendor SDK an optional peer of the entry point that uses it. No build
step and no `publishConfig` (call below): `kalfa/ci`, `kalfa/quality` and `kalfa/records` ship none.

### The values

```ts
// kalfa/git/src/CommitId.ts, a sketch. Doc blocks left out.
// The one place an object id's length lives. sha-256 adds `sha256: 64` here, and nothing else changes.
const FORMATS = { sha1: 40 } as const;
const ID = new RegExp(`^(?:${Object.values(FORMATS).map((n) => `[0-9a-f]{${n}}`).join("|")})$`);
export const CommitId = Schema.String.check(Schema.isPattern(ID)).pipe(Schema.brand("@kalfa/git/CommitId"));
export type CommitId = typeof CommitId.Type;
export class BadCommitId extends Schema.TaggedError<BadCommitId>()("BadCommitId", { text: Schema.String }) {}
export const from: (text: string) => Result.Result<CommitId, BadCommitId>;   // lowercase hex only
```

```ts
// kalfa/git/src/Ref.ts, a sketch.
// git check-ref-format, written out: starts "refs/", has two parts or more; no part empty, ".", "..", starting
// with ".", or ending ".lock"; no "..", "@{", "//"; not ending "/" or "."; no control character (U+0000 to
// U+001F, U+007F), space, "~ ^ : ? * [ \"; well-formed UTF-16 (a lone surrogate has no UTF-8 bytes).
export const RefName = Schema.String.check(Schema.makeFilter(isRefName, { title: "a git ref name" }))
  .pipe(Schema.brand("@kalfa/git/RefName"));
// A branch name: "refs/heads/" + it is a RefName, it does not start with "-", and it is not "HEAD".
export const BranchName = Schema.String.check(Schema.makeFilter(isBranchName, { title: "a git branch name" }))
  .pipe(Schema.brand("@kalfa/git/BranchName"));
export class Ref extends Schema.Class<Ref>("@kalfa/git/Ref")({ name: RefName, commit: CommitId }) {}
export class BadRefName extends Schema.TaggedError<BadRefName>()("BadRefName", { text: Schema.String }) {}
export class BadBranchName extends Schema.TaggedError<BadBranchName>()("BadBranchName", { text: Schema.String }) {}
export const from: (text: string) => Result.Result<RefName, BadRefName>;
export const branch: (text: string) => Result.Result<BranchName, BadBranchName>;
export const toRef: (name: BranchName) => RefName;                        // "main" -> "refs/heads/main"
export const fromRef: (name: RefName) => Option.Option<BranchName>;       // none outside refs/heads/
```

git 2.40.1's `check-ref-format` on the cases this rule writes out, as run above: refused `refs/heads/.x`,
`refs/heads/a b`, a tab, a line break, `a..b`, `a.lock`, `x.lock/y`, `a.`, `a@{b`, `@{`, `@`, `//a`, `a/`,
`/refs/heads/a`, `~ ^ : ? * [ \`, DEL, `.` and `..` parts, and `refs` alone; accepted `设`, `😀`,
``#%+,=!$&;<>|"`{}]``, `refs/heads/@`, `a@b`, `refs/heads`, `refs/kalfa/candidates/01J`, `refs/heads/HEAD` and
`refs/heads/-x`. As a branch, `HEAD` and `-x` are refused. The tests step records this list again with its
own run as the `vector:` file of law G2.

```ts
// kalfa/git/src/Commit.ts, a sketch.
// git writes a time as seconds and an offset, "+0530". The offset is kept as git wrote it: "-0000" and
// "+0000" are two values, and a commit's id depends on which one (fact lost otherwise, below).
export const Offset = Schema.String.check(Schema.isPattern(/^[+-][0-9]{2}[0-5][0-9]$/));
export const Time = Schema.Struct({ seconds: Schema.Int.check(Schema.isBetween(0, Number.MAX_SAFE_INTEGER)), offset: Offset });
// What git's commit format can hold: no "<", ">" or line break in a name; no ">" or line break in an email.
export class Signature extends Schema.Class<Signature>("@kalfa/git/Signature")({ name: Name, email: Email, at: Time }) {}
export class Commit extends Schema.Class<Commit>("@kalfa/git/Commit")({
  id: CommitId,
  parents: Schema.Array(CommitId),   // in git's order: a merge commit's first parent is first
  author: Signature,
  committer: Signature,
  message: Schema.String,            // byte for byte after the blank line: no trim, trailing newline kept
}) {}
```

`Commit` has no `tree` yet (call below): ticket 1934 adds `tree: TreeId` when it merges trees.

### Settings

```ts
// kalfa/git/src/Settings.ts, a sketch. Required, no defaults: the app gives every value where it builds the layer.
const Count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1));
export const Limits = Schema.Struct({
  commits: Count,          // the most commits one walk, or one merge-base answer, holds
  refs: Count,             // the most refs one readRefs answer holds
  bytes: Count,            // the most bytes one commit object holds, and the most stderr an error keeps
  time: Schema.Duration,   // the longest one call may take
});
export const Settings = Schema.Struct({ limits: Limits });   // 1934 adds committer, 1940 the refs that keep their commits
```

### Repository.ts

```ts
// kalfa/git/src/Repository.ts, a sketch.
export class NoSuchCommit extends Schema.TaggedError<NoSuchCommit>()("NoSuchCommit", { id: CommitId }) {}       // missing, or not a commit
export class RefNotCommit extends Schema.TaggedError<RefNotCommit>()("RefNotCommit", {
  ref: RefName, points: Schema.Literals(["symbolic", "tag", "tree", "blob"]) }) {}
export class UnreadableCommit extends Schema.TaggedError<UnreadableCommit>()("UnreadableCommit", {
  id: CommitId, reason: Schema.Literals(["message", "author", "committer", "header"]) }) {}   // e.g. a message not in UTF-8
export class HistoryTooShort extends Schema.TaggedError<HistoryTooShort>()("HistoryTooShort", {}) {}
export class TooMany extends Schema.TaggedError<TooMany>()("TooMany", { limit: Schema.Literals(["commits", "refs"]), most: Schema.Int }) {}
export class TooLarge extends Schema.TaggedError<TooLarge>()("TooLarge", { id: CommitId, most: Schema.Int }) {}
export class TimedOut extends Schema.TaggedError<TimedOut>()("TimedOut", { after: Schema.Duration }) {}
// git could not answer. The reason says how, as issue 1870's `<Package>Unavailable` does.
export class NotStarted extends Schema.TaggedError<NotStarted>()("NotStarted", { cause: Schema.Defect() }) {}
export class Exited extends Schema.TaggedError<Exited>()("Exited", { code: Schema.Int, stderr: Schema.String }) {}
export class Unreadable extends Schema.TaggedError<Unreadable>()("Unreadable", { cause: Schema.Defect() }) {}
export class GitUnavailable extends Schema.TaggedError<GitUnavailable>()("GitUnavailable", {
  reason: Schema.Union([NotStarted, Exited, Unreadable]) }) {}
// Only when a layer is built:
export class GitTooOld extends Schema.TaggedError<GitTooOld>()("GitTooOld", { found: Schema.String }) {}
export class NoRepository extends Schema.TaggedError<NoRepository>()("NoRepository", { path: Schema.String }) {}

type Fails = GitUnavailable | TimedOut;
export class Repository extends Context.Service<Repository, {
  readonly readCommit: (id: CommitId) => Effect.Effect<Commit, NoSuchCommit | TooLarge | UnreadableCommit | Fails>;
  readonly readRefs: (under: RefName) => Effect.Effect<ReadonlyArray<Ref>, TooMany | RefNotCommit | Fails>;
  readonly walk: (range: { readonly include: NonEmptyReadonlyArray<CommitId>; readonly exclude: ReadonlyArray<CommitId> })
    => Effect.Effect<ReadonlyArray<Commit>, NoSuchCommit | TooMany | TooLarge | UnreadableCommit | HistoryTooShort | Fails>;
  readonly mergeBases: (a: CommitId, b: CommitId) => Effect.Effect<ReadonlyArray<CommitId>, NoSuchCommit | TooMany | HistoryTooShort | Fails>;
  readonly isAncestor: (ancestor: CommitId, of: CommitId) => Effect.Effect<boolean, NoSuchCommit | HistoryTooShort | Fails>;
}>()("@kalfa/git/Repository") {}

// Wraps an adapter's five calls: one span each, named git.<call>, and the time limit. Every adapter in
// this package builds its service with it, and /test's span law holds any other adapter to the same.
export const make: (raw: Repository["Service"], settings: Settings) => Repository["Service"];
```

What each call answers:

- **readCommit(id)**: the commit, or `NoSuchCommit` when the store has no commit with that id (missing, or
  an id of a tree, a blob or a tag).
- **readRefs(under)**: the ref `under` and every ref below `under/`, sorted by their UTF-8 bytes, as git
  sorts. `[]` means git proved there is none. `refs/heads/main` reads one branch; `refs/kalfa/candidates`
  reads every candidate ref. A ref that only shares text (`refs/heads/main-2`) is not below it.
- **walk({ include, exclude })**: every commit an `include` commit reaches, itself included, that no
  `exclude` commit reaches, oldest first: each commit comes after its parents. For a line of commits with no
  merge the order is the one order there is. `[]` means git proved there is none.
- **mergeBases(a, b)**: the best common ancestors, sorted by id. `[]` means the two have no common history.
- **isAncestor(ancestor, of)**: whether `of` reaches `ancestor`. A commit is its own ancestor, as git says.
- **A shallow repository**: `walk`, `mergeBases` and `isAncestor` fail with `HistoryTooShort`, since a
  shallow commit hides its parents and the answer could be a guess. `readCommit` and `readRefs` read no
  history, so they answer.
- **Limits**: a walk or a merge-base answer past `limits.commits`, or a refs answer past `limits.refs`,
  fails with `TooMany`; a commit object past `limits.bytes` fails with `TooLarge`. Never a cut answer.

### The spans (decision 0063)

`make` wraps each call in `Effect.fn("git.<call>")`. Attributes: OpenTelemetry's first, `kalfa.git.*` only
where the registry has no name.

| Call | Span | Attributes |
|---|---|---|
| readCommit | `git.readCommit` | `vcs.ref.head.revision` = the id |
| readRefs | `git.readRefs` | `kalfa.git.under` = the ref name asked, `kalfa.git.refs` = how many answered |
| walk | `git.walk` | `kalfa.git.include`, `kalfa.git.exclude` (lists of ids), `kalfa.git.commits` = how many answered |
| mergeBases | `git.mergeBases` | `vcs.ref.head.revision` = a, `vcs.ref.base.revision` = b, `kalfa.git.bases` = how many |
| isAncestor | `git.isAncestor` | `vcs.ref.base.revision` = ancestor, `vcs.ref.head.revision` = of, `kalfa.git.ancestor` = the answer |
| `/process` layer build | `git.open` | `kalfa.git.version` = the version git printed |

No message, name or email is ever an attribute (0063 keeps message text out), and the repository path is
not either: it can hold a login name. The package imports no Telemetry, so the spans go wherever the
running program's tracer sends them (decisions 0063 and 0079).

### /memory

```ts
// kalfa/git/src/MemoryRepository.ts, a sketch.
export interface Store {
  readonly commits: ReadonlyMap<CommitId, Commit>;
  readonly refs: ReadonlyMap<RefName, CommitId>;
  readonly shallow: ReadonlySet<CommitId>;     // commits whose parents this store lacks, as git's shallow file
}
export const empty: Store;
// Builds a commit and computes its id as git does: sha-1 of "commit <size>\0" and the object's bytes, with
// git's empty tree (4b825dc642cb6eb9a060e54bf8d69288fbee4904) until 1934 adds trees.
export const commit: (fields: Omit<Commit, "id">) => Effect.Effect<Commit, never, Digest.Digest>;
export class BadStore extends Schema.TaggedError<BadStore>()("BadStore", {
  reason: Schema.Literals(["missing-parent", "missing-commit", "ref-conflict"]) }) {}
export const add: (store: Store, commit: Commit) => Result.Result<Store, BadStore>;            // its parents are in the store or it is shallow
export const point: (store: Store, ref: RefName, id: CommitId) => Result.Result<Store, BadStore>; // git's rule: refs/heads/a and refs/heads/a/b never both
export class MemoryStore extends Context.Service<MemoryStore, {
  readonly get: Effect.Effect<Store>;
  readonly set: (store: Store) => Effect.Effect<void>;   // a test moves a ref between two reads
}>()("@kalfa/git/MemoryStore") {}
export const layer: (store: Store, settings: Settings) => Layer.Layer<Repository | MemoryStore>;
```

`Digest` is Effect's service; a test provides `Digest.layerWebCrypto`, which runs on `crypto.subtle`. The
read calls never hash, so the layer itself needs nothing. The store holds what git's format can hold and
nothing else: a message is a `string`, so a commit that is not UTF-8 cannot be put in memory, and law I2
covers that case on real git alone.

### /process

```ts
// kalfa/git/src/ProcessRepository.ts, a sketch.
export const layer: (options: { readonly path: string; readonly settings: Settings })
  => Layer.Layer<Repository, GitTooOld | NoRepository | GitUnavailable | TimedOut, ChildProcessSpawner.ChildProcessSpawner>;
```

- **Every command** is `git --no-replace-objects --git-dir=<path> -c core.hooksPath=/dev/null -c
  gc.auto=0 -c maintenance.auto=false <plumbing>`, with `extendEnv: false` and an `env` of PATH (read
  through Effect's `Config`, never `process.env`) plus a pinned set: `GIT_CONFIG_NOSYSTEM=1`,
  `GIT_CONFIG_GLOBAL=/dev/null`, `GIT_CONFIG_SYSTEM=/dev/null`, `GIT_ATTR_NOSYSTEM=1`,
  `GIT_TERMINAL_PROMPT=0`, `GIT_OPTIONAL_LOCKS=0`, `GIT_NO_REPLACE_OBJECTS=1`, `LC_ALL=C`. No inherited
  `GIT_DIR`, `GIT_OBJECT_DIRECTORY`, `GIT_TRACE` or any other `GIT_` variable reaches git. `--git-dir`
  means git never looks for a repository around the path.
- **Opening** runs `git version` (2.38 or newer, else `GitTooOld { found }`; the version is read as
  numbers, so 2.100 is newer than 2.38 and 10.0 newer than 2.x) and `rev-parse --git-dir` (else
  `NoRepository`). Apple's "2.39.3 (Apple Git-145)" and "2.41.0.windows.1" read as their numbers.
- **Before a call that names commits**, one `cat-file --batch-check` on the named ids: `missing` or a type
  other than `commit` is `NoSuchCommit`. So an exit code of 128 later is always `GitUnavailable`, and no
  stderr text is ever read for meaning (it is in the user's language on some machines; `LC_ALL=C` helps,
  but nothing depends on it).
- **Before a call that walks**, `rev-parse --is-shallow-repository`: `true` is `HistoryTooShort`.
- **readCommit and walk** read objects with `cat-file --batch-check` (sizes first: past `limits.bytes` is
  `TooLarge`, before any object is read) then `cat-file --batch`, parsed by `internal/parse.ts`.
- **walk** lists ids with `rev-list --topo-order --reverse --max-count=<commits + 1> <include> --not
  <exclude>`: `commits + 1` lines is `TooMany`.
- **readRefs** is `for-each-ref --count=<refs + 1> --format=%(objectname) %(objecttype) %(symref)
  %(refname) <under>`: a type other than `commit` or a non-empty `%(symref)` is `RefNotCommit`.
- **mergeBases** is `merge-base --all a b`: exit 0 with ids, exit 1 with no output is `[]`, anything else
  is `GitUnavailable`. **isAncestor** is `merge-base --is-ancestor`: 0 is true, 1 is false, anything else
  is `GitUnavailable`, never false.
- **Output** is read with stderr drained beside stdout, so a full pipe never stalls git. An error keeps at
  most `limits.bytes` of stderr. A time limit ends the call through `make`; the spawner's scope then ends
  the child.

### Which entry may import what, and what holds it

No file in the package imports a Node module, `/process` included. `/process` reaches the git binary
through `effect/process` (`ChildProcess`, `ChildProcessSpawner`), and the app provides the Node
implementation at the top with `NodeServices.layer` from `@effect/platform-node`, as `kalfa/AGENTS.md` says
("Join Layers at the top"). Only test files import `@effect/platform-node`. Only
`ProcessRepository.ts` imports `effect/process`.

Nothing in the repo holds that today: `fabrika/no-node-imports` and `fabrika/no-ledger-sql` return no
checks outside `next/` and `.agents/` (`heldToNext`), so they check nothing under `kalfa/` (app tracker
ticket 1250). So the rows that hold it are new, in `.oxlintrc.json`, after `@kalfa/quality`'s blocks. An
override replaces a rule's options, so each repeats the base `no-restricted-imports` and
`no-restricted-globals` entries and adds its own. Every pattern that means "and below" ends in `/**`,
never `/*` (app tracker ticket 1247).

- **Override A**, files `kalfa/git/src/**`, leaving out `**/*.test.ts`, `**/*Test.ts`,
  `**/*.test-support.ts` and `kalfa/git/src/ProcessRepository.ts`, refuses:
  - other packages: `@kalfa/**`, `@kampus/**`, `@tea-fabrika/**`, `**/next/**`, `../../**`;
  - Node, both spellings: the groups `node:*` and `node:*/**`, and every bare name in Node's
    `builtinModules` at the pinned Node, written out (the tests step reads the list once);
  - the Node layer and test tools: `@effect/platform-node`, `@effect/platform-node/**`, `@effect/vitest`,
    `@effect/vitest/**`, `vitest`, `vitest/**`, `fast-check`;
  - spawning: `effect/process`, `effect/process/**`;
  - globals (`eslint/no-restricted-globals`): `process`, `console`, `globalThis`, `global`, `self`,
    `window`; and `eslint/no-console`.
- **Override B**, files `kalfa/git/src/ProcessRepository.ts`: the same list without `effect/process`.
- The same folder joins the files of `kalfa/config`'s Effect block (`no-promises`, `effect-functions`,
  `written-service-type`, `no-hand-tag` and the rest). Its `no-node-imports` and `no-ledger-sql` lines then
  do nothing here, and the plan counts on neither.
- The rank: a `kalfa-git` row in `layer-rules.json` with `layer: 0`, `imports: []` and
  `paths: ["kalfa/git/src"]`, listed after `next-vitest` (a row with no `layer` ranks under the ranked row
  above it, so a row right after `kalfa-config` would push `next-id-test-support` under layer 0), and
  `kalfa/git/src` in `roots`; in `boundary-rules.json`, `"kalfa-git": { "imports": [], "pure": false }` and
  `"kalfa/git": "kalfa-git"`. `pure: true` is not used: the file has no `testFiles` key, so the
  integration law's own temp folders would fail it.
- `kalfa/AGENTS.md`'s "No import cycles" bullet gains: Source control (`@kalfa/git`) imports no kalfa
  package and ranks lowest; CI, Code hosting, Delivery and Reconciliation rank above it.

If the diagnostics pull request lands first, the same files change there too (`.oxlintrc.json`, both rule
files, the root `package.json`, the lockfile): the second to land rebases, and its row goes after
`kalfa-diagnostics`.

## Every caller's need, traced

The ticket asks that every call the callers named be traced to a raw call or a helper. "Here" is this
ticket.

| Caller and need | Call | Where |
|---|---|---|
| Delivery: read main's commit after a fetch | `readRefs("refs/heads/main")`, after `fetch` | here; fetch 1938 |
| Delivery: after a crash, does main already hold the candidate | `isAncestor(candidate, main)` | here |
| Delivery ruling 17: a queued change request main already holds; main moved by another hand, or backward | `readRefs`, `isAncestor` | here |
| Delivery: the base a change request's branch sits on | `mergeBases(branch, main)` | here |
| Delivery: the branch's own commits, whether one is a merge commit, their authors in order (squash's co-authors, decision 0071) | `walk` (Commits with parents and author, oldest first) | here |
| Delivery: the carry rule | patch id of a range | 1933 |
| Delivery: a merge commit candidate, its conflict files | merge trees, write a commit, move a ref | 1934 |
| Delivery: rebase and stacked candidates; squash | rebase; squash | 1936; 1937 |
| Delivery: push main, a change request's branch with a lease and back, a fork by URL, a candidate ref and its delete | push plan, pre-push hook, push, send | 1939, 1940 |
| Delivery, CI, Code hosting: the commit id and branch names they import | `CommitId`, `BranchName`, `RefName` | here |
| CI: the full ref a pattern matches, such as `refs/heads/main` | `RefName` | here |
| Reconciliation: the app's check reads the kalfa config at main | `readRefs`, then read a file | here; 1935 |
| Reconciliation: the command's reconcile fetches the target branch | fetch | 1938 |
| Reconciliation: adopt commits an edit on a branch and sends it | commit an edit; push | 1935; 1940 |
| Code hosting `/git`: fill the credential slot | the credential slot | 1938 |

No need is left without a call, so no new ticket. Two notes for siblings, already in their text: 1938's
fetch must take refs outside the branches (Delivery's candidate refs), and 1937 reads authors through this
ticket's `walk`.

## One value traced: a branch's own commits

The store: `M1` then `M2` on `refs/heads/main`; `B1` (parent `M1`) then `B2` on `refs/heads/feature`.
Limits: `commits` 100, `refs` 100, `bytes` 1000000, `time` 10 seconds.

1. `repo.readRefs("refs/heads/main")`. `/process` runs `for-each-ref --count=101 ... refs/heads/main`: one
   line, type `commit`, no symref. Answer `[Ref { name: "refs/heads/main", commit: M2 }]`. Span
   `git.readRefs` with `kalfa.git.under` = `refs/heads/main` and `kalfa.git.refs` = 1.
2. `repo.walk({ include: [B2], exclude: [M2] })`. `cat-file --batch-check` on `B2` and `M2`: both
   `commit`. `rev-parse --is-shallow-repository`: `false`. `rev-list --topo-order --reverse --max-count=101
   B2 --not M2`: `B1`, `B2`, two lines, under the limit. `cat-file --batch-check`: both under 1000000
   bytes. `cat-file --batch`: two objects, parsed. Answer `[Commit B1, Commit B2]`, oldest first. Span
   `git.walk`: `kalfa.git.include` = [B2], `kalfa.git.exclude` = [M2], `kalfa.git.commits` = 2, and no
   attribute holds either message or any name or email.
3. `repo.mergeBases(B2, M2)`: `merge-base --all` exits 0 with `M1`. Answer `[M1]`.
4. `repo.isAncestor(B2, M2)`: exit 1. Answer `false`. Delivery knows main does not hold the branch yet.
5. `/memory` with the same store answers the same four values, with the same ids: each id was computed
   from the commit's bytes as git computes it.
6. The same walk with `commits: 1`: `rev-list` prints two lines (`--max-count=2`), so the call fails with
   `TooMany { limit: "commits", most: 1 }`, never with `[B1]`.
7. The same walk after a shallow fetch that cut `M1`'s parents: `HistoryTooShort`, never a guess.

## What fact is lost if not recorded now

The package stores nothing of its own. What its values must keep, so nothing is lost on the way through:

- **The offset as git wrote it, `-0000` included, and the message byte for byte.** A `Commit` that turned
  the offset into a number or trimmed the message would lose them, and rebase (1936) and squash (1937) keep
  each commit's author as read. `Time` keeps the offset as text and `message` is untrimmed.
- **A parent's position.** A merge commit's first parent is the line it was made on; `parents` keeps git's
  order.
- **The git version found** goes in the `git.open` span, so a failure on an old git can be read later.

## Laws

Laws use `it.prop` and `it.effect.prop` from `@effect/vitest` 4.1.3, with inputs from Effect's own
`Arbitrary`. The shared generators live in `kalfa/git/src/HistoryTest.ts`, exported in `/test`.

**A generator's reach is part of its law.** Each class listed below is checked in every run, not left to
chance: each run takes its drawn value and also checks one made from it for each class, so a missing class
fails loudly. Each class has a plant that a generator without it would let pass.

- **refName (accept)**: parts holding characters past U+024F, both in the Basic Multilingual Plane (`设`)
  and outside it (`😀`), and characters from U+E000 to U+FFFF (`ｚ`), which sort apart from those outside it
  in JavaScript but not in bytes; every ASCII mark git allows (``!"#$%&'()+,-;<=>@]_`{|}``); a lone `@` part
  and `@` inside a part; a dot inside a part; a part starting with `-`; a part `HEAD`; long text (a part of
  200 bytes, ten parts deep, past 1000 characters in all); names outside the branches
  (`refs/kalfa/candidates/<id>`, `refs/remotes/origin/x`, `refs/tags/x`).
- **refName (refuse)**: each break applied to each good name: a part starting with a dot, a part `.` or
  `..`, a space, a tab, a line break (`\n` and `\r`), every other control character and DEL, each of
  `~ ^ : ? * [ \`, `..`, `@{`, the name `@`, a part ending `.lock`, an empty part (`//`), a leading or
  trailing `/`, a trailing `.`, a lone surrogate, the empty text, `refs` alone, and a name not under
  `refs/`.
- **branchName**: refName's classes under `refs/heads/`, plus a leading `-`, `HEAD`, and the trap
  `refs/heads/x` (a valid branch name, whose ref is `refs/heads/refs/heads/x`).
- **commitId**: 40 lowercase hex accepted; refused: 39 and 41 characters, 64 (a sha-256 id), uppercase hex,
  a non-hex letter, a leading or trailing space, a line break, `0x` in front, the empty text, and digits
  that are not ASCII (`٠`, `０`).
- **message**: empty; no trailing newline; one and several trailing newlines; leading blank lines; CRLF and
  a lone CR; a tab; a NUL; characters past U+024F in and outside the Basic Multilingual Plane; long text
  (past 10000 characters); a line that looks like a header (`parent <id>`, `gpgsig`).
- **signature**: an empty name; a name with a space at its start, inside and at its end; a tab inside; an
  empty email; an email with a space; characters past U+024F in and outside the Basic Multilingual Plane;
  long text (past 200 characters); seconds 0 and past 2^32; offsets `+0000`, `-0000`, `+0530`, `+0545`,
  `-1200`, `+1400`.
- **history**: an empty store; one root; a line of up to 30 commits; a branch and its merge back; an
  octopus merge of 3 to 5 parents; a criss-cross (two merge bases); two and three unrelated roots; a merge
  whose parents come in the other order; a commit that is the parent of many; committer dates that go
  backward from parent to child (clock skew); and refs drawn from refName's accept classes, with parts up to
  200 bytes (a loose ref is a file, and a file name stops at 255 bytes), never two refs where one is a path
  prefix of the other. Two commits with the same fields would get one id, so each message gets a number.
- **range**: include and exclude drawn from the history: an exclude that reaches every include (answer
  `[]`), an include an exclude reaches, include equal to exclude, an empty exclude, several includes
  sharing history, and an id not in the store on either side.
- **limits**: an answer of exactly the limit (it passes) and one more (it fails), for commits, refs and
  bytes.

| Law | Kind (lint, type or test?) | Generator | Plant | Where |
|---|---|---|---|---|
| G1, commit ids: `CommitId.from` accepts every id commitId's accept class draws and refuses each refuse class with `BadCommitId` holding the text; the 64-character id is refused. 200 runs | test | Effect Arbitrary: commitId | allow `{40}\|{64}`: red; add the `i` flag: red; trim before checking: red | kalfa/git/src/Values.test.ts |
| G2, ref names agree with git: `Ref.from` accepts refName's accept class and refuses each refuse class with `BadRefName`; 200 runs. And it gives git's answer on every row of a list recorded from a real `git check-ref-format` run | test | Effect Arbitrary: refName | per class, each a wrong rule in `Ref.ts`: allow a part starting with `.`: red; allow a space, a tab or a line break: red; refuse any character past U+024F: red; cap a name at 255 characters: red; let `.lock` through inside a name (`x.lock/y`): red; accept a lone surrogate: red | kalfa/git/src/Values.test.ts |
| G2v, the recorded list: the same check against the `check-ref-format` answers, one row per name | test | vector: git 2.40.1 check-ref-format answers | accept `refs` alone: red | kalfa/git/src/Values.test.ts |
| G3, branch names: `Ref.branch` accepts branchName's accept class and refuses `-x`, `HEAD` and refName's refuse class under `refs/heads/`; `toRef` then `fromRef` gives the name back; `fromRef` of a ref outside `refs/heads/` is none; `fromRef("refs/heads/refs/heads/x")` is `refs/heads/x`. 200 runs | test | Effect Arbitrary: branchName | allow a leading `-`: red; strip every `refs/heads/` in `fromRef`: red | kalfa/git/src/Values.test.ts |
| G4, a commit's values: `Commit` and `Signature` accept every value message and signature draw and encode then decode to the same value; a name with `<`, `>` or a line break, an email with `>` or a line break, an offset `+9999` or `0530`, and fractional or negative seconds are refused. 200 runs | test | Effect Arbitrary: commitFields | per class: trim the message: red; store the offset as a number of minutes: `-0000` comes back `+0000`, red; refuse an empty name or email: red; refuse a space at either end of a name: red | kalfa/git/src/Values.test.ts |
| G5, settings: `Settings` accepts every positive whole count and positive time; refuses 0, a negative, a fraction, a missing key, and a time of zero; `{}` does not decode, so nothing has a default. 100 runs | test | Effect Arbitrary: limits | give `commits` a default: red | kalfa/git/src/Values.test.ts |
| T1, the brands: a plain string is not a `CommitId`, a `RefName` or a `BranchName`; a `BranchName` is not a `RefName` and the reverse | type | type | drop the brand on `BranchName`: an `@ts-expect-error` is unused, red | kalfa/git/src/Values.types.test.ts |
| T2, the calls' types: each method of `Repository` has exactly the answer and error union this plan's sketch gives, with `never` as its requirement; `walk({ include: [] })` does not compile | type | type | add `R = Scope` to `walk`: red; type `include` as `ReadonlyArray`: the empty-include line compiles, red | kalfa/git/src/Repository.types.test.ts |
| T3, the layers' types: `ProcessRepository.layer` is `Layer<Repository, GitTooOld \| NoRepository \| GitUnavailable \| TimedOut, ChildProcessSpawner>`; `MemoryRepository.layer` is `Layer<Repository \| MemoryStore>` | type | type | require `FileSystem` in `/process`: red | kalfa/git/src/Repository.types.test.ts |
| M1, memory's ids are git's: for each commit in a list recorded from a real `git fast-import` run (its fields and the id git gave it), `MemoryRepository.commit` computes that id | test | vector: git 2.40.1 fast-import marks | drop the blank line before the message: red; write the offset as `+0000` for `-0000`: red; put the parents in sorted order: red | kalfa/git/src/MemoryRepository.test.ts |
| M2, memory's store refuses what git refuses: `add` of a commit whose parent is missing and not shallow, `point` at a missing commit, and `point` of `refs/heads/a/b` beside `refs/heads/a` (either order) each fail with `BadStore` and its reason; everything history draws builds. 100 runs | test | Effect Arbitrary: history | let a ref and a ref below it both in: red | kalfa/git/src/MemoryRepository.test.ts |
| S1, read back: for a generated history seeded into the adapter, `readCommit` of each commit gives its parents in order, author, committer and message, byte for byte. memory 100 runs, process 10 | test | Effect Arbitrary: history | each of G4's plants turns this red too; and, in `/process`, take the name up to the last space before `<`: a name with a trailing space comes back short, red | kalfa/git/src/RepositoryTest.ts |
| S2, unknown and wrong-type ids: `readCommit`, `walk` (either side), `mergeBases` and `isAncestor` with an id the store does not hold fail with `NoSuchCommit` naming it, never `[]` or `false`. memory 100 runs, process 10 | test | Effect Arbitrary: range | answer `false` for an unknown id in `isAncestor`: red; drop unknown excludes: red | kalfa/git/src/RepositoryTest.ts |
| S3, refs: `readRefs(under)` answers exactly the seeded refs equal to `under` or below `under/`, each with its commit, sorted by UTF-8 bytes; a ref that only shares text is not in it; `[]` when there is none. memory 100 runs, process 10 | test | Effect Arbitrary: history | sort with JavaScript's `<`: refName's U+E000 to U+FFFF class against its astral class, red; match by text prefix: `refs/heads/main-2` comes in, red | kalfa/git/src/RepositoryTest.ts |
| S4, walk: the answer's set is what the history model says include reaches and exclude does not, each commit comes after its parents, a line of commits comes in its one order, and each entry equals `readCommit` of its id. memory 100 runs, process 10 | test | Effect Arbitrary: range | answer newest first: red; leave out the include commits themselves: red; stop at the first merge: red | kalfa/git/src/RepositoryTest.ts |
| S5, merge bases: `mergeBases(a, b)` is the model's best common ancestors, sorted by id, the same for `(b, a)`; `[]` for unrelated roots; `[a]` when `a` is an ancestor of `b`; both bases of a criss-cross. memory 100 runs, process 10 | test | Effect Arbitrary: history | answer every common ancestor, not only the best: red; keep only one of a criss-cross's two: red | kalfa/git/src/RepositoryTest.ts |
| S6, ancestors: `isAncestor(x, y)` is the model's reachability; `isAncestor(x, x)` is true; unrelated is false; two different commits are never each other's ancestor. memory 100 runs, process 10 | test | Effect Arbitrary: history | answer false for `x, x`: red | kalfa/git/src/RepositoryTest.ts |
| S7, limits never cut: with each limit drawn at an answer's exact size the call answers; at one less it fails with `TooMany` (commits for walk and merge bases, refs for readRefs) or `TooLarge` (a commit object one byte over, in readCommit and walk), never a shorter answer. memory 100 runs, process 10 | test | Effect Arbitrary: limits | answer the first `commits` items: red; count `>=` for `>`: the exact-size answer fails, red | kalfa/git/src/RepositoryTest.ts |
| S8, shallow: in a store with a shallow commit, `walk`, `mergeBases` and `isAncestor` fail with `HistoryTooShort`; `readCommit` and `readRefs` answer as in S1 and S3. memory 100 runs, process 10 | test | Effect Arbitrary: history | answer the walk from what is there: red; fail `readRefs` too: red | kalfa/git/src/RepositoryTest.ts |
| S9, spans: under a recording tracer (`Tracer.make` with `Effect.withTracer`), each call ends exactly one span named `git.<call>`, with the attributes the spans table gives; no attribute value equals or holds any seeded message, name or email, and no key is a bare `id`, `ref` or `count`. memory 100 runs, process 10 | test | Effect Arbitrary: history | name a span `Repository.walk`: red; annotate the author's name: red; put the walk's ids under a bare `include`: red | kalfa/git/src/RepositoryTest.ts |
| S10, no working copy: the service's keys are exactly `readCommit`, `readRefs`, `walk`, `mergeBases`, `isAncestor`; after any drawn list of calls the store is as it was (memory: the same `Store` value; process: the same `for-each-ref` output and object count) | test | Effect Arbitrary: history | add a `head` key: red; let `readRefs` pack refs: the object count changes, red | kalfa/git/src/RepositoryTest.ts |
| P1, git's output read right: `internal/parse.ts` reads every object in a `cat-file --batch` file and every line of a `for-each-ref` file recorded from real git, each to the value the file's note gives: an empty name, a leading space, two spaces before `<`, `-0000`, CR and NUL in a message, astral characters, a merge commit's parent order, a `tag`, `tree` and `blob` type and a symbolic ref (`RefNotCommit` with `points`), and a message in latin-1 (`UnreadableCommit`, reason `message`) | test | vector: git 2.40.1 cat-file and for-each-ref output | decode the message with a decoder that replaces bad bytes: the latin-1 row passes as text, red; drop `%(symref)`: red | kalfa/git/src/internal/parse.test.ts |
| P2, exit codes: on a stand-in spawner, `isAncestor` answers true for 0 and false for 1; `mergeBases` answers `[]` for 1 with no output; every other code (2 to 255) is `GitUnavailable` with reason `Exited` holding the code, never `false` or `[]`; a spawn that fails is reason `NotStarted`; output that does not parse is reason `Unreadable`. 200 runs | test | Effect Arbitrary: exitCode | read any code but 0 as false: red; read code 1 with output as `[]`: red | kalfa/git/src/ProcessRepository.test.ts |
| P3, the time limit: on a stand-in whose child never exits, each call under `TestClock` fails with `TimedOut { after }` once the clock passes `limits.time`, and the stand-in records that its scope ended the child (a recorded call, not a real signal). 50 runs | test | Effect Arbitrary: limits | drop the timeout from `make`: the law's own guard fails it, red | kalfa/git/src/ProcessRepository.test.ts |
| P4, git's version: `git version` text of 2.38.0 and newer opens, older fails with `GitTooOld` holding the version found; minors past 100 and majors past 10 compare as numbers; Apple's and Windows' forms read as their numbers; text with no version is `GitUnavailable`. 200 runs | test | Effect Arbitrary: gitVersion | compare the version as text: `2.100.0` reads as older, red | kalfa/git/src/ProcessRepository.test.ts |
| P5, git's environment: every command the stand-in records starts `--no-replace-objects --git-dir=<path>`, runs with `extendEnv: false`, and its `env` is exactly PATH and the pinned set, while the inherited environment (an Effect `ConfigProvider` in the test) holds `GIT_DIR`, `GIT_OBJECT_DIRECTORY`, `GIT_TRACE` and generated `GIT_` names | test | Effect Arbitrary: gitEnv | `extendEnv: true`: red; drop `--no-replace-objects`: red | kalfa/git/src/ProcessRepository.test.ts |
| P6, size before reading: when `--batch-check` gives a size past `limits.bytes`, the call fails with `TooLarge` and the stand-in records no `cat-file --batch`; a `rev-list` of `commits + 1` lines is `TooMany` and no object is read. 100 runs | test | Effect Arbitrary: limits | read the objects, then check: red | kalfa/git/src/ProcessRepository.test.ts |
| I1, the shared laws on real git: S1 to S10 on `/process` over a bare repository a seeder fills with `git fast-import`, on git 2.38 or newer | test | Effect Arbitrary: history | each S law's plant, run once on `/process` | kalfa/git/src/ProcessRepository.integration.test.ts |
| I2, a commit memory cannot hold: real git with a commit whose message is latin-1 bytes under an `encoding ISO-8859-1` header: `readCommit` and a walk over it fail with `UnreadableCommit`, reason `message` | test | scenario: one fast-import commit with latin-1 bytes, since a message `string` cannot be drawn as invalid UTF-8 | decode with replacement: red | kalfa/git/src/ProcessRepository.integration.test.ts |
| I3, refs git makes that memory does not: a real annotated tag and a symbolic ref (`git symbolic-ref`) under the asked name fail `readRefs` with `RefNotCommit`, `points` `tag` and `symbolic` | test | scenario: one tag and one symbolic ref, the two kinds `for-each-ref` reports | skip refs that are not commits: red | kalfa/git/src/ProcessRepository.integration.test.ts |
| I4, opening: the layer opens on a real bare repository and puts the version in `git.open`; on a folder that is not a repository it fails with `NoRepository` | test | scenario: one bare repository and one empty folder | let `rev-parse` find a repository above the path (no `--git-dir`): the empty folder inside a checkout opens, red | kalfa/git/src/ProcessRepository.integration.test.ts |
| K1, the manifest: `kalfa/git/package.json` names no `@kalfa/`, `@kampus/` or `@tea-fabrika/` package, has no `dependencies`, has `effect` as its one required peer and `@effect/vitest` and `vitest` as optional peers, and exports exactly the list in the sketch | test | scenario: the package's own manifest at head | add `@kampus/vitest` to the dev dependencies: red | kalfa/git/src/Package.test.ts |
| K2, nothing of this repo (decision 0047): no file git tracks under `kalfa/git/` holds `fabrika`, `kampus`, `kamp-us` or `.kalfa/`, in any letter case | test | scenario: the package's tracked files at head | write `tea-fabrika` in the README: red | kalfa/git/src/Package.test.ts |
| L1, no other package: an import of `@kalfa/*`, `@kampus/*`, `@tea-fabrika/*`, `next/` or a path out of the package, in any product file under `kalfa/git/src/`, is refused | lint | lint | import `@kalfa/config/App` in `Repository.ts`: red | .oxlintrc.json |
| L2, no Node and no globals: in every product file, `ProcessRepository.ts` included, each line below is refused, one at a time, then undone | lint | lint | `import { spawn } from "node:child_process"`; `import cp from "child_process"`; `import fs from "node:fs/promises"` (a two-part path, which a `/*` pattern misses); `import { NodeServices } from "@effect/platform-node"` in `ProcessRepository.ts`; `import { it } from "@effect/vitest"` in `Repository.ts`; `globalThis.process.env.PATH`; `console.log("x")`: each red | .oxlintrc.json |
| L3, only `/process` spawns: `import { ChildProcess } from "effect/process"` in `MemoryRepository.ts` or `Repository.ts` is refused; in `ProcessRepository.ts` it passes | lint | lint | the import in `MemoryRepository.ts`: red | .oxlintrc.json |
| L4, the rank: the package imports no workspace package (`pnpm lint:boundaries`, `pnpm lint:layers`), and its row ranks at layer 0 | lint | lint | (a) import `@kalfa/config/App`: both checks red; (b) grant `"imports": ["kalfa-config"]` on the `kalfa-git` row: `lint:layers` refuses the rules file, red | layer-rules.json, boundary-rules.json |

`RepositoryTest.suite(name, subject, { runs })` registers S1 to S10. The memory runner in
`MemoryRepository.test.ts` passes 100 runs; the process runner in `ProcessRepository.integration.test.ts`
passes 10, since each run seeds a repository. A subject is a `seed: (history, settings) =>
Effect<{ layer, ids }, never, Scope>`: the memory seeder builds a `Store`, the process seeder makes a
temp bare repository, runs `git fast-import --date-format=raw` once with the whole history, reads the
marks for the ids, and writes git's `shallow` file for a shallow history.

**Where each law runs.**

- G, T, M, P, K and L laws, and S1 to S10 on `/memory`: plain files, on every pull request their change
  reaches, and on the laptop with a narrow path. T laws run under `pnpm typecheck`.
- I1 to I4 run the real git binary in temp folders. A stand-in cannot do their job: they are the proof
  that `/process` answers what `/memory` answers, and that the parser reads what real git writes. So they
  are one `*.integration.test.ts` file. `vitest.hostrun.ts` refuses that file on the laptop by name, so the
  tests and build steps write it and do not run it. It runs in CI's main full run, and in a Linux cloud box,
  where the guard allows it. No pull request run includes it (CI runs integration laws on main's full run
  only). Call, 80%: the lead runs that one file in a cloud box after the build and before the review, so
  the review reads a real run; without a box at hand, it first runs on main's full run after the merge, and
  the report says so.
- No law is host-only: none needs launchd, Electron, a real signal or the owner's Mac. The integration
  file starts git and lets it exit; a git still running when a law fails is ended by its own scope, in CI.
- No secret flows through these calls, so no law is a `[secrets]` law. Credentials come with 1938.

## Files

| File | Owner | Product lines expected | Change |
|---|---|---|---|
| kalfa/git/package.json | tests | tests | new: name, `private`, `typecheck`, exports, peers, dev dependencies. The tests step owns it with the lockfile, so its laws install and run red |
| kalfa/git/tsconfig.json | tests | tests | new: as `kalfa/ci`'s, with the Effect checks |
| kalfa/git/src/CommitId.ts | build | 45 | new: `CommitId`, `FORMATS`, `BadCommitId`, `from` |
| kalfa/git/src/Ref.ts | build | 110 | new: `RefName`, `BranchName`, `Ref`, `BadRefName`, `BadBranchName`, `from`, `branch`, `toRef`, `fromRef` |
| kalfa/git/src/Commit.ts | build | 70 | new: `Offset`, `Time`, `Signature`, `Commit` |
| kalfa/git/src/Settings.ts | build | 30 | new: `Limits`, `Settings` |
| kalfa/git/src/Repository.ts | build | 170 | new: the service, the errors, `make` (spans and time limit) |
| kalfa/git/src/MemoryRepository.ts | build | 250 | new: `Store`, `empty`, `commit`, `add`, `point`, `BadStore`, `MemoryStore`, `layer`, the five calls over the value |
| kalfa/git/src/ProcessRepository.ts | build | 250 | new: `layer`, the command runner, the environment, opening, the five calls |
| kalfa/git/src/internal/object.ts | build | 40 | new: a commit object's bytes, as git writes them |
| kalfa/git/src/internal/parse.ts | build | 120 | new: reads `cat-file --batch`, `for-each-ref` and `git version` output |
| kalfa/git/README.md | build | docs | new: the store and its five calls, the two adapters, how to run the laws on another adapter, the limits and the time limit as required settings, what the package never does (working copy, HEAD, a Node import, a span with message text) |
| kalfa/git/GLOSSARY.md | build | docs | the terms under Records |
| kalfa/AGENTS.md | build | docs | the rank sentence in "No import cycles" |
| kalfa/git/src/HistoryTest.ts | tests | tests | new: the history value, the model's answers (reach, best common ancestors), and every generator above, exported in `/test` |
| kalfa/git/src/RepositoryTest.ts | tests | tests | new: S1 to S10 and `suite`, exported in `/test` |
| kalfa/git/src/Values.test.ts | tests | tests | G1 to G5, G2v |
| kalfa/git/src/Values.types.test.ts | tests | tests | T1 |
| kalfa/git/src/Repository.types.test.ts | tests | tests | T2, T3 |
| kalfa/git/src/MemoryRepository.test.ts | tests | tests | M1, M2, and the memory runner of the suite |
| kalfa/git/src/internal/parse.test.ts | tests | tests | P1 |
| kalfa/git/src/ProcessRepository.test.ts | tests | tests | P2 to P6 |
| kalfa/git/src/StandIn.test-support.ts | tests | tests | new: a stand-in `ChildProcessSpawner` that answers from a script and records each command, its env and its scope's end |
| kalfa/git/src/ProcessRepository.integration.test.ts | tests | tests | I1 to I4, and the process runner of the suite |
| kalfa/git/src/ProcessSeed.test-support.ts | tests | tests | new: the fast-import seeder and the shallow file |
| kalfa/git/src/fixtures/check-ref-format-2.40.1.json | tests | tests | new: `vector:` names and git's answers, from a real run |
| kalfa/git/src/fixtures/fast-import-2.40.1.json | tests | tests | new: `vector:` commit fields and the ids git gave them |
| kalfa/git/src/fixtures/cat-file-2.40.1.txt | tests | tests | new: `vector:` raw `cat-file --batch` output with a note per object |
| kalfa/git/src/fixtures/for-each-ref-2.40.1.txt | tests | tests | new: `vector:` raw `for-each-ref` output, a tag and a symbolic ref included |
| kalfa/git/src/Package.test.ts | tests | tests | K1, K2 |
| .oxlintrc.json | tests | tests | L1 to L3: overrides A and B, and `kalfa/git/src/**` added to `kalfa/config`'s Effect block |
| layer-rules.json | tests | tests | L4: the `kalfa-git` row after `next-vitest`, and `kalfa/git/src` in `roots` |
| boundary-rules.json | tests | tests | L4: the `kalfa-git` library type and its `libraries` entry |
| package.json | tests | tests | `@kalfa/git` as a root dev dependency, so `pnpm lint:reach` finds it reached |
| pnpm-lock.yaml | tests | tests | the new `kalfa/git` importer and the root's link, from one `pnpm install --offline` |
| vitest.config.ts | tests | tests | no change: `kalfa/*/src/**/*.test.{ts,tsx}` and `kalfa/**/*.integration.test.{ts,tsx}` already find the laws |
| oxlint-plugins/integration-test-name.ts | tests | tests | no change: read for Findings 1 |
| oxlint-plugins/no-node-imports.ts | tests | tests | no change: read to learn it checks nothing in `kalfa/` |
| .github/workflows/check.yaml | tests | tests | no change: read to learn no pull request run includes an integration law |

## Existing tools

- `kalfa/git/src/CommitId.ts`: searched Effect 4.1.3 (`Schema.brand`, `Brand`), `@demlik` and the repo
  (`rg "CommitId"`: Code hosting's protocol sketch brands a string with no check of its form; `next/` uses
  plain strings). None checks git's form. New, on `Schema.isPattern` and `Schema.brand`.
- `kalfa/git/src/Ref.ts`: searched npm for a check-ref-format port (isomorphic-git has an internal
  `isValidRef`-style check, not a package of its own; nothing is an Effect Schema), the repo (`rg
  "check-ref-format|refName"`: today's pipeline shells out to git). Written out from git's rules, held by
  git's own answers in a `vector:` file.
- `kalfa/git/src/Commit.ts`: searched Effect's `DateTime` (its offset zone drops `-0000`, so it loses a
  fact) and the repo's git readers (none keep an offset). New schemas.
- `kalfa/git/src/Settings.ts`: searched `kalfa/config` for a limits shape (none for a library's own limits)
  and Code hosting's `codehost.list.most` (a setting in Configuration, which this package may not import).
  A plain Schema the app fills.
- `kalfa/git/src/Repository.ts`: searched Effect for a git service (none) and for the derive-from-one-call
  shape (`ChildProcessSpawner.make`, used as the model for `make`).
- `kalfa/git/src/MemoryRepository.ts`: searched `next/packages/libfabrika/src/node/repositories/internal/gitMemory.ts`
  (answers the git command line in memory; this package's memory holds data and speaks the service, so it
  does not fit) and Effect's `Digest` (`sha1`, `layerWebCrypto`, used for ids).
- `kalfa/git/src/ProcessRepository.ts`: searched `effect/process` (used as is), `RepositoriesGit.ts` and
  `BoxGitProcess.ts` (their environment hygiene is the lesson; neither may be imported here), and npm's
  `simple-git` and `isomorphic-git` (one shells out with Promises, the other reimplements git; neither is
  Effect, and the owner's design names the git binary).
- `kalfa/git/src/internal/object.ts`: searched Effect's `encoding` modules and the repo for a git object
  writer (`gitMemory.ts` has one, in `next/`, not importable). About 40 lines of git's format.
- `kalfa/git/src/internal/parse.ts`: searched Effect's `Stream.splitLines` and `decodeText` (used inside)
  and npm for a `cat-file --batch` parser (none that is Effect). New, held by `vector:` files.

## Calls taken

- **Commit ids in `/memory` are git's own sha-1, 80%.** The glossary says a commit id is "the name git
  gives a commit from its content", so writing the same commit twice gives one id in both adapters, and
  M1 can check memory against ids real git gave. It costs a `Digest` service when building a store, not
  when reading.
- **`Commit` has no `tree` in this ticket, 80%.** The ticket lists parents, author, committer and message,
  and no caller here reads a tree. 1934 adds `tree` and `TreeId`; before the first release no saved data
  changes, and only this package's own tests build stores.
- **`walk` answers whole commits, oldest first, 80%.** Delivery needs each commit's parents (a merge
  commit fails a rebase) and authors in order (squash's co-authors, decision 0071), and the push plan
  (1939) needs messages. One walk then costs two git processes, not one per commit. Oldest first is the
  order rebase replays and squash names authors in.
- **A shallow repository fails every call that reads history, 80%.** The owner's line on 1750 is "a
  shallow repository is a named error (history too short), never a guess at what is new". Finding which
  answers a shallow commit could not change would take a walk to the cut; in a shallow clone that is every
  tip, so it would refuse the same calls at a higher cost.
- **`NoSuchCommit` covers an id the store lacks and an id of another object type, 85%.** Both mean "the
  store holds no commit with that id", and no caller acts on the difference.
- **A ref that is not a commit fails `readRefs`, 75%** (doubt at the top).
- **Failure names follow the suite, 80%.** `GitUnavailable` with a tagged `reason` (issue 1870's shape);
  `TooMany` as Code hosting names a list past its setting; `TimedOut`, since Program's glossary owns
  **Timeout**; no `Error` suffix, as the Ledger's `Unreachable`, `Refusal` and `Failure` have none.
- **`Repository.make` adds the span and the time limit, and each adapter owns its limits, 80%.** One place
  names the spans for every adapter, as `ChildProcessSpawner.make` does; the limits sit where the answer is
  made, so `/process` asks git for `limit + 1` and never reads more.
- **No file imports a Node module, `/process` included, 90%.** Effect's `ChildProcessSpawner` is the
  platform's door, and the app joins `NodeServices.layer` at the top.
- **`/process` reads no stderr for meaning, 85%.** `NoSuchCommit` comes from `--batch-check` before the
  command, so an exit code of 128 is always `GitUnavailable`.
- **Lowercase hex only in `CommitId`, 85%.** git prints lowercase; one form makes equality plain string
  equality.
- **The author type is `Signature`, 70%** (doubt at the top).
- **No build or publish setup, 80%.** Nobody installs this package outside the repo; `kalfa/config`'s
  `rslib` globs leave out `*Test.ts`, which would drop `/test`. Publishing is a delivery ticket's.
- **The integration file runs in a cloud box before the review, 80%** (under "Where each law runs").
- **Is any of this a setting?** The four limits are, required and with no default, given where the layer
  is built (the ticket, and "every limit is a setting"). Not settings: the git binary (`git` on PATH; no
  caller has a second git, and adding an option later breaks no caller); the pinned environment and flags
  (a setting that loosens them would let a repository's config steer the reads); the walk order, the shallow
  rule and the id format (the protocol every adapter and caller reads alike).

## Validation

- tests step: one `pnpm install --offline`, since a new workspace package cannot go in with
  `--frozen-lockfile`. Then each plain law file alone, `nice -n 15 pnpm exec vitest run --maxWorkers=1
  kalfa/git/src/<file>.test.ts`, red on the missing modules. The `vector:` files are recorded once with real
  git commands, and each file's header names the git version and the command. L1 to L4's plants by hand
  with `pnpm lint`, each undone. The integration file is written and not run here: the laptop refuses it.
- build step: each plain law file green, `pnpm format`, `pnpm lint` (it runs `lint:layers`,
  `lint:boundaries`, `lint:reach` and `lint:dead`), and each plant in the laws table run once and undone.
  The integration file is not run on the laptop.
- The lead: the integration file in a Linux cloud box (`CLAUDE_CODE_REMOTE=true`), and the lead's own
  typecheck run for T1 to T3 and the doc blocks. The lockfile change makes the lead's changed-tests run
  the whole suite, so that full run is left to CI.

## Size

1. One slice, the package: about 1085 product lines (`MemoryRepository.ts` 250, `ProcessRepository.ts`
   250, `Repository.ts` 170, `internal/parse.ts` 120, `Ref.ts` 110, `Commit.ts` 70, `CommitId.ts` 45,
   `internal/object.ts` 40, `Settings.ts` 30), plus the laws, four `vector:` files, the README, the
   glossary terms, the `kalfa/AGENTS.md` sentence and the rule rows. It lands whole: a caller can read
   history from a real bare repository, and its tests can use `/memory`. A cut into memory first and
   `/process` second was weighed and not taken: the ticket closes only when both pass the same laws, and
   the second part alone would land nothing a caller sees.

About 8 agent hours across the steps, 70% sure. The doubts: the history model and its generators (the
largest test file), and the clock skew class on real git. Budget: the diagnostics plan measured about $5
a step for a package a fifth this size; this one is priced at about $12 a step at list price, for tests,
build, review, one send-back fix and a second review.

Estimate: 6 steps, $70

## New names

- `Repository`, `Commit`, `Ref`, `RefName`, `BranchName`, `CommitId`: the glossary's words.
- `readCommit`, `readRefs`, `walk`, `mergeBases`, `isAncestor`: the calls the owner named on 1750, in git's
  words (rev walk, merge base, ancestor).
- `Signature`, `Time`, `Offset`: git's ident, in libgit2's and go-git's word (doubt at the top).
- `Limits` and its keys `commits`, `refs`, `bytes`, `time`; `Settings`.
- `NoSuchCommit`, `RefNotCommit`, `UnreadableCommit`, `HistoryTooShort`, `TooMany`, `TooLarge`,
  `TimedOut`, `GitUnavailable` with `NotStarted`, `Exited`, `Unreadable`; `GitTooOld`, `NoRepository`;
  `BadCommitId`, `BadRefName`, `BadBranchName`; `BadStore`.
- `MemoryStore`, `Store`, `add`, `point`; `RepositoryTest.suite`, `HistoryTest`.
- Span names `git.readCommit`, `git.readRefs`, `git.walk`, `git.mergeBases`, `git.isAncestor`,
  `git.open`; attributes `kalfa.git.under`, `kalfa.git.refs`, `kalfa.git.include`, `kalfa.git.exclude`,
  `kalfa.git.commits`, `kalfa.git.bases`, `kalfa.git.ancestor`, `kalfa.git.version`.

## Records

- `kalfa/git/GLOSSARY.md` gains these terms, in the build:

  **Bare repository**:
  A repository with no working copy: only its commits and refs. Every call here runs on one.
  _Avoid_: server repo, mirror

  **Shallow repository**:
  A repository that holds some commits without their parents. A call that reads history in one fails with
  history too short, never a guess.
  _Avoid_: partial clone, truncated repo

  **Walk**:
  The commits some commits reach and others do not, oldest first.
  _Avoid_: log, history, range, list

  **Ancestor**:
  A commit another commit reaches through its parents. A commit is its own ancestor.
  _Avoid_: parent (a direct one only), predecessor

  **Merge base**:
  A best common ancestor of two commits. Two commits can have more than one, or none.
  _Avoid_: fork point, common ancestor, base (a branch's own)

  **Author**:
  Who wrote a commit's change, with when. It stays when a rebase or a squash makes a new commit.
  _Avoid_: by, creator, owner

  **Committer**:
  Who made the commit object, with when. Commits this package makes take it from the settings.
  _Avoid_: by, pusher, merger

  **Signature**:
  A name, an email and a time with its offset, as git writes a commit's author and its committer. Not a
  cryptographic signature.
  _Avoid_: identity, person, ident, user

- `kalfa/AGENTS.md`'s rank sentence, as above.
- No new decision: the owner's answers on 1750 hold the design, and the calls above are cheap to change
  before the first release. No pattern doc yet.
- `field/runs/` rows for each step, by the lead.

## What this cannot tell us

- Whether these five read calls are the right ones beyond the trace table: no caller is built.
- Whether real git's walk is exact under clock skew without a commit-graph (doubt at the top).
- How refs with characters past ASCII behave on macOS's file system, which can change a file name's
  Unicode form, or with two names that differ only in letter case: the integration file runs on Linux.
- Whether git keeps a name with spaces at its ends when other tools wrote the commit; S1 shows what
  fast-import and our parser keep, not every writer.
- Whether a git between 2.38 and 2.40 answers every call the same: the laws run on whatever git CI and the
  cloud box hold, and the `vector:` files are from 2.40.1. Only the version check is tested at the edge.
- How fast `/process` is on a large repository: no law measures time, and each call starts two or three
  git processes.
- Whether the time limit ends a git child cleanly: P3 sees the scope end on a stand-in, not a real kill.

## Open questions

None.

The owner is away, so the three calls under 80% are taken and listed at the top as doubts.

## Findings

1. **`fabrika/integration-test-name` checks only `next/`.** `oxlint-plugins/integration-test-name.ts:29`
   returns no checks unless the file starts with `next/`, and `vitest.hostrun.ts` refuses a plain file
   that starts a process only when it also signals (`process: () => false`). So a `kalfa/` test that
   spawns git under a plain `*.test.ts` name runs on the laptop and on every pull request with no lint
   finding. This plan names its one such file `*.integration.test.ts` by hand; a scope for every kalfa
   package is its own ticket, as app tracker ticket 1250 is for the two rules above.
2. **Seventeen lint messages name an Effect API that 4.1.3 does not have.** `.oxlintrc.json` says "Use
   Schema.TaggedErrorClass" 17 times; the installed `node_modules/effect/src/Schema.ts` exports
   `TaggedError` and no `TaggedErrorClass` (0 matches). The rule is right and its message points at a
   name that does not exist.
3. **No pull request run includes a kalfa integration law.** `.github/workflows/check.yaml` leaves every
   `.integration.` law to main's full run, so a new adapter's real-binary laws first run after it merges
   unless the lead runs them in a cloud box. This plan asks for that box run; whether the related job
   should take a new package's integration files is the lead's call.

## Amendment 1 (2026-11-22): a setting's value is plain data

The owner decided on 2026-11-22 that a setting's value is plain data only: text, numbers, true or false, and lists
and records of those (https://github.com/kamp-us/tea-fabrika/issues/1839#issuecomment-7087310445). `Schema.Duration`
decodes to a class, so the time limit changes. This amendment wins over the sections above where they differ.

- **`Limits.time`** is duration text, a string checked when decoded: it must decode with Effect's `Duration.fromInput`
  to more than zero, such as `"10 seconds"`. `Repository.make` decodes it once into a `Duration`; `TimedOut { after }`
  stays a `Duration`, since an error's field is not a setting. The traced value's `time 10 seconds` is written
  `"10 seconds"`.
- **Law G5** reads: `Settings` accepts generated duration text that decodes to more than zero, across units (ms,
  seconds, minutes, hours) and amounts; it refuses `"0 seconds"`, `"ten"`, a bare number and a negative amount. New
  plant: drop the text check, so `"ten"` is accepted, red. **Law P3** sets `limits.time` as text and keeps its clock
  check.
- **README** and the doubt "Is any of this a setting?" say the time limit is text, decoded by the package.
- `committer` (ticket 1934) is not part of this pull request; its record of `name` and `email` in place of
  `Signature` is noted on issue 1934.

