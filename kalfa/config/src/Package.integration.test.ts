// T1076 P2. Plants: ship a source export, omit parser JS/declarations, or keep a workspace runtime dependency.
// scenario: only a real build, archive and installation prove installed Node and compiler resolution.
import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { Effect, FileSystem, Path, Schema, Stream } from "effect";
import { Digest } from "effect/crypto";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

const modules = [
  "App",
  "Setting",
  "Sources",
  "Toml",
  "TomlParser",
  "Codec",
  "Files",
  "JsonSchema",
  "Reference",
  "Print",
  "Snapshot",
  "Load",
] as const;

const Manifest = Schema.Struct({
  name: Schema.String,
  private: Schema.Boolean,
  type: Schema.String,
  exports: Schema.Record(
    Schema.String,
    Schema.Union([Schema.String, Schema.Null, Schema.Struct({ types: Schema.String, default: Schema.String })]),
  ),
  dependencies: Schema.Record(Schema.String, Schema.String),
  peerDependencies: Schema.Record(Schema.String, Schema.String),
  optionalDependencies: Schema.optional(Schema.Record(Schema.String, Schema.String)),
});

const Event = Schema.Struct({
  pull_request: Schema.optional(Schema.Struct({ head: Schema.Struct({ sha: Schema.String }) })),
  merge_group: Schema.optional(Schema.Struct({ head_sha: Schema.String })),
});

