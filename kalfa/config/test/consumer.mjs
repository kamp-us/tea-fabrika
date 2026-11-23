import assert from "node:assert/strict";
import * as Root from "@kalfa/config";
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
import { ConfigProvider, Effect, FileSystem, Layer, Path, Schema } from "effect";
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

// The root entry: `@kalfa/config` itself, beside the twelve modules.
assert.ok(import.meta.resolve("@kalfa/config").endsWith("/dist/index.js"));

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

// A setting declared with a pipe, grouped, and read through the group's layer from the repo file.
const declared = Root.Setting.make("service.port", Schema.Int).pipe(
  Root.Setting.withDefault(3000),
  Root.Setting.withDescription("The service port."),
);

const declaredGroup = Root.SettingGroup.make("demo", declared);

const rooted = Effect.gen(function* () {
  const values = yield* declaredGroup;
  const origins = yield* Root.SettingGroup.origins(declaredGroup);

  assert.equal(values.port, 4100);

  assert.deepEqual(origins["service.port"], { _tag: "file", file: ".demo/demo.toml", line: 2 });
}).pipe(
  Effect.provide(Root.SettingGroup.layer(declaredGroup, { version: "1.2.3", repo: "/work" })),
  Effect.provide(
    Layer.mergeAll(
      FileSystem.layerNoop({ readFileString: () => Effect.succeed("[service]\nport = 4100\n") }),
      Path.layer,
      ConfigProvider.layer(ConfigProvider.fromEnv({ env: {} })),
    ),
  ),
);

// The edit in memory, from the installed archive: one value's text changes, and the comment after it stays.
const edited = Root.SettingGroup.edit(declaredGroup, "[service]\nport = 4100   # the port\n", "repo");

// edge: this fixture is the installed Node ESM client, outside the Effect test runner.
assert.equal(await Effect.runPromise(edited.set(declared, 4200)), "[service]\nport = 4200   # the port\n");

assert.equal(await Effect.runPromise(edited.remove(declared)), "[service]\n   # the port\n");

// edge: this fixture is the installed Node ESM client, outside the Effect test runner.
await Effect.runPromise(runtime);

// edge: the same client runs the root entry's program.
await Effect.runPromise(rooted);

for (const name of ["internal/edit", "internal/start", "internal/document", "App.test"]) {
  await assert.rejects(import(`@kalfa/config/${name}`), { code: "ERR_PACKAGE_PATH_NOT_EXPORTED" });
}

console.log(JSON.stringify({ runtime: "passed", imports: "passed", private: "passed", edit: "passed" }));
