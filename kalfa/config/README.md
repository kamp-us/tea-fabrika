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

## Public modules

Import these explicit subpaths: `App`, `Setting`, `Sources`, `Toml`, `TomlParser`, `Codec`,
`Files`, `JsonSchema`, `Reference`, `Print`, `Snapshot` and `Load`.
For example, `@kalfa/config/Reference` reads rows from a loaded snapshot, and
`@kalfa/config/Print` prints those rows. `internal/` and test files are private.

Workspace imports read `src/`. The archive exports ESM JavaScript and declarations from `dist/`.
Its runtime dependencies are the TOML parser and serializer. Effect is a peer supplied by the caller.

## Build an archive from source

In this workspace, run `pnpm --filter @kalfa/config pack --pack-destination <folder>` in CI.
The prepack script checks for pnpm and builds the package once. pnpm substitutes compiled exports
when it packs. npm can install the resulting archive, but cannot pack this source package correctly.

Source changes alone do not prove the archive works. The CI consumer check installs one archive
outside the workspace, runs its JavaScript and checks all public declarations before retaining it.
