# @kalfa/config

An app's settings engine, extracted from `next/`. Declare each setting once with an Effect
Schema. Load it from flags, the environment and two TOML files. The result includes each value's
origin and a checked snapshot.

## Install a private archive

Use Node 26 or newer. Download `kalfa-config-0.0.0.tgz` and its `receipt.json` from a successful
CI consumer check for this source commit. The receipt names the tested archive's SHA-256.
Then install the downloaded file in your project:

```sh
npm install ./kalfa-config-0.0.0.tgz effect@4.1.3
```

This package stays private. Installation uses the archive. There is no registry release or CLI
in this slice.

## Declare and load settings

```ts
import * as App from "@kalfa/config/App";
import * as Load from "@kalfa/config/Load";
import * as TomlParser from "@kalfa/config/TomlParser";
import { Effect, FileSystem, Layer, Path, Schema } from "effect";
import { Digest } from "effect/crypto";

const app = App.make({ name: "demo", list: "demo config get" });

const port = app.Setting.make("service.port", {
  schema: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 65535 })),
  default: 3000,
  doc: "The service port.",
  scope: ["person", "repo"],
  reload: "restart",
  since: "0.0.0",
});

const group = app.Setting.group({ port });

// An in-memory file service, as used by the installed consumer check.
const files = FileSystem.layerNoop({
  readFileString: () => Effect.succeed("[service]\nport = 4100\n"),
});

const loaded = Load.load(group, {
  repo: "/work",
  home: "/people/one",
  flags: {},
  env: { DEMO_SERVICE_PORT: "4200" },
  version: "1.2.3",
}).pipe(Effect.provide(Layer.mergeAll(files, Path.layer, TomlParser.layer, Digest.layerWebCrypto)));

const result = await Effect.runPromise(loaded);

result.values.port; // 4200
result.snapshot.origins[port.path]; // { _tag: "env", name: "DEMO_SERVICE_PORT" }
```

The name `demo` gives the repo file `.demo/demo.toml`, person file `~/.demo/demo.toml`,
environment prefix `DEMO_`, home variable `DEMO_HOME` and minimum-version key `demo-version`.
An app name is one lowercase word, starting with a letter. A group accepts settings from one app.
The `list` text tells error messages which command the calling app provides.

A flag wins over the environment, then the repo file, then the person file, then the default.
For this declaration the flag key is `service.port` and the variable is `DEMO_SERVICE_PORT`.
Setting `DEMO_HOME` moves the person file to `$DEMO_HOME/demo.toml`.
The `scope` list limits which files may set the value. Flags and environment variables may set any key.
A missing file counts as empty. A wrong value, unknown key or key outside its file scope fails
with its location. A repo minimum newer than the running version fails before the person file is read.

For real files, supply your platform's Effect `FileSystem` and `Path` services instead of the
in-memory file service above. `TomlParser.layer` supplies the TOML service. Snapshots need
`Digest`, supplied here by Web Crypto.

## A setting's value is plain data

A setting made with `Setting.make` from `@kalfa/config` holds plain data only: text, numbers,
booleans, and arrays and records of those, branded or not. A `Date`, a `Duration`, a `URL`, a `Map`
or a class does not compile. A value type written as an `interface` is refused too, since the type
cannot tell an interface from a class: write it as a `type`. Declare a length of time or an address
as text, and decode it where it is read:

```ts
import { Setting } from "@kalfa/config";
import { Option, Schema } from "effect";

// Checked when the app starts, so "ten" stops the start with its file and line.
const Wait = Schema.String.check(
  Schema.makeFilter(
    (text: string) =>
      Option.isSome(Schema.decodeUnknownOption(Schema.DurationFromString)(text)) || "a length of time, as 10 seconds",
  ),
);

export const branchWait = Setting.make("delivery.branch-wait", Wait).pipe(
  Setting.withDefault("10 seconds"),
  Setting.withDescription("How long a landing waits for its branch."),
);

// Where it is read: const wait = Schema.decodeSync(Schema.DurationFromString)(values.branchWait)
```

A URL works the same way, with `Schema.URLFromString` where it is read.

## When a start is refused, and why

A refusal of `SettingGroup.layer` says what went wrong in the words a person can act on, and never holds a value, a
secret or an absolute path. An `invalid` refusal names the rule the value broke, from what the setting's schema declares:
its title and description when it has them, else the rule of the check that failed, else the type it expected.

```
.demo/demo.toml, line 2: net.port is not a valid value. Expected a value greater than 1023.
  demo did not start.
```

A `read` refusal says why the read failed, from the failure's kind and its POSIX code:

```
~/.demo/demo.toml: could not be read, because permission was denied (EACCES).
  demo did not start.
```