it.effect(
  "scenario: P2 one installed archive passes runtime, public imports, declarations and private-path refusal",
  () =>
    Effect.gen(function* () {
      expect(process.env.CI, "the package lifecycle runs only in eligible CI").toBeTruthy();

      const fs = yield* FileSystem.FileSystem;

      const path = yield* Path.Path;

      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

      const digest = yield* Digest.Digest;

      const root = path.resolve(import.meta.dirname, "../../..");

      const pkg = path.join(root, "kalfa/config");

      const runner = process.env.RUNNER_TEMP;

      expect(runner).toBeTruthy();

      if (runner === undefined) {
        return yield* Effect.dieMessage("P2 requires RUNNER_TEMP for its tested archive and receipt");
      }

      const delivery = path.join(runner, "kalfa-config-package");

      // A failed rerun must never leave a previous success available for upload.
      yield* fs.remove(delivery, { recursive: true, force: true });

      const stage = yield* fs.makeTempDirectoryScoped({ directory: runner, prefix: "kalfa-config-consumer-" });

      expect(path.relative(root, stage).startsWith("..")).toBe(true);

      const consumer = path.join(stage, "consumer");

      const packed = path.join(stage, "packed");

      yield* fs.makeDirectory(consumer);

      yield* fs.makeDirectory(packed);

      const command = Effect.fnUntraced(function* (cwd: string, executable: string, args: ReadonlyArray<string>) {
        const handle = yield* spawner.spawn(
          ChildProcess.make(executable, args, {
            cwd,
            extendEnv: true,
            env: { NODE_PATH: undefined, NODE_OPTIONS: undefined },
          }),
        );

        const output = yield* handle.all.pipe(
          Stream.decodeText(),
          Stream.runFold(
            () => "",
            (text, part) => text + part,
          ),
        );

        expect(yield* handle.exitCode, `${executable} ${args.join(" ")}\n${output}`).toBe(0);

        return output.trim();
      });

      const source = yield* command(root, "git", ["rev-parse", "HEAD"]);

      const eventPath = process.env.GITHUB_EVENT_PATH;

      const event = Schema.decodeUnknownSync(Schema.fromJsonString(Event))(
        eventPath === undefined ? "{}" : yield* fs.readFileString(eventPath),
      );

      const requested = event.pull_request?.head.sha ?? event.merge_group?.head_sha ?? process.env.GITHUB_SHA;

      expect(source).toMatch(/^[a-f0-9]{40}$/);

      expect(requested).toMatch(/^[a-f0-9]{40}$/);

      // prepack owns the one scoped package build; root pnpm build does not select this package.
      yield* command(pkg, "pnpm", ["pack", "--pack-destination", packed]);

      const archives = (yield* fs.readDirectory(packed)).filter((name) => name.endsWith(".tgz"));

      expect(archives).toEqual(["kalfa-config-0.0.0.tgz"]);

      const archive = path.join(packed, "kalfa-config-0.0.0.tgz");

      const sha256 = yield* digest.digestHex(Digest.sha256, yield* fs.readFile(archive));

      const entries = (yield* command(stage, "tar", ["-tf", archive])).split("\n");

      expect(entries.some((name) => /(?:^|\/)(?:src|test|node_modules)\//.test(name))).toBe(false);

      expect(entries.some((name) => /(?:\.test\.|test-support|Test\.js)/.test(name))).toBe(false);

      yield* fs.writeFileString(
        path.join(consumer, "package.json"),
        JSON.stringify({ name: "config-consumer", private: true, type: "module" }),
      );

      yield* fs.writeFileString(path.join(consumer, "empty.npmrc"), "");

      yield* fs.copyFile(path.join(pkg, "test/consumer.mjs"), path.join(consumer, "consumer.mjs"));

      yield* fs.copyFile(path.join(pkg, "test/consumer.ts"), path.join(consumer, "consumer.ts"));

      yield* fs.writeFileString(
        path.join(consumer, "tsconfig.json"),
        JSON.stringify({
          compilerOptions: {
            target: "ES2023",
            module: "NodeNext",
            moduleResolution: "NodeNext",
            strict: true,
            noUncheckedIndexedAccess: true,
            exactOptionalPropertyTypes: true,
            skipLibCheck: false,
            noEmit: true,
            types: ["node"],
          },
          include: ["consumer.ts"],
        }),
      );

      yield* command(consumer, "npm", [
        "install",
        "--ignore-scripts",
        "--no-audit",
        "--no-fund",
        "--userconfig",
        path.join(consumer, "empty.npmrc"),
        archive,
        "effect@4.1.3",
        "typescript@7.0.2",
        "@types/node@26.6.6",
      ]);

      const installed = path.join(consumer, "node_modules/@kalfa/config");

      expect(yield* fs.realPath(installed)).toBe(installed);

      const manifest = Schema.decodeUnknownSync(Schema.fromJsonString(Manifest))(
        yield* fs.readFileString(path.join(installed, "package.json")),
      );

      expect(manifest.name).toBe("@kalfa/config");

      expect(manifest.private).toBe(true);

      expect(manifest.type).toBe("module");

      expect(
        Object.keys(manifest.exports)
          .filter((name) => manifest.exports[name] !== null && name !== "./package.json")
          .sort(),
      ).toEqual(modules.map((name) => `./${name}`).sort());

      for (const name of modules) {
        expect(manifest.exports[`./${name}`]).toEqual({ types: `./dist/${name}.d.ts`, default: `./dist/${name}.js` });

        expect(yield* fs.exists(path.join(installed, `dist/${name}.js`))).toBe(true);

        expect(yield* fs.exists(path.join(installed, `dist/${name}.d.ts`))).toBe(true);
      }

      expect(Object.keys(manifest.dependencies).sort()).toEqual(["@decimalturn/toml-patch", "toml-eslint-parser"]);

      expect(Object.keys(manifest.peerDependencies)).toEqual(["effect"]);

      for (const [name, version] of Object.entries({
        ...manifest.dependencies,
        ...manifest.peerDependencies,
        ...manifest.optionalDependencies,
      })) {
        expect(name).not.toMatch(/^@(?:kampus|tea-fabrika|kalfa)\//);

        expect(version).not.toMatch(/^(?:workspace:|catalog:|link:|file:|\.\.?\/|\/)/);
      }

      expect(yield* fs.exists(path.join(consumer, "node_modules/@kampus"))).toBe(false);

      const runtime = Schema.decodeUnknownSync(
        Schema.fromJsonString(
          Schema.Struct({
            runtime: Schema.Literal("passed"),
            imports: Schema.Literal("passed"),
            private: Schema.Literal("passed"),
          }),
        ),
      )(yield* command(consumer, "node", ["consumer.mjs"]));

      yield* command(consumer, "node", ["node_modules/typescript/bin/tsc", "--project", "tsconfig.json"]);

      expect(yield* digest.digestHex(Digest.sha256, yield* fs.readFile(archive))).toBe(sha256);

      const node = yield* command(consumer, "node", ["--version"]);

      const pnpm = yield* command(pkg, "pnpm", ["--version"]);

      const npm = yield* command(consumer, "npm", ["--version"]);

      const compiler = yield* command(consumer, "node", ["node_modules/typescript/bin/tsc", "--version"]);

      yield* fs.makeDirectory(delivery);

      yield* fs.copyFile(archive, path.join(delivery, "kalfa-config-0.0.0.tgz"));

      expect(
        yield* digest.digestHex(Digest.sha256, yield* fs.readFile(path.join(delivery, "kalfa-config-0.0.0.tgz"))),
      ).toBe(sha256);

      yield* fs.writeFileString(
        path.join(delivery, "receipt.json"),
        JSON.stringify(
          {
            source,
            requested,
            archive: "kalfa-config-0.0.0.tgz",
            sha256,
            versions: { node, pnpm, npm, compiler },
            exports: manifest.exports,
            stages: { build: "passed", pack: "passed", install: "passed", ...runtime, types: "passed" },
          },
          null,
          2,
        ) + "\n",
      );
    }).pipe(Effect.provide([NodeServices.layer, Digest.layerWebCrypto])),
);
