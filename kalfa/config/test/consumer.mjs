import assert from "node:assert/strict";
import * as App from "@kalfa/config/App";
import * as Codec from "@kalfa/config/Codec";
import * as Files from "@kalfa/config/Files";
import * as JsonSchema from "@kalfa/config/JsonSchema";
import * as Load from "@kalfa/config/Load";
import * as Print from "@kalfa/config/Print";
import * as Reference from "@kalfa/config/Reference";
import * as Setting from "@kalfa/config/Setting";
import * as Snapshot from "@kalfa/config/Snapshot";
import * as Sources from "@kalfa/config/Sources";
import * as Toml from "@kalfa/config/Toml";
import * as TomlParser from "@kalfa/config/TomlParser";
import { Effect, FileSystem, Layer, Path, Schema } from "effect";
import { Digest } from "effect/crypto";

const publicModules = {
  App,
  Setting,
  Sources,
  Toml,
  TomlParser,
  Codec,
  Files,
  JsonSchema,
  Reference,
  Print,
  Snapshot,
  Load,
};

for (const name of Object.keys(publicModules)) {
  assert.ok(import.meta.resolve(`@kalfa/config/${name}`).endsWith(`/dist/${name}.js`));
}

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

const layers = Layer.mergeAll(
  FileSystem.layerNoop({ readFileString: () => Effect.succeed("[service]\nport = 4100\n") }),
  Path.layer,
  TomlParser.layer,
  Digest.layerWebCrypto,
);

const runtime = Effect.gen(function* () {
  const parser = yield* Toml.Toml;

  const parsed = yield* parser.parse("[service]\nport = 4100\n");

  assert.deepEqual(parsed.value, { service: { port: 4100 } });

  for (const [flags, env, value, origin] of [
    [{}, { FABRIKA_SERVICE_PORT: "65000" }, 4100, { _tag: "file", file: app.repo, line: 2 }],
    [
      {},
      { DEMO_SERVICE_PORT: "4200", FABRIKA_SERVICE_PORT: "65000" },
      4200,
      { _tag: "env", name: "DEMO_SERVICE_PORT" },
    ],
    [{ "service.port": "4300" }, { DEMO_SERVICE_PORT: "4200" }, 4300, { _tag: "flag", name: "--service.port" }],
  ]) {
    const loaded = yield* Load.load(group, { repo: "/work", home: "/people/one", flags, env, version: "1.2.3" });

    assert.equal(loaded.values.port, value);

    assert.equal(loaded.snapshot.values[port.path], value);

    assert.deepEqual(loaded.snapshot.origins[port.path], origin);

    assert.equal(Reference.rows(group, loaded.snapshot).length, 1);
  }
}).pipe(Effect.provide(layers));

// edge: this fixture is the installed Node ESM client, outside the Effect test runner.
await Effect.runPromise(runtime);

for (const name of ["internal/edit", "App.test"]) {
  await assert.rejects(import(`@kalfa/config/${name}`), { code: "ERR_PACKAGE_PATH_NOT_EXPORTED" });
}

console.log(JSON.stringify({ runtime: "passed", imports: "passed", private: "passed" }));
