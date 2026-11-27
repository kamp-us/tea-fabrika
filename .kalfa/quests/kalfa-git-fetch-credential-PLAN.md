
Plancheck-Version: 3

# Plan: @kalfa/git, fetch from a remote by name or by URL, with a credential asked on each fetch (ticket 1938)

This is the kalfa packages (`kalfa/`), new work. It is not today's frozen version and not `next/`. The ticket is
https://github.com/kamp-us/tea-fabrika/issues/1938, a GitHub issue under Source control's protocol
(https://github.com/kamp-us/tea-fabrika/issues/1750), so the first pull request says `Refs #1938`, the last
`Closes #1938`, and neither carries a `fabrika close ticket` line. Two slices, each its own pull request. Slice 1
branches from main after https://github.com/kamp-us/tea-fabrika/pull/2325 lands. Slice 2 branches from main after
slice 1 lands, and its build waits for the owner's answer to the one open question.

```ts
// The whole idea, a sketch. Delivery lands a change: it fetches main, rebases onto it, and pushes with a lease on it.
const repo = yield* Repository.Repository;
const [main] = yield* repo.fetch({ remote: Remote.named(origin), under: refName("refs/heads/main") });
// ReadonlyArray<Ref>: the remote's refs at and below `under`, sorted by UTF-8 bytes. [] means git proved the remote
// holds none. The repository then holds each answered commit and its history. No ref of this repository moved.
// The call asked the Credentials slot once, with the remote's URL (the configured one for a named remote).
// Fails NoSuchRemote, BadRemoteUrl, NoCredential, FetchFailed, HistoryTooShort, TooMany or RefNotCommit; never [].

// The call's requirement is the slot, so the program picks a filler at the top, by name:
program.pipe(Effect.provide(Credentials.none)); // a local path, a /memory remote, a public remote
program.pipe(Effect.provide(CodehostGit.credentials)); // later, ticket 1968: from an access grant
```

## Doubts, read first

- **The ruling says "askpass helper"; git's own non-interactive way is a credential helper. Open question 1.** Slice 2
  is written to the ruling. A credential helper given as config in the environment needs no file and no
  `FileSystem`, and it can check the host git asks for. Slice 1 does not depend on the answer.
- **The slot is the call's requirement, not the layer's, 75%.** `fetch` returns `Effect<..., ..., Credentials>`.
  Effect's own guide builds a service's needs into its layer. Here the slot is asked on every call, a program that
  never fetches never picks one, and neither adapter's layer type changes, so the many tests that build a layer stay as
  they are. The cost: a service method with a requirement, which Effect's guide does not show. What would settle it:
  the review or the lead preferring the layer. Then `make` takes the service at build and every layer build provides
  `Credentials.none`, about 15 lines more in tests.
- **`fetch` takes one `under`, the shape `readRefs` takes, 80%.** It fits how git fetches (one glob refspec), and it
  gives the push ticket (https://github.com/kamp-us/tea-fabrika/issues/1940) the proof that a ref is gone: an empty
  answer. A caller that needs two folders fetches twice.

## Records read

- `AGENTS.md`, `kalfa/AGENTS.md` (Source control imports no kalfa package and ranks lowest), `kalfa/git/README.md`,
  `kalfa/git/GLOSSARY.md` (Remote, Fetch, Credential, Pre-push hook), `kalfa/git/package.json`.
- Code on main at 04a7c8ed6: `kalfa/git/src/Repository.ts` (the service, `Raw`, `make`), `ProcessRepository.ts`
  (`start`, `PINNED`, `child`, `runner`, `readRefs`, `layer`), `MemoryRepository.ts` (`Store`, `layer`, `point`),
  `Settings.ts`, `Ref.ts`, `RepositoryTest.ts` (`Subject`, `Seeded`, `settings`), `CommitEdit.test-support.ts` (a law
  suite that sits beside `/test`), `MemorySeed.test-support.ts`, `ProcessSeed.test-support.ts`,
  `StandIn.test-support.ts` (it already shows a `Redacted` env value as `<redacted>`), `Laws.test-support.ts`
  (`traced`, `expectNamedSpan`), `ProcessRepository.test.ts` (P11, `open`), `ProcessRepository.integration.test.ts`
  (suites at 6 runs), `Package.test.ts` (`EXPORTS`).
- The ticket, its parent's resolution comment on https://github.com/kamp-us/tea-fabrika/issues/1750 ("Credential ...
  asked for on each fetch and push ... The real adapter hands it to git through an askpass helper, never in a command
  line or a URL"; "/memory, the store as a plain value of commits, refs and remotes"; fetch is a raw call), ruling 7 of
  https://github.com/kamp-us/tea-fabrika/issues/1869 (a fetch takes a remote by name or by URL; the slot is asked with
  the URL), and the tickets that use this call next: https://github.com/kamp-us/tea-fabrika/issues/1939 (push plan),
  https://github.com/kamp-us/tea-fabrika/issues/1940 (push: "a remote that is not there" is its own refusal; a delete
  push of a ref "the fetch proved gone") and https://github.com/kamp-us/tea-fabrika/issues/1968 (Code hosting fills the
  slot from an access grant, and runs on `/memory`).
