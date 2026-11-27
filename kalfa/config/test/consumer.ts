import * as Root from "@kalfa/config";
import * as App from "@kalfa/config/App";
// @ts-expect-error Test sources are not public package subpaths.
import type * as Test from "@kalfa/config/App.test";
import * as Cli from "@kalfa/config/Cli";
import * as Codec from "@kalfa/config/Codec";
import type * as Files from "@kalfa/config/Files";
// @ts-expect-error Internal compiled files are not public package subpaths.
import type * as Private from "@kalfa/config/internal/edit";
import * as JsonSchema from "@kalfa/config/JsonSchema";
import * as Load from "@kalfa/config/Load";
import * as Print from "@kalfa/config/Print";
import * as Reference from "@kalfa/config/Reference";
import type * as Setting from "@kalfa/config/Setting";
import type * as Snapshot from "@kalfa/config/Snapshot";
import * as Sources from "@kalfa/config/Sources";
import * as Toml from "@kalfa/config/Toml";
import * as TomlParser from "@kalfa/config/TomlParser";
import { Effect, FileSystem, Layer, Option, Path, Schema, Stream } from "effect";
import type { Command } from "effect/cli";
import { Digest } from "effect/crypto";

const app: App.App = App.make({ name: "demo", list: "demo config get" });

const port: Setting.Setting<number> = app.Setting.make("service.port", {
  schema: Schema.Int,
  default: 3000,
  doc: "The service port.",
  scope: ["person", "repo"],
  reload: "restart",
  since: "0.0.0",
});

const group = app.Setting.group({ port });

const checked: Effect.Effect<number, Files.SettingsError | Snapshot.SnapshotError> = Effect.gen(function* () {
  const loaded = yield* Load.load(group, { repo: "/work", home: "/people/one", flags: {}, env: {}, version: "1.2.3" });

  const snapshot: Snapshot.Snapshot = loaded.snapshot;

  const rows: ReadonlyArray<Reference.Row> = Reference.rows(group, snapshot);

  const report: string = Print.report(rows, { all: true });

  const value: number = loaded.values.port;

  void report;

  return value;
}).pipe(
  Effect.provide(
    Layer.mergeAll(
      FileSystem.layerNoop({ readFileString: () => Effect.succeed("") }),
      Path.layer,
      TomlParser.layer,
      Digest.layerWebCrypto,
    ),
  ),
);

// The root entry: declare a setting with a pipe, group it, and read it through the group's layer.
const declared: Root.Setting.Setting<"service.port", number, false> = Root.Setting.make(
  "service.port",
  Schema.Int,
).pipe(
  Root.Setting.withDefault(3000),
  Root.Setting.withDescription("The service port."),
  Root.Setting.files(["repo", "user"]),
);

const declaredGroup = Root.SettingGroup.make("demo", declared);

const rooted: Effect.Effect<number, Root.SettingGroup.SettingsError, FileSystem.FileSystem | Path.Path> = Effect.gen(
  function* () {
    const values = yield* declaredGroup;

    const origins: Readonly<Record<"service.port", Sources.Origin>> = yield* Root.SettingGroup.origins(declaredGroup);

    void origins;

    return values.port;
  },
).pipe(Effect.provide(Root.SettingGroup.layer(declaredGroup, { version: "1.2.3" })));

// The edit in memory: a set and a remove each answer the file's new text, or the one error, with nothing required.
const edited: Effect.Effect<string, Root.SettingGroup.SettingsError> = Root.SettingGroup.edit(
  declaredGroup,
  "[service]\nport = 4100\n",
  "repo",
).set(declared, 4200);

const removed: Effect.Effect<string, Root.SettingGroup.SettingsError> = Root.SettingGroup.edit(
  declaredGroup,
  "[service]\nport = 4100\n",
  "user",
).remove(declared);

// The Worker's start (ticket 1845, slice 2): the loader's group gives one snapshot, and the same group starts from a
// one-item stream of it with no file system and no path, needing only the digest.
const snapshotted: Effect.Effect<
  Root.SettingGroup.Snapshot,
  Root.SettingGroup.SettingsError,
  FileSystem.FileSystem | Path.Path | Digest.Digest
> = Stream.runHead(Root.SettingGroup.snapshots(declaredGroup)).pipe(
  Effect.map(Option.getOrThrow),
  Effect.provide(Root.SettingGroup.layer(declaredGroup, { version: "1.2.3" })),
);

const worker = (
  snapshot: Root.SettingGroup.Snapshot,
): Effect.Effect<number, Root.SettingGroup.SettingsError, Digest.Digest> =>
  Effect.map(declaredGroup, (values) => values.port).pipe(
    Effect.provide(Root.SettingGroup.layerFromSnapshots(declaredGroup, Stream.make(snapshot))),
  );

// The `config` command (ticket 1846, slice 2): one `effect/cli` command named by its root name, over every group of one app, whose
// error is the one `SettingsError` and which needs only the file system and the path. `kalfa` hands it the repo's root.
const configured = Cli.config("demo", [declaredGroup], { version: "1.2.3", repo: "/work" });

const configName: "config" = configured.name;

const configFailures: ReadonlyArray<Command.Error<typeof configured>> = [];

const configError: ReadonlyArray<Root.SettingGroup.SettingsError> = configFailures;

const configNeeds: ReadonlyArray<Command.Services<typeof configured>> = [];

const configServices: ReadonlyArray<FileSystem.FileSystem | Path.Path> = configNeeds;

const refusals: [typeof Private, typeof Test] | null = null;

void [
  checked,
  rooted,
  edited,
  removed,
  snapshotted,
  worker,
  Sources,
  Toml,
  Codec,
  JsonSchema,
  configName,
  configError,
  configServices,
  refusals,
];
