# @kalfa/git

Read commits and refs from a git repository that has no working copy. One service, `Repository`, with five read
calls, two adapters that answer them, and the laws both adapters pass.

It never reads HEAD, never writes and never changes the repository it reads. It imports no other package of its repo,
no Node module and no GitHub entry point, so anything can import it.

## The five calls

```ts
import { Effect, Schema } from "effect";
import * as CommitId from "@kalfa/git/CommitId";
import * as Ref from "@kalfa/git/Ref";
import * as Repository from "@kalfa/git/Repository";

const program = Effect.gen(function* () {
  const repo = yield* Repository.Repository;
  const [main] = yield* repo.readRefs(Schema.decodeSync(Ref.RefName)("refs/heads/main")); // [{ name, commit }] or []
  const branch = Schema.decodeSync(CommitId.CommitId)("d944ba0024149807151b00b4f819c9d16f454bc1");
  const own = yield* repo.walk({ include: [branch], exclude: main === undefined ? [] : [main.commit] }); // Commit[], oldest first
  const bases = yield* repo.mergeBases(branch, branch); // CommitId[], [] = no common history
  const landed = yield* repo.isAncestor(branch, branch); // boolean, true: a commit is its own ancestor
  return { own, bases, landed };
});
```

- `readCommit(id)` answers the commit, or `NoSuchCommit` when the repository holds no commit with that id.
- `readRefs(under)` answers the ref `under` and every ref below `under/`, sorted by UTF-8 bytes, as git sorts. A ref
  that only shares text (`refs/heads/main-2`) is not below `refs/heads/main`.
- `walk({ include, exclude })` answers every commit an `include` commit reaches that no `exclude` commit reaches,
  oldest first. Each commit comes after its parents.
- `mergeBases(a, b)` answers the best common ancestors, sorted by id.
- `isAncestor(ancestor, descendant)` answers whether `descendant` reaches `ancestor`. A commit is its own ancestor.

A call never answers a guess. A shallow repository fails `walk`, `mergeBases` and `isAncestor` with
`HistoryTooShort`. An answer past a limit fails with `TooMany` or `TooLarge`, never a cut list. A ref that is
symbolic, or points at a tag, a tree or a blob, fails `readRefs` with `RefNotCommit`.

## Two adapters

- `@kalfa/git/memory` keeps a store as a plain value of commits, refs and shallow commits. A commit's id is computed
  as git computes it, so the same commit has the same id here and in a real repository.
- `@kalfa/git/process` runs the git binary (2.38 or newer) on a bare repository, through Effect's
  `ChildProcessSpawner`. The app provides the Node spawner at the top. Every command runs with `--git-dir`, with no
  replacement objects, no hooks and no config of the machine, and with only `PATH` and a pinned set of variables.

```ts
ProcessRepository.layer({ path: "repo.git", settings });
// Layer<Repository, GitTooOld | NoRepository | GitUnavailable | TimedOut, ChildProcessSpawner>
MemoryRepository.layer(store, settings);
// Layer<Repository | MemoryStore>
```

## Settings

The limits are required and have no default. The app gives each one where it builds the layer.

```toml
[limits]
commits = 1000
refs = 1000
bytes = 1000000
time = "10 seconds"
```

`commits` is the most commits a walk or a merge-base answer holds. `refs` is the most refs one `readRefs` answer
holds. `bytes` is the most bytes one commit object holds, and the most stderr an error keeps. `time` is the longest
one call may take. A setting's value is plain data, so the time is duration text, which the package decodes. When a
call runs out of time, git is asked to stop, and a git that ignores that is killed a fixed five seconds later, so the
call always ends.

## The laws

`@kalfa/git/test` holds `RepositoryTest.suite`, the laws every adapter passes, with its `Subject`, `Seeded` and
`SuiteOptions` types and `settings`. `@kalfa/git/test/History` holds the `History` and `Node` types and the `textureArb`
and `shapes` that draw the histories. A new adapter writes a `Subject` that seeds a history into its own kind of store, and runs
`RepositoryTest.suite("name", subject, { runs, timeout })` in its own test file. `@effect/vitest` and `vitest` are
optional peers, needed only by `/test`.

## What it never does

It has no working copy and no HEAD. It imports no Node module and no package of its repo. It puts no message, name,
email or repository path in a span. Diffs, trees, writing a commit, moving a ref, fetch and push belong to other
packages.