- Decisions: 0047 (a kalfa package usable alone), 0048 (an adapter is an entry point), 0050 ("a GitHub remote is plain
  git with a credential"; Source control has no GitHub entry point), 0059 (the pre-push hook stays git's word).
  `rg -il "credential|askpass"` and `rg -il "fetch"` over `.kalfa/decisions`, `.kalfa/glossary`, `.kalfa/patterns`,
  `.kalfa/runbooks` and `docs`: only 0050 and the glossary map speak of a credential, and no decision says how git
  gets one beyond the parent's ruling.
- Plans: `.kalfa/quests/kalfa-git-kill-wait-PLAN.md` (on branch `fabrikalfa/kalfa-git-kill-wait`, for shape) and
  `.kalfa/quests/kalfa-git-rebase-PLAN.md` (on branch `fabrikalfa/kalfa-git-rebase`: its scratch ref with 16 random
  hex digits under `refs/kalfa/rebase/`, its files table).
- Installed versions from the lockfile: `effect` 4.1.3 (patched; the patch touches only `TestConsole` and the
  arbitrary model), `@effect/platform-node` 4.1.3, `@effect/vitest` 4.1.3, `vitest` 5.0.5. Read in the installed
  source: `effect/process/ChildProcess` takes `Redacted<string>` env values ("passed to the child unchanged and never
  shown in errors"), and `@effect/platform-node-shared`'s `NodeChildProcessSpawner` unwraps them only when it spawns;
  `Schema.Redacted(schema, { disallowJsonEncode })`; `Redacted`'s `toString` and `toJSON` print `<redacted>`;
  `effect/FileSystem` has `makeTempDirectoryScoped`, `writeFileString` with a `mode`, and `layerNoop` for tests.
- Run by hand by this plan step on the laptop's git 2.40.1, in scratch bare repositories with no user or system config:
  - A refspec `+refs/heads/main*:refs/kalfa/fetch/<hex>/refs/heads/main*` fetches `main` and `main-2`, exits 0, and
    writes no `FETCH_HEAD` with `--no-write-fetch-head`. An exact refspec for a ref the remote lacks exits 128 (`couldn't
    find remote ref`); the same as a glob that matches nothing exits 0.
  - **From a shallow remote, without `--update-shallow`, git exits 0 and leaves the ref out**, printing only `warning:
    rejected <ref> because shallow roots are not allowed to be updated`. Read as an answer, that is "the remote has no
    such ref": the guess the ticket forbids. With `--update-shallow` the ref comes, and the repository is then shallow.
  - Every flag and pin below parses on 2.40.1. `-c protocol.allow=never` with no `protocol.file.allow` refuses a local
    path and a `file://` URL (`transport 'file' not allowed`), and refuses `ext::` with it.
  - `git config --null --get-all remote.<name>.url` exits 1 for a missing name and prints each value NUL-ended.
    `git ls-remote --get-url <name>` echoes an unknown name back with exit 0, so it cannot tell a missing name.

## How others do it

- **git itself.** `gitcredentials(7)` gives two ways for a program to supply a login: `GIT_ASKPASS` (or
  `core.askPass`), a program git runs with the prompt as its one argument, reading the answer's first line from its
  stdout, asked once for the user name ("Username for '<url>': ") and once for the password; and a credential helper,
  which git runs with `get` and feeds `protocol=`, `host=` and `path=` lines, and which answers `username=` and
  `password=` lines. A helper string that starts with `!` runs in the shell. Git runs the askpass program with no shell,
  so it must be a file on disk. (From memory, not fetched.)
- **VS Code's git extension:** `GIT_ASKPASS` points at a script that asks the editor over a local socket, so the secret
  never sits in a file or the environment. **GitHub CLI:** `gh auth setup-git` installs a credential helper
  (`!gh auth git-credential`). **Git Credential Manager:** a credential helper. **actions/checkout:** writes
  `http.extraheader` with the token into the repository's config for the job, then removes it. **Jenkins' git
  plugin:** writes a temporary askpass script. (All from memory, not fetched.)
- **Effect:** `Redacted` for a secret value, and `ChildProcess` env values may be `Redacted`, so the secret reaches the
  child and no error shows it (read in the installed source).
- **Elm and Erlang/OTP:** no answer to borrow: neither runs git or holds a login for it.

The plain way in the industry is a credential helper; the ruling picked askpass. Slice 2 follows the ruling, and the
open question puts the choice to the owner.

## The shape

### Remote values (`kalfa/git/src/Remote.ts`, new, entry point `./Remote`)

```ts
// A sketch.
/** A remote's name in this repository's config, such as `origin`: `refs/remotes/<name>/x` is a ref name, and it does not start with `-`. */
export const Name = Schema.String.check(Schema.makeFilter(isName, { title: "a git remote name" })).pipe(
  Schema.brand("@kalfa/git/RemoteName"),
);

/**
 * A remote's URL as this package takes it: `https://host[:port]/path`, `http://` only to a loopback host
 * (127.0.0.1, ::1, localhost), `file:///abs/path`, or an absolute path. No user, password, query or fragment, no space
 * or control character, so no credential can ride in a URL and nothing the WHATWG parser drops can hide a host.
 * `ssh://`, `git@host:path`, `ext::`, `fd::` and relative paths are refused.
 */
export const Url = Schema.String.check(Schema.makeFilter(isUrl, { title: "a git remote URL" })).pipe(
  Schema.brand("@kalfa/git/RemoteUrl"),
);

export const Remote = Schema.Union([
  Schema.TaggedStruct("Named", { name: Name }),
  Schema.TaggedStruct("Url", { url: Url }),
]);
export type Remote = typeof Remote.Type;
export const named = (name: Name): Remote => ({ _tag: "Named", name });
export const url = (url: Url): Remote => ({ _tag: "Url", url });

/** This repository has no remote of that name. */
export class NoSuchRemote extends Schema.TaggedError<NoSuchRemote, { readonly brand: unique symbol }>()("NoSuchRemote", {
  name: Name,
}) {}

/**
 * The URL a fetch would use is not one this package takes: a named remote's config holds several URLs (`several`) or
 * one `Url` refuses (`refused`), or the repository's config rewrites the URL (`rewritten`, `url.<base>.insteadOf`).
 * It never holds the configured text, which may hold a password.
 */
export class BadRemoteUrl extends Schema.TaggedError<BadRemoteUrl, { readonly brand: unique symbol }>()("BadRemoteUrl", {
  remote: Remote,
  reason: Schema.Literals(["several", "refused", "rewritten"]),
}) {}

/** git could not fetch from the URL: no repository there, no way to reach it, or a login refused. `stderr` keeps at most `limits.bytes`. */
export class FetchFailed extends Schema.TaggedError<FetchFailed, { readonly brand: unique symbol }>()("FetchFailed", {
  url: Url,
  code: Schema.Int,
  stderr: Schema.String,
}) {}
```

### The slot (`kalfa/git/src/Credentials.ts`, new, entry point `./Credentials`)

```ts
// A sketch.
// One line of text: no CR, LF or NUL, since git reads the first line of what askpass prints.
const Line = Schema.String.check(Schema.isPattern(/^[^\r\n\0]*$/));

/** What git hands a remote to log in: a user name and a password. The password is `Redacted`, and JSON refuses it. */
export class Credential extends Schema.Class<Credential, { readonly brand: unique symbol }>("@kalfa/git/Credential")({
  username: Line,
  password: Schema.Redacted(Line, { disallowJsonEncode: true }),
}) {}

/** The slot could not give a credential for the URL. It holds the URL only, so no filler's detail, and no secret, rides in it. */
export class NoCredential extends Schema.TaggedError<NoCredential, { readonly brand: unique symbol }>()("NoCredential", {
  url: Remote.Url,
}) {}

/** The slot: asked once on every fetch, with the URL git will use. `none` means fetch with no login. */
export class Credentials extends Context.Service<
  Credentials,
  { readonly ask: (url: Remote.Url) => Effect.Effect<Option.Option<Credential>, NoCredential> }
>()("@kalfa/git/Credentials") {}

/** The filler that gives no credential, for a remote that needs no login. Picked by name. */
export const none: Layer.Layer<Credentials> = Layer.succeed(Credentials, { ask: () => Effect.succeedNone });
```

### The call (`kalfa/git/src/Repository.ts`)

```ts
// In the service, a sketch.
readonly fetch: (request: {
  readonly remote: Remote.Remote;
  readonly under: Ref.RefName;
}) => Effect.Effect<
  ReadonlyArray<Ref.Ref>,
  | Remote.NoSuchRemote | Remote.BadRemoteUrl | Credentials.NoCredential | Remote.FetchFailed
  | HistoryTooShort | TooMany | RefNotCommit | Fails,
  Credentials.Credentials
>;

// What an adapter writes beside the other raw calls: `fetch` leaves the service's list and comes back as two calls.
export type Raw = Omit<Repository["Service"], "writeCommit" | "rangePatchId" | "readText" | "fetch"> & {
  readonly writeCommit: ...; // as it is
  /** The URL git would use for the remote: a named one's from config, and a URL as given, each checked. */
  readonly remoteUrl: (remote: Remote.Remote) => Effect.Effect<Remote.Url, Remote.NoSuchRemote | Remote.BadRemoteUrl | Fails>;
  readonly fetch: (request: {
    readonly url: Remote.Url;
    readonly under: Ref.RefName;
    readonly credential: Option.Option<Credentials.Credential>;
  }) => Effect.Effect<ReadonlyArray<Ref.Ref>, Remote.FetchFailed | HistoryTooShort | TooMany | RefNotCommit | Fails>;
};

// In make, a sketch: the slot is asked here, once, so both adapters ask it alike.
fetch: Effect.fn("git.fetch")(function* (request) {
  yield* Effect.annotateCurrentSpan({
    "kalfa.git.remote": request.remote._tag === "Named" ? "named" : "url",
    "kalfa.git.under": request.under,
  });

  // One time limit around the whole call, the slot's answer included, so a slow filler still ends.
  return yield* limited(
    Effect.gen(function* () {
      const url = yield* raw.remoteUrl(request.remote);
      const credential = yield* (yield* Credentials.Credentials).ask(url);
      yield* Effect.annotateCurrentSpan({ "kalfa.git.credential": Option.isSome(credential) });
      const refs = yield* raw.fetch({ url, under: request.under, credential });
      yield* Effect.annotateCurrentSpan({ "kalfa.git.refs": refs.length });

      return refs;
    }),
  );
}),
```

The span never holds the URL, the name, the user name or the password: a URL can be a local path, which the laws
already keep out of spans, and the user name is half of the credential.

### `/memory` (`kalfa/git/src/MemoryRepository.ts`)

```ts
// A sketch.
/** What a URL reaches: another store, read as it is at each fetch, and the login it asks, if any. */
export interface Remote {
  readonly store: Effect.Effect<Store>;
  readonly login: Option.Option<Credentials.Credential>;
}

/** This repository's named remotes, as git's config holds them, and what each URL reaches. */
export interface Remotes {
  readonly names: ReadonlyMap<RemoteValues.Name, RemoteValues.Url>;
  readonly stores: ReadonlyMap<RemoteValues.Url, Remote>;
}

export const layer = (store: Store, settings: Settings.Settings, remotes: Remotes = NO_REMOTES) => ...
```

- `remoteUrl`: a name not in `names` fails `NoSuchRemote`; a `Url` is answered as given.
- `fetch`: a URL not in `stores` fails `FetchFailed` (code 128, stderr "no repository at that URL"). A remote with a
  `login` fails `FetchFailed` (code 128, stderr "login refused") unless the credential's user name and password value
  equal it. Then it reads the remote's refs at and below `under` (the `readRefs` rule), copies every commit they reach
  that this store lacks, with its tree's files and blobs, stopping at a remote shallow commit, which joins this store's
  `shallow`. It fails `HistoryTooShort` when this store is shallow after that, and `TooMany` past `limits.refs`, both
  after the copy, as git has fetched by then. It moves no ref of this store.

### `/process` (`kalfa/git/src/ProcessRepository.ts`)

`remoteUrl`, for a name: `config --null --get-all remote.<name>.url`. Exit 1 is `NoSuchRemote`; any other non-zero
exit is `GitUnavailable`; not exactly one value is `BadRemoteUrl` `several`; a value `Url` refuses is `BadRemoteUrl`
`refused`. Then, for either kind: `ls-remote --get-url -- <url>` must print the URL back unchanged, else `BadRemoteUrl`
`rewritten`. No other `remote.<name>.*` key is ever read, since every fetch goes by URL: no `remote.<name>.fetch`
mapping, `tagOpt`, `prune` or `uploadpack` acts.

`fetch`, one command for the transfer and four local ones:

```text
git <start> -c protocol.allow=never -c protocol.file.allow=always -c protocol.https.allow=always
    -c protocol.http.allow=always -c credential.helper= -c http.sslVerify=true -c http.followRedirects=false
    fetch --quiet --no-tags --no-write-fetch-head --no-recurse-submodules --update-shallow
          --no-auto-gc --no-auto-maintenance --no-write-commit-graph
          -- <url> +<under>*:refs/kalfa/fetch/<16 hex>/<under>*
git <start> rev-parse --is-shallow-repository             true: HistoryTooShort
git <start> for-each-ref --count=<refs + 1> --format=%(objectname) %(objecttype) %(symref) %(refname)
            refs/kalfa/fetch/<hex>/<under>                  the readRefs rule: exact, and below `under/`
git <start> update-ref --stdin                             delete each scratch ref it read, in the call's scope
```

- Env of the `fetch` command in slice 1: `PATH`, the pins, and `GIT_ASKPASS=""`, so git never runs a
  `core.askPass` from config and never prompts. Every other command keeps today's env.
- A non-zero exit of `fetch` is `FetchFailed { url, code, stderr }`, never `[]`. The glob matches `main-2` too; the
  read back leaves it out, as `readRefs` does. Its objects stay, unreferenced, as any fetched object does until gc.
- The read back names the remote's ref (the scratch prefix taken off), and a ref at a tag fails `RefNotCommit` naming
  the remote's ref.
- The scratch refs are deleted after every ending, an answer or a failure, inside the call's time limit. A process
  that is killed leaves them under `refs/kalfa/fetch/`, which holds nothing else and is safe to delete at any time.
- The hex comes from Effect's `Random`, 16 digits, as the rebase plan's scratch ref does, so two fetches at once never
  share one.

### Slice 2: the credential reaches git (to the ruling: askpass)

- For a fetch whose slot gave `Some(credential)`, `/process` makes a temporary folder in the call's scope
  (`FileSystem.makeTempDirectoryScoped`), writes the fixed script below into it with mode `0o700`, and runs `fetch`
  with `GIT_ASKPASS=<folder>/askpass`, `KALFA_GIT_USERNAME` and `KALFA_GIT_PASSWORD`, both as `Redacted`. No other
  command of the call gets them. The folder goes when the call ends.
- `FetchFailed.stderr` has every occurrence of the user name and the password replaced by `<redacted>`.
- `ProcessRepository.layer`'s requirement gains `FileSystem.FileSystem`, which the app provides beside the spawner.

```sh
#!/bin/sh
# git runs this with its prompt as $1. It prints the user name or the password, never the prompt.
case $1 in
Username*) printf '%s\n' "$KALFA_GIT_USERNAME" ;;
*) printf '%s\n' "$KALFA_GIT_PASSWORD" ;;
esac
```

If the owner picks the credential helper (open question 1): no folder, no file and no `FileSystem`. The `fetch`
command's env gets `GIT_CONFIG_COUNT=2`, `credential.helper` set empty and then to a `!` snippet that answers `get`
with `username=` and `password=` from the same two variables, only when the `host=` line git sends equals the URL's
host. The laws below stay, except F18's file checks, which become checks on the config entries.

### Where the credential lives, and for how long

| Where | How long | Reaches |
|---|---|---|
| The filler's answer, a `Credential` whose password is `Redacted` | from `ask` to the end of the one `fetch` call | `make`, then `raw.fetch` as an argument; nothing stores it: no `Ref`, `Cell`, cache, `Store` or layer value |
| `/memory` | the same call | compared with the remote's `login`, then dropped |
| `/process`, slice 2 | the one `git fetch` child | its environment, as `Redacted` until Effect's Node spawner unwraps it at spawn; git's own children (`git-remote-https`, the askpass script) inherit it; the script prints it to git over a pipe |

It never reaches a span, a log, an error, a file, a command line, a URL, stdin, a ref or the repository's config. The
askpass script is a fixed text that holds no secret. Who can read a running process's environment (the same user,
root) can read it there: that is the one place it is plain, and it is the trust zone git's own askpass and helpers
share.

### What the README and the glossary gain

- `kalfa/git/README.md`: a "Fetch" section (the call, its checks in order, the pins table for `fetch` in the style of
  the read and edit tables, the scratch refs and what a killed process leaves, where the adapters differ: memory has no
  tags, no `insteadOf` and no transport), the top paragraph and "What it never does" (fetch reads a remote and changes
  nothing on it; only a push will change one), and in slice 2 how the credential reaches git.
- `kalfa/git/GLOSSARY.md`, **Credential**: "A repository that fetches only from remotes with no login picks the one
  that gives none, by name." This is the one glossary change: every other word here is git's own and is already there.

## One value traced through

1. Delivery runs `repo.fetch({ remote: Remote.named("origin"), under: "refs/heads/main" })`, with
   `Credentials.none` provided at the top. Its local `refs/heads/main` is at `a1`.
2. `make` opens the span `git.fetch` with `kalfa.git.remote: "named"`, `kalfa.git.under: "refs/heads/main"`.
3. `/process` `remoteUrl`: `config --null --get-all remote.origin.url` prints `https://github.com/kamp-us/x.git\0`. It
   decodes as a `Url`. `ls-remote --get-url -- https://github.com/kamp-us/x.git` prints it back unchanged.