A refusal also says where the fault is as data, so a program never reads a message to find out. `place` is a `Diagnostic.Place`
(`@kalfa/diagnostics/Diagnostic`) of the kind the fault has: the repo file (`repo`), the user file (`home`), an environment variable
(`environment`) or a flag (`flag`), with a file's line when it is known. A required setting nothing sets points at the first file
it may be set in, with no line, since that is where the fix goes. `message` is made from `fault`, `place` and `closing`.

An error with a place also carries a diagnostic, read with `Diagnostic.fromError`: the code of its reason (`config/version`,
`config/syntax`, `config/unknown-setting`, `config/scope`, `config/invalid`, `config/missing`, `config/read`, `config/edit` or
`config/write`), its `fault` as the message, its place, and one fixed hint for the reason. The hint holds no app, value, path or
login. A fault with no place carries none: a snapshot that does not fit, a typed name that is no setting. A running `version`
that is not a version is the program's own mistake and stops the program with a defect, not a refusal.

The error's `cause` is kept, as a `Hidden.Cause` (`@kalfa/diagnostics/Hidden`), since a platform error prints the path it failed on:
no rendering shows it, and every codec, `Schema.toCodecJson` included, writes it as `<redacted>`. `SnapshotError`'s cause is held the same
way. Code that must see a cause reads it on purpose with `Redacted.value`. Every refusal ends the span of its call: `config.layer`, `config.set`,
`config.remove`, `config.edit` or the command's own.

## Change one setting in a file's text

`SettingGroup.edit(group, text, file)` changes one setting in the text of a configuration file. It is pure: no
file is read or written, and the text is the only input. `file` is `"repo"` or `"user"`, and says which file the
text is.

```ts
import { SettingGroup } from "@kalfa/config";
import { Effect } from "effect";

const text = ['[delivery]', 'approver = "people"   # the default', ''].join("\n");

const next = await Effect.runPromise(SettingGroup.edit(group, text, "repo").set(approver, "owner"));
// '[delivery]\napprover = "owner"   # the default\n'
```

`set` replaces only the value's own text, so every comment, space and line break stays. A key the file lacks goes on
a line of its own at the end of its table, or under a new header at the end. `remove` takes out one `key = value`
(and its comma in an inline table). A set of the value the file already holds, or a remove of a key the file lacks,
answers the same text.

A record written over several lines (under its own header, under the headers of its items, or by dotted keys) is
compared key by key, so `set` writes only what differs. A key that is the same keeps its lines. A new item goes beside
its siblings, under its own header when its siblings have one. An item that leaves takes its lines, the comments inside
it and the comment lines right above its header; a comment with a blank line between it and the header stays. An
array is replaced whole, in the form it had: an inline array stays inline, and an array of `[[name]]` blocks comes
back as blocks, with the comment lines above its first block kept.

Each call answers an `Effect` of the new text that fails with one `SettingsError`, and then no text comes back:

- `unknown`: the setting is not one of the group's.
- `scope`: the file is outside the setting's file scope. A remove checks this too.
- `invalid`: the value fails its schema, or the file cannot write it.
- `syntax`: the text is not valid TOML. Other faults in the file, an unknown key or another setting's bad value,
  fail with their own reason and their own line. The edited setting's old value is left out of this check, so a set
  or a remove can fix a bad value.
- `edit`: the edited text would change other data, or would not be valid TOML.

A message ends `<file> was not changed.` and never holds a value.

## Change one setting in a file on disk

`SettingGroup.set(group, setting, value, file, { repo })` and `SettingGroup.remove(group, setting, file, { repo })` do
the same edit on a real file. Each answers an `Effect` of nothing, which needs Effect's `FileSystem` and `Path`. `repo`
is the folder that holds `.<app>/`, the current folder by default. The repo configuration is `<repo>/.<app>/<app>.toml`. The
user file is found as the start finds it: `$<APP>_HOME/<app>.toml`, else `$HOME/.<app>/<app>.toml`. Errors name a file
as the start does, never by an absolute path.

```ts
await Effect.runPromise(
  SettingGroup.set(group, approver, "owner", "repo", { repo: "/work" }).pipe(Effect.provide(NodeServices.layer)),
);
```

The file is written the way git writes its config:

- **A lock file.** The new text goes into `<file>.lock`, which is made empty and only if none is there. A second change
  to the same file fails `write` at once. After a crash a stale lock blocks every change to that file until a person
  removes it, and the message says which file.
- **One rename.** The lock is renamed over the file, so a reader never sees half a file, and the file's own path is
  never written. A failed write or rename leaves the file as it was and no lock behind. The call removes only a lock it
  made.
