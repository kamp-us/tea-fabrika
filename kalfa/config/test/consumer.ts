import * as App from "@kalfa/config/App";
// @ts-expect-error Test sources are not public package subpaths.
import type * as Test from "@kalfa/config/App.test";
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
import { Effect, FileSystem, Layer, Path, Schema } from "effect";
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

const refusals: [typeof Private, typeof Test] | null = null;

void [checked, Sources, Toml, Codec, JsonSchema, refusals];