4. `make` asks the slot with that URL. `none` answers `Option.none()`. The span gets `kalfa.git.credential: false`.
5. `fetch -- https://github.com/kamp-us/x.git +refs/heads/main*:refs/kalfa/fetch/3f9c0a17b2d4e865/refs/heads/main*`,
   with `GIT_ASKPASS=""`. The remote holds `main` at `b2` and `main-old` at `c3`. Both arrive. Exit 0.
6. `rev-parse --is-shallow-repository` prints `false`.
7. `for-each-ref --count=1001 ... refs/kalfa/fetch/3f9c0a17b2d4e865/refs/heads/main` prints one line, `b2 commit
   refs/kalfa/fetch/3f9c0a17b2d4e865/refs/heads/main`. `main-old` sits beside it, not below it, so it is not listed.
8. `update-ref --stdin` deletes both scratch refs.
9. The answer is `[{ name: "refs/heads/main", commit: "b2" }]`, `kalfa.git.refs: 1`. The local `refs/heads/main` is
   still at `a1`. `walk({ include: [b2], exclude: [a1] })` now answers.

With `under: "refs/heads/gone"`, step 5 matches nothing and exits 0, step 7 prints nothing, and the answer is `[]`: the
proof a delete push needs. With a shallow remote, step 6 prints `true` and the call fails `HistoryTooShort` after step 8.