- **A link is followed** to its target, so a user configuration kept in a dotfiles folder and linked into the home folder stays a
  link.
- **No change, no write.** A set of the value the file holds, or a remove of a key it lacks, renames nothing and leaves
  no lock.
- **The folder.** A set makes `.<app>/` when it is missing, and no folder above it: a missing parent fails `write`. A
  `$<APP>_HOME` that names a folder that is not there fails `write` too, since a typo there should not make a new folder.
  A set that fails after it made `.<app>/` takes the folder away again, but only while it is empty: a lock or a file
  another writer has put in it since stays. A remove of a file or folder that is not there succeeds and writes nothing.
- **No home.** With neither `$<APP>_HOME` nor `HOME`, there is no user configuration: a set fails `write`, and a remove has
  nothing to take out.

Each call ends one span, `config.set` or `config.remove`, with `kalfa.config.app`, `kalfa.config.setting`,
`kalfa.config.file` and `kalfa.config.changed`. No value and no file text goes in it.

The new reason is `write`: the file or its lock could not be written, or another change holds the lock. A file that
exists and cannot be read fails `read`. Every other fault is the edit's, with its own reason and line.

## Settings for a process that cannot read files

A Worker cannot read the configuration files. The process that can, the loading process, gives it the settings as a
stream of snapshots, and carrying them is the app's job: `postMessage`, a socket, anything.

```ts
import { NodeServices } from "@effect/platform-node";
import { Setting, SettingGroup } from "@kalfa/config";
import { Effect, Schema, Stream } from "effect";
import { Digest } from "effect/crypto";

const port = Setting.make("instance.port", Schema.Int).pipe(
  Setting.withDefault(18800),
  Setting.withDescription("The port the service listens on."),
);

const Demo = SettingGroup.make("demo", port);

// The loading process: its group is started from the files, as always, and the stream is read inside that layer.
// `Digest.layerWebCrypto` gives the stream its hash; the layer from files needs only the file system and the path.
const first = await Effect.runPromise(
  SettingGroup.snapshots(Demo).pipe(
    Stream.take(1),
    Stream.runCollect,
    Effect.provide(SettingGroup.layer(Demo, { version: "1.0.0" })),
    Effect.provide([NodeServices.layer, Digest.layerWebCrypto]),
  ),
);
// [{ app: "demo", values: { "instance.port": 18800 }, origins: { "instance.port": { _tag: "default" } }, hash: "008d9371f1e4..." }]
```

`snapshots(group)` gives the snapshot of the files now, then one more each time a change to a file is taken and the
snapshot says something new: another value, or only another origin, as a line moved. A refused change gives none. A
snapshot holds the files as last taken, so a restart setting that changed in a file shows its new value though the
loading process keeps the one it started with. It is plain JSON, and it holds the app's name, so one app's snapshot
is never read as another's. It needs the group's layer and `Digest`; the layer from files does not need `Digest`.

`layerFromSnapshots(group, stream)` is the Worker's half. It starts the group on the first item of `stream`, and reads
every later one to update the live settings. The stream is what the app's carrier gives: its items are `unknown`, since
a carried value is only data until it is read.

```ts
import { Setting, SettingGroup } from "@kalfa/config";
import { Effect, Schema, Stream } from "effect";
import { Digest } from "effect/crypto";

const port = Setting.make("instance.port", Schema.Int).pipe(
  Setting.withDefault(18800),
  Setting.withDescription("The port the service listens on."),
);

const Demo = SettingGroup.make("demo", port);

// The Worker: no file system and no path. `inbox` is whatever carries the loading process's snapshots.
declare const inbox: Stream.Stream<unknown>;

const settings = SettingGroup.layerFromSnapshots(Demo, inbox);

const program = Effect.gen(function* () {
  const { port } = yield* Demo; // the value the loading process read
}).pipe(Effect.provide(settings), Effect.provide(Digest.layerWebCrypto));
```

Each item is read strictly. The first one that does not fit the group fails the layer with reason `snapshot`, and so
does a stream that ends before its first item. A later one that does not fit is logged as a warning and the last good
values hold. A live setting gets each new value. A restart setting that changed is logged as `<name> changed. It applies
when <app> starts again.`, and its value and origin stay as the start gave them. A stream that ends is logged once. The
carrier's own failures are the app's to handle: the stream cannot fail.

## The schema and the reference

