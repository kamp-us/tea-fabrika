
Plancheck-Version: 3

# Plan: @kalfa/git, fetch from a remote by name or by URL, with a credential asked on each fetch (ticket 1938)

This is the kalfa packages (`kalfa/`), new work. It is not today's frozen version and not `next/`. The ticket is
https://github.com/kamp-us/tea-fabrika/issues/1938, a GitHub issue under Source control's protocol
(https://github.com/kamp-us/tea-fabrika/issues/1750), so the first pull request says `Refs #1938`, the last
`Closes #1938`, and neither carries a `fabrika close ticket` line. Two slices, each its own pull request. Slice 1
branches from main (https://github.com/kamp-us/tea-fabrika/pull/2325 has landed). Slice 2 branches from main after
slice 1 lands, and its build waits for the owner's answer to the one open question.

Revised after one review round (2026-11-27): the transfer now runs in a fresh git directory of its own, so no
repository config steers it (review point 1); the slice 2 scrub is rebuilt (point 2); a shallow remote no longer leaves
the repository shallow (point 3); the cleanup is the temporary folder's release (point 4); the open question carries
the argv fact (point 5); the merge story is current (point 6); the `/memory` login is cut and loopback `http://` moves
to slice 2 (point 7).

```ts
// The whole idea, a sketch. Delivery lands a change: it fetches main, rebases onto it, and pushes with a lease on it.
const repo = yield* Repository.Repository;
const [main] = yield* repo.fetch({ remote: Remote.named(origin), under: refName("refs/heads/main") });
// ReadonlyArray<Ref>: the remote's refs at and below `under`, sorted by UTF-8 bytes. [] means git proved the remote
// holds none. The repository then holds each answered commit and its history. No ref of this repository moved, and
// its config, refs and shallow file are as they were.
// The call asked the Credentials slot once, with the remote's URL (the configured one for a named remote).
// Fails NoSuchRemote, BadRemoteUrl, NoCredential, FetchFailed, HistoryTooShort, TooMany or RefNotCommit; never [].

// The call's requirement is the slot, so the program picks a filler at the top, by name:
program.pipe(Effect.provide(Credentials.none)); // a local path, a /memory remote, a public remote
program.pipe(Effect.provide(CodehostGit.credentials)); // later, ticket 1968: from an access grant
```

## Doubts, read first

- **The ruling says "askpass helper"; git's own non-interactive way is a credential helper. Open question 1.** Slice 2
  is written to the ruling. Slice 1 does not depend on the answer.
- **The slot is the call's requirement, not the layer's, 75%.** `fetch` returns `Effect<..., ..., Credentials>`.
  Effect's own guide builds a service's needs into its layer. Here the slot is asked on every call and a program that
  never fetches never picks one. The cost: a service method with a requirement, which Effect's guide does not show.
  What would settle it: the review or the lead preferring the layer. Then `make` takes the service at build and every
  layer build provides `Credentials.none`, about 15 lines more in tests.
- **`fetch` takes one `under`, the shape `readRefs` takes, 80%.** It fits how git fetches (one glob refspec), and it
  gives the push ticket (https://github.com/kamp-us/tea-fabrika/issues/1940) the proof that a ref is gone: an empty
  answer. A caller that needs two folders fetches twice.
- **The transfer runs in a fresh git directory, 85%.** Measured below: it reads none of the repository's config, keeps
  `shallow` and the scratch refs out of the repository, and with `--negotiation-tip` downloads only what is missing.
  The cost: `ProcessRepository.layer` needs `FileSystem` from slice 1, so every layer build in the tests provides one.

## Records read

- `AGENTS.md`, `kalfa/AGENTS.md` (Source control imports no kalfa package and ranks lowest), `kalfa/git/README.md`,
  `kalfa/git/GLOSSARY.md` (Remote, Fetch, Credential, Pre-push hook), `kalfa/git/package.json`.
- Code on main: `kalfa/git/src/Repository.ts` (the service, `Raw`, `make`), `ProcessRepository.ts` (`start`,
  `PINNED`, `child`, `runner`, `readRefs`, `layer`; `runner` takes `kill` since 2325), `MemoryRepository.ts` (`Store`,
  `layer`, `point`), `Settings.ts`, `Ref.ts`, `RepositoryTest.ts` (`Subject`, `Seeded`, `settings`),
  `CommitEdit.test-support.ts` (a law suite beside `/test`), `MemorySeed.test-support.ts`,
  `ProcessSeed.test-support.ts`, `StandIn.test-support.ts` (it already shows a `Redacted` env value as `<redacted>`),
  `Laws.test-support.ts` (`traced`, `expectNamedSpan`), `ProcessRepository.test.ts` (P11, `open`),
  `ProcessRepository.integration.test.ts` (suites at 6 runs), `Package.test.ts` (`EXPORTS`).
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
- Plans: `.kalfa/quests/kalfa-git-kill-wait-PLAN.md` (landed with 2325) and `.kalfa/quests/kalfa-git-rebase-PLAN.md`
  (on branch `fabrikalfa/kalfa-git-rebase`, with that pull request's whole diff as the review saw it: 13 files).
- The review of this plan's first draft, and its tryouts on git 2.40.1: URL-scoped keys in the repository's config
  beat a `-c` pin (`http.<url>.sslVerify=false` beats `-c http.sslVerify=true`; `sslCAInfo`, `proxy` and
  `extraHeader` likewise), `remote.<url>.uploadpack` ran a chosen command on a `file://` fetch, the user name sits in
  the askpass prompt, and an `Effect.timeoutOrElse` waits for the interrupted call's finalizer before it answers.
- Installed versions from the lockfile: `effect` 4.1.3 (patched; the patch touches only `TestConsole` and the
  arbitrary model), `@effect/platform-node` 4.1.3, `@effect/vitest` 4.1.3, `vitest` 5.0.5. Read in the installed
  source: `effect/process/ChildProcess` takes `Redacted<string>` env values ("passed to the child unchanged and never
  shown in errors"), and `@effect/platform-node-shared`'s `NodeChildProcessSpawner` unwraps them only when it spawns;
  `Schema.Redacted(schema, { disallowJsonEncode })`; `Redacted`'s `toString` and `toJSON` print `<redacted>`;
  `effect/FileSystem` has `makeTempDirectoryScoped` (its release removes the folder), `writeFileString` with a `mode`,
  and `layerNoop` for tests.
- Run by hand by this plan step on the laptop's git 2.40.1, in scratch bare repositories with no user or system config:
  - A refspec `+refs/heads/main*:<dest>/refs/heads/main*` fetches `main` and `main-2`, exits 0, and writes no
    `FETCH_HEAD` with `--no-write-fetch-head`. An exact refspec for a ref the remote lacks exits 128; a glob that
    matches nothing exits 0.
  - **From a shallow remote, without `--update-shallow`, git exits 0 and leaves the ref out**, printing only `warning:
    rejected <ref> because shallow roots are not allowed to be updated`. Read as an answer, that is "the remote has no
    such ref": the guess the ticket forbids. With `--update-shallow` the ref comes, and the git directory is shallow.
  - `-c protocol.allow=never` with no `protocol.file.allow` refuses a local path and a `file://` URL, and `ext::`.
  - `git config --null --get-all remote.<name>.url` exits 1 for a missing name and prints each value NUL-ended.
  - **The fresh git directory (design b), measured.** A remote of 200 commits, the repository holding the first 199. A
    fetch in the repository itself took 3 new objects. A fetch with `--git-dir=<fresh>` and
    `GIT_OBJECT_DIRECTORY=<repo>/objects` and no tips took 600, the whole history again. The same with
    `--negotiation-tip=<the repository's tip id>` took 3, and so did copying the tip in as a ref. So tips as arguments
    cost nothing: no ref is written anywhere.
  - In that fresh directory, a repository config holding `remote.<file url>.uploadpack` that touches a file, a
    `url.<other>.insteadOf=<url>` that sends the fetch elsewhere, and a `credential.helper` that touches a file: none
    acted, and the fetch reached the URL it was given. In the repository itself, the `uploadpack` ran and the
    `insteadOf` sent the fetch to the other repository.
  - From a shallow remote, the fresh directory became shallow (`rev-parse --is-shallow-repository` there said `true`)
    and the repository stayed `false`. The fetched objects sit unreferenced in the repository; `rev-list` on their tip
    there fails with "Could not read", exit 128, never an answer.
  - Into a repository that is already shallow, the fresh directory does not know the cut, and the fetch fails "did not
    send all necessary objects", exit 1. So a shallow repository is refused before the transfer.
  - `git --git-dir=<new> init --bare --quiet --template=` makes the directory, with `start`'s pins on.

## How others do it

- **git itself.** `gitcredentials(7)` gives two ways for a program to supply a login: `GIT_ASKPASS` (or
  `core.askPass`), a program git runs with the prompt as its one argument, reading the answer's first line from its
  stdout, asked once for the user name ("Username for '<url>': ") and once for the password ("Password for
  '<scheme>://<user>@<host>': ", so the user name is in that program's argv); and a credential helper, which git runs
  with `get` and feeds `protocol=`, `host=` and `path=` lines on stdin, and which answers `username=` and `password=`
  lines. A helper string that starts with `!` runs in the shell. Git runs the askpass program with no shell, so it must
  be a file on disk. (From memory, not fetched; the review's tryout saw the prompts.)
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
 * A remote's URL as this package takes it: `https://host[:port]/path`, `file:///abs/path`, or an absolute path.
 * No user, password, query or fragment, no space or control character, so no credential can ride in a URL and nothing
 * the WHATWG parser drops can hide a host. `http://`, `ssh://`, `git@host:path`, `ext::`, `fd::` and relative paths are
 * refused. Slice 2 lets `http://` through to a loopback host only (127.0.0.1, ::1, localhost).
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
 * A named remote's config holds several URLs (`several`) or one `Url` refuses (`refused`). It never holds the
 * configured text, which may hold a password.
 */
export class BadRemoteUrl extends Schema.TaggedError<BadRemoteUrl, { readonly brand: unique symbol }>()("BadRemoteUrl", {
  name: Name,
  reason: Schema.Literals(["several", "refused"]),
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
// One line of text: no CR, LF or NUL, since git reads the first line of what a helper prints.
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
/** This repository's named remotes, as git's config holds them, and what each URL reaches: another store, read as it is at each fetch. */
export interface Remotes {
  readonly names: ReadonlyMap<RemoteValues.Name, RemoteValues.Url>;
  readonly stores: ReadonlyMap<RemoteValues.Url, Effect.Effect<Store>>;
}

export const layer = (store: Store, settings: Settings.Settings, remotes: Remotes = NO_REMOTES) => ...
```

- `remoteUrl`: a name not in `names` fails `NoSuchRemote`; a `Url` is answered as given.
- `fetch`: a store already shallow fails `HistoryTooShort` before anything is read. A URL not in `stores` fails
  `FetchFailed` (code 128, stderr "no repository at that URL"). Then it reads the remote's refs at and below `under`
  (the `readRefs` rule) and copies every commit they reach that this store lacks, with its tree's files and blobs.
  When a reached commit is one of the remote's shallow commits, it copies the commits it has and fails
  `HistoryTooShort`, and this store's `shallow` stays as it was, as `/process` leaves it. It fails `TooMany` past
  `limits.refs` after the copy, as git has fetched by then. It moves no ref of this store.

### `/process` (`kalfa/git/src/ProcessRepository.ts`)

`remoteUrl`, for a name: `config --null --get-all remote.<name>.url`, read in the repository. Exit 1 is
`NoSuchRemote`; any other non-zero exit is `GitUnavailable`; not exactly one value is `BadRemoteUrl` `several`; a value
`Url` refuses is `BadRemoteUrl` `refused`. Nothing else of the repository's config is read for a fetch, and nothing of
it acts on the transfer, so a named remote's URL is the configured text exactly: no `insteadOf` applies.

`fetch` runs the transfer in a fresh git directory made for the call, the design the review's point 1 called (b):

```text
in the repository:
git <start(repo)> rev-parse --is-shallow-repository --path-format=absolute --git-path objects
    "true": HistoryTooShort, before any transfer; the second line is the object folder
git <start(repo)> for-each-ref --count=<refs> --format=%(objectname) refs/
    the tips git tells the remote it has; past `limits.refs` only the first ones, which costs download, never an answer

in a folder from FileSystem.makeTempDirectoryScoped, with GIT_OBJECT_DIRECTORY=<object folder> on every command:
git <start(<tmp>/fetch.git)> init --bare --quiet --template=
git <start(<tmp>/fetch.git)> -c protocol.allow=never -c protocol.file.allow=always -c protocol.https.allow=always
    fetch --quiet --no-tags --no-write-fetch-head --no-recurse-submodules --update-shallow
          --no-auto-gc --no-auto-maintenance --no-write-commit-graph --negotiation-tip=<tip> ...
          -- <url> +<under>*:refs/fetched/<under>*
git <start(<tmp>/fetch.git)> rev-parse --is-shallow-repository      "true": HistoryTooShort
git <start(<tmp>/fetch.git)> for-each-ref --count=<refs + 1> --format=%(objectname) %(objecttype) %(symref) %(refname)
    refs/fetched/<under>                                            the readRefs rule: exact, and below `under/`
```

- **Why this closes every way in.** git reads config from the system, the user and the git directory. The first two
  are already `/dev/null`, and the git directory is the fresh one, whose config `init` wrote. So no
  `http.<url>.*` key (`sslVerify`, `sslCAInfo`, `proxy`, `extraHeader`, `cookieFile`), no
  `remote.<url>.uploadpack`, no `url.<base>.insteadOf`, no `credential.*`, no `core.askPass`, no `fetch.*`
  (`bundleURI`, `negotiationAlgorithm`, `recurseSubmodules`), no `include.path` and no key added by a later git acts.
  One rule, no list to keep current. The repository's objects are the only thing it shares.
- **What lands in the repository:** only objects, in its object folder. Its refs, config and `shallow` file are never
  written: the scratch refs and any `shallow` file live in the fresh directory.
- Env of the transfer in slice 1: `PATH`, `PINNED` (the constant, as it is on main or as 2315 grows it),
  `GIT_OBJECT_DIRECTORY`, and `GIT_ASKPASS=""`, so git never prompts.
- A non-zero exit of `fetch` is `FetchFailed { url, code, stderr }`, never `[]`. The glob matches `main-2` too; the
  read back leaves it out, as `readRefs` does. Its objects stay, unreferenced, as any fetched object does until gc.
- The read back names the remote's ref (the `refs/fetched/` prefix taken off), and a ref at a tag fails
  `RefNotCommit` naming the remote's ref.
- **The cleanup is the folder's release.** `makeTempDirectoryScoped` opens the folder in an `acquireRelease`, and its
  release removes the whole folder, every scratch ref, `.lock` file and `shallow` file in it, after every ending: an
  answer, a failure, an interruption and `TimedOut`. The release is bounded by `limits.kill`, since a time limit waits
  for the interrupted call's finalizers before it answers (the review's tryout). A release that fails or runs out of
  time is dropped, and never replaces the call's own answer or failure.
- **What a hard kill leaves:** the temporary folder, outside the repository, and any partial pack git was writing in
  the repository's object folder (`objects/pack/tmp_pack_*`), which git's own gc removes. No ref, lock or `shallow` file
  of the repository.

### Slice 2: the credential reaches git (to the ruling: askpass)

- For a fetch whose slot gave `Some(credential)`, `/process` writes the fixed script below into the call's temporary
  folder with mode `0o700`, and runs the transfer with `GIT_ASKPASS=<tmp>/askpass`, `KALFA_GIT_USERNAME` and
  `KALFA_GIT_PASSWORD`, both as `Redacted`. No other command of the call gets them.
- `Url` lets `http://` through to a loopback host, for the HTTP test server and a local mirror, and the transfer gains
  `-c protocol.http.allow=always`. A credential over plain `http` to any other host is refused at the URL.
- **The scrub of `FetchFailed.stderr`.** git's stderr is read up to `limits.bytes` plus the longest secret's length;
  every occurrence of the non-empty values among the user name and the password is replaced by `<redacted>` in one
  pass of one alternation, longest value first; then the text is cut to `limits.bytes`. So a user name inside the
  password never leaves part of the password, a secret that the cut would split is still whole when it is scrubbed,
  and an empty field adds no empty pattern, which would match everywhere.

```sh
#!/bin/sh
# git runs this with its prompt as $1. It prints the user name or the password, never the prompt.
case $1 in
Username*) printf '%s\n' "$KALFA_GIT_USERNAME" ;;
*) printf '%s\n' "$KALFA_GIT_PASSWORD" ;;
esac
```

If the owner picks the credential helper (open question 1): no script file. The transfer's env gets
`GIT_CONFIG_COUNT=2`, `credential.helper` set empty and then to a `!` snippet that answers `get` with `username=` and
`password=` from the same two variables, only when the `host=` line git sends on stdin equals the URL's host. The user
name then reaches no argv. F18's file checks become checks on the two config entries; every other law stays.

### Where the credential lives, and for how long

| Where | How long | Reaches |
|---|---|---|
| The filler's answer, a `Credential` whose password is `Redacted` | from `ask` to the end of the one `fetch` call | `make`, then `raw.fetch` as an argument; nothing stores it: no `Ref`, `Cell`, cache, `Store` or layer value |
| `/memory` | the same call | nowhere: the memory transfer needs no login |
| `/process`, slice 2 | the one `git fetch` child | its environment, as `Redacted` until Effect's Node spawner unwraps it at spawn; git's own children (`git-remote-https`, the askpass script) inherit it; the script prints it to git over a pipe |

It never reaches a span, a log, an error, a file, a command line, a URL, stdin, a ref or any config. The askpass script
is a fixed text that holds no secret. Two places are plain to the same user and root: the transfer's environment, and,
with askpass, the user name in the script's argv, which `ps` shows (open question 1).

### What the README and the glossary gain

- `kalfa/git/README.md`: a "Fetch" section (the call, its checks in order, why the transfer runs in a fresh git
  directory and what it shares with the repository, the flags, what a hard kill leaves, that a named remote's URL is
  read as configured with no `insteadOf`, that a fetch from a shallow remote fails and leaves the repository as it was,
  where the adapters differ: memory has no tags and no transport), the top paragraph and "What it never does" (fetch
  reads a remote and changes nothing on it; only a push will change one), and in slice 2 how the credential reaches
  git.
- `kalfa/git/GLOSSARY.md`, **Credential**: "A repository that fetches only from remotes with no login picks the one
  that gives none, by name." This is the one glossary change: every other word here is git's own and is already there.

## One value traced through

1. Delivery runs `repo.fetch({ remote: Remote.named("origin"), under: "refs/heads/main" })`, with
   `Credentials.none` provided at the top. Its local `refs/heads/main` is at `a1`.
2. `make` opens the span `git.fetch` with `kalfa.git.remote: "named"`, `kalfa.git.under: "refs/heads/main"`.
3. `/process` `remoteUrl`: `config --null --get-all remote.origin.url` prints `https://github.com/kamp-us/x.git\0`. It
   decodes as a `Url`.
4. `make` asks the slot with that URL. `none` answers `Option.none()`. The span gets `kalfa.git.credential: false`.
5. `rev-parse` in the repository prints `false` and the object folder. `for-each-ref` prints the tips, `a1` among them.
6. A temporary folder opens, and `init` makes `fetch.git` in it.
7. `fetch --negotiation-tip=a1 ... -- https://github.com/kamp-us/x.git +refs/heads/main*:refs/fetched/refs/heads/main*`,
   with `GIT_OBJECT_DIRECTORY` set and `GIT_ASKPASS=""`. The remote holds `main` at `b2` and `main-old` at `c3`. Only
   their new objects arrive, into the repository's object folder. Exit 0.
8. `rev-parse --is-shallow-repository` in `fetch.git` prints `false`.
9. `for-each-ref --count=1001 ... refs/fetched/refs/heads/main` prints `b2 commit refs/fetched/refs/heads/main`.
   `main-old` sits beside it, not below it, so it is not listed.
10. The folder's release removes `fetch.git`. The answer is `[{ name: "refs/heads/main", commit: "b2" }]`,
    `kalfa.git.refs: 1`. The local `refs/heads/main` is still at `a1`. `walk({ include: [b2], exclude: [a1] })` now
    answers.

With `under: "refs/heads/gone"`, step 7 matches nothing and exits 0, step 9 prints nothing, and the answer is `[]`: the
proof a delete push needs. With a shallow remote, step 8 prints `true`, the call fails `HistoryTooShort`, and the
repository's `rev-parse --is-shallow-repository` still prints `false`.

## Generators

One fetch carrier, drawn from `textureArb`, builds a remote history, a local history and the cases, and returns the
classes it reached; F1 asserts the list equals `FETCH_CLASSES`, as the other carriers do.

- (a) `under` names one ref the remote holds, exactly: a branch, and a ref outside the branches such as
  `refs/kalfa/candidates/<x>`.
- (b) `under` names a folder with two or more refs below it.
- (c) beside (a), a remote ref that only shares its text (`<under>-2`), which the answer leaves out.
- (d) `under` names nothing the remote holds: the answer is `[]`.
- (f) the local repository already holds part of the remote's history, an answered tip included, and a branch of
  the same name at another commit.
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

For the `/process` laws, on the stand-in and on real git:

- (r) a named remote whose config holds two URLs, or one URL with a user and a canary password
  (`https://u:<canary>@host/r`).
- (t) a repository config that holds a way in to the transfer: `remote.<url>.uploadpack` that touches a file,
  `url.<other>.insteadOf=<url>` that points at another remote, `credential.helper` and `core.askPass` that touch a file,
  `fetch.recurseSubmodules=true`, `include.path` to a file that sets all of these; and in slice 2's HTTP law,
  `http.<url>.extraHeader` with a canary, `http.<url>.proxy` at a closed port and `http.<url>.sslVerify=false`.
- (u) a remote ref at a tag object: `for-each-ref` prints `tag`.
- (v) a `fetch` that exits non-zero with stderr, 1 and 128.

For the slice 2 scrub:

- (e) a password that holds the user name inside it, and a user name that holds the password.
- (g) a secret that `limits.bytes` would cut in two: stderr whose secret starts a few bytes before the limit.
- (s) an empty user name, and an empty password, beside a non-empty other field.

For the values:

- (w) texts that pass the WHATWG parse as `https` with no user, query or fragment, but hold a tab, a LF or a CR, which
  the parser drops (`https://exa\tmple.com/r` reads as `example.com`): only the control character check refuses them.
- (x) `https` URLs with a user, and with a user and a password, with no control character.
- (y) `http://` to a host that is not loopback; and, in slice 2, `http://127.0.0.1`, `http://[::1]` and
  `http://localhost`, which pass.
- (z) a relative path, a leading `-`, `ext::`, `fd::`, `ssh://`, `git@host:path`, a query and a fragment.

## Laws

Shared laws (F1 to F8) live in `kalfa/git/src/Fetch.test-support.ts` with its own `FetchSubject`, beside `/test` as
the commit edit laws are, and `RepositoryTest.ts` re-exports `FetchTest` so `/test` ships them. They run on `/memory`
in `kalfa/git/src/Fetch.test.ts` at 100 runs and on real git in `ProcessRepository.integration.test.ts` at 3 runs:
2315's plan puts that file at about 550 s of CI's 1020 s step, so the lead's proof run measures the fetch suite and cuts
runs past 850 s. Each law provides `Credentials.none`, a recorder that counts asks and then answers as `none` does, or
the canary filler (o). Seed 119120.

| Law | Kind | Generator | Plant | Test file |
|---|---|---|---|---|
| F1, the answer: for (a) to (d), (f), (h) and (j), the answer equals the model of the remote's refs at and below `under`, sorted by UTF-8 bytes, and each answered commit, and every commit it reaches, reads back with `readCommit` equal to the remote's; the carrier reached every class; 100 runs on memory, 3 on git | test (`it.effect.prop`) | Effect Arbitrary: textureArb | (c) read back by text prefix (`startsWith(under)`): `<under>-2` is answered, red; (a) fetch only `<under>/*`: the exact ref is missing, red, and fetch only under `refs/heads/`: the candidate ref is missing, red; (b) fetch only the exact ref: red; (f) answer only refs whose commit was new to this repository: red | kalfa/git/src/Fetch.test-support.ts |
| F2, nothing of this repository changes but its objects: for every class, an answer or a failure, `readRefs` of `refs/heads`, `refs/kalfa`, `refs/remotes`, `refs/tags` and `refs/fetched` are as they were, and a store that was not shallow is still not shallow (memory: `MemoryStore.get`'s `shallow`; process: the repository's `rev-parse --is-shallow-repository`); 100 runs | test (`it.effect.prop`) | Effect Arbitrary: textureArb | (f) fetch with git's default mapping, into `refs/heads/*`: the local branch moves, red; run the transfer in the repository itself: the scratch refs land there, red; (l) mark the remote's shallow commits in this store: the store turns shallow, red | kalfa/git/src/Fetch.test-support.ts |
| F3, by name or by URL: (h) and each URL of (j) answer the same; (i) fails `NoSuchRemote` naming the name; (k) fails `FetchFailed` naming the URL; neither is `[]`; 100 runs | test (`it.effect.prop`) | Effect Arbitrary: textureArb | (h) fetch a named remote by passing its name as the URL: git reads `origin` as a path, red; (i) treat an unknown name as a URL: `FetchFailed`, red; (k) map `FetchFailed` to `[]`: red; (j) look a URL up among the names first: an unnamed URL fails, red | kalfa/git/src/Fetch.test-support.ts |
| F4, a fetch that cannot answer fails: (l) and (q) fail `HistoryTooShort`, (q) with no transfer run and the store as it was; (n) fails `TooMany` with `limit: "refs"` at one past the limit, and answers at exactly the limit; (d) answers `[]` only where the model holds no ref; 100 runs | test (`it.effect.prop`) | Effect Arbitrary: textureArb | (l) drop `--update-shallow`, and in memory leave out refs that reach a cut: `[]`, red; (q) check only the fetched directory: the transfer runs and fails `FetchFailed`, red; (n) count with `>=`: exactly the limit fails, red; (d) answer `[]` on `HistoryTooShort`: red | kalfa/git/src/Fetch.test-support.ts |
| F5, no answer is kept: (m) the second fetch answers the moved commit, and the commit it now names reads back; 100 runs | test (`it.effect.prop`) | Effect Arbitrary: textureArb | (m) keep each answer by URL and `under` in the layer: the old commit, red | kalfa/git/src/Fetch.test-support.ts |
| F6, the slot is asked once on every fetch, with the URL: two fetches give the recorder two asks; each holds the URL of (j), and for (h) the configured URL; (p) fails `NoCredential` and the store is as it was (memory: `fingerprint`; process: its objects count and F2's reads), and, on process, no transfer ran (F10); 100 runs | test (`it.effect.prop`) | Effect Arbitrary: textureArb | ask once per layer (`Effect.cached`): one ask, red; ask with the name text: red; (p) fetch first, then ask: the store changed, red | kalfa/git/src/Fetch.test-support.ts |
| F7, [secrets] the credential stays out of every output: with (o), across fetches in (a), (i), (k), (l) and (n), neither the user name nor the password is in any span's name, attribute or event (all spans of the trace), any log line (a logger that records each message and annotation), the answer, any failure (`JSON.stringify`, `String`, `Cause.pretty` and each field), or the memory store (`MemoryStore.get`, JSON with `Redacted` shown); 100 runs | test (`it.effect.prop`) | Effect Arbitrary: credentialArb | (o) annotate `git.fetch` with the user name: red; `Effect.logDebug` the credential's password value in `make`: red; put the user name in `FetchFailed.stderr` in memory: red; memory keeps the last credential in its cell: red | kalfa/git/src/Fetch.test-support.ts |
| F8, the span: each fetch makes one `git.fetch`, ended, with `kalfa.git.remote`, `kalfa.git.under`, `kalfa.git.credential` and, on an answer, `kalfa.git.refs`; no key holds the URL, the name or a path; `hidden` (both repositories' paths) is in no `git.` span; 100 runs | test (`it.effect.prop`) | Effect Arbitrary: textureArb | put the URL in the span: red; write `fetch` with `Effect.fnUntraced`: no span, red; annotate the count before the call: wrong count, red | kalfa/git/src/Fetch.test-support.ts |
| F10, the commands of a fetch, on the stand-in: for (h), `config --null --get-all remote.<name>.url` in the repository; `rev-parse --is-shallow-repository --path-format=absolute --git-path objects` and `for-each-ref` in the repository; then `init`, `fetch`, `rev-parse` and `for-each-ref`, each with `--git-dir` naming `fetch.git` in the folder the `FileSystem` recorder made, never the repository; `fetch` with exactly the flags above, one `--negotiation-tip` per tip, `--` before the URL, the URL as given and one refspec `+<under>*:refs/fetched/<under>*`; the transfer's env is exactly `PATH`, `PINNED` (imported, not copied), `GIT_OBJECT_DIRECTORY` naming the object folder git printed, and `GIT_ASKPASS=""`; (p) and (q) make no folder and run no `fetch` | test (`it.effect`) | scenario: stand-in replies for each verb, with a `FileSystem.layerNoop` recorder | (t) run the transfer with the repository's `--git-dir`: red; drop `GIT_OBJECT_DIRECTORY`: the objects stay in the folder, red; drop `--update-shallow`: red; drop `--`: red; drop `protocol.allow=never`: red; drop the tips: red; (p) ask the slot after `fetch`: red | kalfa/git/src/ProcessFetch.test.ts |
| F11, a named remote's config: exit 1 fails `NoSuchRemote`; (r) fails `BadRemoteUrl` `several` for two URLs, and `refused` for the URL with a password, and no failure field, span or log holds any part of the configured text; no transfer ran in either | test (`it.effect`) | scenario: config replies | (r) read the value with `--get`, the last one: red; put the configured text in the failure: red | kalfa/git/src/ProcessFetch.test.ts |
| F12, (t) no way in acts, on real git: with each key of (t) in the repository's config, a fetch by name and by URL answers the remote's refs, the touched files do not exist, and the answer is the given remote's, not the `insteadOf` one's; 3 runs, CI only | test (`it.effect`), real git | scenario: a repository config of every (t) key | (t) run the transfer in the repository with `-c` pins only: the `uploadpack` and `credential.helper` files appear, red; read `ls-remote --get-url` for the URL: the `insteadOf` remote answers, red | kalfa/git/src/ProcessRepository.integration.test.ts |
| F13, (u) a remote ref at a tag fails `RefNotCommit` naming the remote's ref, not the `refs/fetched/` name | test (`it.effect`) | scenario: `for-each-ref` prints a tag | (u) name the scratch ref in the failure: red | kalfa/git/src/ProcessFetch.test.ts |
| F14, (v) a `fetch` that exits 1 or 128 fails `FetchFailed` with the code and the stderr git said; after an answer and after `FetchFailed`, `TooMany`, `HistoryTooShort`, `RefNotCommit` and `TimedOut` (a hang, with `TestClock`) the recorder saw the folder removed; a removal that fails, or hangs past `limits.kill`, leaves the call's own answer or failure as it was, and the call ends within `limits.time` plus `limits.kill` | test (`it.effect`) | scenario: stand-in replies and a `FileSystem` recorder whose remove fails or hangs | (v) read exit 1 as an answer: `[]`, red; remove the folder only after an answer: red; let the removal's failure replace the call's: red; leave the release unbounded: the hang holds the call, red | kalfa/git/src/ProcessFetch.test.ts |
| F15, the URL: every text of (w) to (z) is refused (slice 2: except the loopback ones of (y)); `https://host/path`, `https://host:8443/a/b.git`, `file:///abs/r.git` and `/abs/r.git` pass, each decoding to itself; 200 runs | test (`it.prop`) | Effect Arbitrary: urlArb | (w) delete the control character check: the tab URL passes, red; (x) delete the user check: red; (y) take `http` to any host: red, and in slice 2 refuse it everywhere: the loopback ones fail, red; (z) take a relative path: red | kalfa/git/src/Remote.test.ts |
| F16, the name and the credential: a name passes exactly when `refs/remotes/<name>/x` is a `RefName` and it does not start with `-`; a credential refuses a CR, LF or NUL in either field; its password decodes to `Redacted`, whose `String` is `<redacted>`, and JSON encoding the credential fails; 200 runs | test (`it.prop`) | Effect Arbitrary: credentialArb | take `-x` as a name: red; drop the line check on the password: red; declare the password `Schema.String`: JSON holds it, red | kalfa/git/src/Remote.test.ts |
| F17, the types: `fetch`'s requirement is exactly `Credentials` (a program that yields it and is run with no `Credentials` does not compile); its error union is exactly the seven above with `Fails`; `Remote.url("https://x/y")` with a plain string does not compile; `Credential["password"]` is `Redacted<string>`; `Credentials.none` is `Layer<Credentials>`; `Raw` has `remoteUrl` and `fetch` and no `Credentials`; `ProcessRepository.layer` needs `ChildProcessSpawner` and `FileSystem` | type (`expectTypeOf` and `@ts-expect-error`) | type | capture the slot at layer build (`R` never): the `@ts-expect-error` goes unused, red; declare the password `string`: red | kalfa/git/src/Fetch.types.test.ts |
| F18, slice 2, the credential reaches the transfer only: with (o), the `fetch` command's env holds `GIT_ASKPASS` naming `askpass` in the call's folder, and `KALFA_GIT_USERNAME` and `KALFA_GIT_PASSWORD` as `Redacted` (the stand-in shows `<redacted>`); no other command holds them; the file written is the fixed script, mode `0o700`, holding neither value; with `none` no script is written and `GIT_ASKPASS` is `""`; 50 runs | test (`it.effect.prop`) | Effect Arbitrary: credentialArb | (o) give the env `Redacted.value(password)`: the stand-in shows the password, red; write the password into the script: red; give every command of the call the env: red | kalfa/git/src/ProcessFetch.test.ts |
| F19, slice 2, [secrets] every `/process` output: with (o), (e), (g), (s) and (v), the stand-in's `fetch` stderr says the user name and the password, whole, inside each other and across the `limits.bytes` mark; `FetchFailed.stderr` holds `<redacted>` in their place, no part of either remains, and it is at most `limits.bytes`; across the call no recorded argument, URL, stdin byte, plain env value, written file, span, log line or failure field holds either; 50 runs | test (`it.effect.prop`) | Effect Arbitrary: credentialArb | (v) drop the scrub: red; (e) replace the user name first, one value at a time: the rest of the password stays, red; (g) cut to `limits.bytes`, then scrub: half the secret stays, red; (s) keep empty values in the alternation: every gap matches and the text fills with `<redacted>`, red; put the credential in the URL (`https://u:p@...`): red; hand the password on stdin: red | kalfa/git/src/ProcessFetch.test.ts |
| F20, slice 2, real git over HTTP: a local HTTP server that runs `git http-backend` and asks Basic auth for a drawn credential (o); with it the answer equals the remote's refs; with `none`, and with another password, `FetchFailed`; with every slice 2 key of (t) in the repository's config, the server saw no canary header, no request went to the proxy port, and the fetch still answered; no output of F19's list holds the password; 5 runs, CI only | test (`it.effect.prop`), real git and a socket | Effect Arbitrary: credentialArb | (o) print `$1` (the prompt) in the script: login refused, red; answer the user name for both prompts: red; `echo $KALFA_GIT_PASSWORD` unquoted: a drawn password with two spaces or `*` changes, red; (t) run the transfer in the repository: the canary header arrives, red | kalfa/git/src/ProcessRepository.integration.test.ts |
| F21, the package's exports: `EXPORTS` gains `./Remote` and `./Credentials`, and K1 to K4 still hold (no dependency, no other package of this repository named) | test (`it`) | scenario: the manifest | leave `./Credentials` out of the package manifest: red | kalfa/git/src/Package.test.ts |

Lint, type or test? F1 to F16 and F18 to F21 are behavior, so tests. F17 is a shape the compiler checks, so type. No
law here is a lint rule: the one shape rule a lint could hold ("no `Redacted.value` outside the spawn") would fire
in Code hosting's filler too, which must build the value, so it stays F18's plant.

**Host-only and CI-only laws.** No law needs launchd, a signal or the Electron app. F12, F20, and F1 to F8 on real
git, run a real git and, for F20, a real socket, so they sit in `ProcessRepository.integration.test.ts`, which the
laptop refuses by name: they run in CI and in a proof run the lead starts, never narrowly here. Why F12 and F20 have no
stand-in: the stand-in proves which git directory and env the adapter hands git (F10, F18, F19); only a real git proves
that git then reads no key of the repository's config, runs the script with these prompts and accepts its answer.
Every behavior is first proved on the stand-in or `/memory` on every pull request.

## Files

Slice 2 branches from main after slice 1 lands. A file touched in both slices has a row for each.

| Slice | File | Owner | Product lines expected | Change |
|---|---|---|---|---|
| 1 | kalfa/git/src/Remote.ts | build | 85 | new: `Name`, `Url` and their checks, `Remote`, `named`, `url`, `NoSuchRemote`, `BadRemoteUrl`, `FetchFailed` |
| 1 | kalfa/git/src/Credentials.ts | build | 45 | new: `Credential`, `NoCredential`, `Credentials`, `none` |
| 1 | kalfa/git/src/Repository.ts | build | 40 | `fetch` in the service and its doc line, `Raw` gains `remoteUrl` and `fetch`, `make` writes `fetch` |
| 1 | kalfa/git/src/MemoryRepository.ts | build | 65 | `Remotes`, `layer`'s third argument, `remoteUrl`, `fetch` with the copy |
| 1 | kalfa/git/src/ProcessRepository.ts | build | 105 | `remoteUrl`, `fetch` in its temporary folder, the tips, the read back with the prefix taken off, the bounded release; `calls` gets a runner for another git directory; `layer` needs `FileSystem`; the header comment |
| 1 | kalfa/git/package.json | build | 2 | `./Remote` and `./Credentials` in `exports` |
| 1 | kalfa/git/README.md | build | docs | "Fetch", the top paragraph, "What it never does" |
| 1 | kalfa/git/GLOSSARY.md | build | docs | **Credential**: the one that gives none |
| 1 | kalfa/git/src/Fetch.test-support.ts | tests | tests | new: `FetchSubject`, `FetchSeeded`, `suite`, the carrier and classes (a) to (q), `credentialArb`, F1 to F8 |
| 1 | kalfa/git/src/Fetch.test.ts | tests | tests | new: the suite on `/memory` |
| 1 | kalfa/git/src/RepositoryTest.ts | tests | tests | re-exports `FetchTest` |
| 1 | kalfa/git/src/MemorySeed.test-support.ts | tests | tests | `memoryFetchSubject` |
| 1 | kalfa/git/src/ProcessSeed.test-support.ts | tests | tests | `processFetchSubject`: two bare repositories, the name in config, a path and a `file://` URL; the layer build provides the Node `FileSystem` it already has |
| 1 | kalfa/git/src/ProcessRepository.test.ts | tests | tests | `open` and the other layer builds provide a `FileSystem` |
| 1 | kalfa/git/src/ProcessFetch.test.ts | tests | tests | new: F10, F11, F13, F14, classes (r), (t), (u), (v), its own `open` on the stand-in |
| 1 | kalfa/git/src/ProcessRepository.integration.test.ts | tests | tests | runs the fetch suite on real git; F12 |
| 1 | kalfa/git/src/Remote.test.ts | tests | tests | new: F15, F16, `urlArb`, classes (w) to (z) |
| 1 | kalfa/git/src/Fetch.types.test.ts | tests | tests | new: F17 |
| 1 | kalfa/git/src/Package.test.ts | tests | tests | F21: `EXPORTS` |
| 1 | .kalfa/quests/kalfa-git-fetch-credential-PLAN.md | lead | docs | this plan |
| 2 | kalfa/git/src/ProcessRepository.ts | build | 45 | the script in the call's folder, the env, the scrub, `protocol.http.allow` |
| 2 | kalfa/git/src/Remote.ts | build | 8 | `http://` to a loopback host |
| 2 | kalfa/git/README.md | build | docs | how the credential reaches git, where it lives |
| 2 | kalfa/git/src/ProcessFetch.test.ts | tests | tests | F18, F19, classes (e), (g), (s) |
| 2 | kalfa/git/src/Remote.test.ts | tests | tests | F15's loopback cases of (y) |
| 2 | kalfa/git/src/ProcessRepository.integration.test.ts | tests | tests | F20 |
| 2 | kalfa/git/src/HttpRemote.test-support.ts | tests | tests | new: the HTTP server over `git http-backend` with Basic auth, a header log and a proxy port, for F20 |

No new workspace package, so no lockfile change. No new layer rule. No setting changes.

## Who lands first, and the pull request in flight

https://github.com/kamp-us/tea-fabrika/pull/2325 (`limits.kill`) has landed, so slice 1 starts from main: `runner`
takes `kill`, and the fetch's runners are built the same way. https://github.com/kamp-us/tea-fabrika/pull/2315
(rebase, ticket 1936) is open and changes 13 files. The ones this plan shares:

| Shared file | 2315 | This plan |
|---|---|---|
| kalfa/git/src/ProcessRepository.ts | slice 1: `MERGE_PINS`, `PINNED` gains `GIT_ATTR_SOURCE`; slice 2: a per-command env for `replay`, a scratch ref, the read back | slice 1: two raw calls after `moveRef`, `calls` gets a runner for another git directory with extra env, `layer` needs `FileSystem`; slice 2: the transfer's credential env |
| kalfa/git/src/Repository.ts | `CannotRebase`, `rebase` in the service, `Raw`, `make` | `fetch` in the service, `Raw`'s `Omit` list and two members, `make` |
| kalfa/git/README.md | Rebase section, pins table, "What it never does" | Fetch section, top paragraph, "What it never does" |
| kalfa/git/GLOSSARY.md | **Own commits** | **Credential** |
| kalfa/git/src/RepositoryTest.ts | `suite` calls the rebase laws | one re-export line at the end |
| kalfa/git/src/ProcessRepository.test.ts | P24, and stand-in laws that list `start`'s arguments or the env | `open` and the other layer builds provide a `FileSystem` |
| kalfa/git/src/ProcessSeed.test-support.ts | `gitIn`, a working copy for `git rebase` | `processFetchSubject`; the layer build provides `FileSystem` |
| kalfa/git/src/ProcessRepository.integration.test.ts | I13 to I15 and the rebase suite, about 550 s of CI's 1020 s step | the fetch suite at 3 runs and F12 |
| kalfa/git/src/MemoryRepository.ts | slice 2: `rebase` answers none | the third `layer` argument, two raw calls |

How this plan stays clear:

- **New files hold the new laws:** `Fetch.test-support.ts`, `ProcessFetch.test.ts`, `Remote.test.ts`,
  `Fetch.types.test.ts`. None goes into the history, values or service type test files that 2315 changes, and the
  fetch suite has its own subject, so the shared `Subject` and `suite` stay as they are.
- **The errors and values live in `Remote.ts` and `Credentials.ts`,** so `Repository.ts` gains only the call.
- **The per-command env.** 2315's slice 2 gives `replay` its own env, and this plan gives the transfer `GIT_OBJECT_DIRECTORY`
  and, in slice 2, the credential. Whichever lands first owns the shape `run(args, { input, env })`, and the second
  builds on it. Until then this plan builds its runner with the existing `runner(spawner, path, env, settings, kill)`,
  which already takes a git directory and an env, so it changes no signature. F10 checks the env against `PINNED`
  imported from the module, so 2315's added pin passes it without an edit.
- **`Repository.ts` and `ProcessRepository.ts` meet in lists:** the service, `Raw`'s `Omit` list, the end of `make`
  and the members of `calls`. Each pull request adds members; neither edits the other's. Whichever lands second takes
  main in and joins them by hand, a few lines. The README's sentence "Rebase, squash, fetch and push come in later
  tickets" is edited by both: the second drops its own word.
- **The layer's new `FileSystem` touches each layer build** in `ProcessRepository.test.ts` and
  `ProcessSeed.test-support.ts`, which 2315 also edits. Those are one `Layer.provide` each; if 2315 adds a layer build
  first, the second to land adds the provide there too.
- **CI time:** the integration file is near its budget once 2315 lands. The fetch suite runs at 3 runs, and the lead's
  proof run measures it.

## Existing tools

- `kalfa/git/src/Remote.ts`: searched `kalfa/` for a remote or URL value (`rg -n "RemoteName|RemoteUrl|insteadOf"`)
  and found none; `@kalfa/github` speaks GitHub's API, not git's remotes. The name check reuses `Ref.RefName`'s rule
  (`refs/remotes/<name>/x`), as git's own `valid_remote_name` does. The URL check uses the platform's `URL` parser,
  which a browser and Node both have, behind the control character check it needs; no npm package was searched for a
  git URL rule, since the rule is this package's own refusal list and not a general parser.
- `kalfa/git/src/Credentials.ts`: searched `kalfa/` for a credential or slot service (`rg -n "Credential|Redacted"`).
  `@kalfa/secrets` holds secrets by name and signs with them; it ranks above Configuration and would break 0047's rule
  that Source control imports no kalfa package. Effect's `Redacted` and `Schema.Redacted` hold the password.
- The fresh git directory: `FileSystem.makeTempDirectoryScoped`, whose release removes the folder, in place of a
  cleanup of our own; git's own `init`, `GIT_OBJECT_DIRECTORY` and `--negotiation-tip`. Searched the package for a
  temporary folder and found only the test seeds', which use the same `FileSystem`.
- `remoteUrl` and `fetch` in `ProcessRepository.ts`: reuse `runner`, `succeeded`, `stdoutText`, `Parse.refs` and the
  `--count=<refs + 1>` rule of `readRefs`.
- `fetch` in `MemoryRepository.ts`: reuses `readRefs`' rule and `add`; the copy walk is new, a dozen lines over
  `Store.commits`, beside `reach`, which walks one store only.
- `make`'s `fetch` in `Repository.ts`: reuses `limited`, as `rangePatchId` does around its two raw calls.
- The slice 2 scrub: one `RegExp` of the escaped values, longest first. Searched the package and Effect for a scrubber
  and found none; `Redacted` hides a value but cannot find it inside text.
- Tests: the stand-in spawner (`standIn`) as it is, `traced` and `expectNamedSpan`, `textureArb`, `seedEach`, and
  `FileSystem.layerNoop` for the folder recorder. F20's server uses `node:http` and `git http-backend`, git's own CGI
  server; searched the repo for an HTTP git test server and found none.

## Is this a setting?

- **The fetch's time:** no new setting. `limits.time` bounds the call, as it bounds every call, and `limits.kill`
  bounds the folder's release. A first fetch of a big remote can take longer than a plumbing call's limit; see
  Findings 1.
- **The transfer's git directory, flags and pins:** no. Each closes a way the repository's config could send the
  credential elsewhere or change what a fetch writes, as the landed plans say of the merge and read pins.
- **`insteadOf` not applying to a fetch:** no. A setting would reopen the way in that the fresh directory closes.
- **`http` to loopback only, slice 2, 85%.** A credential over plain `http` to another host is a leak; a local test
  server and a local mirror need loopback.
- **How many tips go to `--negotiation-tip`:** `limits.refs`, the existing limit. Fewer tips cost download only.
- **Which filler:** the slot itself; the app picks one by name.

## New names

- `fetch`, `Remote`, `Credential`: git's own words, already in the glossary.
- `Credentials`: the slot's service, a plural service name, as the decided rule asks. `Credentials.none`: the filler
  that gives none, named as the ticket says, "like the hook that checks nothing".
- `Remote.Name`, `Remote.Url`, `Remote.named`, `Remote.url`: git's words ("remote name", "URL").
- `NoSuchRemote`, `BadRemoteUrl`, `FetchFailed`, `NoCredential`: errors named as the package's others are
  (`NoSuchCommit`, `GitTooOld`).
- `askpass`: git's own name for the program (`GIT_ASKPASS`), an industry term, not a domain word.
- `refs/fetched/`: the scratch refs' prefix, inside the call's own git directory only.
- `kalfa.git.remote`, `kalfa.git.credential`: span keys. OpenTelemetry's `vcs.*` names have no remote kind or login.

## Validation

- tests step, each slice: each new or changed law file alone, such as
  `nice -n 15 pnpm exec vitest run kalfa/git/src/Fetch.test.ts`, then `ProcessFetch.test.ts`, `Remote.test.ts`,
  `Fetch.types.test.ts`, `ProcessRepository.test.ts` and `Package.test.ts`, each red for the reason its row says
  before the build. Each plant by hand, undone. The integration file is not run here.
- build step: the same files green, then `pnpm format` and `pnpm lint`.
- The lead runs the changed set, the typecheck and a proof run of the integration laws (F1 to F8 on git and F12, and
  F20 in slice 2) before the first review.

## Size

1. Slice 1, fetch with the slot, both adapters, no login reaches git: 342 lines (`Remote.ts` 85, `Credentials.ts` 45,
   `Repository.ts` 40, `MemoryRepository.ts` 65, `ProcessRepository.ts` 105, the manifest 2), the README and one
   glossary line, and about 1200 lines of laws. It lands whole: Delivery and the push ticket can fetch from a local
   path, a `file://` URL, a `/memory` remote and a public https remote on both adapters, with no repository config
   able to steer the transfer, and Code hosting's filler can be built and tested on `/memory`.
2. Slice 2, the credential reaches git: 53 lines (`ProcessRepository.ts` 45, `Remote.ts` 8), the README, and about 500
   lines of laws and the HTTP test server. It lands whole: a remote that needs a login fetches on `/process`.

About 395 product lines in all, 75% sure: the doubt is `/process`'s fetch, whose two git directories and bounded
release may take more lines than sketched, and F20's server, which may need more lines to speak CGI. About 8 agent
hours across the steps. Steps: tests, build and one review per slice, and one likely send-back each. Priced at about
$12 a step on list prices, as the rebase plan's larger slices were: tests and build on Sonnet, the review on Opus.

Estimate: 8 steps, $96

## What this cannot tell us

- That git 2.38 and 2.39 take every flag (`--negotiation-tip` with an id, `--path-format=absolute`,
  `--no-auto-maintenance`). They ran here only on 2.40.1; CI's git is the proof.
- That git reads no config but system, user and the git directory's. That is git's documented order, and F12 checks
  the keys we know of; a git that adds a new config source (an environment variable we do not pin) would not be seen.
- That git runs `GIT_ASKPASS` with no shell and asks "Username" before "Password". That is from memory and the
  review's tryout; F20 is the first law that shows it.
- What a fetch from a shallow remote leaves: its objects, with parents missing, unreferenced in the repository's object
  folder until gc. `rev-list` on them fails, never answers; `git fsck` may name them as broken.
- Whether a fetch of a big remote fits in `limits.time` as the app sets it (Findings 1).
- That the environment is a safe enough place. Anyone running as the same user can read a running process's
  environment, and with askpass the user name in argv.
- What happens to the objects of refs the glob fetched and the answer left out (`main-2`): they stay unreferenced
  until a gc prunes them. Nothing here runs gc.

## Calls taken

- The slot is asked in `make`, once per call, with the URL `remoteUrl` gave: 90%. Both adapters then ask alike, and a
  named remote is asked with its configured URL, as ruling 7 says.
- The slot is the call's requirement, not the layer's: 75% (the doubt at the top).
- `fetch` takes one `under` and answers like `readRefs`: 80% (the doubt at the top).
- **Design (b), the fresh git directory, over design (a), a refusal of local config keys plus pins: 85%.** Evidence,
  all on 2.40.1 and listed under Records: (b) ignored `uploadpack`, `insteadOf` and `credential.helper` that acted in
  the repository; with `--negotiation-tip` it downloaded 3 objects, as a fetch in the repository did, against 600
  without; and it kept the repository unshallow. (a) needs a list of keys that must be kept current with git
  (`fetch.bundleURI` came in a later git, and URL-scoped keys need their own patterns), refuses a repository whose config
  holds a harmless key such as `http.<url>.lowSpeedLimit`, and still writes `shallow` and scratch refs into the
  repository. The cost of (b): `FileSystem` in the layer from slice 1, and a shallow repository is refused before any
  transfer, since the fresh directory cannot know its cut.
- A shallow repository fails `HistoryTooShort` before the transfer, and a shallow remote fails it after, leaving the
  repository as it was: 85%.
- A named remote's URL is its configured text, with no `insteadOf`: 80%. The fresh directory reads no `insteadOf`, and
  applying it ourselves would bring back the rewrite the slot was not asked about.
- The release of the temporary folder is the cleanup, bounded by `limits.kill`, and its failure never replaces the
  call's own: 90%.
- The slice 2 scrub reads `limits.bytes` plus the longest secret, scrubs in one alternation longest first with empty
  values left out, then cuts: 90%.
- `/memory` has no login, cut on review: 90%. Code hosting's law on `/memory` checks that the slot was asked and with
  what, which the recorder shows.
- Two slices, slice 2 waiting on open question 1: 90%. Slice 1 is whole without it.

## Open questions

1. Askpass, as ruled, or a credential helper, git's own way, for slice 2? Lean: credential helper, 80% (the review
   leans the same at 85%, from its own tryouts). Why: with askpass the user name sits in the script's argv, which `ps`
   shows, and git needs a script file; a helper gets the request on stdin, needs no file, and can refuse a host it was
   not asked for. Cost: rewords the parent's ruling.

## Findings

1. **A fetch's time limit is a plumbing call's.** `limits.time` (`kalfa/git/src/Settings.ts`) is "the longest one call
   may take", sized for local commands (the README's example is 10 seconds). A first fetch, or a push later, can take
   minutes. A ready ticket: "Git: a call that reaches a remote has its own time limit", adding a required
   `limits.remote` duration for fetch and push, beside `limits.kill`.
2. **P11's title will read wrong once fetch lands.** `kalfa/git/src/ProcessRepository.test.ts` names P11 "none reaches
   a remote" across every call. It lists no `fetch` call, so it stays true, but the README's line that the package
   "sends nothing to a remote" changes in slice 1. In scope for slice 1's README change; listed so the review checks the
   wording.
3. **Today's calls read the repository's config too.** The read, edit and merge calls pin the keys their plans found,
   by `-c`, and a URL-scoped or subsection key beats a `-c` pin for the keys that have one. None of those calls reaches
   a remote, so no credential is at stake, and this plan does not change them. If a later review wants the same rule
   for them, the fresh-directory idea does not fit (they need the repository's refs), so it would be its own ticket.