## Generators

One fetch carrier, drawn from `textureArb`, builds a remote history, a local history and the cases, and returns the
classes it reached; F1 asserts the list equals `FETCH_CLASSES`, as the other carriers do.

- (a) `under` names one ref the remote holds, exactly.
- (b) `under` names a folder with two or more refs below it.
- (c) beside (a), a remote ref that only shares its text (`<under>-2`), which the answer leaves out.
- (d) `under` names nothing the remote holds: the answer is `[]`.
- (e) a remote ref outside the branches, such as `refs/kalfa/candidates/<x>`.
- (f) the local repository already holds part of the remote's history, an answered tip included.
- (g) the local repository has a branch of the same name at another commit.
- (h) the remote known by a name.
- (i) a name this repository has no remote for.
- (j) the remote known by each URL the subject gives (memory: one; process: an absolute path and `file://`), with no
  name added.
- (k) a URL that reaches no repository.
- (l) a remote whose history is cut (a shallow commit) below a fetched tip.
- (m) the remote's ref moved between two fetches.
- (n) more refs under `under` than `limits.refs`, and exactly `limits.refs`.
- (o) a credential the slot gives, drawn with canaries: a user name and a password of 12 or more characters with
  spaces, quotes, `$()`, backticks, `%s`, `*`, `\`, `-`, `=` and non-ASCII text.
- (p) the slot fails `NoCredential`.
- (q) the local repository is shallow before the fetch.

For the `/process` stand-in laws:

- (r) a named remote whose config holds two URLs.
- (s) a named remote whose config URL holds a user and a canary password (`https://u:<canary>@host/r`).
- (t) a URL the repository's config rewrites: `ls-remote --get-url` prints another one.
- (u) a remote ref at a tag object: `for-each-ref` prints `tag`.
- (v) a `fetch` that exits non-zero with stderr, 1 and 128.

For the values:

- (w) texts that pass the WHATWG parse as `https` with no user, query or fragment, but hold a tab, a LF or a CR, which
  the parser drops (`https://exa\tmple.com/r` reads as `example.com`): only the control character check refuses them.
- (x) `https` URLs with a user, and with a user and a password, with no control character.
- (y) `http://` to a host that is not loopback; and `http://127.0.0.1`, `http://[::1]` and `http://localhost`, which
  pass.
- (z) a relative path, a leading `-`, `ext::`, `fd::`, `ssh://`, `git@host:path`, a query and a fragment.

## Laws

Shared laws (F1 to F8) live in `kalfa/git/src/Fetch.test-support.ts` with its own `FetchSubject`, beside `/test` as
the commit edit laws are, and `RepositoryTest.ts` re-exports `FetchTest` so `/test` ships them. They run on `/memory`
in `kalfa/git/src/Fetch.test.ts` at 100 runs and on real git in `ProcessRepository.integration.test.ts` at 6 runs, as
the other suites do. Each law provides `Credentials.none`, or a recorder that counts asks and then answers as `none`
does, or the canary filler (o). Seed 119120.