`SettingGroup.jsonSchema(group, file)` is the editor's JSON Schema of one configuration file, as the text a repo
commits: `"repo"` for `.<app>/<app>.toml` and `"user"` for the person's file. It holds the settings that file's scope
allows, each with its description and its default, and the repo's also holds `<app>-version`. A key no setting names is
refused. The text is the same for a group with its settings in another order, and it ends in one line break.
`SettingGroup.reference(group)` is the Markdown reference: one section per setting, by name, with its description, its
files, its variable and flag, its default and whether a change applies live or at a restart. A file-only setting says
`none: file-only` for its variable and flag, and a required one says `none: required` for its default.

```ts
import { Setting, SettingGroup } from "@kalfa/config";
import { Schema } from "effect";

const port = Setting.make("instance.port", Schema.Int).pipe(
  Setting.withDefault(18800),
  Setting.withDescription("The port the service listens on."),
);

const Demo = SettingGroup.make("demo", port);

const schema = SettingGroup.jsonSchema(Demo, "repo"); // the text of .demo/demo.toml's schema
const page = SettingGroup.reference(Demo); // the Markdown page
```

Both are made from the declarations alone, so a package can check a committed copy against them in a test.
`jsonSchema` throws for a setting whose schema JSON Schema cannot hold exactly, as a bare `Schema.makeFilter` cannot:
write a check as a pattern or a bound. A text's length check is exact only for a minimum of one character, because
Effect counts UTF-16 units and JSON Schema counts code points. The `<app>-version` pattern reads a version as a start
does, a number up to the largest safe integer included. The quiet window of a group with a live setting is in both.

## The config command

`@kalfa/config/Cli` exports `config(app, groups, { version, repo })`, an `effect/cli` command named by its root name
that answers questions about every group of one app. `@kalfa/cli` mounts it as its built-in `config`, and an app can mount
it under its own command. It takes every group, so one file shared by many packages is checked against all of them: a
key of a group left out is refused as unknown. `repo` is the folder that holds `.<app>/`, and is handed in: the command
reads no other folder, the current one included. `version` is the running app's.

| Subcommand | Prints |
|---|---|
| `get <name>` | the value as one line of JSON, as `"owner"` |
| `set <name> <value> [--file repo\|user]` | nothing. The text is read as an environment variable's text is read |
| `remove <name> [--file repo\|user]` | nothing |
| `list` | every setting: its value as JSON, where it came from, `live` or `restart` (and `file-only`), its description |
| `schema [--file repo\|user]` | `SettingGroup.jsonSchema` of the joined settings, the repo's when left out |
| `reference` | `SettingGroup.reference` of the joined settings |

`set` and `remove` change the file `--file` names, else the first file the setting may be set in, with the same edit as
`SettingGroup.edit`: every comment and other key stays, and a file left unchanged is not touched. A text the setting's
schema refuses fails before any file is found, and the error never holds the text. `list` and `get` read as a start
reads, so they meet a start's faults, and each ends `<app> would not start with these settings.` A name that is no
setting fails `unknown`, with the nearest name when one is within two edits. Each text is built whole and printed once,
so a failed run prints nothing. Each run is a span `config.<subcommand>` with `kalfa.config.app`, and no value.

```ts
import { Setting, SettingGroup } from "@kalfa/config";
import { config } from "@kalfa/config/Cli";
import { Schema } from "effect";

const port = Setting.make("instance.port", Schema.Int).pipe(
  Setting.withDefault(18800),
  Setting.withDescription("The port the service listens on."),
);

// `kalfa config get instance.port` prints 18800
const command = config("demo", [SettingGroup.make("demo", port)], { version: "1.2.3", repo: process.cwd() });
```

`config` throws an `Error` when a group is another app's, or two groups declare settings that are one name, a value and
its table, or one environment variable. A field two groups share is fine: each group yields its own.

## Public modules

Import these explicit subpaths: `App`, `Setting`, `Sources`, `Toml`, `TomlParser`, `Codec`,
`Files`, `JsonSchema`, `Reference`, `Print`, `Snapshot`, `Load` and `Cli`.
For example, `@kalfa/config/Reference` reads rows from a loaded snapshot, and
`@kalfa/config/Print` prints those rows. `internal/` and test files are private.

Workspace imports read `src/`. The archive exports ESM JavaScript and declarations from `dist/`.
Its runtime dependencies are the TOML parser and serializer, and `@kalfa/diagnostics`, for the hidden cause its errors hold. Effect is a peer supplied by the caller.

## Build an archive from source

In this workspace, run `pnpm --filter @kalfa/config pack --pack-destination <folder>` in CI.
The prepack script checks for pnpm and builds the package once. pnpm substitutes compiled exports
when it packs. npm can install the resulting archive, but cannot pack this source package correctly.

Source changes alone do not prove the archive works. The CI consumer check installs one archive
outside the workspace, runs its JavaScript and checks all public declarations before retaining it.