| Law | Kind | Generator | Plant | Test file |
|---|---|---|---|---|
| F1, the answer: for (a) to (e), (h) and (j), the answer equals the model of the remote's refs at and below `under`, sorted by UTF-8 bytes, and each answered commit, and every commit it reaches, reads back with `readCommit` equal to the remote's; the carrier reached every class; 100 runs on memory, 6 on git | test (`it.effect.prop`) | Effect Arbitrary: textureArb | (c) read back by text prefix (`startsWith(under)`): `<under>-2` is answered, red; (a) fetch only `<under>/*`: the exact ref is missing, red; (b) fetch only the exact ref: red; (e) fetch only under `refs/heads/`: red; (f) answer only refs whose commit was new to this repository: red | kalfa/git/src/Fetch.test-support.ts |
| F2, nothing of this repository moves: for every class, `readRefs` of `refs/heads`, `refs/kalfa`, `refs/remotes` and `refs/tags` before and after each fetch, an answer or a failure, are equal, so no scratch ref is left; 100 runs | test (`it.effect.prop`) | Effect Arbitrary: textureArb | (g) fetch with git's default mapping, into `refs/heads/*`: the local branch moves, red; leave the scratch refs: red; delete them only after an answer: (n) leaves them, red | kalfa/git/src/Fetch.test-support.ts |
| F3, by name or by URL: (h) and each URL of (j) answer the same; (i) fails `NoSuchRemote` naming the name; (k) fails `FetchFailed` naming the URL; neither is `[]`; 100 runs | test (`it.effect.prop`) | Effect Arbitrary: textureArb | (h) fetch a named remote by passing its name as the URL: git reads `origin` as a path, red; (i) treat an unknown name as a URL: `FetchFailed`, red; (k) map `FetchFailed` to `[]`: red; (j) look a URL up among the names first: an unnamed URL fails, red | kalfa/git/src/Fetch.test-support.ts |
| F4, a fetch that cannot answer fails: (l) and (q) fail `HistoryTooShort`; (n) fails `TooMany` with `limit: "refs"` at one past the limit, and answers at exactly the limit; (d) answers `[]` only where the model holds no ref; 100 runs | test (`it.effect.prop`) | Effect Arbitrary: textureArb | (l) drop `--update-shallow`, and in memory leave out refs that reach a cut: `[]`, red; (q) check only the remote's cut: a local shallow store answers, red; (n) count with `>=`: exactly the limit fails, red; (d) answer `[]` on `HistoryTooShort`: red | kalfa/git/src/Fetch.test-support.ts |
| F5, no answer is kept: (m) the second fetch answers the moved commit, and the commit it now names reads back; 100 runs | test (`it.effect.prop`) | Effect Arbitrary: textureArb | (m) keep each answer by URL and `under` in the layer: the old commit, red | kalfa/git/src/Fetch.test-support.ts |
| F6, the slot is asked once on every fetch, with the URL: two fetches give the recorder two asks; each holds the URL of (j), and for (h) the configured URL; (p) fails `NoCredential` and the store is as it was (memory: `fingerprint`; process: refs, by F2) and, on process, no `git fetch` ran (F10); 100 runs | test (`it.effect.prop`) | Effect Arbitrary: textureArb | ask once per layer (`Effect.cached`): one ask, red; ask with the name text: red; (p) fetch first, then ask: the store changed, red | kalfa/git/src/Fetch.test-support.ts |
| F7, [secrets] the credential stays out of every output: with (o), across fetches in (a), (i), (k), (l) and (n), neither the user name nor the password is in any span's name, attribute or event (all spans of the trace), any log line (a logger that records each message and annotation), the answer, any failure (`JSON.stringify`, `String`, `Cause.pretty` and each field), or the memory store (`MemoryStore.get`, JSON with `Redacted` shown); 100 runs | test (`it.effect.prop`) | Effect Arbitrary: credentialArb | (o) annotate `git.fetch` with the user name: red; `Effect.logDebug` the credential's password value in `make`: red; put the user name in `FetchFailed.stderr` in memory: red; memory keeps the last credential in its cell: red | kalfa/git/src/Fetch.test-support.ts |
| F8, the span: each fetch makes one `git.fetch`, ended, with `kalfa.git.remote`, `kalfa.git.under`, `kalfa.git.credential` and, on an answer, `kalfa.git.refs`; no key holds the URL, the name or a path; `hidden` (both repositories' paths) is in no `git.` span; 100 runs | test (`it.effect.prop`) | Effect Arbitrary: textureArb | put the URL in the span: red; write `fetch` with `Effect.fnUntraced`: no span, red; annotate the count before the call: wrong count, red | kalfa/git/src/Fetch.test-support.ts |
| F9, memory login: a remote with a `login` answers only for an equal credential; `none`, another user name or another password fails `FetchFailed`, which holds neither | test (`it.effect`) | scenario: one remote with a drawn login, four credentials | accept any credential: red; compare the user names only: red | kalfa/git/src/MemoryRepository.test.ts |
| F10, the commands of a fetch, on the stand-in: for (h), `config --null --get-all remote.<name>.url`, `ls-remote --get-url -- <url>`, then `fetch` with exactly the pins and flags above, `--` before the URL, the URL as given and one refspec `+<under>*:refs/kalfa/fetch/<16 hex>/<under>*`, then `rev-parse --is-shallow-repository`, `for-each-ref --count=<refs + 1>` on the scratch name, and `update-ref --stdin` deleting each scratch ref it read; two fetches use two hex names; the `fetch` env is `PATH`, the pins and `GIT_ASKPASS=""`; (p) runs no `fetch` | test (`it.effect`) | scenario: stand-in replies for each verb | drop `--update-shallow`: red; drop `--`: red; drop `protocol.allow=never`: red; drop `--no-tags`: red; reuse one hex: red; (p) ask the slot after `fetch`: red | kalfa/git/src/ProcessFetch.test.ts |
| F11, a named remote's config: exit 1 fails `NoSuchRemote`; (r) fails `BadRemoteUrl` `several`; (s) fails `BadRemoteUrl` `refused`, and no failure field, span or log holds any part of the configured text; no `fetch` ran in either | test (`it.effect`) | scenario: config replies | (r) read the value with `--get`, the last one: red; (s) put the configured text in the failure: red | kalfa/git/src/ProcessFetch.test.ts |
| F12, (t) a rewritten URL fails `BadRemoteUrl` `rewritten`, for a name and for a URL, and no `fetch` ran | test (`it.effect`) | scenario: `ls-remote --get-url` prints another URL | (t) skip the compare: `fetch` runs, red | kalfa/git/src/ProcessFetch.test.ts |
| F13, (u) a remote ref at a tag fails `RefNotCommit` naming the remote's ref, not the scratch name, and the scratch refs are deleted | test (`it.effect`) | scenario: `for-each-ref` prints a tag | (u) name the scratch ref in the failure: red | kalfa/git/src/ProcessFetch.test.ts |
| F14, (v) a `fetch` that exits 1 or 128 fails `FetchFailed` with the code and the stderr git said; after `FetchFailed`, `TooMany`, `HistoryTooShort`, `RefNotCommit` and `TimedOut` (a hang, with `TestClock`) the scratch refs are deleted or, for a failed `fetch`, none was read | test (`it.effect`) | scenario: stand-in replies | (v) read exit 1 as an answer: `[]`, red; delete scratch refs only after an answer: red | kalfa/git/src/ProcessFetch.test.ts |
| F15, the URL: every text of (w) to (z) is refused except the loopback ones of (y); `https://host/path`, `https://host:8443/a/b.git`, `file:///abs/r.git` and `/abs/r.git` pass, each decoding to itself; 200 runs | test (`it.prop`) | Effect Arbitrary: urlArb | (w) delete the control character check: the tab URL passes, red; (x) delete the user check: red; (y) take `http` to any host: red, and refuse it everywhere: the loopback ones fail, red; (z) take a relative path: red | kalfa/git/src/Remote.test.ts |
| F16, the name and the credential: a name passes exactly when `refs/remotes/<name>/x` is a `RefName` and it does not start with `-`; a credential refuses a CR, LF or NUL in either field; its password decodes to `Redacted`, whose `String` is `<redacted>`, and JSON encoding the credential fails; 200 runs | test (`it.prop`) | Effect Arbitrary: credentialArb | take `-x` as a name: red; drop the line check on the password: red; declare the password `Schema.String`: JSON holds it, red | kalfa/git/src/Remote.test.ts |
| F17, the types: `fetch`'s requirement is exactly `Credentials` (a program that yields it and is run with no `Credentials` does not compile); its error union is exactly the nine above with `Fails`; `Remote.url("https://x/y")` with a plain string does not compile; `Credential["password"]` is `Redacted<string>`; `Credentials.none` is `Layer<Credentials>`; `Raw` has `remoteUrl` and `fetch` and no `Credentials` | type (`expectTypeOf` and `@ts-expect-error`) | type | capture the slot at layer build (`R` never): the `@ts-expect-error` goes unused, red; declare the password `string`: red | kalfa/git/src/Fetch.types.test.ts |
| F18, slice 2, the credential reaches `fetch` only: with (o), the `fetch` command's env holds `GIT_ASKPASS` naming `askpass` in a fresh folder, and `KALFA_GIT_USERNAME` and `KALFA_GIT_PASSWORD` as `Redacted` (the stand-in shows `<redacted>`); no other command holds them; the file written (a `FileSystem.layerNoop` recorder) is the fixed script, mode `0o700`, holding neither value; its folder is removed after an answer, a failure and `TimedOut`; with `none` no folder is made and `GIT_ASKPASS` is `""` | test (`it.effect.prop`), 50 runs | Effect Arbitrary: credentialArb | (o) give the env `Redacted.value(password)`: the stand-in shows the password, red; write the password into the script: red; keep the folder after a failure: red; give every command of the call the env: red | kalfa/git/src/ProcessFetch.test.ts |
| F19, slice 2, [secrets] every `/process` output: with (o) and (v), the stand-in's `fetch` stderr says the user name and the password; `FetchFailed.stderr` holds `<redacted>` in their place; across the call no recorded argument, URL, stdin byte, plain env value, written file, span, log line or failure field holds either; 50 runs | test (`it.effect.prop`) | Effect Arbitrary: credentialArb | (v) drop the stderr scrub: red; put the credential in the URL (`https://u:p@...`): red; hand the password on stdin: red; scrub the password only: the user name stays, red | kalfa/git/src/ProcessFetch.test.ts |
| F20, slice 2, real git asks the script over HTTP: a local HTTP server that runs `git http-backend` and asks Basic auth for a drawn credential (o); with it the answer equals the remote's refs; with `none`, and with another password, `FetchFailed`; no output of F19's list holds the password; 5 runs, CI only | test (`it.effect.prop`), real git and a socket | Effect Arbitrary: credentialArb | (o) print `$1` (the prompt) in the script: login refused, red; answer the user name for both prompts: red; `echo $KALFA_GIT_PASSWORD` unquoted: a drawn password with two spaces or `*` changes, red | kalfa/git/src/ProcessRepository.integration.test.ts |
| F21, the package's exports: `EXPORTS` gains `./Remote` and `./Credentials`, and K1 to K4 still hold (no dependency, no other package of this repository named) | test (`it`) | scenario: the manifest | leave `./Credentials` out of the package manifest: red | kalfa/git/src/Package.test.ts |

Lint, type or test? F1 to F16 and F18 to F21 are behavior, so tests. F17 is a shape the compiler checks, so type. No
law here is a lint rule: the one shape rule a lint could hold ("no `Redacted.value` outside the spawn") would fire
in Code hosting's filler too, which must build the value, so it stays F18's plant.

**Host-only and CI-only laws.** No law needs launchd, a signal or the Electron app. F20, and F1 to F8 on real git,
run a real git and, for F20, a real socket, so they sit in `ProcessRepository.integration.test.ts`, which the laptop
refuses by name: they run in CI and in a proof run the lead starts, never narrowly here. Why F20 has no stand-in: the
stand-in proves what the adapter hands git (F18, F19); only a real git proves git runs the script with these prompts
and accepts its answer. Every behavior is first proved on the stand-in or `/memory` on every pull request.

## Files

Slice 2 branches from main after slice 1 lands. A file touched in both slices has a row for each.

| Slice | File | Owner | Product lines expected | Change |
|---|---|---|---|---|
| 1 | kalfa/git/src/Remote.ts | build | 95 | new: `Name`, `Url` and their checks, `Remote`, `named`, `url`, `NoSuchRemote`, `BadRemoteUrl`, `FetchFailed` |
| 1 | kalfa/git/src/Credentials.ts | build | 45 | new: `Credential`, `NoCredential`, `Credentials`, `none` |
| 1 | kalfa/git/src/Repository.ts | build | 40 | `fetch` in the service and its doc line, `Raw` gains `remoteUrl` and `fetch`, `make` writes `fetch` |
| 1 | kalfa/git/src/MemoryRepository.ts | build | 75 | `Remote`, `Remotes`, `layer`'s third argument, `remoteUrl`, `fetch` with the copy |
| 1 | kalfa/git/src/ProcessRepository.ts | build | 95 | the fetch pins, `remoteUrl`, `fetch`, the read back with the prefix taken off, the scratch cleanup; the header comment |
| 1 | kalfa/git/package.json | build | 2 | `./Remote` and `./Credentials` in `exports` |
| 1 | kalfa/git/README.md | build | docs | "Fetch", the top paragraph, "What it never does" |
| 1 | kalfa/git/GLOSSARY.md | build | docs | **Credential**: the one that gives none |
| 1 | kalfa/git/src/Fetch.test-support.ts | tests | tests | new: `FetchSubject`, `FetchSeeded`, `suite`, the carrier and classes (a) to (q), `credentialArb`, F1 to F8 |
| 1 | kalfa/git/src/Fetch.test.ts | tests | tests | new: the suite on `/memory` |
| 1 | kalfa/git/src/RepositoryTest.ts | tests | tests | re-exports `FetchTest` |
| 1 | kalfa/git/src/MemorySeed.test-support.ts | tests | tests | `memoryFetchSubject` |
| 1 | kalfa/git/src/ProcessSeed.test-support.ts | tests | tests | `processFetchSubject`: two bare repositories, the name in config, a path and a `file://` URL |
| 1 | kalfa/git/src/MemoryRepository.test.ts | tests | tests | F9 |
| 1 | kalfa/git/src/ProcessFetch.test.ts | tests | tests | new: F10 to F14, classes (r) to (v), its own `open` on the stand-in |
| 1 | kalfa/git/src/ProcessRepository.integration.test.ts | tests | tests | runs the fetch suite on real git |
| 1 | kalfa/git/src/Remote.test.ts | tests | tests | new: F15, F16, `urlArb`, classes (w) to (z) |
| 1 | kalfa/git/src/Fetch.types.test.ts | tests | tests | new: F17 |
| 1 | kalfa/git/src/Package.test.ts | tests | tests | F21: `EXPORTS` |
| 1 | .kalfa/quests/kalfa-git-fetch-credential-PLAN.md | lead | docs | this plan |
| 2 | kalfa/git/src/ProcessRepository.ts | build | 45 | the script, the folder in the call's scope, the env, the stderr scrub; `layer` needs `FileSystem` |
| 2 | kalfa/git/README.md | build | docs | how the credential reaches git, where it lives |
| 2 | kalfa/git/src/ProcessFetch.test.ts | tests | tests | F18, F19 |
| 2 | kalfa/git/src/ProcessRepository.test.ts | tests | tests | `open` and the other layer builds provide a `FileSystem` |
| 2 | kalfa/git/src/ProcessSeed.test-support.ts | tests | tests | the layer build provides the Node `FileSystem` it already has |
| 2 | kalfa/git/src/ProcessRepository.integration.test.ts | tests | tests | F20 |
| 2 | kalfa/git/src/HttpRemote.test-support.ts | tests | tests | new: the HTTP server over `git http-backend` with Basic auth, for F20 |

No new workspace package, so no lockfile change. No new layer rule. No setting changes.

## Who lands first, and the pull requests in flight

https://github.com/kamp-us/tea-fabrika/pull/2325 (`limits.kill`, ticket 2011) is open with its plan approved; its
build is pushed. https://github.com/kamp-us/tea-fabrika/pull/2315 (rebase, ticket 1936) has only its approved plan
pushed; its tests and build are under way in their own worktree. Files this plan shares with them:

| Shared file | 2325 | 2315 | This plan |
|---|---|---|---|
| kalfa/git/src/ProcessRepository.ts | `KILL_AFTER` goes; `child`, `runner`, `lister` take `kill`; `layer` | slice 1: `MERGE_PINS`, `PINNED`; slice 2: the runner takes an env per command, `replay` | slice 1: new `FETCH_PINS` beside `MERGE_PINS`, two new raw calls after `moveRef`, `calls` takes a runner with extra env; slice 2: `layer`'s requirement |
| kalfa/git/src/Repository.ts | none | slice 1: `CannotRebase`, `rebase` in the service, `Raw`, `make` | `fetch` in the service, `Raw`'s `Omit` list and two members, `make` |
| kalfa/git/README.md | Settings | Rebase section, pins table, "What it never does" | Fetch section, top paragraph, "What it never does" |
| kalfa/git/GLOSSARY.md | none | **Own commits** | **Credential** |
| kalfa/git/src/RepositoryTest.ts | `settings` gains `kill` | `suite` calls the rebase laws | one re-export line at the end |
| kalfa/git/src/ProcessRepository.test.ts | the second P3 law | P24, and stand-in laws that list `start`'s arguments | slice 2 only: the layer builds provide a `FileSystem` |
| kalfa/git/src/ProcessSeed.test-support.ts | none | a temporary clone for `git rebase` | a new `processFetchSubject`; slice 2: the layer build |
| kalfa/git/src/Package.test.ts | K5 at the end | none | `EXPORTS` at the top |
| kalfa/git/src/MemoryRepository.ts | none | slice 2: `rebase` answers none | the third `layer` argument, two raw calls |

How this plan stays clear:

- **New files hold the new laws:** `Fetch.test-support.ts`, `ProcessFetch.test.ts`, `Remote.test.ts`,
  `Fetch.types.test.ts`. None goes into `History.test-support.ts`, `Values.test.ts`, `Values.types.test.ts` or
  `Repository.types.test.ts`, which the two pull requests change, and the fetch suite has its own subject, so the
  shared `Subject` and `suite` stay as they are.
- **The errors and values live in `Remote.ts` and `Credentials.ts`,** so `Repository.ts` gains only the call.
- **Slice 1 branches after 2325 lands.** `runner` then takes `kill`, and the fetch's runner is built the same way.
- **2315 and slice 1 meet in `Repository.ts`'s service list, `Raw`'s `Omit` list and the end of `make`, and in
  `ProcessRepository.ts`'s `calls`.** Each adds members; neither edits the other's. Whichever lands second takes main
  in and joins the lists by hand: a few lines, no logic. The README's "What it never does" sentence ("Rebase, squash,
  fetch and push come in later tickets") is edited by both: the second drops its own word.
- **Slice 2 changes `ProcessRepository.layer`'s requirement,** which touches each layer build in
  `ProcessRepository.test.ts` and `ProcessSeed.test-support.ts`. It branches after slice 1, by when 2325 has landed;
  if 2315's slice 2 is open then, the second to land adds `Layer.provide` at the builds the other added.

## Existing tools

- `kalfa/git/src/Remote.ts`: searched `kalfa/` for a remote or URL value (`rg -n "RemoteName|RemoteUrl|insteadOf"`)
  and found none; `@kalfa/github` speaks GitHub's API, not git's remotes. The name check reuses `Ref.RefName`'s rule
  (`refs/remotes/<name>/x`), as git's own `valid_remote_name` does. The URL check uses the platform's `URL` parser,
  which a browser and Node both have, behind the control character check it needs; no npm package was searched for a
  git URL rule, since the rule is this package's own refusal list and not a general parser.
- `kalfa/git/src/Credentials.ts`: searched `kalfa/` for a credential or slot service (`rg -n "Credential|Redacted"`).
  `@kalfa/secrets` holds secrets by name and signs with them; it ranks above Configuration and would break 0047's rule
  that Source control imports no kalfa package. Effect's `Redacted` and `Schema.Redacted` hold the password.
- `remoteUrl` and `fetch` in `ProcessRepository.ts`: reuse `runner`, `succeeded`, `stdoutText`, `Parse.refs` and the
  `--count=<refs + 1>` rule of `readRefs`. Searched the file for a ref delete and found only `update-ref` for one ref;
  `update-ref --stdin` deletes several in one command.
- `fetch` in `MemoryRepository.ts`: reuses `readRefs`' rule and `add`; the copy walk is new, a dozen lines over
  `Store.commits`, beside `reach`, which walks one store only.
- `make`'s `fetch` in `Repository.ts`: reuses `limited`, as `rangePatchId` does around its two raw calls.
- Tests: the stand-in spawner (`standIn`) as it is, `traced` and `expectNamedSpan`, `textureArb`, `seedEach`, and
  `FileSystem.layerNoop` for F18's recorder. F20's server uses `node:http` and `git http-backend`, git's own CGI server;
  searched the repo for an HTTP git test server and found none.

## Is this a setting?

- **The fetch's time:** no new setting. `limits.time` bounds the call, as it bounds every call. A first fetch of a big
  remote can take longer than a plumbing call's limit; see Findings 1.
- **The pins** (`protocol.allow`, `http.sslVerify`, `http.followRedirects=false`, `credential.helper=`, the flags):
  no. Each closes a way the repository's config could send the credential elsewhere or change what a fetch writes,
  and the landed plans say the same of the merge and read pins.
- **`http.followRedirects=false`, 80%.** A renamed GitHub repository redirects, so its fetch fails `FetchFailed` until
  the app's config names the new URL. Following a redirect would send the credential to a host nobody named.
- **`http` to loopback only, 85%.** A credential over plain `http` to another host is a leak; a local test server and
  a local mirror need loopback.
- **The scratch prefix `refs/kalfa/fetch/`:** no, as the rebase plan says of its own.
- **Which filler:** the slot itself; the app picks one by name.

## New names

- `fetch`, `Remote`, `Credential`: git's own words, already in the glossary.
- `Credentials`: the slot's service, a plural service name, as the decided rule asks. `Credentials.none`: the filler
  that gives none, named as the ticket says, "like the hook that checks nothing".
- `Remote.Name`, `Remote.Url`, `Remote.named`, `Remote.url`: git's words ("remote name", "URL").
- `NoSuchRemote`, `BadRemoteUrl`, `FetchFailed`, `NoCredential`: errors named as the package's others are
  (`NoSuchCommit`, `GitTooOld`).
- `askpass`: git's own name for the program (`GIT_ASKPASS`), an industry term, not a domain word.
- `kalfa.git.remote`, `kalfa.git.credential`: span keys. OpenTelemetry's `vcs.*` names have no remote kind or login.

## Validation

- tests step, each slice: each new or changed law file alone, such as
  `nice -n 15 pnpm exec vitest run kalfa/git/src/Fetch.test.ts`, then `ProcessFetch.test.ts`, `Remote.test.ts`,
  `Fetch.types.test.ts`, `MemoryRepository.test.ts` and `Package.test.ts`, each red for the reason its row says before
  the build. Each plant by hand, undone. The integration file is not run here.
- build step: the same files green, then `pnpm format` and `pnpm lint`.
- The lead runs the changed set, the typecheck and a proof run of the integration laws (F1 to F8 on git, and F20 in
  slice 2) before the first review.

## Size

1. Slice 1, fetch with the slot, both adapters, no login reaches git: 352 lines (`Remote.ts` 95, `Credentials.ts` 45,
   `Repository.ts` 40, `MemoryRepository.ts` 75, `ProcessRepository.ts` 95, the manifest 2), the README and one
   glossary line, and about 1200 lines of laws. It lands whole: Delivery and the push ticket can fetch from a local
   path, a `file://` URL, a `/memory` remote and a public https remote on both adapters, and Code hosting's filler can
   be built and tested on `/memory`.
2. Slice 2, the credential reaches git: 45 lines (`ProcessRepository.ts` 45), the README, and about 450 lines of laws
   and the HTTP test server. It lands whole: a remote that needs a login fetches on `/process`.

About 397 product lines in all, 75% sure: the doubt is `/process`'s fetch, whose read back and cleanup may need a
helper shared with `readRefs`, and F20's server, which may need more lines to speak CGI. About 8 agent hours across
the steps. Steps: tests, build and one review per slice, and one likely send-back each. Priced at about $12 a step on
list prices, as the rebase plan's larger slices were: tests and build on Sonnet, the review on Opus.

Estimate: 8 steps, $96

## What this cannot tell us

- That git 2.38 and 2.39 take every flag. They were read in the docs from memory and run here only on 2.40.1; CI's
  git is the proof.
- That git runs `GIT_ASKPASS` with no shell and asks "Username" before "Password". That is from memory of git's
  `prompt.c` and `credential.c`; F20 is the first run that shows it.
- That `ls-remote --get-url` catches every rewrite. It applies `url.<base>.insteadOf`; `pushInsteadOf` is for pushes,
  and nothing else in a repository's config rewrites a fetch URL that this plan knows of.
- Whether a fetch of a big remote fits in `limits.time` as the app sets it (Findings 1).
- That the environment is a safe enough place. Anyone running as the same user can read a running process's
  environment; that is git's own trust zone for askpass and helpers, and this plan does not narrow it.
- What happens to the objects of refs the glob fetched and the answer left out (`main-2`): they stay unreferenced
  until a gc prunes them. Nothing here runs gc.

## Calls taken

- The slot is asked in `make`, once per call, with the URL `remoteUrl` gave: 90%. Both adapters then ask alike, and a
  named remote is asked with its configured URL, as ruling 7 says.
- The slot is the call's requirement, not the layer's: 75% (the doubt at the top).
- `fetch` takes one `under` and answers like `readRefs`: 80% (the doubt at the top).
- A fetch writes only scratch refs, under `refs/kalfa/fetch/<16 hex>/`, and deletes them before it answers: 85%. git
  needs a destination to say what it fetched, and the answer carries the refs, so no ref of this repository is left
  changed.
- Every fetch goes by URL, a named one resolved first: 85%. Then no `remote.<name>.*` key but the URL acts, and the
  slot is asked with the URL git uses.
- `--update-shallow`, then `HistoryTooShort` when the repository is shallow after the fetch: 85%. Without it git drops
  the ref and exits 0, which this plan's run showed.
- Refuse a URL the repository's config rewrites: 75%. It costs one local command per fetch and keeps the credential on
  the URL the slot was asked with; the doubt is whether a caller wants `insteadOf` to work, which nothing in the plan
  asks for today.
- The memory remote's `login`: 75%. Code hosting's ticket runs its filler on `/memory` and needs a remote that can say
  no.
- Two slices, slice 2 waiting on open question 1: 90%. Slice 1 is whole without it.

## Open questions

1. Askpass, as ruled, or a credential helper, git's own way, for slice 2? Lean: credential helper, 75%. Why: no file,
   no `FileSystem` in the layer, and it can refuse a host git was not asked for. Cost: rewords the parent's ruling.

## Findings

1. **A fetch's time limit is a plumbing call's.** `limits.time` (`kalfa/git/src/Settings.ts`) is "the longest one call
   may take", sized for local commands (the README's example is 10 seconds). A first fetch, or a push later, can take
   minutes. A ready ticket: "Git: a call that reaches a remote has its own time limit", adding a required
   `limits.remote` duration for fetch and push, after 2325's `limits.kill` lands in the same struct.
2. **P11's title will read wrong once fetch lands.** `kalfa/git/src/ProcessRepository.test.ts` names P11 "none reaches
   a remote" across every call. It lists no `fetch` call, so it stays true, but the README's line that the package
   "sends nothing to a remote" changes in slice 1. In scope for slice 1's README change; listed so the review checks the
   wording.
